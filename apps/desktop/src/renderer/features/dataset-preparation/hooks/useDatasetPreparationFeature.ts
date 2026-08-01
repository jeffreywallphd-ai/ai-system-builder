import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";

import type { ModelDefaultInferenceMode } from "../../../../../../../modules/contracts/settings";
import type { DatasetVersionReproduction } from "../../../../../../../modules/contracts/dataset";
import { createWorkspaceId } from "../../../../../../../modules/contracts/workspace";
import type {
  DatasetPreparationTaskType,
  DatasetPreparationAdvancedReport,
  DatasetPreparationAdvancedPreset,
  DatasetPreparationAdaptiveResolution,
  DatasetPreparationExecutionPlan,
  DatasetPreparationConstrainedJsonResolution,
  DatasetPreparationGenerationCapacitySnapshot,
  DatasetPreparationMemoryOverflowPolicy,
  DatasetPreparationMethodId,
  DatasetPreparationTextInputMode,
  DatasetQualityPreset,
  DatasetQualityReport,
  DatasetPreparationVisualOutputShape,
} from "../../../../../../../modules/contracts/runtime";
import {
  DATASET_PREPARATION_TEXT_GENERATION_MODEL_PRESETS,
  createDatasetPreparationExecutionPlan,
  createDefaultDatasetPreparationTaskRecipe,
  createDefaultDatasetPreparationVisualOutputShape,
  compileDatasetPreparationVisualOutputShape,
  isDatasetPreparationTaskType,
  resolveDatasetPreparationTaskProfileDefinition,
  resolveDatasetPreparationAdaptivePlan,
  resolveDatasetPreparationMethodOption,
  resolveDatasetPreparationSourceCapability,
  resolveDefaultDatasetPreparationPromptTemplate,
  resolveDefaultDatasetPreparationTextGenerationParameterDefaults,
  resolveDefaultDatasetPreparationTextGenerationModel,
  resolveDatasetPreparationConstrainedJson,
  resolveDatasetPreparationGenerationModelCapacity,
  resolveDatasetPreparationGenerationModelEstimatedBytes,
  validateDatasetPreparationSaveName,
} from "../../../../../../../modules/contracts/runtime";
import {
  createDesktopApplicationSettingsClient,
  type DesktopApplicationSettingsClient,
} from "../../settings";
import {
  createDesktopPythonRuntimeClient,
  type DesktopPythonRuntimeClient,
} from "../../python-runtime/api/desktopPythonRuntimeClient";
import type { DesktopDatasetPreparationClient } from "../api/desktopDatasetPreparationClient";
import { buildDatasetPreparationRequest } from "./datasetPreparationRequestBuilder";
import { validateAndParseDatasetPreparationInputs } from "./datasetPreparationRequestValidation";
import { useDatasetPreparationClient } from "./useDatasetPreparationClient";
import {
  isTransientDatasetPreparationTransportError,
  resolveUserFacingDatasetPreparationErrorMessage,
} from "./datasetPreparationTransport";
import { announceDatasetPreparationStarted } from "./datasetPreparationNotificationEvents";
import {
  createDesktopModelsClient,
  type DesktopModelsClient,
} from "../../models/api/desktopModelsClient";
import type { DesktopModelInventoryRecord } from "../../../lib/desktopApi";
import {
  filterGeneratedDatasetPreparationArtifacts,
  filterTaskRelevantDatasetPreparationArtifacts,
  filterUploadedDatasetPreparationArtifacts,
  type DatasetPreparationSourceArtifact,
} from "../helpers/datasetPreparationArtifactGrouping";

interface DatasetPreparationStatus {
  kind: "idle" | "loading" | "success" | "error";
  message?: string;
}

interface DatasetPreparationResultSummary {
  datasetKey: string;
  datasetRows: number;
  trainRows: number;
  validationRows: number;
  testRows: number;
  warnings: string[];
  datasetVersion?: {
    versionId: string;
    datasetId: string;
    versionDigest: string;
    createdAt: string;
  };
}

interface DatasetPreparationPageState {
  selectedArtifactStorageFilter: DatasetPreparationArtifactStorageFilter;
  selectedArtifactIds: string[];
  advancedPreset: DatasetPreparationAdvancedPreset;
  preparationMethodId?: DatasetPreparationMethodId;
  taskType: DatasetPreparationTaskType;
  labelSet: string;
  multiLabel: boolean;
  extractionStrictSchema: boolean;
  diffusionConceptKind: "subject" | "style" | "concept";
  diffusionTriggerToken: string;
  diffusionRegularizationClass: string;
  detectionBoxFormat: "coco" | "xyxy" | "xywh";
  segmentationMaskFormat: "png" | "coco-rle" | "polygon";
  textInputMode: DatasetPreparationTextInputMode;
  textGenerationPrompt: string;
  visualOutputShape: DatasetPreparationVisualOutputShape;
  constrainedDecodingPreference?: boolean;
  unsupportedDocumentPolicy: "" | "fail" | "skip";
  normalizationMode: "" | "best-effort" | "strict";
  chunkSize: string;
  chunkOverlap: string;
  preserveDocumentBoundaries: boolean;
  maxChunkCount: string;
  maxTokensPerChunk: string;
  topicBoundarySensitivity: string;
  maxSourceSpans: string;
  similarityThreshold: string;
  modelId: string;
  modelInferenceMode: ModelDefaultInferenceMode;
  modelDevice: "" | "auto" | "cpu" | "cuda";
  modelTorchDtype: "" | "auto" | "float16" | "bfloat16" | "float32";
  modelMemoryOverflowPolicy: DatasetPreparationMemoryOverflowPolicy;
  maxExamplesPerChunk: string;
  batchSize: string;
  failurePolicy: "" | "fail" | "skip";
  generationTemperature: string;
  generationTopP: string;
  generationMaxNewTokens: string;
  trainRatio: string;
  validationRatio: string;
  testRatio: string;
  seed: string;
  shuffle: boolean;
  outputFormat: "jsonl" | "json" | "csv" | "parquet";
  outputBaseName: string;
  localDestinationEnabled: boolean;
  huggingFaceDestinationEnabled: boolean;
  huggingFaceRepository: string;
  huggingFaceRevision: string;
  huggingFacePathPrefix: string;
  qualityPreset: DatasetQualityPreset;
  requireLicenseMetadata: boolean;
  requireConsentMetadata: boolean;
  includeSourceAttribution: boolean;
  status: DatasetPreparationStatus;
  resultSummary?: DatasetPreparationResultSummary;
  qualityReview?: {
    requestId: string;
    report: DatasetQualityReport;
    advancedReport?: DatasetPreparationAdvancedReport;
  };
  activeTaskRequestId?: string;
  activeTaskType?: "dataset-preparation";
  activeTaskStartedAt?: string;
}

export type DatasetPreparationArtifactStorageFilter =
  "all" | "uploaded" | "generated";

type DatasetPreparationTrainingSettingsSnapshot = Omit<
  DatasetPreparationPageState,
  | "selectedArtifactStorageFilter"
  | "selectedArtifactIds"
  | "status"
  | "resultSummary"
  | "qualityReview"
  | "activeTaskRequestId"
  | "activeTaskType"
  | "activeTaskStartedAt"
>;

export interface SavedDatasetPreparationTrainingSettings {
  id: string;
  label: string;
  savedAt: string;
  settings: DatasetPreparationTrainingSettingsSnapshot;
}

