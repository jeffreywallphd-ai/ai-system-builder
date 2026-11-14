import { randomUUID } from "node:crypto";
import type { StructuredDocumentStore } from "../../../adapters/persistence/shared";
import { sanitizeSecurityAuditEvent } from "../../../adapters/security/audit/createJsonlSecurityAuditLogAdapter";
import type { SecurityAuditLogPort } from "../../../application/ports/security";
import { isUiControlId, readUiControlRevoke, type UiControlAttempt } from "../../../contracts/headless";
import type { LocalIdentityProfile } from "../../../contracts/organization";
import { isWorkspaceId, type WorkspaceId } from "../../../contracts/workspace";

const windowEvents = {
  requested: "success",
  accepted: "success",
  activated: "success",
  "local-revoke-received": "success",
  "host-revoke-applied": "success",
  "command-delivered": "success",
  "command-applied": "success",
  "command-rejected": "failure",
  "command-discarded": "failure",
  "command-unconfirmed": "failure",
  "command-conflict": "denied",
} as const;

export type DesktopWindowAuditEvent = keyof typeof windowEvents;
const backendOperations = ["system-authoring", "approved-conversation"] as const;
const backendOutcomes = {
  committed: "success", replayed: "success", previewed: "success", "handle-observed": "success",
  denied: "denied", refused: "denied", conflict: "denied", unconfirmed: "failure",
} as const;

export function createDesktopHeadlessAudit(port: SecurityAuditLogPort, identity: LocalIdentityProfile) {
  const maxPending = 128;
  const queue: Array<Parameters<SecurityAuditLogPort["recordSecurityEvent"]>[0]> = [];
  let writing: Promise<void> | undefined;
  let open = true;
  let dropped = 0;
  let failed = 0;

  function schedule(event: typeof queue[number]) {
    if (!open) return;
    if (queue.length >= maxPending) { dropped = Math.min(Number.MAX_SAFE_INTEGER, dropped + 1); return; }
    queue.push(event);
    writing ??= Promise.resolve().then(async () => {
      let next: typeof event | undefined;
      while ((next = queue.shift())) {
        try { await port.recordSecurityEvent(next); }
        catch { failed = Math.min(Number.MAX_SAFE_INTEGER, failed + 1); }
      }
      writing = undefined;
    });
  }

  const base = () => ({ eventId: randomUUID(), occurredAt: new Date().toISOString(),
    principalId: identity.principalId, organizationId: identity.organizationId });
  return {
    window(type: DesktopWindowAuditEvent, target: UiControlAttempt, commandId?: string, sequence?: number) {
      const exact = readUiControlRevoke(target);
      if (!exact || !Object.prototype.hasOwnProperty.call(windowEvents, type)) return;
      if (type.startsWith("command-") !== (commandId !== undefined && sequence !== undefined) ||
          (commandId === undefined) !== (sequence === undefined)) return;
      if ((commandId !== undefined && !isUiControlId(commandId)) ||
          (sequence !== undefined && (!Number.isSafeInteger(sequence) || sequence < 1 || sequence > 256))) return;
      schedule({ ...base(), kind: "headless.presentation", operation: `headless.window.${type}`, outcome: windowEvents[type],
        requestId: exact.requestId, correlationId: exact.attemptId, resource: { kind: "desktop-window", id: exact.windowId,
          workspaceId: exact.workspaceId, organizationId: identity.organizationId },
        details: { hostIncarnationId: exact.hostIncarnationId, uiIncarnationId: exact.uiIncarnationId,
          ...("generation" in exact ? { generation: exact.generation } : {}),
          ...(commandId ? { actionId: commandId } : {}), ...(sequence ? { sequence } : {}) },
      });
    },
    backend(operation: typeof backendOperations[number], workspaceId: WorkspaceId, result: keyof typeof backendOutcomes) {
      if (!backendOperations.includes(operation) || !isWorkspaceId(workspaceId) ||
          !Object.prototype.hasOwnProperty.call(backendOutcomes, result)) return;
      schedule({ ...base(), kind: "headless.backend", operation: `headless.${operation}.${result}`, outcome: backendOutcomes[result],
        resource: { kind: "workspace", workspaceId, organizationId: identity.organizationId } });
    },
    counts: () => ({ pending: queue.length, dropped, failed }),
    async close() {
      open = false;
      if (!writing) return;
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([writing, new Promise<void>(resolve => { timer = setTimeout(resolve, 1000); })]);
      } finally {
        clearTimeout(timer);
        dropped = Math.min(Number.MAX_SAFE_INTEGER, dropped + queue.length);
        queue.length = 0;
      }
    },
  };
}

export type DesktopHeadlessAudit = ReturnType<typeof createDesktopHeadlessAudit>;

export function createStoredDesktopHeadlessAudit(documents: StructuredDocumentStore, identity: LocalIdentityProfile,
  recordLimit = maxRecords): DesktopHeadlessAudit {
  if (documents.organizationId !== identity.organizationId) throw new Error("The desktop audit scope is unavailable.");
  return createDesktopHeadlessAudit(createBoundedDesktopHeadlessAuditPort(documents, recordLimit), identity);
}

const auditNamespace = "headless-security-audit";
const maxRecords = 4096;
const maxEventBytes = 2048;

/** An append-only desktop audit with bounded storage and an atomic admission counter. */
function createBoundedDesktopHeadlessAuditPort(documents: StructuredDocumentStore, recordLimit: number): SecurityAuditLogPort {
  if (!documents.organizationId || !Number.isSafeInteger(recordLimit) || recordLimit < 1 || recordLimit > maxRecords) {
    throw new Error("The desktop audit store is unavailable.");
  }
  return {
    async recordSecurityEvent(event) {
      const value = sanitizeSecurityAuditEvent(event);
      if (value.organizationId !== documents.organizationId ||
          Buffer.byteLength(JSON.stringify(value), "utf8") > maxEventBytes) {
        throw new Error("The desktop audit entry is unavailable.");
      }
      await documents.runInTransaction(async transaction => {
        if (transaction.organizationId !== value.organizationId) throw new Error("The desktop audit scope is unavailable.");
        const counter = await transaction.readDocument<number>(auditNamespace, "count");
        const count = counter?.value ?? 0;
        if (!Number.isSafeInteger(count) || count < 0 || count >= recordLimit) {
          throw new Error("The desktop audit capacity is unavailable.");
        }
        await transaction.writeDocument(auditNamespace, `event-${count + 1}`, value, { expectedRevision: 0 });
        await transaction.writeDocument(auditNamespace, "count", count + 1, { expectedRevision: counter?.revision ?? 0 });
      });
    },
  };
}
