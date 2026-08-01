from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field


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
    inferenceMode: str | None = None
    taskTags: list[str] | None = None
    artifactForm: str | None = None


class EnsureModelDownloadResult(BaseModel):
    provider: Literal["transformers"]
    modelId: str
    downloaded: bool
    fromCache: bool
    modelHandle: str | None = None


class LoadedModelDescriptor(BaseModel):
    provider: Literal["transformers"]
    modelId: str
    inferenceMode: Literal["text2text", "causal", "chat"]
    device: Literal["cpu", "cuda", "auto"] | None = None
    torchDtype: Literal["auto", "float16", "bfloat16", "float32"] | None = None
    adapterModelId: str | None = None
    adapterRevision: str | None = None
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
    adapterModelId: str | None = None
    adapterRevision: str | None = None
    memoryOverflowPolicy: Literal["none", "limited", "extended"] = "none"


class ExampleGenerationConfig(BaseModel):
    mode: Literal["qa"]
    model: LocalModelConfig
    promptTemplate: str | None = Field(default=None, max_length=8_000)
    maxExamplesPerChunk: int | None = None
    batchSize: int | None = Field(default=None, gt=0)
    generationParams: GenerationParams | None = None
    failurePolicy: Literal["fail", "skip"] | None = None


class DatasetPreparationRecipe(BaseModel):
    task: dict[str, Any] | None = None
    normalization: DocumentNormalizationConfig | None = None
    chunking: MarkdownChunkingConfig | None = None
    generation: ExampleGenerationConfig | None = None


class DatasetPreparationExecutionPlan(BaseModel):
    schemaVersion: Literal["1"]
    inputIntent: Literal[
        "use-existing-dataset",
        "combine-existing-datasets",
        "create-from-source-material",
    ]
    method: Literal[
        "validate-and-split",
        "combine-and-split",
        "fixed-length",
        "topic-aware",
        "structure-aware",
        "use-source-metadata",
        "model-assisted-metadata",
        "use-existing-annotations",
    ]
    sourceKinds: list[Literal["structured", "document", "image"]]
    generationMode: Literal["none", "task-examples", "metadata-text"]


class DatasetSplitConfig(BaseModel):
    trainRatio: float
    validationRatio: float | None = None
    testRatio: float
    seed: int | None = None
    shuffle: bool | None = None


class DatasetOutputConfigNaming(BaseModel):
    baseName: str | None = None


class DatasetOutputConfig(BaseModel):
    format: Literal["jsonl", "json", "csv", "parquet"]
    naming: DatasetOutputConfigNaming | None = None
    destinations: dict[str, Any] | None = None


class DatasetQualityRequestedPolicy(BaseModel):
    preset: Literal["recommended", "strict"]
    allowedLanguages: list[str] | None = None
    requireLicenseMetadata: bool | None = None
    requireConsentMetadata: bool | None = None
    includeSourceAttribution: bool | None = None
    excludedBenchmarkIds: list[str] | None = None
    maxRowsPerSource: int | None = Field(default=None, ge=1, le=1_000_000)


