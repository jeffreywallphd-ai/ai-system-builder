import assert from "node:assert/strict";
import { test } from "node:test";
import {
  HEADLESS_CONTRACT_VERSION, HEADLESS_MAX_SEMANTIC_EDITS, isHeadlessHostIncarnationId, parseHeadlessSemanticBatchRequest,
} from "../index";

const host = "41a96fc3-d2b8-4414-bd29-00059badc72d";
const priorHost = "3a6112ce-ab8a-456f-876f-64730ff719df";
assert.ok(isHeadlessHostIncarnationId(host));
const invalid = { ok: false, code: "headless.invalid-request" };
const edits = [
  { kind: "add", instanceId: "fixture.node", definitionId: "builtin.form.text", version: "3.0.0",
    configuration: { label: "Fixture label" }, parentInstanceId: "fixture.root", slotId: "content", order: 0 },
  { kind: "configure", instanceId: "fixture.node", values: { label: "Change", flags: [false, 0, null] } },
  { kind: "connect", bindingId: "fixture.binding", bindingKind: "event", sourceInstanceId: "fixture.node", sourcePortId: "source",
    targetInstanceId: "fixture.target", targetPortId: "target" },
  { kind: "move", instanceId: "fixture.node", parentInstanceId: "fixture.container", slotId: "content", order: 1 },
  { kind: "remove", instanceId: "fixture.node" },
];
const input = {
  hostIncarnationId: host, workspaceId: "fixture-workspace", systemId: "fixture-system",
  baseRecordRevision: 7, baseRevisionId: "fixture-system.r6", edits,
};
const request = { version: HEADLESS_CONTRACT_VERSION, operation: "systems.preview-edits", input };

test("reconstructs finite edit types and requires the same exact identities for apply", () => {
  const preview = parseHeadlessSemanticBatchRequest(request, host);
  assert.deepEqual(preview, { ok: true, request });
  assert.ok(preview.ok);
  assert.notStrictEqual(preview.request.input.edits, edits);
  assert.notStrictEqual(preview.request.input.edits[0], edits[0]);
  const apply = { ...request, operation: "systems.apply-edits", input: {
    ...input, previewDigest: "1".repeat(64), idempotencyKey: "a6f56324-2051-462c-b45b-d9b49bf6dd4a",
  } };
  assert.deepEqual(parseHeadlessSemanticBatchRequest(apply, host), { ok: true, request: apply });
  assert.deepEqual(parseHeadlessSemanticBatchRequest({ ...apply, input }, host), invalid);
  assert.deepEqual(parseHeadlessSemanticBatchRequest({ ...request, input: apply.input }, host), invalid);
  assert.deepEqual(parseHeadlessSemanticBatchRequest({ ...request, input: { ...input, hostIncarnationId: priorHost } }, host),
    { ok: false, code: "headless.host-changed" });
});

test("refuses unknown input, loose targets and edit kinds outside the typed catalog", () => {
  for (const change of [{ organizationId: "fixture-org" }, { baseRecordRevision: 0 }, { baseRevisionId: "/wrong" },
    { workspaceId: " active-workspace" }, { systemId: "wrong/system" },
    { edits: [] }, { edits: Array.from({ length: HEADLESS_MAX_SEMANTIC_EDITS + 1 }, () => edits[0]) },
    { edits: [{ ...edits[0], version: "latest" }] }, { edits: [{ ...edits[0], order: -1 }] },
    { edits: [{ ...edits[1], values: {} }] }, { edits: [{ ...edits[2], bindingKind: "adapter" }] },
    { edits: [{ ...edits[4], confirmationOverride: true }] }, { edits: [{ kind: "run-script" }] }]) {
    assert.deepEqual(parseHeadlessSemanticBatchRequest({ ...request, input: { ...input, ...change } }, host), invalid);
  }
});

test("preserves literal installed asset versions without admitting floating selectors", () => {
  for (const version of ["1.2.3", "1.2.3-rc.1", "1.2.3-rc.1+build.4", "edition-7"]) {
    const candidate = { ...request, input: { ...input, edits: [{ ...edits[0], version }] } };
    assert.deepEqual(parseHeadlessSemanticBatchRequest(candidate, host), { ok: true, request: candidate });
  }
  for (const version of ["stable", "Latest", "^3.0.0", "1.x *", "edition/7", "x".repeat(129)]) {
    assert.deepEqual(parseHeadlessSemanticBatchRequest({ ...request, input: { ...input, edits: [{ ...edits[0], version }] } }, host), invalid);
  }
});

test("rejects oversized, accessor-backed and nonpassive configuration without reflecting contents", () => {
  let called = false;
  const getter = { get label() { called = true; return "Fixture label"; } };
  const cycle: Record<string, unknown> = {};
  cycle.label = cycle;
  const largeMap = Object.fromEntries(Array.from({ length: 33 }, (_, index) => [`field-${index}`, index]));
  const sparse = new Array(3);
  for (const values of [getter, cycle, largeMap, { label: "x".repeat(1025) }, { items: sparse },
    { apiKey: "synthetic denied field" }, JSON.parse('{"__proto__":{"test":true}}'), { password: "test-fixture" },
    { field: Number.POSITIVE_INFINITY }, { field: undefined }]) {
    assert.deepEqual(parseHeadlessSemanticBatchRequest({ ...request, input: { ...input,
      edits: [{ kind: "configure", instanceId: "fixture.node", values }],
    } }, host), invalid);
  }
  assert.equal(called, false);
});
