import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";

import type { SecurityAuditLogPort } from "../../../application/ports/security";
import type { SecurityEvent } from "../../../contracts/security";

const SENSITIVE_KEY_PATTERN =
  /(authorization|token|secret|cookie|password|prompt|payload|content|bytes|path|stack|command|environment|claim)/i;
const PATH_LIKE_PATTERN = /(?:^[a-zA-Z]:[\\/]|[\\/]|\.\.)/;
const BEARER_PATTERN = /bearer\s+[a-z0-9._~+/=-]+/i;

export function createJsonlSecurityAuditLogAdapter(
  auditFilePath: string,
): SecurityAuditLogPort {
  const resolvedPath = path.resolve(auditFilePath);
  return {
    async recordSecurityEvent(event) {
      await mkdir(path.dirname(resolvedPath), { recursive: true });
      const sanitized = sanitizeSecurityAuditEvent(event);
      await appendFile(resolvedPath, `${JSON.stringify(sanitized)}\n`, {
        encoding: "utf8",
        flag: "a",
        mode: 0o600,
      });
    },
  };
}

export function sanitizeSecurityAuditEvent(event: SecurityEvent): SecurityEvent {
  return {
    ...event,
    resource: event.resource ? {
      ...event.resource,
      id: sanitizeIdentifier(event.resource.id),
      workspaceId: sanitizeIdentifier(event.resource.workspaceId),
    } : undefined,
    details: event.details
      ? sanitizeAuditValue(event.details) as Record<string, unknown>
      : undefined,
  };
}

function sanitizeIdentifier(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  return PATH_LIKE_PATTERN.test(value) || BEARER_PATTERN.test(value)
    ? "[REDACTED]"
    : value.slice(0, 256);
}

function sanitizeAuditValue(value: unknown, key?: string): unknown {
  if (key && SENSITIVE_KEY_PATTERN.test(key)) return "[REDACTED]";
  if (typeof value === "string") {
    if (PATH_LIKE_PATTERN.test(value) || BEARER_PATTERN.test(value)) {
      return "[REDACTED]";
    }
    return value.slice(0, 512);
  }
  if (Array.isArray(value)) {
    return value.slice(0, 50).map((item) => sanitizeAuditValue(item));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .slice(0, 50)
        .map(([nestedKey, nestedValue]) => [
          nestedKey,
          sanitizeAuditValue(nestedValue, nestedKey),
        ]),
    );
  }
  return value;
}
