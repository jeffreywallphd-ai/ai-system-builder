"""High-contrast checks stay source-only, exact and fail closed on unknown impact."""
from __future__ import annotations
import copy, json, sys, tempfile, unittest
from pathlib import Path
from unittest.mock import patch
HELPERS=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(HELPERS))
from control_plane import catalog
from control_plane.contracts import ControlError
from run_focused_checks import profile_commands
CONFIG='dev-tools/config/contributor-check-profiles.json'
PROFILE='shared-forced-colors'
TESTS=['modules/ui/shared/styles/tests/forced-colors-theme.unit.test.mjs', 'modules/ui/shared/styles/tests/shared-form-controls-primary-style.unit.test.ts', 'modules/ui/shared/styles/tests/system-builder-style-tokens.unit.test.ts', 'modules/ui/shared/styles/tests/shared-collapsible-panel-overflow.unit.test.ts', 'modules/ui/shared/styles/tests/page-dashboard-layout.unit.test.ts', 'apps/desktop/src/renderer/tests/app-shell-visible-page.ui.test.tsx', 'apps/thin-client/src/tests/app-shell-visible-page.ui.test.tsx', 'apps/desktop/src/renderer/tests/app-lazy-pages.ui.test.tsx', 'apps/desktop/tests/forge-packaging-boundaries.unit.test.ts', 'modules/ui/shared/notifications/tests/NotificationCenter.interaction.ui.test.tsx', 'modules/ui/shared/context-management/tests/ContextStudio.interaction.ui.test.tsx']
SOURCES=['modules/ui/shared/styles/forced-colors.css', 'apps/desktop/src/renderer/styles/app.css', 'apps/thin-client/src/styles/app.css', 'apps/desktop/src/renderer/styles/startup.css', 'modules/ui/shared/styles/README.md', 'dev-tools/config/contributor-check-profiles.json', 'dev-tools/helpers/control_plane/catalog.py', 'dev-tools/helpers/tests/test_control_plane_forced_colors_profile.py']

