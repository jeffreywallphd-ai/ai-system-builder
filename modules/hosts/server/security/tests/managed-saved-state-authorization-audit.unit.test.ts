import assert from "node:assert/strict";
import test from "node:test";

import type { SecurityEvent } from "../../../../contracts/security";
import { createManagedSavedStateAuthorizationAudit } from "../createManagedSavedStateAuthorizationAudit";

test("passive membership checks do not append success rows and sample bounded, content-free denials", async () => {
  const entries: SecurityEvent[] = [];
  let clock = 0;
  const audit = createManagedSavedStateAuthorizationAudit({ async recordSecurityEvent(event) { entries.push(event); } }, () => clock);
  const input = { eventId: "fixture", occurredAt: "2026-11-14T00:00:00.000Z", principalId: "fixture-private",
    requestId: "not-audited", operation: "ignored", details: { raw: "fixture-private" } };
  for (let index = 0; index < 50; index++) await audit.recordSecurityEvent({ ...input, kind: "authz.allowed", outcome: "allowed" });
  assert.deepEqual(entries, []);
  for (let index = 0; index < 15; index++) await audit.recordSecurityEvent({ ...input, kind: "authz.denied", outcome: "denied" });
  assert.equal(entries.length, 1);
  clock += 60_000;
  await audit.recordSecurityEvent({ ...input, kind: "authz.denied", outcome: "denied" });
  assert.deepEqual(entries.map((entry) => entry.details), [{ deniedChecks: 1 }, { deniedChecks: 15 }]);
  assert.doesNotMatch(JSON.stringify(entries), /fixture-private|not-audited|ignored/);
});

test("one pending audit write does not queue further denial writes", async () => {
  let attempts = 0;
  let clock = 0;
  let release = () => {};
  const held = new Promise<void>((resolve) => { release = resolve; });
  const audit = createManagedSavedStateAuthorizationAudit({ async recordSecurityEvent() {
    attempts += 1;
    await held;
    throw new Error("private diagnostic");
  } }, () => clock);
  const event = { eventId: "fixture", occurredAt: "2026-11-14T00:00:00.000Z", kind: "authz.denied", outcome: "denied" } as const;
  const first = audit.recordSecurityEvent(event);
  clock = 100_000;
  await audit.recordSecurityEvent(event);
  assert.equal(attempts, 1);
  release();
  await first;
  await audit.recordSecurityEvent(event);
  assert.equal(attempts, 2);
});
