"""Whole original-file-owner qualification and conservative incomplete fallback."""
from pathlib import Path
import re
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from control_plane import catalog


class OriginalTrainingFilesRoutingTests(unittest.TestCase):
    root=Path(__file__).resolve().parents[3]
    check="headless-original-training-files-unit"
    target="modules/adapters/runtime/python/worker/tests/test_original_training_files.py"

    def selected(self,paths,required=("architecture",),root=None):
        return {row["id"]:row for row in catalog.plan(root or self.root,list(paths),list(required),"a"*64)["selected"]}

    def support(self):
        return set(catalog.ORIGINAL_TRAINING_FILES_SCOPE + catalog.ORIGINAL_TRAINING_FILES_OWNER_SCOPE
            + tuple("dev-tools/helpers/tests/"+name.split(".")[0]+".py" for name in catalog.ORIGINAL_TRAINING_FILES_CONTROLLER_FILTERS)
            + tuple(name for check in (self.check,"headless-training-runtime-unit","headless-training-runtime-worker-unit",
                "headless-protected-training-workflow-unit","headless-training-output-retirement-unit")
                for name in catalog.PUBLISHED_FORM_CHECKS[check]["automatic_required_files"]))

    def test_exact_sources_select_entire_file_and_keep_existing_required_commands(self):
        definition=catalog.PUBLISHED_FORM_CHECKS[self.check]
        self.assertTrue(set(definition["automatic_sources"])<=set(definition["sources"]))
        for source in definition["automatic_sources"]:
            rows=self.selected([source]);selected=rows[self.check]
            self.assertEqual(selected["argv"],[sys.executable,"-B","dev-tools/helpers/run_focused_checks.py","--regression-test",self.target])
            self.assertEqual(selected["timeout"],120);self.assertNotIn("focused-tests",rows)
            if source.endswith(("/train_model.py","/test_train_model_task.py")):
                old=rows["model-training-worker-unit"]
                self.assertEqual(old["timeout"],420);self.assertNotIn("-k",old["argv"])
                self.assertEqual(old["argv"][-1],"modules/adapters/runtime/python/worker/tests/test_train_model_task.py")
            for row in rows.values():
                self.assertFalse(any(name in value for value in row["argv"] for name in ("test:all","qualify_windows","model-blocker")))
        self.assertIn("focused-tests",self.selected([self.target],("focused-tests",)))
        self.assertIn("focused-tests",self.selected([self.target,self.target.replace("files","unowned")]))

    def test_all_sixteen_declared_dependencies_must_be_regular_complete_files(self):
        definition=catalog.PUBLISHED_FORM_CHECKS[self.check]
        required=definition["automatic_required_files"]
        self.assertEqual(len(required),16)
        for name in ("models.py","model_serialization.py","train_model_multimodal.py","test_train_model_task.py"):
            self.assertTrue(any(Path(value).name==name for value in required))
        with tempfile.TemporaryDirectory(prefix="ofp-") as temporary:
            root=Path(temporary)
            for name in required:
                target=root/name;target.parent.mkdir(parents=True,exist_ok=True);target.write_text("# Presence only.\n")
            for name in required:
                target=root/name;target.unlink()
                for directory in (False,True):
                    if directory:target.mkdir()
                    rows=self.selected([self.target],root=root)
                    self.assertNotIn(self.check,rows);self.assertIn("focused-tests",rows)
                    if directory:target.rmdir()
                target.write_text("# Presence only.\n")
            self.assertIn(self.check,self.selected([self.target],root=root))

    def test_closed_scope_runs_whole_related_modules_without_repeating_full_text_wrapper(self):
        core=catalog.ORIGINAL_TRAINING_FILES_SCOPE;owners=catalog.ORIGINAL_TRAINING_FILES_OWNER_SCOPE
        expected=[sys.executable,"-B","-m","unittest","discover","-s","dev-tools/helpers/tests","-p","test_control_plane*.py",
            *[part for name in catalog.ORIGINAL_TRAINING_FILES_CONTROLLER_FILTERS for part in ("-k",name)]]
        for scope in (core,core+owners,*[core+(name,) for name in owners]):
            rows=self.selected(scope,("control-plane",))
            self.assertEqual(rows["control-plane"]["argv"],expected);self.assertEqual(rows["control-plane"]["timeout"],600)
        rows=self.selected(core+owners,("control-plane","model-training-worker-unit"))
        self.assertIn(self.check,rows);self.assertNotIn("-k",rows["model-training-worker-unit"]["argv"])
        self.assertEqual(rows["model-training-worker-unit"]["timeout"],420)
        self.assertNotIn("test_control_plane_model_training_worker.",expected)

    def test_unknown_mixed_incomplete_explicit_generic_and_unavailable_support_keep_full_controller(self):
        core=catalog.ORIGINAL_TRAINING_FILES_SCOPE;owners=catalog.ORIGINAL_TRAINING_FILES_OWNER_SCOPE
        default=next(row["argv"] for row in catalog.definitions(self.root) if row["id"]=="control-plane")
        for scope,required in (((),("control-plane",)),(core[:-1],("control-plane",)),(core[1:],("control-plane",)),
            ((owners[0],),("control-plane",)),(core+owners+("docs/unowned.md",),("control-plane",)),
            (core+owners,("control-plane","focused-tests"))):
            self.assertEqual(self.selected(scope,required)["control-plane"]["argv"],default)
        original=catalog._automatic_files_available
        for missing in self.support():
            def without(root,check):return False if missing in check.get("automatic_required_files",()) else original(root,check)
            with self.subTest(missing=missing),patch.object(catalog,"_automatic_files_available",side_effect=without):
                self.assertEqual(self.selected(core+owners,("control-plane",))["control-plane"]["argv"],default)

    def test_real_missing_and_nonregular_support_never_gets_closed_controller_coverage(self):
        scope=catalog.ORIGINAL_TRAINING_FILES_SCOPE+catalog.ORIGINAL_TRAINING_FILES_OWNER_SCOPE
        default=next(row["argv"] for row in catalog.definitions(self.root) if row["id"]=="control-plane")
        with tempfile.TemporaryDirectory(prefix="ofc-") as temporary:
            root=Path(temporary)
            for name in self.support():
                target=root/name;target.parent.mkdir(parents=True,exist_ok=True);target.write_text("# Presence only.\n")
            for name in self.support():
                target=root/name;target.unlink()
                for directory in (False,True):
                    if directory:target.mkdir()
                    if directory and Path(name).parent.as_posix() in ("dev-tools/helpers/control_plane","dev-tools/helpers/tests"):
                        with self.assertRaises(OSError):self.selected(scope,("control-plane",),root=root)
                    else:self.assertEqual(self.selected(scope,("control-plane",),root=root)["control-plane"]["argv"],default)
                    if directory:target.rmdir()
                target.write_text("# Presence only.\n")
            self.assertIn("-k",self.selected(scope,("control-plane",),root=root)["control-plane"]["argv"])

    def test_registered_command_executes_all_owning_cases_with_no_model_or_native_effects(self):
        result=subprocess.run(self.selected([self.target])[self.check]["argv"],cwd=self.root,stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,text=True,encoding="utf8",errors="replace",timeout=120)
        self.assertEqual(result.returncode,0,result.stdout[-4000:])
        counts=re.findall(r"\bRan ([0-9]+) tests? in ",result.stdout)
        self.assertTrue(counts,result.stdout[-4000:]);self.assertGreaterEqual(int(counts[-1]),19)
        self.assertRegex(result.stdout,r"(?m)^OK\s*$")
        self.assertNotRegex(result.stdout,r"\b[1-9][0-9]* (?:failed|error|skipped|deselected|xfailed|xpassed)\b|\bskipped=[1-9][0-9]*")


if __name__=="__main__":unittest.main()
