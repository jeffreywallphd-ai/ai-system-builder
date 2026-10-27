import copy
import importlib.util
import json
import hashlib
import io
from pathlib import Path
from types import SimpleNamespace as NS
import tempfile
import unittest
import zipfile
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

    def row_review_payload(self):
        fixed = fixture.row_review_fixture()
        payload = copy.deepcopy(self.payload)
        payload.output.format = "parquet"
        payload.sourceInputs[0].originalName = fixed["source_name"]
        Path(payload.sourceInputs[0].localPath).write_bytes(fixture.row_review_csv(fixed))
        return payload

    def test_fixed_parquet_case_requires_exact_declared_source_and_keeps_jsonl_separate(self):
        payload = self.row_review_payload()
        fixture.validate_provided(payload, self.root)
        for field, value in [("originalName", "synthetic-provided.csv"), ("mediaType", "application/pdf")]:
            altered = copy.deepcopy(payload); setattr(altered.sourceInputs[0], field, value)
            with self.assertRaises(ValueError): fixture.validate_provided(altered, self.root)
        payload.output.format = "jsonl"
        with self.assertRaises(ValueError): fixture.validate_provided(payload, self.root)

    def test_parquet_case_refuses_changed_empty_large_or_additional_rows(self):
        payload = self.row_review_payload(); source = Path(payload.sourceInputs[0].localPath)
        expected = source.read_bytes()
        for raw in [b"", b"x" * 16385, expected.replace(b"invoice", b"changed", 1), expected + b"Unexpected row,invoice\n"]:
            source.write_bytes(raw)
            with self.subTest(size=len(raw)), self.assertRaises(ValueError): fixture.validate_provided(payload, self.root)

    def test_parquet_case_still_refuses_generation_ocr_other_tasks_and_extra_sources(self):
        payload = self.row_review_payload()
        for change in [lambda p: setattr(p.preparation, "generationMode", "task-examples"),
                       lambda p: p.recipe.task.update(textInputMode="generate"),
                       lambda p: p.recipe.task.update(taskType="llm-instruction"),
                       lambda p: setattr(p.recipe, "generation", {}),
                       lambda p: setattr(p, "advanced", NS(content=NS(ocrEnabled=True))),
                       lambda p: setattr(p, "sourceInputs", p.sourceInputs * 2)]:
            altered = copy.deepcopy(payload); change(altered)
            with self.assertRaises(ValueError): fixture.validate_provided(altered, self.root)

    def test_row_fixture_schema_rows_and_csv_fields_are_closed(self):
        fixed = fixture.row_review_fixture()
        for change in [lambda p: p.update(extra=True), lambda p: p.update(source_name="other.csv"),
                       lambda p: p.update(edit_suffix="different"), lambda p: p.update(rows=p["rows"][:-1]),
                       lambda p: p["rows"][0].update(text="line\nbreak"),
                       lambda p: p["rows"][0].update(text="unexpected,comma"),
                       lambda p: p["rows"][0].update(text="x" * 257),
                       lambda p: p["rows"][0].update(label="unknown"),
                       lambda p: p["rows"][0].update(extra="unsupported"),
                       lambda p: p["rows"].__setitem__(0, p["rows"][1])]:
            altered = copy.deepcopy(fixed); change(altered)
            with self.assertRaises(ValueError): fixture.validate_row_review_fixture(altered)

    def test_new_parquet_source_does_not_open_a_known_multiple_link_file(self):
        payload = self.row_review_payload(); fixed = fixture.row_review_fixture()
        with patch.object(fixture, "row_review_fixture", return_value=fixed), \
                patch.object(fixture.Path, "lstat", return_value=NS(st_nlink=2)), \
                patch.object(fixture.Path, "open", side_effect=AssertionError("A multiple-link source must not be opened.")):
            with self.assertRaises(ValueError): fixture.validate_fixed_row_review_source(payload.sourceInputs[0])

    def test_actual_model_free_processor_writes_the_fixed_parquet_rows(self):
        import pyarrow.parquet as pq
        from modules.adapters.runtime.python.worker.models import PrepareTrainingDatasetRequest
        from modules.adapters.runtime.python.worker.tasks.prepare_training_dataset import prepare_training_dataset
        fixed = fixture.row_review_fixture(); payload = self.row_review_payload()
        source = payload.sourceInputs[0]; original = Path(source.localPath).read_bytes()
        typed = PrepareTrainingDatasetRequest.model_validate({
            "sourceInputs": [{**vars(source), "artifactId": "artifact.fixed-row-review"}],
            "preparation": {**vars(payload.preparation), "schemaVersion": "1"},
            "recipe": {"task": {**payload.recipe.task, "textField": "text", "labelField": "label"}},
            "split": {"trainRatio": 0.75, "validationRatio": 0, "testRatio": 0.25, "shuffle": False},
            "output": {"format": "parquet"},
        })
        fixture.validate_provided(typed, self.root)
        outputs = self.root / "outputs"; outputs.mkdir()
        def deny(*_args, **_kwargs): self.fail("Provided rows must not request a model, OCR or generated text.")
        with patch("modules.adapters.runtime.python.worker.tasks.prepare_training_dataset.ensure_generation_model_is_available", side_effect=deny):
            result = prepare_training_dataset(typed, text_value_generator=deny, output_directory=outputs)
        self.assertEqual(result.summary.datasetRowCount, 8)
        self.assertLessEqual(len(result.outputs), 8)
        for output in result.outputs:
            candidate = Path(output.tempPath)
            self.assertEqual(candidate.resolve().parent, outputs.resolve())
            self.assertFalse(candidate.is_symlink())
            self.assertLessEqual(candidate.stat().st_size, 65536)
        dataset = next(output for output in result.outputs if output.role == "dataset")
        actual = pq.read_table(dataset.tempPath).to_pylist()
        self.assertEqual([{key: row[key] for key in ("text", "label")} for row in actual], fixed["rows"])
        self.assertEqual(actual, [{**row, "sourceArtifactId": "artifact.fixed-row-review", "sourceRowIndex": index, "split": "train"}
            for index, row in enumerate(fixed["rows"])])
        self.assertEqual(Path(source.localPath).read_bytes(), original)

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
        with patch.object(fixture, "fixed_context_embeddings", side_effect=lambda *_: self.fail("Manual packs must not use embeddings.")):
            generated = fixture.run_context_fixture(typed, self.root, generate_context_artifact)
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
        result = fixture.run_context_operation_fixture(request, self.root, operate_on_context_artifact)["inspection"]
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

    def source_context_payload(self, rag=True):
        from modules.adapters.runtime.python.worker.models import ContextGenerationTaskRequest
        fixed = fixture.source_context_fixture()
        directory = self.root / ("ai-system-builder-context-Rag123" if rag else "ai-system-builder-context-Pack123")
        directory.mkdir()
        source = directory / "source-0000.md"
        raw = fixed["source_markdown"].encode("utf-8"); source.write_bytes(raw)
        return ContextGenerationTaskRequest.model_validate({
            "workspaceId": "workspace.synthetic", "kind": "rag-database" if rag else "markdown-context-pack",
            "name": fixed["rag_name" if rag else "pack_name"], "manualEntries": [],
            "sources": [{"artifactId": "artifact.synthetic-source", "localPath": str(source),
                "originalName": fixed["source_name"], "mediaType": "text/markdown", "sizeBytes": len(raw),
                "sourceDigest": "sha256:" + fixed["source_sha256"]}],
            "chunking": {"strategy": "fixed-length", "chunkCharacters": 128, "overlapCharacters": 0,
                "maximumChunks": 10000} if rag else {"strategy": "topic-aware", "chunkCharacters": 1200,
                "overlapCharacters": 0, "maximumTokensPerChunk": 320, "topicBoundarySensitivity": 0.22, "maximumChunks": 10000},
            "sourceChecks": {"preset": "recommended", "allowedLanguages": ["en"], "requireLicenseMetadata": False,
                "requireConsentMetadata": False, "includeSourceAttribution": True} if rag else None,
            "embedding": {"provider": "transformers", "modelId": fixed["embedding_model"], "device": "cpu", "batchSize": 16} if rag else None,
            "contextPack": None if rag else {"inputMode": "source-materials", "method": "none", "cleaningPreset": "standard"},
            "runtime": {"runtimeWorkingDirectory": str(directory)},
        })

    def source_operation(self, raw, media_type, operation="inspect-artifact", **extra):
        from modules.adapters.runtime.python.worker.models import ContextArtifactOperationTaskRequest
        directory = self.root / "ai-system-builder-context-operation-Source123"
        directory.mkdir(exist_ok=True); source = directory / "input.bin"; source.write_bytes(raw)
        return ContextArtifactOperationTaskRequest.model_validate({"workspaceId": "workspace.synthetic",
            "operation": operation, "artifactId": "artifact.synthetic-package", "localPath": str(source),
            "mediaType": media_type, "sizeBytes": len(raw), "digest": "sha256:" + hashlib.sha256(raw).hexdigest(),
            "runtime": {"runtimeWorkingDirectory": str(directory)}, **extra})

    def test_actual_source_pack_and_lance_query_use_production_processors_without_models(self):
        from modules.adapters.runtime.python.worker.tasks.context_generation import generate_context_artifact
        from modules.adapters.runtime.python.worker.tasks.context_artifact_operation import operate_on_context_artifact
        fixed = fixture.source_context_fixture()
        def deny(*_a, **_kw): self.fail("The fixed worker must not load an embedding model.")
        with patch("modules.adapters.runtime.python.worker.tasks.context_generation._embed_with_transformers", side_effect=deny), \
                patch("modules.adapters.runtime.python.worker.tasks.context_artifact_operation._embed_with_transformers", side_effect=deny):
            for rag in (False, True):
                with self.subTest(rag=rag):
                    typed = self.source_context_payload(rag); source = Path(typed.sources[0].localPath)
                    generated = fixture.run_context_fixture(typed, self.root, generate_context_artifact)
                    raw = (Path(typed.runtime.runtimeWorkingDirectory) / generated["output"]["outputHandle"]).read_bytes()
                    request = self.source_operation(raw, generated["output"]["mediaType"])
                    result = fixture.run_context_operation_fixture(request, self.root, operate_on_context_artifact)["inspection"]
                    self.assertEqual(result["manifest"]["name"], typed.name)
                    self.assertEqual(result["manifest"]["sources"][0]["digest"], "sha256:" + fixed["source_sha256"])
                    self.assertEqual(result["manifest"]["sources"][0]["artifactId"], typed.sources[0].artifactId)
                    self.assertGreaterEqual(result["chunkCount"], 1)
                    if not rag:
                        with zipfile.ZipFile(io.BytesIO(raw)) as archive:
                            entries = {info.filename: archive.read(info) for info in archive.infolist()}
                        for changed in ({"name": "other"}, {"sources": []},
                                        {"contextPack": {"inputMode": "source-materials", "method": "local-model", "cleaningPreset": "standard"}}):
                            manifest = json.loads(entries["manifest.json"]); manifest.update(changed)
                            output = io.BytesIO()
                            with zipfile.ZipFile(output, "w") as archive:
                                for name, value in entries.items():
                                    archive.writestr(name, json.dumps(manifest).encode() if name == "manifest.json" else value)
                            altered = self.source_operation(output.getvalue(), generated["output"]["mediaType"])
                            with self.assertRaises(ValueError):
                                fixture.run_context_operation_fixture(altered, self.root,
                                    lambda *_a, **_kw: self.fail("A different pack reached the processor."))
                    if rag:
                        self.assertEqual(result["manifest"]["embedding"]["dimensions"], 384)
                        query = request.model_copy(update={"operation": "query", "query": fixed["query"], "maximumResults": 5, "embeddingDevice": "cpu"})
                        for changed in ({"query": "unrelated question"}, {"maximumResults": 6}, {"embeddingDevice": "cuda"},
                                        {"sizeBytes": 512 * 1024 + 1}, {"digest": "sha256:" + "0" * 64},
                                        {"mediaType": "application/zip"}, {"chunking": typed.chunking},
                                        {"operation": "inspect-artifact", "query": fixed["query"]}):
                            with self.subTest(changed=changed), self.assertRaises(ValueError):
                                fixture.run_context_operation_fixture(query.model_copy(update=changed), self.root,
                                    lambda *_a, **_kw: self.fail("Denied query reached the processor."))
                        matches = fixture.run_context_operation_fixture(query, self.root, operate_on_context_artifact)["matches"]
                        self.assertTrue(1 <= len(matches) <= 5)
                        self.assertIn(fixed["query_answer"], matches[0]["excerpt"])
                        self.assertEqual(matches[0]["score"], 1)
                        self.assertEqual(matches[0]["citation"]["sourceArtifactId"], typed.sources[0].artifactId)
                        self.assertEqual(matches[0]["citation"]["sourceDigest"], "sha256:" + fixed["source_sha256"])
                        self.assertEqual(Path(request.localPath).read_bytes(), raw)
                        with zipfile.ZipFile(io.BytesIO(raw)) as archive:
                            entries = {info.filename: archive.read(info) for info in archive.infolist()}
                        for changed in ({"name": "other"}, {"embedding": {"provider": "transformers", "modelId": "other/model", "dimensions": 384}},
                                        {"sources": []}, {"manualEntries": [{"id": "other"}]}):
                            manifest = json.loads(entries["manifest.json"]); manifest.update(changed)
                            output = io.BytesIO()
                            with zipfile.ZipFile(output, "w") as archive:
                                for name, value in entries.items():
                                    archive.writestr(name, json.dumps(manifest).encode() if name == "manifest.json" else value)
                            with self.assertRaises(ValueError): fixture.validate_fixed_rag_package(output.getvalue(), fixed)
                    self.assertEqual(source.read_bytes(), fixed["source_markdown"].encode("utf-8"))

    def test_actual_source_inspection_is_bounded_and_model_free(self):
        from modules.adapters.runtime.python.worker.tasks.context_artifact_operation import operate_on_context_artifact
        typed = self.source_context_payload(); fixed = fixture.source_context_fixture()
        request = self.source_operation(fixed["source_markdown"].encode(), "text/markdown", "inspect-source",
            originalName=fixed["source_name"], chunking=typed.chunking.model_dump(exclude_none=True),
            sourceChecks=typed.sourceChecks.model_dump())
        result = fixture.run_context_operation_fixture(request, self.root, operate_on_context_artifact)["inspection"]
        self.assertTrue(result["ready"]); self.assertGreater(result["chunkCount"], 1)
        for changed in ({"query": fixed["query"]}, {"embeddingDevice": "cuda"}, {"originalName": "other.md"},
                        {"digest": "sha256:" + "0" * 64}, {"sizeBytes": 1}, {"localPath": typed.sources[0].localPath}):
            with self.subTest(changed=changed), self.assertRaises(ValueError):
                fixture.run_context_operation_fixture(request.model_copy(update=changed), self.root,
                    lambda *_a, **_kw: self.fail("Denied source inspection reached the processor."))

    def test_source_generation_admission_refuses_other_bytes_settings_models_and_roles(self):
        typed = self.source_context_payload()
        changes = [lambda p: setattr(p, "name", "other"), lambda p: setattr(p.embedding, "device", "cuda"),
            lambda p: setattr(p.embedding, "modelId", "other/model"), lambda p: setattr(p.embedding, "batchSize", 32),
            lambda p: setattr(p.chunking, "chunkCharacters", 256), lambda p: setattr(p.sourceChecks, "allowedLanguages", ["fr"]),
            lambda p: setattr(p.sources[0], "sourceDigest", "sha256:" + "0" * 64),
            lambda p: setattr(p.sources[0], "originalName", "other.md"), lambda p: setattr(p.sources[0], "sizeBytes", 1),
            lambda p: setattr(p.sources[0], "localPath", str(self.root / "source.csv")), lambda p: p.sources.append(p.sources[0])]
        for change in changes:
            altered = typed.model_copy(deep=True); change(altered)
            with self.assertRaises(ValueError):
                fixture.run_context_fixture(altered, self.root, lambda *_a, **_kw: self.fail("Denied generation reached the processor."))
        Path(typed.sources[0].localPath).write_text("Changed synthetic text", encoding="utf-8")
        with self.assertRaises(ValueError): fixture.validate_source_context(typed, self.root)

    def test_source_pack_admission_refuses_local_model_and_manual_input(self):
        typed = self.source_context_payload(False)
        for changed in ({"method": "local-model"}, {"inputMode": "manual"}, {"cleaningPreset": "strict"}, {"maximumSummaryLines": 8}):
            altered = typed.model_copy(deep=True)
            altered.contextPack = altered.contextPack.model_copy(update=changed)
            with self.assertRaises(ValueError): fixture.validate_source_context(altered, self.root)

    def test_finite_embeddings_refuse_other_text_models_devices_and_unbounded_inputs(self):
        typed = self.source_context_payload(); fixed = fixture.source_context_fixture()
        vector = fixture.fixed_context_embeddings([fixed["query"]], typed.embedding)[0]
        self.assertEqual(len(vector), 384); self.assertEqual(sum(vector), 1)
        for texts in (["unrelated text"], [fixed["query"]] * 9, [], ["x" * 2049], [None]):
            with self.assertRaises(ValueError): fixture.fixed_context_embeddings(texts, typed.embedding)
        for change in ({"modelId": "other/model"}, {"device": "cuda"}, {"dimensions": 768}, {"batchSize": 2}):
            with self.assertRaises(ValueError): fixture.fixed_context_embeddings([fixed["query"]], typed.embedding.model_copy(update=change))

    def test_fixed_source_reader_refuses_alias_large_and_multiple_link_before_open(self):
        typed = self.source_context_payload(); source = Path(typed.sources[0].localPath)
        with patch.object(fixture.Path, "lstat", return_value=NS(st_mode=0o100600, st_dev=1, st_ino=1,
                st_size=245, st_mtime_ns=1, st_nlink=2)), \
                patch.object(fixture.Path, "open", side_effect=AssertionError("Multiple links must not be opened.")):
            with self.assertRaises(ValueError): fixture.stable_fixture_bytes(source, 2048)
        source.write_bytes(b"x" * 2049)
        with self.assertRaises(ValueError): fixture.stable_fixture_bytes(source, 2048)

    def test_fixed_rag_package_refuses_traversal_links_duplicates_expansion_and_other_manifest(self):
        fixed = fixture.source_context_fixture()
        def package(rows):
            output = io.BytesIO()
            with zipfile.ZipFile(output, "w", zipfile.ZIP_DEFLATED) as archive:
                for name, value in rows: archive.writestr(name, value)
            return output.getvalue()
        link = zipfile.ZipInfo("database/link"); link.external_attr = 0o120777 << 16
        for rows in ([('manifest.json', '{}')], [('manifest.json', '{}'), ('../escape', 'x')],
                     [('manifest.json', '{}'), ('database/x', 'x' * (2 * 1024 * 1024))],
                     [('manifest.json', '{}' * 9000), ('database/x', 'x')],
                     [('manifest.json', '{}'), (link, 'x')],
                     [('manifest.json', '{}'), ('database/x', 'x')],
                     [('manifest.json', '{}'), ('database//x', 'x')]):
            with self.assertRaises(ValueError): fixture.validate_fixed_rag_package(package(rows), fixed)


if __name__ == "__main__": unittest.main()
