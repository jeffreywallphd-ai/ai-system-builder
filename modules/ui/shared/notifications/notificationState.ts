export const NOTIFICATION_TOAST_VISIBLE_MS = 5_000;
export const NOTIFICATION_TOAST_FADE_MS = 240;
export const NOTIFICATION_HISTORY_LIMIT = 100;
export const NOTIFICATION_ACTIVE_LIMIT = 20;
export const NOTIFICATION_MESSAGE_LIMIT = 500;
export const NOTIFICATION_TITLE_LIMIT = 120;
export const NOTIFICATION_SOURCE_LIMIT = 80;

export type NotificationTone = "info" | "success" | "warning" | "error";
export type NotificationToastPhase = "visible" | "fading";
export type NotificationActivityStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled" | "unknown";

export interface NotificationProgress {
  readonly current?: number;
  readonly total?: number;
  readonly percent?: number;
  readonly unit?: string;
}

export interface NotificationMessageInput {
  readonly message: string;
  readonly title?: string;
  readonly tone?: NotificationTone;
  readonly source?: string;
  readonly workspaceId?: string;
  readonly dedupeKey?: string;
}

export interface NotificationActivityInput {
  readonly id: string;
  readonly title: string;
  readonly message?: string;
  readonly status: NotificationActivityStatus;
  readonly progress?: NotificationProgress;
  readonly source?: string;
  readonly workspaceId?: string;
  readonly updatedAt?: string;
}

export interface NotificationRecord {
  readonly id: string;
  readonly kind: "message" | "activity";
  readonly message: string;
  readonly title?: string;
  readonly tone: NotificationTone;
  readonly source?: string;
  readonly workspaceId?: string;
  readonly dedupeKey?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly unread: boolean;
  readonly status?: NotificationActivityStatus;
  readonly progress?: NotificationProgress;
}

export interface NotificationCenterState {
  readonly records: readonly NotificationRecord[];
  readonly toastPhases: Readonly<Record<string, NotificationToastPhase>>;
  readonly activeWorkspaceId?: string;
  readonly panelOpen: boolean;
}

export type NotificationCenterAction =
  | { readonly type: "publish"; readonly record: NotificationRecord }
  | { readonly type: "upsert-activity"; readonly record: NotificationRecord }
  | { readonly type: "begin-toast-fade"; readonly id: string }
  | { readonly type: "hide-toast"; readonly id: string }
  | { readonly type: "dismiss"; readonly id: string }
  | { readonly type: "clear-visible" }
  | { readonly type: "mark-visible-read" }
  | { readonly type: "set-workspace"; readonly workspaceId?: string }
  | { readonly type: "set-panel-open"; readonly open: boolean };

export const INITIAL_NOTIFICATION_CENTER_STATE: NotificationCenterState = {
  records: [],
  toastPhases: {},
  panelOpen: false,
};

const TERMINAL_ACTIVITY_STATUSES = new Set<NotificationActivityStatus>(["succeeded", "failed", "cancelled"]);

export function notificationCenterReducer(state: NotificationCenterState, action: NotificationCenterAction): NotificationCenterState {
  switch (action.type) {
    case "publish": {
      const existingIndex = action.record.dedupeKey
        ? state.records.findIndex((record) => record.kind === "message" && record.dedupeKey === action.record.dedupeKey && record.workspaceId === action.record.workspaceId)
        : -1;
      const records = [...state.records];
      if (existingIndex >= 0) records.splice(existingIndex, 1);
      records.unshift(action.record);
      return { ...state, records: boundRecords(records), toastPhases: { ...state.toastPhases, [action.record.id]: "visible" } };
    }
    case "upsert-activity": {
      const existing = state.records.find((record) => record.kind === "activity" && record.id === action.record.id);
      if (existing?.status && TERMINAL_ACTIVITY_STATUSES.has(existing.status) && action.record.status && !TERMINAL_ACTIVITY_STATUSES.has(action.record.status)) return state;
      const nextRecord = existing
        ? { ...action.record, createdAt: existing.createdAt, unread: existing.unread || (action.record.status !== existing.status && TERMINAL_ACTIVITY_STATUSES.has(action.record.status ?? "unknown")) }
        : action.record;
      return { ...state, records: boundRecords([nextRecord, ...state.records.filter((record) => record.id !== nextRecord.id)]) };
    }
    case "begin-toast-fade":
      return state.toastPhases[action.id] ? { ...state, toastPhases: { ...state.toastPhases, [action.id]: "fading" } } : state;
    case "hide-toast": {
      if (!state.toastPhases[action.id]) return state;
      const { [action.id]: _removed, ...toastPhases } = state.toastPhases;
      return { ...state, toastPhases };
    }
    case "dismiss": {
      const { [action.id]: _removed, ...toastPhases } = state.toastPhases;
      return { ...state, records: state.records.filter((record) => record.id !== action.id), toastPhases };
    }
    case "clear-visible": {
      const retained = state.records.filter((record) => !isRecordVisible(record, state.activeWorkspaceId) || (record.kind === "activity" && record.status && !TERMINAL_ACTIVITY_STATUSES.has(record.status)));
      const retainedIds = new Set(retained.map((record) => record.id));
      return { ...state, records: retained, toastPhases: Object.fromEntries(Object.entries(state.toastPhases).filter(([id]) => retainedIds.has(id))) };
    }
    case "mark-visible-read":
      return { ...state, records: state.records.map((record) => isRecordVisible(record, state.activeWorkspaceId) ? { ...record, unread: false } : record) };
    case "set-workspace":
      return state.activeWorkspaceId === action.workspaceId && !state.panelOpen
        ? state
        : { ...state, activeWorkspaceId: action.workspaceId, panelOpen: false };
    case "set-panel-open":
      return { ...state, panelOpen: action.open };
  }
}

