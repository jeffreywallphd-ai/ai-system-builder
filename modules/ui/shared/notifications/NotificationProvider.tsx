import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef, type ReactNode } from "react";

import {
  INITIAL_NOTIFICATION_CENTER_STATE,
  NOTIFICATION_SOURCE_LIMIT,
  NOTIFICATION_TITLE_LIMIT,
  NOTIFICATION_TOAST_FADE_MS,
  NOTIFICATION_TOAST_VISIBLE_MS,
  isTerminalNotificationActivity,
  notificationCenterReducer,
  sanitizeNotificationMessage,
  sanitizeNotificationProgress,
  visibleNotificationRecords,
  visibleToastRecords,
  type NotificationActivityInput,
  type NotificationCenterState,
  type NotificationMessageInput,
  type NotificationRecord,
} from "./notificationState";

export interface NotificationCenterApi {
  readonly state: NotificationCenterState;
  readonly records: readonly NotificationRecord[];
  readonly toasts: ReturnType<typeof visibleToastRecords>;
  readonly unreadCount: number;
  publish(input: NotificationMessageInput): string | undefined;
  upsertActivity(input: NotificationActivityInput): void;
  dismiss(id: string): void;
  clearVisible(): void;
  markVisibleRead(): void;
  setActiveWorkspaceId(workspaceId?: string): void;
  setPanelOpen(open: boolean): void;
}

const NotificationCenterContext = createContext<NotificationCenterApi | undefined>(undefined);

export function NotificationProvider({ children }: { readonly children: ReactNode }) {
  const [state, dispatch] = useReducer(notificationCenterReducer, INITIAL_NOTIFICATION_CENTER_STATE);
  const sequenceRef = useRef(0);
  const timersRef = useRef(new Map<string, readonly number[]>());

  const clearTimers = useCallback((id: string) => {
    for (const timer of timersRef.current.get(id) ?? []) window.clearTimeout(timer);
    timersRef.current.delete(id);
  }, []);

  useEffect(() => () => {
    for (const id of timersRef.current.keys()) clearTimers(id);
  }, [clearTimers]);

  const publish = useCallback((input: NotificationMessageInput): string | undefined => {
    const message = sanitizeNotificationMessage(input.message);
    if (!message) return undefined;
    sequenceRef.current += 1;
    const now = new Date().toISOString();
    const id = `notification-${Date.now()}-${sequenceRef.current}`;
    const record: NotificationRecord = {
      id,
      kind: "message",
      message,
      title: input.title ? sanitizeNotificationMessage(input.title, NOTIFICATION_TITLE_LIMIT) : undefined,
      tone: input.tone ?? "info",
      source: input.source ? sanitizeNotificationMessage(input.source, NOTIFICATION_SOURCE_LIMIT) : undefined,
      workspaceId: input.workspaceId?.trim() || undefined,
      dedupeKey: input.dedupeKey?.trim().slice(0, 160) || undefined,
      createdAt: now,
      updatedAt: now,
      unread: true,
    };
    dispatch({ type: "publish", record });
    const fadeTimer = window.setTimeout(() => dispatch({ type: "begin-toast-fade", id }), NOTIFICATION_TOAST_VISIBLE_MS);
    const hideTimer = window.setTimeout(() => {
      dispatch({ type: "hide-toast", id });
      timersRef.current.delete(id);
    }, NOTIFICATION_TOAST_VISIBLE_MS + NOTIFICATION_TOAST_FADE_MS);
    timersRef.current.set(id, [fadeTimer, hideTimer]);
    return id;
  }, []);

  const upsertActivity = useCallback((input: NotificationActivityInput) => {
    const id = input.id.trim().slice(0, 160);
    const title = sanitizeNotificationMessage(input.title, NOTIFICATION_TITLE_LIMIT);
    if (!id || !title) return;
    const now = input.updatedAt ?? new Date().toISOString();
    dispatch({
      type: "upsert-activity",
      record: {
        id,
        kind: "activity",
        title,
        message: sanitizeNotificationMessage(input.message ?? activityDefaultMessage(input.status)),
        tone: activityTone(input.status),
        source: input.source ? sanitizeNotificationMessage(input.source, NOTIFICATION_SOURCE_LIMIT) : undefined,
        workspaceId: input.workspaceId?.trim() || undefined,
        createdAt: now,
        updatedAt: now,
        unread: isTerminalNotificationActivity(input.status),
        status: input.status,
        progress: sanitizeNotificationProgress(input.progress),
      },
    });
  }, []);

  const records = useMemo(() => visibleNotificationRecords(state), [state]);
  const toasts = useMemo(() => visibleToastRecords(state), [state]);
  const unreadCount = useMemo(() => records.filter((record) => record.unread).length, [records]);

  const dismiss = useCallback((id: string) => {
    clearTimers(id);
    dispatch({ type: "dismiss", id });
  }, [clearTimers]);
  const clearVisible = useCallback(() => {
    for (const record of records) clearTimers(record.id);
    dispatch({ type: "clear-visible" });
  }, [clearTimers, records]);
  const markVisibleRead = useCallback(() => dispatch({ type: "mark-visible-read" }), []);
  const setActiveWorkspaceId = useCallback((workspaceId?: string) => {
    dispatch({ type: "set-workspace", workspaceId: workspaceId?.trim() || undefined });
  }, []);
  const setPanelOpen = useCallback((open: boolean) => {
    dispatch({ type: "set-panel-open", open });
    if (open) dispatch({ type: "mark-visible-read" });
  }, []);

  const api = useMemo<NotificationCenterApi>(() => ({
    state,
    records,
    toasts,
    unreadCount,
    publish,
    upsertActivity,
    dismiss,
    clearVisible,
    markVisibleRead,
    setActiveWorkspaceId,
    setPanelOpen,
  }), [clearVisible, dismiss, markVisibleRead, publish, records, setActiveWorkspaceId, setPanelOpen, state, toasts, unreadCount, upsertActivity]);

  return <NotificationCenterContext.Provider value={api}>{children}</NotificationCenterContext.Provider>;
}

export function useNotificationCenter(): NotificationCenterApi {
  const value = useContext(NotificationCenterContext);
  if (!value) throw new Error("useNotificationCenter must be used inside NotificationProvider.");
  return value;
}

export function useOptionalNotificationCenter(): NotificationCenterApi | undefined {
  return useContext(NotificationCenterContext);
}

function activityTone(status: NotificationActivityInput["status"]) {
  if (status === "succeeded") return "success" as const;
  if (status === "failed") return "error" as const;
  if (status === "cancelled" || status === "unknown") return "warning" as const;
  return "info" as const;
}

function activityDefaultMessage(status: NotificationActivityInput["status"]): string {
  if (status === "queued") return "Queued.";
  if (status === "running") return "In progress.";
  if (status === "succeeded") return "Completed.";
  if (status === "failed") return "Needs attention.";
  if (status === "cancelled") return "Cancelled.";
  return "Status unavailable.";
}
