"""The tree probe profile has pure units only; native effects stay explicit."""
from pathlib import Path
import copy
import json
import sys
import tempfile
import unittest

HELPERS=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(HELPERS))
from control_plane import catalog
import run_focused_checks

ROOT=HELPERS.parents[1]
PROFILE='windows-guarded-tree-probe'
CONFIG='dev-tools/config/contributor-check-profiles.json'
CORE='dev-tools/scripts/native/probe_windows_guarded_tree.py'
UNIT='dev-tools/scripts/native/tests/test_windows_guarded_tree_probe.py'
GUARD='dev-tools/helpers/tests/test_control_plane_tree_probe_profile.py'


class TreeProbeProfileTests(unittest.TestCase):
    def profile(self):return json.loads((ROOT/CONFIG).read_bytes())['profiles'][PROFILE]

    def fixture(self,root,profile):
        for name in set(profile['source_paths']+profile['test_paths']):
            target=root/name;target.parent.mkdir(parents=True,exist_ok=True);target.write_bytes((ROOT/name).read_bytes())
        (root/CONFIG).write_text(json.dumps({'schema_version':'contributor-check-profiles-v1','profiles':{PROFILE:profile}}))

    def test_fixed_profile_runs_only_the_pure_unit_file(self):
        self.assertEqual(self.profile()['test_paths'],[UNIT])
        self.assertEqual(run_focused_checks.profile_commands(ROOT,PROFILE),[[sys.executable,'-B','-m','unittest','discover','-s','dev-tools/scripts/native/tests','-p','test_windows_guarded_tree_probe.py']])
        self.assertEqual(catalog.QUALIFICATION_PROFILE_PATTERNS[PROFILE],[CORE,UNIT,GUARD])

    def test_complete_unknown_explicit_and_borrowed_impact_keep_guards(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);self.fixture(root,self.profile())
            for paths,required,selected,generic in [([CORE,CONFIG,'dev-tools/README.md'],['documentation'],True,False),([GUARD],['documentation'],True,False),([CORE],['focused-tests'],True,True),([CORE,'modules/unknown/current.ts'],['documentation'],True,True),(['dev-tools/README.md'],['documentation'],False,False)]:
                with self.subTest(paths=paths,required=required):
                    ids={c['id'] for c in catalog.plan(root,paths,required,'synthetic-candidate')['selected']}
                    self.assertEqual(PROFILE in ids,selected);self.assertEqual('focused-tests' in ids,generic)

    def test_incomplete_declaration_retains_generic_ownership(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);profile=copy.deepcopy(self.profile());profile['source_paths'].remove(CORE);self.fixture(root,profile)
            ids={c['id'] for c in catalog.plan(root,[CORE],['documentation'],'synthetic-candidate')['selected']}
            self.assertIn(PROFILE,ids);self.assertIn('focused-tests',ids)

    def test_existing_identity_and_restart_paths_do_not_run_the_probe_profile(self):
        for name in ['dev-tools/scripts/qualification/offload_guarded_restart.py','modules/adapters/model/local/native/windows/model_file_identity.cc','dev-tools/scripts/native/build_windows_model_file_identity.py']:
            with self.subTest(name=name):
                ids={c['id'] for c in catalog.plan(ROOT,[name],['documentation'],'synthetic-candidate')['selected']}
                self.assertNotIn(PROFILE,ids)


if __name__=='__main__':unittest.main()
