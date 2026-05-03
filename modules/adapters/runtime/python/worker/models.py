from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field


class PythonRuntimeError(BaseModel):
    code: str
    errorCode: str | None = None
    stage: Literal["normalization", "chunking", "generation", "split"] | None = None
    message: str
    details: dict[str, Any] | None = None
    retryable: bool | None = None


class PythonRuntimeHealthStatus(BaseModel):
    runtimeId: str
    status: str
    version: str | None = None
    pythonVersion: str | None = None
    workerStartedAt: str | None = None
    lastHeartbeatAt: str | None = None


class PythonRuntimeHealthCheckResult(BaseModel):
    healthy: bool
    status: PythonRuntimeHealthStatus
    error: PythonRuntimeError | None = None
    message: str | None = None


class PythonRuntimeCapabilitiesResult(BaseModel):
    runtimeId: str
    capabilities: list[str]


class EnsureModelDownloadRequest(BaseModel):
    provider: Literal["transformers"]
    modelId: str


class EnsureModelDownloadResult(BaseModel):
    provider: Literal["transformers"]
    modelId: str
    downloaded: bool
    fromCache: bool
    localPath: str | None = None


class LoadedModelDescriptor(BaseModel):
    provider: Literal["transformers"]
    modelId: str
    inferenceMode: Literal["text2text", "causal", "chat"]
    device: Literal["cpu", "cuda", "auto"] | None = None
    torchDtype: Literal["auto", "float16", "bfloat16", "float32"] | None = None
    localPath: str | None = None


class ModelStatusResult(BaseModel):
    loadedModels: list[LoadedModelDescriptor]
    activeTaskCount: int


class UnloadModelsResult(BaseModel):
    unloadedModels: list[LoadedModelDescriptor]
    activeTaskCount: int


class PythonRuntimeTaskRequest(BaseModel):
    requestId: str
    taskType: str
    payload: Any
    timeoutMs: int | None = None
    metadata: dict[str, Any] | None = None


class PythonRuntimeTaskResult(BaseModel):
    requestId: str
    taskType: str
    success: bool
    data: Any | None = None
    error: PythonRuntimeError | None = None
    metadata: dict[str, Any] | None = None


PythonRuntimeTaskStatus = Literal[
    "queued",
    "running",
    "succeeded",
    "failed",
    "cancelled",
    "unknown",
]


class StartPythonRuntimeTaskRequest(BaseModel):
    requestId: str
    taskType: str
    payload: Any
    timeoutMs: int | None = None
    metadata: dict[str, Any] | None = None


class StartPythonRuntimeTaskResult(BaseModel):
    requestId: str
    taskType: str
    accepted: bool
    status: Literal["queued", "running"]
    startedAt: str | None = None
    updatedAt: str | None = None
    metadata: dict[str, Any] | None = None


class PythonRuntimeTaskStatusResult(BaseModel):
    requestId: str
    taskType: str | None = None
    status: PythonRuntimeTaskStatus
    progress: dict[str, Any] | None = None
    data: Any | None = None
    error: PythonRuntimeError | None = None
    startedAt: str | None = None
    updatedAt: str | None = None
    completedAt: str | None = None
    metadata: dict[str, Any] | None = None


class CancelPythonRuntimeTaskResult(BaseModel):
    requestId: str
    taskType: str | None = None
    status: PythonRuntimeTaskStatus
    cancelled: bool
    message: str | None = None
    metadata: dict[str, Any] | None = None


class DatasetPreparationSourceInput(BaseModel):
    artifactId: str
    localPath: str
    mediaType: str | None = None
    originalName: str | None = None
    metadata: dict[str, Any] | None = None


class DocumentNormalizationConfig(BaseModel):
    targetFormat: Literal["markdown"]
    unsupportedDocumentPolicy: Literal["fail", "skip"] | None = None
    normalizationMode: Literal["best-effort", "strict"] | None = None


class MarkdownChunkingConfig(BaseModel):
    strategy: Literal["character"]
    chunkSize: int = Field(gt=0)
    chunkOverlap: int = Field(ge=0)
    preserveDocumentBoundaries: bool | None = None
    maxChunkCount: int | None = Field(default=None, gt=0)


class GenerationParams(BaseModel):
    temperature: float | None = None
    topP: float | None = None
    maxNewTokens: int | None = None


class LocalModelConfig(BaseModel):
    provider: Literal["transformers"]
    modelId: str
    inferenceMode: Literal["auto", "text2text", "causal", "chat"] = "auto"
    device: Literal["cpu", "cuda", "auto"] | None = None
    torchDtype: Literal["auto", "float16", "bfloat16", "float32"] | None = None


