"""Execute the exact result-validation file without unrelated runtime discovery."""
from pathlib import Path
import json
import os
import re
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from control_plane import catalog


class TrainingResultValidationRoutingTests(unittest.TestCase):
    root = Path(__file__).resolve().parents[3]
    source = "modules/adapters/runtime/python/worker/tasks/model_validation.py"
    test = "modules/adapters/runtime/python/worker/tests/test_model_validation.py"
    helper = "dev-tools/helpers/run_focused_checks.py"
    check = "headless-training-result-validation-unit"

    def selected(self, paths, required=("architecture",), root=None):
        return {row["id"]:row for row in catalog.plan(root or self.root,paths,list(required),"a"*64)["selected"]}

    def test_exact_result_sources_choose_only_fixed_owned_file(self):
        for path in (self.source,self.test):
            selected=self.selected([path]);check=selected[self.check]
            self.assertEqual(check["argv"],[sys.executable,"-B",self.helper,"--regression-test",self.test])
            self.assertEqual(check["timeout"],120)
            self.assertNotIn("focused-tests",selected)
            for name in ("model-training-worker-unit","completion-all","completion-standardande2e"):
                self.assertNotIn(name,selected)

    def test_unknown_explicit_and_shared_coverage_is_preserved(self):
        readme="modules/adapters/runtime/python/worker/README.md"
        self.assertNotIn(self.check,self.selected([readme]))
        self.assertNotIn("focused-tests",self.selected([self.source,readme]))
        self.assertIn("focused-tests",self.selected([self.source],("focused-tests",)))
        unknown="modules/adapters/runtime/python/worker/tasks/unknown_result_validation.py"
        self.assertIn("focused-tests",self.selected([self.source,unknown]))
        other="modules/adapters/runtime/python/worker/tasks/train_model.py"
        self.assertIn("model-training-worker-unit",self.selected([self.source,other]))

    def test_missing_or_directory_inputs_do_not_suppress_generic_checks(self):
        with tempfile.TemporaryDirectory(prefix="result-validation-presence-") as directory:
            root=Path(directory)
            for name in catalog.PUBLISHED_FORM_CHECKS[self.check]["automatic_required_files"]:
                self.assertNotIn(self.check,self.selected([self.source,self.test],root=root))
                target=root/name;target.parent.mkdir(parents=True,exist_ok=True);target.mkdir()
                self.assertNotIn(self.check,self.selected([self.source,self.test],root=root))
                target.rmdir();target.write_text("# Presence only; never execution evidence.\n")
            self.assertIn(self.check,self.selected([self.source,self.test],root=root))

    def test_fixed_producer_and_native_changes_keep_their_own_checks(self):
        definition=catalog.PUBLISHED_FORM_CHECKS[self.check]
        for name in definition["automatic_sources"][2:]:
            selected=self.selected([name])
            self.assertEqual(selected[self.check]["argv"][-1],self.test)
            original="headless-training-runtime-worker-unit" if "/native/" in name or "test_native_training" in name else "model-training-worker-unit"
            self.assertIn(original,selected)

    def test_inherited_native_prerequisites_cannot_hide_old_checks_or_generic_fallback(self):
        definition=catalog.PUBLISHED_FORM_CHECKS[self.check]
        required=set(definition["automatic_required_files"])
        old=catalog.PUBLISHED_FORM_CHECKS["headless-training-runtime-worker-unit"]
        self.assertTrue(set(old["automatic_required_files"]) <= required)
        self.assertTrue(set(catalog.PUBLISHED_FORM_CHECKS["model-training-worker-unit"]["automatic_required_files"]) <= required)
        inherited=("modules/adapters/runtime/python/worker/tasks/approved_local_training_session.py",
            "modules/adapters/runtime/python/worker/app.py",
            "modules/adapters/runtime/python/worker/tests/test_approved_local_training_session.py")
        native="modules/adapters/runtime/python/worker/native/windows_original_worker_launch.py"
        with tempfile.TemporaryDirectory(prefix="result-validation-inherited-") as directory:
            root=Path(directory)
            for name in required:
                target=root/name;target.parent.mkdir(parents=True,exist_ok=True);target.write_text("# Presence only.\n")
            for name in inherited:
                target=root/name;target.unlink()
                for directory_input in (False,True):
                    if directory_input:target.mkdir()
                    selected=self.selected([native],root=root)
                    self.assertNotIn(self.check,selected)
                    self.assertNotIn("headless-training-runtime-worker-unit",selected)
                    self.assertIn("focused-tests",selected)
                    if directory_input:target.rmdir()
                target.write_text("# Presence only.\n")
            selected=self.selected([native],root=root)
            self.assertIn(self.check,selected);self.assertIn("headless-training-runtime-worker-unit",selected)

    def test_fixed_check_executes_the_current_structural_parser_and_ordinary_regressions(self):
        argv=self.selected([self.source,self.test])[self.check]["argv"]
        env={**os.environ,"PYTEST_ADDOPTS":"--invalid-ambient-argument",
            "PYTEST_PLUGINS":"nonexistent_ambient_plugin"}
        result=subprocess.run(argv,cwd=self.root,env=env,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,
            timeout=120,text=True,encoding="utf8",errors="replace")
        self.assertEqual(result.returncode,0,result.stdout[-2500:])
        counts=re.findall(r"\b([0-9]+) passed\b",result.stdout)
        self.assertTrue(counts,result.stdout[-2500:]);self.assertGreaterEqual(int(counts[-1]),123)
        self.assertNotRegex(result.stdout,r"\b[1-9][0-9]* (?:failed|error|deselected|xfailed|xpassed)\b")
        # An existing ordinary path test skips only when Windows denies symlink
        # creation. Preserve that platform gap; it supplies no structural pass.
        skipped=re.findall(r"\b([0-9]+) skipped\b",result.stdout)
        self.assertLessEqual(sum(map(int,skipped)),1)
        print(json.dumps({"check":self.check,"passed":int(counts[-1]),
            "platform_path_test_skipped":sum(map(int,skipped)),
            "scope":"structural result parsing; no Native, model or quality qualification"}))

    def test_known_result_scope_runs_complete_related_suites_with_original_limits(self):
        core=list(catalog.TRAINING_RESULT_ROUTING_SCOPE)
        owners=list(catalog.TRAINING_RESULT_OWNER_SCOPE)
        expected=[sys.executable,"-B","-m","unittest","discover","-s","dev-tools/helpers/tests",
            "-p","test_control_plane*.py",
            *[item for name in catalog.TRAINING_RESULT_CONTROLLER_FILTERS for item in ("-k",name)]]
        for scope in (core,core+owners,*[core+[name] for name in owners]):
            selected=self.selected(scope,("control-plane",))
            self.assertEqual(selected["control-plane"]["argv"],expected)
            self.assertEqual(selected["control-plane"]["timeout"],600)
        selected=self.selected(core+owners,("control-plane",))
        self.assertEqual(selected[self.check]["argv"][-1],self.test)
        definitions={row["id"]:row for row in catalog.definitions(self.root)}
        self.assertEqual(definitions["model-training-worker-unit"]["timeout"],240)
        self.assertNotIn("-k",definitions["model-training-worker-unit"]["argv"])
        for name in ("headless-training-runtime-unit","headless-training-runtime-worker-unit","python-runtime-owned-worker"):
            self.assertEqual(definitions[name]["timeout"],120)

    def test_other_or_unavailable_result_scopes_keep_complete_controller_discovery(self):
        core=list(catalog.TRAINING_RESULT_ROUTING_SCOPE)
        owners=list(catalog.TRAINING_RESULT_OWNER_SCOPE)
        default=next(row for row in catalog.definitions(self.root) if row["id"]=="control-plane")["argv"]
        for scope,required in (([],("control-plane",)),(core[:-1],("control-plane",)),
                (core[1:],("control-plane",)),([owners[0]],("control-plane",)),
                (core+owners+["docs/unrelated.md"],("control-plane",)),
                (core+["modules/adapters/runtime/python/worker/tasks/train_model.py"],("control-plane",)),
                (core+owners,("control-plane","focused-tests"))):
            self.assertEqual(self.selected(scope,required)["control-plane"]["argv"],default)
        support=set(core+owners+list(catalog.TRAINING_RESULT_CONTROLLER_TESTS)+
            list(catalog.PUBLISHED_FORM_CHECKS[self.check]["automatic_required_files"]))
        original=catalog._automatic_files_available
        for missing in support:
            def without_file(root,check):
                return False if missing in check.get("automatic_required_files",()) else original(root,check)
            with self.subTest(missing_support=missing),patch.object(catalog,"_automatic_files_available",side_effect=without_file):
                self.assertEqual(self.selected(core+owners,("control-plane",))["control-plane"]["argv"],default)
        # Exercise real missing and nonregular support, not only the mock above.
        with tempfile.TemporaryDirectory(prefix="result-controller-presence-") as directory:
            root=Path(directory)
            for name in support:
                target=root/name;target.parent.mkdir(parents=True,exist_ok=True);target.write_text("# Presence only.\n")
            for name in support:
                target=root/name;target.unlink()
                for as_directory in (False,True):
                    if as_directory:target.mkdir()
                    # The existing catalog digest reads helper Python files.
                    # A directory there fails closed before a plan is returned;
                    # it must never qualify for this narrower controller scope.
                    if as_directory and Path(name).parent.as_posix() in ("dev-tools/helpers/control_plane","dev-tools/helpers/tests"):
                        with self.assertRaises(OSError):
                            self.selected(core+owners,("control-plane",),root=root)
                    else:
                        self.assertEqual(self.selected(core+owners,("control-plane",),root=root)["control-plane"]["argv"],default)
                    if as_directory:target.rmdir()
                target.write_text("# Presence only.\n")
            self.assertIn("-k",self.selected(core+owners,("control-plane",),root=root)["control-plane"]["argv"])


if __name__ == "__main__":unittest.main()
