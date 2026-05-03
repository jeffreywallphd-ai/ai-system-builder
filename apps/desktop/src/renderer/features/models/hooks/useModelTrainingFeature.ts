import { useEffect, useMemo, useState } from "react";

import type { DesktopArtifactBrowseItem } from "../../../lib/desktopApi";
import type { DesktopModelInventoryRecord, DesktopModelTrainingResult } from "../../../lib/desktopApi";
import { createDesktopApplicationSettingsClient } from "../../settings";
import type { DesktopModelsClient } from "../api/desktopModelsClient";
import { useModelsClient } from "./useModelsClient";

type TrainingStatus = "idle" | "running" | "succeeded" | "failed";
type PollableTrainingStatus = DesktopModelTrainingResult["status"];

const TRAINING_STATUS_POLL_INTERVAL_MS = 2000;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

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

export function useModelTrainingFeature(client?: DesktopModelsClient) {
  const modelClient = useModelsClient(client);

  const [models, setModels] = useState<DesktopModelInventoryRecord[]>([]);
  const [datasetArtifacts, setDatasetArtifacts] = useState<DesktopArtifactBrowseItem[]>([]);
  const [baseModelRecordId, setBaseModelRecordId] = useState("");
  const [selectedDatasetArtifactIds, setSelectedDatasetArtifactIds] = useState<string[]>([]);
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

  const isMethodSupported = true;

  const datasetArtifactIds = useMemo(() => selectedDatasetArtifactIds, [selectedDatasetArtifactIds]);

  useEffect(() => {
    const load = async () => {
      const listed = await modelClient.listModels({});
      let artifacts: DesktopArtifactBrowseItem[] = [];
      try {
        const { createDesktopArtifactBrowserClient } = await import("../../artifact-browser/api/desktopArtifactBrowserClient");
        artifacts = await createDesktopArtifactBrowserClient().browseArtifacts({});
      } catch {
        artifacts = [];
      }
      setModels(listed);
      setDatasetArtifacts(
        artifacts.filter((artifact) => artifact.mediaType === "application/x-parquet" || artifact.storageKey.toLowerCase().endsWith(".parquet")),
      );
      if (!baseModelRecordId && listed.length > 0) {
        setBaseModelRecordId(listed[0]?.modelRecordId ?? "");
      }
    };
    void load();
  }, [modelClient, baseModelRecordId]);

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

  const resolvedHuggingFaceRepository = resolveHuggingFaceRepositoryInput(huggingFaceRepository, defaultHuggingFaceNamespace);
  const hasOutputDestination = localDestinationEnabled || (huggingFaceDestinationEnabled && Boolean(resolvedHuggingFaceRepository));
  const canSubmit = baseModelRecordId.length > 0
    && datasetArtifactIds.length > 0
    && outputModelName.trim().length > 0
    && hasOutputDestination
    && isMethodSupported
    && status !== "running";

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
      const targetModules = loraTargetModules.split(",").map((entry) => entry.trim()).filter((entry) => entry.length > 0);
      const trainingResult = await modelClient.trainModel({
        baseModel: { modelRecordId: baseModelRecordId },
        datasets: datasetArtifactIds.map((artifactId, index) => ({ artifactId, splitRole: index === 0 ? "train" : "validation" })),
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
      });

      setResult(trainingResult);
      let latestResult = trainingResult;
      let consecutivePollFailures = 0;

      while (!isTerminalTrainingStatus(latestResult.status)) {
        setStatus("running");
        setMessage(toTrainingMessage(latestResult));
        await delay(TRAINING_STATUS_POLL_INTERVAL_MS);
        try {
          latestResult = await modelClient.readModelTrainingStatus({ runId: latestResult.runId });
          consecutivePollFailures = 0;
        } catch (error) {
          consecutivePollFailures += 1;
          if (consecutivePollFailures >= 5) {
            throw error;
          }
          setMessage(`Training status temporarily unavailable. Run ID: ${latestResult.runId}. Retrying...`);
          continue;
        }
        setResult(latestResult);
      }

      if (latestResult.status === "succeeded") {
        setStatus("succeeded");
        setMessage("Training completed.");
        const refreshed = await modelClient.listModels({});
        setModels(refreshed);
      } else {
        setStatus("failed");
        setMessage(latestResult.error?.message ?? (latestResult.status === "cancelled" ? "Training cancelled." : "Training failed."));
      }
    } catch (error) {
      setStatus("failed");
      setMessage(error instanceof Error ? error.message : "Training failed.");
    }
  };

  return {
    models,
    datasetArtifacts,
    baseModelRecordId,
    setBaseModelRecordId,
    selectedDatasetArtifactIds,
    setSelectedDatasetArtifactIds,
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
    isMethodSupported,
    submitTraining,
  };
}
