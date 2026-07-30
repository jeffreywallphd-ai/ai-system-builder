import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";

import type { ModelDefaultInferenceMode } from "../../../../../../../modules/contracts/settings";
import { createWorkspaceId } from "../../../../../../../modules/contracts/workspace";
import type {
  DatasetPreparationTaskType,
  DatasetPreparationTextInputMode,
} from "../../../../../../../modules/contracts/runtime";
import {
  DATASET_PREPARATION_TEXT_GENERATION_MODEL_PRESETS,
  createDefaultDatasetPreparationTaskRecipe,
  isDatasetPreparationTaskType,
  resolveDatasetPreparationTaskProfileDefinition,
  resolveDefaultDatasetPreparationPromptTemplate,
  resolveDefaultDatasetPreparationTextGenerationParameterDefaults,
  resolveDefaultDatasetPreparationTextGenerationModel,
} from "../../../../../../../modules/contracts/runtime";
import { createDesktopApplicationSettingsClient, type DesktopApplicationSettingsClient } from "../../settings";
import { createDesktopPythonRuntimeClient, type DesktopPythonRuntimeClient } from "../../python-runtime/api/desktopPythonRuntimeClient";
import type { DesktopDatasetPreparationClient } from "../api/desktopDatasetPreparationClient";
import { buildDatasetPreparationRequest } from "./datasetPreparationRequestBuilder";
import {
  validateAndParseDatasetPreparationInputs,
} from "./datasetPreparationRequestValidation";
import { useDatasetPreparationClient } from "./useDatasetPreparationClient";
import { resolveUserFacingDatasetPreparationErrorMessage } from "./datasetPreparationTransport";
import { createDesktopModelsClient, type DesktopModelsClient } from "../../models/api/desktopModelsClient";
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
}

interface DatasetPreparationPageState {
  selectedArtifactStorageFilter: DatasetPreparationArtifactStorageFilter;
  selectedArtifactIds: string[];
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
  unsupportedDocumentPolicy: "" | "fail" | "skip";
  normalizationMode: "" | "best-effort" | "strict";
  chunkSize: string;
  chunkOverlap: string;
  preserveDocumentBoundaries: boolean;
  maxChunkCount: string;
  modelId: string;
  modelInferenceMode: ModelDefaultInferenceMode;
  modelDevice: "" | "auto" | "cpu" | "cuda";
  modelTorchDtype: "" | "auto" | "float16" | "bfloat16" | "float32";
  maxExamplesPerChunk: string;
  batchSize: string;
  failurePolicy: "" | "fail" | "skip";
  generationTemperature: string;
  generationTopP: string;
  generationMaxNewTokens: string;
  trainRatio: string;
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
  status: DatasetPreparationStatus;
  resultSummary?: DatasetPreparationResultSummary;
  activeTaskRequestId?: string;
  activeTaskType?: "dataset-preparation";
  activeTaskStartedAt?: string;
}

export type DatasetPreparationArtifactStorageFilter = "all" | "uploaded" | "generated";

type DatasetPreparationTrainingSettingsSnapshot = Omit<
  DatasetPreparationPageState,
  | "selectedArtifactStorageFilter"
  | "selectedArtifactIds"
  | "status"
  | "resultSummary"
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
  unsupportedDocumentPolicy: "" | "fail" | "skip";
  normalizationMode: "" | "best-effort" | "strict";
  chunkSize: string;
  chunkOverlap: string;
  preserveDocumentBoundaries: boolean;
  maxChunkCount: string;
  modelId: string;
  modelInferenceMode: ModelDefaultInferenceMode;
  modelDevice: "" | "auto" | "cpu" | "cuda";
  modelTorchDtype: "" | "auto" | "float16" | "bfloat16" | "float32";
  maxExamplesPerChunk: string;
  batchSize: string;
  failurePolicy: "" | "fail" | "skip";
  generationTemperature: string;
  generationTopP: string;
  generationMaxNewTokens: string;
  trainRatio: string;
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
  defaultHuggingFaceNamespace?: string;
  status: DatasetPreparationStatus;
  resultSummary?: DatasetPreparationResultSummary;
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
  setSelectedArtifactStorageFilter: (value: DatasetPreparationArtifactStorageFilter) => void;
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
  setUnsupportedDocumentPolicy: (value: "" | "fail" | "skip") => void;
  setNormalizationMode: (value: "" | "best-effort" | "strict") => void;
  setChunkSize: (value: string) => void;
  setChunkOverlap: (value: string) => void;
  setPreserveDocumentBoundaries: (value: boolean) => void;
  setMaxChunkCount: (value: string) => void;
  setModelId: (value: string) => void;
  setModelInferenceMode: (value: ModelDefaultInferenceMode) => void;
  setModelDevice: (value: "" | "auto" | "cpu" | "cuda") => void;
  setModelTorchDtype: (value: "" | "auto" | "float16" | "bfloat16" | "float32") => void;
  setMaxExamplesPerChunk: (value: string) => void;
  setBatchSize: (value: string) => void;
  setFailurePolicy: (value: "" | "fail" | "skip") => void;
  setGenerationTemperature: (value: string) => void;
  setGenerationTopP: (value: string) => void;
  setGenerationMaxNewTokens: (value: string) => void;
  setTrainRatio: (value: string) => void;
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
  setSelectedSavedTrainingSettingsId: (value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => Promise<void>;
  onStopTraining: () => Promise<void>;
  onUnloadModel: () => Promise<void>;
  onDownloadGenerationModel: () => Promise<void>;
  onSaveTrainingSettings: () => void;
  onLoadTrainingSettings: () => void;
}

