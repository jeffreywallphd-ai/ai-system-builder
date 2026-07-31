import { useEffect, useRef } from "react";

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
  const activeRequestIdsRef = useRef(new Set<string>());
  const overflowNotifiedRequestIdsRef = useRef(new Set<string>());
  const pollingRef = useRef(false);

  useEffect(() => {
    activeRequestIdsRef.current.clear();
    overflowNotifiedRequestIdsRef.current.clear();
    if (!workspaceId) return;

    let disposed = false;
    const upsert = (
      requestId: string,
      response: DesktopDatasetPreparationTaskReadResult,
    ) => {
      if (
        response.ok &&
        (response.status === "pending" || response.status === "running") &&
        response.progress?.memoryOverflowActive === true &&
        !overflowNotifiedRequestIdsRef.current.has(requestId)
      ) {
        overflowNotifiedRequestIdsRef.current.add(requestId);
        notifications.publish({
          title: "Model is using disk space",
          message:
            "Available memory is too low for the selected model, so it is using system-managed disk/swap space. Generation may run more slowly.",
          tone: "warning",
          source: "Dataset Preparation",
          workspaceId,
          dedupeKey: `dataset-preparation-memory-overflow:${requestId}`,
        });
        notifications.setPanelOpen(true);
      }
      const activity = toDatasetPreparationActivity(
        requestId,
        workspaceId,
        response,
      );
      notifications.upsertActivity(activity);
      if (activity.terminal) activeRequestIdsRef.current.delete(requestId);
    };
    const poll = async () => {
      if (disposed || pollingRef.current) return;
      pollingRef.current = true;
      try {
        for (const requestId of [...activeRequestIdsRef.current]) {
          try {
            upsert(
              requestId,
              await client.readPrepareTrainingDatasetTask(
                requestId,
                workspaceId,
              ),
            );
          } catch {
            notifications.upsertActivity({
              id: `dataset-preparation:${requestId}`,
              title: "Preparing training dataset",
              message:
                "Progress is temporarily unavailable and will retry automatically.",
              status: "running",
              source: "Dataset Preparation",
              workspaceId,
            });
          }
        }
      } finally {
        pollingRef.current = false;
      }
    };
    const onStarted = (event: Event) => {
      const detail = (event as CustomEvent<DatasetPreparationStartedEventDetail>)
        .detail;
      if (
        !detail ||
        detail.workspaceId !== workspaceId ||
        typeof detail.requestId !== "string" ||
        !detail.requestId.trim()
      ) {
        return;
      }
      activeRequestIdsRef.current.add(detail.requestId);
      notifications.upsertActivity({
        id: `dataset-preparation:${detail.requestId}`,
        title: "Preparing training dataset",
        message: "Starting dataset checks.",
        status: "queued",
        source: "Dataset Preparation",
        workspaceId,
      });
      notifications.setPanelOpen(true);
      void poll();
    };

    window.addEventListener(DATASET_PREPARATION_STARTED_EVENT, onStarted);
    const timer = window.setInterval(
      () => void poll(),
      DATASET_PREPARATION_NOTIFICATION_POLL_MS,
    );
    return () => {
      disposed = true;
      window.removeEventListener(DATASET_PREPARATION_STARTED_EVENT, onStarted);
      window.clearInterval(timer);
    };
  }, [
    client,
    notifications.publish,
    notifications.setPanelOpen,
    notifications.upsertActivity,
    workspaceId,
  ]);

  return null;
}

function toDatasetPreparationActivity(
  requestId: string,
  workspaceId: string,
  response: DesktopDatasetPreparationTaskReadResult,
) {
  const base = {
    id: `dataset-preparation:${requestId}`,
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
