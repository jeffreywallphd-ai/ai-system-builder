import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import { createOrganizationId } from "../../../../contracts/organization";
import {
  createJsonlSecurityAuditLogAdapter,
  sanitizeSecurityAuditEvent,
} from "../createJsonlSecurityAuditLogAdapter";

const event = {
  eventId: "event-1",
  kind: "authz.denied" as const,
  occurredAt: "2026-07-16T00:00:00.000Z",
  principalId: "principal-1",
  organizationId: createOrganizationId("org-a"),
  operation: "artifact.read",
  outcome: "denied" as const,
  resource: { kind: "artifact", id: "C:\\private\\artifact.bin" },
  details: {
    reasonCode: "resource-organization-mismatch",
    token: "plain-token",
    prompt: "private prompt",
    nested: { path: "/private/path" },
  },
};

describe("JSONL security audit log", () => {
  it("redacts sensitive details and path-like resource identifiers", () => {
    const sanitized = sanitizeSecurityAuditEvent(event);
    const serialized = JSON.stringify(sanitized);
    assert.equal(serialized.includes("plain-token"), false);
    assert.equal(serialized.includes("private prompt"), false);
    assert.equal(serialized.includes("private\\\\artifact"), false);
    assert.equal(serialized.includes("/private/path"), false);
    assert.equal(serialized.includes("resource-organization-mismatch"), true);
  });

  it("appends one JSON record per event", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "security-audit-"));
    const auditPath = path.join(root, "security", "audit.jsonl");
    const adapter = createJsonlSecurityAuditLogAdapter(auditPath);
    await adapter.recordSecurityEvent(event);
    await adapter.recordSecurityEvent({ ...event, eventId: "event-2" });
    const lines = (await readFile(auditPath, "utf8")).trim().split("\n");
    assert.equal(lines.length, 2);
    assert.deepEqual(lines.map((line) => JSON.parse(line).eventId), [
      "event-1",
      "event-2",
    ]);
  });
});
