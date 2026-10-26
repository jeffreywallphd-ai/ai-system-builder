import { getDatasetPreparationMemoryFailureMessage } from "../../../../../../../modules/ui/shared/data-management/datasetPreparationMemoryMessage";
import { useDatasetPreparationConstrainedJson } from "../../../../../../../modules/ui/shared/data-management/useDatasetPreparationConstrainedJson";
import { useTaskObservationManager } from "../../../../../../../modules/ui/shared/notifications/TaskObservationProvider";
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
  DatasetPreparationMemoryMode,
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
  resolveDatasetPreparationGenerationModelCapacity,
  resolveDatasetPreparationGenerationModelEstimatedBytes,
  validateDatasetPreparationSaveName,
  isDatasetPreparationOffloadAvailable,
  normalizeDatasetPreparationMemoryMode,
  resolveDatasetPreparationOcrChoice,
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
  memoryNotification?: "page" | "task";
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
  ocrEnabled: boolean;
  ocrLanguage: string;
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
  modelMemoryMode: DatasetPreparationMemoryMode;
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
  constrainedSchemaValid: boolean;
  lowMemoryAvailable: boolean;
  ocrEligible: boolean;
  unsupportedDocumentPolicy: "" | "fail" | "skip";
  normalizationMode: "" | "best-effort" | "strict";
  ocrEnabled: boolean;
  ocrLanguage: string;
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
  modelMemoryMode: DatasetPreparationMemoryMode;
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
  setOcrEnabled: (value: boolean) => void;
  setOcrLanguage: (value: string) => void;
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
  setModelMemoryMode: (value: DatasetPreparationMemoryMode) => void;
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
  ocrEnabled: false,
  ocrLanguage: "",
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
  modelMemoryMode: "standard",
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