export interface UseDatasetPreparationFeatureOptions {
  client?: DesktopDatasetPreparationClient;
  settingsClient?: DesktopApplicationSettingsClient;
  modelsClient?: DesktopModelsClient;
  runtimeStatusClient?: Pick<DesktopPythonRuntimeClient, "readStatus" | "controlRuntime">;
  onPrepared?: () => void;
  workspaceId?: string;
}

const DATASET_PREPARATION_TRAINING_SETTINGS_STORAGE_KEY = "ai-system-builder.datasetPreparation.trainingSettings.v1";

function stringifyDefaultNumber(value: number | undefined): string {
  return typeof value === "number" ? String(value) : "";
}

function resolveDefaultGenerationParameterState(taskType: DatasetPreparationTaskType) {
  const defaults = resolveDefaultDatasetPreparationTextGenerationParameterDefaults(taskType);
  return {
    maxExamplesPerChunk: stringifyDefaultNumber(defaults?.maxExamplesPerChunk),
    batchSize: stringifyDefaultNumber(defaults?.batchSize),
    failurePolicy: (defaults?.failurePolicy ?? "skip") as "" | "fail" | "skip",
    generationTemperature: stringifyDefaultNumber(defaults?.temperature),
    generationTopP: stringifyDefaultNumber(defaults?.topP),
    generationMaxNewTokens: stringifyDefaultNumber(defaults?.maxNewTokens),
  };
}

const defaultTaskGenerationParameters = resolveDefaultGenerationParameterState("llm-instruction");
const defaultTaskGenerationModel = resolveDefaultDatasetPreparationTextGenerationModel("llm-instruction");

const defaultDatasetPreparationPageState: DatasetPreparationPageState = {
  selectedArtifactStorageFilter: "all",
  selectedArtifactIds: [],
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
  textGenerationPrompt: resolveDefaultDatasetPreparationPromptTemplate("llm-instruction") ?? "",
  unsupportedDocumentPolicy: "",
  normalizationMode: "",
  chunkSize: "1000",
  chunkOverlap: "200",
  preserveDocumentBoundaries: true,
  maxChunkCount: "",
  modelId: defaultTaskGenerationModel?.modelId ?? "",
  modelInferenceMode: defaultTaskGenerationModel?.inferenceMode ?? "auto",
  modelDevice: defaultTaskGenerationModel?.device ?? "auto",
  modelTorchDtype: defaultTaskGenerationModel?.torchDtype ?? "",
  maxExamplesPerChunk: defaultTaskGenerationParameters.maxExamplesPerChunk,
  batchSize: defaultTaskGenerationParameters.batchSize,
  failurePolicy: defaultTaskGenerationParameters.failurePolicy,
  generationTemperature: defaultTaskGenerationParameters.generationTemperature,
  generationTopP: defaultTaskGenerationParameters.generationTopP,
  generationMaxNewTokens: defaultTaskGenerationParameters.generationMaxNewTokens,
  trainRatio: "0.8",
  testRatio: "0.2",
  seed: "",
  shuffle: true,
  outputFormat: "parquet",
  outputBaseName: "",
  localDestinationEnabled: true,
  huggingFaceDestinationEnabled: false,
  huggingFaceRepository: "",
  huggingFaceRevision: "",
  huggingFacePathPrefix: "",
  status: { kind: "idle" },
  resultSummary: undefined,
  activeTaskRequestId: undefined,
  activeTaskType: undefined,
  activeTaskStartedAt: undefined,
};

let cachedDatasetPreparationPageState: DatasetPreparationPageState = { ...defaultDatasetPreparationPageState };

export function resetDatasetPreparationPageStateForTests(): void {
  cachedDatasetPreparationPageState = { ...defaultDatasetPreparationPageState };
  try {
    if (typeof window !== "undefined") {
      window.localStorage?.removeItem(DATASET_PREPARATION_TRAINING_SETTINGS_STORAGE_KEY);
    }
  } catch {
    // Tests and restricted browser contexts may not expose localStorage.
  }
}

function createDatasetPreparationRequestId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `dataset-preparation-${crypto.randomUUID()}`;
  }

  return `dataset-preparation-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function createSavedTrainingSettingsId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `training-settings-${crypto.randomUUID()}`;
  }

  return `training-settings-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function readSavedTrainingSettingsFromStorage(): SavedDatasetPreparationTrainingSettings[] {
  if (typeof window === "undefined") {
    return [];
  }

  try {
    const raw = window.localStorage?.getItem(DATASET_PREPARATION_TRAINING_SETTINGS_STORAGE_KEY);
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.filter((entry): entry is SavedDatasetPreparationTrainingSettings => {
      if (typeof entry !== "object" || entry === null) {
        return false;
      }
      const candidate = entry as SavedDatasetPreparationTrainingSettings;
      return typeof candidate.id === "string"
        && typeof candidate.label === "string"
        && typeof candidate.savedAt === "string"
        && typeof candidate.settings === "object"
        && candidate.settings !== null
        && isDatasetPreparationTaskType((candidate.settings as { taskType?: string }).taskType ?? "");
    });
  } catch {
    return [];
  }
}

