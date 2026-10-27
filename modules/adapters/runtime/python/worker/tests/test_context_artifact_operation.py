from __future__ import annotations

import hashlib
import json
from pathlib import Path
import stat
import tempfile
import unittest
from unittest.mock import patch
from zipfile import ZIP_DEFLATED, ZipFile, ZipInfo

from modules.adapters.runtime.python.worker.models import (
    ContextArtifactOperationTaskRequest,
    ContextGenerationTaskRequest,
)
from modules.adapters.runtime.python.worker.tasks.context_artifact_operation import (
    ContextArtifactOperationCancellationRequested,
    operate_on_context_artifact,
)
from modules.adapters.runtime.python.worker.tasks.context_generation import (
    RAG_MEDIA_TYPE,
    generate_context_artifact,
)


def _digest(value: bytes) -> str:
    return "sha256:" + hashlib.sha256(value).hexdigest()


class ContextArtifactOperationTests(unittest.TestCase):
    def test_query_placement_is_transient_and_manifest_cannot_select_a_device(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            path, _ = self._generate(root, "rag-database")
            rewritten = root / "injected.lancedb.zip"
            with ZipFile(path) as archive, ZipFile(rewritten, "w", ZIP_DEFLATED) as target:
                for entry in archive.infolist():
                    content = archive.read(entry.filename)
                    if entry.filename == "manifest.json":
                        manifest = json.loads(content)
                        manifest["embedding"]["device"] = "cuda"
                        content = json.dumps(manifest).encode()
                    target.writestr(entry, content)
            for hint, expected in [(None, "cpu"), ("cuda", "cuda"), ("auto", "auto")]:
                observed = []
                def embed(texts, settings):
                    observed.append((settings.modelId, settings.device))
                    return [[1.0, 0.0] for _ in texts]
                request = self._operation(root, rewritten, RAG_MEDIA_TYPE, "query", query="release", maximumResults=3, **({"embeddingDevice": hint} if hint else {}))
                result = operate_on_context_artifact(request, embedding_provider=embed)
                self.assertEqual(len(result["matches"]), 1)
                self.assertEqual(observed, [("sentence-transformers/all-MiniLM-L6-v2", expected)])
                self.assertEqual(list(root.glob(".rag-lancedb-read-*")), [])
            with self.assertRaisesRegex(ValueError, "only valid for retrieval"):
                operate_on_context_artifact(self._operation(root, rewritten, RAG_MEDIA_TYPE, "inspect-artifact", embeddingDevice="cuda"))
            with self.assertRaises(ValueError):
                self._operation(root, rewritten, RAG_MEDIA_TYPE, "query", query="release", embeddingDevice="cuda:1")

    def test_cancelled_validation_removes_private_materialization_before_retry(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            path, _result = self._generate(root, "rag-database")
            request = self._operation(root, path, RAG_MEDIA_TYPE, "query", query="policy", maximumResults=3)
            checks = 0

            def cancel_during_scan():
                nonlocal checks
                checks += 1
                if checks == 3:
                    self.assertTrue(list(root.glob(".rag-lancedb-read-*")))
                    raise ContextArtifactOperationCancellationRequested("cancelled")

            def forbidden_embedding(*_args):
                self.fail("Cancelled validation must not start embedding or search.")

            with self.assertRaises(ContextArtifactOperationCancellationRequested):
                operate_on_context_artifact(request, cancellation_check=cancel_during_scan, embedding_provider=forbidden_embedding)
            self.assertEqual(list(root.glob(".rag-lancedb-read-*")), [])
            result = operate_on_context_artifact(request, embedding_provider=lambda texts, _settings: [[1.0, 0.0] for _ in texts])
            self.assertEqual(len(result["matches"]), 1)
            self.assertEqual(list(root.glob(".rag-lancedb-read-*")), [])

    def _generate(
        self,
        root: Path,
        kind: str,
    ) -> tuple[Path, dict[str, object]]:
        source_bytes = b"# Release policy\n\nVerify each build before release."
        source = root / "source.md"
        source.write_bytes(source_bytes)
        request: dict[str, object] = {
            "workspaceId": "workspace.test",
            "kind": kind,
            "name": "Release context",
            "sources": [{
                "artifactId": "artifact.source",
                "localPath": str(source),
                "mediaType": "text/markdown",
                "originalName": "source.md",
                "sourceDigest": _digest(source_bytes),
                "sizeBytes": len(source_bytes),
            }],
            "manualEntries": [],
            "chunking": {
                "strategy": "section",
                "chunkCharacters": 256,
                "overlapCharacters": 0,
            },
            "runtime": {"runtimeWorkingDirectory": str(root)},
        }
        if kind == "rag-database":
            request["sources"][0]["sourceInformation"] = {
                "author": "Release team",
                "license": "Internal use",
                "language": "en",
            }
            request["chunking"] = {
                "strategy": "topic-aware",
                "chunkCharacters": 1_200,
                "overlapCharacters": 0,
                "maximumTokensPerChunk": 320,
                "topicBoundarySensitivity": 0.22,
            }
            request["embedding"] = {
                "provider": "transformers",
                "modelId": "sentence-transformers/all-MiniLM-L6-v2",
            }
            request["sourceChecks"] = {
                "preset": "recommended",
                "allowedLanguages": ["en"],
                "requireLicenseMetadata": True,
                "requireConsentMetadata": False,
                "includeSourceAttribution": True,
            }
        else:
            request["chunking"] = {
                "strategy": "topic-aware",
                "chunkCharacters": 1_200,
                "overlapCharacters": 0,
                "maximumTokensPerChunk": 320,
                "topicBoundarySensitivity": 0.22,
            }
            request["contextPack"] = {
                "inputMode": "source-materials",
                "method": "none",
                "cleaningPreset": "standard",
            }
        result = generate_context_artifact(
            ContextGenerationTaskRequest.model_validate(request),
            embedding_provider=(
                (lambda texts, _settings: [[1.0, 0.0] for _text in texts])
                if kind == "rag-database"
                else None
            ),
        )
        return root / result["output"]["outputHandle"], result

    def _operation(
        self,
        root: Path,
        path: Path,
        media_type: str,
        operation: str,
        **extra: object,
    ) -> ContextArtifactOperationTaskRequest:
        content = path.read_bytes()
        return ContextArtifactOperationTaskRequest.model_validate({
            "workspaceId": "workspace.test",
            "operation": operation,
            "artifactId": "artifact.context",
            "localPath": str(path),
            "mediaType": media_type,
            "digest": _digest(content),
            "sizeBytes": len(content),
            "runtime": {"runtimeWorkingDirectory": str(root)},
            **extra,
        })

    def test_inspects_and_queries_rag_with_exact_citations(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            path, result = self._generate(root, "rag-database")
            inspected = operate_on_context_artifact(
                self._operation(
                    root,
                    path,
                    RAG_MEDIA_TYPE,
                    "inspect-artifact",
                )
            )
            self.assertEqual(
                inspected["inspection"]["manifest"]["name"],
                "Release context",
            )
            self.assertEqual(inspected["inspection"]["chunkCount"], 1)
            self.assertEqual(
                inspected["inspection"]["manifest"]["chunking"],
                {
                    "strategy": "topic-aware",
                    "chunkCharacters": 1_200,
                    "overlapCharacters": 0,
                    "maximumTokensPerChunk": 320,
                    "topicBoundarySensitivity": 0.22,
                },
            )
            self.assertEqual(
                inspected["inspection"]["manifest"]["sources"][0][
                    "sourceInformation"
                ]["author"],
                "Release team",
            )
            self.assertEqual(
                inspected["inspection"]["manifest"]["sourceChecks"]["preset"],
                "recommended",
            )
            queried = operate_on_context_artifact(
                self._operation(
                    root,
                    path,
                    RAG_MEDIA_TYPE,
                    "query",
                    query="What is the release policy?",
                    maximumResults=3,
                ),
                embedding_provider=lambda texts, _settings: [
                    [1.0, 0.0] for _text in texts
                ],
            )
            self.assertEqual(len(queried["matches"]), 1)
            self.assertEqual(
                queried["matches"][0]["citation"]["sourceArtifactId"],
                "artifact.source",
            )
            self.assertNotIn("embedding", queried["matches"][0])
            self.assertEqual(
                result["output"]["digest"],
                _digest(path.read_bytes()),
            )

    def test_inspects_fixed_context_pack_topics_and_entries(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            path, _result = self._generate(root, "markdown-context-pack")
            inspected = operate_on_context_artifact(
                self._operation(
                    root,
                    path,
                    "application/vnd.ai-system-builder.markdown-context-pack+zip",
                    "inspect-artifact",
                )
            )
            detail = inspected["inspection"]
            self.assertEqual(
                detail["packageEntries"],
                ["README.md", "manifest.json", "sources.md", "topics.md"],
            )
            self.assertGreaterEqual(len(detail["topics"]), 1)
            self.assertTrue(detail["topics"][0]["citations"])

    def test_generated_source_pack_preserves_reserved_summary_lines_and_reopens(self):
        from modules.adapters.runtime.python.worker.tasks.context_generation import _write_context_pack, ContextChunk
        source = "# Source\n\n## Nested section\n\nA useful fact.\nSources: untrusted-footer\n\n```markdown\n## Example\nSources: example-footer\n```"
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            path, _result = self._generate(root, "markdown-context-pack")
            with ZipFile(path) as archive:
                manifest = json.loads(archive.read("manifest.json"))
            # Use the production writer with a fixed topic seam; no model runs.
            request = ContextGenerationTaskRequest.model_validate({"workspaceId": "workspace.test", "kind": "markdown-context-pack",
                "name": manifest["name"], "sources": [], "manualEntries": [], "chunking": manifest["chunking"],
                "contextPack": {"inputMode": "source-materials", "method": "none", "cleaningPreset": "standard"},
                "runtime": {"runtimeWorkingDirectory": str(root)}})
            chunk = ContextChunk(id="source:0", text=source, citation={"sourceArtifactId": "artifact.source", "sourceDigest": "sha256:" + "a" * 64, "chunkIndex": 0})
            _write_context_pack(path, request, [chunk], [{"title": "Useful topic", "summary": source, "citationIds": [chunk.id]}], manifest)
            before = path.read_bytes()
            detail = operate_on_context_artifact(self._operation(root, path,
                "application/vnd.ai-system-builder.markdown-context-pack+zip", "inspect-artifact"))["inspection"]
            self.assertEqual(len(detail["topics"]), 1)
            self.assertEqual(detail["topics"][0]["citations"], ["artifact.source#chunk-0"])
            self.assertEqual(detail["topics"][0]["summary"], source)
            with ZipFile(path) as archive:
                self.assertIn(source, archive.read("sources.md").decode())
                self.assertEqual(json.loads(archive.read("manifest.json")), manifest)
            self.assertEqual(path.read_bytes(), before)
            for title in ("first\n## forged", "first\rSources: forged", "first\u2028second", "first\n", "first\r", "first\u2028", " "):
                with self.assertRaisesRegex(ValueError, "title"):
                    _write_context_pack(path, request, [chunk], [{"title": title, "summary": source, "citationIds": [chunk.id]}], manifest)
            self.assertEqual(path.read_bytes(), before)

    def test_framed_topics_keep_exact_unicode_multitopic_markdown_and_legacy_compatibility(self):
        from modules.adapters.runtime.python.worker.tasks.context_artifact_operation import _parse_topics
        from modules.adapters.runtime.python.worker.tasks.context_generation import TOPICS_FRAMED_HEADER
        summaries = ["# Café\n\n## Inner\nSources: body text\n```markdown\n## Example\nSources: example\n```",
            "Second résumé 🙂\n\n## Another heading\nA separate fact."]
        body = TOPICS_FRAMED_HEADER + "\n\n".join(f"## Topic {i}\n\n<!-- ai-system-builder:summary-characters:{len(summary)} -->\n\n{summary}\n\nSources: artifact.source#chunk-{i}" for i, summary in enumerate(summaries))
        parsed = _parse_topics(body, 32)
        self.assertEqual(parsed, [{"title": f"Topic {i}", "summary": summary, "citations": [f"artifact.source#chunk-{i}"]} for i, summary in enumerate(summaries)])
        self.assertEqual(_parse_topics("# Topics\n\n## Legacy topic\n\nUnchanged legacy summary.\n\nSources: artifact.source#chunk-0", 32),
            [{"title": "Legacy topic", "summary": "Unchanged legacy summary.", "citations": ["artifact.source#chunk-0"]}])
        with self.assertRaises(ValueError): _parse_topics(body, 1)
        with self.assertRaises(ValueError): _parse_topics(body, 32, 1)

    def test_framed_topic_parser_refuses_bad_counts_footers_trailing_and_unsupported_frames(self):
        from modules.adapters.runtime.python.worker.tasks.context_artifact_operation import _parse_topics
        from modules.adapters.runtime.python.worker.tasks.context_generation import TOPICS_FRAMED_HEADER
        body = TOPICS_FRAMED_HEADER + "## Topic\n\n<!-- ai-system-builder:summary-characters:4 -->\n\nFact\n\nSources: artifact.source#chunk-0"
        for changed in [body.replace(":4 -->", f":{count} -->") for count in (0, -1, 3, 5, 64001, 999999)] + [
            body.replace("topics-framed-v1", "topics-framed-v9"), body.replace("Sources: ", "Source: "),
            "\n" + body.replace(":4 -->", ":3 -->"), body.replace("# Topics", "# Changed heading"),
            body.replace("topics-framed-v1 -->", "topics-framed-v1"),
            body.replace("<!-- ai-system-builder:topics-framed-v1 -->\n\n", ""),
            body.replace("## Topic\n", "## Topic\u2028\n"),
            body + "\nextra", body + "\n\n## Incomplete", body.replace("## Topic\n", "## Topic\nInjected\n"),
            body.replace("artifact.source#chunk-0", ""), body.replace("artifact.source#chunk-0", "x" * 641),
            body.replace("artifact.source#chunk-0", ", ".join(["source"] * 11)),
            body.replace("Fact", "    "), TOPICS_FRAMED_HEADER]:
            with self.subTest(changed=changed[:130]), self.assertRaises(ValueError): _parse_topics(changed, 32)

    def test_rejects_no_summary_pack_manifest_with_model_id(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            path, _result = self._generate(root, "markdown-context-pack")
            with ZipFile(path) as archive:
                entries = {
                    name: archive.read(name)
                    for name in archive.namelist()
                }
            manifest = json.loads(entries["manifest.json"])
            manifest["contextPack"]["modelId"] = "local/unexpected-model"
            entries["manifest.json"] = json.dumps(manifest).encode("utf-8")
            tampered = root / "tampered-context-pack.zip"
            with ZipFile(tampered, "w") as archive:
                for name, content in entries.items():
                    archive.writestr(name, content)

            with self.assertRaisesRegex(ValueError, "manifest"):
                operate_on_context_artifact(
                    self._operation(
                        root,
                        tampered,
                        "application/vnd.ai-system-builder.markdown-context-pack+zip",
                        "inspect-artifact",
                    )
                )

    def test_source_inspection_reuses_only_valid_persisted_lineage(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            valid = [{
                "chunkIndex": 3,
                "text": "An authoritative saved chunk.",
                "sourceArtifactId": "original.source",
                "sourceLineage": {
                    "sourceArtifactId": "original.source",
                    "normalizedStart": 0,
                    "normalizedEnd": 29,
                },
            }]
            path = root / "prepared.json"
            path.write_text(json.dumps(valid), encoding="utf-8")
            inspected = operate_on_context_artifact(
                self._operation(
                    root,
                    path,
                    "application/json",
                    "inspect-source",
                    originalName="prepared.json",
                    chunking={
                        "strategy": "fixed-length",
                        "chunkCharacters": 256,
                        "overlapCharacters": 0,
                    },
                )
            )
            self.assertTrue(inspected["inspection"]["alreadyChunked"])
            invalid = [{
                **valid[0],
                "sourceLineage": {
                    "sourceArtifactId": "different.source",
                    "normalizedStart": 0,
                    "normalizedEnd": 29,
                },
            }]
            path.write_text(json.dumps(invalid), encoding="utf-8")
            inspected_invalid = operate_on_context_artifact(
                self._operation(
                    root,
                    path,
                    "application/json",
                    "inspect-source",
                    originalName="prepared.json",
                    chunking={
                        "strategy": "fixed-length",
                        "chunkCharacters": 256,
                        "overlapCharacters": 0,
                    },
                )
            )
            self.assertFalse(
                inspected_invalid["inspection"]["alreadyChunked"]
            )

    def test_source_inspection_reports_blocked_rag_data_rules(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            path = root / "source.md"
            path.write_text(
                "Release verification requires a passing build and reviewer.",
                encoding="utf-8",
            )
            inspected = operate_on_context_artifact(
                self._operation(
                    root,
                    path,
                    "text/markdown",
                    "inspect-source",
                    originalName="source.md",
                    chunking={
                        "strategy": "topic-aware",
                        "chunkCharacters": 1_200,
                        "overlapCharacters": 0,
                        "maximumTokensPerChunk": 320,
                        "topicBoundarySensitivity": 0.22,
                    },
                    sourceInformation={"language": "en"},
                    sourceChecks={
                        "preset": "recommended",
                        "allowedLanguages": ["en"],
                        "requireLicenseMetadata": True,
                        "requireConsentMetadata": False,
                        "includeSourceAttribution": True,
                    },
                )
            )
            result = inspected["inspection"]
            self.assertFalse(result["ready"])
            self.assertEqual(result["textFields"], [])
            self.assertEqual(result["checks"]["status"], "blocked")
            self.assertEqual(
                result["checks"]["issueCounts"]["licenseMetadataMissing"],
                1,
            )

    def test_rejects_digest_mismatch_and_wrong_media_type(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            path, _result = self._generate(root, "rag-database")
            request = self._operation(
                root,
                path,
                "application/vnd.ai-system-builder.markdown-context-pack+zip",
                "inspect-artifact",
            )
            with self.assertRaisesRegex(ValueError, "pack"):
                operate_on_context_artifact(request)
            invalid = request.model_copy(
                update={"digest": "sha256:" + ("0" * 64)}
            )
            with self.assertRaisesRegex(ValueError, "descriptor"):
                operate_on_context_artifact(invalid)

    def test_rejects_legacy_sqlite_rag_media_type(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            path, _result = self._generate(root, "rag-database")
            with self.assertRaisesRegex(ValueError, "supported context"):
                operate_on_context_artifact(
                    self._operation(
                        root,
                        path,
                        "application/vnd.ai-system-builder.rag-database+sqlite3",
                        "inspect-artifact",
                    )
                )

    def test_rejects_rag_package_traversal_and_links_without_writing_outside(
        self,
    ) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            path, _result = self._generate(root, "rag-database")
            with ZipFile(path) as archive:
                entries = {
                    name: archive.read(name) for name in archive.namelist()
                }

            traversal = root / "traversal.lancedb.zip"
            with ZipFile(
                traversal, "w", compression=ZIP_DEFLATED
            ) as archive:
                for name, content in entries.items():
                    archive.writestr(name, content)
                archive.writestr("database/../../outside.txt", b"escape")
            with self.assertRaisesRegex(ValueError, "package structure"):
                operate_on_context_artifact(
                    self._operation(
                        root,
                        traversal,
                        RAG_MEDIA_TYPE,
                        "inspect-artifact",
                    )
                )
            self.assertFalse((root / "outside.txt").exists())

            linked = root / "linked.lancedb.zip"
            with ZipFile(linked, "w", compression=ZIP_DEFLATED) as archive:
                for name, content in entries.items():
                    archive.writestr(name, content)
                info = ZipInfo("database/link")
                info.create_system = 3
                info.external_attr = (stat.S_IFLNK | 0o777) << 16
                archive.writestr(info, b"target")
            with self.assertRaisesRegex(ValueError, "package structure"):
                operate_on_context_artifact(
                    self._operation(
                        root,
                        linked,
                        RAG_MEDIA_TYPE,
                        "inspect-artifact",
                    )
                )
            self.assertEqual(
                list(root.glob(".rag-lancedb-read-*")), []
            )

    def test_rejects_rag_manifest_dimension_mismatch_and_expansion_limit(
        self,
    ) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            path, _result = self._generate(root, "rag-database")
            with ZipFile(path) as archive:
                entries = {
                    name: archive.read(name) for name in archive.namelist()
                }
                entry_infos = {
                    name: archive.getinfo(name) for name in archive.namelist()
                }
            manifest = json.loads(entries["manifest.json"])
            manifest["embedding"]["dimensions"] = 3
            entries["manifest.json"] = json.dumps(manifest).encode("utf-8")
            tampered = root / "dimension-mismatch.lancedb.zip"
            with ZipFile(
                tampered, "w", compression=ZIP_DEFLATED
            ) as archive:
                for name, content in entries.items():
                    archive.writestr(entry_infos[name], content)
            with self.assertRaisesRegex(ValueError, "table schema"):
                operate_on_context_artifact(
                    self._operation(
                        root,
                        tampered,
                        RAG_MEDIA_TYPE,
                        "inspect-artifact",
                    )
                )

            with patch(
                "modules.adapters.runtime.python.worker.tasks."
                "context_artifact_operation.MAX_RAG_PACKAGE_EXPANDED_BYTES",
                1,
            ):
                with self.assertRaisesRegex(ValueError, "safe limit"):
                    operate_on_context_artifact(
                        self._operation(
                            root,
                            path,
                            RAG_MEDIA_TYPE,
                            "inspect-artifact",
                        )
                    )
            self.assertEqual(list(root.glob(".rag-lancedb-read-*")), [])


if __name__ == "__main__":
    unittest.main()
