from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from modules.adapters.runtime.python.worker.models import (
    DatasetQualityRuntimeConfig,
    PrepareTrainingDatasetRequest,
)
from modules.adapters.runtime.python.worker.tasks.dataset_quality import (
    curate_dataset_rows,
)
from modules.adapters.runtime.python.worker.tasks.prepare_training_dataset import (
    DatasetPreparationStageError,
    _validate_source_associations,
    prepare_training_dataset,
)


def _quality_config(**overrides: object) -> DatasetQualityRuntimeConfig:
    policy = {
        "policyId": "test-quality",
        "revision": "1",
        "scope": "workspace",
        "preset": "recommended",
        "allowedLanguages": ["en"],
        "requireLicenseMetadata": False,
        "requireConsentMetadata": False,
        "excludedBenchmarkIds": ["excluded-benchmark"],
        "maxRowsPerSource": 100,
        "minimumTextCharacters": 8,
        "maximumTextCharacters": 100_000,
        "fuzzyDuplicateSimilarity": 0.92,
        "maxFuzzyCandidatesPerRow": 64,
        "maxReportSamplesPerReason": 2,
        "mandatoryChecks": {
            "sourceAssociation": True,
            "schema": True,
            "exactDuplicates": True,
            "fuzzyDuplicates": True,
            "sensitivePersonalData": True,
            "secretLikeContent": True,
            "splitLeakage": True,
        },
        **overrides,
    }
    return DatasetQualityRuntimeConfig.model_validate(
        {
            "requestedPolicy": {
                "preset": "recommended",
                "allowedLanguages": ["en"],
            },
            "effectivePolicy": policy,
            "reviewRequired": True,
        }
    )


