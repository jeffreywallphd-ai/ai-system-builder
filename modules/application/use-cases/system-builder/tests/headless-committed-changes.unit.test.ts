import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { test } from "node:test";
import { isHeadlessHostIncarnationId } from "../../../../contracts/headless";
import { createOrganizationId } from "../../../../contracts/organization";
import {
  normalizeSystemBuilderRevisionId, normalizeSystemBuilderSystemId, type SystemBuilderRecord,
} from "../../../../contracts/system-builder";
import { createWorkspaceId } from "../../../../contracts/workspace";
import type { CommittedSystemChange } from "../../../ports/system-builder";
import { HeadlessCommittedChangesUseCase } from "../headless-committed-changes.use-case";

const host = (() => {
  const candidate = "41a96fc3-d2b8-4414-bd29-00059badc72d";
  if (!isHeadlessHostIncarnationId(candidate)) throw new Error("Invalid fixture");
  return candidate;
})();
const organizationId = createOrganizationId("fixture-org");
const workspaceId = createWorkspaceId("fixture-workspace");
const systemId = normalizeSystemBuilderSystemId("fixture-system");
const revisionId = normalizeSystemBuilderRevisionId("fixture-system.r2");
const event: CommittedSystemChange = { systemId, revisionId, recordRevision: 2, sequence: 2 };

function setup(savedEvent: CommittedSystemChange = event) {
  let current = true;
  let revokedWhileReading = false;
  let reads = 0;
  const order: string[] = [];
  const record = { targetWorkspaceId: workspaceId, status: "validated", systemId, revision: 2, currentRevisionId: revisionId,
    description: "Fixture private field outside the projection." } as SystemBuilderRecord;
  const service = new HeadlessCommittedChangesUseCase({
    organizationId, hostIncarnationId: host,
    systems: { async listRecords() { order.push("records"); return [record]; } },
    access: { async authorize() { if (!current) throw new Error("Fixture access denied."); } },
    feed: {
      async watermark() { order.push("watermark"); return 1; },
      async readChanges(_scope, after) {
        reads++;
        if (revokedWhileReading) current = false;
        return after === 1 ? { kind: "changes", watermark: 2, events: [savedEvent] } : { kind: "resync" };
      },
    },
    digest: (input) => createHmac("sha256", "fixture-cursor-key").update(input).digest("hex"),
  });
  const identity = { organizationId, scopeId: "fixture-identity", canRead: async () => current };
  return { service, identity, order, reads: () => reads, revokeAtRead: () => { revokedWhileReading = true; } };
}

test("captures the watermark before the snapshot and allows safe duplicate committed events", async () => {
  const { service, identity, order } = setup();
  const snapshot = await service.snapshot(workspaceId, identity);
  assert.ok(snapshot.ok);
  assert.deepEqual(order, ["watermark", "records"]);
  assert.deepEqual(snapshot.value.systems, [{ systemId, recordRevision: 2, revisionId, status: "validated" }]);
  assert.equal(snapshot.value.cursor.sequence, 1);
  const changes = await service.changes(workspaceId, snapshot.value.cursor, identity);
  assert.ok(changes.ok && changes.value.kind === "changes");
  assert.deepEqual(changes.value.events, [event]);
  assert.equal(changes.value.cursor.sequence, 2);
  assert.equal(changes.value.more, false);
});

test("replays an ordinary saved change without a current composition revision", async () => {
  const savedEvent = { ...event, revisionId: null };
  const { service, identity } = setup(savedEvent);
  const snapshot = await service.snapshot(workspaceId, identity);
  assert.ok(snapshot.ok);
  const changes = await service.changes(workspaceId, snapshot.value.cursor, identity);
  assert.ok(changes.ok && changes.value.kind === "changes");
  assert.deepEqual(changes.value.events, [savedEvent]);
  assert.equal(changes.value.cursor.sequence, 2);
});

test("returns resync before reading for cursor scope, host, or sequence changes", async () => {
  const fixture = setup();
  const snapshot = await fixture.service.snapshot(workspaceId, fixture.identity);
  assert.ok(snapshot.ok);
  const { cursor } = snapshot.value;
  for (const [target, supplied, reader] of [
    [createWorkspaceId("fixture-other-workspace"), cursor, fixture.identity],
    [workspaceId, cursor, { ...fixture.identity, scopeId: "other-client" }],
    [workspaceId, { ...cursor, hostIncarnationId: "3a6112ce-ab8a-456f-876f-64730ff719df" }, fixture.identity],
    [workspaceId, { ...cursor, sequence: 0 }, fixture.identity],
  ] as const) {
    assert.deepEqual(await fixture.service.changes(target, supplied, reader), { ok: true, value: { kind: "resync" } });
  }
  assert.equal(fixture.reads(), 0);
});

test("withholds results if access changes while the stored page is read", async () => {
  const fixture = setup();
  const snapshot = await fixture.service.snapshot(workspaceId, fixture.identity);
  assert.ok(snapshot.ok);
  fixture.revokeAtRead();
  const result = await fixture.service.changes(workspaceId, snapshot.value.cursor, fixture.identity);
  assert.ok(!result.ok);
  assert.equal(result.error.code, "headless.forbidden");
});
