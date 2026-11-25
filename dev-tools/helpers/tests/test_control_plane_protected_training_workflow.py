"""Whole protected workflow execution with conservative source-scope fallback."""
from pathlib import Path
import re
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from control_plane import catalog


class ProtectedTrainingWorkflowRoutingTests(unittest.TestCase):
    root=Path(__file__).resolve().parents[3]
    check="headless-protected-training-workflow-unit"
    target="modules/adapters/runtime/python/worker/tests/test_protected_training_workflow.py"

    def selected(self, paths, required=("architecture",), root=None):
        return {row["id"]:row for row in catalog.plan(root or self.root,list(paths),list(required),"a"*64)["selected"]}

    def support(self):
        return set(catalog.PROTECTED_TRAINING_WORKFLOW_SCOPE + catalog.PROTECTED_TRAINING_WORKFLOW_OWNER_SCOPE
            + tuple("dev-tools/helpers/tests/"+name.split(".")[0]+".py" for name in catalog.PROTECTED_TRAINING_WORKFLOW_CONTROLLER_FILTERS)
            + tuple(name for check in (self.check,"headless-training-runtime-unit","headless-training-output-retirement-unit")
                for name in catalog.PUBLISHED_FORM_CHECKS[check]["automatic_required_files"]))

    def test_exact_sources_run_whole_workflow_file_and_keep_legacy_required_checks(self):
        definition=catalog.PUBLISHED_FORM_CHECKS[self.check]
        self.assertTrue(set(definition["automatic_sources"]) <= set(definition["sources"]))
        for path in definition["automatic_sources"]:
            rows=self.selected([path]);check=rows[self.check]
            self.assertEqual(check["argv"],[sys.executable,"-B","dev-tools/helpers/run_focused_checks.py","--regression-test",self.target])
            self.assertEqual(check["timeout"],270);self.assertNotIn("focused-tests",rows)
            if path.endswith(("/train_model.py","/test_train_model_task.py")):
                old=rows["model-training-worker-unit"]
                self.assertEqual(old["argv"][-1],"modules/adapters/runtime/python/worker/tests/test_train_model_task.py")
                self.assertEqual(old["timeout"],420);self.assertNotIn("-k",old["argv"])
            if path.endswith(("/windows_original_worker_launch.py","/test_native_training_model_graph.py")):
                self.assertIn("headless-training-runtime-worker-unit",rows)
            for row in rows.values():
                self.assertFalse(any(text in arg for arg in row["argv"] for text in ("test:all","qualify_windows","model-blocker")))
        self.assertIn("focused-tests",self.selected([self.target],("focused-tests",)))
        self.assertIn("focused-tests",self.selected([self.target,self.target.replace("workflow","unknown")]))

    def test_all_inherited_prerequisites_are_required_and_missing_or_nonregular_keeps_fallback(self):
        definition=catalog.PUBLISHED_FORM_CHECKS[self.check]
        for name in ("model-training-worker-unit","headless-training-runtime-worker-unit","headless-training-result-validation-unit"):
            self.assertTrue(set(catalog.PUBLISHED_FORM_CHECKS[name]["automatic_required_files"]) <= set(definition["automatic_required_files"]))
        with tempfile.TemporaryDirectory(prefix="pwp-") as directory:
            root=Path(directory)
            for name in definition["automatic_required_files"]:
                target=root/name;target.parent.mkdir(parents=True,exist_ok=True);target.write_text("# Presence only.\n")
            for name in definition["automatic_required_files"]:
                target=root/name;target.unlink()
                for as_directory in (False,True):
                    if as_directory:target.mkdir()
                    rows=self.selected([self.target],root=root)
                    self.assertNotIn(self.check,rows);self.assertIn("focused-tests",rows)
                    if as_directory:target.rmdir()
                target.write_text("# Presence only.\n")
            self.assertIn(self.check,self.selected([self.target],root=root))

    def test_closed_scope_executes_whole_related_modules_and_retains_direct_text_regression(self):
        core=list(catalog.PROTECTED_TRAINING_WORKFLOW_SCOPE);owners=list(catalog.PROTECTED_TRAINING_WORKFLOW_OWNER_SCOPE)
        expected=[sys.executable,"-B","-m","unittest","discover","-s","dev-tools/helpers/tests","-p","test_control_plane*.py",
            *[item for name in catalog.PROTECTED_TRAINING_WORKFLOW_CONTROLLER_FILTERS for item in ("-k",name)]]
        for scope in (core,core+owners,*[core+[name] for name in owners]):
            rows=self.selected(scope,("control-plane",))
            self.assertEqual(rows["control-plane"]["argv"],expected);self.assertEqual(rows["control-plane"]["timeout"],600)
        rows=self.selected(core+owners,("control-plane","model-training-worker-unit"))
        self.assertIn(self.check,rows)
        self.assertEqual(rows["model-training-worker-unit"]["argv"][-1],"modules/adapters/runtime/python/worker/tests/test_train_model_task.py")
        self.assertNotIn("-k",rows["model-training-worker-unit"]["argv"])
        self.assertEqual(rows["model-training-worker-unit"]["timeout"],420)
        for name in ("headless-training-runtime-worker-unit","headless-training-result-validation-unit","headless-training-output-retirement-unit"):
            self.assertIn(name,rows);self.assertEqual(rows[name]["timeout"],120)

    def test_unknown_mixed_incomplete_explicit_or_unavailable_scope_keeps_full_controller(self):
        core=list(catalog.PROTECTED_TRAINING_WORKFLOW_SCOPE);owners=list(catalog.PROTECTED_TRAINING_WORKFLOW_OWNER_SCOPE)
        default=next(row["argv"] for row in catalog.definitions(self.root) if row["id"]=="control-plane")
        for scope,required in (([],("control-plane",)),(core[:-1],("control-plane",)),(core[1:],("control-plane",)),
                ([owners[0]],("control-plane",)),(core+owners+["docs/unrelated.md"],("control-plane",)),
                (core+owners,("control-plane","focused-tests"))):
            self.assertEqual(self.selected(scope,required)["control-plane"]["argv"],default)
        original=catalog._automatic_files_available
        for missing in self.support():
            def without(root,check):return False if missing in check.get("automatic_required_files",()) else original(root,check)
            with self.subTest(missing=missing),patch.object(catalog,"_automatic_files_available",side_effect=without):
                self.assertEqual(self.selected(core+owners,("control-plane",))["control-plane"]["argv"],default)

    def test_real_missing_and_nonregular_support_never_qualifies_closed_controller(self):
        scope=catalog.PROTECTED_TRAINING_WORKFLOW_SCOPE+catalog.PROTECTED_TRAINING_WORKFLOW_OWNER_SCOPE
        default=next(row["argv"] for row in catalog.definitions(self.root) if row["id"]=="control-plane")
        with tempfile.TemporaryDirectory(prefix="pwc-") as directory:
            root=Path(directory)
            for name in self.support():
                target=root/name;target.parent.mkdir(parents=True,exist_ok=True);target.write_text("# Presence only.\n")
            for name in self.support():
                target=root/name;target.unlink()
                for as_directory in (False,True):
                    if as_directory:target.mkdir()
                    if as_directory and Path(name).parent.as_posix() in ("dev-tools/helpers/control_plane","dev-tools/helpers/tests"):
                        with self.assertRaises(OSError):self.selected(scope,("control-plane",),root=root)
                    else:self.assertEqual(self.selected(scope,("control-plane",),root=root)["control-plane"]["argv"],default)
                    if as_directory:target.rmdir()
                target.write_text("# Presence only.\n")
            self.assertIn("-k",self.selected(scope,("control-plane",),root=root)["control-plane"]["argv"])

    def test_registered_command_really_executes_entire_synthetic_workflow_file(self):
        result=subprocess.run(self.selected([self.target])[self.check]["argv"],cwd=self.root,
            stdout=subprocess.PIPE,stderr=subprocess.STDOUT,text=True,encoding="utf8",errors="replace",timeout=270)
        self.assertEqual(result.returncode,0,result.stdout[-3500:])
        counts=re.findall(r"\b([0-9]+) passed\b",result.stdout)
        self.assertTrue(counts,result.stdout[-3500:]);self.assertGreaterEqual(int(counts[-1]),32)
        self.assertNotRegex(result.stdout,r"\b[1-9][0-9]* (?:failed|error|skipped|deselected|xfailed|xpassed)\b")


if __name__ == "__main__":unittest.main()
