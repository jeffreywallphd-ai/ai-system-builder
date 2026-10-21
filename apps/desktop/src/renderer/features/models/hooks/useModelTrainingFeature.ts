import { useTaskObservationManager } from "../../../../../../../modules/ui/shared/notifications/TaskObservationProvider";
import { useCallback, useEffect, useMemo, useState, useRef } from "react";

import type { DesktopArtifactBrowseItem } from "../../../lib/desktopApi";
import type { DesktopModelInventoryRecord, DesktopModelTrainingResult } from "../../../lib/desktopApi";
import { createDesktopApplicationSettingsClient } from "../../settings";
import { createDesktopPythonRuntimeClient } from "../../python-runtime/api/desktopPythonRuntimeClient";
import type { DesktopModelsClient } from "../api/desktopModelsClient";
import { announceModelTrainingStarted } from "./modelTrainingNotificationEvents";
import { useModelsClient } from "./useModelsClient";
import { createWorkspaceId } from "../../../../../../../modules/contracts/workspace";
import type { DatasetPreparationTaskType } from "../../../../../../../modules/contracts/runtime";

type TrainingStatus = "idle" | "running" | "succeeded" | "failed" | "cancelled";
type PollableTrainingStatus = DesktopModelTrainingResult["status"];

const TRAINING_DATASET_MEDIA_TYPES = new Set([
  "application/x-parquet",
  "application/vnd.apache.parquet",
  "application/x-ndjson",
  "application/json",
  "text/csv",
]);
const TRAINING_DATASET_FILE_EXTENSIONS = [
  ".parquet",
  ".jsonl",
  ".json",
  ".csv",
];



function isTerminalTrainingStatus(status: PollableTrainingStatus): boolean {
  return status === "succeeded" || status === "failed" || status === "cancelled";
}

function toTrainingMessage(result: DesktopModelTrainingResult): string {
  const progress = result.progress;
  if (progress?.message) {
    return `Training ${result.status}. Run ID: ${result.runId}. ${progress.message}`;
  }

  if (progress && (typeof progress.totalEpochs === "number" || typeof progress.totalBatches === "number")) {
    return (
      `Training ${result.status}. Run ID: ${result.runId}. `
      + `Epoch [${progress.epoch ?? 0}]/[${progress.totalEpochs ?? 0}], `
      + `Batch [${progress.batch ?? 0}]/[${progress.totalBatches ?? 0}]`
    );
  }

  return `Training ${result.status}. Run ID: ${result.runId}. Waiting for runtime progress...`;
}

function resolveHuggingFaceRepositoryInput(repository: string, defaultNamespace?: string): string | undefined {
  const normalizedRepository = repository.trim();
  if (!normalizedRepository) {
    return undefined;
  }

  if (normalizedRepository.includes("/") || !defaultNamespace) {
    return normalizedRepository;
  }

  return `${defaultNamespace}/${normalizedRepository}`;
}

function isVisionTrainingTask(trainingTask: DatasetPreparationTaskType): boolean {
  return trainingTask === "vision-classification"
    || trainingTask === "vision-detection"
    || trainingTask === "vision-segmentation";
}

function isTrainingDatasetArtifact(
  artifact: DesktopArtifactBrowseItem,
): boolean {
  const mediaType = artifact.mediaType?.trim().toLowerCase() ?? "";
  const candidateNames = [
    artifact.storageKey,
    artifact.originalName ?? "",
  ].map((value) => value.trim().toLowerCase());

  return TRAINING_DATASET_MEDIA_TYPES.has(mediaType)
    || candidateNames.some((candidate) =>
      TRAINING_DATASET_FILE_EXTENSIONS.some((extension) =>
        candidate.endsWith(extension),
      ),
    );
}

function isLocalTextTrainingBaseModel(
  model: DesktopModelInventoryRecord,
): boolean {
  const isTextModel = model.inferenceMode === "causal"
    || model.inferenceMode === "chat"
    || model.inferenceMode === "text2text"
    || model.taskTags?.includes("text-generation");
  const isTrainableForm = model.artifactForm === "full-model"
    || model.artifactForm === "merged-model";
  return Boolean(model.localPath && isTextModel && isTrainableForm);
}