class ExampleGenerationConfig(BaseModel):
    mode: Literal["qa"]
    model: LocalModelConfig
    promptTemplate: str | None = None
    maxExamplesPerChunk: int | None = None
    batchSize: int | None = Field(default=None, gt=0)
    generationParams: GenerationParams | None = None
    failurePolicy: Literal["fail", "skip"] | None = None


class DatasetPreparationRecipe(BaseModel):
    normalization: DocumentNormalizationConfig
    chunking: MarkdownChunkingConfig
    generation: ExampleGenerationConfig


class DatasetSplitConfig(BaseModel):
    trainRatio: float
    testRatio: float
    seed: int | None = None
    shuffle: bool | None = None


class DatasetOutputConfigNaming(BaseModel):
    baseName: str | None = None


class DatasetOutputConfig(BaseModel):
    format: Literal["jsonl", "json", "csv", "parquet"]
    naming: DatasetOutputConfigNaming | None = None
    destinations: dict[str, Any] | None = None


class PrepareTrainingDatasetRequest(BaseModel):
    sourceInputs: list[DatasetPreparationSourceInput]
    recipe: DatasetPreparationRecipe
    split: DatasetSplitConfig
    output: DatasetOutputConfig
    runtime: dict[str, Any] | None = None


class PythonRuntimeOutputDescriptor(BaseModel):
    name: str
    role: Literal["dataset", "train", "test", "metrics", "report", "artifact"] | None = None
    tempPath: str
    mediaType: str
    sizeBytes: int | None = None
    metadata: dict[str, Any] | None = None


class DatasetPreparationSummary(BaseModel):
    sourceDocumentCount: int
    normalizedDocumentCount: int
    skippedDocumentCount: int
    chunkCount: int
    generatedExampleCount: int
    datasetRowCount: int
    trainRowCount: int
    testRowCount: int


class DatasetPreparationWarning(BaseModel):
    code: str
    message: str
    sourceArtifactId: str | None = None


class PrepareTrainingDatasetResult(BaseModel):
    outputs: list[PythonRuntimeOutputDescriptor]
    summary: DatasetPreparationSummary
    warnings: list[DatasetPreparationWarning] | None = None


class TrainModelBaseModelInput(BaseModel):
    modelRecordId: str | None = None
    provider: str | None = None
    modelId: str | None = None
    localPath: str | None = None
    inferenceMode: Literal["text2text", "causal", "chat"] | None = None


class TrainModelDatasetInput(BaseModel):
    artifactId: str
    splitRole: Literal["train", "validation", "test"]
    format: str | None = None
    path: str | None = None


class TrainModelTaskRequest(BaseModel):
    baseModel: TrainModelBaseModelInput
    datasets: list[TrainModelDatasetInput]
    method: Literal["lora", "qlora", "full-finetune"]
    commonParameters: dict[str, Any] | None = None
    advancedParameters: dict[str, Any] | None = None
    output: dict[str, Any]
    validation: dict[str, Any] | None = None
    runMetadata: dict[str, Any] | None = None


class TrainModelTaskResult(BaseModel):
    runId: str
    status: Literal["queued", "running", "succeeded", "failed", "cancelled"]
    outputDirectory: str | None = None
    outputModelName: str | None = None
    checkpoints: list[dict[str, Any]] | None = None
    metrics: dict[str, float] | None = None
    logs: list[str] | None = None
    warnings: list[str] | None = None
    validationReportPath: str | None = None
    generatedModelCandidate: dict[str, Any] | None = None
    error: dict[str, Any] | None = None


class ValidateModelTaskRequest(BaseModel):
    modelRecordId: str
    modelPath: str
    reportOutputDirectory: str | None = None
    expectedLoRA: bool | None = None
    expectedRecurrentAdditions: bool | None = None
    validationStrictness: Literal["normal", "publish"] | None = None


class ValidateModelTaskResult(BaseModel):
    modelRecordId: str
    status: Literal["unknown", "valid", "invalid", "warning"]
    validationReportPath: str | None = None
    validationDiffPath: str | None = None
    serializationFormat: str | None = None
    shardCount: int | None = None
    detectedLoRA: bool | None = None
    detectedRecurrentAdditions: bool | None = None
    validatedModelPath: str | None = None
    validatedAt: str | None = None
    validationStrictness: Literal["normal", "publish"] | None = None
    tensorChecksCompleted: bool | None = None
    warnings: list[str] | None = None
    errors: list[str] | None = None
