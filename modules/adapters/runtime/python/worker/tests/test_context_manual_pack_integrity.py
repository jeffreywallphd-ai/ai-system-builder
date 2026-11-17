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
from modules.adapters.runtime.python.worker.tasks.context_artifact_operation import operate_on_context_artifact
from modules.adapters.runtime.python.worker.tasks.context_generation import PACK_MEDIA_TYPE, generate_context_artifact


def digest(raw: bytes) -> str:
    return "sha256:" + hashlib.sha256(raw).hexdigest()


class ContextManualPackIntegrityTests(unittest.TestCase):
    def setUp(self) -> None:
        temporary = tempfile.TemporaryDirectory(prefix="context-manual-integrity-")
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name).resolve()
        self.sequence = 0

    def generate(self, markdown: str = "# Synthetic policy\r\n\r\nKeep the selected review result.\n") -> Path:
        self.sequence += 1
        payload = ContextGenerationTaskRequest.model_validate({
            "workspaceId": "workspace.test", "kind": "markdown-context-pack",
            "name": f"Manual integrity {self.sequence}", "sources": [],
            "manualEntries": [{"id": "manual-entry-1", "title": "Synthetic policy", "content": markdown, "digest": digest(markdown.encode("utf-8"))}],
            "chunking": {"strategy": "structure-aware", "chunkCharacters": 1200, "overlapCharacters": 120},
            "contextPack": {"inputMode": "manual", "method": "none"},
            "runtime": {"runtimeWorkingDirectory": str(self.root)},
        })
        result = generate_context_artifact(payload)
        return self.root / result["output"]["outputHandle"]

    def rewrite(self, path: Path, change) -> Path:
        with ZipFile(path) as archive:
            members = {name: archive.read(name) for name in archive.namelist()}
        manifest = json.loads(members["manifest.json"])
        change(members, manifest)
        members["manifest.json"] = json.dumps(manifest).encode("utf-8")
        output = self.root / f"changed-{self.sequence}.zip"
        with ZipFile(output, "w") as archive:
            for name, raw in members.items():
                archive.writestr(name, raw)
        return output

    def inspect(self, path: Path):
        raw = path.read_bytes()
        # Recompute the correct outer package digest. The inner contradiction
        # must be denied even when the existing catalog-byte check succeeds.
        request = ContextArtifactOperationTaskRequest.model_validate({
            "workspaceId": "workspace.test", "operation": "inspect-artifact",
            "artifactId": "artifact.context", "localPath": str(path),
            "mediaType": PACK_MEDIA_TYPE, "digest": digest(raw), "sizeBytes": len(raw),
            "runtime": {"runtimeWorkingDirectory": str(self.root)},
        })
        return operate_on_context_artifact(request)

    def assert_denied(self, path: Path) -> None:
        with self.assertRaises(ValueError) as rejected:
            self.inspect(path)
        message = str(rejected.exception)
        self.assertNotIn("synthetic-private-content", message)
        self.assertNotIn(str(self.root), message)
        self.assertNotIn("sha256:", message)

    def test_valid_manual_bytes_keep_unicode_and_original_line_endings(self) -> None:
        for markdown in ["# Policy\n\nKeep **this** text.\n", "# Policy\r\n\r\nKeep café and 東京.\r\n", "# Policy\n\n```text\nSynthetic example\n```\n"]:
            with self.subTest(markdown=markdown):
                path = self.generate(markdown)
                result = self.inspect(path)["inspection"]
                self.assertEqual(result["chunkCount"], 1)
                self.assertEqual(result["packageEntries"], ["README.md", "context.md", "manifest.json"])
                self.assertEqual(result["manifest"]["manualEntries"][0]["digest"], digest(markdown.encode("utf-8")))
                with ZipFile(path) as archive:
                    self.assertEqual(archive.read("context.md"), markdown.encode("utf-8"))

    def test_substituted_content_is_denied_with_a_valid_outer_digest(self) -> None:
        path = self.rewrite(self.generate(), lambda members, _manifest: members.update({"context.md": b"# synthetic-private-content\nChanged instructions.\n"}))
        self.assert_denied(path)

    def test_line_ending_substitution_is_not_an_exact_byte_match(self) -> None:
        path = self.rewrite(self.generate(), lambda members, _manifest: members.update({"context.md": members["context.md"].replace(b"\r\n", b"\n")}))
        self.assert_denied(path)

    def test_stale_manual_digest_is_denied_without_echoing_it(self) -> None:
        path = self.rewrite(self.generate(), lambda _members, manifest: manifest["manualEntries"][0].update(digest="sha256:" + "0" * 64))
        self.assert_denied(path)

    def test_missing_manual_entry_is_denied(self) -> None:
        self.assert_denied(self.rewrite(self.generate(), lambda _members, manifest: manifest.update(manualEntries=[])))

    def test_multiple_manual_entries_are_denied(self) -> None:
        def change(_members, manifest):
            manifest["manualEntries"].append({**manifest["manualEntries"][0], "id": "manual-entry-2"})
        self.assert_denied(self.rewrite(self.generate(), change))

    def test_source_artifacts_are_not_valid_manual_pack_lineage(self) -> None:
        def change(_members, manifest):
            manifest["sources"] = [{"artifactId": "artifact.synthetic", "digest": digest(b"source"), "mediaType": "text/plain", "sizeBytes": 6, "chunkCount": 1, "chunkingMode": "extracted"}]
        self.assert_denied(self.rewrite(self.generate(), change))

    def test_matching_digest_does_not_bypass_utf8_or_markdown_validation(self) -> None:
        for raw in [b"# synthetic-private-content\n\xff", b"# synthetic-private-content\n```text\nUnclosed fence"]:
            def change(members, manifest):
                members["context.md"] = raw
                manifest["manualEntries"][0]["digest"] = digest(raw)
            with self.subTest(raw=raw):
                self.assert_denied(self.rewrite(self.generate(), change))


if __name__ == "__main__":
    unittest.main()
