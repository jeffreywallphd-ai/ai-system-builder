import { useEffect, useMemo, useRef } from "react";

import { useOptionalNotificationCenter } from "./NotificationProvider";
import type { NotificationTone } from "./notificationState";

export interface TransientNotificationPublisherProps {
  readonly message?: string | null;
  readonly title?: string;
  readonly tone?: NotificationTone;
  readonly source: string;
  readonly workspaceId?: string;
  readonly dedupeKey?: string;
}

/**
 * Publishes a transient page or tab outcome without rendering a second local banner.
 * Contextual validation, progress, readiness, and retry feedback must remain inline
 * and should not use this component.
 */
export function TransientNotificationPublisher({
  message,
  title,
  tone = "info",
  source,
  workspaceId,
  dedupeKey,
}: TransientNotificationPublisherProps) {
  const notifications = useOptionalNotificationCenter();
  const normalizedMessage = message?.trim() || undefined;
  const signature = useMemo(
    () => normalizedMessage
      ? JSON.stringify([normalizedMessage, title ?? "", tone, source, workspaceId ?? "", dedupeKey ?? ""])
      : undefined,
    [dedupeKey, normalizedMessage, source, title, tone, workspaceId],
  );
  const publishedSignatureRef = useRef<string | undefined>(undefined);

  useEffect(() => {
    if (!signature || !normalizedMessage) {
      publishedSignatureRef.current = undefined;
      return;
    }
    if (!notifications || publishedSignatureRef.current === signature) return;
    publishedSignatureRef.current = signature;
    notifications.publish({
      message: normalizedMessage,
      title,
      tone,
      source,
      workspaceId,
      dedupeKey: dedupeKey ?? `${source}:${title ?? "outcome"}:${normalizedMessage}`,
    });
  }, [dedupeKey, normalizedMessage, notifications, signature, source, title, tone, workspaceId]);

  return null;
}