function isDatasetPreparationGenerationModel(
  model: DesktopModelInventoryRecord,
): boolean {
  return model.metadata?.["source"] === "dataset-preparation"
    || model.metadata?.["usage"] === "text-field-generation";
}

function selectDefaultTrainingBaseModel(
  models: readonly DesktopModelInventoryRecord[],
): DesktopModelInventoryRecord | undefined {
  const localTrainableModels = models.filter((model) =>
    Boolean(model.localPath)
    && (
      model.artifactForm === "full-model"
      || model.artifactForm === "merged-model"
    ),
  );
  const textCandidates = localTrainableModels.filter(
    isLocalTextTrainingBaseModel,
  );
  const candidates =
    textCandidates.length > 0 ? textCandidates : localTrainableModels;
  return candidates.sort((left, right) => {
    const preparationPreference = Number(
      isDatasetPreparationGenerationModel(right),
    ) - Number(isDatasetPreparationGenerationModel(left));
    if (preparationPreference !== 0) return preparationPreference;
    return right.createdAt.localeCompare(left.createdAt);
  })[0];
}

function resolveTrainingDatasetFormat(
  artifact: DesktopArtifactBrowseItem | undefined,
): "parquet" | "jsonl" | "json" | "csv" | undefined {
  if (!artifact) return undefined;
  const mediaType = artifact.mediaType?.trim().toLowerCase();
  if (mediaType === "application/x-parquet"
    || mediaType === "application/vnd.apache.parquet") return "parquet";
  if (mediaType === "application/x-ndjson"
    || mediaType === "application/jsonl") return "jsonl";
  if (mediaType === "application/json") return "json";
  if (mediaType === "text/csv" || mediaType === "application/csv") return "csv";

  const name = (artifact.originalName || artifact.storageKey).toLowerCase();
  if (name.endsWith(".parquet")) return "parquet";
  if (name.endsWith(".jsonl")) return "jsonl";
  if (name.endsWith(".json")) return "json";
  if (name.endsWith(".csv")) return "csv";
  return undefined;
}

