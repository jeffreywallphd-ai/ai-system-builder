from __future__ import annotations

import hashlib
import json
from pathlib import Path
import tempfile
import unittest
from zipfile import ZipFile

from modules.adapters.runtime.python.worker.models import (
    ContextArtifactOperationTaskRequest,
    ContextGenerationTaskRequest,
)
from modules.adapters.runtime.python.worker.tasks.context_artifact_operation import (
    operate_on_context_artifact,
)
from modules.adapters.runtime.python.worker.tasks.context_generation import (
    generate_context_artifact,
)


def _digest(value: bytes) -> str:
    return "sha256:" + hashlib.sha256(value).hexdigest()


class ContextArtifactOperationTests(unittest.TestCase):
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
                    "application/vnd.ai-system-builder.rag-database+sqlite3",
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
                    "application/vnd.ai-system-builder.rag-database+sqlite3",
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


if __name__ == "__main__":
    unittest.main()
