from __future__ import annotations

import csv
import json
import os
import random
import tempfile
from pathlib import Path
from typing import Any, Callable

from ..models import (
    DatasetPreparationSummary,
    DatasetPreparationWarning,
    PrepareTrainingDatasetRequest,
    PrepareTrainingDatasetResult,
    PythonRuntimeOutputDescriptor,
)
from .document_normalization import normalize_sources_to_markdown
from .example_generation import (
    GeneratedQaExample,
    ensure_generation_model_is_available,
    generate_qa_examples_for_chunks,
)
from .markdown_chunking import chunk_markdown_documents

DEFAULT_MAX_CHUNK_COUNT = 10000


class DatasetPreparationStageError(ValueError):
    def __init__(
        self,
        stage: str,
        message: str,
        error_code: str,
        details: dict[str, object] | None = None,
    ) -> None:
        super().__init__(message)
        self.stage = stage
        self.error_code = error_code
        self.details = details


def _validate_split_config(train_ratio: float, test_ratio: float) -> None:
    if train_ratio <= 0:
        raise ValueError("split.trainRatio must be greater than 0")
    if test_ratio <= 0:
        raise ValueError("split.testRatio must be greater than 0")
    if abs((train_ratio + test_ratio) - 1.0) > 1e-6:
        raise ValueError("split.trainRatio + split.testRatio must equal 1.0")

def _validate_generated_rows(total_rows: int, chunk_count: int) -> None:
    if total_rows > 0:
        return

    raise DatasetPreparationStageError(
        "generation",
        (
            "No training examples were generated from the normalized chunks. "
            f"Processed {chunk_count} chunk(s), but generation produced 0 row(s). "
            "Check source content, chunking settings, and generation model configuration."
        ),
        "generation_no_examples",
        details={
            "chunkCount": chunk_count,
            "generatedRowCount": total_rows,
        },
    )


def _log_generation_failure_diagnostics(
    raw_data: dict[str, Any],
    prepared_data: dict[str, Any],
    errors: list[str],
) -> None:
    print(
        json.dumps(
            {
                "event": "runtime.dataset_preparation.generation.failed",
                "rawData": raw_data,
                "preparedData": prepared_data,
                "errors": errors,
            },
            ensure_ascii=False,
            default=str,
        ),
        flush=True,
    )


def _format_generation_error(error: Exception) -> str:
    message = str(error).strip()
    if message:
        return message
    return error.__class__.__name__


def _emit_rows(
    rows: list[dict[str, object]],
    output_format: str,
    role: str,
    base_name: str,
    metadata: dict[str, object],
) -> PythonRuntimeOutputDescriptor:
    suffix = {"jsonl": ".jsonl", "json": ".json", "csv": ".csv", "parquet": ".parquet"}[output_format]
    fd, temp_path = tempfile.mkstemp(prefix=f"{base_name}-{role}-", suffix=suffix)
    path = Path(temp_path)

    try:
        if output_format == "jsonl":
            path.write_text(
                "\n".join(json.dumps(row, ensure_ascii=False) for row in rows),
                encoding="utf-8",
            )
        elif output_format == "json":
            path.write_text(json.dumps(rows, ensure_ascii=False), encoding="utf-8")
        elif output_format == "csv":
            with path.open("w", encoding="utf-8", newline="") as handle:
                fieldnames = [
                    "artifactId",
                    "chunkIndex",
                    "instruction",
                    "input",
                    "output",
                    "prompt",
                    "completion",
                    "question",
                    "answer",
                    "generationMode",
                ]
                writer = csv.DictWriter(handle, fieldnames=fieldnames)
                writer.writeheader()
                for row in rows:
                    writer.writerow(row)
        else:
            try:
                import pyarrow as pa
                import pyarrow.parquet as pq
            except ImportError as error:
                raise RuntimeError(
                    "The 'pyarrow' package is required for output.format='parquet'."
                ) from error

            table = pa.Table.from_pylist(rows)
            pq.write_table(table, path)
    finally:
        os.close(fd)

    media_type = {
        "jsonl": "application/x-ndjson",
        "json": "application/json",
        "csv": "text/csv",
        "parquet": "application/x-parquet",
    }[output_format]

    return PythonRuntimeOutputDescriptor(
        name=base_name if role == "dataset" else f"{base_name}-{role}",
        role=role,
        tempPath=temp_path,
        mediaType=media_type,
        sizeBytes=path.stat().st_size,
        metadata=metadata,
    )


