from __future__ import annotations

import json
import shutil
import stat
from contextlib import contextmanager
from unittest.mock import patch
import sys
import tempfile
import types
import unittest
from pathlib import Path

from modules.adapters.runtime.python.worker.models import TrainModelTaskRequest
from modules.adapters.runtime.python.worker.tasks.train_model_multimodal import (
    _apply_vision_lora,
    _resolve_vision_lora_modules_to_save,
    _resolve_vision_lora_target_modules,
    load_manifest_bundle,
    resolve_manifest_asset_path,
    staged_source_artifact_paths,
    train_vision_model,
)


class _FakeParameter:
    def __init__(self, count: int, requires_grad: bool = True) -> None:
        self._count = count
        self.requires_grad = requires_grad

    def numel(self) -> int:
        return self._count


class _FakeVisionModel:
    def __init__(self, module_names: list[str]) -> None:
        self._module_names = module_names
        self._parameters = [_FakeParameter(8, True), _FakeParameter(24, False)]

    def named_modules(self):
        return [(name, object()) for name in self._module_names]

    def parameters(self):
        return self._parameters


class TrainModelMultimodalTaskTests(unittest.TestCase):
    def _vision_request(self, tmp_path: Path, method: str = "lora") -> TrainModelTaskRequest:
        dataset_path = tmp_path / "manifest.jsonl"
        dataset_path.write_text('{"image":"image.png","label":"cat"}\n', encoding="utf-8")
        return TrainModelTaskRequest.model_validate(
            {
                "trainingTask": "vision-classification",
                "baseModel": {"modelId": "org/base"},
                "datasets": [
                    {"artifactId": "dataset-1", "splitRole": "train", "path": str(dataset_path), "format": "jsonl"},
                ],
                "method": method,
                "commonParameters": {},
                "advancedParameters": {"lora": {"rank": 12, "alpha": 24, "dropout": 0.1}},
                "output": {"outputModelName": "demo"},
            }
        )


    @contextmanager
    def _owned_split_fixture(self):
        parent = Path(tempfile.gettempdir()).resolve()
        root = Path(tempfile.mkdtemp(prefix="image-training-splits-", dir=parent)).resolve()
        before = root.lstat()
        try:
            yield root
        finally:
            after = root.lstat()
            self.assertEqual(root.parent, parent)
            self.assertEqual(root.resolve(), root)
            self.assertTrue(stat.S_ISDIR(after.st_mode))
            self.assertFalse(root.is_symlink())
            self.assertFalse(getattr(after, "st_file_attributes", 0) & 0x400)
            self.assertEqual((after.st_dev, after.st_ino), (before.st_dev, before.st_ino))
            shutil.rmtree(root)

    def test_selected_test_manifest_is_not_inspected_or_promoted(self):
        for present in [False, True]:
            with self.subTest(file_exists=present), self._owned_split_fixture() as root:
                payload = self._vision_request(root)
                test_path = root / "heldout.jsonl"
                if present:
                    test_path.write_text('{"image":"heldout.png","label":"synthetic","split":"train"}\n', encoding="utf-8")
                payload.datasets.append(payload.datasets[0].model_copy(update={
                    "artifactId": "heldout-test", "splitRole": "test", "path": str(test_path)}))
                original_exists = Path.exists
                checked = []

                def exists(candidate):
                    checked.append(candidate)
                    if candidate == test_path:
                        raise AssertionError("Held-out test paths cannot enter training inspection.")
                    return original_exists(candidate)

                with patch.object(Path, "exists", autospec=True, side_effect=exists):
                    bundle = load_manifest_bundle(payload)
                self.assertEqual(len(bundle.train_rows), 1)
                self.assertEqual(bundle.validation_rows, [])
                self.assertNotIn(test_path, checked)

    def test_training_selection_is_required_before_manifest_io(self):
        for role in ["validation", "test"]:
            with self.subTest(role=role), self._owned_split_fixture() as root:
                payload = self._vision_request(root)
                payload.datasets[0] = payload.datasets[0].model_copy(update={"splitRole": role})
                with patch.object(Path, "exists", side_effect=AssertionError("No manifest IO without a training selection.")):
                    with self.assertRaisesRegex(ValueError, "At least one train split dataset row"):
                        load_manifest_bundle(payload)

    def test_validation_rows_cannot_override_the_file_role_to_train(self):
        with self._owned_split_fixture() as root:
            payload = self._vision_request(root)
            validation = root / "validation.jsonl"
            validation.write_text('{"image":"validation.png","label":"synthetic","split":"train"}\n'
                                  '{"image":"test.png","label":"synthetic","split":"test"}\n', encoding="utf-8")
            payload.datasets.append(payload.datasets[0].model_copy(update={
                "artifactId": "validation", "splitRole": "validation", "path": str(validation)}))
            bundle = load_manifest_bundle(payload)
            self.assertEqual([row["image"] for row in bundle.train_rows], ["image.png"])
            self.assertEqual([row["image"] for row in bundle.validation_rows], ["validation.png"])

    def test_unknown_dataset_roles_deny_before_file_or_source_map_inspection(self):
        with self._owned_split_fixture() as root:
            payload = self._vision_request(root)
            payload.datasets[0] = payload.datasets[0].model_copy(update={"splitRole": "unknown"})
            for function in [load_manifest_bundle, staged_source_artifact_paths]:
                with self.subTest(function=function.__name__):
                    with patch.object(Path, "exists", side_effect=AssertionError("Unknown roles cannot inspect files.")):
                        with self.assertRaisesRegex(ValueError, "Unsupported training dataset split role"):
                            function(payload)

    def test_unknown_reserved_row_split_values_are_not_silently_promoted(self):
        for value in ["unrecognized", True, 7, [], {}]:
            with self.subTest(value=value), self._owned_split_fixture() as root:
                payload = self._vision_request(root)
                Path(payload.datasets[0].path).write_text(json.dumps({"image": "synthetic.png", "label": "synthetic", "split": value}) + "\n", encoding="utf-8")
                with self.assertRaisesRegex(ValueError, "Unsupported training manifest split role"):
                    load_manifest_bundle(payload)

    def test_missing_empty_and_normalized_supported_row_splits_keep_valid_routing(self):
        with self._owned_split_fixture() as root:
            payload = self._vision_request(root)
            values = [None, "", "  ", "TRAIN", "validation", " VaLiDaTiOn ", "test", " TEST "]
            Path(payload.datasets[0].path).write_text("".join(json.dumps({
                "image": str(index) + ".png", "label": "synthetic", "split": value}) + "\n" for index, value in enumerate(values)), encoding="utf-8")
            bundle = load_manifest_bundle(payload)
            self.assertEqual([row["image"] for row in bundle.train_rows], ["0.png", "1.png", "2.png", "3.png"])
            self.assertEqual([row["image"] for row in bundle.validation_rows], ["4.png", "5.png"])

    def test_test_source_maps_cannot_shadow_training_images_and_validation_maps_stay(self):
        with self._owned_split_fixture() as root:
            payload = self._vision_request(root)
            good, heldout, validation = root / "training.png", root / "test.png", root / "validation.png"
            payload.datasets[0].metadata = {"stagedSourceArtifactPaths": {"training-image": str(good)}}
            payload.datasets.append(payload.datasets[0].model_copy(update={
                "artifactId": "validation", "splitRole": "validation",
                "metadata": {"sourceArtifactPaths": {"validation-image": str(validation)}}}))
            payload.datasets.append(payload.datasets[0].model_copy(update={
                "artifactId": "test", "splitRole": "test",
                "metadata": {"stagedSourceArtifactPaths": {"training-image": str(heldout)},
                             "sourceArtifactPaths": {"heldout-image": str(heldout)}}}))
            self.assertEqual(staged_source_artifact_paths(payload), {"training-image": good, "validation-image": validation})


    def test_conflicting_source_ids_refuse_instead_of_selecting_a_later_path(self):
        for scope in ["same-dataset-fields", "two-train-files", "train-and-validation", "different-case"]:
            with self.subTest(scope=scope), self._owned_split_fixture() as root:
                payload = self._vision_request(root)
                original = str(root / "image.png")
                conflicting = str(root / ("IMAGE.png" if scope == "different-case" else "validation.png"))
                payload.datasets[0].metadata = {"stagedSourceArtifactPaths": {"shared-image": original}}
                if scope == "same-dataset-fields":
                    payload.datasets[0].metadata["sourceArtifactPaths"] = {"shared-image": conflicting}
                else:
                    payload.datasets.append(payload.datasets[0].model_copy(update={
                        "artifactId": "second-file",
                        "splitRole": "train" if scope == "two-train-files" else "validation",
                        "metadata": {"sourceArtifactPaths": {"shared-image": conflicting}}}))
                with patch.object(Path, "resolve", side_effect=AssertionError("Metadata conflicts cannot adopt filesystem aliases.")):
                    with self.assertRaisesRegex(ValueError, "Conflicting training source artifact paths"):
                        staged_source_artifact_paths(payload)

    def test_repeated_exact_source_bindings_remain_supported_without_file_probes(self):
        with self._owned_split_fixture() as root:
            payload = self._vision_request(root)
            original, validation = str(root / "image.png"), str(root / "validation.png")
            payload.datasets[0].metadata = {"stagedSourceArtifactPaths": {"shared-image": original},
                                            "sourceArtifactPaths": {"shared-image": original}}
            payload.datasets.append(payload.datasets[0].model_copy(update={
                "artifactId": "validation", "splitRole": "validation",
                "metadata": {"sourceArtifactPaths": {"shared-image": original, "validation-image": validation}}}))
            with patch.object(Path, "resolve", side_effect=AssertionError("No filesystem identity or byte authority is inferred.")):
                with patch.object(Path, "stat", side_effect=AssertionError("No file inspection is required.")):
                    self.assertEqual(staged_source_artifact_paths(payload),
                                     {"shared-image": Path(original), "validation-image": Path(validation)})

    def test_staged_source_paths_resolve_manifest_artifact_ids(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            image_path = root / "image.png"
            image_path.write_bytes(b"image")
            dataset_path = root / "manifest.jsonl"
            dataset_path.write_text('{"image":"artifact-image-1","caption":"demo"}\n', encoding="utf-8")
            payload = TrainModelTaskRequest.model_validate(
                {
                    "trainingTask": "diffusion-lora",
                    "baseModel": {"modelId": "org/base"},
                    "datasets": [
                        {
                            "artifactId": "dataset-1",
                            "splitRole": "train",
                            "path": str(dataset_path),
                            "format": "jsonl",
                            "metadata": {"stagedSourceArtifactPaths": {"artifact-image-1": str(image_path)}},
                        }
                    ],
                    "method": "lora",
                    "commonParameters": {},
                    "output": {"outputModelName": "demo"},
                }
            )

            source_paths = staged_source_artifact_paths(payload)
            resolved = resolve_manifest_asset_path("artifact-image-1", dataset_path, source_paths)

            self.assertEqual(resolved, image_path)

    def test_load_manifest_bundle_respects_dataset_and_row_splits(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            train_path = root / "train.json"
            train_path.write_text(json.dumps([{"image": "a.png", "label": "cat"}, {"image": "b.png", "label": "dog", "split": "validation"}]), encoding="utf-8")
            validation_path = root / "validation.jsonl"
            validation_path.write_text('{"image":"c.png","label":"bird"}\n', encoding="utf-8")
            payload = TrainModelTaskRequest.model_validate(
                {
                    "trainingTask": "vision-classification",
                    "baseModel": {"modelId": "org/base"},
                    "datasets": [
                        {"artifactId": "train", "splitRole": "train", "path": str(train_path), "format": "json"},
                        {"artifactId": "validation", "splitRole": "validation", "path": str(validation_path), "format": "jsonl"},
                    ],
                    "method": "full-finetune",
                    "commonParameters": {},
                    "output": {"outputModelName": "demo"},
                }
            )

            bundle = load_manifest_bundle(payload)

            self.assertEqual(len(bundle.train_rows), 1)
            self.assertEqual(len(bundle.validation_rows), 2)

    def test_vision_lora_target_modules_default_to_model_attention_names(self) -> None:
        model = _FakeVisionModel([
            "vit.encoder.layer.0.attention.attention.query",
            "vit.encoder.layer.0.attention.attention.value",
            "classifier",
        ])

        target_modules = _resolve_vision_lora_target_modules(model)

        self.assertEqual(target_modules, ["query", "value"])

    def test_vision_lora_target_modules_reject_unmatched_explicit_names(self) -> None:
        model = _FakeVisionModel(["encoder.layer.0.attention.query", "classifier"])

        with self.assertRaisesRegex(ValueError, "not found"):
            _resolve_vision_lora_target_modules(model, ["missing_projection"])

    def test_vision_lora_modules_to_save_include_task_head(self) -> None:
        model = _FakeVisionModel(["encoder.layer.0.attention.query", "classifier"])

        modules_to_save = _resolve_vision_lora_modules_to_save(model, "vision-classification")

        self.assertEqual(modules_to_save, ["classifier"])

    def test_apply_vision_lora_builds_peft_config_and_metadata(self) -> None:
        captured: dict[str, object] = {}

        class FakeLoraConfig:
            def __init__(self, **kwargs) -> None:
                captured["config"] = kwargs

        def fake_get_peft_model(model, _config):
            captured["model"] = model
            return model

        previous_peft = sys.modules.get("peft")
        sys.modules["peft"] = types.SimpleNamespace(LoraConfig=FakeLoraConfig, get_peft_model=fake_get_peft_model)
        try:
            with tempfile.TemporaryDirectory() as tmp:
                model = _FakeVisionModel(["encoder.layer.0.attention.query", "encoder.layer.0.attention.value", "classifier"])
                request = self._vision_request(Path(tmp))

                result_model, metadata = _apply_vision_lora(model, request, "vision-classification")
        finally:
            if previous_peft is None:
                sys.modules.pop("peft", None)
            else:
                sys.modules["peft"] = previous_peft

        self.assertIs(result_model, captured["model"])
        self.assertEqual(captured["config"], {
            "r": 12,
            "lora_alpha": 24,
            "lora_dropout": 0.1,
            "bias": "none",
            "target_modules": ["query", "value"],
            "modules_to_save": ["classifier"],
        })
        self.assertEqual(metadata["targetModules"], ["query", "value"])
        self.assertEqual(metadata["modulesToSave"], ["classifier"])
        self.assertEqual(metadata["trainableParameterCount"], 8)

    def test_vision_training_rejects_qlora_before_loading_dependencies(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            payload = self._vision_request(root, method="qlora")

            result = train_vision_model(
                payload,
                training_task="vision-classification",
                run_id="run-1",
                output_path=root / "out",
                output_model_name="demo",
            )

            self.assertEqual(result.status, "failed")
            self.assertIn("lora and full-finetune", result.error["message"])


if __name__ == "__main__":
    unittest.main()
