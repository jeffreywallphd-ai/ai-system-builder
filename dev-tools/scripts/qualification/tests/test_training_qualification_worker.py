"""Finite inert dispatch tests: no production import, model or process launch."""
import copy
import importlib.util
from pathlib import Path
from types import SimpleNamespace
import unittest
import tempfile
import os
import json
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("training_worker", Path(__file__).parents[1] / "visual-composer/training-qualification-worker.py")
worker = importlib.util.module_from_spec(spec)
spec.loader.exec_module(worker)


class TrainingQualificationWorkerTests(unittest.TestCase):
    def setUp(self):
        self.fixture = {"workspaceId": "workspace.training", "baseModelRecordId": "model.input", "datasetArtifactIds": ["data.train", "data.validation"]}
        self.model, self.temp = Path("/owned/model"), Path("/owned/temp")
        self.request = SimpleNamespace(taskType="train-model", metadata={"workspaceId": "workspace.training"}, payload={"workspaceId": "workspace.training", "trainingTask": "llm-instruction", "method": "lora",
            "baseModel": {"modelRecordId": "model.input", "modelId": worker.MODEL_ID, "provider": "huggingface", "inferenceMode": "causal", "localPath": str(self.model)},
            "commonParameters": {"numEpochs": 1, "maxSteps": 1, "batchSize": 1, "learningRate": .0002, "maxSequenceLength": 64, "seed": 7},
            "advancedParameters": {"gradientAccumulationSteps": 1, "checkpointIntervalSteps": 100, "evalIntervalSteps": 100, "gradientCheckpointing": False, "lora": {"rank": 1, "alpha": 2, "dropout": .05}},
            "output": {"outputModelName": worker.OUTPUT_NAME, "maxShardSize": "2GB", "destination": {"local": {"enabled": True}}, "registration": {"displayName": "Training host support adapter", "artifactForm": "adapter"}},
            "validation": {"enabled": False, "expectedLoRA": True, "expectedRecurrentAdditions": False},
            "datasets": [{"artifactId": artifact, "splitRole": role, "format": "jsonl", "path": str(self.temp / f"{role}.jsonl")}
                         for artifact, role in zip(self.fixture["datasetArtifactIds"], ("train", "validation"))]})
        self.inspected, self.calls = [], []

    def dispatch(self, operation=None):
        return worker.single_training_dispatch(operation or (lambda request: self.calls.append(request) or "original-result"), self.fixture, self.model, self.temp,
            lambda root, target, maximum: self.inspected.append((root, target, maximum)))

    def test_real_delegate_receives_same_request_once_and_result_is_unchanged(self):
        dispatch = self.dispatch()
        self.assertEqual(dispatch(self.request), "original-result")
        self.assertIs(self.calls[0], self.request)
        self.assertEqual(len(self.inspected), 2)
        with self.assertRaises(ValueError): dispatch(self.request)
        self.assertEqual(len(self.calls), 1)

    def test_delegate_failure_is_never_changed_to_success_and_cannot_repeat(self):
        error = RuntimeError("synthetic-private-error")
        def fail(_): raise error
        dispatch = self.dispatch(fail)
        with self.assertRaises(RuntimeError) as actual: dispatch(self.request)
        self.assertIs(actual.exception, error)
        with self.assertRaises(ValueError): dispatch(self.request)

    def test_wrong_task_model_output_parameters_and_dataset_fail_before_delegate(self):
        variants = []
        for key, value in (("workspaceId", "workspace.other"), ("trainingTask", "diffusion-lora"), ("method", "full-finetune"), ("validation", {"enabled": True}), ("datasets", []), ("output", {"outputModelName": "other"})):
            candidate = copy.deepcopy(self.request); candidate.payload[key] = value; variants.append(candidate)
        for section, key, value in (("baseModel", "localPath", "/foreign/model"), ("baseModel", "modelRecordId", "other"), ("commonParameters", "maxSteps", 2), ("commonParameters", "numEpochs", True), ("output", "outputDirectory", "/foreign/output"), ("output", "destination", {"huggingFace": {"enabled": True}}), ("advancedParameters", "lora", {"rank": 4096}), ("advancedParameters", "gradientAccumulationSteps", 4096)):
            candidate = copy.deepcopy(self.request); candidate.payload[section][key] = value; variants.append(candidate)
        candidate = copy.deepcopy(self.request);candidate.taskType = "ensure-model-download";variants.append(candidate)
        candidate = copy.deepcopy(self.request);candidate.metadata["workspaceId"] = "foreign";variants.append(candidate)
        candidate = copy.deepcopy(self.request);candidate.payload["datasets"][1]["artifactId"] = "foreign";variants.append(candidate)
        for candidate in variants:
            with self.subTest(payload=candidate.taskType):
                with self.assertRaises(ValueError): self.dispatch()(candidate)
        self.assertEqual(self.calls, [])

    def test_direct_download_entry_is_denied(self):
        with self.assertRaises(ValueError): worker.deny_download(object(), token="synthetic-private")

    def test_owned_tiny_dataset_bytes_are_checked_and_mismatches_denied(self):
        import tempfile
        with tempfile.TemporaryDirectory(prefix="training-dataset-") as folder:
            root = Path(folder).resolve(); target = root / "train.jsonl"
            target.write_bytes(worker.DATA_BYTES)
            worker.admit_dataset(root, target, 8192)
            target.write_bytes(b'{"instruction":"wrong bytes"}\n')
            with self.assertRaises(ValueError): worker.admit_dataset(root, target, 8192)

    def test_invalid_file_proof_prevents_real_delegate(self):
        def missing(*_): raise ValueError("File proof unavailable")
        dispatch = worker.single_training_dispatch(lambda _: self.calls.append(True), self.fixture, self.model, self.temp, missing)
        with self.assertRaises(ValueError): dispatch(self.request)
        self.assertEqual(self.calls, [])

    def test_generated_profile_preserves_real_delegate_and_cannot_impersonate_official_model(self):
        self.fixture.update(schemaVersion="training-host-fixture-v2", inputProfile="generated-tiny-qwen2-v1")
        self.request.payload["baseModel"].update(modelId=worker.TINY_MODEL_ID, provider="unknown")
        dispatch = self.dispatch()
        self.assertEqual(dispatch(self.request), "original-result")
        self.assertIs(self.calls[0], self.request)
        with self.assertRaises(ValueError): dispatch(self.request)
        for key, value in (("modelId", worker.MODEL_ID), ("provider", "huggingface"), ("localPath", "/foreign/model")):
            candidate = copy.deepcopy(self.request); candidate.payload["baseModel"][key] = value
            with self.subTest(key=key), self.assertRaises(ValueError): self.dispatch()(candidate)
        self.fixture["inputProfile"] = "other-model"
        with self.assertRaises(ValueError): self.dispatch()(self.request)

    def test_generated_identity_cannot_be_used_with_the_legacy_fixture(self):
        self.request.payload["baseModel"].update(modelId=worker.TINY_MODEL_ID, provider="unknown")
        with self.assertRaises(ValueError): self.dispatch()(self.request)
        self.assertEqual(self.calls, [])

    def test_fresh_worker_requires_declared_tiny_context_and_exact_original_main_bytes(self):
        with tempfile.TemporaryDirectory(prefix="training source with spaces ") as folder:
            root = Path(folder).resolve()
            package = root / ".local-codex/q/abc123ef/o/ai-system-builder-win32-x64"
            target = package / "resources/worker/main.py"
            source = root / "modules/adapters/runtime/python/worker/main.py"
            for path in (target, source):
                path.parent.mkdir(parents=True, exist_ok=True); path.write_bytes(b"inert source identity only\n")
            env = {"VISUAL_COMPOSER_TRAINING_PACKAGED_ROOT": str(package),
                   "VISUAL_COMPOSER_TRAINING_MODEL_ACQUISITION": ".local-codex/training-inputs/tiny-01234567-89ab-cdef-0123-456789abcdef/input.json",
                   "VISUAL_COMPOSER_TRAINING_INPUT_SHA256": "a" * 64}
            self.assertEqual(worker.training_worker_directory(root, env), target.parent)
            target.write_bytes(b"changed source must not import\n")
            with self.assertRaises(ValueError): worker.training_worker_directory(root, env)

    def test_fresh_worker_rejects_foreign_paths_profiles_and_missing_hash_before_file_access(self):
        root = Path(tempfile.gettempdir()).resolve() / "inert-nonexistent-training-source"
        package = root / ".local-codex/q/abc123ef/o/ai-system-builder-win32-x64"
        env = {"VISUAL_COMPOSER_TRAINING_PACKAGED_ROOT": str(package),
               "VISUAL_COMPOSER_TRAINING_MODEL_ACQUISITION": ".local-codex/training-inputs/tiny-01234567-89ab-cdef-0123-456789abcdef/input.json",
               "VISUAL_COMPOSER_TRAINING_INPUT_SHA256": "a" * 64}
        for key, value in (("VISUAL_COMPOSER_TRAINING_PACKAGED_ROOT", str(root / "out/ai-system-builder-win32-x64")),
                           ("VISUAL_COMPOSER_TRAINING_PACKAGED_ROOT", str(package) + "\n"),
                           ("VISUAL_COMPOSER_TRAINING_MODEL_ACQUISITION", ".local-codex/model-qualification/qwen-01234567-89ab-cdef-0123-456789abcdef/acquisition.json"),
                           ("VISUAL_COMPOSER_TRAINING_INPUT_SHA256", ""),
                           ("VISUAL_COMPOSER_TRAINING_INPUT_SHA256", None),
                           ("VISUAL_COMPOSER_TRAINING_MODEL_ACQUISITION", {}),
                           ("VISUAL_COMPOSER_TRAINING_PACKAGED_ROOT", [])):
            with self.subTest(key=key, value=value), self.assertRaises(ValueError):
                worker.training_worker_directory(root, {**env, key: value})

    def test_legacy_worker_location_needs_no_fresh_package_or_extra_identity(self):
        root = Path(tempfile.gettempdir()).resolve() / "inert legacy source with spaces"
        self.assertEqual(worker.training_worker_directory(root, {}), root / "out/ai-system-builder-win32-x64/resources/worker")

    def test_source_identity_keeps_stable_per_api_times_and_rejects_read_time_changes(self):
        with tempfile.TemporaryDirectory(prefix="training source identity ") as folder:
            root=Path(folder).resolve();file=root/"main.py";file.write_bytes(b"inert source identity\n")
            stamp=file.lstat().st_ctime_ns;original=os.fstat
            def observed(fd,offset):
                info=original(fd)
                values={key:getattr(info,key) for key in ("st_dev","st_ino","st_size","st_mtime_ns","st_nlink","st_mode")}
                return SimpleNamespace(**values,st_ctime_ns=stamp+offset,st_file_attributes=getattr(info,"st_file_attributes",0))
            with patch.object(worker.os,"fstat",side_effect=lambda fd:observed(fd,100)):
                self.assertEqual(worker._source_identity_bytes(root,file),b"inert source identity\n")
            offsets=iter((100,200))
            with patch.object(worker.os,"fstat",side_effect=lambda fd:observed(fd,next(offsets))),self.assertRaises(ValueError):
                worker._source_identity_bytes(root,file)