function writeSavedTrainingSettingsToStorage(settings: SavedDatasetPreparationTrainingSettings[]): void {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.localStorage?.setItem(DATASET_PREPARATION_TRAINING_SETTINGS_STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Saved settings are a convenience feature; the form still works if browser storage is unavailable.
  }
}

function createDefaultTrainingSettingsSnapshot(
  taskType: DatasetPreparationTaskType,
): DatasetPreparationTrainingSettingsSnapshot {
  const profile = resolveDatasetPreparationTaskProfileDefinition(taskType);
  const taskModelDefault = resolveDefaultDatasetPreparationTextGenerationModel(taskType);
  const generationParameters = resolveDefaultGenerationParameterState(taskType);
  return {
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
    textGenerationPrompt: resolveDefaultDatasetPreparationPromptTemplate(taskType) ?? "",
    unsupportedDocumentPolicy: "",
    normalizationMode: "",
    chunkSize: defaultDatasetPreparationPageState.chunkSize,
    chunkOverlap: defaultDatasetPreparationPageState.chunkOverlap,
    preserveDocumentBoundaries: defaultDatasetPreparationPageState.preserveDocumentBoundaries,
    maxChunkCount: "",
    modelId: taskModelDefault?.modelId ?? "",
    modelInferenceMode: taskModelDefault?.inferenceMode ?? "auto",
    modelDevice: taskModelDefault?.device ?? "auto",
    modelTorchDtype: taskModelDefault?.torchDtype ?? "",
    maxExamplesPerChunk: generationParameters.maxExamplesPerChunk,
    batchSize: generationParameters.batchSize,
    failurePolicy: generationParameters.failurePolicy,
    generationTemperature: generationParameters.generationTemperature,
    generationTopP: generationParameters.generationTopP,
    generationMaxNewTokens: generationParameters.generationMaxNewTokens,
    trainRatio: defaultDatasetPreparationPageState.trainRatio,
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
  };
}

function serializeTrainingSettingsSnapshot(snapshot: DatasetPreparationTrainingSettingsSnapshot): string {
  return JSON.stringify(snapshot);
}

function resolveDefaultTextInputMode(taskType: DatasetPreparationTaskType): DatasetPreparationTextInputMode {
  return createDefaultDatasetPreparationTaskRecipe(taskType).textInputMode ?? "provided";
}

