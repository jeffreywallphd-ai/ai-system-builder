import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";

import type { ModelDefaultInferenceMode } from "../../../../../../../modules/contracts/settings";
import { createDesktopApplicationSettingsClient, type DesktopApplicationSettingsClient } from "../../settings";
import { createDesktopPythonRuntimeClient, type DesktopPythonRuntimeClient } from "../../python-runtime/api/desktopPythonRuntimeClient";
import type { DesktopDatasetPreparationClient } from "../api/desktopDatasetPreparationClient";
import { buildDatasetPreparationRequest } from "./datasetPreparationRequestBuilder";
import {
  validateAndParseDatasetPreparationInputs,
} from "./datasetPreparationRequestValidation";
import { useDatasetPreparationClient } from "./useDatasetPreparationClient";
import { resolveUserFacingDatasetPreparationErrorMessage } from "./datasetPreparationTransport";

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

export interface UseDatasetPreparationFeatureResult {
  artifacts: Array<{ artifactId: string; label: string; storageKey: string }>;
  filteredArtifacts: Array<{ artifactId: string; label: string; storageKey: string }>;
  uploadedArtifacts: Array<{ artifactId: string; label: string; storageKey: string }>;
  generatedArtifacts: Array<{ artifactId: string; label: string; storageKey: string }>;
  selectedArtifactStorageFilter: DatasetPreparationArtifactStorageFilter;
  selectedArtifactIds: string[];
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
  onToggleArtifact: (artifactId: string) => void;
  setSelectedArtifactStorageFilter: (value: DatasetPreparationArtifactStorageFilter) => void;
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
  onSubmit: (event: FormEvent<HTMLFormElement>) => Promise<void>;
  onStopTraining: () => Promise<void>;
  onUnloadModel: () => Promise<void>;
}

export interface UseDatasetPreparationFeatureOptions {
  client?: DesktopDatasetPreparationClient;
  settingsClient?: DesktopApplicationSettingsClient;
  runtimeStatusClient?: Pick<DesktopPythonRuntimeClient, "readStatus" | "controlRuntime">;
  onPrepared?: () => void;
}

const defaultDatasetPreparationPageState: DatasetPreparationPageState = {
  selectedArtifactStorageFilter: "all",
  selectedArtifactIds: [],
  unsupportedDocumentPolicy: "",
  normalizationMode: "",
  chunkSize: "1000",
  chunkOverlap: "200",
  preserveDocumentBoundaries: true,
  maxChunkCount: "",
  modelId: "",
  modelInferenceMode: "auto",
  modelDevice: "auto",
  modelTorchDtype: "",
  maxExamplesPerChunk: "4",
  batchSize: "4",
  failurePolicy: "skip",
  generationTemperature: "",
  generationTopP: "",
  generationMaxNewTokens: "",
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
}

function createDatasetPreparationRequestId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `dataset-preparation-${crypto.randomUUID()}`;
  }

  return `dataset-preparation-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
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
  const datasetClient = useDatasetPreparationClient(options.client);
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
  const [artifacts, setArtifacts] = useState<Array<{ artifactId: string; label: string; storageKey: string }>>([]);
  const [selectedArtifactStorageFilter, setSelectedArtifactStorageFilter] =
    useState<DatasetPreparationArtifactStorageFilter>(cachedDatasetPreparationPageState.selectedArtifactStorageFilter);
  const [selectedArtifactIds, setSelectedArtifactIds] = useState<string[]>(cachedDatasetPreparationPageState.selectedArtifactIds);
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
  const stopTrainingRequestedRef = useRef(false);
  const activePollingRequestIdRef = useRef<string | undefined>(undefined);
  const pollingSessionIdRef = useRef(0);
  const isMountedRef = useRef(false);

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
    const sourceArtifacts = await datasetClient.browseSourceArtifacts();
    setArtifacts(sourceArtifacts);
    setSelectedArtifactIds((current) => {
      const validArtifactIds = new Set(sourceArtifacts.map((artifact) => artifact.artifactId));
      return current.filter((artifactId) => validArtifactIds.has(artifactId));
    });
  }, [datasetClient]);

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

    void settingsClient.resolveModelDefault({
      taskKey: "qaGeneration",
      featureKey: "datasetPreparation",
    }).then((result) => {
      setModelId((current) => current || result.resolved.modelId);
      setModelInferenceMode(result.resolved.inferenceMode);
      setModelDevice(result.resolved.device ?? "auto");
      setModelTorchDtype(result.resolved.torchDtype ?? "");
    }).catch(() => {
      setStatusWarningMessage("Using built-in model defaults because settings could not be loaded.");
    });

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

  const uploadedArtifacts = useMemo(
    () => artifacts.filter((artifact) => artifact.storageKey.startsWith("uploads/")),
    [artifacts],
  );
  const generatedArtifacts = useMemo(
    () => artifacts.filter((artifact) => artifact.storageKey.startsWith("generated/")),
    [artifacts],
  );
  const filteredArtifacts = useMemo(() => {
    if (selectedArtifactStorageFilter === "uploaded") {
      return uploadedArtifacts;
    }
    if (selectedArtifactStorageFilter === "generated") {
      return generatedArtifacts;
    }
    return artifacts;
  }, [artifacts, generatedArtifacts, selectedArtifactStorageFilter, uploadedArtifacts]);

  const onSubmit = useCallback(async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const validationResult = validateAndParseDatasetPreparationInputs({
      selectedArtifactIds,
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
    setStatus({ kind: "loading", message: "Resolving generation model settings..." });
    setResultSummary(undefined);

    const resolvedDefault = await (settingsClient?.resolveModelDefault({
      taskKey: "qaGeneration",
      featureKey: "datasetPreparation",
    }) ?? Promise.reject(new Error("settings unavailable"))).then((result) => result.resolved).catch(() => ({
      provider: "transformers" as const,
      modelId: "google/flan-t5-base",
      inferenceMode: "auto" as const,
      source: "builtin" as const,
      device: undefined,
      torchDtype: undefined,
    }));
    const request = buildDatasetPreparationRequest({
      selectedArtifactIds,
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

    const started = await datasetClient.startPrepareTrainingDataset(request, { requestId });
    if ("error" in started) {
      setStatus({ kind: "error", message: appendErrorDetailsMessage(started.error.message, started.error.details) });
      return;
    }

    setActiveDatasetPreparationTask(started.requestId);
    await pollDatasetPreparationTask(started.requestId);
  }, [
    selectedArtifactIds,
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
    settingsClient,
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

  return {
    artifacts,
    filteredArtifacts,
    uploadedArtifacts,
    generatedArtifacts,
    selectedArtifactStorageFilter,
    selectedArtifactIds,
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
    onToggleArtifact,
    setSelectedArtifactStorageFilter,
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
    onSubmit,
    onStopTraining,
    onUnloadModel,
  };
}
