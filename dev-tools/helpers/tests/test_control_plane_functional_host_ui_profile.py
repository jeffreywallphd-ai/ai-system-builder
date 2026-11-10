"""Finite model-reference definition checks preserve all generic impact guards."""
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
CONFIG="dev-tools/config/contributor-check-profiles.json"
CORE="dev-tools/scripts/qualification/visual-composer/functional-host-oracles.ts"
BORROWED="dev-tools/scripts/qualification/visual-composer/settings-host-launch-plan.d.mts"
PRIVATE_INPUTS=(
    "dev-tools/scripts/qualification/visual-composer/private-provider-artifact-boundary.mjs",
    "dev-tools/scripts/qualification/visual-composer/private-provider-test.mjs",
    "dev-tools/scripts/qualification/visual-composer/private-provider-test.d.mts",
    "dev-tools/scripts/qualification/visual-composer/fixed-private-provider-reporter.mjs",
    "dev-tools/scripts/qualification/tests/private-provider-ui-privacy.unit.test.mjs",
    "dev-tools/scripts/qualification/tests/fixtures/private-provider-failure-probe.config.mjs",
    "dev-tools/scripts/qualification/tests/fixtures/private-provider-failure-probe.spec.mjs",
    "dev-tools/scripts/qualification/tests/fixtures/private-provider-failure-probe-reporter.mjs",
)
PRIVATE_HISTORY="docs/operations/comprehensive-ui-automation-private-test-privacy-census-history.json"
TRIPWIRE="dev-tools/scripts/qualification/visual-composer/functional-artifact-provider-tripwire.ts"
TRIPWIRE_TEST="dev-tools/scripts/qualification/tests/functional-artifact-provider-tripwire.unit.test.ts"