export function visibleNotificationRecords(state: NotificationCenterState): readonly NotificationRecord[] {
  return state.records.filter((record) => isRecordVisible(record, state.activeWorkspaceId));
}

export function visibleToastRecords(state: NotificationCenterState): readonly { readonly record: NotificationRecord; readonly phase: NotificationToastPhase }[] {
  return visibleNotificationRecords(state).flatMap((record) => {
    const phase = state.toastPhases[record.id];
    return phase ? [{ record, phase }] : [];
  });
}

export function sanitizeNotificationMessage(value: string, limit = NOTIFICATION_MESSAGE_LIMIT): string {
  const withoutStack = value.replace(/\r/g, "\n").split("\n").filter((line) => !/^\s*at\s+\S+/i.test(line)).join(" ");
  return withoutStack
    .replace(/\bBearer\s+[^\s]+/gi, "Bearer [redacted]")
    .replace(/\b(token|secret|password|api[-_ ]?key|authorization)\s*[:=]\s*[^\s,;]+/gi, "$1=[redacted]")
    .replace(/[A-Za-z]:\\(?:[^\\\s]+\\)*[^\\\s]*/g, "[local path]")
    .replace(/\/(?:Users|home|tmp|var|etc|opt)\/[^\s,;]*/g, "[local path]")
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, Math.max(0, limit));
}

export function sanitizeNotificationProgress(progress: NotificationProgress | undefined): NotificationProgress | undefined {
  if (!progress) return undefined;
  const current = boundedNonNegativeNumber(progress.current);
  const total = boundedNonNegativeNumber(progress.total);
  const percent = typeof progress.percent === "number" && Number.isFinite(progress.percent) ? Math.min(100, Math.max(0, progress.percent)) : undefined;
  const unit = progress.unit ? sanitizeNotificationMessage(progress.unit, 20) : undefined;
  if (current === undefined && total === undefined && percent === undefined && !unit) return undefined;
  return {
    ...(current === undefined ? {} : { current }),
    ...(total === undefined ? {} : { total }),
    ...(percent === undefined ? {} : { percent }),
    ...(unit ? { unit } : {}),
  };
}

export function isTerminalNotificationActivity(status: NotificationActivityStatus | undefined): boolean {
  return Boolean(status && TERMINAL_ACTIVITY_STATUSES.has(status));
}

function isRecordVisible(record: NotificationRecord, activeWorkspaceId: string | undefined): boolean {
  return !record.workspaceId || record.workspaceId === activeWorkspaceId;
}

function boundRecords(records: readonly NotificationRecord[]): readonly NotificationRecord[] {
  const active = records.filter((record) => record.kind === "activity" && record.status && !TERMINAL_ACTIVITY_STATUSES.has(record.status));
  const activeIds = new Set(active.slice(0, NOTIFICATION_ACTIVE_LIMIT).map((record) => record.id));
  const bounded: NotificationRecord[] = [];
  for (const record of records) {
    if (record.kind === "activity" && record.status && !TERMINAL_ACTIVITY_STATUSES.has(record.status) && !activeIds.has(record.id)) continue;
    if (bounded.length >= NOTIFICATION_HISTORY_LIMIT) break;
    bounded.push(record);
  }
  return bounded;
}

function boundedNonNegativeNumber(value: number | undefined): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.min(value, Number.MAX_SAFE_INTEGER) : undefined;
}
