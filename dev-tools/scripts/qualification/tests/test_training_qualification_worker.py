"""Finite inert dispatch tests: no production import, model or process launch."""
import copy
import importlib.util
from pathlib import Path
from types import SimpleNamespace
import unittest

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


if __name__ == "__main__": unittest.main()
