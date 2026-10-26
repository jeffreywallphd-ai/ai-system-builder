import { useLayoutEffect, useRef } from "react";
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
  // Retain only bounded identities of activities actually observed live. These
  // survive workspace navigation so initial history can settle an existing row
  // without announcing unrelated terminal history as new work.
  const liveIdsRef = useRef(new BoundedTaskIds());
  const failureReportedRef = useRef(false);

  useLayoutEffect(() => {
    initializedRef.current = false;
    terminalIdsRef.current.clear();
    failureReportedRef.current = false;
    if (!workspaceId) return;

    let disposed = false;
    const unsubscribe = observer.subscribe({ workspaceId, family: "model-download", requestId: "list" }, async () => {
      const result = await client.listModelDownloads({ workspaceId: createWorkspaceId(workspaceId), includeCompleted: true, limit: 100 });
      // Refuse the entire page before a completion call can have side effects.
      // Host/application authorization remains authoritative below this client.
      if (!result || !isScopedPage(result.activities, workspaceId)) throw new Error("Download status is unavailable.");
      const page = result.activities.map(captureActivity);
      const activities: ModelDownloadTaskActivity[] = [];
      for (const observed of page) {
        if (disposed) break;
        const activity = observed.status === "succeeded" && !observed.model && client.completeModelDownload
          ? (await client.completeModelDownload({ workspaceId: createWorkspaceId(workspaceId), requestId: observed.requestId })).activity
          : observed;
        if (!isScopedActivity(activity, workspaceId) || activity.requestId !== observed.requestId || activity.modelId !== observed.modelId) throw new Error("Download completion is unavailable.");
        if (!disposed) activities.push(captureActivity(activity));
      }
      return { value: activities, activity: activities.some((a) => a.status === "queued" || a.status === "running") ? "active" : "idle" };
    }, (result) => {
      if (disposed) return;
      if (!result || !isScopedPage(result.value, workspaceId)) {
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
        if (!initializedRef.current && terminal && !liveIdsRef.current.has(identity)) continue;
        if (terminal && previouslyTerminal.has(activity.requestId)) continue;
        if (terminal) liveIdsRef.current.delete(identity);
        else liveIdsRef.current.add(identity);
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
    progress: downloadProgress(activity.progress),
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
  if (activity.status === "failed") return "Model download failed. Open Models to review the download and retry.";
  if (activity.status === "cancelled") return "Model download was cancelled.";
  if (activity.status === "queued") return "Waiting to download.";
  return activity.status === "unknown" ? "Model download status is unavailable." : "Downloading model.";
}

function isTerminal(status: ModelDownloadTaskActivity["status"]): boolean {
  return status === "succeeded" || status === "failed" || status === "cancelled";
}

function isScopedActivity(value: ModelDownloadTaskActivity | null | undefined, workspaceId: string): value is ModelDownloadTaskActivity {
  return Boolean(value && value.workspaceId === workspaceId
    && typeof value.requestId === "string" && /^[A-Za-z0-9._:-]{1,128}$/.test(value.requestId)
    && typeof value.modelId === "string" && value.modelId.trim() && value.modelId.length <= 512
    && typeof value.displayName === "string" && value.displayName.trim() && value.displayName.length <= 512
    && (value.status === "queued" || value.status === "running" || value.status === "succeeded"
      || value.status === "failed" || value.status === "cancelled" || value.status === "unknown"));
}

function isScopedPage(value: unknown, workspaceId: string): value is readonly ModelDownloadTaskActivity[] {
  if (!Array.isArray(value) || value.length > 100) return false;
  const identities = new Set<string>();
  for (const activity of value) {
    if (!isScopedActivity(activity, workspaceId) || identities.has(activity.requestId)) return false;
    identities.add(activity.requestId);
  }
  return true;
}

function captureActivity(activity: ModelDownloadTaskActivity): ModelDownloadTaskActivity {
  const updatedAt = typeof activity.updatedAt === "string" && activity.updatedAt.length <= 40
    && Number.isFinite(Date.parse(activity.updatedAt)) ? activity.updatedAt : undefined;
  return Object.freeze({ requestId: activity.requestId, workspaceId: activity.workspaceId,
    modelId: activity.modelId, displayName: activity.displayName, status: activity.status,
    model: activity.model, progress: downloadProgress(activity.progress), updatedAt });
}

function downloadProgress(progress: ModelDownloadTaskActivity["progress"]) {
  if (!progress) return undefined;
  const { current, total, percent } = progress;
  if (current !== undefined || total !== undefined) {
    if (typeof current !== "number" || !Number.isSafeInteger(current) || current < 0
      || typeof total !== "number" || !Number.isSafeInteger(total) || total <= 0 || current > total) return undefined;
    return { current, total, percent: current / total * 100,
      ...(progress.unit === "bytes" || progress.unit === "files" ? { unit: progress.unit } : {}) };
  }
  return typeof percent === "number" && Number.isFinite(percent) && percent >= 0 && percent <= 100
    ? { percent } : undefined;
}
