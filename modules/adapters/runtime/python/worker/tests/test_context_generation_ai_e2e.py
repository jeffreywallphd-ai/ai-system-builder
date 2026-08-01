from __future__ import annotations

import hashlib
import json
import re
import sqlite3
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from zipfile import ZipFile

from modules.adapters.runtime.python.worker.models import (
    ContextGenerationTaskRequest,
)
from modules.adapters.runtime.python.worker.tasks.context_generation import (
    PACK_MEDIA_TYPE,
    RAG_MEDIA_TYPE,
    generate_context_artifact,
)
from modules.adapters.runtime.python.worker.tasks.constrained_json_decoder import (
    get_constrained_json_decoder_runtime_status,
)
from modules.adapters.runtime.python.worker.tasks.local_text_generation import (
    _RESOLVED_MODEL_REFERENCES,
)


MODEL_ID = "tests/tiny-context-embedding"
SUMMARY_MODEL_ID = "tests/tiny-context-summary"
SUMMARY_CITATION_ID = "artifact.release:document:0"
SUMMARY_PAYLOAD = {
    "topics": [{
        "title": "Release policy",
        "summary": "Release verification and rollback use passing builds.",
        "citationIds": [SUMMARY_CITATION_ID],
    }],
}


def _digest(value: bytes) -> str:
    return "sha256:" + hashlib.sha256(value).hexdigest()


class ContextGenerationAiEndToEndTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        try:
            import torch
            from transformers import (
                BertConfig,
                BertModel,
                BertTokenizerFast,
                GPT2Config,
                GPT2LMHeadModel,
                PreTrainedTokenizerFast,
            )
            from tokenizers import Tokenizer
            from tokenizers.models import WordLevel
        except ImportError as error:
            raise unittest.SkipTest(
                "The controlled Context AI tests require torch and transformers."
            ) from error

        cls._model_temp = tempfile.TemporaryDirectory()
        cls.addClassCleanup(cls._model_temp.cleanup)
        cls.model_path = Path(cls._model_temp.name) / "tiny-bert"
        cls.model_path.mkdir()
        vocabulary = [
            "[PAD]",
            "[UNK]",
            "[CLS]",
            "[SEP]",
            "[MASK]",
            "release",
            "verification",
            "requires",
            "passing",
            "build",
            "review",
            "rollback",
            "uses",
            "last",
            "policy",
            "context",
            "source",
            "database",
            "approval",
            "only",
            "after",
            "before",
            "changes",
            "are",
            "recorded",
            ".",
            "#",
        ]
        vocabulary_path = cls.model_path / "vocab.txt"
        vocabulary_path.write_text(
            "\n".join(vocabulary) + "\n",
            encoding="utf-8",
        )
        tokenizer = BertTokenizerFast(
            vocab_file=str(vocabulary_path),
            do_lower_case=True,
        )
        tokenizer.save_pretrained(cls.model_path)
        torch.manual_seed(7)
        model = BertModel(BertConfig(
            vocab_size=len(vocabulary),
            hidden_size=16,
            num_hidden_layers=1,
            num_attention_heads=2,
            intermediate_size=32,
            max_position_embeddings=128,
            pad_token_id=vocabulary.index("[PAD]"),
        ))
        model.save_pretrained(cls.model_path)

        cls.summary_model_path = Path(cls._model_temp.name) / "tiny-gpt2"
        cls.summary_model_path.mkdir()
        summary_token = json.dumps(
            SUMMARY_PAYLOAD,
            ensure_ascii=False,
            separators=(",", ":"),
        )
        summary_vocabulary = {
            "[UNK]": 0,
            "[PAD]": 1,
            "[BOS]": 2,
            "[EOS]": 3,
            summary_token: 4,
        }
        summary_tokenizer = PreTrainedTokenizerFast(
            tokenizer_object=Tokenizer(WordLevel(
                summary_vocabulary,
                unk_token="[UNK]",
            )),
            unk_token="[UNK]",
            pad_token="[PAD]",
            bos_token="[BOS]",
            eos_token="[EOS]",
        )
        summary_tokenizer.save_pretrained(cls.summary_model_path)
        summary_model = GPT2LMHeadModel(GPT2Config(
            vocab_size=len(summary_vocabulary),
            n_positions=8,
            n_ctx=8,
            n_embd=8,
            n_layer=1,
            n_head=1,
            bos_token_id=summary_vocabulary["[BOS]"],
            eos_token_id=summary_vocabulary["[EOS]"],
            pad_token_id=summary_vocabulary["[PAD]"],
            tie_word_embeddings=False,
        ))
        with torch.no_grad():
            for parameter in summary_model.parameters():
                parameter.zero_()
            for module in summary_model.modules():
                if isinstance(module, torch.nn.LayerNorm):
                    module.weight.fill_(1.0)
                    module.bias.zero_()
            summary_model.transformer.wpe.weight[0, 0] = 1.0
            summary_model.transformer.wpe.weight[1, 1] = 1.0
            hidden = summary_model.transformer(
                input_ids=torch.tensor([[
                    summary_vocabulary["[UNK]"],
                    summary_vocabulary[summary_token],
                ]]),
            ).last_hidden_state[0]
            summary_model.lm_head.weight[
                summary_vocabulary[summary_token]
            ].copy_(hidden[0] * 10.0)
            summary_model.lm_head.weight[
                summary_vocabulary["[EOS]"]
            ].copy_(hidden[1] * 10.0)
        summary_model.save_pretrained(cls.summary_model_path)

    def _generate(self, payload: dict[str, object]) -> dict[str, object]:
        request = ContextGenerationTaskRequest.model_validate(payload)
        with patch.dict(
            _RESOLVED_MODEL_REFERENCES,
            {
                MODEL_ID: str(self.model_path),
                SUMMARY_MODEL_ID: str(self.summary_model_path),
            },
            clear=False,
        ):
            return generate_context_artifact(request)

    def _assert_valid_rag_database(
        self,
        root: Path,
        result: dict[str, object],
        *,
        expected_chunking_mode: str,
        expected_chunk_count: int | None = None,
    ) -> tuple[dict[str, object], list[tuple[object, ...]]]:
        output = result["output"]
        self.assertIsInstance(output, dict)
        assert isinstance(output, dict)
        self.assertEqual(output["mediaType"], RAG_MEDIA_TYPE)
        database = root / str(output["outputHandle"])
        self.assertTrue(database.is_file())
        self.assertGreater(database.stat().st_size, 0)
        self.assertEqual(output["digest"], _digest(database.read_bytes()))

        connection = sqlite3.connect(database)
        try:
            self.assertEqual(
                connection.execute("PRAGMA integrity_check").fetchone(),
                ("ok",),
            )
            manifest = json.loads(connection.execute(
                "SELECT value FROM manifest WHERE key = 'artifact'"
            ).fetchone()[0])
            source_rows = connection.execute(
                "SELECT chunk_count, chunking_mode FROM sources"
            ).fetchall()
            chunks = connection.execute(
                "SELECT ordinal, text, citation_json, embedding, "
                "embedding_dimensions FROM chunks ORDER BY ordinal"
            ).fetchall()
        finally:
            connection.close()

        self.assertEqual(manifest["kind"], "rag-database")
        self.assertEqual(manifest["embedding"]["modelId"], MODEL_ID)
        self.assertEqual(source_rows[0][1], expected_chunking_mode)
        self.assertEqual(source_rows[0][0], len(chunks))
        self.assertGreater(len(chunks), 0)
        if expected_chunk_count is not None:
            self.assertEqual(len(chunks), expected_chunk_count)
        for ordinal, text, citation_json, embedding, dimensions in chunks:
            self.assertIsInstance(ordinal, int)
            self.assertTrue(str(text).strip())
            self.assertIsInstance(json.loads(citation_json), dict)
            self.assertEqual(dimensions, 8)
            self.assertEqual(len(embedding), dimensions * 4)
        return manifest, chunks

    def test_raw_markdown_creates_valid_rag_database_with_tiny_local_model(
        self,
    ) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            source_bytes = (
                b"# Release policy\n\n"
                b"Release approval requires a passing build and recorded review.\n\n"
                b"## Rollback\n\n"
                b"Rollback uses the last passing build before changes are recorded.\n"
            )
            source = root / "release.md"
            source.write_bytes(source_bytes)
            result = self._generate({
                "workspaceId": "workspace.test",
                "kind": "rag-database",
                "name": "Release knowledge",
                "sources": [{
                    "artifactId": "artifact.release",
                    "localPath": str(source),
                    "mediaType": "text/markdown",
                    "originalName": "release.md",
                    "sourceDigest": _digest(source_bytes),
                    "sizeBytes": len(source_bytes),
                }],
                "manualEntries": [],
                "chunking": {
                    "strategy": "structure-aware",
                    "chunkCharacters": 96,
                    "overlapCharacters": 0,
                    "maximumTokensPerChunk": 64,
                },
                "embedding": {
                    "provider": "transformers",
                    "modelId": MODEL_ID,
                    "dimensions": 8,
                    "batchSize": 2,
                },
                "runtime": {"runtimeWorkingDirectory": str(root)},
            })

            manifest, chunks = self._assert_valid_rag_database(
                root,
                result,
                expected_chunking_mode="extracted",
            )
            self.assertEqual(manifest["sources"][0]["artifactId"], "artifact.release")
            self.assertTrue(any(
                json.loads(chunk[2])["sourceArtifactId"] == "artifact.release"
                for chunk in chunks
            ))

    def test_prepared_chunks_create_valid_rag_database_with_preserved_lineage(
        self,
    ) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            rows = [
                {
                    "chunkIndex": 7,
                    "question": "What is the release policy?",
                    "answer": "Release only after verification.",
                    "sourceLineage": {
                        "sourceArtifactId": "artifact.source",
                        "normalizedStart": 12,
                        "normalizedEnd": 44,
                    },
                },
                {
                    "chunkIndex": 8,
                    "question": "What is the rollback policy?",
                    "answer": "Use the last passing build.",
                    "sourceLineage": {
                        "sourceArtifactId": "artifact.source",
                        "normalizedStart": 45,
                        "normalizedEnd": 79,
                    },
                },
            ]
            source_bytes = (
                "\n".join(json.dumps(row) for row in rows) + "\n"
            ).encode("utf-8")
            source = root / "prepared.jsonl"
            source.write_bytes(source_bytes)
            result = self._generate({
                "workspaceId": "workspace.test",
                "kind": "rag-database",
                "name": "Prepared knowledge",
                "sources": [{
                    "artifactId": "artifact.prepared",
                    "localPath": str(source),
                    "mediaType": "application/jsonl",
                    "originalName": "prepared.jsonl",
                    "sourceDigest": _digest(source_bytes),
                    "sizeBytes": len(source_bytes),
                }],
                "manualEntries": [],
                "chunking": {
                    "strategy": "fixed-length",
                    "chunkCharacters": 256,
                    "overlapCharacters": 32,
                    "textFields": ["question", "answer"],
                },
                "embedding": {
                    "provider": "transformers",
                    "modelId": MODEL_ID,
                    "dimensions": 8,
                    "batchSize": 1,
                },
                "runtime": {"runtimeWorkingDirectory": str(root)},
            })

            manifest, chunks = self._assert_valid_rag_database(
                root,
                result,
                expected_chunking_mode="persisted",
                expected_chunk_count=2,
            )
            self.assertEqual(manifest["sources"][0]["artifactId"], "artifact.prepared")
            citations = [json.loads(chunk[2]) for chunk in chunks]
            self.assertEqual(
                [citation["chunkIndex"] for citation in citations],
                [7, 8],
            )
            self.assertTrue(all(
                citation["sourceArtifactId"] == "artifact.prepared"
                and citation["sourceDigest"] == _digest(source_bytes)
                for citation in citations
            ))

    def test_source_materials_create_well_formed_markdown_context_pack(
        self,
    ) -> None:
        runtime_status = get_constrained_json_decoder_runtime_status()
        if not runtime_status.available:
            self.skipTest(
                "Model-assisted Context Pack generation requires the supported "
                f"constrained decoder runtime: {runtime_status.reason}."
            )
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            source_bytes = (
                b"# Release process\n\n"
                b"Verification protects every release.\n\n"
                b"## Rollback\n\n"
                b"Rollback uses the last passing build.\n\n"
                b"Verification protects every release.\n"
            )
            source = root / "release.md"
            source.write_bytes(source_bytes)
            payload = ContextGenerationTaskRequest.model_validate({
                "workspaceId": "workspace.test",
                "kind": "markdown-context-pack",
                "name": "Release context",
                "sources": [{
                    "artifactId": "artifact.release",
                    "localPath": str(source),
                    "mediaType": "text/markdown",
                    "originalName": "release.md",
                    "sourceDigest": _digest(source_bytes),
                    "sizeBytes": len(source_bytes),
                }],
                "manualEntries": [],
                "chunking": {
                    "strategy": "topic-aware",
                    "chunkCharacters": 1_200,
                    "overlapCharacters": 0,
                    "maximumTokensPerChunk": 320,
                    "topicBoundarySensitivity": 0.22,
                },
                "contextPack": {
                    "inputMode": "source-materials",
                    "method": "local-model",
                    "cleaningPreset": "strict",
                    "maximumSummaryLines": 5,
                    "model": {
                        "provider": "transformers",
                        "modelId": SUMMARY_MODEL_ID,
                        "inferenceMode": "causal",
                        "device": "cpu",
                        "torchDtype": "float32",
                        "maximumOutputTokens": 64,
                    },
                },
                "runtime": {"runtimeWorkingDirectory": str(root)},
            })

            result = self._generate(payload.model_dump(mode="json"))

            output = result["output"]
            self.assertEqual(output["mediaType"], PACK_MEDIA_TYPE)
            archive_path = root / output["outputHandle"]
            self.assertTrue(archive_path.is_file())
            self.assertEqual(output["digest"], _digest(archive_path.read_bytes()))
            with ZipFile(archive_path) as archive:
                self.assertEqual(
                    set(archive.namelist()),
                    {"manifest.json", "README.md", "topics.md", "sources.md"},
                )
                manifest = json.loads(archive.read("manifest.json"))
                markdown_documents = {
                    name: archive.read(name).decode("utf-8")
                    for name in ("README.md", "topics.md", "sources.md")
                }

            self.assertEqual(manifest["kind"], "markdown-context-pack")
            self.assertEqual(manifest["contextPack"]["inputMode"], "source-materials")
            self.assertEqual(manifest["contextPack"]["method"], "local-model")
            self.assertEqual(manifest["contextPack"]["cleaningPreset"], "strict")
            self.assertEqual(manifest["contextPack"]["maximumSummaryLines"], 5)
            self.assertEqual(manifest["contextPack"]["modelId"], SUMMARY_MODEL_ID)
            for markdown in markdown_documents.values():
                self.assertRegex(markdown, re.compile(r"^# .+", re.MULTILINE))
                self.assertNotIn("\x00", markdown)
                self.assertEqual(markdown.count("```") % 2, 0)
                self.assertEqual(markdown.count("~~~") % 2, 0)
            self.assertRegex(
                markdown_documents["topics.md"],
                re.compile(r"^## .+", re.MULTILINE),
            )
            self.assertIn("## Release policy", markdown_documents["topics.md"])
            self.assertIn(
                "Release verification and rollback use passing builds.",
                markdown_documents["topics.md"],
            )
            self.assertIn("Sources: artifact.release#chunk-", markdown_documents["topics.md"])
            self.assertIn("## Chunk 1", markdown_documents["sources.md"])
            self.assertIn(
                "Source: artifact.release#chunk-",
                markdown_documents["sources.md"],
            )


if __name__ == "__main__":
    unittest.main()