export interface UseDatasetPreparationFeatureResult {
  artifacts: DatasetPreparationSourceArtifact[];
  allArtifactCount: number;
  filteredArtifacts: DatasetPreparationSourceArtifact[];
  uploadedArtifacts: DatasetPreparationSourceArtifact[];
  generatedArtifacts: DatasetPreparationSourceArtifact[];
  selectedArtifactStorageFilter: DatasetPreparationArtifactStorageFilter;
  selectedArtifactIds: string[];
  advancedPreset: DatasetPreparationAdvancedPreset;
  preparationResolution: DatasetPreparationAdaptiveResolution;
  preparationPlan?: DatasetPreparationExecutionPlan;
  preparationMethodId?: DatasetPreparationMethodId;
  taskType: DatasetPreparationTaskType;
  labelSet: string;
  multiLabel: boolean;
  extractionStrictSchema: boolean;
  diffusionConceptKind: "subject" | "style" | "concept";
  diffusionTriggerToken: string;
  diffusionRegularizationClass: string;
  detectionBoxFormat: "coco" | "xyxy" | "xywh";
  segmentationMaskFormat: "png" | "coco-rle" | "polygon";
  textInputMode: DatasetPreparationTextInputMode;
  textGenerationPrompt: string;
  visualOutputShape: DatasetPreparationVisualOutputShape;
  constrainedJsonResolution: DatasetPreparationConstrainedJsonResolution;
  constrainedDecodingEnabled: boolean;
  constrainedDecodingAvailable: boolean;
  unsupportedDocumentPolicy: "" | "fail" | "skip";
  normalizationMode: "" | "best-effort" | "strict";
  chunkSize: string;
  chunkOverlap: string;
  preserveDocumentBoundaries: boolean;
  maxChunkCount: string;
  maxTokensPerChunk: string;
  topicBoundarySensitivity: string;
  maxSourceSpans: string;
  similarityThreshold: string;
  modelId: string;
  modelInferenceMode: ModelDefaultInferenceMode;
  modelDevice: "" | "auto" | "cpu" | "cuda";
  modelTorchDtype: "" | "auto" | "float16" | "bfloat16" | "float32";
  modelMemoryOverflowPolicy: DatasetPreparationMemoryOverflowPolicy;
  maxExamplesPerChunk: string;
  batchSize: string;
  failurePolicy: "" | "fail" | "skip";
  generationTemperature: string;
  generationTopP: string;
  generationMaxNewTokens: string;
  trainRatio: string;
  validationRatio: string;
  testRatio: string;
  seed: string;
  shuffle: boolean;
  outputFormat: "jsonl" | "json" | "csv" | "parquet";
  outputBaseName: string;
  localDestinationEnabled: boolean;
  huggingFaceDestinationEnabled: boolean;
  huggingFaceRepository: string;
  huggingFaceRevision: string;
  huggingFacePathPrefix: string;
  qualityPreset: DatasetQualityPreset;
  requireLicenseMetadata: boolean;
  requireConsentMetadata: boolean;
  includeSourceAttribution: boolean;
  defaultHuggingFaceNamespace?: string;
  status: DatasetPreparationStatus;
  resultSummary?: DatasetPreparationResultSummary;
  qualityReview?: {
    requestId: string;
    report: DatasetQualityReport;
    advancedReport?: DatasetPreparationAdvancedReport;
  };
  reviewActionInFlight: boolean;
  loadedModelCount: number;
  canUnloadModel: boolean;
  stopTrainingInFlight: boolean;
  unloadModelInFlight: boolean;
  selectedGenerationModelAvailable: boolean;
  generationModelAvailabilityChecked: boolean;
  modelDownloadInFlight: boolean;
  modelDownloadStatus: DatasetPreparationStatus;
  savedTrainingSettings: SavedDatasetPreparationTrainingSettings[];
  selectedSavedTrainingSettingsId: string;
  hasTrainingSettingsChanges: boolean;
  onToggleArtifact: (artifactId: string) => void;
  setAdvancedPreset: (value: DatasetPreparationAdvancedPreset) => void;
  setPreparationMethodId: (value: DatasetPreparationMethodId) => void;
  setSelectedArtifactStorageFilter: (
    value: DatasetPreparationArtifactStorageFilter,
  ) => void;
  setTaskType: (value: DatasetPreparationTaskType) => void;
  setLabelSet: (value: string) => void;
  setMultiLabel: (value: boolean) => void;
  setExtractionStrictSchema: (value: boolean) => void;
  setDiffusionConceptKind: (value: "subject" | "style" | "concept") => void;
  setDiffusionTriggerToken: (value: string) => void;
  setDiffusionRegularizationClass: (value: string) => void;
  setDetectionBoxFormat: (value: "coco" | "xyxy" | "xywh") => void;
  setSegmentationMaskFormat: (value: "png" | "coco-rle" | "polygon") => void;
  setTextInputMode: (value: DatasetPreparationTextInputMode) => void;
  setTextGenerationPrompt: (value: string) => void;
  setVisualOutputShape: (value: DatasetPreparationVisualOutputShape) => void;
  setConstrainedDecodingPreference: (value: boolean) => void;
  setUnsupportedDocumentPolicy: (value: "" | "fail" | "skip") => void;
  setNormalizationMode: (value: "" | "best-effort" | "strict") => void;
  setChunkSize: (value: string) => void;
  setChunkOverlap: (value: string) => void;
  setPreserveDocumentBoundaries: (value: boolean) => void;
  setMaxChunkCount: (value: string) => void;
  setMaxTokensPerChunk: (value: string) => void;
  setTopicBoundarySensitivity: (value: string) => void;
  setMaxSourceSpans: (value: string) => void;
  setSimilarityThreshold: (value: string) => void;
  setModelId: (value: string) => void;
  setModelInferenceMode: (value: ModelDefaultInferenceMode) => void;
  setModelDevice: (value: "" | "auto" | "cpu" | "cuda") => void;
  setModelTorchDtype: (
    value: "" | "auto" | "float16" | "bfloat16" | "float32",
  ) => void;
  setModelMemoryOverflowPolicy: (
    value: DatasetPreparationMemoryOverflowPolicy,
  ) => void;
  setMaxExamplesPerChunk: (value: string) => void;
  setBatchSize: (value: string) => void;
  setFailurePolicy: (value: "" | "fail" | "skip") => void;
  setGenerationTemperature: (value: string) => void;
  setGenerationTopP: (value: string) => void;
  setGenerationMaxNewTokens: (value: string) => void;
  setTrainRatio: (value: string) => void;
  setValidationRatio: (value: string) => void;
  setTestRatio: (value: string) => void;
  setSeed: (value: string) => void;
  setShuffle: (value: boolean) => void;
  setOutputFormat: (value: "jsonl" | "json" | "csv" | "parquet") => void;
  setOutputBaseName: (value: string) => void;
  setLocalDestinationEnabled: (value: boolean) => void;
  setHuggingFaceDestinationEnabled: (value: boolean) => void;
  setHuggingFaceRepository: (value: string) => void;
  setHuggingFaceRevision: (value: string) => void;
  setHuggingFacePathPrefix: (value: string) => void;
  setQualityPreset: (value: DatasetQualityPreset) => void;
  setRequireLicenseMetadata: (value: boolean) => void;
  setRequireConsentMetadata: (value: boolean) => void;
  setIncludeSourceAttribution: (value: boolean) => void;
  setSelectedSavedTrainingSettingsId: (value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => Promise<void>;
  onStopTraining: () => Promise<void>;
  onApproveReview: () => Promise<void>;
  onDiscardReview: () => Promise<void>;
  onUnloadModel: () => Promise<void>;
  onDownloadGenerationModel: () => Promise<void>;
  onSaveTrainingSettings: () => void;
  onLoadTrainingSettings: () => void;
  onReuseDatasetVersion: (reproduction: DatasetVersionReproduction) => void;
}

export interface UseDatasetPreparationFeatureOptions {
  client?: DesktopDatasetPreparationClient;
  settingsClient?: DesktopApplicationSettingsClient;
  modelsClient?: DesktopModelsClient;
  runtimeStatusClient?: Pick<
    DesktopPythonRuntimeClient,
    "readStatus" | "controlRuntime"
  >;
  onPrepared?: (artifactStorageKey: string) => void;
  workspaceId?: string;
}

const DATASET_PREPARATION_TRAINING_SETTINGS_STORAGE_KEY =
  "ai-system-builder.datasetPreparation.trainingSettings.v1";

function stringifyDefaultNumber(value: number | undefined): string {
  return typeof value === "number" ? String(value) : "";
}

function resolveDefaultGenerationParameterState(
  taskType: DatasetPreparationTaskType,
) {
  const defaults =
    resolveDefaultDatasetPreparationTextGenerationParameterDefaults(taskType);
  return {
    maxExamplesPerChunk: stringifyDefaultNumber(defaults?.maxExamplesPerChunk),
    batchSize: stringifyDefaultNumber(defaults?.batchSize),
    failurePolicy: (defaults?.failurePolicy ?? "skip") as "" | "fail" | "skip",
    generationTemperature: stringifyDefaultNumber(defaults?.temperature),
    generationTopP: stringifyDefaultNumber(defaults?.topP),
    generationMaxNewTokens: stringifyDefaultNumber(defaults?.maxNewTokens),
  };
}

const defaultTaskGenerationParameters =
  resolveDefaultGenerationParameterState("llm-instruction");
const defaultTaskGenerationModel =
  resolveDefaultDatasetPreparationTextGenerationModel("llm-instruction");

const defaultDatasetPreparationPageState: DatasetPreparationPageState = {
  selectedArtifactStorageFilter: "all",
  selectedArtifactIds: [],
  advancedPreset: "standard",
  preparationMethodId: undefined,
  taskType: "llm-instruction",
  labelSet: "",
  multiLabel: false,
  extractionStrictSchema: true,
  diffusionConceptKind: "subject",
  diffusionTriggerToken: "",
  diffusionRegularizationClass: "",
  detectionBoxFormat: "coco",
  segmentationMaskFormat: "png",
  textInputMode: "generate",
  textGenerationPrompt:
    resolveDefaultDatasetPreparationPromptTemplate("llm-instruction") ?? "",
  visualOutputShape:
    createDefaultDatasetPreparationVisualOutputShape("llm-instruction"),
  constrainedDecodingPreference: undefined,
  unsupportedDocumentPolicy: "",
  normalizationMode: "",
  chunkSize: "1000",
  chunkOverlap: "200",
  preserveDocumentBoundaries: true,
  maxChunkCount: "",
  maxTokensPerChunk: "320",
  topicBoundarySensitivity: "0.22",
  maxSourceSpans: "10000",
  similarityThreshold: "0.9",
  modelId: defaultTaskGenerationModel?.modelId ?? "",
  modelInferenceMode: defaultTaskGenerationModel?.inferenceMode ?? "auto",
  modelDevice: defaultTaskGenerationModel?.device ?? "auto",
  modelTorchDtype: defaultTaskGenerationModel?.torchDtype ?? "",
  modelMemoryOverflowPolicy: "limited",
  maxExamplesPerChunk: defaultTaskGenerationParameters.maxExamplesPerChunk,
  batchSize: defaultTaskGenerationParameters.batchSize,
  failurePolicy: defaultTaskGenerationParameters.failurePolicy,
  generationTemperature: defaultTaskGenerationParameters.generationTemperature,
  generationTopP: defaultTaskGenerationParameters.generationTopP,
  generationMaxNewTokens:
    defaultTaskGenerationParameters.generationMaxNewTokens,
  trainRatio: "0.8",
  validationRatio: "0.1",
  testRatio: "0.1",
  seed: "",
  shuffle: true,
  outputFormat: "parquet",
  outputBaseName: "",
  localDestinationEnabled: true,
  huggingFaceDestinationEnabled: false,
  huggingFaceRepository: "",
  huggingFaceRevision: "",
  huggingFacePathPrefix: "",
  qualityPreset: "recommended",
  requireLicenseMetadata: false,
  requireConsentMetadata: false,
  includeSourceAttribution: false,
  status: { kind: "idle" },
  resultSummary: undefined,
  qualityReview: undefined,
  activeTaskRequestId: undefined,
  activeTaskType: undefined,
  activeTaskStartedAt: undefined,
};

let cachedDatasetPreparationPageState: DatasetPreparationPageState = {
  ...defaultDatasetPreparationPageState,
};
let cachedDatasetPreparationModelSelectionExplicit = false;

export function resetDatasetPreparationPageStateForTests(): void {
  cachedDatasetPreparationPageState = { ...defaultDatasetPreparationPageState };
  cachedDatasetPreparationModelSelectionExplicit = false;
  try {
    if (typeof window !== "undefined") {
      window.localStorage?.removeItem(
        DATASET_PREPARATION_TRAINING_SETTINGS_STORAGE_KEY,
      );
    }
  } catch {
    // Tests and restricted browser contexts may not expose localStorage.
  }
}

function createDatasetPreparationRequestId(): string {
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
  ) {
    return `dataset-preparation-${crypto.randomUUID()}`;
  }

  return `dataset-preparation-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function createSavedTrainingSettingsId(): string {
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
  ) {
    return `training-settings-${crypto.randomUUID()}`;
  }

  return `training-settings-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function readSavedTrainingSettingsFromStorage(): SavedDatasetPreparationTrainingSettings[] {
  if (typeof window === "undefined") {
    return [];
  }

  try {
    const raw = window.localStorage?.getItem(
      DATASET_PREPARATION_TRAINING_SETTINGS_STORAGE_KEY,
    );
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed
      .filter((entry): entry is SavedDatasetPreparationTrainingSettings => {
        if (typeof entry !== "object" || entry === null) {
          return false;
        }
        const candidate = entry as SavedDatasetPreparationTrainingSettings;
        return (
          typeof candidate.id === "string" &&
          typeof candidate.label === "string" &&
          typeof candidate.savedAt === "string" &&
          typeof candidate.settings === "object" &&
          candidate.settings !== null &&
          isDatasetPreparationTaskType(
            (candidate.settings as { taskType?: string }).taskType ?? "",
          )
        );
      })
      .map((entry) => ({
        ...entry,
        settings: {
          ...createDefaultTrainingSettingsSnapshot(entry.settings.taskType),
          ...entry.settings,
        },
      }));
  } catch {
    return [];
  }
}

function writeSavedTrainingSettingsToStorage(
  settings: SavedDatasetPreparationTrainingSettings[],
): void {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage?.setItem(
      DATASET_PREPARATION_TRAINING_SETTINGS_STORAGE_KEY,
      JSON.stringify(settings),
    );
  } catch {
    // Saved settings are a convenience feature; the form still works if browser storage is unavailable.
  }
}

function createDefaultTrainingSettingsSnapshot(
  taskType: DatasetPreparationTaskType,
): DatasetPreparationTrainingSettingsSnapshot {
  const profile = resolveDatasetPreparationTaskProfileDefinition(taskType);
  const taskModelDefault =
    resolveDefaultDatasetPreparationTextGenerationModel(taskType);
  const generationParameters = resolveDefaultGenerationParameterState(taskType);
  return {
    advancedPreset: "standard",
    preparationMethodId: undefined,
    taskType,
    labelSet: "",
    multiLabel: false,
    extractionStrictSchema: true,
    diffusionConceptKind: "subject",
    diffusionTriggerToken: "",
    diffusionRegularizationClass: "",
    detectionBoxFormat: "coco",
    segmentationMaskFormat: "png",
    textInputMode: resolveDefaultTextInputMode(taskType),
    textGenerationPrompt:
      resolveDefaultDatasetPreparationPromptTemplate(taskType) ?? "",
    visualOutputShape:
      createDefaultDatasetPreparationVisualOutputShape(taskType),
    constrainedDecodingPreference: undefined,
    unsupportedDocumentPolicy: "",
    normalizationMode: "",
    chunkSize: defaultDatasetPreparationPageState.chunkSize,
    chunkOverlap: defaultDatasetPreparationPageState.chunkOverlap,
    preserveDocumentBoundaries:
      defaultDatasetPreparationPageState.preserveDocumentBoundaries,
    maxChunkCount: "",
    maxTokensPerChunk: "320",
    topicBoundarySensitivity: "0.22",
    maxSourceSpans: "10000",
    similarityThreshold: "0.9",
    modelId: taskModelDefault?.modelId ?? "",
    modelInferenceMode: taskModelDefault?.inferenceMode ?? "auto",
    modelDevice: taskModelDefault?.device ?? "auto",
    modelTorchDtype: taskModelDefault?.torchDtype ?? "",
    modelMemoryOverflowPolicy: "limited",
    maxExamplesPerChunk: generationParameters.maxExamplesPerChunk,
    batchSize: generationParameters.batchSize,
    failurePolicy: generationParameters.failurePolicy,
    generationTemperature: generationParameters.generationTemperature,
    generationTopP: generationParameters.generationTopP,
    generationMaxNewTokens: generationParameters.generationMaxNewTokens,
    trainRatio: defaultDatasetPreparationPageState.trainRatio,
    validationRatio: defaultDatasetPreparationPageState.validationRatio,
    testRatio: defaultDatasetPreparationPageState.testRatio,
    seed: "",
    shuffle: defaultDatasetPreparationPageState.shuffle,
    outputFormat: profile.preferredOutputFormat,
    outputBaseName: "",
    localDestinationEnabled: true,
    huggingFaceDestinationEnabled: false,
    huggingFaceRepository: "",
    huggingFaceRevision: "",
    huggingFacePathPrefix: "",
    qualityPreset: "recommended",
    requireLicenseMetadata: false,
    requireConsentMetadata: false,
    includeSourceAttribution: false,
  };
}

