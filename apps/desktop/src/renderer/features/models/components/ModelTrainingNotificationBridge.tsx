import { useTaskObservationManager } from "../../../../../../../modules/ui/shared/notifications/TaskObservationProvider";
import { useEffect } from "react";

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
  const observer = useTaskObservationManager();
  useEffect(() => {
    if (!workspaceId) return;
    let disposed = false;
    const subscriptions = new Map<string, () => void>();
    const upsert = (id: string, value: DesktopModelTrainingResult) => {
      if (disposed) return false;
      const activity = toModelTrainingActivity(id, workspaceId, value);
      notifications.upsertActivity(activity);
      return activity.terminal;
    };
    const onStarted = (event: Event) => {
      const detail = (event as CustomEvent<ModelTrainingStartedEventDetail>).detail;
      if (!detail || detail.workspaceId !== workspaceId || typeof detail.runId !== "string" || !detail.runId.trim() || detail.runId.length > 512) return;
      const id = detail.runId; const scope = { workspaceId, family: "model-training", requestId: id };
      if (subscriptions.has(id)) { observer.invalidate(scope); return; }
      if (subscriptions.size >= 100) return;
      notifications.upsertActivity({ id: `model-training:${workspaceId}:${id}`, title: "Training model", message: "Starting model training.", status: "queued", source: "Model Training", workspaceId });
      notifications.setPanelOpen(true);
      const stop = observer.subscribe(scope, async () => {
        const value = await client.readModelTrainingStatus({ runId: id, workspaceId });
        return { value, activity: value.status === "queued" || value.status === "running" ? "active" : "terminal" };
      }, (result) => {
        if (disposed) return;
        if (!result) { notifications.upsertActivity({ id: `model-training:${workspaceId}:${id}`, title: "Training model", message: "Progress is temporarily unavailable and will retry automatically.", status: "running", source: "Model Training", workspaceId }); return; }
        if (upsert(id, result.value)) queueMicrotask(() => { subscriptions.get(id)?.(); subscriptions.delete(id); });
      });
      subscriptions.set(id, stop);
    };
    window.addEventListener(MODEL_TRAINING_STARTED_EVENT, onStarted);
    return () => { disposed = true; window.removeEventListener(MODEL_TRAINING_STARTED_EVENT, onStarted); for (const stop of subscriptions.values()) stop(); subscriptions.clear(); };
  }, [client, observer, notifications.publish, notifications.setPanelOpen, notifications.upsertActivity, workspaceId]);
  return null;
}

function toModelTrainingActivity(
  runId: string,
  workspaceId: string,
  result: DesktopModelTrainingResult,
) {
  const base = {
    id: `model-training:${workspaceId}:${runId}`,
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
