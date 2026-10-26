import copy
import importlib.util
import json
import hashlib
from pathlib import Path
from types import SimpleNamespace as NS
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("provided_fixture", Path(__file__).resolve().parents[1] / "visual-composer/provided-dataset-qualification-worker.py")
fixture = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fixture)


class ProvidedDatasetQualificationTests(unittest.TestCase):
    def setUp(self):
        self.folder = tempfile.TemporaryDirectory()
        self.addCleanup(self.folder.cleanup)
        self.root = Path(self.folder.name).resolve()
        source = self.root / "source.csv"
        source.write_text("text,label\nSynthetic invoice,invoice\n", encoding="utf-8")
        self.payload = NS(preparation=NS(method="validate-and-split", generationMode="none",
            inputIntent="use-existing-dataset", sourceKinds=["structured"]),
            recipe=NS(task={"taskType": "llm-classification", "textInputMode": "provided"},
                generation=None, normalization=None, chunking=None), advanced=None,
            sourceInputs=[NS(localPath=str(source), mediaType="text/csv", originalName="synthetic-provided.csv")],
            output=NS(format="jsonl"))

    def test_fixed_provided_payload_is_admitted_without_model_import(self):
        fixture.validate_provided(self.payload, self.root)

    def test_generation_ocr_other_tasks_and_unbounded_sources_are_denied(self):
        for target, key, value in [
            ("preparation", "method", "fixed-length"), ("preparation", "generationMode", "task-examples"),
            ("preparation", "inputIntent", "create-from-source-material"), ("preparation", "sourceKinds", ["document"]),
            ("recipe", "generation", {}), ("recipe", "normalization", {}), ("recipe", "chunking", {}),
            ("output", "format", "parquet"),
        ]:
            payload = copy.deepcopy(self.payload)
            setattr(getattr(payload, target), key, value)
            with self.subTest(key=key), self.assertRaises(ValueError): fixture.validate_provided(payload, self.root)
        for change in [lambda p: setattr(p, "advanced", NS(content=NS(ocrEnabled=True))),
                       lambda p: setattr(p, "sourceInputs", p.sourceInputs * 2),
                       lambda p: p.recipe.task.update(textInputMode="generate"),
                       lambda p: p.recipe.task.update(taskType="llm-instruction"),
                       lambda p: setattr(p.sourceInputs[0], "originalName", "untrusted.csv")]:
            payload = copy.deepcopy(self.payload); change(payload)
            with self.assertRaises(ValueError): fixture.validate_provided(payload, self.root)

    def test_external_missing_directory_empty_large_or_alias_sources_are_denied(self):
        source = Path(self.payload.sourceInputs[0].localPath)
        for candidate in [self.root.parent / "outside.csv", self.root / "missing", self.root,
                          self.root / "child/../source.csv"]:
            payload = copy.deepcopy(self.payload); payload.sourceInputs[0].localPath = str(candidate)
            with self.assertRaises((ValueError, OSError)): fixture.validate_provided(payload, self.root)
        for size in (0, 16_385):
            source.write_bytes(b"x" * size)
            with self.assertRaises(ValueError): fixture.validate_provided(self.payload, self.root)

    def test_only_the_four_fixed_task_types_are_admitted(self):
        for name in ("prepare-training-dataset", "review-dataset", "generate-context-artifact", "context-artifact-operation"): fixture.dispatch_allowed(NS(taskType=name))
        for name in ("generate-text", "download-model", "train-lora", "", None):
            with self.assertRaises(ValueError): fixture.dispatch_allowed(NS(taskType=name))

    def context_payload(self):
        value = fixture.manual_fixture()
        directory = self.root / "ai-system-builder-context-Abc123"
        directory.mkdir()
        return NS(workspaceId="workspace.synthetic", kind="markdown-context-pack", name=value["name"], sources=[], embedding=None,
            manualEntries=[NS(id="manual-entry-1", title=value["name"], content=value["markdown"],
                digest="sha256:" + hashlib.sha256(value["markdown"].encode()).hexdigest())],
            contextPack=NS(inputMode="manual", method="none", model=None),
            chunking=NS(strategy="structure-aware", chunkCharacters=1200, overlapCharacters=120, maximumChunks=10000),
            runtime=NS(runtimeWorkingDirectory=str(directory)))

    def test_fixed_manual_payload_runs_real_pack_generation_and_inspection_without_a_model(self):
        from modules.adapters.runtime.python.worker.models import ContextGenerationTaskRequest, ContextArtifactOperationTaskRequest
        from modules.adapters.runtime.python.worker.tasks.context_generation import generate_context_artifact, PACK_MEDIA_TYPE
        from modules.adapters.runtime.python.worker.tasks.context_artifact_operation import operate_on_context_artifact
        payload = self.context_payload()
        value = json.loads(json.dumps(payload, default=vars))
        typed = ContextGenerationTaskRequest.model_validate(value)
        fixture.validate_manual_context(typed, self.root)
        generated = generate_context_artifact(typed, embedding_provider=lambda *_: self.fail("Manual packs must not use embeddings."))
        raw = (Path(typed.runtime.runtimeWorkingDirectory) / generated["output"]["outputHandle"]).read_bytes()
        operation_root = self.root / "ai-system-builder-context-operation-Abc123"
        operation_root.mkdir()
        source = operation_root / "input.bin"
        source.write_bytes(raw)
        request = ContextArtifactOperationTaskRequest.model_validate({"workspaceId": payload.workspaceId,
            "operation": "inspect-artifact", "artifactId": "artifact.synthetic", "localPath": str(source),
            "mediaType": PACK_MEDIA_TYPE, "digest": "sha256:" + hashlib.sha256(raw).hexdigest(), "sizeBytes": len(raw),
            "runtime": {"runtimeWorkingDirectory": str(operation_root)}})
        fixture.validate_manual_inspection(request, self.root)
        result = operate_on_context_artifact(request)["inspection"]
        self.assertEqual(result["chunkCount"], 1)
        self.assertEqual(result["manifest"]["name"], payload.name)
        self.assertEqual(result["manifest"]["manualEntries"][0]["digest"], payload.manualEntries[0].digest)

    def test_fixed_manual_context_requires_exact_bytes_and_no_model_or_source(self):
        payload = self.context_payload()
        fixture.validate_manual_context(payload, self.root)
        changes = [lambda p: setattr(p, "kind", "rag-database"), lambda p: setattr(p, "name", "other"),
            lambda p: p.sources.append({}), lambda p: setattr(p, "embedding", {}),
            lambda p: p.manualEntries.clear(), lambda p: p.manualEntries.append(copy.deepcopy(p.manualEntries[0])),
            lambda p: setattr(p.manualEntries[0], "content", "synthetic changed content"),
            lambda p: setattr(p.manualEntries[0], "digest", "sha256:" + "0" * 64),
            lambda p: setattr(p.contextPack, "method", "local-model"), lambda p: setattr(p.contextPack, "model", NS(modelId="unavailable/model"))]
        for change in changes:
            altered = copy.deepcopy(payload); change(altered)
            with self.assertRaises(ValueError): fixture.validate_manual_context(altered, self.root)

    def test_context_directory_must_be_current_regular_immediate_and_correct_role(self):
        payload = self.context_payload()
        for value in [self.root, self.root.parent / "outside", self.root / "ai-system-builder-context-operation-Abc123",
                      self.root / "nested/ai-system-builder-context-Abc123", self.root / "ai-system-builder-context-missing"]:
            altered = copy.deepcopy(payload); altered.runtime.runtimeWorkingDirectory = str(value)
            with self.assertRaises((ValueError, OSError)): fixture.validate_manual_context(altered, self.root)

    def test_unowned_or_wrong_role_context_paths_are_denied_before_resolution(self):
        for directory in [self.root.parent / "ai-system-builder-context-Abc123", self.root / "unexpected", self.root / "ai-system-builder-context-operation-Abc123"]:
            payload = NS(runtime=NS(runtimeWorkingDirectory=str(directory)))
            with patch.object(fixture.Path, "resolve", side_effect=AssertionError("Unowned paths must not be resolved.")):
                with self.assertRaises(ValueError): fixture.regular_context_directory(payload, self.root)

    def test_context_temp_uses_only_existing_fixed_native_operator_bindings(self):
        candidate = self.root / ".local-codex/q/1234abcd/c"
        candidate.mkdir(parents=True)
        temporary = candidate.parent / "t"
        temporary.mkdir()
        run = candidate / ".local-codex/native-fixed-host-operator/runs" / ("a" * 32)
        environment = {"TEMP": str(temporary), "TMP": str(temporary), "AISB_LOCAL_DESKTOP_UI_RUN": str(run)}
        with patch.dict(fixture.os.environ, environment):
            self.assertEqual(fixture.context_temp_root(candidate), temporary)
            for key in environment:
                with patch.dict(fixture.os.environ, {key: str(self.root)}), self.assertRaises(ValueError):
                    fixture.context_temp_root(candidate)

    def test_manual_inspection_refuses_query_rag_external_and_large_input(self):
        directory = self.root / "ai-system-builder-context-operation-Abc123"
        directory.mkdir()
        source = directory / "input.bin"
        source.write_bytes(b"synthetic bounded package")
        payload = NS(operation="inspect-artifact", mediaType="application/vnd.ai-system-builder.markdown-context-pack+zip",
            query=None, maximumResults=None, embeddingDevice=None, chunking=None, sourceChecks=None, sourceInformation=None,
            runtime=NS(runtimeWorkingDirectory=str(directory)), localPath=str(source), sizeBytes=source.stat().st_size)
        fixture.validate_manual_inspection(payload, self.root)
        for field, value in [("operation", "query"), ("mediaType", "application/vnd.ai-system-builder.rag-database+lancedb+zip"),
                             ("query", "synthetic query"), ("embeddingDevice", "cuda"), ("localPath", str(self.root / "source.csv")), ("sizeBytes", 16385)]:
            altered = copy.deepcopy(payload); setattr(altered, field, value)
            with self.assertRaises(ValueError): fixture.validate_manual_inspection(altered, self.root)
        source.write_bytes(b"x" * 16385)
        with self.assertRaises(ValueError): fixture.validate_manual_inspection(payload, self.root)

    def test_failure_facts_are_closed_exclusive_and_bounded(self):
        fixture.write_failure_fact(self.root, "preparation", ValueError("private input must not be written"), 1)
        files = list(self.root.glob("qualification-provided-failure-*.json"))
        self.assertEqual(len(files), 1)
        raw = files[0].read_text(encoding="utf-8")
        self.assertNotIn("private", raw); self.assertLess(len(raw), 4096)
        self.assertEqual(json.loads(raw)["type"], "ValueError")
        with self.assertRaises(FileExistsError): fixture.write_failure_fact(self.root, "preparation", ValueError(), 1)
        for boundary, sequence in (("unknown", 2), ("task", 0), ("task", 17), ("task", True)):
            with self.assertRaises(ValueError): fixture.write_failure_fact(self.root, boundary, ValueError(), sequence)


if __name__ == "__main__": unittest.main()
