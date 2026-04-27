import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";

import type { ModelDefaultInferenceMode } from "../../../../../../../modules/contracts/settings";
import { createDesktopApplicationSettingsClient, type DesktopApplicationSettingsClient } from "../../settings";
import { createDesktopPythonRuntimeClient, type DesktopPythonRuntimeClient } from "../../python-runtime/api/desktopPythonRuntimeClient";
import type { DesktopDatasetPreparationClient } from "../api/desktopDatasetPreparationClient";
import { buildDatasetPreparationRequest } from "./datasetPreparationRequestBuilder";
import {
  validateAndParseDatasetPreparationInputs,
} from "./datasetPreparationRequestValidation";
import { resolveLatestModelDownloadProgress } from "./modelDownloadProgress";
import { useDatasetPreparationClient } from "./useDatasetPreparationClient";

interface DatasetPreparationStatus {
  kind: "idle" | "loading" | "success" | "error";
  message?: string;
}

interface DatasetPreparationResultSummary {
  datasetKey: string;
  datasetRows: number;
}

export interface UseDatasetPreparationFeatureResult {
  artifacts: Array<{ artifactId: string; label: string }>;
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

function createDatasetPreparationRequestId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `dataset-preparation-${crypto.randomUUID()}`;
  }

  return `dataset-preparation-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}


export function useDatasetPreparationFeature(
  options: UseDatasetPreparationFeatureOptions = {},
): UseDatasetPreparationFeatureResult {
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
  const [artifacts, setArtifacts] = useState<Array<{ artifactId: string; label: string }>>([]);
  const [selectedArtifactIds, setSelectedArtifactIds] = useState<string[]>([]);
  const [unsupportedDocumentPolicy, setUnsupportedDocumentPolicy] = useState<"" | "fail" | "skip">("");
  const [normalizationMode, setNormalizationMode] = useState<"" | "best-effort" | "strict">("");
  const [chunkSize, setChunkSize] = useState("1000");
  const [chunkOverlap, setChunkOverlap] = useState("200");
  const [preserveDocumentBoundaries, setPreserveDocumentBoundaries] = useState(true);
  const [maxChunkCount, setMaxChunkCount] = useState("");
  const [modelId, setModelId] = useState("");
  const [modelInferenceMode, setModelInferenceMode] = useState<ModelDefaultInferenceMode>("auto");
  const [modelDevice, setModelDevice] = useState<"" | "auto" | "cpu" | "cuda">("auto");
  const [modelTorchDtype, setModelTorchDtype] = useState<"" | "auto" | "float16" | "bfloat16" | "float32">("");
  const [maxExamplesPerChunk, setMaxExamplesPerChunk] = useState("4");
  const [batchSize, setBatchSize] = useState("4");
  const [failurePolicy, setFailurePolicy] = useState<"" | "fail" | "skip">("skip");
  const [generationTemperature, setGenerationTemperature] = useState("");
  const [generationTopP, setGenerationTopP] = useState("");
  const [generationMaxNewTokens, setGenerationMaxNewTokens] = useState("");
  const [trainRatio, setTrainRatio] = useState("0.8");
  const [testRatio, setTestRatio] = useState("0.2");
  const [seed, setSeed] = useState("");
  const [shuffle, setShuffle] = useState(true);
  const [outputFormat, setOutputFormat] = useState<"jsonl" | "json" | "csv" | "parquet">("parquet");
  const [outputBaseName, setOutputBaseName] = useState("");
  const [localDestinationEnabled, setLocalDestinationEnabled] = useState(true);
  const [huggingFaceDestinationEnabled, setHuggingFaceDestinationEnabled] = useState(false);
  const [huggingFaceRepository, setHuggingFaceRepository] = useState("");
  const [huggingFaceRevision, setHuggingFaceRevision] = useState("");
  const [huggingFacePathPrefix, setHuggingFacePathPrefix] = useState("");
  const [status, setStatus] = useState<DatasetPreparationStatus>({ kind: "idle" });
  const [resultSummary, setResultSummary] = useState<DatasetPreparationResultSummary>();
  const [defaultHuggingFaceNamespace, setDefaultHuggingFaceNamespace] = useState<string | undefined>(undefined);
  const [loadedModelCount, setLoadedModelCount] = useState(0);
  const [runtimeActiveTaskCount, setRuntimeActiveTaskCount] = useState(0);
  const [stopTrainingInFlight, setStopTrainingInFlight] = useState(false);
  const [unloadModelInFlight, setUnloadModelInFlight] = useState(false);
  const stopTrainingRequestedRef = useRef(false);

  const setStatusWarningMessage = useCallback((warningMessage: string) => {
    setStatus((current) => {
      const existingMessage = current.message?.trim();
      const nextMessage = existingMessage && existingMessage.length > 0
        ? `${existingMessage} ${warningMessage}`
        : warningMessage;
      return { kind: current.kind, message: nextMessage };
    });
  }, []);

  const refreshArtifacts = useCallback(async () => {
    const sourceArtifacts = await datasetClient.browseSourceArtifacts();
    setArtifacts(sourceArtifacts);
    setSelectedArtifactIds((current) => {
      const validArtifactIds = new Set(sourceArtifacts.map((artifact) => artifact.artifactId));
      return current.filter((artifactId) => validArtifactIds.has(artifactId));
    });
  }, [datasetClient]);

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
        setHuggingFaceRepository((current) => (current.trim().length === 0 ? `${namespace.trim()}/` : current));
      }
    }).catch(() => {
      setStatusWarningMessage("Hugging Face namespace default could not be loaded.");
    });
  }, [settingsClient, setStatusWarningMessage]);

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
      parsed: validationResult.parsed,
      resolvedDefault,
    });
    const generationModelId = request.recipe.generation.model.modelId;
    const requestId = createDatasetPreparationRequestId();
    const progressStartedAtMs = Date.now();
    let preparationActive = true;
    let progressReadInFlight = false;
    const refreshModelDownloadProgress = async () => {
      if (!runtimeStatusClient || progressReadInFlight || !preparationActive) {
        return;
      }

      progressReadInFlight = true;
      try {
        const snapshot = await runtimeStatusClient.readStatus();
        if (!preparationActive) {
          return;
        }
        const progress = resolveLatestModelDownloadProgress(snapshot, generationModelId, {
          sinceEpochMs: progressStartedAtMs,
        });
        if (progress) {
          setStatus({ kind: "loading", message: progress.message });
        }
      } catch {
        // Progress polling is best-effort; the preparation request owns final success/failure.
      } finally {
        progressReadInFlight = false;
      }
    };

    setStatus({ kind: "loading", message: `Checking model ${generationModelId} before dataset preparation...` });
    void refreshModelDownloadProgress();
    const progressTimer = window.setInterval(() => {
      void refreshModelDownloadProgress();
    }, 750);

    let response: Awaited<ReturnType<DesktopDatasetPreparationClient["prepareTrainingDatasetFromArtifacts"]>>;
    try {
      response = await datasetClient.prepareTrainingDatasetFromArtifacts(
        request,
        { requestId },
      );
    } catch (error) {
      if (stopTrainingRequestedRef.current) {
        setStatus({ kind: "idle", message: "Training stopped." });
      } else {
        setStatus({ kind: "error", message: error instanceof Error ? error.message : "Dataset preparation failed." });
      }
      return;
    } finally {
      preparationActive = false;
      window.clearInterval(progressTimer);
      void refreshRuntimeModelStatus();
    }

    if (response.ok === false) {
      setStatus(stopTrainingRequestedRef.current
        ? { kind: "idle", message: "Training stopped." }
        : { kind: "error", message: response.error.message });
      return;
    }

    setStatus({ kind: "success", message: "Training dataset is ready." });
    setResultSummary({
      datasetKey: response.value.outputs.local?.dataset.storage.key ?? "(not produced locally)",
      datasetRows: response.value.summary.datasetRowCount ?? response.value.summary.generatedExampleCount,
    });

    await refreshArtifacts();
    await refreshRuntimeModelStatus();
    onPrepared?.();
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
    huggingFaceRevision,
    huggingFacePathPrefix,
    datasetClient,
    settingsClient,
    runtimeStatusClient,
    refreshArtifacts,
    refreshRuntimeModelStatus,
    onPrepared,
  ]);

  const onStopTraining = useCallback(async () => {
    if (!runtimeStatusClient?.controlRuntime || status.kind !== "loading") {
      return;
    }

    stopTrainingRequestedRef.current = true;
    setStopTrainingInFlight(true);
    setStatus({ kind: "loading", message: "Stopping training..." });
    try {
      const snapshot = await runtimeStatusClient.controlRuntime("stop");
      setLoadedModelCount(snapshot.loadedModels.length);
      setRuntimeActiveTaskCount(snapshot.activeTaskCount);
      setStatus({ kind: "idle", message: "Training stopped." });
    } catch (error) {
      setStatus({ kind: "error", message: error instanceof Error ? error.message : "Failed to stop training." });
    } finally {
      setStopTrainingInFlight(false);
      void refreshRuntimeModelStatus();
    }
  }, [refreshRuntimeModelStatus, runtimeStatusClient, status.kind]);

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
