import { useEffect, useRef } from "react";

import type {
  ListModelDownloadTasksRequest,
  ListModelDownloadTasksResult,
  ModelDownloadTaskActivity,
} from "../../../contracts/model";
import { createWorkspaceId } from "../../../contracts/workspace";

import { useNotificationCenter } from "./NotificationProvider";
import type { NotificationActivityStatus } from "./notificationState";

export const MODEL_DOWNLOAD_NOTIFICATION_POLL_MS = 1_500;

export interface ModelDownloadNotificationClient {
  listModelDownloads(input: ListModelDownloadTasksRequest): Promise<ListModelDownloadTasksResult>;
}

export function ModelDownloadNotificationBridge({
  client,
  workspaceId,
}: {
  readonly client: ModelDownloadNotificationClient;
  readonly workspaceId?: string;
}) {
  const notifications = useNotificationCenter();
  const initializedRef = useRef(false);
  const terminalIdsRef = useRef(new Set<string>());
  const pollingRef = useRef(false);
  const failureReportedRef = useRef(false);

  useEffect(() => {
    initializedRef.current = false;
    terminalIdsRef.current.clear();
    failureReportedRef.current = false;
    if (!workspaceId) return;

    let disposed = false;
    const poll = async () => {
      if (disposed || pollingRef.current) return;
      pollingRef.current = true;
      try {
        const result = await client.listModelDownloads({
          workspaceId: createWorkspaceId(workspaceId),
          includeCompleted: true,
          limit: 100,
        });
        if (disposed) return;
        for (const activity of result.activities) {
          const terminal = isTerminal(activity.status);
          if (!initializedRef.current && terminal) {
            terminalIdsRef.current.add(activity.requestId);
            continue;
          }
          if (terminal && terminalIdsRef.current.has(activity.requestId)) continue;
          notifications.upsertActivity(toNotificationActivity(activity));
          if (terminal) terminalIdsRef.current.add(activity.requestId);
        }
        initializedRef.current = true;
        failureReportedRef.current = false;
      } catch {
        if (!disposed && !failureReportedRef.current) {
          notifications.publish({
            title: "Download status unavailable",
            message: "Model download status could not be refreshed. Progress will retry automatically.",
            tone: "warning",
            source: "Model downloads",
            workspaceId,
            dedupeKey: "model-download-status-unavailable",
          });
          failureReportedRef.current = true;
        }
      } finally {
        pollingRef.current = false;
      }
    };

    void poll();
    const timer = window.setInterval(() => void poll(), MODEL_DOWNLOAD_NOTIFICATION_POLL_MS);
    return () => {
      disposed = true;
      window.clearInterval(timer);
    };
  }, [client, notifications.publish, notifications.upsertActivity, workspaceId]);

  return null;
}

function toNotificationActivity(activity: ModelDownloadTaskActivity) {
  return {
    id: `model-download:${activity.requestId}`,
    title: activity.displayName,
    message: activityMessage(activity),
    status: normalizeStatus(activity.status),
    progress: activity.progress,
    source: "Model downloads",
    workspaceId: activity.workspaceId,
    updatedAt: activity.updatedAt,
  } as const;
}

function normalizeStatus(status: ModelDownloadTaskActivity["status"]): NotificationActivityStatus {
  return status === "queued" || status === "running" || status === "succeeded" || status === "failed" || status === "cancelled"
    ? status
    : "unknown";
}

function activityMessage(activity: ModelDownloadTaskActivity): string {
  if (activity.status === "succeeded") return "Model download completed.";
  if (activity.status === "failed") return activity.error?.message ?? "Model download failed.";
  if (activity.status === "cancelled") return "Model download was cancelled.";
  if (activity.status === "queued") return "Waiting to download.";
  return activity.progress?.message ?? "Downloading model.";
}

function isTerminal(status: ModelDownloadTaskActivity["status"]): boolean {
  return status === "succeeded" || status === "failed" || status === "cancelled";
}
