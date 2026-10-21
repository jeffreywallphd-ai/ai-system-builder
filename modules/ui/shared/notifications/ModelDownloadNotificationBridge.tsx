import { useEffect, useRef } from "react";
import { useTaskObservationManager } from "./TaskObservationProvider";
import { BoundedTaskIds } from "./taskObservation";

import type {
  ListModelDownloadTasksRequest,
  ListModelDownloadTasksResult,
  ModelDownloadTaskActivity,
  ReadModelDownloadTaskRequest,
  ReadModelDownloadTaskResult,
} from "../../../contracts/model";
import { createWorkspaceId } from "../../../contracts/workspace";

import { useNotificationCenter } from "./NotificationProvider";
import type { NotificationActivityStatus } from "./notificationState";

export const MODEL_DOWNLOAD_NOTIFICATION_POLL_MS = 1_500;

export interface ModelDownloadNotificationClient {
  listModelDownloads(input: ListModelDownloadTasksRequest): Promise<ListModelDownloadTasksResult>;
  completeModelDownload?(input: ReadModelDownloadTaskRequest): Promise<ReadModelDownloadTaskResult>;
}

export function ModelDownloadNotificationBridge({
  client,
  workspaceId,
}: {
  readonly client: ModelDownloadNotificationClient;
  readonly workspaceId?: string;
}) {
  const notifications = useNotificationCenter();
  const observer = useTaskObservationManager();
  const initializedRef = useRef(false);
  const terminalIdsRef = useRef(new BoundedTaskIds());
  const failureReportedRef = useRef(false);

  useEffect(() => {
    initializedRef.current = false;
    terminalIdsRef.current.clear();
    failureReportedRef.current = false;
    if (!workspaceId) return;

    let disposed = false;
    const unsubscribe = observer.subscribe({ workspaceId, family: "model-download", requestId: "list" }, async () => {
      const result = await client.listModelDownloads({ workspaceId: createWorkspaceId(workspaceId), includeCompleted: true, limit: 100 });
      const activities: ModelDownloadTaskActivity[] = [];
      for (const observed of result.activities) {
        if (disposed) break;
        const activity = observed.status === "succeeded" && !observed.model && client.completeModelDownload
          ? (await client.completeModelDownload({ workspaceId: createWorkspaceId(workspaceId), requestId: observed.requestId })).activity
          : observed;
        if (!disposed) activities.push(activity);
      }
      return { value: activities, activity: activities.some((a) => a.status === "queued" || a.status === "running") ? "active" : "idle" };
    }, (result) => {
      if (disposed) return;
      if (!result) {
        if (!failureReportedRef.current) notifications.publish({ title: "Download status unavailable", message: "Model download status could not be refreshed. Progress will retry automatically.", tone: "warning", source: "Model downloads", workspaceId, dedupeKey: "model-download-status-unavailable" });
        failureReportedRef.current = true;
        return;
      }
      // Decide the whole page against one history snapshot. Incremental eviction
      // while walking newest-first results can reannounce every historical row.
      const previouslyTerminal = new Set(result.value.filter((a) => terminalIdsRef.current.has(`${workspaceId}:${a.requestId}`)).map((a) => a.requestId));
      for (const activity of result.value) {
        const terminal = isTerminal(activity.status);
        const identity = `${workspaceId}:${activity.requestId}`;
        if (!initializedRef.current && terminal) continue;
        if (terminal && previouslyTerminal.has(activity.requestId)) continue;
        notifications.upsertActivity(toNotificationActivity(activity));
      }
      for (const activity of [...result.value].reverse()) if (isTerminal(activity.status)) terminalIdsRef.current.add(`${workspaceId}:${activity.requestId}`);
      initializedRef.current = true; failureReportedRef.current = false;
    });
    return () => { disposed = true; unsubscribe(); };
  }, [client, observer, notifications.publish, notifications.upsertActivity, workspaceId]);

  return null;
}

function toNotificationActivity(activity: ModelDownloadTaskActivity) {
  return {
    id: `model-download:${activity.workspaceId}:${activity.requestId}`,
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
