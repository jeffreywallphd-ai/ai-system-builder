"""Genuine original-file exit proof uses bounded whole owning feature tests."""
from pathlib import Path
import re
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from control_plane import catalog


class TrainingExitBarrierRoutingTests(unittest.TestCase):
    root=Path(__file__).resolve().parents[3]
    check="headless-training-exit-barrier-unit"
    target="modules/adapters/runtime/python/worker/tests/test_original_training_exit_barrier.py"
    source="modules/adapters/runtime/python/worker/tasks/original_training_exit_barrier.py"

    def selected(self,paths,required=("architecture",),root=None):
        return {row["id"]:row for row in catalog.plan(root or self.root,list(paths),list(required),"a"*64)["selected"]}

    def support(self):
        return set(catalog.TRAINING_EXIT_BARRIER_SCOPE+catalog.TRAINING_EXIT_BARRIER_OWNER_SCOPE
            +tuple("dev-tools/helpers/tests/"+name.split(".")[0]+".py" for name in catalog.TRAINING_EXIT_BARRIER_CONTROLLER_FILTERS)
            +tuple(name for identity in (self.check,"headless-original-training-files-unit","headless-training-output-channel-unit")
                for name in catalog.PUBLISHED_FORM_CHECKS[identity]["automatic_required_files"]))

    def test_exact_sources_use_whole_actual_feature_and_preserve_related_compatibility(self):
        definition=catalog.PUBLISHED_FORM_CHECKS[self.check]
        self.assertTrue(set(definition["automatic_sources"])<=set(definition["sources"]))
        expected=[sys.executable,"-B","dev-tools/helpers/run_focused_checks.py","--regression-test",self.target]
        for source in definition["automatic_sources"]:
            rows=self.selected([source]);self.assertEqual(rows[self.check]["argv"],expected)
            self.assertEqual(rows[self.check]["timeout"],120);self.assertNotIn("focused-tests",rows)
            self.assertNotIn("model-training-worker-unit",rows)
            if source.endswith("/original_training_files.py"):
                self.assertIn("headless-original-training-files-unit",rows)
                self.assertIn("headless-training-output-delivery-unit",rows)
            for row in rows.values():
                self.assertFalse(any(name in value for value in row["argv"] for name in ("test:all","model-blocker","qualify_windows")))
        self.assertIn("focused-tests",self.selected([self.target],("focused-tests",)))
        self.assertIn("focused-tests",self.selected([self.target,self.source.replace("exit_barrier","unknown")]))

    def test_each_required_source_must_be_regular_and_missing_support_keeps_fallback(self):
        required=catalog.PUBLISHED_FORM_CHECKS[self.check]["automatic_required_files"]
        self.assertEqual(len(required),16)
        with tempfile.TemporaryDirectory(prefix="exit-route-") as temporary:
            root=Path(temporary)
            for name in required:
                target=root/name;target.parent.mkdir(parents=True,exist_ok=True);target.write_text("# Presence only.\n")
            for name in required:
                target=root/name;target.unlink()
                for directory in (False,True):
                    if directory:target.mkdir()
                    rows=self.selected([self.source],root=root)
                    self.assertNotIn(self.check,rows);self.assertIn("focused-tests",rows)
                    if directory:target.rmdir()
                target.write_text("# Presence only.\n")
            self.assertIn(self.check,self.selected([self.source],root=root))

    def test_only_complete_known_owner_scope_gets_whole_related_controller_modules(self):
        core=catalog.TRAINING_EXIT_BARRIER_SCOPE;owners=catalog.TRAINING_EXIT_BARRIER_OWNER_SCOPE
        expected=[sys.executable,"-B","-m","unittest","discover","-s","dev-tools/helpers/tests","-p","test_control_plane*.py",
            *[part for name in catalog.TRAINING_EXIT_BARRIER_CONTROLLER_FILTERS for part in ("-k",name)]]
        for scope in (core,core+owners,*[core+(name,) for name in owners]):
            row=self.selected(scope,("control-plane",))["control-plane"]
            self.assertEqual(row["argv"],expected);self.assertEqual(row["timeout"],600)
        rows=self.selected(core+owners,("control-plane","headless-original-training-files-unit"))
        self.assertNotIn("focused-tests",rows)
        default=next(row["argv"] for row in catalog.definitions(self.root) if row["id"]=="control-plane")
        for scope,required in (((),("control-plane",)),(core[:-1],("control-plane",)),
            ((owners[0],),("control-plane",)),(core+owners+("docs/unknown.md",),("control-plane",)),
            (core+owners,("control-plane","focused-tests"))):
            self.assertEqual(self.selected(scope,required)["control-plane"]["argv"],default)
        original=catalog._automatic_files_available
        for missing in self.support():
            def available(root,check):return False if missing in check.get("automatic_required_files",()) else original(root,check)
            with self.subTest(missing=missing),patch.object(catalog,"_automatic_files_available",side_effect=available):
                self.assertEqual(self.selected(core+owners,("control-plane",))["control-plane"]["argv"],default)

    def test_registered_command_runs_entire_real_file_barrier_suite_without_physical_effects(self):
        result=subprocess.run(self.selected([self.source])[self.check]["argv"],cwd=self.root,
            capture_output=True,text=True,encoding="utf8",errors="replace",timeout=120)
        self.assertEqual(result.returncode,0,result.stdout[-4000:]+result.stderr[-4000:])
        count=re.search(r"Ran ([0-9]+) tests",result.stderr)
        self.assertIsNotNone(count);self.assertGreaterEqual(int(count.group(1)),18)
        self.assertIn("OK",result.stderr)
        self.assertNotRegex(result.stdout+result.stderr,r"FAILED|skipped=[1-9]|\b[1-9][0-9]* (?:failed|error|skipped|deselected)\b")


if __name__=="__main__":unittest.main()
