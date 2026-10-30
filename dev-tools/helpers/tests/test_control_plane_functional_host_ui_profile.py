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
        self.assertEqual(len(configuration["operational-ui"]["test_paths"]),81)
        self.assertEqual(len(configuration["operational-ui"]["source_paths"]),186)
        self.assertEqual(len(catalog.QUALIFICATION_PROFILE_PATTERNS["operational-ui"]),76)
        self.assertNotIn(BORROWED,catalog.QUALIFICATION_PROFILE_PATTERNS["functional-host-ui"])
        commands=run_focused_checks.commands(ROOT,profile["test_paths"],exact=True)
        flattened=[item for command in commands for item in command]
        for name in profile["test_paths"]:
            self.assertTrue(name in flattened or Path(name).name in flattened,name)
        for command in commands:
            self.assertLessEqual(len([item for item in command if isinstance(item,str) and item.endswith((".ts",".tsx",".mjs"))]),12)
        self.assertTrue(any("--test" in command and any("functional-host-oracles.unit.test.ts" in value for value in command) for command in commands))
        self.assertTrue(any("dev-tools/helpers/run_vitest_checks.mjs" in command and any("model-reference-http.ui.test.tsx" in value for value in command) for command in commands))

if __name__=="__main__":unittest.main()