def _build_generated_rows(
    payload: PrepareTrainingDatasetRequest,
    generator: Callable[[list, object], list[GeneratedQaExample]],
    on_generation_progress: Callable[[dict[str, int]], None] | None = None,
) -> tuple[list[dict[str, object]], list[DatasetPreparationWarning], int, int, int]:
    try:
        ensure_generation_model_is_available(payload.recipe.generation)
    except Exception as error:
        raise DatasetPreparationStageError(
            "generation",
            str(error),
            "generation_model_not_available",
            details={
                "provider": payload.recipe.generation.model.provider,
                "modelId": payload.recipe.generation.model.modelId,
            },
        ) from error

    try:
        normalization = normalize_sources_to_markdown(payload.sourceInputs, payload.recipe.normalization)
    except Exception as error:
        raise DatasetPreparationStageError(
            "normalization",
            str(error),
            "normalization_failed",
            details={
                "sourceInputCount": len(payload.sourceInputs),
                "unsupportedDocumentPolicy": payload.recipe.normalization.unsupportedDocumentPolicy,
                "normalizationMode": payload.recipe.normalization.normalizationMode or "strict",
            },
        ) from error

    try:
        chunks = chunk_markdown_documents(normalization.documents, payload.recipe.chunking)
    except Exception as error:
        raise DatasetPreparationStageError(
            "chunking",
            str(error),
            "chunking_failed",
            details={
                "normalizedDocumentCount": len(normalization.documents),
                "chunkSize": payload.recipe.chunking.chunkSize,
                "chunkOverlap": payload.recipe.chunking.chunkOverlap,
                "preserveDocumentBoundaries": bool(payload.recipe.chunking.preserveDocumentBoundaries),
            },
        ) from error

    max_chunk_count = int(payload.recipe.chunking.maxChunkCount or DEFAULT_MAX_CHUNK_COUNT)
    if len(chunks) > max_chunk_count:
        raise DatasetPreparationStageError(
            "chunking",
            f"Chunk count {len(chunks)} exceeds configured maxChunkCount {max_chunk_count}.",
            "chunk_limit_exceeded",
            details={
                "maxChunkCount": max_chunk_count,
                "actualChunkCount": len(chunks),
            },
        )

    failure_policy = payload.recipe.generation.failurePolicy
    if not failure_policy:
        normalization_mode = payload.recipe.normalization.normalizationMode or "strict"
        failure_policy = "skip" if normalization_mode == "best-effort" else "fail"

    batch_size = int(payload.recipe.generation.batchSize or 1)
    rows: list[dict[str, object]] = []
    warnings: list[DatasetPreparationWarning] = list(normalization.warnings)
    generation_error_samples: list[str] = []
    skipped_generation_chunk_count = 0
    processed_chunk_count = 0
    generated_row_count = 0
    for start in range(0, len(chunks), batch_size):
        chunk_batch = chunks[start : start + batch_size]
        if on_generation_progress is not None:
            on_generation_progress(
                {
                    "totalChunkCount": len(chunks),
                    "processedChunkCount": processed_chunk_count,
                    "generatedRowCount": generated_row_count,
                }
            )
        try:
            generated_examples = generator(chunk_batch, payload.recipe.generation)
            generated_chunk_keys = {
                (example.artifact_id, example.chunk_index)
                for example in generated_examples
            }
            if failure_policy == "skip":
                skipped_chunks = [
                    chunk
                    for chunk in chunk_batch
                    if (chunk.artifact_id, chunk.chunk_index) not in generated_chunk_keys
                ]
                skipped_generation_chunk_count += len(skipped_chunks)
                for chunk in skipped_chunks:
                    warnings.append(
                        DatasetPreparationWarning(
                            code="generation_example_skipped",
                            message=(
                                f"Skipped chunk {chunk.chunk_index} from source '{chunk.artifact_id}' during generation: "
                                "generation returned no usable example"
                            ),
                            sourceArtifactId=chunk.artifact_id,
                        )
                    )
            for example in generated_examples:
                rows.append(
                    {
                        "artifactId": example.artifact_id,
                        "chunkIndex": example.chunk_index,
                        "instruction": "Answer the user question using only the provided context.",
                        "input": example.question,
                        "output": example.answer,
                        "prompt": example.question,
                        "completion": example.answer,
                        "question": example.question,
                        "answer": example.answer,
                        "generationMode": example.generation_mode,
                    }
                )
            processed_chunk_count += len(chunk_batch)
            generated_row_count = len(rows)
            if on_generation_progress is not None:
                on_generation_progress(
                    {
                        "totalChunkCount": len(chunks),
                        "processedChunkCount": processed_chunk_count,
                        "generatedRowCount": generated_row_count,
                    }
                )
        except Exception as error:
            formatted_error = _format_generation_error(error)
            if len(generation_error_samples) < 3:
                generation_error_samples.append(formatted_error)
            if failure_policy == "skip":
                skipped_generation_chunk_count += len(chunk_batch)
                for chunk in chunk_batch:
                    warnings.append(
                        DatasetPreparationWarning(
                            code="generation_example_skipped",
                            message=(
                                f"Skipped chunk {chunk.chunk_index} from source '{chunk.artifact_id}' during generation: {formatted_error}"
                            ),
                            sourceArtifactId=chunk.artifact_id,
                        )
                    )
                processed_chunk_count += len(chunk_batch)
                if on_generation_progress is not None:
                    on_generation_progress(
                        {
                            "totalChunkCount": len(chunks),
                            "processedChunkCount": processed_chunk_count,
                            "generatedRowCount": generated_row_count,
                        }
                    )
                continue
            raise DatasetPreparationStageError(
                "generation",
                formatted_error,
                "generation_failed",
                details={
                    "failurePolicy": failure_policy,
                    "failedChunkCount": len(chunk_batch),
                    "chunkIndices": [chunk.chunk_index for chunk in chunk_batch],
                    "sourceArtifactIds": sorted({chunk.artifact_id for chunk in chunk_batch}),
                    "batchSize": batch_size,
                },
            ) from error

    if not rows:
        model = payload.recipe.generation.model
        raw_data = {
            "sourceInputs": [source.model_dump(mode="json") for source in payload.sourceInputs],
            "normalizedDocuments": [
                {
                    "artifactId": document.artifact_id,
                    "mediaType": document.media_type,
                    "sourcePath": document.source_path,
                    "markdown": document.markdown,
                }
                for document in normalization.documents
            ],
        }
        prepared_data = {
            "chunking": payload.recipe.chunking.model_dump(mode="json"),
            "generation": payload.recipe.generation.model_dump(mode="json"),
            "chunks": [
                {
                    "artifactId": chunk.artifact_id,
                    "chunkIndex": chunk.chunk_index,
                    "text": chunk.text,
                }
                for chunk in chunks
            ],
            "failurePolicy": failure_policy,
            "generationBatchSize": batch_size,
            "skippedGenerationChunkCount": skipped_generation_chunk_count,
        }
        diagnostic_errors = list(generation_error_samples)
        if not diagnostic_errors:
            diagnostic_errors.append("Generation completed without producing any usable examples.")
        _log_generation_failure_diagnostics(raw_data, prepared_data, diagnostic_errors)
        details = {
            "chunkCount": len(chunks),
            "generatedRowCount": 0,
            "failurePolicy": failure_policy,
            "generationBatchSize": batch_size,
            "skippedGenerationChunkCount": skipped_generation_chunk_count,
            "generationErrorSamples": generation_error_samples,
            "modelProvider": model.provider,
            "modelId": model.modelId,
        }
        error_message = (
            "No training examples were generated from the normalized chunks. "
            f"Processed {len(chunks)} chunk(s), but generation produced 0 row(s). "
            f"Failure policy was '{failure_policy}'. "
            f"Skipped generation chunk(s): {skipped_generation_chunk_count}. "
            "Check source content, chunking settings, and generation model configuration."
        )
        if generation_error_samples:
            error_message = f"{error_message} Example generation error(s): {' | '.join(generation_error_samples)}"
        raise DatasetPreparationStageError(
            "generation",
            error_message,
            "generation_no_examples",
            details=details,
        )

    return (
        rows,
        warnings,
        len(normalization.documents),
        normalization.skipped_document_count,
        len(chunks),
    )


