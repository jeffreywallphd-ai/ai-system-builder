from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from modules.adapters.runtime.python.worker.models import (
    AdvancedSyntheticVerificationConfig,
    DatasetQualityRuntimeConfig,
    PrepareTrainingDatasetRequest,
)
from modules.adapters.runtime.python.worker.tasks.example_generation import (
    GeneratedQaExample,
)
from modules.adapters.runtime.python.worker.tasks.markdown_chunking import MarkdownChunk
from modules.adapters.runtime.python.worker.tasks.prepare_training_dataset import (
    prepare_training_dataset,
)
from modules.adapters.runtime.python.worker.tasks.synthetic_verification import (
    SyntheticCandidateVerifier,
)
from modules.adapters.runtime.python.worker.tests.structured_output_test_fixtures import (
    runtime_structured_output_fixture,
)


def _verification_config(**overrides):
    return AdvancedSyntheticVerificationConfig.model_validate(
        {
            "enabled": True,
            "candidatesPerChunk": 3,
            "minimumGroundingScore": 0.45,
            "minimumCriticScore": 0.6,
            "minimumDiversityScore": 0.2,
            "requireReview": True,
            **overrides,
        }
    )


def _quality_config() -> DatasetQualityRuntimeConfig:
    return DatasetQualityRuntimeConfig.model_validate(
        {
            "requestedPolicy": {
                "preset": "recommended",
                "allowedLanguages": ["en"],
            },
            "effectivePolicy": {
                "policyId": "synthetic-test",
                "revision": "1",
                "scope": "workspace",
                "preset": "recommended",
                "allowedLanguages": ["en"],
                "requireLicenseMetadata": False,
                "requireConsentMetadata": False,
                "excludedBenchmarkIds": [],
                "maxRowsPerSource": 100,
                "minimumTextCharacters": 8,
                "maximumTextCharacters": 100000,
                "fuzzyDuplicateSimilarity": 0.95,
                "maxFuzzyCandidatesPerRow": 64,
                "maxReportSamplesPerReason": 3,
                "mandatoryChecks": {
                    "sourceAssociation": True,
                    "schema": True,
                    "exactDuplicates": True,
                    "fuzzyDuplicates": True,
                    "sensitivePersonalData": True,
                    "secretLikeContent": True,
                    "splitLeakage": True,
                },
            },
            "reviewRequired": True,
        }
    )


def _chunk() -> MarkdownChunk:
    text = "Invoices contain dates and totals. Account teams review billing questions."
    return MarkdownChunk(
        artifact_id="source-a",
        chunk_index=0,
        text=text,
        normalized_start=12,
        normalized_end=12 + len(text),
        region_kind="paragraph",
        strategy="section",
    )


def _row(answer: str) -> dict[str, object]:
    return {
        "instruction": "Answer using the source.",
        "input": "What does the guide say?",
        "output": answer,
    }