const workspaceDrafts = new Map<string, { state: DatasetPreparationPageState; modelSelectionExplicit: boolean }>();
export function resetDatasetPreparationPageStateForTests(): void {
  workspaceDrafts.clear();
  try { for (const key of Object.keys(window.sessionStorage)) if (key.startsWith("ai-system-builder.preparation-task.v1:")) window.sessionStorage.removeItem(key); } catch { /* Restricted test storage. */ }
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
    ocrEnabled: false,
    ocrLanguage: "",
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
    modelMemoryMode: "standard",
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
  const observer = useTaskObservationManager();
  const pollingRecoveryGraceWindowMs = 30_000;
  const onPrepared = options.onPrepared;
  const workspaceId = options.workspaceId;
  const taskStorageKey = `ai-system-builder.preparation-task.v1:${workspaceId ?? "none"}`;
  const hadCachedDraft = workspaceDrafts.has(workspaceId ?? "none");
  let cachedWorkspace = workspaceDrafts.get(workspaceId ?? "none");
  if (!cachedWorkspace) {
    const state = structuredClone(defaultDatasetPreparationPageState);
    try {
      const requestId = sessionStorage.getItem(taskStorageKey);
      if (requestId && requestId.length <= 512) { state.activeTaskRequestId = requestId; state.activeTaskType = "dataset-preparation"; state.status = { kind: "loading", message: "Restoring dataset progress..." }; }
    } catch { /* Opaque recovery IDs are optional in restricted sessions. */ }
    cachedWorkspace = { state, modelSelectionExplicit: false };
    workspaceDrafts.set(workspaceId ?? "none", cachedWorkspace);
    if (workspaceDrafts.size > 64) workspaceDrafts.delete(workspaceDrafts.keys().next().value!);
  }
  const cachedDatasetPreparationPageState = cachedWorkspace.state;

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
  const runtimeStatusFlight = useRef<{ client: typeof runtimeStatusClient; pending: boolean } | undefined>(undefined);
  const [artifacts, setArtifacts] = useState<
    DatasetPreparationSourceArtifact[]
  >([]);
  const [artifactsLoaded, setArtifactsLoaded] = useState(false);
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
  const [ocrEnabled, setOcrEnabled] = useState(cachedDatasetPreparationPageState.ocrEnabled ?? false);
  const [ocrLanguage, setOcrLanguage] = useState(cachedDatasetPreparationPageState.ocrLanguage ?? "");
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
    cachedWorkspace.modelSelectionExplicit,
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
  const [modelMemoryMode, setModelMemoryMode] =
    useState<DatasetPreparationMemoryMode>(
      cachedDatasetPreparationPageState.modelMemoryMode ?? "standard",
    );
  const [modelMemoryOverflowPolicy, setModelMemoryOverflowPolicy] =
    useState<DatasetPreparationMemoryOverflowPolicy>(
      cachedDatasetPreparationPageState.modelMemoryOverflowPolicy ?? "limited",
    );
  const markModelSelectionExplicit = useCallback(() => {
    modelSelectionExplicitRef.current = true;
    cachedWorkspace.modelSelectionExplicit = true;
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
  const cancellationMessageRef = useRef<string | undefined>(undefined);
  const cancelRequestRef = useRef<object | undefined>(undefined);
  const activePollingRequestIdRef = useRef<string | undefined>(undefined);
  const pollingSessionIdRef = useRef(0);
  const isMountedRef = useRef(false);
  const suppressNextTaskDefaultResetRef = useRef(hadCachedDraft);

  useEffect(() => {
    isMountedRef.current = true;
    cancelRequestRef.current = undefined;
    cancellationMessageRef.current = undefined;
    setStopTrainingInFlight(false);
    return () => {
      isMountedRef.current = false;
      activePollingRequestIdRef.current = undefined;
      pollingSessionIdRef.current += 1;
    };
  }, [workspaceId]);

  useEffect(() => {
    Object.assign(cachedDatasetPreparationPageState, {
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
      ocrEnabled,
      ocrLanguage,
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
      modelMemoryMode,
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
    });
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
    ocrEnabled,
    ocrLanguage,
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
    modelMemoryMode,
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
    cachedWorkspace.modelSelectionExplicit = false;
    setModelIdState(taskModelDefault?.modelId ?? "");
    setModelInferenceModeState(taskModelDefault?.inferenceMode ?? "auto");
    setModelDeviceState(taskModelDefault?.device ?? "auto");
    setModelTorchDtypeState(taskModelDefault?.torchDtype ?? "");
    setModelMemoryMode("standard");
    setMaxExamplesPerChunk(generationParameters.maxExamplesPerChunk);
    setBatchSize(generationParameters.batchSize);
    setFailurePolicy(generationParameters.failurePolicy);
    setGenerationTemperature(generationParameters.generationTemperature);
    setGenerationTopP(generationParameters.generationTopP);
    setGenerationMaxNewTokens(generationParameters.generationMaxNewTokens);
    setPreparationMethodId(undefined);
    setOcrEnabled(false);
    setOcrLanguage("");
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

  const retireTaskRecovery = useCallback((requestId: string) => {
    if (!workspaceId) return;
    try {
      if (sessionStorage.getItem(taskStorageKey) === requestId) {
        sessionStorage.removeItem(taskStorageKey);
      }
    } catch { /* A successful task remains successful if session storage is unavailable. */ }
  }, [taskStorageKey, workspaceId]);

  const clearActiveTask = useCallback(() => {
    cancellationMessageRef.current = undefined;
    cancelRequestRef.current = undefined;
    setStopTrainingInFlight(false);
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
    try { sessionStorage.setItem(taskStorageKey, requestId); } catch { /* Accepted work remains observable in this session. */ }
    cachedDatasetPreparationPageState.activeTaskRequestId = requestId;
    cachedDatasetPreparationPageState.activeTaskType = "dataset-preparation";
    cachedDatasetPreparationPageState.activeTaskStartedAt = startedAt;
  }, []);

  const refreshArtifacts = useCallback(async () => {
    const sourceArtifacts =
      await datasetClient.browseSourceArtifacts(workspaceId);
    if (!isMountedRef.current) return;
    setArtifacts(sourceArtifacts); setArtifactsLoaded(true);
    setSelectedArtifactIds((current) => {
      const validArtifactIds = new Set(
        sourceArtifacts.map((artifact) => artifact.artifactId),
      );
      return current.filter((artifactId) => validArtifactIds.has(artifactId));
    });
  }, [datasetClient, workspaceId]);

  const refreshRuntimeModelStatus = useCallback(async () => {
    if (!runtimeStatusClient) {
      setGenerationCapacity(undefined);
      return;
    }
    if (runtimeStatusFlight.current?.client === runtimeStatusClient && runtimeStatusFlight.current.pending) return;
    const flight = { client: runtimeStatusClient, pending: true };
    runtimeStatusFlight.current = flight;
    try {
      const snapshot = await runtimeStatusClient.readStatus();
      if (runtimeStatusFlight.current !== flight || !isMountedRef.current) return;
      setLoadedModelCount(snapshot.loadedModels.length);
      setRuntimeActiveTaskCount(snapshot.activeTaskCount);
      setGenerationCapacity(snapshot.generationCapacity ? { ...snapshot.generationCapacity } : undefined);
    } catch {
      // Runtime status is best-effort for model lifecycle controls.
      if (runtimeStatusFlight.current === flight && isMountedRef.current) setGenerationCapacity(undefined);
    } finally {
      flight.pending = false;
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
        pollingSessionIdRef.current === sessionId
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
            await observer.readOnce({ workspaceId: workspaceId!, family: "dataset-preparation", requestId }, async () => {
              const value = await datasetClient.readPrepareTrainingDatasetTask(requestId, workspaceId);
              return { value, activity: value.ok && (value.status === "pending" || value.status === "running") ? "active" : "terminal" };
            });
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
              memoryNotification: pollResponse.error.code === "generation_insufficient_resources" ? "task" : undefined,
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
              message: `${cancellationMessageRef.current ?? pollResponse.progress?.message ?? "Preparing training dataset..."}${suffix}`,
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
            retireTaskRecovery(requestId);
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

    },
    [
      clearActiveTask,
      datasetClient,
      observer,
      isPollingStillActive,
      onPrepared,
      pollingRecoveryGraceWindowMs,
      refreshArtifacts,
      refreshRuntimeModelStatus,
      retireTaskRecovery,
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
    if (!artifactsLoaded) return;
    setSelectedArtifactIds((current) => {
      const relevantArtifactIds = new Set(
        taskRelevantArtifacts.map((artifact) => artifact.artifactId),
      );
      return current.filter((artifactId) =>
        relevantArtifactIds.has(artifactId),
      );
    });
  }, [artifactsLoaded, taskRelevantArtifacts]);

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
  const lowMemoryAvailable = isDatasetPreparationOffloadAvailable(generationCapacity);
  const constrainedDecodingReady =
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
          generationCapacity.schemaSupported && constrainedDecodingReady,
      }
    : undefined;
  const { resolution: constrainedJsonResolution, available: constrainedDecodingAvailable } =
    useDatasetPreparationConstrainedJson(
      JSON.stringify([workspaceId, taskType, modelId, modelDevice, modelInferenceMode,
        modelMemoryMode, modelMemoryOverflowPolicy]),
      {
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
      },
    );
  const constrainedDecodingEnabled = constrainedJsonResolution.enabled;

  useEffect(() => {
    if (
      modelSelectionExplicitRef.current ||
      modelMemoryMode === "offload-v1" ||
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
  }, [generationCapacity, modelId, modelMemoryOverflowPolicy, modelMemoryMode, textInputMode]);

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
        ocrEnabled,
        ocrLanguage,
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
        modelMemoryMode,
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
        ocrEnabled,
        ocrLanguage,
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
        modelMemoryMode,
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
      if ((settings.ocrEnabled !== undefined && typeof settings.ocrEnabled !== "boolean") ||
          (settings.ocrLanguage !== undefined &&
            (typeof settings.ocrLanguage !== "string" || settings.ocrLanguage.length > 35))) {
        setStatus({ kind: "error", message: "This saved setup has invalid text recognition settings. It was not restored; your current setup is unchanged." });
        return false;
      }
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
      setOcrEnabled(settings.ocrEnabled ?? false);
      setOcrLanguage(settings.ocrLanguage ?? "");
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
      setModelMemoryMode(settings.modelMemoryMode ?? "standard");
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
      return true;
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
    if (applyTrainingSettingsSnapshot(selected.settings)) setStatus({ kind: "idle" });
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
      let restoredMemoryMode: DatasetPreparationMemoryMode;
      try {
        restoredMemoryMode = normalizeDatasetPreparationMemoryMode(model.memoryMode);
      } catch {
        setStatus({ kind: "error", message: "This saved setup uses an unsupported memory mode. It was not restored; your current setup is unchanged." });
        return;
      }
      const generationParams = generation.generationParams ?? {};
      const split = snapshot.split ?? {};
      const output = snapshot.output ?? {};
      const policy = snapshot.effectiveQualityPolicy ?? {};
      const advanced = snapshot.advanced ?? {};
      const reusedTaskType = isDatasetPreparationTaskType(task.taskType) ? task.taskType : taskType;
      const replaySources = reproduction.sourceArtifactIds.flatMap((id) => {
        const source = artifacts.find((entry) => entry.artifactId === id);
        const capability = source && resolveDatasetPreparationSourceCapability({
          fileName: source.label || source.storageKey, mediaType: source.mediaType,
        });
        return capability ? [capability] : [];
      });
      const replayResolution = resolveDatasetPreparationAdaptivePlan({ taskType: reusedTaskType, sources: replaySources });
      const savedPlan = snapshot.preparation;
      const invalidExplicitOcrPlan = savedPlan !== undefined && (
        !savedPlan || savedPlan.schemaVersion !== "1" || savedPlan.method !== "structure-aware" ||
        savedPlan.inputIntent !== "create-from-source-material" || savedPlan.generationMode !== "task-examples" ||
        !Array.isArray(savedPlan.sourceKinds) || savedPlan.sourceKinds.length !== 1 || savedPlan.sourceKinds[0] !== "document"
      );
      const invalidOcrConfiguration = advanced.content?.ocrEnabled === true && (
        advanced.preset !== "structure-aware" || advanced.content.strategy !== "layout" ||
        advanced.content.layoutEnabled !== true || normalization.targetFormat !== "markdown" ||
        !isDatasetPreparationTaskType(task.taskType) || invalidExplicitOcrPlan ||
        !resolveDatasetPreparationMethodOption(replayResolution, "structure-aware")
      );
      const reusedOcr = resolveDatasetPreparationOcrChoice({
        enabled: advanced.content?.ocrEnabled,
        language: advanced.content?.ocrLanguage,
        // Current snapshots store exact advanced settings without a separate plan.
        method: savedPlan?.method ?? (advanced.preset === "structure-aware" ? "structure-aware" : undefined),
        sourceCount: reproduction.sourceArtifactIds.length,
        sourceFormats: replaySources.map((source) => source.format),
      });
      if (invalidOcrConfiguration || reusedOcr.ok === false) {
        setStatus({ kind: "error", message: "This saved setup has invalid text recognition settings. It was not restored; your current setup is unchanged." });
        return;
      }
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
      if (reusedOcr.content) setPreparationMethodId("structure-aware");
      setOcrEnabled(advanced.content?.ocrEnabled === true);
      setOcrLanguage(reusedOcr.content?.ocrLanguage ?? "");
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
      setModelMemoryMode(restoredMemoryMode);
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
    [artifacts, multiLabel, outputFormat, taskType],
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
      const ocr = resolveDatasetPreparationOcrChoice({
        enabled: ocrEnabled,
        language: ocrLanguage,
        method: preparationPlan.method,
        sourceCount: selectedArtifactIds.length,
        sourceFormats: selectedSourceCapabilities.map((source) => source.format),
      });
      if (ocr.ok === false) {
        setStatus({ kind: "error", message: ocr.message });
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
      if (preparationPlan.generationMode !== "none" && constrainedDecodingEnabled && !constrainedDecodingAvailable) {
        setStatus({ kind: "error", message: "Checked JSON output is unavailable. Start a supported runtime or turn off the checked output option before retrying." });
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

      cancellationMessageRef.current = undefined;
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
      let request: ReturnType<typeof buildDatasetPreparationRequest>;
      try {
        request = buildDatasetPreparationRequest({
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
        ocrEnabled,
        ocrLanguage,
        preserveDocumentBoundaries,
        modelId,
        modelInferenceMode,
        modelDevice,
        modelTorchDtype,
        modelMemoryOverflowPolicy,
        modelMemoryMode,
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
        sourceFormats: selectedSourceCapabilities.map((source) => source.format),
        parsed: validationResult.parsed,
          resolvedDefault,
        });
      } catch {
        setStatus({ kind: "error", message: "Saved local inference settings are unsupported. Choose a valid memory mode and review the model, device and precision before continuing." });
        return;
      }
      const generationModelId = request.recipe.generation?.model.modelId;
      if (generationModelId && modelMemoryMode === "offload-v1" && !lowMemoryAvailable) {
        setStatus({
          kind: "error",
          message: "Optional low-memory inference is unavailable in the current worker. Choose Standard or reconnect a supported runtime.",
        });
        return;
      }
      if (generationModelId && modelMemoryMode === "offload-v1"
        && (request.recipe.generation?.model.device !== "cpu" && request.recipe.generation?.model.device !== "cuda"
          || !["float32", "float16", "bfloat16"].includes(request.recipe.generation?.model.torchDtype ?? "auto"))) {
        setStatus({ kind: "error", message: "Optional low-memory inference requires an explicit CPU or CUDA device and precision." });
        return;
      }
      if (generationModelId && generationCapacity && modelMemoryMode === "standard") {
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
            memoryNotification: "page",
            message: getDatasetPreparationMemoryFailureMessage(
              modelDevice === "cpu" && generationCapacity?.availableSystemMemoryBytes !== undefined
                ? { resource: "ram", requiredBytes: modelCapacity.requiredMemoryBytes,
                    availableBytes: modelCapacity.availableMemoryBytes,
                    allowedOverflowBytes: modelCapacity.allowedMemoryOverflowBytes }
                : undefined,
            ),
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
          memoryNotification: started.error.code === "generation_insufficient_resources" ? "page" : undefined,
          message: started.error.code === "generation_insufficient_resources"
            ? getDatasetPreparationMemoryFailureMessage(started.error.details?.memoryShortfall)
            : appendErrorDetailsMessage(started.error.message, started.error.details),
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
      selectedSourceCapabilities,
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
      constrainedDecodingAvailable,
      unsupportedDocumentPolicy,
      normalizationMode,
      ocrEnabled,
      ocrLanguage,
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
      modelMemoryMode,
      lowMemoryAvailable,
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
    if (!activeTaskRequestId || status.kind !== "loading" || cancelRequestRef.current) return;
    const requestId = activeTaskRequestId;
    const session = pollingSessionIdRef.current;
    const current = () => isMountedRef.current && pollingSessionIdRef.current === session && activePollingRequestIdRef.current === requestId;
    const token = {};
    cancelRequestRef.current = token;
    setStopTrainingInFlight(true);
    cancellationMessageRef.current = "Requesting cancellation; dataset preparation is still being observed...";
    setStatus({ kind: "loading", message: cancellationMessageRef.current });
    try {
      const response = await datasetClient.cancelPrepareTrainingDatasetTask(requestId, workspaceId);
      if (!current()) return;
      cancellationMessageRef.current = response.ok && response.value?.requestId === requestId && response.value.cancelled && response.value.status === "cancelled"
        ? "Cancellation acknowledged; waiting for final task state..."
        : "Cancellation is not confirmed. Dataset preparation is still being observed.";
      setStatus({ kind: "loading", message: cancellationMessageRef.current });
      observer.invalidate({ workspaceId: workspaceId!, family: "dataset-preparation" });
    } catch {
      if (!current()) return;
      cancellationMessageRef.current = "Cancellation could not be confirmed. Dataset preparation is still being observed.";
      setStatus({ kind: "loading", message: cancellationMessageRef.current });
    } finally {
      if (cancelRequestRef.current === token) {
        cancelRequestRef.current = undefined;
        if (isMountedRef.current && pollingSessionIdRef.current === session) setStopTrainingInFlight(false);
      }
    }
  }, [activeTaskRequestId, datasetClient, observer, status.kind, workspaceId]);

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
      retireTaskRecovery(qualityReview.requestId);
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
    retireTaskRecovery,
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
      if (!response.ok || response.value?.requestId !== qualityReview.requestId || !response.value.cancelled || response.value.status !== "cancelled") {
        setStatus({ kind: "error", message: "Discard could not be confirmed. The quality review is retained." });
        return;
      }
      retireTaskRecovery(qualityReview.requestId);
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
    retireTaskRecovery,
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
    (loadedModelCount > 0 || lowMemoryAvailable) &&
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
    constrainedSchemaValid: outputShapeCompilation.ok,
    lowMemoryAvailable,
    ocrEligible: preparationMethodId === "structure-aware" && selectedArtifactIds.length > 0 &&
      selectedSourceCapabilities.length === selectedArtifactIds.length &&
      selectedSourceCapabilities.every((source) => source.format === "pdf"),
    unsupportedDocumentPolicy,
    normalizationMode,
    ocrEnabled,
    ocrLanguage,
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
    modelMemoryMode,
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
    setOcrEnabled,
    setOcrLanguage,
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
    setModelMemoryMode,
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