export function useModelTrainingFeature(client?: DesktopModelsClient, workspaceId?: string) {
  const observer = useTaskObservationManager();
  const currentWorkspace = useRef(workspaceId); currentWorkspace.current = workspaceId;
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const current = () => mounted.current && currentWorkspace.current === workspaceId;
  const trainingStorageKey = `ai-system-builder.training-task.v1:${workspaceId ?? "none"}`;
  const storedTask = () => { try { const id = sessionStorage.getItem(trainingStorageKey); return id && id.length <= 512 ? id : undefined; } catch { return undefined; } };
  const modelClient = useModelsClient(client);
  const runtimeStatusClient = useMemo(
    () => createDesktopPythonRuntimeClient(),
    [],
  );

  const [models, setModels] = useState<DesktopModelInventoryRecord[]>([]);
  const [datasetArtifacts, setDatasetArtifacts] = useState<DesktopArtifactBrowseItem[]>([]);
  const [baseModelRecordId, setBaseModelRecordId] = useState("");
  const [selectedDatasetArtifactIds, setSelectedDatasetArtifactIds] = useState<string[]>([]);
  const [trainingTask, setTrainingTask] = useState<DatasetPreparationTaskType>("llm-instruction");
  const [method, setMethod] = useState<"lora" | "qlora" | "full-finetune">("lora");
  const [numEpochs, setNumEpochs] = useState("2");
  const [maxSteps, setMaxSteps] = useState("");
  const [batchSize, setBatchSize] = useState("2");
  const [learningRate, setLearningRate] = useState("0.0002");
  const [maxSequenceLength, setMaxSequenceLength] = useState("512");
  const [seed, setSeed] = useState("42");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [loraRank, setLoraRank] = useState("16");
  const [loraAlpha, setLoraAlpha] = useState("32");
  const [loraDropout, setLoraDropout] = useState("0.05");
  const [loraTargetModules, setLoraTargetModules] = useState("");
  const [gradientAccumulationSteps, setGradientAccumulationSteps] = useState("8");
  const [checkpointIntervalSteps, setCheckpointIntervalSteps] = useState("100");
  const [evalIntervalSteps, setEvalIntervalSteps] = useState("100");
  const [outputModelName, setOutputModelName] = useState("my-lora-adapter");
  const [localOutputDirectory, setLocalOutputDirectory] = useState("");
  const [generatedDisplayName, setGeneratedDisplayName] = useState("My LoRA Adapter");
  const [maxShardSize, setMaxShardSize] = useState("2GB");
  const [validateAfterTraining, setValidateAfterTraining] = useState(true);
  const [localDestinationEnabled, setLocalDestinationEnabled] = useState(true);
  const [huggingFaceDestinationEnabled, setHuggingFaceDestinationEnabled] = useState(false);
  const [huggingFaceRepository, setHuggingFaceRepository] = useState("");
  const [huggingFaceRevision, setHuggingFaceRevision] = useState("");
  const [huggingFacePathPrefix, setHuggingFacePathPrefix] = useState("");
  const [defaultHuggingFaceNamespace, setDefaultHuggingFaceNamespace] = useState<string | undefined>(undefined);

  const [status, setStatus] = useState<TrainingStatus>("idle");
  const [message, setMessage] = useState<string>();
  const [result, setResult] = useState<DesktopModelTrainingResult>();
  const [activeRun, setActiveRun] = useState<{ workspaceId?: string; runId?: string }>(() => ({ workspaceId, runId: storedTask() }));
  const activeRunId = activeRun.workspaceId === workspaceId ? activeRun.runId : undefined;
  const activeRunRef = useRef(activeRunId); activeRunRef.current = activeRunId;
  const setActiveRunId = useCallback((runId: string | undefined) => { activeRunRef.current = runId; setActiveRun({ workspaceId, runId }); }, [workspaceId]);
  const [stopTrainingInFlight, setStopTrainingInFlight] = useState(false);
  const [unloadModelInFlight, setUnloadModelInFlight] = useState(false);
  const [unloadedRunId, setUnloadedRunId] = useState<string>();
  const [reviewActionInFlight, setReviewActionInFlight] = useState<"save" | "discard">();
  const [runtimeActiveTaskCount, setRuntimeActiveTaskCount] = useState(0);

  const refreshRuntimeModelStatus = useCallback(async () => {
    try {
      const snapshot = await runtimeStatusClient.readStatus();
      setRuntimeActiveTaskCount(snapshot.activeTaskCount);
    } catch {
      // Runtime status is best-effort for model lifecycle controls.
    }
  }, [runtimeStatusClient]);

  useEffect(() => {
    void refreshRuntimeModelStatus();
  }, [refreshRuntimeModelStatus]);

  const isMethodSupported = trainingTask === "diffusion-lora"
    ? method === "lora"
    : isVisionTrainingTask(trainingTask)
      ? method === "lora" || method === "full-finetune"
      : true;

  const datasetArtifactIds = useMemo(() => selectedDatasetArtifactIds, [selectedDatasetArtifactIds]);

  useEffect(() => {
    const load = async () => {
      const listed = workspaceId ? await modelClient.listModels({ workspaceId: createWorkspaceId(workspaceId) }) : [];
      let artifacts: DesktopArtifactBrowseItem[] = [];
      if (workspaceId) {
        try {
          const { createDesktopArtifactBrowserClient } = await import("../../artifact-browser/api/desktopArtifactBrowserClient");
          artifacts = await createDesktopArtifactBrowserClient().browseArtifacts({
            workspaceId: createWorkspaceId(workspaceId),
          });
        } catch {
          artifacts = [];
        }
      }
      if (!current()) return;
      setModels(listed);
      setDatasetArtifacts(artifacts.filter(isTrainingDatasetArtifact));
      if (!baseModelRecordId && listed.length > 0) {
        setBaseModelRecordId(
          selectDefaultTrainingBaseModel(listed)?.modelRecordId ?? "",
        );
      }
    };
    void load().catch(() => { if (current()) setMessage("Training inputs are temporarily unavailable."); });
  }, [modelClient, baseModelRecordId, workspaceId]);

  useEffect(() => {
    try {
      const settingsClient = createDesktopApplicationSettingsClient();
      void settingsClient.readSettings({ keys: ["huggingface.defaultNamespace"] }).then((result) => {
        const namespace = result.values.find((value) => value.key === "huggingface.defaultNamespace")?.value;
        if (typeof namespace === "string" && namespace.trim().length > 0) {
          setDefaultHuggingFaceNamespace(namespace.trim());
        }
      }).catch(() => {
        setDefaultHuggingFaceNamespace(undefined);
      });
    } catch {
      setDefaultHuggingFaceNamespace(undefined);
    }
  }, []);

  useEffect(() => {
    if (trainingTask === "diffusion-lora" && method !== "lora") {
      setMethod("lora");
      return;
    }

    if (isVisionTrainingTask(trainingTask) && method === "qlora") {
      setMethod("lora");
    }
  }, [method, trainingTask]);

  const resolvedHuggingFaceRepository = resolveHuggingFaceRepositoryInput(huggingFaceRepository, defaultHuggingFaceNamespace);
  const hasOutputDestination = localDestinationEnabled || (huggingFaceDestinationEnabled && Boolean(resolvedHuggingFaceRepository));
  const canSubmit = baseModelRecordId.length > 0
    && datasetArtifactIds.length > 0
    && outputModelName.trim().length > 0
    && hasOutputDestination
    && isMethodSupported
    && status !== "running"
    && result?.reviewPending !== true;

  const submitTraining = async () => {
    if (!canSubmit) {
      setStatus("failed");
      setMessage("Training requires base model, dataset artifact IDs, and a supported method.");
      return;
    }

    if (!localDestinationEnabled && !huggingFaceDestinationEnabled) {
      setStatus("failed");
      setMessage("Choose at least one output destination.");
      return;
    }

    if (huggingFaceDestinationEnabled && !resolvedHuggingFaceRepository) {
      setStatus("failed");
      setMessage(defaultHuggingFaceNamespace ? "Enter a Hugging Face model repository name." : "Enter a Hugging Face model repository as owner/repository.");
      return;
    }

    setStatus("running");
    setMessage("Training started...");
    setResult(undefined);

    try {
      if (!workspaceId) {
        setStatus("failed");
        setMessage("Select a workspace before training models.");
        return;
      }
      const targetModules = loraTargetModules.split(",").map((entry) => entry.trim()).filter((entry) => entry.length > 0);
      const trainingResult = await modelClient.trainModel({
        workspaceId: createWorkspaceId(workspaceId),
        trainingTask,
        baseModel: { modelRecordId: baseModelRecordId },
        datasets: datasetArtifactIds.map((artifactId, index) => {
          const artifact = datasetArtifacts.find(
            (candidate) => candidate.artifactId === artifactId,
          );
          return {
            artifactId,
            splitRole: index === 0 ? "train" : "validation",
            format: resolveTrainingDatasetFormat(artifact),
          };
        }),
        method,
        commonParameters: {
          numEpochs: Number.parseInt(numEpochs, 10) || undefined,
          maxSteps: Number.parseInt(maxSteps, 10) || undefined,
          batchSize: Number.parseInt(batchSize, 10) || undefined,
          learningRate: Number.parseFloat(learningRate) || undefined,
          maxSequenceLength: Number.parseInt(maxSequenceLength, 10) || undefined,
          seed: Number.parseInt(seed, 10) || undefined,
        },
        advancedParameters: {
          gradientAccumulationSteps: Number.parseInt(gradientAccumulationSteps, 10) || undefined,
          checkpointIntervalSteps: Number.parseInt(checkpointIntervalSteps, 10) || undefined,
          evalIntervalSteps: Number.parseInt(evalIntervalSteps, 10) || undefined,
          lora: {
            rank: Number.parseInt(loraRank, 10) || undefined,
            alpha: Number.parseInt(loraAlpha, 10) || undefined,
            dropout: Number.parseFloat(loraDropout) || undefined,
            targetModules: targetModules.length > 0 ? targetModules : undefined,
          },
        },
        output: {
          outputModelName,
          localOutputDirectory: localOutputDirectory.trim() || undefined,
          maxShardSize: maxShardSize.trim() || undefined,
          destination: {
            local: { enabled: localDestinationEnabled },
            huggingFace: huggingFaceDestinationEnabled
              ? {
                  enabled: true,
                  provider: "huggingface",
                  repository: resolvedHuggingFaceRepository,
                  revision: huggingFaceRevision.trim() || undefined,
                  pathPrefix: huggingFacePathPrefix.trim() || undefined,
                }
              : undefined,
          },
          registration: {
            displayName: generatedDisplayName.trim() || outputModelName,
            artifactForm: method === "full-finetune" ? "full-model" : "adapter",
          },
        },
        validation: { enabled: validateAfterTraining, expectedLoRA: method !== "full-finetune" },
        runtimeMetadata: { trainingTask },
      });
      try { sessionStorage.setItem(trainingStorageKey, trainingResult.runId); } catch { /* Storage cannot fail accepted work. */ }
      if (!current()) return;
      announceModelTrainingStarted({
        runId: trainingResult.runId,
        workspaceId,
      });

      setResult(trainingResult);
      if (!isTerminalTrainingStatus(trainingResult.status)) {
        setActiveRunId(trainingResult.runId);
      }
      if (isTerminalTrainingStatus(trainingResult.status)) {
        setStatus(trainingResult.status === "succeeded" ? "succeeded" : trainingResult.status === "cancelled" ? "cancelled" : "failed");
        setMessage(trainingResult.reviewPending ? "Training completed. Save or discard the trained model." : toTrainingMessage(trainingResult));
      }
    } catch (error) {
      if (!current()) return;
      setActiveRunId(undefined);
      setStatus("failed");
      setMessage(error instanceof Error ? error.message : "Training failed.");
      void refreshRuntimeModelStatus();
    }
  };

  useEffect(() => {
    setResult(undefined); setStatus("idle"); setMessage(""); setActiveRunId(storedTask());
    // Workspace-scoped opaque task identity; no payload or prompt is persisted.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId]);

  useEffect(() => {
    if (!activeRunId || !workspaceId) return;
    return observer.subscribe({ workspaceId, family: "model-training", requestId: activeRunId }, async () => {
      const value = await modelClient.readModelTrainingStatus({ runId: activeRunId, workspaceId });
      return { value, activity: isTerminalTrainingStatus(value.status) ? "terminal" : "active" };
    }, (snapshot) => {
      if (!current() || activeRunRef.current !== activeRunId) return;
      if (!snapshot) { setMessage("Training status temporarily unavailable. Progress will retry automatically."); return; }
      const value = snapshot.value; setResult(value);
      if (!isTerminalTrainingStatus(value.status)) { setStatus("running"); setMessage(toTrainingMessage(value)); return; }
      setStatus(value.status === "succeeded" ? "succeeded" : value.status === "cancelled" ? "cancelled" : "failed");
      setMessage(value.status === "succeeded" ? value.reviewPending ? "Training completed. Save or discard the trained model." : "Training completed." : value.status === "cancelled" ? "Training cancelled." : "Training failed.");
      setActiveRunId(undefined);
    });
    // Current workspace is checked before publication and subscription cleanup.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeRunId, modelClient, observer, workspaceId]);

  const stopTraining = async () => {
    if (!activeRunId || !workspaceId || stopTrainingInFlight) {
      return;
    }

    setStopTrainingInFlight(true);
    setMessage("Stopping training...");
    try {
      const stopped = await modelClient.cancelModelTraining({
        runId: activeRunId,
        workspaceId,
      });
      if (!current()) return;
      setResult(stopped);
      if (stopped.status === "cancelled") {
        setStatus("cancelled");
        setMessage("Training cancelled.");
        setActiveRunId(undefined);
      } else {
        setMessage("Stop requested. Waiting for the current batch to finish.");
      }
      observer.invalidate({ workspaceId, family: "model-training" });
    } catch (error) {
      if (!current()) return;
      setStatus("running");
      setMessage(error instanceof Error ? error.message : "Failed to stop model training.");
    } finally {
      if (!current()) return;
      setStopTrainingInFlight(false);
      void refreshRuntimeModelStatus();
    }
  };

  const unloadModel = async () => {
    if (
      unloadModelInFlight
      || activeRunId
      || runtimeActiveTaskCount > 0
      || !result
      || !isTerminalTrainingStatus(result.status)
      || unloadedRunId === result.runId
    ) {
      return;
    }

    setUnloadModelInFlight(true);
    try {
      const snapshot = await runtimeStatusClient.controlRuntime("unload-model");
      setRuntimeActiveTaskCount(snapshot.activeTaskCount);
      setUnloadedRunId(result.runId);
      setMessage("Model unloaded from memory.");
    } catch (error) {
      if (!current()) return;
      setStatus("failed");
      setMessage(error instanceof Error ? error.message : "Failed to unload model.");
    } finally {
      if (!current()) return;
      setUnloadModelInFlight(false);
      void refreshRuntimeModelStatus();
    }
  };

  const saveTrainedModel = async () => {
    if (!workspaceId || !result?.reviewPending || reviewActionInFlight) {
      return;
    }
    setReviewActionInFlight("save");
    try {
      const saved = await modelClient.saveModelTraining({
        runId: result.runId,
        workspaceId,
      });
      if (!current()) return;
      observer.invalidate({ workspaceId, family: "model-training" });
      setResult(saved);
      setStatus("succeeded");
      setMessage("Trained model saved.");
      const refreshed = await modelClient.listModels({ workspaceId: createWorkspaceId(workspaceId) });
      if (current()) setModels(refreshed);
    } catch (error) {
      if (!current()) return;
      setStatus("failed");
      setMessage(error instanceof Error ? error.message : "Failed to save trained model.");
    } finally {
      if (!current()) return;
      setReviewActionInFlight(undefined);
      void refreshRuntimeModelStatus();
    }
  };

  const discardTrainedModel = async () => {
    if (!workspaceId || !result?.reviewPending || reviewActionInFlight) {
      return;
    }
    setReviewActionInFlight("discard");
    try {
      const discarded = await modelClient.discardModelTraining({
        runId: result.runId,
        workspaceId,
      });
      if (!current()) return;
      observer.invalidate({ workspaceId, family: "model-training" });
      setResult(discarded);
      setStatus("cancelled");
      setMessage("Trained model discarded.");
    } catch (error) {
      if (!current()) return;
      setStatus("failed");
      setMessage(error instanceof Error ? error.message : "Failed to discard trained model.");
    } finally {
      if (!current()) return;
      setReviewActionInFlight(undefined);
      void refreshRuntimeModelStatus();
    }
  };

  const canStopTraining = Boolean(activeRunId) && status === "running";
  const canUnloadModel = runtimeActiveTaskCount === 0
    && !activeRunId
    && Boolean(result && isTerminalTrainingStatus(result.status))
    && unloadedRunId !== result?.runId;

  return {
    models,
    datasetArtifacts,
    baseModelRecordId,
    setBaseModelRecordId,
    selectedDatasetArtifactIds,
    setSelectedDatasetArtifactIds,
    trainingTask,
    setTrainingTask,
    method,
    setMethod,
    numEpochs,
    setNumEpochs,
    maxSteps,
    setMaxSteps,
    batchSize,
    setBatchSize,
    learningRate,
    setLearningRate,
    maxSequenceLength,
    setMaxSequenceLength,
    seed,
    setSeed,
    showAdvanced,
    setShowAdvanced,
    loraRank,
    setLoraRank,
    loraAlpha,
    setLoraAlpha,
    loraDropout,
    setLoraDropout,
    loraTargetModules,
    setLoraTargetModules,
    gradientAccumulationSteps,
    setGradientAccumulationSteps,
    checkpointIntervalSteps,
    setCheckpointIntervalSteps,
    evalIntervalSteps,
    setEvalIntervalSteps,
    outputModelName,
    setOutputModelName,
    localOutputDirectory,
    setLocalOutputDirectory,
    generatedDisplayName,
    setGeneratedDisplayName,
    maxShardSize,
    setMaxShardSize,
    validateAfterTraining,
    setValidateAfterTraining,
    localDestinationEnabled,
    setLocalDestinationEnabled,
    huggingFaceDestinationEnabled,
    setHuggingFaceDestinationEnabled,
    huggingFaceRepository,
    setHuggingFaceRepository,
    huggingFaceRevision,
    setHuggingFaceRevision,
    huggingFacePathPrefix,
    setHuggingFacePathPrefix,
    defaultHuggingFaceNamespace,
    status,
    message,
    result,
    canSubmit,
    canStopTraining,
    stopTrainingInFlight,
    stopTraining,
    canUnloadModel,
    unloadModelInFlight,
    unloadModel,
    reviewActionInFlight,
    saveTrainedModel,
    discardTrainedModel,
    isMethodSupported,
    submitTraining,
  };
}