class TrainingFailureFactsTests(unittest.TestCase):
    cache = Path("C:/owned-test/controlled-model-cache")

    @staticmethod
    def failed(message, **details):
        return {"status": "failed", "error": {"code": "training_failed", "message": message,
                "details": {"stage": "dataset-loading", "errorType": "OtherError", **details}}}

    def test_long_owned_lock_is_classified_without_serializing_text_or_path(self):
        path = str(self.cache / "datasets" / ("x" * 255 + ".lock"))
        facts = worker.training_failure_facts(self.failed(str(FileNotFoundError(2, "No such file or directory", path))), self.cache)
        self.assertEqual(facts, {"schema_version": "training-failure-facts-v1", "status": "classified",
            "stage": "dataset-loading", "error_number_kind": "errno", "error_number": 2,
            "path_kind": "owned-cache-lock", "path_characters": len(path),
            "windows_path_utf16_units": len(path),
            "windows_legacy_path_limit_exceeded": True, "parent_qualification_granted": False})
        self.assertNotIn(str(self.cache), json.dumps(facts))
        self.assertNotIn("No such file", json.dumps(facts))

    def test_windows_error_and_owned_nonlock_keep_only_closed_labels(self):
        path = str(self.cache / "datasets" / "private-data.arrow")
        facts = worker.training_failure_facts(self.failed(f"[WinError 5] Access is denied: {path!r}"), self.cache)
        self.assertEqual((facts["error_number_kind"], facts["error_number"], facts["path_kind"]),
                         ("winerror", 5, "owned-cache-file"))
        self.assertFalse(facts["windows_legacy_path_limit_exceeded"])
        self.assertNotIn("private-data", json.dumps(facts))

    def test_foreign_path_is_not_read_or_mislabeled_owned(self):
        for path in ("C:/owned-test/controlled-model-cache-other/secret.lock", "D:/foreign/private.lock"):
            with self.subTest(path=path), patch.object(Path, "open", side_effect=AssertionError("no reads")):
                facts = worker.training_failure_facts(self.failed(f"[Errno 13] Private marker: '{path}'"), self.cache)
                self.assertEqual(facts["path_kind"], "other")
                self.assertNotIn("Private marker", json.dumps(facts))
                self.assertNotIn("secret", json.dumps(facts))

    def test_real_builtin_escaped_windows_path_has_exact_decoded_length(self):
        path = "C:\\owned-test\\controlled-model-cache\\datasets\\private's-é.lock"
        message = str(FileNotFoundError(2, "No such file or directory", path))
        facts = worker.training_failure_facts(self.failed(message), self.cache)
        self.assertEqual((facts["status"], facts["path_kind"], facts["path_characters"]),
                         ("classified", "owned-cache-lock", len(path)))
        self.assertNotIn("private", json.dumps(facts))

    def test_path_threshold_uses_decoded_length_and_invalid_literals_are_unavailable(self):
        prefix = "C:\\owned-test\\controlled-model-cache\\datasets\\"
        for length in (259, 260):
            path = prefix + "x" * (length - len(prefix) - 5) + ".lock"
            facts = worker.training_failure_facts(self.failed(str(FileNotFoundError(2, "Missing", path))), self.cache)
            self.assertEqual(facts["path_characters"], length)
            self.assertEqual(facts["windows_legacy_path_limit_exceeded"], length >= 260)
        for literal in ("'C:/private\\nsecret'", "'C:/private\\x00secret'", "'C:/private' + malicious() + 'secret'", "'C:/private\\xZZ'"):
            facts = worker.training_failure_facts(self.failed("[Errno 2] Missing: " + literal), self.cache)
            self.assertEqual(facts["status"], "unavailable")

    def test_windows_threshold_counts_utf16_units_for_astral_characters(self):
        prefix = "C:\\owned-test\\controlled-model-cache\\datasets\\"
        for units in (259, 260):
            path = prefix + "x" * (units - len(prefix) - 7) + "\U0001f9ea.lock"
            self.assertEqual(len(path.encode("utf-16-le")) // 2, units)
            facts = worker.training_failure_facts(self.failed(str(FileNotFoundError(2, "Missing", path))), self.cache)
            self.assertEqual(facts["path_characters"], units - 1)
            self.assertEqual(facts["windows_path_utf16_units"], units)
            self.assertEqual(facts["windows_legacy_path_limit_exceeded"], units >= 260)

    def test_unknown_nested_oversized_and_noncanonical_messages_stay_unavailable(self):
        for message in (None, {}, "", "x" * 16385, "synthetic-secret-token", "Nested: [Errno 2] Missing: 'C:/secret'",
                        "[Errno 999] Missing: 'C:/secret'", "[WinError 999] Missing: 'C:/secret'",
                        "[Errno 2] Missing: 'relative/secret'", "[Errno 2] Missing: 'C:/owned-test/../secret'",
                        "[Errno 2] Missing: 'C:/secret'\nprivate"):
            facts = worker.training_failure_facts(self.failed(message), self.cache)
            self.assertEqual(facts["status"], "unavailable")
            self.assertIsNone(facts["error_number"])
            self.assertIsNone(facts["path_characters"])
            self.assertNotIn("secret", json.dumps(facts))

    def test_custom_mappings_strings_and_fields_are_not_evaluated(self):
        class DangerousDict(dict):
            def get(self, *_): raise AssertionError("custom get evaluated")
        class DangerousString(str):
            def __eq__(self, _): raise AssertionError("custom equality evaluated")
        class Dangerous:
            def __eq__(self, _): raise AssertionError("custom equality evaluated")
            def __str__(self): raise AssertionError("custom stringify evaluated")
        variants = [DangerousDict(), None, Dangerous(), {"error": DangerousDict()},
                    {"error": {"code": Dangerous()}}, {"error": {"code": DangerousString("training_failed")}},
                    self.failed(DangerousString("private")), self.failed(Dangerous(), stage=Dangerous()),
                    {"error": {"code": "training_failed", "details": DangerousDict()}}]
        for value in variants:
            self.assertEqual(worker.training_failure_facts(value, self.cache)["status"], "unavailable")

    def test_exclusive_fixed_leaf_is_bounded_and_never_overwritten(self):
        with tempfile.TemporaryDirectory(prefix="training-failure-facts-") as folder:
            cache = Path(folder).resolve()
            result = self.failed("synthetic-secret-token C:/private/path")
            worker.write_training_failure_facts(result, cache)
            target = cache / "qualification-training-failure.json"
            before = target.read_bytes()
            self.assertLessEqual(len(before), 1024)
            self.assertNotIn(b"synthetic-secret-token", before)
            self.assertNotIn(b"C:/private", before)
            with self.assertRaises(FileExistsError): worker.write_training_failure_facts(result, cache)
            self.assertEqual(target.read_bytes(), before)
            self.assertEqual([file.name for file in cache.iterdir()], [target.name])

    def test_missing_or_relative_cache_is_denied_without_creation(self):
        with tempfile.TemporaryDirectory(prefix="training-failure-missing-") as folder:
            missing = Path(folder).resolve() / "missing"
            for cache in (missing, Path("relative-cache")):
                with self.assertRaises(ValueError): worker.write_training_failure_facts(self.failed("private"), cache)
            self.assertFalse(missing.exists())

    def test_one_failed_dispatch_preserves_result_identity_even_when_observer_fails(self):
        fixture = TrainingQualificationWorkerTests();fixture.setUp()
        result = self.failed("synthetic-private")
        observed = []
        def observer(actual):
            observed.append(actual)
            raise OSError("synthetic-private-observer-error")
        dispatch = worker.single_training_dispatch(lambda _: result, fixture.fixture, fixture.model, fixture.temp,
                                                   lambda *_: None, observer)
        self.assertIs(dispatch(fixture.request), result)
        self.assertIs(observed[0], result)
        with self.assertRaises(ValueError): dispatch(fixture.request)
        self.assertEqual(len(observed), 1)
        self.assertEqual(result, self.failed("synthetic-private"))

    def test_success_cancellation_nonresults_and_malformed_status_do_not_observe(self):
        fixture = TrainingQualificationWorkerTests();fixture.setUp()
        class Dangerous:
            def __eq__(self, _): raise AssertionError("status equality evaluated")
        for result in ({"status": "completed"}, {"status": "cancelled"}, {"status": Dangerous()}, "original", None):
            observed=[]
            dispatch = worker.single_training_dispatch(lambda _: result, fixture.fixture, fixture.model, fixture.temp,
                                                       lambda *_: None, observed.append)
            self.assertIs(dispatch(fixture.request), result)
            self.assertEqual(observed, [])

    def test_rejected_request_and_raised_original_never_invoke_observer(self):
        fixture = TrainingQualificationWorkerTests();fixture.setUp();observed=[];calls=[]
        dispatch = worker.single_training_dispatch(lambda _: calls.append(True), fixture.fixture, fixture.model, fixture.temp,
                                                   lambda *_: None, observed.append)
        fixture.request.taskType = "foreign"
        with self.assertRaises(ValueError): dispatch(fixture.request)
        self.assertEqual((calls,observed),([],[]))
        fixture.request.taskType = "train-model"
        error=RuntimeError("synthetic-private")
        def fail(_): raise error
        dispatch = worker.single_training_dispatch(fail, fixture.fixture, fixture.model, fixture.temp,
                                                   lambda *_: None, observed.append)
        with self.assertRaises(RuntimeError) as actual: dispatch(fixture.request)
        self.assertIs(actual.exception,error)
        self.assertEqual(observed,[])


if __name__ == "__main__": unittest.main()
