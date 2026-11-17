import { normalizeConversationSessionId, normalizeConversationTurnId } from "../conversations";
import { isExecutionRunStatus, normalizeExecutionRunId, type ExecutionRunStatus } from "../execution-runs";
import { createIpcChannelValue } from "../ipc/ipc-channel";
import { hasKnownPassiveCredential, readStrictPassiveRecord } from "../shared";
import { createTransportOperation } from "../transport";
import { isWorkspaceId, type WorkspaceId } from "../workspace";

export const DESKTOP_HEADLESS_CHAT_TASKS_CHANNEL = createIpcChannelValue(
  createTransportOperation("system-builder", "read-recent-headless-chat-tasks"), "request",
);
export const DESKTOP_HEADLESS_CHAT_TASK_LIMIT = 10;
export const DESKTOP_HEADLESS_CHAT_TASKS_UNAVAILABLE = { status: "unavailable" } as const;

export type DesktopHeadlessChatTask = {
  readonly sessionId: string;
  readonly turnId: string;
  readonly runId: string;
  readonly status: ExecutionRunStatus;
};
export type DesktopHeadlessChatTasks = typeof DESKTOP_HEADLESS_CHAT_TASKS_UNAVAILABLE |
  { readonly status: "ready"; readonly workspaceId: WorkspaceId; readonly tasks: readonly DesktopHeadlessChatTask[] };

export function readDesktopHeadlessChatTaskRequest(value: unknown): WorkspaceId | undefined {
  try {
    const { workspaceId } = readStrictPassiveRecord(value, ["workspaceId"]);
    return isWorkspaceId(workspaceId) ? workspaceId : undefined;
  } catch { return undefined; }
}

export function readDesktopHeadlessChatTasks(value: unknown, expectedWorkspaceId: WorkspaceId): DesktopHeadlessChatTasks {
  try {
    const { status, workspaceId, tasks } = readStrictPassiveRecord(value, ["status", "workspaceId", "tasks"]);
    if (status !== "ready" || workspaceId !== expectedWorkspaceId || !isWorkspaceId(workspaceId) ||
        !Array.isArray(tasks) || Object.getPrototypeOf(tasks) !== Array.prototype ||
        tasks.length > DESKTOP_HEADLESS_CHAT_TASK_LIMIT || Reflect.ownKeys(tasks).length !== tasks.length + 1)
      return DESKTOP_HEADLESS_CHAT_TASKS_UNAVAILABLE;
    const selected: DesktopHeadlessChatTask[] = [];
    const runIds = new Set<string>();
    const turnIds = new Set<string>();
    for (let index = 0; index < tasks.length; index++) {
      const entry = Object.getOwnPropertyDescriptor(tasks, index);
      if (!entry?.enumerable || !("value" in entry)) return DESKTOP_HEADLESS_CHAT_TASKS_UNAVAILABLE;
      const { sessionId, turnId, runId, status: runStatus } =
        readStrictPassiveRecord(entry.value, ["sessionId", "turnId", "runId", "status"]);
      if (typeof sessionId !== "string" || sessionId.length > 128 || normalizeConversationSessionId(sessionId) !== sessionId ||
          typeof turnId !== "string" || turnId.length > 128 || normalizeConversationTurnId(turnId) !== turnId ||
          typeof runId !== "string" || runId.length > 128 || normalizeExecutionRunId(runId) !== runId ||
          [sessionId, turnId, runId].some(hasKnownPassiveCredential) || typeof runStatus !== "string" || !isExecutionRunStatus(runStatus) || runIds.has(runId) || turnIds.has(turnId))
        return DESKTOP_HEADLESS_CHAT_TASKS_UNAVAILABLE;
      runIds.add(runId);
      turnIds.add(turnId);
      selected.push({ sessionId, turnId, runId, status: runStatus });
    }
    return { status: "ready", workspaceId, tasks: selected };
  } catch { return DESKTOP_HEADLESS_CHAT_TASKS_UNAVAILABLE; }
}