def prepare_training_dataset(
    payload: PrepareTrainingDatasetRequest,
    example_generator: Callable[[list, object], list[GeneratedQaExample]] = generate_qa_examples_for_chunks,
    on_generation_progress: Callable[[dict[str, int]], None] | None = None,
) -> PrepareTrainingDatasetResult:
    try:
        _validate_split_config(float(payload.split.trainRatio), float(payload.split.testRatio))
    except Exception as error:
        raise DatasetPreparationStageError(
            "split",
            str(error),
            "split_validation_failed",
            details={
                "trainRatio": payload.split.trainRatio,
                "testRatio": payload.split.testRatio,
            },
        ) from error

    rows, warnings, normalized_count, skipped_count, chunk_count = _build_generated_rows(
        payload,
        example_generator,
        on_generation_progress,
    )
    _validate_generated_rows(len(rows), chunk_count)

    if payload.split.shuffle:
        seed = int(payload.split.seed or 0)
        random.Random(seed).shuffle(rows)

    base_name = payload.output.naming.baseName if payload.output.naming and payload.output.naming.baseName else "training-dataset"
    output_metadata = {
        "stage": "generated-examples",
        "generationMode": payload.recipe.generation.mode,
        "generationModel": {
            "provider": payload.recipe.generation.model.provider,
            "modelId": payload.recipe.generation.model.modelId,
        },
        "sourceArtifactIds": [source.artifactId for source in payload.sourceInputs],
        "summary": {
            "chunkCount": chunk_count,
            "generatedExampleCount": len(rows),
        },
        "split": payload.split.model_dump(mode="json"),
        "outputConfig": payload.output.model_dump(mode="json"),
    }

    dataset_output = _emit_rows(
        rows,
        payload.output.format,
        "dataset",
        base_name,
        {**output_metadata, "partition": "dataset"},
    )

    summary = DatasetPreparationSummary(
        sourceDocumentCount=len(payload.sourceInputs),
        normalizedDocumentCount=normalized_count,
        skippedDocumentCount=skipped_count,
        chunkCount=chunk_count,
        generatedExampleCount=len(rows),
        datasetRowCount=len(rows),
        trainRowCount=len(rows),
        testRowCount=0,
    )

    return PrepareTrainingDatasetResult(
        outputs=[dataset_output],
        summary=summary,
        warnings=warnings or None,
    )