function normalizeModelIdentity(value: string | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

function isUsableGenerationModelRecord(record: DesktopModelInventoryRecord, selectedModelId: string): boolean {
  const lifecycleStatus = record.lifecycleStatus;
  return normalizeModelIdentity(record.modelId) === normalizeModelIdentity(selectedModelId)
    && (lifecycleStatus === "downloaded" || lifecycleStatus === "generated" || lifecycleStatus === "validated");
}

function appendErrorDetailsMessage(message: string, details: Record<string, unknown> | undefined): string {
  if (!details) {
    return message;
  }

  const reason = typeof details.reason === "string" ? details.reason : undefined;
  const status = typeof details.providerStatusCode === "number" ? details.providerStatusCode : undefined;
  const repository = typeof details.repository === "string" ? details.repository : undefined;
  const pathInRepo = typeof details.pathInRepo === "string" ? details.pathInRepo : undefined;
  const suffix = [reason, status ? `status ${status}` : undefined, repository, pathInRepo]
    .filter((part): part is string => typeof part === "string" && part.trim().length > 0)
    .join(" | ");
  return suffix ? `${message} Details: ${suffix}.` : message;
}

function isTransientPollReadFailure(message: string, details?: Record<string, unknown>): boolean {
  const normalized = message.toLowerCase();
  if (normalized.includes("fetch failed") || normalized.includes("network") || normalized.includes("transport")) {
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
  const [artifacts, setArtifacts] = useState<DatasetPreparationSourceArtifact[]>([]);
  const [selectedArtifactStorageFilter, setSelectedArtifactStorageFilter] =
    useState<DatasetPreparationArtifactStorageFilter>(cachedDatasetPreparationPageState.selectedArtifactStorageFilter);
  const [selectedArtifactIds, setSelectedArtifactIds] = useState<string[]>(cachedDatasetPreparationPageState.selectedArtifactIds);
  const [taskType, setTaskType] = useState<DatasetPreparationTaskType>(cachedDatasetPreparationPageState.taskType);
  const [labelSet, setLabelSet] = useState(cachedDatasetPreparationPageState.labelSet);
  const [multiLabel, setMultiLabel] = useState(cachedDatasetPreparationPageState.multiLabel);
  const [extractionStrictSchema, setExtractionStrictSchema] = useState(cachedDatasetPreparationPageState.extractionStrictSchema);
  const [diffusionConceptKind, setDiffusionConceptKind] = useState<"subject" | "style" | "concept">(cachedDatasetPreparationPageState.diffusionConceptKind);
  const [diffusionTriggerToken, setDiffusionTriggerToken] = useState(cachedDatasetPreparationPageState.diffusionTriggerToken);
  const [diffusionRegularizationClass, setDiffusionRegularizationClass] = useState(cachedDatasetPreparationPageState.diffusionRegularizationClass);
  const [detectionBoxFormat, setDetectionBoxFormat] = useState<"coco" | "xyxy" | "xywh">(cachedDatasetPreparationPageState.detectionBoxFormat);
  const [segmentationMaskFormat, setSegmentationMaskFormat] = useState<"png" | "coco-rle" | "polygon">(cachedDatasetPreparationPageState.segmentationMaskFormat);
  const [textInputMode, setTextInputMode] = useState<DatasetPreparationTextInputMode>(cachedDatasetPreparationPageState.textInputMode);
  const [textGenerationPrompt, setTextGenerationPrompt] = useState(cachedDatasetPreparationPageState.textGenerationPrompt);
  const [unsupportedDocumentPolicy, setUnsupportedDocumentPolicy] = useState<"" | "fail" | "skip">(cachedDatasetPreparationPageState.unsupportedDocumentPolicy);
  const [normalizationMode, setNormalizationMode] = useState<"" | "best-effort" | "strict">(cachedDatasetPreparationPageState.normalizationMode);
  const [chunkSize, setChunkSize] = useState(cachedDatasetPreparationPageState.chunkSize);
  const [chunkOverlap, setChunkOverlap] = useState(cachedDatasetPreparationPageState.chunkOverlap);
  const [preserveDocumentBoundaries, setPreserveDocumentBoundaries] = useState(cachedDatasetPreparationPageState.preserveDocumentBoundaries);
  const [maxChunkCount, setMaxChunkCount] = useState(cachedDatasetPreparationPageState.maxChunkCount);
  const [modelId, setModelId] = useState(cachedDatasetPreparationPageState.modelId);
  const [modelInferenceMode, setModelInferenceMode] = useState<ModelDefaultInferenceMode>(cachedDatasetPreparationPageState.modelInferenceMode);
  const [modelDevice, setModelDevice] = useState<"" | "auto" | "cpu" | "cuda">(cachedDatasetPreparationPageState.modelDevice);
  const [modelTorchDtype, setModelTorchDtype] = useState<"" | "auto" | "float16" | "bfloat16" | "float32">(cachedDatasetPreparationPageState.modelTorchDtype);
  const [maxExamplesPerChunk, setMaxExamplesPerChunk] = useState(cachedDatasetPreparationPageState.maxExamplesPerChunk);
  const [batchSize, setBatchSize] = useState(cachedDatasetPreparationPageState.batchSize);
  const [failurePolicy, setFailurePolicy] = useState<"" | "fail" | "skip">(cachedDatasetPreparationPageState.failurePolicy);
  const [generationTemperature, setGenerationTemperature] = useState(cachedDatasetPreparationPageState.generationTemperature);
  const [generationTopP, setGenerationTopP] = useState(cachedDatasetPreparationPageState.generationTopP);
  const [generationMaxNewTokens, setGenerationMaxNewTokens] = useState(cachedDatasetPreparationPageState.generationMaxNewTokens);
  const [trainRatio, setTrainRatio] = useState(cachedDatasetPreparationPageState.trainRatio);
  const [testRatio, setTestRatio] = useState(cachedDatasetPreparationPageState.testRatio);
  const [seed, setSeed] = useState(cachedDatasetPreparationPageState.seed);
  const [shuffle, setShuffle] = useState(cachedDatasetPreparationPageState.shuffle);
  const [outputFormat, setOutputFormat] = useState<"jsonl" | "json" | "csv" | "parquet">(cachedDatasetPreparationPageState.outputFormat);
  const [outputBaseName, setOutputBaseName] = useState(cachedDatasetPreparationPageState.outputBaseName);
  const [localDestinationEnabled, setLocalDestinationEnabled] = useState(cachedDatasetPreparationPageState.localDestinationEnabled);
  const [huggingFaceDestinationEnabled, setHuggingFaceDestinationEnabled] = useState(cachedDatasetPreparationPageState.huggingFaceDestinationEnabled);
  const [huggingFaceRepository, setHuggingFaceRepository] = useState(cachedDatasetPreparationPageState.huggingFaceRepository);
  const [huggingFaceRevision, setHuggingFaceRevision] = useState(cachedDatasetPreparationPageState.huggingFaceRevision);
  const [huggingFacePathPrefix, setHuggingFacePathPrefix] = useState(cachedDatasetPreparationPageState.huggingFacePathPrefix);
  const [status, setStatus] = useState<DatasetPreparationStatus>(cachedDatasetPreparationPageState.status);
  const [resultSummary, setResultSummary] = useState<DatasetPreparationResultSummary | undefined>(cachedDatasetPreparationPageState.resultSummary);
  const [defaultHuggingFaceNamespace, setDefaultHuggingFaceNamespace] = useState<string | undefined>(undefined);
  const [activeTaskRequestId, setActiveTaskRequestId] = useState<string | undefined>(cachedDatasetPreparationPageState.activeTaskRequestId);
  const [activeTaskStartedAt, setActiveTaskStartedAt] = useState<string | undefined>(cachedDatasetPreparationPageState.activeTaskStartedAt);
  const [loadedModelCount, setLoadedModelCount] = useState(0);
  const [runtimeActiveTaskCount, setRuntimeActiveTaskCount] = useState(0);
  const [stopTrainingInFlight, setStopTrainingInFlight] = useState(false);
  const [unloadModelInFlight, setUnloadModelInFlight] = useState(false);
  const [generationModelRecords, setGenerationModelRecords] = useState<DesktopModelInventoryRecord[]>([]);
  const [generationModelAvailabilityChecked, setGenerationModelAvailabilityChecked] = useState(false);
  const [modelDownloadStatus, setModelDownloadStatus] = useState<DatasetPreparationStatus>({ kind: "idle" });
  const [savedTrainingSettings, setSavedTrainingSettings] = useState<SavedDatasetPreparationTrainingSettings[]>(() =>
    readSavedTrainingSettingsFromStorage());
  const [selectedSavedTrainingSettingsId, setSelectedSavedTrainingSettingsId] = useState("");
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
      unsupportedDocumentPolicy,
      normalizationMode,
      chunkSize,
      chunkOverlap,
      preserveDocumentBoundaries,
      maxChunkCount,
      modelId,
      modelInferenceMode,
      modelDevice,
      modelTorchDtype,
      maxExamplesPerChunk,
      batchSize,
      failurePolicy,
      generationTemperature,
      generationTopP,
      generationMaxNewTokens,
      trainRatio,
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
      status,
      resultSummary,
      activeTaskRequestId,
      activeTaskType: activeTaskRequestId ? "dataset-preparation" : undefined,
      activeTaskStartedAt,
    };
  }, [
    selectedArtifactStorageFilter,
    selectedArtifactIds,
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
    unsupportedDocumentPolicy,
    normalizationMode,
    chunkSize,
    chunkOverlap,
    preserveDocumentBoundaries,
    maxChunkCount,
    modelId,
    modelInferenceMode,
    modelDevice,
    modelTorchDtype,
    maxExamplesPerChunk,
    batchSize,
    failurePolicy,
    generationTemperature,
    generationTopP,
    generationMaxNewTokens,
    trainRatio,
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
    status,
    resultSummary,
    activeTaskRequestId,
    activeTaskStartedAt,
  ]);

  useEffect(() => {
    if (suppressNextTaskDefaultResetRef.current) {
      suppressNextTaskDefaultResetRef.current = false;
      return;
    }

    const profile = resolveDatasetPreparationTaskProfileDefinition(taskType);
    const taskModelDefault = resolveDefaultDatasetPreparationTextGenerationModel(taskType);
    const generationParameters = resolveDefaultGenerationParameterState(taskType);
    setOutputFormat(profile.preferredOutputFormat);
    setTextInputMode(resolveDefaultTextInputMode(taskType));
    setTextGenerationPrompt(resolveDefaultDatasetPreparationPromptTemplate(taskType) ?? "");
    setModelId(taskModelDefault?.modelId ?? "");
    setModelInferenceMode(taskModelDefault?.inferenceMode ?? "auto");
    setModelDevice(taskModelDefault?.device ?? "auto");
    setModelTorchDtype(taskModelDefault?.torchDtype ?? "");
    setMaxExamplesPerChunk(generationParameters.maxExamplesPerChunk);
    setBatchSize(generationParameters.batchSize);
    setFailurePolicy(generationParameters.failurePolicy);
    setGenerationTemperature(generationParameters.generationTemperature);
    setGenerationTopP(generationParameters.generationTopP);
    setGenerationMaxNewTokens(generationParameters.generationMaxNewTokens);
  }, [taskType]);

  const setStatusWarningMessage = useCallback((warningMessage: string) => {
    setStatus((current) => {
      const existingMessage = current.message?.trim();
      const nextMessage = existingMessage && existingMessage.length > 0
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
    const sourceArtifacts = await datasetClient.browseSourceArtifacts(workspaceId);
    setArtifacts(sourceArtifacts);
    setSelectedArtifactIds((current) => {
      const validArtifactIds = new Set(sourceArtifacts.map((artifact) => artifact.artifactId));
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
    } catch {
      // Runtime status is best-effort for model lifecycle controls.
    }
  }, [runtimeStatusClient]);

  const refreshGenerationModelAvailability = useCallback(async () => {
    const selectedModelId = modelId.trim();
    if (!modelClient || !workspaceId || !selectedModelId || textInputMode !== "generate") {
      setGenerationModelRecords([]);
      setGenerationModelAvailabilityChecked(Boolean(selectedModelId) && textInputMode === "generate");
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

  const isPollingStillActive = useCallback((requestId: string, sessionId: number): boolean => {
    return isMountedRef.current
      && activePollingRequestIdRef.current === requestId
      && pollingSessionIdRef.current === sessionId
      && !stopTrainingRequestedRef.current;
  }, []);

  const pollDatasetPreparationTask = useCallback(async (requestId: string) => {
    if (activePollingRequestIdRef.current === requestId) return;
    activePollingRequestIdRef.current = requestId;
    const pollingSessionId = pollingSessionIdRef.current;
    let pollRecoveryStartedAtMs: number | undefined;
    while (isPollingStillActive(requestId, pollingSessionId)) {
      try {
        const pollResponse = await datasetClient.readPrepareTrainingDatasetTask(requestId);
        if (!isPollingStillActive(requestId, pollingSessionId)) return;
        if (pollResponse.ok === false) {
          if (!pollRecoveryStartedAtMs) pollRecoveryStartedAtMs = Date.now();
          if (isTransientPollReadFailure(pollResponse.error.message, pollResponse.error.details)
            && (Date.now() - pollRecoveryStartedAtMs) < pollingRecoveryGraceWindowMs) {
            setStatus({ kind: "loading", message: "Reconnecting to dataset preparation task..." });
            await new Promise<void>((resolve) => window.setTimeout(resolve, 750));
            if (!isPollingStillActive(requestId, pollingSessionId)) return;
            continue;
          }
          clearActiveTask();
          setStatus({ kind: "error", message: appendErrorDetailsMessage(pollResponse.error.message, pollResponse.error.details) });
          return;
        }
        if (pollResponse.status === "pending" || pollResponse.status === "running") {
          const processed = pollResponse.progress?.processed;
          const total = pollResponse.progress?.total;
          const suffix = typeof processed === "number" && typeof total === "number" ? ` (${processed}/${total})` : "";
          setStatus({ kind: "loading", message: `${pollResponse.progress?.message ?? "Preparing training dataset..."}${suffix}` });
          await new Promise<void>((resolve) => window.setTimeout(resolve, 750));
          if (!isPollingStillActive(requestId, pollingSessionId)) return;
          continue;
        }
        if (pollResponse.status === "cancelled") {
          clearActiveTask(); setStatus({ kind: "idle", message: "Training stopped." }); return;
        }
        if (pollResponse.status === "unknown") {
          clearActiveTask(); setStatus({ kind: "error", message: "Dataset preparation task could not be found or is no longer available." }); return;
        }
        if (pollResponse.status === "succeeded") {
          clearActiveTask();
          setStatus({ kind: "success", message: "Training dataset is ready." });
          setResultSummary({ datasetKey: pollResponse.value.outputs.local?.dataset.storage.key ?? "(not produced locally)", datasetRows: pollResponse.value.summary.datasetRowCount ?? pollResponse.value.summary.generatedExampleCount });
          await refreshArtifacts();
          if (!isPollingStillActive(requestId, pollingSessionId)) return;
          await refreshRuntimeModelStatus();
          if (!isPollingStillActive(requestId, pollingSessionId)) return;
          onPrepared?.(); return;
        }
        clearActiveTask(); setStatus({ kind: "error", message: "Dataset preparation task returned an invalid status." }); return;
      } catch (error) {
        if (!pollRecoveryStartedAtMs) pollRecoveryStartedAtMs = Date.now();
        if ((Date.now() - pollRecoveryStartedAtMs) < pollingRecoveryGraceWindowMs) {
          setStatus({ kind: "loading", message: "Reconnecting to dataset preparation task..." });
          await new Promise<void>((resolve) => window.setTimeout(resolve, 750));
          if (!isPollingStillActive(requestId, pollingSessionId)) return;
          continue;
        }
        clearActiveTask(); setStatus({ kind: "error", message: resolveUserFacingDatasetPreparationErrorMessage(error) }); return;
      }
    }
    if (!isMountedRef.current
      || activePollingRequestIdRef.current !== requestId
      || pollingSessionIdRef.current !== pollingSessionId) {
      return;
    }
    if (stopTrainingRequestedRef.current) {
      clearActiveTask();
      setStatus({ kind: "idle", message: "Training stopped." });
    }
  }, [clearActiveTask, datasetClient, isPollingStillActive, onPrepared, pollingRecoveryGraceWindowMs, refreshArtifacts, refreshRuntimeModelStatus]);

  useEffect(() => {
    if (status.kind === "loading" && activeTaskRequestId) void pollDatasetPreparationTask(activeTaskRequestId);
  }, [activeTaskRequestId, pollDatasetPreparationTask, status.kind]);

  useEffect(() => {
    void refreshArtifacts().catch((error) => {
      const message = error instanceof Error ? error.message : "Failed to load artifacts.";
      setStatus({ kind: "error", message });
    });
  }, [refreshArtifacts]);

  useEffect(() => {
    if (!settingsClient) {
      return;
    }

    void settingsClient.readSettings({ keys: ["huggingface.defaultNamespace"] }).then((result) => {
      const namespace = result.values.find((value) => value.key === "huggingface.defaultNamespace")?.value;
      if (typeof namespace === "string" && namespace.trim().length > 0) {
        setDefaultHuggingFaceNamespace(namespace.trim());
      }
    }).catch(() => {
      setStatusWarningMessage("Hugging Face namespace default could not be loaded.");
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
        : [...current, artifactId]);
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
  }, [generatedArtifacts, selectedArtifactStorageFilter, taskRelevantArtifacts, uploadedArtifacts]);

  useEffect(() => {
    setSelectedArtifactIds((current) => {
      const relevantArtifactIds = new Set(taskRelevantArtifacts.map((artifact) => artifact.artifactId));
      return current.filter((artifactId) => relevantArtifactIds.has(artifactId));
    });
  }, [taskRelevantArtifacts]);

  const currentTrainingSettingsSnapshot = useMemo<DatasetPreparationTrainingSettingsSnapshot>(() => ({
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
    unsupportedDocumentPolicy,
    normalizationMode,
    chunkSize,
    chunkOverlap,
    preserveDocumentBoundaries,
    maxChunkCount,
    modelId,
    modelInferenceMode,
    modelDevice,
    modelTorchDtype,
    maxExamplesPerChunk,
    batchSize,
    failurePolicy,
    generationTemperature,
    generationTopP,
    generationMaxNewTokens,
    trainRatio,
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
  }), [
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
    unsupportedDocumentPolicy,
    normalizationMode,
    chunkSize,
    chunkOverlap,
    preserveDocumentBoundaries,
    maxChunkCount,
    modelId,
    modelInferenceMode,
    modelDevice,
    modelTorchDtype,
    maxExamplesPerChunk,
    batchSize,
    failurePolicy,
    generationTemperature,
    generationTopP,
    generationMaxNewTokens,
    trainRatio,
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
  ]);

  const hasTrainingSettingsChanges = useMemo(() =>
    serializeTrainingSettingsSnapshot(currentTrainingSettingsSnapshot)
      !== serializeTrainingSettingsSnapshot(createDefaultTrainingSettingsSnapshot(taskType)),
  [currentTrainingSettingsSnapshot, taskType]);

  const applyTrainingSettingsSnapshot = useCallback((settings: DatasetPreparationTrainingSettingsSnapshot) => {
    suppressNextTaskDefaultResetRef.current = settings.taskType !== taskType;
    setTaskType(settings.taskType);
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
    setUnsupportedDocumentPolicy(settings.unsupportedDocumentPolicy);
    setNormalizationMode(settings.normalizationMode);
    setChunkSize(settings.chunkSize);
    setChunkOverlap(settings.chunkOverlap);
    setPreserveDocumentBoundaries(settings.preserveDocumentBoundaries);
    setMaxChunkCount(settings.maxChunkCount);
    setModelId(settings.modelId);
    setModelInferenceMode(settings.modelInferenceMode);
    setModelDevice(settings.modelDevice);
    setModelTorchDtype(settings.modelTorchDtype);
    setMaxExamplesPerChunk(settings.maxExamplesPerChunk);
    setBatchSize(settings.batchSize);
    setFailurePolicy(settings.failurePolicy);
    setGenerationTemperature(settings.generationTemperature);
    setGenerationTopP(settings.generationTopP);
    setGenerationMaxNewTokens(settings.generationMaxNewTokens);
    setTrainRatio(settings.trainRatio);
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
  }, [taskType]);

  const onSaveTrainingSettings = useCallback(() => {
    const profile = resolveDatasetPreparationTaskProfileDefinition(currentTrainingSettingsSnapshot.taskType);
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
    const selected = savedTrainingSettings.find((settings) => settings.id === selectedSavedTrainingSettingsId);
    if (!selected) {
      return;
    }
    applyTrainingSettingsSnapshot(selected.settings);
    setStatus({ kind: "idle" });
  }, [applyTrainingSettingsSnapshot, savedTrainingSettings, selectedSavedTrainingSettingsId]);

  const onSubmit = useCallback(async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const validationResult = validateAndParseDatasetPreparationInputs({
      selectedArtifactIds,
      taskType,
      chunkSize,
      chunkOverlap,
      maxChunkCount,
      modelId,
      maxExamplesPerChunk,
      batchSize,
      generationTemperature,
      generationTopP,
      generationMaxNewTokens,
      trainRatio,
      testRatio,
      seed,
      localDestinationEnabled,
      huggingFaceDestinationEnabled,
      huggingFaceRepository,
      defaultHuggingFaceNamespace,
    });

    if (validationResult.ok === false) {
      setStatus({ kind: "error", message: validationResult.error });
      return;
    }

    stopTrainingRequestedRef.current = false;
    setStatus({ kind: "loading", message: "Preparing training dataset request..." });
    setResultSummary(undefined);

    const taskModelDefault = resolveDefaultDatasetPreparationTextGenerationModel(taskType);
    const fallbackModelDefault = DATASET_PREPARATION_TEXT_GENERATION_MODEL_PRESETS[0].model;
    const resolvedDefault = {
      provider: "transformers" as const,
      modelId: taskModelDefault?.modelId ?? fallbackModelDefault.modelId,
      inferenceMode: (taskModelDefault?.inferenceMode ?? fallbackModelDefault.inferenceMode ?? "auto") as ModelDefaultInferenceMode,
      source: "builtin" as const,
      device: taskModelDefault?.device ?? fallbackModelDefault.device,
      torchDtype: taskModelDefault?.torchDtype ?? fallbackModelDefault.torchDtype,
    };
    const request = buildDatasetPreparationRequest({
      selectedArtifactIds,
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
      unsupportedDocumentPolicy,
      normalizationMode,
      preserveDocumentBoundaries,
      modelId,
      modelInferenceMode,
      modelDevice,
      modelTorchDtype,
      failurePolicy,
      shuffle,
      outputFormat,
      outputBaseName,
      localDestinationEnabled,
      huggingFaceDestinationEnabled,
      huggingFaceRepository,
      huggingFaceRevision,
      huggingFacePathPrefix,
      defaultHuggingFaceNamespace,
      parsed: validationResult.parsed,
      resolvedDefault,
    });
    const generationModelId = request.recipe.generation.model.modelId;
    const requestId = createDatasetPreparationRequestId();

    window.dispatchEvent(new CustomEvent("dataset-preparation-training-started"));
    setStatus({ kind: "loading", message: `Checking model ${generationModelId} before dataset preparation...` });

    if (!workspaceId) {
      setStatus({ kind: "error", message: "Select a workspace before preparing datasets." });
      return;
    }

    const started = await datasetClient.startPrepareTrainingDataset({ ...request, workspaceId } as never, { requestId });
    if ("error" in started) {
      setStatus({ kind: "error", message: appendErrorDetailsMessage(started.error.message, started.error.details) });
      return;
    }

    setActiveDatasetPreparationTask(started.requestId);
    await pollDatasetPreparationTask(started.requestId);
  }, [
    selectedArtifactIds,
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
    unsupportedDocumentPolicy,
    normalizationMode,
    chunkSize,
    chunkOverlap,
    preserveDocumentBoundaries,
    maxChunkCount,
    modelId,
    modelInferenceMode,
    modelDevice,
    modelTorchDtype,
    maxExamplesPerChunk,
    batchSize,
    failurePolicy,
    generationTemperature,
    generationTopP,
    generationMaxNewTokens,
    trainRatio,
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
    datasetClient,
    workspaceId,
    pollDatasetPreparationTask,
    setActiveDatasetPreparationTask,
  ]);

  const onStopTraining = useCallback(async () => {
    if (!activeTaskRequestId || status.kind !== "loading") {
      return;
    }

    stopTrainingRequestedRef.current = true;
    setStopTrainingInFlight(true);
    setStatus({ kind: "loading", message: "Stopping dataset preparation..." });
    try {
      const response = await datasetClient.cancelPrepareTrainingDatasetTask(activeTaskRequestId);
      if (response.ok === false) {
        setStatus({ kind: "error", message: appendErrorDetailsMessage(response.error.message, response.error.details) });
      }
    } catch (error) {
      setStatus({ kind: "error", message: error instanceof Error ? error.message : "Failed to stop training." });
    } finally {
      setStopTrainingInFlight(false);
      void refreshRuntimeModelStatus();
    }
  }, [activeTaskRequestId, datasetClient, refreshRuntimeModelStatus, status.kind]);

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
      setStatus({ kind: "error", message: error instanceof Error ? error.message : "Failed to unload model." });
    } finally {
      setUnloadModelInFlight(false);
      void refreshRuntimeModelStatus();
    }
  }, [refreshRuntimeModelStatus, runtimeStatusClient, status.kind]);

  const canUnloadModel = loadedModelCount > 0 && runtimeActiveTaskCount === 0 && status.kind !== "loading";
  const selectedGenerationModelAvailable = useMemo(() =>
    generationModelRecords.some((record) => isUsableGenerationModelRecord(record, modelId)),
  [generationModelRecords, modelId]);
  const modelDownloadInFlight = modelDownloadStatus.kind === "loading";

  const onDownloadGenerationModel = useCallback(async () => {
    const selectedModelId = modelId.trim();
    if (!selectedModelId) {
      setModelDownloadStatus({ kind: "error", message: "Enter a model ID before downloading." });
      return;
    }
    if (!workspaceId) {
      setModelDownloadStatus({ kind: "error", message: "Select a workspace before downloading models." });
      return;
    }
    if (!modelClient) {
      setModelDownloadStatus({ kind: "error", message: "Model download is not available in this environment." });
      return;
    }

    setModelDownloadStatus({ kind: "loading", message: `Downloading ${selectedModelId}...` });
    try {
      await modelClient.downloadModel({
        workspaceId,
        modelId: selectedModelId,
        displayName: selectedModelId,
        inferenceMode: modelInferenceMode === "auto" ? undefined : modelInferenceMode,
        artifactForm: "full-model",
        taskTags: ["chat", "text-generation"],
        metadata: {
          source: "dataset-preparation",
          usage: "text-field-generation",
        },
      });
      setModelDownloadStatus({ kind: "success", message: "Model downloaded and recorded in model management." });
      await refreshGenerationModelAvailability();
    } catch (error) {
      setModelDownloadStatus({ kind: "error", message: error instanceof Error ? error.message : "Failed to download model." });
    }
  }, [modelClient, modelId, modelInferenceMode, refreshGenerationModelAvailability, workspaceId]);

  return {
    artifacts: taskRelevantArtifacts,
    allArtifactCount: artifacts.length,
    filteredArtifacts,
    uploadedArtifacts,
    generatedArtifacts,
    selectedArtifactStorageFilter,
    selectedArtifactIds,
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
    unsupportedDocumentPolicy,
    normalizationMode,
    chunkSize,
    chunkOverlap,
    preserveDocumentBoundaries,
    maxChunkCount,
    modelId,
    modelInferenceMode,
    modelDevice,
    modelTorchDtype,
    maxExamplesPerChunk,
    batchSize,
    failurePolicy,
    generationTemperature,
    generationTopP,
    generationMaxNewTokens,
    trainRatio,
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
    defaultHuggingFaceNamespace,
    status,
    resultSummary,
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
    setUnsupportedDocumentPolicy,
    setNormalizationMode,
    setChunkSize,
    setChunkOverlap,
    setPreserveDocumentBoundaries,
    setMaxChunkCount,
    setModelId,
    setModelInferenceMode,
    setModelDevice,
    setModelTorchDtype,
    setMaxExamplesPerChunk,
    setBatchSize,
    setFailurePolicy,
    setGenerationTemperature,
    setGenerationTopP,
    setGenerationMaxNewTokens,
    setTrainRatio,
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
    setSelectedSavedTrainingSettingsId,
    onSubmit,
    onStopTraining,
    onUnloadModel,
    onDownloadGenerationModel,
    onSaveTrainingSettings,
    onLoadTrainingSettings,
  };
}