class ForcedColorsProfileTests(unittest.TestCase):
    def setUp(self):
        self.actual=HELPERS.parents[1]
        self.profile=json.loads((self.actual/CONFIG).read_bytes())['profiles'][PROFILE]
        self.temp=tempfile.TemporaryDirectory(prefix='forced-colors-profile-');self.addCleanup(self.temp.cleanup);self.root=Path(self.temp.name)
    def configure(self,profile):
        target=self.root/CONFIG;target.parent.mkdir(parents=True,exist_ok=True)
        target.write_text(json.dumps({'schema_version':'contributor-check-profiles-v1','profiles':{PROFILE:profile}}),encoding='utf-8')
    def test_exact_related_source_tests_and_no_native_or_ai_execution(self):
        self.assertEqual(self.profile,{'test_paths':TESTS,'source_paths':SOURCES})
        commands=profile_commands(self.actual,PROFILE)
        self.assertEqual(sorted(p for command in commands for p in command if p in TESTS),sorted(TESTS))
        self.assertEqual(len(TESTS),11);self.assertEqual(len(SOURCES),8)
        self.assertTrue(all(command[0]=='node' for command in commands))
        for command in commands:
            self.assertTrue(command[1:3]==['--import','tsx'] or command[1:3]==['--test','--'] or command[1:3]==['dev-tools/helpers/run_vitest_checks.mjs','--'])
            self.assertFalse(any('playwright' in p or '.ai.' in p or 'qualification_job' in p for p in command))
        existing=json.loads((self.actual/CONFIG).read_bytes())['profiles']
        self.assertEqual(len(existing['operational-ui']['test_paths']),83);self.assertEqual(len(existing['operational-ui']['source_paths']),197)
        self.assertEqual(len(existing['dataset-version-browser']['test_paths']),33)
    def test_automatic_selection_and_missing_unknown_explicit_generic_fallbacks(self):
        focused=[p for p in SOURCES+TESTS if p.startswith(('apps/','modules/')) or p==CONFIG]
        for missing,unknown,explicit,expected in [(None,False,False,False),(SOURCES[0],False,False,True),(None,True,False,True),(None,False,True,True)]:
            with self.subTest(missing=missing,unknown=unknown,explicit=explicit):
                profile=copy.deepcopy(self.profile)
                if missing:profile['source_paths'].remove(missing)
                self.configure(profile);paths=focused+(['modules/ui/shared/styles/unreviewed.css'] if unknown else [])
                required=['documentation']+(['focused-tests'] if explicit else [])
                selected=catalog.plan(self.root,paths,required,'synthetic-candidate')['selected'];ids={row['id'] for row in selected}
                self.assertIn(PROFILE,ids);self.assertEqual('focused-tests' in ids,expected)
                check=next(row for row in selected if row['id']==PROFILE)
                self.assertEqual(check['argv'][-3:],['dev-tools/helpers/run_focused_checks.py','--profile',PROFILE])
        self.configure(self.profile)
        ids={row['id'] for row in catalog.plan(self.root,['modules/ui/shared/styles/unrelated.css'],['documentation'],'synthetic-candidate')['selected']}
        self.assertNotIn(PROFILE,ids);self.assertIn('focused-tests',ids)
    def test_unsafe_missing_nontest_duplicate_and_controlled_paths_are_refused(self):
        for name in ['../outside.test.ts','/outside.test.ts','modules/ui/shared/styles/missing.test.ts','modules/ui/shared/styles/unsafe.ai.test.ts','modules/ui/shared/styles/marked.unit.test.ts','modules/ui/shared/styles/source.ts']:
            with self.subTest(name=name):
                profile=copy.deepcopy(self.profile);profile['test_paths']=[name];self.configure(profile)
                if name.endswith(('unsafe.ai.test.ts','marked.unit.test.ts','source.ts')):
                    p=self.root/name;p.parent.mkdir(parents=True,exist_ok=True);p.write_text('// @test-suite ai\n' if 'marked' in name else 'export {};\n')
                files={} if 'missing.' in name else {name:'synthetic'}
                with patch('run_focused_checks.snapshot',return_value={'files':files}),self.assertRaises(ControlError):profile_commands(self.root,PROFILE)
        profile=copy.deepcopy(self.profile);profile['test_paths']=[TESTS[0],TESTS[0]];self.configure(profile)
        with self.assertRaises(ControlError):profile_commands(self.root,PROFILE)


    def test_shared_files_do_not_activate_this_profile_for_legacy_work(self):
        expected=['modules/ui/shared/styles/forced-colors.css', 'modules/ui/shared/styles/tests/forced-colors-theme.unit.test.mjs', 'dev-tools/helpers/tests/test_control_plane_forced_colors_profile.py', 'apps/desktop/src/renderer/styles/app.css', 'apps/thin-client/src/styles/app.css']
        self.assertEqual(catalog.QUALIFICATION_PROFILE_PATTERNS[PROFILE],expected)
        legacy=json.loads((self.actual/CONFIG).read_bytes())['profiles']['desktop-startup-ui']
        target=self.root/CONFIG;target.parent.mkdir(parents=True,exist_ok=True)
        target.write_text(json.dumps({'schema_version':'contributor-check-profiles-v1','profiles':{'desktop-startup-ui':legacy}}),encoding='utf-8')
        for paths,required,generic in [
            (legacy['source_paths']+legacy['test_paths'],['desktop-startup-ui'],False),
            ([legacy['test_paths'][0]],['desktop-startup-ui','focused-tests'],True),
            ([legacy['test_paths'][0],'apps/desktop/src/unrelated.ts'],['desktop-startup-ui'],True),
        ]:
            with self.subTest(paths=paths,required=required):
                ids={row['id'] for row in catalog.plan(self.root,paths,required,'synthetic-candidate')['selected']}
                self.assertIn('desktop-startup-ui',ids);self.assertNotIn(PROFILE,ids);self.assertEqual('focused-tests' in ids,generic)
        with self.assertRaises(ControlError):catalog.plan(self.root,[legacy['source_paths'][4]],[PROFILE],'synthetic-candidate')
    def test_startup_only_palette_work_can_explicitly_select_current_profile(self):
        self.configure(self.profile)
        ids={row['id'] for row in catalog.plan(self.root,['apps/desktop/src/renderer/styles/startup.css'],[PROFILE],'synthetic-candidate')['selected']}
        self.assertIn(PROFILE,ids);self.assertNotIn('focused-tests',ids)

if __name__=='__main__':unittest.main()