function serializeTrainingSettingsSnapshot(
  snapshot: DatasetPreparationTrainingSettingsSnapshot,
): string {
  return JSON.stringify(snapshot);
}

function splitConfiguredLabels(value: string): string[] | undefined {
  const labels = value
    .split(",")
    .map((label) => label.trim())
    .filter(Boolean);
  return labels.length > 0 ? labels : undefined;
}

function resolveDefaultTextInputMode(
  taskType: DatasetPreparationTaskType,
): DatasetPreparationTextInputMode {
  return (
    createDefaultDatasetPreparationTaskRecipe(taskType).textInputMode ??
    "provided"
  );
}

function normalizeModelIdentity(value: string | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

function isUsableGenerationModelRecord(
  record: DesktopModelInventoryRecord,
  selectedModelId: string,
): boolean {
  const lifecycleStatus = record.lifecycleStatus;
  return (
    normalizeModelIdentity(record.modelId) ===
      normalizeModelIdentity(selectedModelId) &&
    (lifecycleStatus === "downloaded" ||
      lifecycleStatus === "generated" ||
      lifecycleStatus === "validated")
  );
}

function appendErrorDetailsMessage(
  message: string,
  details: Record<string, unknown> | undefined,
): string {
  if (!details) {
    return message;
  }

  const reason =
    typeof details.reason === "string" ? details.reason : undefined;
  const status =
    typeof details.providerStatusCode === "number"
      ? details.providerStatusCode
      : undefined;
  const repository =
    typeof details.repository === "string" ? details.repository : undefined;
  const pathInRepo =
    typeof details.pathInRepo === "string" ? details.pathInRepo : undefined;
  const suffix = [
    reason,
    status ? `status ${status}` : undefined,
    repository,
    pathInRepo,
  ]
    .filter(
      (part): part is string =>
        typeof part === "string" && part.trim().length > 0,
    )
    .join(" | ");
  return suffix ? `${message} Details: ${suffix}.` : message;
}

function isTransientPollReadFailure(
  message: string,
  details?: Record<string, unknown>,
): boolean {
  const normalized = message.toLowerCase();
  if (
    normalized.includes("fetch failed") ||
    normalized.includes("network") ||
    normalized.includes("transport")
  ) {
    return true;
  }
  return typeof details?.retryable === "boolean" ? details.retryable : false;
}

export function useDatasetPreparationFeature(
  options: UseDatasetPreparationFeatureOptions = {},
): UseDatasetPreparationFeatureResult {
  const pollingRecoveryGraceWindowMs = 30_000;
  const onPrepared = options.onPrepared;
  const workspaceId = options.workspaceId;
  const datasetClient = useDatasetPreparationClient(options.client);
  const modelClient = useMemo<DesktopModelsClient | undefined>(() => {
    if (options.modelsClient) {
      return options.modelsClient;
    }
    try {
      return createDesktopModelsClient();
    } catch {
      return undefined;
    }
  }, [options.modelsClient]);
  const settingsClient = useMemo(() => {
    if (options.settingsClient) {
      return options.settingsClient;
    }
    try {
      return createDesktopApplicationSettingsClient();
    } catch {
      return undefined;
    }
  }, [options.settingsClient]);
  const runtimeStatusClient = useMemo(() => {
    if (options.runtimeStatusClient) {
      return options.runtimeStatusClient;
    }
    try {
      return createDesktopPythonRuntimeClient();
    } catch {
      return undefined;
    }
  }, [options.runtimeStatusClient]);
  const [artifacts, setArtifacts] = useState<
    DatasetPreparationSourceArtifact[]
  >([]);
  const [selectedArtifactStorageFilter, setSelectedArtifactStorageFilter] =
    useState<DatasetPreparationArtifactStorageFilter>(
      cachedDatasetPreparationPageState.selectedArtifactStorageFilter,
    );
  const [selectedArtifactIds, setSelectedArtifactIds] = useState<string[]>(
    cachedDatasetPreparationPageState.selectedArtifactIds,
  );
  const [taskType, setTaskType] = useState<DatasetPreparationTaskType>(
    cachedDatasetPreparationPageState.taskType,
  );
  const [advancedPreset, setAdvancedPreset] =
    useState<DatasetPreparationAdvancedPreset>(
      cachedDatasetPreparationPageState.advancedPreset,
    );
  const [requestedPreparationMethodId, setPreparationMethodId] = useState<
    DatasetPreparationMethodId | undefined
  >(cachedDatasetPreparationPageState.preparationMethodId);
  const [labelSet, setLabelSet] = useState(
    cachedDatasetPreparationPageState.labelSet,
  );
  const [multiLabel, setMultiLabel] = useState(
    cachedDatasetPreparationPageState.multiLabel,
  );
  const [extractionStrictSchema, setExtractionStrictSchema] = useState(
    cachedDatasetPreparationPageState.extractionStrictSchema,
  );
  const [diffusionConceptKind, setDiffusionConceptKind] = useState<
    "subject" | "style" | "concept"
  >(cachedDatasetPreparationPageState.diffusionConceptKind);
  const [diffusionTriggerToken, setDiffusionTriggerToken] = useState(
    cachedDatasetPreparationPageState.diffusionTriggerToken,
  );
  const [diffusionRegularizationClass, setDiffusionRegularizationClass] =
    useState(cachedDatasetPreparationPageState.diffusionRegularizationClass);
  const [detectionBoxFormat, setDetectionBoxFormat] = useState<
    "coco" | "xyxy" | "xywh"
  >(cachedDatasetPreparationPageState.detectionBoxFormat);
  const [segmentationMaskFormat, setSegmentationMaskFormat] = useState<
    "png" | "coco-rle" | "polygon"
  >(cachedDatasetPreparationPageState.segmentationMaskFormat);
  const [textInputMode, setTextInputMode] =
    useState<DatasetPreparationTextInputMode>(
      cachedDatasetPreparationPageState.textInputMode,
    );
  const [textGenerationPrompt, setTextGenerationPrompt] = useState(
    cachedDatasetPreparationPageState.textGenerationPrompt,
  );
  const [visualOutputShape, setVisualOutputShape] =
    useState<DatasetPreparationVisualOutputShape>(
      cachedDatasetPreparationPageState.visualOutputShape,
    );
  const [constrainedDecodingPreference, setConstrainedDecodingPreference] =
    useState<boolean | undefined>(
      cachedDatasetPreparationPageState.constrainedDecodingPreference,
    );
  const [generationCapacity, setGenerationCapacity] = useState<
    DatasetPreparationGenerationCapacitySnapshot | undefined
  >();
  const [unsupportedDocumentPolicy, setUnsupportedDocumentPolicy] = useState<
    "" | "fail" | "skip"
  >(cachedDatasetPreparationPageState.unsupportedDocumentPolicy);
  const [normalizationMode, setNormalizationMode] = useState<
    "" | "best-effort" | "strict"
  >(cachedDatasetPreparationPageState.normalizationMode);
  const [chunkSize, setChunkSize] = useState(
    cachedDatasetPreparationPageState.chunkSize,
  );
  const [chunkOverlap, setChunkOverlap] = useState(
    cachedDatasetPreparationPageState.chunkOverlap,
  );
  const [preserveDocumentBoundaries, setPreserveDocumentBoundaries] = useState(
    cachedDatasetPreparationPageState.preserveDocumentBoundaries,
  );
  const [maxChunkCount, setMaxChunkCount] = useState(
    cachedDatasetPreparationPageState.maxChunkCount,
  );
  const [maxTokensPerChunk, setMaxTokensPerChunk] = useState(
    cachedDatasetPreparationPageState.maxTokensPerChunk,
  );
  const [topicBoundarySensitivity, setTopicBoundarySensitivity] = useState(
    cachedDatasetPreparationPageState.topicBoundarySensitivity,
  );
  const [maxSourceSpans, setMaxSourceSpans] = useState(
    cachedDatasetPreparationPageState.maxSourceSpans,
  );
  const [similarityThreshold, setSimilarityThreshold] = useState(
    cachedDatasetPreparationPageState.similarityThreshold,
  );
  const modelSelectionExplicitRef = useRef(
    cachedDatasetPreparationModelSelectionExplicit,
  );
  const [modelId, setModelIdState] = useState(
    cachedDatasetPreparationPageState.modelId,
  );
  const [modelInferenceMode, setModelInferenceModeState] =
    useState<ModelDefaultInferenceMode>(
      cachedDatasetPreparationPageState.modelInferenceMode,
    );
  const [modelDevice, setModelDeviceState] = useState<
    "" | "auto" | "cpu" | "cuda"
  >(cachedDatasetPreparationPageState.modelDevice);
  const [modelTorchDtype, setModelTorchDtypeState] = useState<
    "" | "auto" | "float16" | "bfloat16" | "float32"
  >(cachedDatasetPreparationPageState.modelTorchDtype);
  const [modelMemoryOverflowPolicy, setModelMemoryOverflowPolicy] =
    useState<DatasetPreparationMemoryOverflowPolicy>(
      cachedDatasetPreparationPageState.modelMemoryOverflowPolicy ?? "limited",
    );
  const markModelSelectionExplicit = useCallback(() => {
    modelSelectionExplicitRef.current = true;
    cachedDatasetPreparationModelSelectionExplicit = true;
  }, []);
  const setModelId = useCallback(
    (value: string) => {
      markModelSelectionExplicit();
      setModelIdState(value);
    },
    [markModelSelectionExplicit],
  );
  const setModelInferenceMode = useCallback(
    (value: ModelDefaultInferenceMode) => {
      markModelSelectionExplicit();
      setModelInferenceModeState(value);
    },
    [markModelSelectionExplicit],
  );
  const setModelDevice = useCallback(
    (value: "" | "auto" | "cpu" | "cuda") => {
      markModelSelectionExplicit();
      setModelDeviceState(value);
    },
    [markModelSelectionExplicit],
  );
  const setModelTorchDtype = useCallback(
    (value: "" | "auto" | "float16" | "bfloat16" | "float32") => {
      markModelSelectionExplicit();
      setModelTorchDtypeState(value);
    },
    [markModelSelectionExplicit],
  );
  const [maxExamplesPerChunk, setMaxExamplesPerChunk] = useState(
    cachedDatasetPreparationPageState.maxExamplesPerChunk,
  );
  const [batchSize, setBatchSize] = useState(
    cachedDatasetPreparationPageState.batchSize,
  );
  const [failurePolicy, setFailurePolicy] = useState<"" | "fail" | "skip">(
    cachedDatasetPreparationPageState.failurePolicy,
  );
  const [generationTemperature, setGenerationTemperature] = useState(
    cachedDatasetPreparationPageState.generationTemperature,
  );
  const [generationTopP, setGenerationTopP] = useState(
    cachedDatasetPreparationPageState.generationTopP,
  );
  const [generationMaxNewTokens, setGenerationMaxNewTokens] = useState(
    cachedDatasetPreparationPageState.generationMaxNewTokens,
  );
  const [trainRatio, setTrainRatio] = useState(
    cachedDatasetPreparationPageState.trainRatio,
  );
  const [validationRatio, setValidationRatio] = useState(
    cachedDatasetPreparationPageState.validationRatio,
  );
  const [testRatio, setTestRatio] = useState(
    cachedDatasetPreparationPageState.testRatio,
  );
  const [seed, setSeed] = useState(cachedDatasetPreparationPageState.seed);
  const [shuffle, setShuffle] = useState(
    cachedDatasetPreparationPageState.shuffle,
  );
  const [outputFormat, setOutputFormat] = useState<
    "jsonl" | "json" | "csv" | "parquet"
  >(cachedDatasetPreparationPageState.outputFormat);
  const [outputBaseName, setOutputBaseName] = useState(
    cachedDatasetPreparationPageState.outputBaseName,
  );
  const [localDestinationEnabled, setLocalDestinationEnabled] = useState(
    cachedDatasetPreparationPageState.localDestinationEnabled,
  );
  const [huggingFaceDestinationEnabled, setHuggingFaceDestinationEnabled] =
    useState(cachedDatasetPreparationPageState.huggingFaceDestinationEnabled);
  const [huggingFaceRepository, setHuggingFaceRepository] = useState(
    cachedDatasetPreparationPageState.huggingFaceRepository,
  );
  const [huggingFaceRevision, setHuggingFaceRevision] = useState(
    cachedDatasetPreparationPageState.huggingFaceRevision,
  );
  const [huggingFacePathPrefix, setHuggingFacePathPrefix] = useState(
    cachedDatasetPreparationPageState.huggingFacePathPrefix,
  );
  const [qualityPreset, setQualityPreset] = useState<DatasetQualityPreset>(
    cachedDatasetPreparationPageState.qualityPreset,
  );
  const [requireLicenseMetadata, setRequireLicenseMetadata] = useState(
    cachedDatasetPreparationPageState.requireLicenseMetadata,
  );
  const [requireConsentMetadata, setRequireConsentMetadata] = useState(
    cachedDatasetPreparationPageState.requireConsentMetadata,
  );
  const [includeSourceAttribution, setIncludeSourceAttribution] = useState(
    cachedDatasetPreparationPageState.includeSourceAttribution,
  );
  const [status, setStatus] = useState<DatasetPreparationStatus>(
    cachedDatasetPreparationPageState.status,
  );
  const [resultSummary, setResultSummary] = useState<
    DatasetPreparationResultSummary | undefined
  >(cachedDatasetPreparationPageState.resultSummary);
  const [qualityReview, setQualityReview] = useState<
    | {
        requestId: string;
        report: DatasetQualityReport;
        advancedReport?: DatasetPreparationAdvancedReport;
      }
    | undefined
  >(cachedDatasetPreparationPageState.qualityReview);
  const [defaultHuggingFaceNamespace, setDefaultHuggingFaceNamespace] =
    useState<string | undefined>(undefined);
  const [activeTaskRequestId, setActiveTaskRequestId] = useState<
    string | undefined
  >(cachedDatasetPreparationPageState.activeTaskRequestId);
  const [activeTaskStartedAt, setActiveTaskStartedAt] = useState<
    string | undefined
  >(cachedDatasetPreparationPageState.activeTaskStartedAt);
  const [loadedModelCount, setLoadedModelCount] = useState(0);
  const [runtimeActiveTaskCount, setRuntimeActiveTaskCount] = useState(0);
  const [stopTrainingInFlight, setStopTrainingInFlight] = useState(false);
  const [reviewActionInFlight, setReviewActionInFlight] = useState(false);
  const [unloadModelInFlight, setUnloadModelInFlight] = useState(false);
  const [generationModelRecords, setGenerationModelRecords] = useState<
    DesktopModelInventoryRecord[]
  >([]);
  const [
    generationModelAvailabilityChecked,
    setGenerationModelAvailabilityChecked,
  ] = useState(false);
  const [modelDownloadStatus, setModelDownloadStatus] =
    useState<DatasetPreparationStatus>({ kind: "idle" });
  const [savedTrainingSettings, setSavedTrainingSettings] = useState<
    SavedDatasetPreparationTrainingSettings[]
  >(() => readSavedTrainingSettingsFromStorage());
  const [selectedSavedTrainingSettingsId, setSelectedSavedTrainingSettingsId] =
    useState("");
  const stopTrainingRequestedRef = useRef(false);
  const activePollingRequestIdRef = useRef<string | undefined>(undefined);
  const pollingSessionIdRef = useRef(0);
  const isMountedRef = useRef(false);
  const suppressNextTaskDefaultResetRef = useRef(false);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      activePollingRequestIdRef.current = undefined;
      pollingSessionIdRef.current += 1;
    };
  }, []);

  useEffect(() => {
    cachedDatasetPreparationPageState = {
      selectedArtifactStorageFilter,
      selectedArtifactIds,
      advancedPreset,
      preparationMethodId: requestedPreparationMethodId,
      taskType,
      labelSet,
      multiLabel,
      extractionStrictSchema,
      diffusionConceptKind,
      diffusionTriggerToken,
      diffusionRegularizationClass,
      detectionBoxFormat,
      segmentationMaskFormat,
      textInputMode,
      textGenerationPrompt,
      visualOutputShape,
      constrainedDecodingPreference,
      unsupportedDocumentPolicy,
      normalizationMode,
      chunkSize,
      chunkOverlap,
      preserveDocumentBoundaries,
      maxChunkCount,
      maxTokensPerChunk,
      topicBoundarySensitivity,
      maxSourceSpans,
      similarityThreshold,
      modelId,
      modelInferenceMode,
      modelDevice,
      modelTorchDtype,
      modelMemoryOverflowPolicy,
      maxExamplesPerChunk,
      batchSize,
      failurePolicy,
      generationTemperature,
      generationTopP,
      generationMaxNewTokens,
      trainRatio,
      validationRatio,
      testRatio,
      seed,
      shuffle,
      outputFormat,
      outputBaseName,
      localDestinationEnabled,
      huggingFaceDestinationEnabled,
      huggingFaceRepository,
      huggingFaceRevision,
      huggingFacePathPrefix,
      qualityPreset,
      requireLicenseMetadata,
      requireConsentMetadata,
      includeSourceAttribution,
      status,
      resultSummary,
      qualityReview,
      activeTaskRequestId,
      activeTaskType: activeTaskRequestId ? "dataset-preparation" : undefined,
      activeTaskStartedAt,
    };
  }, [
    selectedArtifactStorageFilter,
    selectedArtifactIds,
    advancedPreset,
    requestedPreparationMethodId,
    taskType,
    labelSet,
    multiLabel,
    extractionStrictSchema,
    diffusionConceptKind,
    diffusionTriggerToken,
    diffusionRegularizationClass,
    detectionBoxFormat,
    segmentationMaskFormat,
    textInputMode,
    textGenerationPrompt,
    visualOutputShape,
    constrainedDecodingPreference,
    unsupportedDocumentPolicy,
    normalizationMode,
    chunkSize,
    chunkOverlap,
    preserveDocumentBoundaries,
    maxChunkCount,
    maxTokensPerChunk,
    topicBoundarySensitivity,
    maxSourceSpans,
    similarityThreshold,
    modelId,
    modelInferenceMode,
    modelDevice,
    modelTorchDtype,
    modelMemoryOverflowPolicy,
    maxExamplesPerChunk,
    batchSize,
    failurePolicy,
    generationTemperature,
    generationTopP,
    generationMaxNewTokens,
    trainRatio,
    validationRatio,
    testRatio,
    seed,
    shuffle,
    outputFormat,
    outputBaseName,
    localDestinationEnabled,
    huggingFaceDestinationEnabled,
    huggingFaceRepository,
    huggingFaceRevision,
    huggingFacePathPrefix,
    qualityPreset,
    requireLicenseMetadata,
    requireConsentMetadata,
    includeSourceAttribution,
    status,
    resultSummary,
    qualityReview,
    activeTaskRequestId,
    activeTaskStartedAt,
  ]);

  useEffect(() => {
    if (suppressNextTaskDefaultResetRef.current) {
      suppressNextTaskDefaultResetRef.current = false;
      return;
    }

    const profile = resolveDatasetPreparationTaskProfileDefinition(taskType);
    const taskModelDefault =
      resolveDefaultDatasetPreparationTextGenerationModel(taskType);
    const generationParameters =
      resolveDefaultGenerationParameterState(taskType);
    setOutputFormat(profile.preferredOutputFormat);
    setTextInputMode(resolveDefaultTextInputMode(taskType));
    setTextGenerationPrompt(
      resolveDefaultDatasetPreparationPromptTemplate(taskType) ?? "",
    );
    setVisualOutputShape(
      createDefaultDatasetPreparationVisualOutputShape(taskType, {
        multiLabel,
      }),
    );
    modelSelectionExplicitRef.current = false;
    cachedDatasetPreparationModelSelectionExplicit = false;
    setModelIdState(taskModelDefault?.modelId ?? "");
    setModelInferenceModeState(taskModelDefault?.inferenceMode ?? "auto");
    setModelDeviceState(taskModelDefault?.device ?? "auto");
    setModelTorchDtypeState(taskModelDefault?.torchDtype ?? "");
    setMaxExamplesPerChunk(generationParameters.maxExamplesPerChunk);
    setBatchSize(generationParameters.batchSize);
    setFailurePolicy(generationParameters.failurePolicy);
    setGenerationTemperature(generationParameters.generationTemperature);
    setGenerationTopP(generationParameters.generationTopP);
    setGenerationMaxNewTokens(generationParameters.generationMaxNewTokens);
    setPreparationMethodId(undefined);
  }, [taskType]);

  useEffect(() => {
    if (taskType !== "llm-classification") return;
    setVisualOutputShape((current) => {
      const priorDefault = createDefaultDatasetPreparationVisualOutputShape(
        taskType,
        { multiLabel: !multiLabel },
      );
      return JSON.stringify(current) === JSON.stringify(priorDefault)
        ? createDefaultDatasetPreparationVisualOutputShape(taskType, {
            multiLabel,
          })
        : current;
    });
  }, [multiLabel, taskType]);

  const setStatusWarningMessage = useCallback((warningMessage: string) => {
    setStatus((current) => {
      const existingMessage = current.message?.trim();
      const nextMessage =
        existingMessage && existingMessage.length > 0
          ? `${existingMessage} ${warningMessage}`
          : warningMessage;
      return { kind: current.kind, message: nextMessage };
    });
  }, []);

  const clearActiveTask = useCallback(() => {
    setActiveTaskRequestId(undefined);
    setActiveTaskStartedAt(undefined);
    activePollingRequestIdRef.current = undefined;
    cachedDatasetPreparationPageState.activeTaskRequestId = undefined;
    cachedDatasetPreparationPageState.activeTaskType = undefined;
    cachedDatasetPreparationPageState.activeTaskStartedAt = undefined;
  }, []);

  const setActiveDatasetPreparationTask = useCallback((requestId: string) => {
    const startedAt = new Date().toISOString();
    setActiveTaskRequestId(requestId);
    setActiveTaskStartedAt(startedAt);
    cachedDatasetPreparationPageState.activeTaskRequestId = requestId;
    cachedDatasetPreparationPageState.activeTaskType = "dataset-preparation";
    cachedDatasetPreparationPageState.activeTaskStartedAt = startedAt;
  }, []);

  const refreshArtifacts = useCallback(async () => {
    const sourceArtifacts =
      await datasetClient.browseSourceArtifacts(workspaceId);
    setArtifacts(sourceArtifacts);
    setSelectedArtifactIds((current) => {
      const validArtifactIds = new Set(
        sourceArtifacts.map((artifact) => artifact.artifactId),
      );
      return current.filter((artifactId) => validArtifactIds.has(artifactId));
    });
  }, [datasetClient, workspaceId]);

  const refreshRuntimeModelStatus = useCallback(async () => {
    if (!runtimeStatusClient) {
      return;
    }

    try {
      const snapshot = await runtimeStatusClient.readStatus();
      setLoadedModelCount(snapshot.loadedModels.length);
      setRuntimeActiveTaskCount(snapshot.activeTaskCount);
      setGenerationCapacity(snapshot.generationCapacity);
    } catch {
      // Runtime status is best-effort for model lifecycle controls.
      setGenerationCapacity(undefined);
    }
  }, [runtimeStatusClient]);

  const refreshGenerationModelAvailability = useCallback(async () => {
    const selectedModelId = modelId.trim();
    if (
      !modelClient ||
      !workspaceId ||
      !selectedModelId ||
      textInputMode !== "generate"
    ) {
      setGenerationModelRecords([]);
      setGenerationModelAvailabilityChecked(
        Boolean(selectedModelId) && textInputMode === "generate",
      );
      return;
    }

    setGenerationModelAvailabilityChecked(false);
    try {
      const listed = await modelClient.listModels({
        workspaceId: createWorkspaceId(workspaceId),
        search: selectedModelId,
        limit: 50,
        includeSharedStorage: true,
      });
      setGenerationModelRecords(listed);
    } catch {
      setGenerationModelRecords([]);
    } finally {
      setGenerationModelAvailabilityChecked(true);
    }
  }, [modelClient, modelId, textInputMode, workspaceId]);

  useEffect(() => {
    void refreshGenerationModelAvailability();
  }, [refreshGenerationModelAvailability]);

  const isPollingStillActive = useCallback(
    (requestId: string, sessionId: number): boolean => {
      return (
        isMountedRef.current &&
        activePollingRequestIdRef.current === requestId &&
        pollingSessionIdRef.current === sessionId &&
        !stopTrainingRequestedRef.current
      );
    },
    [],
  );

  const pollDatasetPreparationTask = useCallback(
    async (requestId: string) => {
      if (activePollingRequestIdRef.current === requestId) return;
      activePollingRequestIdRef.current = requestId;
      const pollingSessionId = pollingSessionIdRef.current;
      let pollRecoveryStartedAtMs: number | undefined;
      while (isPollingStillActive(requestId, pollingSessionId)) {
        try {
          const pollResponse =
            await datasetClient.readPrepareTrainingDatasetTask(
              requestId,
              workspaceId,
            );
          if (!isPollingStillActive(requestId, pollingSessionId)) return;
          if (pollResponse.ok === false) {
            if (!pollRecoveryStartedAtMs) pollRecoveryStartedAtMs = Date.now();
            if (
              isTransientPollReadFailure(
                pollResponse.error.message,
                pollResponse.error.details,
              ) &&
              Date.now() - pollRecoveryStartedAtMs <
                pollingRecoveryGraceWindowMs
            ) {
              setStatus({
                kind: "loading",
                message: "Reconnecting to dataset preparation task...",
              });
              await new Promise<void>((resolve) =>
                window.setTimeout(resolve, 750),
              );
              if (!isPollingStillActive(requestId, pollingSessionId)) return;
              continue;
            }
            if (
              pollResponse.error.code === "generation_model_not_available" ||
              pollResponse.error.code ===
                "generation_model_download_incomplete" ||
              pollResponse.error.code === "generation_model_load_failed"
            ) {
              setGenerationModelRecords([]);
              setGenerationModelAvailabilityChecked(true);
            }
            clearActiveTask();
            setStatus({
              kind: "error",
              message: appendErrorDetailsMessage(
                pollResponse.error.message,
                pollResponse.error.details,
              ),
            });
            return;
          }
          if (
            pollResponse.status === "pending" ||
            pollResponse.status === "running"
          ) {
            const processed = pollResponse.progress?.processed;
            const total = pollResponse.progress?.total;
            const suffix =
              typeof processed === "number" && typeof total === "number"
                ? ` (${processed}/${total})`
                : "";
            setStatus({
              kind: "loading",
              message: `${pollResponse.progress?.message ?? "Preparing training dataset..."}${suffix}`,
            });
            await new Promise<void>((resolve) =>
              window.setTimeout(resolve, 750),
            );
            if (!isPollingStillActive(requestId, pollingSessionId)) return;
            continue;
          }
          if (pollResponse.status === "cancelled") {
            clearActiveTask();
            setStatus({ kind: "idle", message: "Training stopped." });
            return;
          }
          if (pollResponse.status === "unknown") {
            clearActiveTask();
            setStatus({
              kind: "error",
              message:
                "Dataset preparation task could not be found or is no longer available.",
            });
            return;
          }
          if (pollResponse.status === "review-required") {
            const report = pollResponse.value.qualityReport;
            if (!report || !pollResponse.value.review) {
              clearActiveTask();
              setStatus({
                kind: "error",
                message: "Dataset quality review is incomplete.",
              });
              return;
            }
            clearActiveTask();
            setQualityReview({
              requestId,
              report,
              advancedReport: pollResponse.value.advancedReport,
            });
            setStatus({ kind: "idle" });
            await refreshRuntimeModelStatus();
            return;
          }
          if (pollResponse.status === "succeeded") {
            clearActiveTask();
            setStatus({
              kind: "success",
              message: "Training dataset is ready.",
            });
            setResultSummary({
              datasetKey:
                pollResponse.value.outputs.local?.dataset?.storage.key ??
                "(not produced locally)",
              datasetRows:
                pollResponse.value.summary.datasetRowCount ??
                pollResponse.value.summary.generatedExampleCount,
              trainRows: pollResponse.value.summary.trainRowCount,
              validationRows:
                pollResponse.value.summary.validationRowCount ?? 0,
              testRows: pollResponse.value.summary.testRowCount,
              warnings: (pollResponse.value.warnings ?? []).map(
                (warning) => warning.message,
              ),
              datasetVersion: pollResponse.value.datasetVersion,
            });
            await refreshArtifacts();
            if (
              !isMountedRef.current ||
              pollingSessionIdRef.current !== pollingSessionId
            ) {
              return;
            }
            await refreshRuntimeModelStatus();
            if (
              !isMountedRef.current ||
              pollingSessionIdRef.current !== pollingSessionId
            ) {
              return;
            }
            const artifactStorageKey =
              pollResponse.value.outputs.local?.dataset?.storage.key;
            if (artifactStorageKey) onPrepared?.(artifactStorageKey);
            return;
          }
          clearActiveTask();
          setStatus({
            kind: "error",
            message: "Dataset preparation task returned an invalid status.",
          });
          return;
        } catch (error) {
          if (!pollRecoveryStartedAtMs) pollRecoveryStartedAtMs = Date.now();
          if (
            Date.now() - pollRecoveryStartedAtMs <
            pollingRecoveryGraceWindowMs
          ) {
            setStatus({
              kind: "loading",
              message: "Reconnecting to dataset preparation task...",
            });
            await new Promise<void>((resolve) =>
              window.setTimeout(resolve, 750),
            );
            if (!isPollingStillActive(requestId, pollingSessionId)) return;
            continue;
          }
          clearActiveTask();
          setStatus({
            kind: "error",
            message: resolveUserFacingDatasetPreparationErrorMessage(error),
          });
          return;
        }
      }
      if (
        !isMountedRef.current ||
        activePollingRequestIdRef.current !== requestId ||
        pollingSessionIdRef.current !== pollingSessionId
      ) {
        return;
      }
      if (stopTrainingRequestedRef.current) {
        clearActiveTask();
        setStatus({ kind: "idle", message: "Training stopped." });
      }
    },
    [
      clearActiveTask,
      datasetClient,
      isPollingStillActive,
      onPrepared,
      pollingRecoveryGraceWindowMs,
      refreshArtifacts,
      refreshRuntimeModelStatus,
    ],
  );

  useEffect(() => {
    if (status.kind === "loading" && activeTaskRequestId)
      void pollDatasetPreparationTask(activeTaskRequestId);
  }, [activeTaskRequestId, pollDatasetPreparationTask, status.kind]);

  useEffect(() => {
    void refreshArtifacts().catch((error) => {
      const message =
        error instanceof Error ? error.message : "Failed to load artifacts.";
      setStatus({ kind: "error", message });
    });
  }, [refreshArtifacts]);

  useEffect(() => {
    if (!settingsClient) {
      return;
    }

    void settingsClient
      .readSettings({ keys: ["huggingface.defaultNamespace"] })
      .then((result) => {
        const namespace = result.values.find(
          (value) => value.key === "huggingface.defaultNamespace",
        )?.value;
        if (typeof namespace === "string" && namespace.trim().length > 0) {
          setDefaultHuggingFaceNamespace(namespace.trim());
        }
      })
      .catch(() => {
        setStatusWarningMessage(
          "Hugging Face namespace default could not be loaded.",
        );
      });
  }, [settingsClient, setStatusWarningMessage]);

  useEffect(() => {
    void refreshRuntimeModelStatus();
    const timer = window.setInterval(() => {
      void refreshRuntimeModelStatus();
    }, 5_000);

    return () => {
      window.clearInterval(timer);
    };
  }, [refreshRuntimeModelStatus]);

  const onToggleArtifact = useCallback((artifactId: string) => {
    setSelectedArtifactIds((current) =>
      current.includes(artifactId)
        ? current.filter((id) => id !== artifactId)
        : [...current, artifactId],
    );
  }, []);

  const taskRelevantArtifacts = useMemo(
    () => filterTaskRelevantDatasetPreparationArtifacts(artifacts, taskType),
    [artifacts, taskType],
  );
  const uploadedArtifacts = useMemo(
    () => filterUploadedDatasetPreparationArtifacts(taskRelevantArtifacts),
    [taskRelevantArtifacts],
  );
  const generatedArtifacts = useMemo(
    () => filterGeneratedDatasetPreparationArtifacts(taskRelevantArtifacts),
    [taskRelevantArtifacts],
  );
  const filteredArtifacts = useMemo(() => {
    if (selectedArtifactStorageFilter === "uploaded") {
      return uploadedArtifacts;
    }
    if (selectedArtifactStorageFilter === "generated") {
      return generatedArtifacts;
    }
    return taskRelevantArtifacts;
  }, [
    generatedArtifacts,
    selectedArtifactStorageFilter,
    taskRelevantArtifacts,
    uploadedArtifacts,
  ]);

  useEffect(() => {
    setSelectedArtifactIds((current) => {
      const relevantArtifactIds = new Set(
        taskRelevantArtifacts.map((artifact) => artifact.artifactId),
      );
      return current.filter((artifactId) =>
        relevantArtifactIds.has(artifactId),
      );
    });
  }, [taskRelevantArtifacts]);

  const selectedSourceCapabilities = useMemo(
    () =>
      taskRelevantArtifacts
        .filter((artifact) => selectedArtifactIds.includes(artifact.artifactId))
        .map((artifact) =>
          resolveDatasetPreparationSourceCapability({
            fileName: artifact.label || artifact.storageKey,
            mediaType: artifact.mediaType,
          }),
        )
        .filter((capability) => capability !== undefined),
    [selectedArtifactIds, taskRelevantArtifacts],
  );
  const preparationResolution = useMemo(
    () =>
      resolveDatasetPreparationAdaptivePlan({
        taskType,
        sources: selectedSourceCapabilities,
      }),
    [selectedSourceCapabilities, taskType],
  );
  const preparationMethodId = useMemo(() => {
    if (preparationResolution.status !== "ready") {
      return undefined;
    }
    return requestedPreparationMethodId &&
      resolveDatasetPreparationMethodOption(
        preparationResolution,
        requestedPreparationMethodId,
      )
      ? requestedPreparationMethodId
      : preparationResolution.defaultMethodId;
  }, [preparationResolution, requestedPreparationMethodId]);
  const preparationPlan = useMemo(() => {
    if (preparationResolution.status !== "ready" || !preparationMethodId) {
      return undefined;
    }
    return createDatasetPreparationExecutionPlan(
      preparationResolution,
      preparationMethodId,
    );
  }, [preparationMethodId, preparationResolution]);

  useEffect(() => {
    if (preparationPlan) {
      setTextInputMode(
        preparationPlan.generationMode === "none" ? "provided" : "generate",
      );
    }
  }, [preparationPlan]);

  const outputShapeCompilation = useMemo(
    () =>
      compileDatasetPreparationVisualOutputShape(visualOutputShape, {
        taskType,
        outputFormat,
        multiLabel,
        allowedLabels: splitConfiguredLabels(labelSet),
      }),
    [labelSet, multiLabel, outputFormat, taskType, visualOutputShape],
  );
  const constrainedDecodingAvailable =
    preparationPlan?.generationMode !== undefined &&
    preparationPlan.generationMode !== "none" &&
    modelInferenceMode !== "text2text" &&
    outputShapeCompilation.ok &&
    outputShapeCompilation.value.decoderCompatible &&
    generationCapacity?.decoderAvailable === true;
  const recommendationCapacity = generationCapacity
    ? {
        ...generationCapacity,
        schemaSupported:
          generationCapacity.schemaSupported && constrainedDecodingAvailable,
      }
    : undefined;
  const constrainedJsonResolution = useMemo(
    () =>
      resolveDatasetPreparationConstrainedJson({
        preference: constrainedDecodingPreference,
        selectedDevice:
          modelDevice ||
          resolveDefaultDatasetPreparationTextGenerationModel(taskType)
            ?.device ||
          "auto",
        estimatedModelBytes:
          resolveDatasetPreparationGenerationModelEstimatedBytes(
            modelId ||
              resolveDefaultDatasetPreparationTextGenerationModel(taskType)
                ?.modelId,
          ),
        capacity: recommendationCapacity,
        memoryOverflowPolicy: modelMemoryOverflowPolicy,
      }),
    [
      constrainedDecodingPreference,
      modelDevice,
      modelId,
      modelMemoryOverflowPolicy,
      recommendationCapacity,
      taskType,
    ],
  );
  const constrainedDecodingEnabled =
    constrainedDecodingAvailable && constrainedJsonResolution.enabled;

  useEffect(() => {
    if (
      modelSelectionExplicitRef.current ||
      !generationCapacity ||
      textInputMode !== "generate"
    ) {
      return;
    }

    const selectedPresetIndex =
      DATASET_PREPARATION_TEXT_GENERATION_MODEL_PRESETS.findIndex(
        (preset) => preset.model.modelId === modelId,
      );
    if (selectedPresetIndex < 0) {
      return;
    }
    const selectedPreset =
      DATASET_PREPARATION_TEXT_GENERATION_MODEL_PRESETS[selectedPresetIndex];
    if (
      !selectedPreset ||
      resolveDatasetPreparationGenerationModelCapacity({
        selectedDevice: selectedPreset.model.device ?? "auto",
        estimatedModelBytes:
          resolveDatasetPreparationGenerationModelEstimatedBytes(
            selectedPreset.model.modelId,
          ),
        capacity: generationCapacity,
        memoryOverflowPolicy: modelMemoryOverflowPolicy,
      }).reason !== "capacity-insufficient"
    ) {
      return;
    }

    const compatiblePreset =
      DATASET_PREPARATION_TEXT_GENERATION_MODEL_PRESETS.slice(
        selectedPresetIndex + 1,
      ).find(
        (preset) =>
          resolveDatasetPreparationGenerationModelCapacity({
            selectedDevice: preset.model.device ?? "auto",
            estimatedModelBytes:
              resolveDatasetPreparationGenerationModelEstimatedBytes(
                preset.model.modelId,
              ),
            capacity: generationCapacity,
            memoryOverflowPolicy: modelMemoryOverflowPolicy,
          }).supported,
      );
    if (!compatiblePreset) {
      return;
    }

    setModelIdState(compatiblePreset.model.modelId);
    setModelInferenceModeState(
      compatiblePreset.model.inferenceMode === "text2text" ||
        compatiblePreset.model.inferenceMode === "causal" ||
        compatiblePreset.model.inferenceMode === "chat" ||
        compatiblePreset.model.inferenceMode === "auto"
        ? compatiblePreset.model.inferenceMode
        : "auto",
    );
    setModelDeviceState(compatiblePreset.model.device ?? "auto");
    setModelTorchDtypeState(compatiblePreset.model.torchDtype ?? "");
  }, [generationCapacity, modelId, modelMemoryOverflowPolicy, textInputMode]);

  const currentTrainingSettingsSnapshot =
    useMemo<DatasetPreparationTrainingSettingsSnapshot>(
      () => ({
        advancedPreset,
        preparationMethodId,
        taskType,
        labelSet,
        multiLabel,
        extractionStrictSchema,
        diffusionConceptKind,
        diffusionTriggerToken,
        diffusionRegularizationClass,
        detectionBoxFormat,
        segmentationMaskFormat,
        textInputMode,
        textGenerationPrompt,
        visualOutputShape,
        constrainedDecodingPreference,
        unsupportedDocumentPolicy,
        normalizationMode,
        chunkSize,
        chunkOverlap,
        preserveDocumentBoundaries,
        maxChunkCount,
        maxTokensPerChunk,
        topicBoundarySensitivity,
        maxSourceSpans,
        similarityThreshold,
        modelId,
        modelInferenceMode,
        modelDevice,
        modelTorchDtype,
        modelMemoryOverflowPolicy,
        maxExamplesPerChunk,
        batchSize,
        failurePolicy,
        generationTemperature,
        generationTopP,
        generationMaxNewTokens,
        trainRatio,
        validationRatio,
        testRatio,
        seed,
        shuffle,
        outputFormat,
        outputBaseName,
        localDestinationEnabled,
        huggingFaceDestinationEnabled,
        huggingFaceRepository,
        huggingFaceRevision,
        huggingFacePathPrefix,
        qualityPreset,
        requireLicenseMetadata,
        requireConsentMetadata,
        includeSourceAttribution,
      }),
      [
        advancedPreset,
        preparationMethodId,
        taskType,
        labelSet,
        multiLabel,
        extractionStrictSchema,
        diffusionConceptKind,
        diffusionTriggerToken,
        diffusionRegularizationClass,
        detectionBoxFormat,
        segmentationMaskFormat,
        textInputMode,
        textGenerationPrompt,
        visualOutputShape,
        constrainedDecodingPreference,
        unsupportedDocumentPolicy,
        normalizationMode,
        chunkSize,
        chunkOverlap,
        preserveDocumentBoundaries,
        maxChunkCount,
        maxTokensPerChunk,
        topicBoundarySensitivity,
        maxSourceSpans,
        similarityThreshold,
        modelId,
        modelInferenceMode,
        modelDevice,
        modelTorchDtype,
        modelMemoryOverflowPolicy,
        maxExamplesPerChunk,
        batchSize,
        failurePolicy,
        generationTemperature,
        generationTopP,
        generationMaxNewTokens,
        trainRatio,
        validationRatio,
        testRatio,
        seed,
        shuffle,
        outputFormat,
        outputBaseName,
        localDestinationEnabled,
        huggingFaceDestinationEnabled,
        huggingFaceRepository,
        huggingFaceRevision,
        huggingFacePathPrefix,
        qualityPreset,
        requireLicenseMetadata,
        requireConsentMetadata,
        includeSourceAttribution,
      ],
    );

  const hasTrainingSettingsChanges = useMemo(
    () =>
      serializeTrainingSettingsSnapshot(currentTrainingSettingsSnapshot) !==
      serializeTrainingSettingsSnapshot(
        createDefaultTrainingSettingsSnapshot(taskType),
      ),
    [currentTrainingSettingsSnapshot, taskType],
  );

  const applyTrainingSettingsSnapshot = useCallback(
    (settings: DatasetPreparationTrainingSettingsSnapshot) => {
      suppressNextTaskDefaultResetRef.current = settings.taskType !== taskType;
      setTaskType(settings.taskType);
      setAdvancedPreset(settings.advancedPreset);
      setPreparationMethodId(settings.preparationMethodId);
      setLabelSet(settings.labelSet);
      setMultiLabel(settings.multiLabel);
      setExtractionStrictSchema(settings.extractionStrictSchema);
      setDiffusionConceptKind(settings.diffusionConceptKind);
      setDiffusionTriggerToken(settings.diffusionTriggerToken);
      setDiffusionRegularizationClass(settings.diffusionRegularizationClass);
      setDetectionBoxFormat(settings.detectionBoxFormat);
      setSegmentationMaskFormat(settings.segmentationMaskFormat);
      setTextInputMode(settings.textInputMode);
      setTextGenerationPrompt(settings.textGenerationPrompt);
      setVisualOutputShape(settings.visualOutputShape);
      setConstrainedDecodingPreference(settings.constrainedDecodingPreference);
      setUnsupportedDocumentPolicy(settings.unsupportedDocumentPolicy);
      setNormalizationMode(settings.normalizationMode);
      setChunkSize(settings.chunkSize);
      setChunkOverlap(settings.chunkOverlap);
      setPreserveDocumentBoundaries(settings.preserveDocumentBoundaries);
      setMaxChunkCount(settings.maxChunkCount);
      setMaxTokensPerChunk(settings.maxTokensPerChunk);
      setTopicBoundarySensitivity(settings.topicBoundarySensitivity);
      setMaxSourceSpans(settings.maxSourceSpans);
      setSimilarityThreshold(settings.similarityThreshold);
      setModelId(settings.modelId);
      setModelInferenceMode(settings.modelInferenceMode);
      setModelDevice(settings.modelDevice);
      setModelTorchDtype(settings.modelTorchDtype);
      setModelMemoryOverflowPolicy(
        settings.modelMemoryOverflowPolicy ?? "limited",
      );
      setMaxExamplesPerChunk(settings.maxExamplesPerChunk);
      setBatchSize(settings.batchSize);
      setFailurePolicy(settings.failurePolicy);
      setGenerationTemperature(settings.generationTemperature);
      setGenerationTopP(settings.generationTopP);
      setGenerationMaxNewTokens(settings.generationMaxNewTokens);
      setTrainRatio(settings.trainRatio);
      setValidationRatio(settings.validationRatio ?? "0");
      setTestRatio(settings.testRatio);
      setSeed(settings.seed);
      setShuffle(settings.shuffle);
      setOutputFormat(settings.outputFormat);
      setOutputBaseName(settings.outputBaseName);
      setLocalDestinationEnabled(settings.localDestinationEnabled);
      setHuggingFaceDestinationEnabled(settings.huggingFaceDestinationEnabled);
      setHuggingFaceRepository(settings.huggingFaceRepository);
      setHuggingFaceRevision(settings.huggingFaceRevision);
      setHuggingFacePathPrefix(settings.huggingFacePathPrefix);
      setQualityPreset(settings.qualityPreset);
      setRequireLicenseMetadata(settings.requireLicenseMetadata);
      setRequireConsentMetadata(settings.requireConsentMetadata);
      setIncludeSourceAttribution(settings.includeSourceAttribution ?? false);
    },
    [taskType],
  );

  const onSaveTrainingSettings = useCallback(() => {
    const profile = resolveDatasetPreparationTaskProfileDefinition(
      currentTrainingSettingsSnapshot.taskType,
    );
    const savedAt = new Date().toISOString();
    const label = `${profile.taskType.replaceAll("-", " ")} settings - ${new Date(savedAt).toLocaleString()}`;
    const record: SavedDatasetPreparationTrainingSettings = {
      id: createSavedTrainingSettingsId(),
      label,
      savedAt,
      settings: currentTrainingSettingsSnapshot,
    };
    setSavedTrainingSettings((current) => {
      const next = [record, ...current].slice(0, 25);
      writeSavedTrainingSettingsToStorage(next);
      return next;
    });
    setSelectedSavedTrainingSettingsId(record.id);
    setStatus({ kind: "idle", message: "Training settings saved." });
  }, [currentTrainingSettingsSnapshot]);

  const onLoadTrainingSettings = useCallback(() => {
    const selected = savedTrainingSettings.find(
      (settings) => settings.id === selectedSavedTrainingSettingsId,
    );
    if (!selected) {
      return;
    }
    applyTrainingSettingsSnapshot(selected.settings);
    setStatus({ kind: "idle" });
  }, [
    applyTrainingSettingsSnapshot,
    savedTrainingSettings,
    selectedSavedTrainingSettingsId,
  ]);

  const onReuseDatasetVersion = useCallback(
    (reproduction: DatasetVersionReproduction) => {
      const snapshot = reproduction.recipeSnapshot as any;
      const recipe = snapshot.recipe ?? {};
      const task = recipe.task ?? {};
      const normalization = recipe.normalization ?? {};
      const chunking = recipe.chunking ?? {};
      const generation = recipe.generation ?? {};
      const structuredOutput = generation.structuredOutput ?? {};
      const model = generation.model ?? {};
      const generationParams = generation.generationParams ?? {};
      const split = snapshot.split ?? {};
      const output = snapshot.output ?? {};
      const policy = snapshot.effectiveQualityPolicy ?? {};
      const advanced = snapshot.advanced ?? {};
      const reusedTaskType = isDatasetPreparationTaskType(task.taskType)
        ? task.taskType
        : taskType;
      const reusedOutputFormat = ["jsonl", "json", "csv", "parquet"].includes(
        output.format,
      )
        ? output.format
        : outputFormat;
      const reusedVisualShapeCompilation =
        structuredOutput.visualShape &&
        typeof structuredOutput.visualShape === "object"
          ? compileDatasetPreparationVisualOutputShape(
              structuredOutput.visualShape,
              {
                taskType: reusedTaskType,
                outputFormat: reusedOutputFormat,
                multiLabel:
                  typeof task.multiLabel === "boolean"
                    ? task.multiLabel
                    : multiLabel,
                allowedLabels: Array.isArray(task.labelSet)
                  ? (() => {
                      const labels = task.labelSet.filter(
                        (label: unknown): label is string =>
                          typeof label === "string" && label.trim().length > 0,
                      );
                      return labels.length > 0 ? labels : undefined;
                    })()
                  : undefined,
              },
            )
          : undefined;
      setSelectedArtifactIds([...reproduction.sourceArtifactIds]);
      if (
        [
          "standard",
          "better-document-understanding",
          "generate-examples",
        ].includes(advanced.preset)
      ) {
        setAdvancedPreset(advanced.preset);
      } else {
        setAdvancedPreset("standard");
      }
      suppressNextTaskDefaultResetRef.current = reusedTaskType !== taskType;
      if (isDatasetPreparationTaskType(task.taskType))
        setTaskType(task.taskType);
      if (Array.isArray(task.labelSet)) setLabelSet(task.labelSet.join(", "));
      if (typeof task.multiLabel === "boolean") setMultiLabel(task.multiLabel);
      if (typeof task.strictSchema === "boolean")
        setExtractionStrictSchema(task.strictSchema);
      if (["subject", "style", "concept"].includes(task.conceptKind))
        setDiffusionConceptKind(task.conceptKind);
      if (typeof task.triggerToken === "string")
        setDiffusionTriggerToken(task.triggerToken);
      if (typeof task.regularizationClass === "string")
        setDiffusionRegularizationClass(task.regularizationClass);
      if (["coco", "xyxy", "xywh"].includes(task.boxFormat))
        setDetectionBoxFormat(task.boxFormat);
      if (["png", "coco-rle", "polygon"].includes(task.maskFormat))
        setSegmentationMaskFormat(task.maskFormat);
      if (["provided", "generate"].includes(task.textInputMode))
        setTextInputMode(task.textInputMode);
      if (typeof generation.promptTemplate === "string")
        setTextGenerationPrompt(generation.promptTemplate);
      if (reusedVisualShapeCompilation?.ok)
        setVisualOutputShape(reusedVisualShapeCompilation.value.shape);
      if (typeof structuredOutput.constrainedDecoding === "boolean")
        setConstrainedDecodingPreference(structuredOutput.constrainedDecoding);
      if (["fail", "skip"].includes(normalization.unsupportedDocumentPolicy))
        setUnsupportedDocumentPolicy(normalization.unsupportedDocumentPolicy);
      if (["best-effort", "strict"].includes(normalization.normalizationMode))
        setNormalizationMode(normalization.normalizationMode);
      if (typeof chunking.chunkSize === "number")
        setChunkSize(String(chunking.chunkSize));
      if (typeof chunking.chunkOverlap === "number")
        setChunkOverlap(String(chunking.chunkOverlap));
      if (typeof chunking.preserveDocumentBoundaries === "boolean")
        setPreserveDocumentBoundaries(chunking.preserveDocumentBoundaries);
      if (typeof chunking.maxChunkCount === "number")
        setMaxChunkCount(String(chunking.maxChunkCount));
      if (typeof model.modelId === "string") setModelId(model.modelId);
      if (["auto", "text2text", "causal", "chat"].includes(model.inferenceMode))
        setModelInferenceMode(model.inferenceMode);
      if (["auto", "cpu", "cuda"].includes(model.device))
        setModelDevice(model.device);
      if (["auto", "float16", "bfloat16", "float32"].includes(model.torchDtype))
        setModelTorchDtype(model.torchDtype);
      if (typeof generation.maxExamplesPerChunk === "number")
        setMaxExamplesPerChunk(String(generation.maxExamplesPerChunk));
      if (typeof generation.batchSize === "number")
        setBatchSize(String(generation.batchSize));
      if (["fail", "skip"].includes(generation.failurePolicy))
        setFailurePolicy(generation.failurePolicy);
      if (typeof generationParams.temperature === "number")
        setGenerationTemperature(String(generationParams.temperature));
      if (typeof generationParams.topP === "number")
        setGenerationTopP(String(generationParams.topP));
      if (typeof generationParams.maxNewTokens === "number")
        setGenerationMaxNewTokens(String(generationParams.maxNewTokens));
      if (typeof split.trainRatio === "number")
        setTrainRatio(String(split.trainRatio));
      if (typeof split.validationRatio === "number")
        setValidationRatio(String(split.validationRatio));
      if (typeof split.testRatio === "number")
        setTestRatio(String(split.testRatio));
      if (typeof split.seed === "number") setSeed(String(split.seed));
      if (typeof split.shuffle === "boolean") setShuffle(split.shuffle);
      if (["jsonl", "json", "csv", "parquet"].includes(output.format))
        setOutputFormat(output.format);
      if (typeof output.naming?.baseName === "string")
        setOutputBaseName(output.naming.baseName);
      if (["recommended", "strict", "minimal"].includes(policy.preset))
        setQualityPreset(policy.preset);
      if (typeof policy.requireLicenseMetadata === "boolean")
        setRequireLicenseMetadata(policy.requireLicenseMetadata);
      if (typeof policy.requireConsentMetadata === "boolean")
        setRequireConsentMetadata(policy.requireConsentMetadata);
      if (typeof policy.includeSourceAttribution === "boolean")
        setIncludeSourceAttribution(policy.includeSourceAttribution);
      setStatus({ kind: "idle" });
    },
    [multiLabel, outputFormat, taskType],
  );

  const onSubmit = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();

      if (!preparationPlan) {
        setStatus({
          kind: "error",
          message: preparationResolution.action
            ? `${preparationResolution.message} ${preparationResolution.action}`
            : preparationResolution.message,
        });
        return;
      }
      if (!outputShapeCompilation.ok) {
        setStatus({
          kind: "error",
          message:
            outputShapeCompilation.diagnostics[0]?.message ??
            "Review the generated output fields before continuing.",
        });
        return;
      }

      const validationResult = validateAndParseDatasetPreparationInputs({
        selectedArtifactIds,
        taskType,
        preparation: preparationPlan,
        chunkSize,
        chunkOverlap,
        maxChunkCount,
        maxTokensPerChunk,
        topicBoundarySensitivity,
        maxSourceSpans,
        similarityThreshold,
        modelId,
        maxExamplesPerChunk,
        batchSize,
        generationTemperature,
        generationTopP,
        generationMaxNewTokens,
        trainRatio,
        validationRatio,
        testRatio,
        seed,
        outputBaseName,
        localDestinationEnabled: true,
        huggingFaceDestinationEnabled: false,
        huggingFaceRepository: "",
        defaultHuggingFaceNamespace,
      });

      if (validationResult.ok === false) {
        setStatus({ kind: "error", message: validationResult.error });
        return;
      }

      stopTrainingRequestedRef.current = false;
      setStatus({
        kind: "loading",
        message: "Preparing training dataset request...",
      });
      setResultSummary(undefined);
      setQualityReview(undefined);

      const taskModelDefault =
        resolveDefaultDatasetPreparationTextGenerationModel(taskType);
      const fallbackModelDefault =
        DATASET_PREPARATION_TEXT_GENERATION_MODEL_PRESETS[0].model;
      const resolvedDefault = {
        provider: "transformers" as const,
        modelId: taskModelDefault?.modelId ?? fallbackModelDefault.modelId,
        inferenceMode: (taskModelDefault?.inferenceMode ??
          fallbackModelDefault.inferenceMode ??
          "auto") as ModelDefaultInferenceMode,
        source: "builtin" as const,
        device: taskModelDefault?.device ?? fallbackModelDefault.device,
        torchDtype:
          taskModelDefault?.torchDtype ?? fallbackModelDefault.torchDtype,
      };
      const request = buildDatasetPreparationRequest({
        selectedArtifactIds,
        preparation: preparationPlan,
        advancedPreset,
        taskType,
        labelSet,
        multiLabel,
        extractionStrictSchema,
        diffusionConceptKind,
        diffusionTriggerToken,
        diffusionRegularizationClass,
        detectionBoxFormat,
        segmentationMaskFormat,
        textInputMode,
        textGenerationPrompt,
        visualOutputShape,
        constrainedDecoding: constrainedDecodingEnabled,
        unsupportedDocumentPolicy,
        normalizationMode,
        preserveDocumentBoundaries,
        modelId,
        modelInferenceMode,
        modelDevice,
        modelTorchDtype,
        modelMemoryOverflowPolicy,
        failurePolicy,
        shuffle,
        outputFormat,
        outputBaseName,
        localDestinationEnabled: true,
        huggingFaceDestinationEnabled: false,
        huggingFaceRepository: "",
        huggingFaceRevision: "",
        huggingFacePathPrefix: "",
        defaultHuggingFaceNamespace,
        parsed: validationResult.parsed,
        resolvedDefault,
      });
      const generationModelId = request.recipe.generation?.model.modelId;
      if (generationModelId && generationCapacity) {
        const modelCapacity = resolveDatasetPreparationGenerationModelCapacity({
          selectedDevice: request.recipe.generation?.model.device ?? "auto",
          estimatedModelBytes:
            resolveDatasetPreparationGenerationModelEstimatedBytes(
              generationModelId,
            ),
          capacity: generationCapacity,
          memoryOverflowPolicy: modelMemoryOverflowPolicy,
        });
        if (modelCapacity.reason === "capacity-insufficient") {
          setStatus({
            kind: "error",
            message:
              "The selected model cannot fit in the memory currently available. Close memory-heavy applications or select a smaller built-in model, then retry.",
          });
          return;
        }
      }
      const requestId = createDatasetPreparationRequestId();

      setStatus({
        kind: "loading",
        message: generationModelId
          ? `Checking model ${generationModelId} before dataset preparation...`
          : "Starting dataset checks...",
      });

      if (!workspaceId) {
        setStatus({
          kind: "error",
          message: "Select a workspace before preparing datasets.",
        });
        return;
      }

      let started: Awaited<
        ReturnType<
          DesktopDatasetPreparationClient["startPrepareTrainingDataset"]
        >
      >;
      try {
        started = await datasetClient.startPrepareTrainingDataset(
          {
            ...request,
            workspaceId,
            quality: {
              policy: {
                preset: qualityPreset,
                allowedLanguages: ["en"],
                requireLicenseMetadata,
                requireConsentMetadata,
                includeSourceAttribution,
              },
              reviewRequired: true,
            },
          },
          { requestId },
        );
      } catch (error) {
        const message = resolveUserFacingDatasetPreparationErrorMessage(error);
        if (
          isTransientDatasetPreparationTransportError(error) ||
          isTransientPollReadFailure(message)
        ) {
          setActiveDatasetPreparationTask(requestId);
          announceDatasetPreparationStarted({ requestId, workspaceId });
          setStatus({
            kind: "loading",
            message: "Reconnecting to dataset preparation task...",
          });
          await pollDatasetPreparationTask(requestId);
          return;
        }
        setStatus({ kind: "error", message });
        return;
      }
      if ("error" in started) {
        setStatus({
          kind: "error",
          message: appendErrorDetailsMessage(
            started.error.message,
            started.error.details,
          ),
        });
        return;
      }

      setActiveDatasetPreparationTask(started.requestId);
      announceDatasetPreparationStarted({
        requestId: started.requestId,
        workspaceId,
      });
      await pollDatasetPreparationTask(started.requestId);
    },
    [
      selectedArtifactIds,
      preparationPlan,
      preparationResolution,
      advancedPreset,
      taskType,
      labelSet,
      multiLabel,
      extractionStrictSchema,
      diffusionConceptKind,
      diffusionTriggerToken,
      diffusionRegularizationClass,
      detectionBoxFormat,
      segmentationMaskFormat,
      textInputMode,
      textGenerationPrompt,
      visualOutputShape,
      outputShapeCompilation,
      constrainedDecodingEnabled,
      unsupportedDocumentPolicy,
      normalizationMode,
      chunkSize,
      chunkOverlap,
      preserveDocumentBoundaries,
      maxChunkCount,
      maxTokensPerChunk,
      topicBoundarySensitivity,
      maxSourceSpans,
      similarityThreshold,
      modelId,
      modelInferenceMode,
      modelDevice,
      modelTorchDtype,
      modelMemoryOverflowPolicy,
      maxExamplesPerChunk,
      batchSize,
      failurePolicy,
      generationTemperature,
      generationTopP,
      generationMaxNewTokens,
      trainRatio,
      validationRatio,
      testRatio,
      seed,
      shuffle,
      outputFormat,
      outputBaseName,
      localDestinationEnabled,
      huggingFaceDestinationEnabled,
      huggingFaceRepository,
      defaultHuggingFaceNamespace,
      huggingFaceRevision,
      huggingFacePathPrefix,
      qualityPreset,
      requireLicenseMetadata,
      requireConsentMetadata,
      includeSourceAttribution,
      datasetClient,
      generationCapacity,
      workspaceId,
      pollDatasetPreparationTask,
      setActiveDatasetPreparationTask,
    ],
  );

  const onStopTraining = useCallback(async () => {
    if (!activeTaskRequestId || status.kind !== "loading") {
      return;
    }

    stopTrainingRequestedRef.current = true;
    setStopTrainingInFlight(true);
    setStatus({ kind: "loading", message: "Stopping dataset preparation..." });
    try {
      const response = await datasetClient.cancelPrepareTrainingDatasetTask(
        activeTaskRequestId,
        workspaceId,
      );
      if (response.ok === false) {
        setStatus({
          kind: "error",
          message: appendErrorDetailsMessage(
            response.error.message,
            response.error.details,
          ),
        });
      } else {
        clearActiveTask();
        setStatus({ kind: "idle", message: "Training stopped." });
      }
    } catch (error) {
      setStatus({
        kind: "error",
        message:
          error instanceof Error ? error.message : "Failed to stop training.",
      });
    } finally {
      setStopTrainingInFlight(false);
      void refreshRuntimeModelStatus();
    }
  }, [
    activeTaskRequestId,
    clearActiveTask,
    datasetClient,
    refreshRuntimeModelStatus,
    status.kind,
    workspaceId,
  ]);

  const onApproveReview = useCallback(async () => {
    if (!qualityReview || !workspaceId || reviewActionInFlight) {
      return;
    }
    const saveNameError = validateDatasetPreparationSaveName(outputBaseName);
    if (saveNameError) {
      setStatus({ kind: "error", message: saveNameError });
      return;
    }
    setReviewActionInFlight(true);
    try {
      const response = await datasetClient.approvePreparedTrainingDataset(
        qualityReview.requestId,
        qualityReview.report.reportFingerprint,
        workspaceId,
        outputBaseName,
      );
      if (!response.ok) {
        setStatus({
          kind: "error",
          message: appendErrorDetailsMessage(
            response.error.message,
            response.error.details,
          ),
        });
        return;
      }
      const value = response.value;
      setResultSummary({
        datasetKey:
          value.outputs.local?.dataset?.storage.key ?? "(not produced locally)",
        datasetRows:
          value.summary.datasetRowCount ?? value.summary.generatedExampleCount,
        trainRows: value.summary.trainRowCount,
        validationRows: value.summary.validationRowCount ?? 0,
        testRows: value.summary.testRowCount,
        warnings: (value.warnings ?? []).map((warning) => warning.message),
        datasetVersion: value.datasetVersion,
      });
      setQualityReview(undefined);
      setStatus({ kind: "success", message: "Training dataset is ready." });
      await refreshArtifacts();
      await refreshRuntimeModelStatus();
      const artifactStorageKey = value.outputs.local?.dataset?.storage.key;
      if (artifactStorageKey) onPrepared?.(artifactStorageKey);
    } catch (error) {
      setStatus({
        kind: "error",
        message:
          error instanceof Error
            ? error.message
            : "Failed to approve the dataset.",
      });
    } finally {
      setReviewActionInFlight(false);
    }
  }, [
    datasetClient,
    onPrepared,
    outputBaseName,
    qualityReview,
    refreshArtifacts,
    refreshRuntimeModelStatus,
    reviewActionInFlight,
    workspaceId,
  ]);

  const onDiscardReview = useCallback(async () => {
    if (!qualityReview || !workspaceId || reviewActionInFlight) {
      return;
    }
    setReviewActionInFlight(true);
    try {
      const response = await datasetClient.cancelPrepareTrainingDatasetTask(
        qualityReview.requestId,
        workspaceId,
      );
      if (!response.ok) {
        setStatus({
          kind: "error",
          message: appendErrorDetailsMessage(
            response.error.message,
            response.error.details,
          ),
        });
        return;
      }
      setQualityReview(undefined);
      setStatus({ kind: "idle" });
      await refreshRuntimeModelStatus();
    } catch (error) {
      setStatus({
        kind: "error",
        message:
          error instanceof Error
            ? error.message
            : "Failed to discard the prepared dataset.",
      });
    } finally {
      setReviewActionInFlight(false);
    }
  }, [
    datasetClient,
    qualityReview,
    refreshRuntimeModelStatus,
    reviewActionInFlight,
    workspaceId,
  ]);

  const onUnloadModel = useCallback(async () => {
    if (!runtimeStatusClient?.controlRuntime || status.kind === "loading") {
      return;
    }

    setUnloadModelInFlight(true);
    try {
      const snapshot = await runtimeStatusClient.controlRuntime("unload-model");
      setLoadedModelCount(snapshot.loadedModels.length);
      setRuntimeActiveTaskCount(snapshot.activeTaskCount);
      setStatus({ kind: "idle", message: "Model unloaded from memory." });
    } catch (error) {
      setStatus({
        kind: "error",
        message:
          error instanceof Error ? error.message : "Failed to unload model.",
      });
    } finally {
      setUnloadModelInFlight(false);
      void refreshRuntimeModelStatus();
    }
  }, [refreshRuntimeModelStatus, runtimeStatusClient, status.kind]);

  const canUnloadModel =
    loadedModelCount > 0 &&
    runtimeActiveTaskCount === 0 &&
    status.kind !== "loading";
  const selectedGenerationModelAvailable = useMemo(
    () =>
      generationModelRecords.some((record) =>
        isUsableGenerationModelRecord(record, modelId),
      ),
    [generationModelRecords, modelId],
  );
  const modelDownloadInFlight = modelDownloadStatus.kind === "loading";

  const onDownloadGenerationModel = useCallback(async () => {
    const selectedModelId = modelId.trim();
    if (!selectedModelId) {
      setModelDownloadStatus({
        kind: "error",
        message: "Enter a model ID before downloading.",
      });
      return;
    }
    if (!workspaceId) {
      setModelDownloadStatus({
        kind: "error",
        message: "Select a workspace before downloading models.",
      });
      return;
    }
    if (!modelClient) {
      setModelDownloadStatus({
        kind: "error",
        message: "Model download is not available in this environment.",
      });
      return;
    }

    setModelDownloadStatus({
      kind: "loading",
      message: `Downloading ${selectedModelId}...`,
    });
    try {
      await modelClient.downloadModel({
        workspaceId,
        modelId: selectedModelId,
        displayName: selectedModelId,
        inferenceMode:
          modelInferenceMode === "auto" ? undefined : modelInferenceMode,
        artifactForm: "full-model",
        taskTags: ["chat", "text-generation"],
        metadata: {
          source: "dataset-preparation",
          usage: "text-field-generation",
        },
      });
      setModelDownloadStatus({
        kind: "success",
        message: "Model downloaded and recorded in model management.",
      });
      await refreshGenerationModelAvailability();
    } catch (error) {
      setModelDownloadStatus({
        kind: "error",
        message:
          error instanceof Error ? error.message : "Failed to download model.",
      });
    }
  }, [
    modelClient,
    modelId,
    modelInferenceMode,
    refreshGenerationModelAvailability,
    workspaceId,
  ]);

  return {
    artifacts: taskRelevantArtifacts,
    allArtifactCount: artifacts.length,
    filteredArtifacts,
    uploadedArtifacts,
    generatedArtifacts,
    selectedArtifactStorageFilter,
    selectedArtifactIds,
    advancedPreset,
    preparationResolution,
    preparationPlan,
    preparationMethodId,
    taskType,
    labelSet,
    multiLabel,
    extractionStrictSchema,
    diffusionConceptKind,
    diffusionTriggerToken,
    diffusionRegularizationClass,
    detectionBoxFormat,
    segmentationMaskFormat,
    textInputMode,
    textGenerationPrompt,
    visualOutputShape,
    constrainedJsonResolution,
    constrainedDecodingEnabled,
    constrainedDecodingAvailable,
    unsupportedDocumentPolicy,
    normalizationMode,
    chunkSize,
    chunkOverlap,
    preserveDocumentBoundaries,
    maxChunkCount,
    maxTokensPerChunk,
    topicBoundarySensitivity,
    maxSourceSpans,
    similarityThreshold,
    modelId,
    modelInferenceMode,
    modelDevice,
    modelTorchDtype,
    modelMemoryOverflowPolicy,
    maxExamplesPerChunk,
    batchSize,
    failurePolicy,
    generationTemperature,
    generationTopP,
    generationMaxNewTokens,
    trainRatio,
    validationRatio,
    testRatio,
    seed,
    shuffle,
    outputFormat,
    outputBaseName,
    localDestinationEnabled,
    huggingFaceDestinationEnabled,
    huggingFaceRepository,
    huggingFaceRevision,
    huggingFacePathPrefix,
    qualityPreset,
    requireLicenseMetadata,
    requireConsentMetadata,
    includeSourceAttribution,
    defaultHuggingFaceNamespace,
    status,
    resultSummary,
    qualityReview,
    reviewActionInFlight,
    loadedModelCount,
    canUnloadModel,
    stopTrainingInFlight,
    unloadModelInFlight,
    selectedGenerationModelAvailable,
    generationModelAvailabilityChecked,
    modelDownloadInFlight,
    modelDownloadStatus,
    savedTrainingSettings,
    selectedSavedTrainingSettingsId,
    hasTrainingSettingsChanges,
    onToggleArtifact,
    setAdvancedPreset,
    setPreparationMethodId,
    setSelectedArtifactStorageFilter,
    setTaskType,
    setLabelSet,
    setMultiLabel,
    setExtractionStrictSchema,
    setDiffusionConceptKind,
    setDiffusionTriggerToken,
    setDiffusionRegularizationClass,
    setDetectionBoxFormat,
    setSegmentationMaskFormat,
    setTextInputMode,
    setTextGenerationPrompt,
    setVisualOutputShape,
    setConstrainedDecodingPreference,
    setUnsupportedDocumentPolicy,
    setNormalizationMode,
    setChunkSize,
    setChunkOverlap,
    setPreserveDocumentBoundaries,
    setMaxChunkCount,
    setMaxTokensPerChunk,
    setTopicBoundarySensitivity,
    setMaxSourceSpans,
    setSimilarityThreshold,
    setModelId,
    setModelInferenceMode,
    setModelDevice,
    setModelTorchDtype,
    setModelMemoryOverflowPolicy,
    setMaxExamplesPerChunk,
    setBatchSize,
    setFailurePolicy,
    setGenerationTemperature,
    setGenerationTopP,
    setGenerationMaxNewTokens,
    setTrainRatio,
    setValidationRatio,
    setTestRatio,
    setSeed,
    setShuffle,
    setOutputFormat,
    setOutputBaseName,
    setLocalDestinationEnabled,
    setHuggingFaceDestinationEnabled,
    setHuggingFaceRepository,
    setHuggingFaceRevision,
    setHuggingFacePathPrefix,
    setQualityPreset,
    setRequireLicenseMetadata,
    setRequireConsentMetadata,
    setIncludeSourceAttribution,
    setSelectedSavedTrainingSettingsId,
    onSubmit,
    onStopTraining,
    onApproveReview,
    onDiscardReview,
    onUnloadModel,
    onDownloadGenerationModel,
    onSaveTrainingSettings,
    onLoadTrainingSettings,
    onReuseDatasetVersion,
  };
}
