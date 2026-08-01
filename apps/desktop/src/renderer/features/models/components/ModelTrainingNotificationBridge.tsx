import { useEffect, useRef } from "react";

import { useNotificationCenter } from "../../../../../../../modules/ui/shared";
import type { DesktopModelTrainingResult } from "../../../lib/desktopApi";
import {
  MODEL_TRAINING_STARTED_EVENT,
  type ModelTrainingStartedEventDetail,
} from "../hooks/modelTrainingNotificationEvents";

export const MODEL_TRAINING_NOTIFICATION_POLL_MS = 500;

export interface ModelTrainingNotificationClient {
  readModelTrainingStatus(input: {
    runId: string;
    workspaceId: string;
  }): Promise<DesktopModelTrainingResult>;
}

export function ModelTrainingNotificationBridge({
  client,
  workspaceId,
}: {
  readonly client: ModelTrainingNotificationClient;
  readonly workspaceId?: string;
}) {
  const notifications = useNotificationCenter();
  const activeRunIdsRef = useRef(new Set<string>());
  const pollingRef = useRef(false);

  useEffect(() => {
    activeRunIdsRef.current.clear();
    if (!workspaceId) return;

    let disposed = false;
    const upsert = (runId: string, result: DesktopModelTrainingResult) => {
      const activity = toModelTrainingActivity(runId, workspaceId, result);
      notifications.upsertActivity(activity);
      if (activity.terminal) activeRunIdsRef.current.delete(runId);
    };
    const poll = async () => {
      if (disposed || pollingRef.current) return;
      pollingRef.current = true;
      try {
        for (const runId of [...activeRunIdsRef.current]) {
          try {
            upsert(runId, await client.readModelTrainingStatus({
              runId,
              workspaceId,
            }));
          } catch {
            notifications.upsertActivity({
              id: `model-training:${runId}`,
              title: "Training model",
              message:
                "Progress is temporarily unavailable and will retry automatically.",
              status: "running",
              source: "Model Training",
              workspaceId,
            });
          }
        }
      } finally {
        pollingRef.current = false;
      }
    };
    const onStarted = (event: Event) => {
      const detail = (event as CustomEvent<ModelTrainingStartedEventDetail>)
        .detail;
      if (
        !detail
        || detail.workspaceId !== workspaceId
        || typeof detail.runId !== "string"
        || !detail.runId.trim()
      ) {
        return;
      }
      activeRunIdsRef.current.add(detail.runId);
      notifications.upsertActivity({
        id: `model-training:${detail.runId}`,
        title: "Training model",
        message: "Starting model training.",
        status: "queued",
        source: "Model Training",
        workspaceId,
      });
      notifications.setPanelOpen(true);
      void poll();
    };

    window.addEventListener(MODEL_TRAINING_STARTED_EVENT, onStarted);
    const timer = window.setInterval(
      () => void poll(),
      MODEL_TRAINING_NOTIFICATION_POLL_MS,
    );
    return () => {
      disposed = true;
      window.removeEventListener(MODEL_TRAINING_STARTED_EVENT, onStarted);
      window.clearInterval(timer);
    };
  }, [
    client,
    notifications.setPanelOpen,
    notifications.upsertActivity,
    workspaceId,
  ]);

  return null;
}

function toModelTrainingActivity(
  runId: string,
  workspaceId: string,
  result: DesktopModelTrainingResult,
) {
  const base = {
    id: `model-training:${runId}`,
    title: "Training model",
    source: "Model Training",
    workspaceId,
  } as const;
  if (result.status === "queued" || result.status === "running") {
    return {
      ...base,
      message:
        result.progress?.message
        ?? (result.status === "queued"
          ? "Waiting to start model training."
          : formatModelTrainingProgressMessage(result)),
      status: result.status,
      progress: toNotificationProgress(result),
      terminal: false,
    };
  }
  if (result.status === "succeeded") {
    return {
      ...base,
      message: result.reviewPending
        ? "Model training completed. Review the result to save or discard it."
        : "Model training completed.",
      status: "succeeded" as const,
      progress: { percent: 100 },
      terminal: true,
    };
  }
  if (result.status === "cancelled") {
    return {
      ...base,
      message: "Model training was cancelled.",
      status: "cancelled" as const,
      terminal: true,
    };
  }
  return {
    ...base,
    message: result.error?.message ?? "Model training failed.",
    status: "failed" as const,
    terminal: true,
  };
}

function toNotificationProgress(result: DesktopModelTrainingResult) {
  const progress = result.progress;
  if (
    typeof progress?.batch === "number"
    && typeof progress.totalBatches === "number"
    && progress.totalBatches > 0
  ) {
    return {
      current: progress.batch,
      total: progress.totalBatches,
      percent: (progress.batch / progress.totalBatches) * 100,
      unit: "batches",
    };
  }
  if (
    typeof progress?.epoch === "number"
    && typeof progress.totalEpochs === "number"
    && progress.totalEpochs > 0
  ) {
    return {
      current: progress.epoch,
      total: progress.totalEpochs,
      percent: (progress.epoch / progress.totalEpochs) * 100,
      unit: "epochs",
    };
  }
  return undefined;
}

function formatModelTrainingProgressMessage(
  result: DesktopModelTrainingResult,
): string {
  const progress = result.progress;
  if (
    typeof progress?.epoch === "number"
    && typeof progress.totalEpochs === "number"
  ) {
    const batch =
      typeof progress.batch === "number"
      && typeof progress.totalBatches === "number"
        ? `, batch ${progress.batch} of ${progress.totalBatches}`
        : "";
    return `Training epoch ${progress.epoch} of ${progress.totalEpochs}${batch}.`;
  }
  return "Model training is running.";
}
