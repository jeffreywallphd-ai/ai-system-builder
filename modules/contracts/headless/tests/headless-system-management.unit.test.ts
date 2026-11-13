import assert from "node:assert/strict";
import { test } from "node:test";
import { HEADLESS_CONTRACT_VERSION, isHeadlessHostIncarnationId, parseHeadlessSystemManagementRequest } from "../index";

const host = "41a96fc3-d2b8-4414-bd29-00059badc72d";
assert.ok(isHeadlessHostIncarnationId(host));
const input = {
  hostIncarnationId: host, workspaceId: "fixture-workspace", name: "Example system",
  idempotencyKey: "a6f56324-2051-462c-b45b-d9b49bf6dd4a",
};
const existing = { ...input, systemId: "fixture-system", baseRecordRevision: 5, baseRevisionId: "fixture-system.r3" };
const request = (operation: string, data: Record<string, unknown>) => ({ version: HEADLESS_CONTRACT_VERSION, operation, input: data });
const parse = (value: unknown) => {
  if (!isHeadlessHostIncarnationId(host)) throw new Error("Invalid fixture host");
  return parseHeadlessSystemManagementRequest(value, host);
};
const invalid = { ok: false, code: "headless.invalid-request" };

test("admits only exact known creation, rename, and clone forms with detached input", () => {
  for (const candidate of [
    request("systems.create", { ...input, templateId: "reference.secured-data-review@1.0.0" }),
    request("systems.rename", { ...existing, description: "A synthetic description." }),
    request("systems.clone", existing),
  ]) {
    const result = parse(candidate);
    assert.deepEqual(result, { ok: true, request: candidate });
    assert.ok(result.ok);
    assert.notEqual(result.request.input, candidate.input);
  }
});

test("refuses authority claims, loose identities, unsupported operations, and nonpassive fields", () => {
  let accessed = false;
  const getter = { ...existing, get name() { accessed = true; return "Fixture"; } };
  for (const [operation, data] of [
    ["systems.create", { ...input, templateId: "reference.secured-data-review@latest" }],
    ["systems.create", { ...input, templateId: " reference.secured-data-review@1.0.0" }],
    ["systems.create", { ...input, templateId: "reference.secured-data-review@1.0.0", actorId: "spoofed" }],
    ["systems.rename", { ...existing, organizationId: "spoofed" }],
    ["systems.rename", { ...existing, description: "x".repeat(1_001) }],
    ["systems.rename", { ...existing, name: " leading whitespace" }],
    ["systems.rename", { ...existing, baseRecordRevision: 0 }],
    ["systems.rename", { ...existing, baseRevisionId: " fixture-system.r3" }],
    ["systems.rename", { ...existing, idempotencyKey: "loose-key" }],
    ["systems.rename", getter],
    ["systems.clone", { ...input, systemId: "fixture-system" }],
    ["systems.clone", { ...existing, clientId: "spoofed" }],
    ["systems.archive", existing],
  ] as const) {
    assert.deepEqual(parse(request(operation, data)), invalid);
  }
  assert.equal(accessed, false);
});

test("distinguishes valid requests addressed to a previous host or contract", () => {
  const candidate = request("systems.clone", existing);
  assert.deepEqual(parse({ ...candidate, input: { ...existing, hostIncarnationId: "3a6112ce-ab8a-456f-876f-64730ff719df" } }),
    { ok: false, code: "headless.host-changed" });
  assert.deepEqual(parse({ ...candidate, version: "headless.v999" }),
    { ok: false, code: "headless.unsupported-version" });
});