class FunctionalHostProfile(unittest.TestCase):
    def profile(self):
        return json.loads((ROOT/CONFIG).read_bytes())["profiles"]["functional-host-ui"]

    def fixture(self,root,profile):
        for name in set(profile["source_paths"]+profile["test_paths"]):
            target=root/name
            target.parent.mkdir(parents=True,exist_ok=True)
            target.write_bytes((ROOT/name).read_bytes())
        target=root/CONFIG
        target.parent.mkdir(parents=True,exist_ok=True)
        target.write_text(json.dumps({"schema_version":"contributor-check-profiles-v1","profiles":{"functional-host-ui":profile}}))

    def test_private_inputs_keep_exact_automatic_and_fallback_ownership(self):
        profile=self.profile()
        self.assertIn(PRIVATE_INPUTS[4],profile["test_paths"])
        self.assertIn(PRIVATE_HISTORY,profile["source_paths"])
        self.assertNotIn(PRIVATE_HISTORY,catalog.QUALIFICATION_PROFILE_PATTERNS["functional-host-ui"])
        with tempfile.TemporaryDirectory(prefix="private-functional-profile-") as directory:
            root=Path(directory)
            for name in PRIVATE_INPUTS:
                with self.subTest(name=name):
                    self.assertIn(name,profile["source_paths"])
                    self.assertIn(name,catalog.QUALIFICATION_PROFILE_PATTERNS["functional-host-ui"])
                    self.fixture(root,profile)
                    selected={x["id"] for x in catalog.plan(root,[name],["documentation"],"synthetic-candidate")["selected"]}
                    self.assertIn("functional-host-ui",selected);self.assertNotIn("focused-tests",selected)
                    explicit={x["id"] for x in catalog.plan(root,[name],["focused-tests"],"synthetic-candidate")["selected"]}
                    self.assertIn("functional-host-ui",explicit);self.assertIn("focused-tests",explicit)
                    incomplete=copy.deepcopy(profile);incomplete["source_paths"].remove(name);self.fixture(root,incomplete)
                    if name in incomplete["test_paths"]:
                        # A declared test remains covered when its duplicate
                        # source declaration is absent. Remove both declarations
                        # to exercise actual incomplete ownership.
                        covered={x["id"] for x in catalog.plan(root,[name],["documentation"],"synthetic-candidate")["selected"]}
                        self.assertIn("functional-host-ui",covered);self.assertNotIn("focused-tests",covered)
                        incomplete["test_paths"].remove(name);self.fixture(root,incomplete)
                    fallback={x["id"] for x in catalog.plan(root,[name],["documentation"],"synthetic-candidate")["selected"]}
                    self.assertIn("functional-host-ui",fallback);self.assertIn("focused-tests",fallback)

    def test_complete_explicit_unknown_and_incomplete_impact_remain_distinct(self):
        profile=self.profile()
        with tempfile.TemporaryDirectory(prefix="functional-profile-") as directory:
            root=Path(directory);self.fixture(root,profile)
            for paths,required,functional,generic in [
                ([CORE,BORROWED],["documentation"],True,False),
                ([CORE],["focused-tests"],True,True),
                ([CORE,"modules/unknown/current.ts"],["documentation"],True,True),
                ([BORROWED],["documentation"],False,True),
            ]:
                with self.subTest(paths=paths,required=required):
                    ids={c["id"] for c in catalog.plan(root,paths,required,"synthetic-candidate")["selected"]}
                    self.assertEqual("functional-host-ui" in ids,functional)
                    self.assertEqual("focused-tests" in ids,generic)
            incomplete=copy.deepcopy(profile);incomplete["source_paths"].remove(CORE);self.fixture(root,incomplete)
            ids={c["id"] for c in catalog.plan(root,[CORE],["documentation"],"synthetic-candidate")["selected"]}
            self.assertIn("functional-host-ui",ids);self.assertIn("focused-tests",ids)

    def test_finite_sources_and_actual_runners_do_not_change_neighbor_bounds(self):
        profile=self.profile();configuration=json.loads((ROOT/CONFIG).read_bytes())["profiles"]
        self.assertLessEqual(len(profile["test_paths"]),100);self.assertLessEqual(len(profile["source_paths"]),200)
        self.assertEqual(len(configuration["operational-ui"]["test_paths"]),83)
        # Training use-case and fake-only worker tests with exact borrowed sources; automatic routing stays fixed.
        self.assertEqual(len(configuration["operational-ui"]["source_paths"]),197)
        self.assertEqual(configuration["operational-ui"]["source_paths"][-7:], ["apps/desktop/src/renderer/features/models/components/TrainModelTab.tsx", 'modules/application/use-cases/model/train-model.use-case.ts', 'modules/application/use-cases/tests/train-model.use-case.unit.test.ts', 'modules/application/use-cases/README.md', 'modules/adapters/runtime/python/worker/tasks/train_model.py', 'modules/adapters/runtime/python/worker/tests/test_train_model_task.py', 'modules/adapters/runtime/python/worker/README.md'])
        self.assertEqual(len(catalog.QUALIFICATION_PROFILE_PATTERNS["operational-ui"]),78)
        self.assertNotIn(BORROWED,catalog.QUALIFICATION_PROFILE_PATTERNS["functional-host-ui"])
        commands=run_focused_checks.commands(ROOT,profile["test_paths"],exact=True)
        flattened=[item for command in commands for item in command]
        for name in profile["test_paths"]:
            self.assertTrue(name in flattened or Path(name).name in flattened,name)
        for command in commands:
            self.assertLessEqual(len([item for item in command if isinstance(item,str) and item.endswith((".ts",".tsx",".mjs"))]),12)
        self.assertTrue(any("--test" in command and any("functional-host-oracles.unit.test.ts" in value for value in command) for command in commands))
        self.assertTrue(any("dev-tools/helpers/run_vitest_checks.mjs" in command and any("model-reference-http.ui.test.tsx" in value for value in command) for command in commands))

    def test_tripwire_explicit_owner_preserves_generic_unknown_and_incomplete_fallback(self):
        profile=self.profile()
        configuration=json.loads((ROOT/CONFIG).read_bytes())["profiles"]
        self.assertIn("apps/server/README.md",configuration["ingestion-publication"]["source_paths"])
        self.assertIn(TRIPWIRE,profile["source_paths"])
        self.assertIn(TRIPWIRE_TEST,profile["source_paths"])
        self.assertIn(TRIPWIRE_TEST,profile["test_paths"])
        self.assertNotIn(TRIPWIRE,catalog.QUALIFICATION_PROFILE_PATTERNS["functional-host-ui"])
        with tempfile.TemporaryDirectory(prefix="functional-tripwire-profile-") as directory:
            root=Path(directory);self.fixture(root,profile)
            for names,required,generic in [
                ([TRIPWIRE,TRIPWIRE_TEST],["functional-host-ui"],False),
                ([TRIPWIRE],["focused-tests","functional-host-ui"],True),
                ([TRIPWIRE,"modules/unknown/new.ts"],["functional-host-ui"],True),
                ([TRIPWIRE],["documentation"],True),
            ]:
                ids={x["id"] for x in catalog.plan(root,names,required,"synthetic-candidate")["selected"]}
                self.assertEqual("focused-tests" in ids,generic)
                if "functional-host-ui" in required:self.assertIn("functional-host-ui",ids)
            incomplete=copy.deepcopy(profile);incomplete["source_paths"].remove(TRIPWIRE);self.fixture(root,incomplete)
            ids={x["id"] for x in catalog.plan(root,[TRIPWIRE],["functional-host-ui"],"synthetic-candidate")["selected"]}
            self.assertIn("functional-host-ui",ids);self.assertIn("focused-tests",ids)
        commands=run_focused_checks.commands(ROOT,profile["test_paths"],exact=True)
        self.assertTrue(any("--test" in command and TRIPWIRE_TEST in command for command in commands))

if __name__=="__main__":unittest.main()
