import { useTaskObservationManager } from "../../../../../../../modules/ui/shared/notifications/TaskObservationProvider";
import { useEffect } from "react";

import { useNotificationCenter } from "../../../../../../../modules/ui/shared";
import type { DesktopDatasetPreparationTaskReadResult } from "../api/desktopDatasetPreparationClient";
import {
  DATASET_PREPARATION_STARTED_EVENT,
  type DatasetPreparationStartedEventDetail,
} from "../hooks/datasetPreparationNotificationEvents";

export const DATASET_PREPARATION_NOTIFICATION_POLL_MS = 1_500;

export interface DatasetPreparationNotificationClient {
  readPrepareTrainingDatasetTask(
    requestId: string,
    workspaceId?: string,
  ): Promise<DesktopDatasetPreparationTaskReadResult>;
}

export function DatasetPreparationNotificationBridge({
  client,
  workspaceId,
}: {
  readonly client: DatasetPreparationNotificationClient;
  readonly workspaceId?: string;
}) {
  const notifications = useNotificationCenter();
  const observer = useTaskObservationManager();
  useEffect(() => {
    if (!workspaceId) return;
    let disposed = false;
    const subscriptions = new Map<string, () => void>();
    const overflow = new Set<string>();
    const upsert = (id: string, value: DesktopDatasetPreparationTaskReadResult) => {
      if (disposed) return false;
      if (value.ok && (value.status === "pending" || value.status === "running") && value.progress?.memoryOverflowActive && !overflow.has(id)) {
        overflow.add(id); if (overflow.size > 100) overflow.delete(overflow.values().next().value!);
        notifications.publish({ title: "Model is using disk space", message: "Available memory is too low for the selected model, so it is using system-managed disk/swap space. Generation may run more slowly.", tone: "warning", source: "Dataset Preparation", workspaceId, dedupeKey: `dataset-preparation-memory-overflow:${workspaceId}:${id}` });
      }
      const activity = toDatasetPreparationActivity(id, workspaceId, value); notifications.upsertActivity(activity); return activity.terminal;
    };
    const onStarted = (event: Event) => {
      const detail = (event as CustomEvent<DatasetPreparationStartedEventDetail>).detail;
      if (!detail || detail.workspaceId !== workspaceId || typeof detail.requestId !== "string" || !detail.requestId.trim() || detail.requestId.length > 512) return;
      const id = detail.requestId; const scope = { workspaceId, family: "dataset-preparation", requestId: id };
      if (subscriptions.has(id)) { observer.invalidate(scope); return; }
      if (subscriptions.size >= 100) return;
      notifications.upsertActivity({ id: `dataset-preparation:${workspaceId}:${id}`, title: "Preparing training dataset", message: "Starting dataset checks.", status: "queued", source: "Dataset Preparation", workspaceId });
      notifications.setPanelOpen(true);
      const stop = observer.subscribe(scope, async () => {
        const value = await client.readPrepareTrainingDatasetTask(id, workspaceId);
        return { value, activity: value.ok && (value.status === "pending" || value.status === "running") ? "active" : "terminal" };
      }, (result) => {
        if (disposed) return;
        if (!result) { notifications.upsertActivity({ id: `dataset-preparation:${workspaceId}:${id}`, title: "Preparing training dataset", message: "Progress is temporarily unavailable and will retry automatically.", status: "running", source: "Dataset Preparation", workspaceId }); return; }
        if (upsert(id, result.value)) queueMicrotask(() => { subscriptions.get(id)?.(); subscriptions.delete(id); });
      });
      subscriptions.set(id, stop);
    };
    window.addEventListener(DATASET_PREPARATION_STARTED_EVENT, onStarted);
    return () => { disposed = true; window.removeEventListener(DATASET_PREPARATION_STARTED_EVENT, onStarted); for (const stop of subscriptions.values()) stop(); subscriptions.clear(); };
  }, [client, observer, notifications.publish, notifications.setPanelOpen, notifications.upsertActivity, workspaceId]);
  return null;
}

function toDatasetPreparationActivity(
  requestId: string,
  workspaceId: string,
  response: DesktopDatasetPreparationTaskReadResult,
) {
  const base = {
    id: `dataset-preparation:${workspaceId}:${requestId}`,
    title: "Preparing training dataset",
    source: "Dataset Preparation",
    workspaceId,
  } as const;
  if (response.ok === false) {
    return {
      ...base,
      message: response.error.message,
      status: "failed" as const,
      terminal: true,
    };
  }
  if (response.status === "pending" || response.status === "running") {
    const current = response.progress?.processed;
    const total = response.progress?.total;
    const percent =
      typeof current === "number" && typeof total === "number" && total > 0
        ? (current / total) * 100
        : undefined;
    return {
      ...base,
      message:
        response.progress?.message ??
        (response.status === "pending"
          ? "Waiting to prepare the dataset."
          : "Preparing the training dataset."),
      status: response.status === "pending" ? ("queued" as const) : ("running" as const),
      progress: {
        current,
        total,
        percent,
        unit: "sections",
      },
      terminal: false,
    };
  }
  if (response.status === "succeeded") {
    return {
      ...base,
      message: "Training dataset is ready.",
      status: "succeeded" as const,
      progress: { percent: 100 },
      terminal: true,
    };
  }
  if (response.status === "review-required") {
    return {
      ...base,
      message:
        "Dataset checks are complete. Return to Dataset Preparation to review the results.",
      status: "succeeded" as const,
      progress: { percent: 100 },
      terminal: true,
    };
  }
  if (response.status === "cancelled") {
    return {
      ...base,
      message: "Dataset preparation was cancelled.",
      status: "cancelled" as const,
      terminal: true,
    };
  }
  return {
    ...base,
    message: "Dataset preparation status is no longer available.",
    status: "unknown" as const,
    terminal: true,
  };
}