class SyntheticVerificationTests(unittest.TestCase):
    def test_accepts_grounded_schema_valid_candidate_with_exact_citation(self) -> None:
        verifier = SyntheticCandidateVerifier(
            _verification_config(),
            "llm-instruction",
            {},
        )
        example = GeneratedQaExample(
            "source-a",
            0,
            "What do invoices contain?",
            "Invoices contain dates and totals.",
            candidate_index=0,
        )
        decision = verifier.evaluate(example, _chunk(), _row(example.answer))

        self.assertTrue(decision.accepted)
        self.assertEqual(decision.row["sourceCitation"]["normalizedStart"], 12)
        self.assertEqual(
            decision.row["syntheticVerification"]["criticProvider"],
            "deterministic-grounding-v1",
        )

    def test_rejects_duplicate_unsupported_unsafe_and_uncited_candidates(self) -> None:
        verifier = SyntheticCandidateVerifier(
            _verification_config(),
            "llm-instruction",
            {},
        )
        grounded = GeneratedQaExample(
            "source-a",
            0,
            "What do invoices contain?",
            "Invoices contain dates and totals.",
            candidate_index=0,
        )
        self.assertTrue(
            verifier.evaluate(grounded, _chunk(), _row(grounded.answer)).accepted
        )
        duplicate = verifier.evaluate(
            grounded,
            _chunk(),
            _row(grounded.answer),
        )
        self.assertIn("synthetic-duplicate", duplicate.reason_codes)

        unsupported = GeneratedQaExample(
            "source-a",
            0,
            "What will the weather do?",
            "Weather changes tomorrow.",
            candidate_index=1,
        )
        unsupported_decision = verifier.evaluate(
            unsupported,
            _chunk(),
            _row(unsupported.answer),
        )
        self.assertIn(
            "synthetic-grounding-low",
            unsupported_decision.reason_codes,
        )

        unsafe = GeneratedQaExample(
            "source-a",
            0,
            "Who should be contacted?",
            "Contact private@example.com.",
            candidate_index=2,
        )
        unsafe_decision = verifier.evaluate(unsafe, None, {"instruction": "", "output": unsafe.answer})
        self.assertIn("synthetic-schema-invalid", unsafe_decision.reason_codes)
        self.assertIn("synthetic-citation-missing", unsafe_decision.reason_codes)
        self.assertIn("synthetic-safety-rejected", unsafe_decision.reason_codes)
        self.assertNotIn("private@example.com", json.dumps(verifier.report()))

    def test_end_to_end_quarantines_failed_candidates_before_reviewed_splits(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            source = root / "guide.md"
            source.write_text(
                "# Billing guide\n\nInvoices contain dates and totals. "
                "Account teams review billing questions.",
                encoding="utf-8",
            )
            payload = PrepareTrainingDatasetRequest.model_validate(
                {
                    "workspaceId": "workspace-a",
                    "sourceInputs": [
                        {
                            "artifactId": "source-a",
                            "localPath": str(source),
                            "mediaType": "text/markdown",
                            "originalName": "guide.md",
                            "metadata": {"language": "en"},
                        }
                    ],
                    "recipe": {
                        "normalization": {"targetFormat": "markdown"},
                        "chunking": {
                            "strategy": "character",
                            "chunkSize": 1000,
                            "chunkOverlap": 0,
                            "preserveDocumentBoundaries": True,
                        },
                        "generation": {
                            "mode": "qa",
                            "model": {
                                "provider": "transformers",
                                "modelId": "test-local-model",
                            },
                        },
                        "task": {
                            "taskType": "llm-instruction",
                            "textInputMode": "generate",
                        },
                    },
                    "split": {
                        "trainRatio": 0.8,
                        "testRatio": 0.2,
                        "seed": 4,
                        "shuffle": True,
                    },
                    "output": {"format": "jsonl"},
                    "quality": _quality_config().model_dump(mode="json"),
                    "advanced": {
                        "preset": "generate-examples",
                        "content": {
                            "strategy": "section",
                            "maxTokensPerChunk": 320,
                            "maxSourceSpans": 100,
                            "ocrEnabled": False,
                        },
                        "synthetic": _verification_config().model_dump(mode="json"),
                    },
                    "runtime": runtime_structured_output_fixture(),
                }
            )
            answers = [
                (
                    "What do invoices contain?",
                    "Invoices contain dates and totals.",
                ),
                (
                    "Who reviews billing questions?",
                    "Account teams review billing questions.",
                ),
                (
                    "What will the weather do?",
                    "Weather changes tomorrow.",
                ),
            ]
            call_index = 0

            def generator(chunks, _config):
                nonlocal call_index
                question, answer = answers[call_index]
                call_index += 1
                return [
                    GeneratedQaExample(
                        chunks[0].artifact_id,
                        chunks[0].chunk_index,
                        question,
                        answer,
                    )
                ]

            with patch(
                "modules.adapters.runtime.python.worker.tasks.prepare_training_dataset.ensure_generation_model_is_available"
            ):
                result = prepare_training_dataset(
                    payload,
                    example_generator=generator,
                    output_directory=root,
                )

            self.assertEqual(
                result.advancedReport["synthetic"]["generatedCandidateCount"],
                3,
            )
            self.assertEqual(
                result.advancedReport["synthetic"]["admittedCandidateCount"],
                2,
            )
            self.assertEqual(
                result.advancedReport["synthetic"]["quarantinedCandidateCount"],
                1,
            )
            self.assertEqual(result.summary.acceptedRowCount, 2)
            self.assertEqual(result.summary.quarantinedRowCount, 1)
            self.assertTrue(result.qualityReport["reviewRequired"])
            self.assertEqual(
                result.qualityReport["reasonCounts"]["synthetic-grounding-low"],
                1,
            )
            dataset_output = next(
                output for output in result.outputs if output.role == "dataset"
            )
            rows = [
                json.loads(line)
                for line in Path(dataset_output.tempPath)
                .read_text(encoding="utf-8")
                .splitlines()
            ]
            self.assertTrue(all("sourceCitation" in row for row in rows))
            self.assertTrue(
                all(
                    row["syntheticVerification"]["status"] == "admitted"
                    for row in rows
                )
            )


if __name__ == "__main__":
    unittest.main()
