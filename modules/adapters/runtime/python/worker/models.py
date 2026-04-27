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
