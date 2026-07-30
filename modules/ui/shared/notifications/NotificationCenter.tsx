import { useEffect, useRef } from "react";

import { ApplicationIcon } from "../components/ApplicationIcon";
import { isTerminalNotificationActivity, type NotificationRecord } from "./notificationState";
import { useNotificationCenter } from "./NotificationProvider";

export const NOTIFICATION_BELL_ID = "application-notification-bell";
export const NOTIFICATION_PANEL_ID = "application-notification-panel";

export function NotificationBell() {
  const notifications = useNotificationCenter();
  return (
    <button
      id={NOTIFICATION_BELL_ID}
      className="ui-shell__notification-button"
      type="button"
      aria-label={notifications.unreadCount > 0 ? `Notifications, ${notifications.unreadCount} unread` : "Notifications"}
      aria-haspopup="dialog"
      aria-controls={NOTIFICATION_PANEL_ID}
      aria-expanded={notifications.state.panelOpen}
      title="Notifications"
      onClick={() => notifications.setPanelOpen(!notifications.state.panelOpen)}
    >
      <ApplicationIcon name="notifications" />
      {notifications.unreadCount > 0 ? <span className="ui-notification__badge" aria-hidden="true">{Math.min(99, notifications.unreadCount)}</span> : null}
      <span className="ui-visually-hidden">Notifications</span>
    </button>
  );
}

export function NotificationViewport() {
  const notifications = useNotificationCenter();
  const panelRef = useRef<HTMLDivElement | null>(null);
  const wasOpenRef = useRef(false);

  useEffect(() => {
    if (notifications.state.panelOpen) {
      panelRef.current?.querySelector<HTMLButtonElement>("[data-notification-initial-focus]")?.focus();
    } else if (wasOpenRef.current) {
      document.getElementById(NOTIFICATION_BELL_ID)?.focus();
    }
    wasOpenRef.current = notifications.state.panelOpen;
  }, [notifications.state.panelOpen]);

  useEffect(() => {
    const onPointer = (event: MouseEvent | TouchEvent) => {
      if (!notifications.state.panelOpen) return;
      const target = event.target;
      const bell = document.getElementById(NOTIFICATION_BELL_ID);
      if (target instanceof Node && !panelRef.current?.contains(target) && !bell?.contains(target)) notifications.setPanelOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && notifications.state.panelOpen) {
        event.preventDefault();
        notifications.setPanelOpen(false);
      }
    };
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("touchstart", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("touchstart", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [notifications]);

  return (
    <>
      {notifications.state.panelOpen ? (
        <div id={NOTIFICATION_PANEL_ID} ref={panelRef} className="ui-notification__panel" role="dialog" aria-modal="false" aria-labelledby="application-notification-heading">
          <header className="ui-notification__panel-header">
            <div>
              <h2 id="application-notification-heading">Notifications</h2>
              <p>Current-session messages and activity</p>
            </div>
            <button type="button" className="ui-notification__icon-button" data-notification-initial-focus aria-label="Close notifications" onClick={() => notifications.setPanelOpen(false)}>
              <ApplicationIcon name="close" />
            </button>
          </header>
          <div className="ui-notification__panel-actions">
            <button type="button" className="ui-button ui-button--outline" onClick={notifications.markVisibleRead} disabled={notifications.unreadCount === 0}>Mark all read</button>
            <button type="button" className="ui-button ui-button--outline" onClick={notifications.clearVisible} disabled={notifications.records.length === 0}>Clear completed</button>
          </div>
          {notifications.records.length === 0 ? <p className="ui-notification__empty">No notifications yet.</p> : (
            <ol className="ui-notification__list">
              {notifications.records.map((record) => <NotificationListItem key={record.id} record={record} onDismiss={() => notifications.dismiss(record.id)} />)}
            </ol>
          )}
        </div>
      ) : null}
      <div className="ui-notification__toasts" aria-live="polite" aria-relevant="additions text">
        {notifications.toasts.map(({ record, phase }) => (
          <article key={record.id} className={`ui-notification__toast ui-notification__toast--${record.tone}${phase === "fading" ? " ui-notification__toast--fading" : ""}`} role={record.tone === "error" ? "alert" : "status"}>
            <div>{record.title ? <strong>{record.title}</strong> : null}<p>{record.message}</p></div>
            <button type="button" className="ui-notification__icon-button" aria-label="Dismiss notification" onClick={() => notifications.dismiss(record.id)}><ApplicationIcon name="close" /></button>
          </article>
        ))}
      </div>
    </>
  );
}

function NotificationListItem({ record, onDismiss }: { readonly record: NotificationRecord; readonly onDismiss: () => void }) {
  const canDismiss = record.kind === "message" || isTerminalNotificationActivity(record.status);
  return (
    <li className={`ui-notification__item ui-notification__item--${record.tone}${record.unread ? " ui-notification__item--unread" : ""}`}>
      <div className="ui-notification__item-body">
        <div className="ui-notification__item-heading"><strong>{record.title ?? record.source ?? "Message"}</strong><time dateTime={record.updatedAt}>{formatNotificationTime(record.updatedAt)}</time></div>
        <p>{record.message}</p>
        {record.progress ? (
          <div className="ui-notification__progress">
            {typeof record.progress.percent === "number" ? <progress value={record.progress.percent} max={100}>{Math.round(record.progress.percent)}%</progress> : <span className="ui-notification__progress-indeterminate" aria-label="Progress unavailable" />}
            <span>{formatProgress(record.progress)}</span>
          </div>
        ) : null}
        {record.source && record.title ? <small>{record.source}</small> : null}
      </div>
      {canDismiss ? <button type="button" className="ui-notification__icon-button" aria-label="Dismiss notification" onClick={onDismiss}><ApplicationIcon name="close" /></button> : null}
    </li>
  );
}

function formatNotificationTime(value: string): string {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "Now" : parsed.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function formatProgress(progress: NonNullable<NotificationRecord["progress"]>): string {
  if (typeof progress.percent === "number") return `${Math.round(progress.percent)}%`;
  if (typeof progress.current === "number" && typeof progress.total === "number") return `${progress.current} of ${progress.total}${progress.unit ? ` ${progress.unit}` : ""}`;
  return "In progress";
}
