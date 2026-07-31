from __future__ import annotations

import json
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