class DatasetQualityTests(unittest.TestCase):
    def test_accepts_renamed_nested_generated_fields_through_purpose_paths(self) -> None:
        result = curate_dataset_rows(
            [
                {
                    "sourceArtifactId": "source-a",
                    "text": "A complete customer billing classification example.",
                    "result": {"category": "billing"},
                }
            ],
            [],
            [
                SimpleNamespace(
                    artifactId="source-a", metadata={"language": "en"}
                )
            ],
            "llm-classification",
            {
                "taskType": "llm-classification",
                "textField": "text",
                "labelField": "label",
                "labelSet": ["billing", "support"],
            },
            _quality_config(),
            {"label": ("result", "category")},
        )

        self.assertEqual(len(result.accepted_rows), 1)
        self.assertEqual(result.quarantine_records, [])
        self.assertEqual(result.report["mapping"]["missingRequiredFields"], [])
        self.assertEqual(
            result.report["distributions"]["classes"],
            [{"label": "billing", "count": 1}],
        )

    def test_rejects_missing_or_unselected_source_associations(self) -> None:
        selected_sources = [SimpleNamespace(artifactId="source-a")]

        for row in (
            {"text": "A complete synthetic training example.", "label": "sample"},
            {
                "sourceArtifactId": "source-b",
                "text": "A complete synthetic training example.",
                "label": "sample",
            },
        ):
            with self.subTest(row=row):
                with self.assertRaisesRegex(
                    DatasetPreparationStageError,
                    "could not be linked to a selected source",
                ) as raised:
                    _validate_source_associations([row], [], selected_sources)
                self.assertEqual(raised.exception.stage, "quality")
                self.assertEqual(
                    raised.exception.error_code,
                    "source_association_invalid",
                )

    def test_semantic_curation_runs_before_group_safe_splits(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            source_rows = [
                (
                    "source-a",
                    "How can a customer review an account invoice total?",
                    "billing",
                ),
                (
                    "source-b",
                    "How can a customer review the total on an account invoice?",
                    "billing",
                ),
                (
                    "source-c",
                    "Where can a user change a profile photograph?",
                    "profile",
                ),
            ]
            source_inputs = []
            for source_id, text, label in source_rows:
                path = root / f"{source_id}.jsonl"
                path.write_text(
                    json.dumps({"text": text, "label": label}) + "\n",
                    encoding="utf-8",
                )
                source_inputs.append(
                    {
                        "artifactId": source_id,
                        "localPath": str(path),
                        "mediaType": "application/x-ndjson",
                        "originalName": path.name,
                        "metadata": {"language": "en"},
                    }
                )
            payload = PrepareTrainingDatasetRequest.model_validate(
                {
                    "workspaceId": "workspace-a",
                    "sourceInputs": source_inputs,
                    "recipe": {
                        "normalization": {"targetFormat": "markdown"},
                        "chunking": {
                            "strategy": "character",
                            "chunkSize": 1000,
                            "chunkOverlap": 0,
                        },
                        "generation": {
                            "mode": "qa",
                            "model": {
                                "provider": "transformers",
                                "modelId": "unused-local-model",
                            },
                        },
                        "task": {
                            "taskType": "llm-classification",
                            "textInputMode": "provided",
                            "textField": "text",
                            "labelField": "label",
                        },
                    },
                    "split": {
                        "trainRatio": 0.5,
                        "testRatio": 0.5,
                        "seed": 7,
                        "shuffle": True,
                    },
                    "output": {"format": "jsonl"},
                    "quality": _quality_config(
                        fuzzyDuplicateSimilarity=1.0
                    ).model_dump(mode="json"),
                    "advanced": {
                        "preset": "better-document-understanding",
                        "semantic": {
                            "enabled": True,
                            "embeddingAlgorithm": "hashed-token-v1",
                            "similarityThreshold": 0.75,
                            "maxComparisonsPerRow": 16,
                            "hardNegativeMining": True,
                        },
                    },
                }
            )

            result = prepare_training_dataset(payload, output_directory=root)

            self.assertEqual(result.advancedReport["semantic"]["duplicateRowCount"], 1)
            self.assertEqual(result.qualityReport["reasonCounts"]["semantic-duplicate"], 1)
            self.assertEqual(result.summary.acceptedRowCount, 2)
            accepted_sources = {
                json.loads(line)["sourceArtifactId"]
                for output in result.outputs
                if output.role in {"train", "test"}
                for line in Path(output.tempPath).read_text(encoding="utf-8").splitlines()
            }
            self.assertEqual(len(accepted_sources), 2)
            self.assertFalse({"source-a", "source-b"}.issubset(accepted_sources))

    def test_blocks_approval_when_only_unmapped_rows_remain(self) -> None:
        result = curate_dataset_rows(
            [],
            [
                {
                    "sourceArtifactId": "source-a",
                    "sourceRowIndex": 0,
                    "row": {"unexpected": "synthetic value"},
                }
            ],
            [SimpleNamespace(artifactId="source-a", metadata={"language": "en"})],
            "llm-classification",
            {"textField": "text", "labelField": "label"},
            _quality_config(),
        )

        self.assertEqual(result.report["status"], "blocked")
        self.assertFalse(result.report["approvalAllowed"])
        self.assertEqual(result.report["counts"]["quarantinedRows"], 1)
        self.assertEqual(
            result.report["reasonCounts"],
            {"mapping-required-fields-missing": 1},
        )

    def test_enforces_license_consent_and_source_row_limits(self) -> None:
        rows = [
            {
                "sourceArtifactId": "source-a",
                "sourceRowIndex": index,
                "text": f"A complete synthetic training row number {index}.",
                "label": "sample",
            }
            for index in range(2)
        ]
        result = curate_dataset_rows(
            rows,
            [],
            [SimpleNamespace(artifactId="source-a", metadata={"language": "en"})],
            "llm-classification",
            {"textField": "text", "labelField": "label"},
            _quality_config(
                requireLicenseMetadata=True,
                requireConsentMetadata=True,
                maxRowsPerSource=1,
            ),
        )

        self.assertEqual(result.report["status"], "blocked")
        self.assertEqual(
            result.report["reasonCounts"]["license-metadata-missing"], 2
        )
        self.assertEqual(
            result.report["reasonCounts"]["consent-metadata-missing"], 2
        )
        self.assertEqual(result.report["reasonCounts"]["source-row-limit"], 1)

    def test_curates_duplicates_sensitive_values_and_policy_metadata(self) -> None:
        sources = [
            SimpleNamespace(
                artifactId="source-a",
                metadata={"language": "en"},
            ),
            SimpleNamespace(
                artifactId="source-b",
                metadata={
                    "language": "en",
                    "benchmarkId": "excluded-benchmark",
                },
            ),
        ]
        rows = [
            {
                "sourceArtifactId": "source-a",
                "sourceRowIndex": 0,
                "text": "A complete synthetic billing question for training.",
                "label": "billing",
            },
            {
                "sourceArtifactId": "source-a",
                "sourceRowIndex": 1,
                "text": "A complete synthetic billing question for training.",
                "label": "billing",
            },
            {
                "sourceArtifactId": "source-a",
                "sourceRowIndex": 2,
                "text": "Contact private@example.com about this training row.",
                "label": "support",
            },
            {
                "sourceArtifactId": "source-a",
                "sourceRowIndex": 3,
                "text": "Set api_key=syntheticcredentialvalue before training.",
                "label": "support",
            },
            {
                "sourceArtifactId": "source-b",
                "sourceRowIndex": 0,
                "text": "A separate benchmark example for training.",
                "label": "benchmark",
            },
        ]

        result = curate_dataset_rows(
            rows,
            [],
            sources,
            "llm-classification",
            {"textField": "text", "labelField": "label"},
            _quality_config(),
        )

        self.assertEqual(len(result.accepted_rows), 1)
        self.assertEqual(result.report["status"], "needs-attention")
        self.assertEqual(result.report["counts"]["inputRows"], 5)
        self.assertEqual(result.report["counts"]["acceptedRows"], 1)
        reason_counts = result.report["reasonCounts"]
        self.assertEqual(reason_counts["exact-duplicate"], 1)
        self.assertEqual(reason_counts["sensitive-personal-data"], 1)
        self.assertEqual(reason_counts["secret-like-content"], 1)
        self.assertEqual(reason_counts["benchmark-excluded"], 1)
        serialized_report = json.dumps(result.report)
        self.assertNotIn("private@example.com", serialized_report)
        self.assertNotIn("syntheticcredentialvalue", serialized_report)
        self.assertRegex(
            result.report["reportFingerprint"],
            r"^[a-f0-9]{64}$",
        )

    def test_report_fingerprint_and_fuzzy_decision_are_deterministic(self) -> None:
        source = SimpleNamespace(
            artifactId="source-a",
            metadata={"language": "en"},
        )
        rows = [
            {
                "sourceArtifactId": "source-a",
                "sourceRowIndex": 0,
                "text": "This synthetic example explains how account billing support works today.",
                "label": "billing",
            },
            {
                "sourceArtifactId": "source-a",
                "sourceRowIndex": 1,
                "text": "This synthetic example explains how account billing support works now.",
                "label": "billing",
            },
        ]
        quality = _quality_config(fuzzyDuplicateSimilarity=0.80)

        first = curate_dataset_rows(
            rows,
            [],
            [source],
            "llm-classification",
            {"textField": "text", "labelField": "label"},
            quality,
        )
        second = curate_dataset_rows(
            rows,
            [],
            [source],
            "llm-classification",
            {"textField": "text", "labelField": "label"},
            quality,
        )

        self.assertEqual(
            first.report["reportFingerprint"],
            second.report["reportFingerprint"],
        )
        self.assertEqual(first.report["reasonCounts"]["fuzzy-duplicate"], 1)

    def test_end_to_end_emits_reversible_quarantine_and_sanitized_report(self) -> None:
        with tempfile.TemporaryDirectory() as temp_dir:
            source_path = Path(temp_dir) / "classification.csv"
            source_path.write_text(
                "text,label\n"
                "A complete synthetic billing question for training,billing\n"
                "private@example.com should never appear in report samples,\n"
                "Contact private@example.com about account support,support\n"
                "A complete synthetic billing question for training,billing\n",
                encoding="utf-8",
            )
            payload = PrepareTrainingDatasetRequest.model_validate(
                {
                    "workspaceId": "workspace-a",
                    "sourceInputs": [
                        {
                            "artifactId": "classification-source",
                            "localPath": str(source_path),
                            "mediaType": "text/csv",
                            "originalName": "classification.csv",
                            "metadata": {"language": "en"},
                        }
                    ],
                    "recipe": {
                        "normalization": {"targetFormat": "markdown"},
                        "chunking": {
                            "strategy": "character",
                            "chunkSize": 100,
                            "chunkOverlap": 0,
                        },
                        "generation": {
                            "mode": "qa",
                            "model": {
                                "provider": "transformers",
                                "modelId": "test-model",
                            },
                        },
                        "task": {
                            "taskType": "llm-classification",
                            "textField": "text",
                            "labelField": "label",
                        },
                    },
                    "split": {
                        "trainRatio": 0.8,
                        "testRatio": 0.2,
                        "shuffle": False,
                    },
                    "output": {"format": "jsonl"},
                    "quality": _quality_config().model_dump(mode="json"),
                }
            )

            with patch(
                "modules.adapters.runtime.python.worker.tasks.prepare_training_dataset.ensure_generation_model_is_available"
            ):
                result = prepare_training_dataset(
                    payload,
                    example_generator=lambda _chunks, _config: (_ for _ in ()).throw(
                        AssertionError("generation should not run")
                    ),
                    output_directory=Path(temp_dir),
                )

            self.assertEqual(result.summary.generatedExampleCount, 4)
            self.assertEqual(result.summary.acceptedRowCount, 1)
            self.assertEqual(result.summary.quarantinedRowCount, 3)
            self.assertEqual(result.qualityReport["status"], "needs-attention")
            report_output = next(
                output for output in result.outputs if output.role == "report"
            )
            quarantine_output = next(
                output for output in result.outputs if output.role == "quarantine"
            )
            report_text = Path(report_output.tempPath).read_text(encoding="utf-8")
            self.assertNotIn("private@example.com", report_text)
            quarantine_rows = [
                json.loads(line)
                for line in Path(quarantine_output.tempPath)
                .read_text(encoding="utf-8")
                .splitlines()
            ]
            self.assertEqual(len(quarantine_rows), 3)
            self.assertTrue(
                any(
                    row["reasonCodes"]
                    == ["mapping-required-fields-missing"]
                    for row in quarantine_rows
                )
            )
            self.assertTrue(
                any(
                    "private@example.com"
                    in json.dumps(row["row"])
                    for row in quarantine_rows
                )
            )

    def test_enforces_task_relationships_and_allowed_labels(self) -> None:
        rows = [
            {
                "sourceArtifactId": "source-a",
                "sourceRowIndex": 0,
                "text": "A sufficiently complete account question.",
                "label": "billing",
            },
            {
                "sourceArtifactId": "source-a",
                "sourceRowIndex": 1,
                "text": "A sufficiently complete profile question.",
                "label": "unknown",
            },
        ]

        result = curate_dataset_rows(
            rows,
            [],
            [SimpleNamespace(artifactId="source-a", metadata={"language": "en"})],
            "llm-classification",
            {
                "textField": "text",
                "labelField": "label",
                "labelSet": ["billing", "profile"],
            },
            _quality_config(),
        )

        self.assertEqual(len(result.accepted_rows), 1)
        self.assertEqual(result.report["reasonCounts"]["label-invalid"], 1)
        self.assertEqual(result.report["inspection"]["textContent"], "checked")

    def test_rejects_equal_embedding_pairs(self) -> None:
        result = curate_dataset_rows(
            [
                {
                    "sourceArtifactId": "source-a",
                    "sourceRowIndex": 0,
                    "anchorText": "The same normalized sentence.",
                    "positiveText": " the SAME normalized sentence. ",
                }
            ],
            [],
            [SimpleNamespace(artifactId="source-a", metadata={"language": "en"})],
            "llm-embedding",
            {},
            _quality_config(),
        )

        self.assertEqual(result.report["status"], "blocked")
        self.assertEqual(
            result.report["reasonCounts"]["task-relationship-invalid"], 1
        )

    def test_validates_bounded_detection_boxes_and_label_alignment(self) -> None:
        result = curate_dataset_rows(
            [
                {
                    "sourceArtifactId": "source-a",
                    "sourceRowIndex": 0,
                    "image": "image-a",
                    "boundingBoxes": [[0, 0, 20, 10]],
                    "labels": ["car"],
                    "boxFormat": "xywh",
                },
                {
                    "sourceArtifactId": "source-a",
                    "sourceRowIndex": 1,
                    "image": "image-b",
                    "boundingBoxes": [[0, 0, 0, 10]],
                    "labels": ["car"],
                    "boxFormat": "xywh",
                },
                {
                    "sourceArtifactId": "source-a",
                    "sourceRowIndex": 2,
                    "image": "image-c",
                    "boundingBoxes": [[0, 0, 20, 10], [5, 5, 4, 4]],
                    "labels": ["car"],
                    "boxFormat": "xywh",
                },
            ],
            [],
            [SimpleNamespace(artifactId="source-a", metadata={})],
            "vision-detection",
            {"boxFormat": "xywh", "labelSet": ["car"]},
            _quality_config(),
        )

        self.assertEqual(len(result.accepted_rows), 1)
        self.assertEqual(
            result.report["reasonCounts"]["image-annotation-invalid"], 1
        )
        self.assertEqual(result.report["reasonCounts"]["label-invalid"], 1)
        self.assertEqual(
            result.report["inspection"]["imagePixels"], "not-inspected"
        )

    def test_validates_selected_segmentation_mask_format(self) -> None:
        result = curate_dataset_rows(
            [
                {
                    "sourceArtifactId": "source-a",
                    "sourceRowIndex": 0,
                    "image": "image-a",
                    "mask": [0, 0, 10, 0, 10, 10],
                    "label": "foreground",
                    "maskFormat": "polygon",
                },
                {
                    "sourceArtifactId": "source-a",
                    "sourceRowIndex": 1,
                    "image": "image-b",
                    "mask": [0, 0, 10, 0, 5],
                    "label": "foreground",
                    "maskFormat": "polygon",
                },
            ],
            [],
            [SimpleNamespace(artifactId="source-a", metadata={})],
            "vision-segmentation",
            {"maskFormat": "polygon", "labelSet": ["foreground"]},
            _quality_config(),
        )

        self.assertEqual(len(result.accepted_rows), 1)
        self.assertEqual(
            result.report["reasonCounts"]["image-annotation-invalid"], 1
        )


if __name__ == "__main__":
    unittest.main()