class DatasetQualityMandatoryChecks(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    sourceAssociation: Literal[True]

    schemaCheck: Literal[True] = Field(alias="schema")
    exactDuplicates: Literal[True]
    fuzzyDuplicates: Literal[True]
    sensitivePersonalData: Literal[True]
    secretLikeContent: Literal[True]
    splitLeakage: Literal[True]


class DatasetQualityEffectivePolicy(BaseModel):
    policyId: str
    revision: str
    scope: Literal["workspace", "organization"]
    preset: Literal["recommended", "strict"]
    allowedLanguages: list[str]
    requireLicenseMetadata: bool
    requireConsentMetadata: bool
    includeSourceAttribution: bool = False
    excludedBenchmarkIds: list[str]
    maxRowsPerSource: int = Field(ge=1, le=1_000_000)
    minimumTextCharacters: int = Field(ge=0, le=1_000_000)
    maximumTextCharacters: int = Field(ge=1, le=1_000_000)
    fuzzyDuplicateSimilarity: float = Field(ge=0.0, le=1.0)
    maxFuzzyCandidatesPerRow: int = Field(ge=1, le=1024)
    maxReportSamplesPerReason: int = Field(ge=0, le=100)
    mandatoryChecks: DatasetQualityMandatoryChecks


class DatasetQualityRuntimeConfig(BaseModel):
    requestedPolicy: DatasetQualityRequestedPolicy
    effectivePolicy: DatasetQualityEffectivePolicy
    reviewRequired: bool


class AdvancedContentProcessingConfig(BaseModel):
    strategy: Literal["token", "sentence", "section", "table", "semantic", "layout"]
    maxTokensPerChunk: int | None = Field(default=None, ge=32, le=4096)
    maxSourceSpans: int | None = Field(default=None, ge=1, le=100_000)
    semanticBoundaryThreshold: float | None = Field(default=None, ge=0.0, le=1.0)
    layoutEnabled: bool | None = None
    ocrEnabled: bool | None = None


class AdvancedSemanticCurationConfig(BaseModel):
    enabled: bool
    embeddingAlgorithm: Literal["hashed-token-v1"] | None = None
    similarityThreshold: float | None = Field(default=None, ge=0.0, le=1.0)
    maxComparisonsPerRow: int | None = Field(default=None, ge=1, le=1024)
    maxRowsPerSource: int | None = Field(default=None, ge=1, le=1_000_000)
    balanceField: str | None = Field(default=None, max_length=128)
    hardNegativeMining: bool | None = None


class AdvancedSyntheticVerificationConfig(BaseModel):
    enabled: bool
    candidatesPerChunk: int | None = Field(default=None, ge=1, le=4)
    minimumGroundingScore: float | None = Field(default=None, ge=0.0, le=1.0)
    minimumCriticScore: float | None = Field(default=None, ge=0.0, le=1.0)
    minimumDiversityScore: float | None = Field(default=None, ge=0.0, le=1.0)
    requireReview: bool | None = None


class DatasetPreparationAdvancedConfig(BaseModel):
    preset: Literal[
        "standard",
        "better-document-understanding",
        "generate-examples",
        "topic-aware",
        "structure-aware",
    ]
    content: AdvancedContentProcessingConfig | None = None
    semantic: AdvancedSemanticCurationConfig | None = None
    synthetic: AdvancedSyntheticVerificationConfig | None = None


class PrepareTrainingDatasetRequest(BaseModel):
    workspaceId: str | None = None
    sourceInputs: list[DatasetPreparationSourceInput]
    preparation: DatasetPreparationExecutionPlan | None = None
    recipe: DatasetPreparationRecipe
    split: DatasetSplitConfig
    output: DatasetOutputConfig
    quality: DatasetQualityRuntimeConfig | None = None
    advanced: DatasetPreparationAdvancedConfig | None = None
    runtime: dict[str, Any] | None = None


class ReviewDatasetRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    operation: Literal["read", "reject", "replace"]
    inputPath: str
    outputHandle: str = "reviewed.parquet"
    page: int = Field(default=0, ge=0)
    pageSize: Literal[10, 25, 50] = 10
    rowIndex: int = Field(default=0, ge=0)
    rowFingerprint: str = Field(
        default="sha256:" + ("0" * 64),
        pattern=r"^sha256:[a-f0-9]{64}$",
    )
    replacementRow: dict[str, Any] | None = None
    runtime: dict[str, Any]


class PythonRuntimeOutputDescriptor(BaseModel):
    name: str
    role: Literal["dataset", "train", "validation", "test", "metrics", "report", "quarantine", "review", "artifact"] | None = None
    outputHandle: str
    tempPath: str = Field(exclude=True)
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
    validationRowCount: int
    testRowCount: int
    acceptedRowCount: int | None = None
    quarantinedRowCount: int | None = None


class DatasetPreparationWarning(BaseModel):
    code: str
    message: str
    sourceArtifactId: str | None = None


class PrepareTrainingDatasetResult(BaseModel):
    outputs: list[PythonRuntimeOutputDescriptor]
    summary: DatasetPreparationSummary
    qualityReport: dict[str, Any] | None = None
    advancedReport: dict[str, Any] | None = None
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
    metadata: dict[str, Any] | None = None


class TrainModelTaskRequest(BaseModel):
    trainingTask: str | None = None
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
    model_config = ConfigDict(extra="forbid")

    modelRecordId: str
    modelPath: str
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
