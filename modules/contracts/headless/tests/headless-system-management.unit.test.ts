import assert from "node:assert/strict";
import { test } from "node:test";
import { HEADLESS_CONTRACT_VERSION, HEADLESS_MAX_BUILD_PLAN_STEPS, isHeadlessHostIncarnationId,
  parseHeadlessBuildPlanProposal, parseHeadlessSystemManagementRequest } from "../index";

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

const proposalScope = { hostIncarnationId: input.hostIncarnationId, workspaceId: input.workspaceId };
const createStep = {
  operation: "systems.create", name: input.name, idempotencyKey: input.idempotencyKey,
  templateId: "reference.secured-data-review@1.0.0",
};
const savedStep = {
  name: "Second proposal", systemId: existing.systemId, baseRecordRevision: existing.baseRecordRevision,
  baseRevisionId: existing.baseRevisionId, idempotencyKey: "3a6112ce-ab8a-456f-876f-64730ff719df",
};
const parseProposal = (value: unknown) => {
  if (!isHeadlessHostIncarnationId(host)) throw new Error("Invalid fixture host");
  return parseHeadlessBuildPlanProposal(value, host);
};

test("derives detached, canonical preview and exact scoped requests from ordered steps", () => {
  const clone = { operation: "systems.clone", ...savedStep };
  const renamed = { ...savedStep, operation: "systems.rename",
    idempotencyKey: "997b544a-47c5-4910-84cc-d1757b6dedd0", description: "A proposed description." };
  const steps = [{ ...createStep }, clone, renamed];
  const parsed = parseProposal({ ...proposalScope, steps });
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  const expected = steps.map(({ operation, ...fields }) => request(operation, { ...proposalScope, ...fields }));
  assert.deepEqual(parsed.requests, expected);
  assert.deepEqual(parsed.preview, {
    version: "aisb-build-plan-preview-v1", ...proposalScope, approval: "required",
    steps: steps.map(({ operation, ...fields }) => ({
      operation, input: fields, effect: "saved-system-write", externalProviderCalls: 0,
    })),
  });
  const fieldOrder = steps.map(step => Object.fromEntries(Object.entries(step).reverse()));
  const reorderedFields = parseProposal({ steps: fieldOrder, ...proposalScope });
  assert.equal(reorderedFields.ok && JSON.stringify(reorderedFields.preview), JSON.stringify(parsed.preview));
  steps[0].name = "Changed caller-owned data";
  assert.deepEqual(parsed.requests, expected);
  assert.equal(parsed.preview.steps[0].input.name, input.name);
});

test("rejects forged scope or approval, reused keys, invalid order, and oversized or nonpassive proposals", () => {
  const clone = { operation: "systems.clone", ...savedStep };
  const renamed = { ...savedStep, operation: "systems.rename",
    idempotencyKey: "997b544a-47c5-4910-84cc-d1757b6dedd0" };
  let accessed = false;
  const getter = { ...createStep, get name() { accessed = true; return "Fixture"; } };
  for (const steps of [
    [],
    Array(HEADLESS_MAX_BUILD_PLAN_STEPS + 1).fill(createStep),
    [createStep, { ...clone, idempotencyKey: createStep.idempotencyKey }],
    [renamed, clone],
    [{ ...createStep, workspaceId: "other-workspace" }],
    [{ ...createStep, hostIncarnationId: input.hostIncarnationId }],
    [{ ...createStep, approval: "approved" }],
    [{ ...createStep, operation: "systems.archive" }],
    [getter],
  ]) assert.deepEqual(parseProposal({ ...proposalScope, steps }), invalid);
  assert.deepEqual(parseProposal({ ...proposalScope, steps: [createStep], approver: "claimed" }), invalid);
  assert.deepEqual(parseProposal({ ...proposalScope, hostIncarnationId: savedStep.idempotencyKey, steps: [createStep] }),
    { ok: false, code: "headless.host-changed" });
  assert.equal(accessed, false);
});

test("accepts an exact local file save only for an enabled host and keeps system-only previews byte stable", () => {
  assert.ok(isHeadlessHostIncarnationId(host));
  const opts = { allowLocalFileSave: true } as const;
  const staged = { operation: "data.save-local-source", taskId: "ingestion.selected", fileId: "file.selected", taskRevision: 2,
    idempotencyKey: "2810d2a4-726e-44d2-9553-db28a43d767c" };
  const mixed = { ...proposalScope, steps: [staged, createStep] };
  assert.deepEqual(parseHeadlessBuildPlanProposal(mixed, host), invalid);
  assert.deepEqual(parseHeadlessBuildPlanProposal(mixed, host, { allowLocalFileSave: false }), invalid);
  const parsed = parseHeadlessBuildPlanProposal(mixed, host, opts);
  assert.ok(parsed.ok);
  assert.equal(parsed.preview.version, "aisb-build-plan-preview-v2");
  const { operation, ...fields } = staged;
  assert.deepEqual(parsed.preview.steps[0], { operation, input: fields, effect: "save-local-source", externalProviderCalls: 0 });
  assert.deepEqual(parsed.requests[0], request(operation, { ...proposalScope, ...fields }));
  const old = { ...proposalScope, steps: [createStep] };
  assert.equal(JSON.stringify(parseHeadlessBuildPlanProposal(old, host, opts)), JSON.stringify(parseHeadlessBuildPlanProposal(old, host)));
  for (const steps of [
    [{ ...staged, path: "unrequested" }],
    [{ ...staged, taskRevision: 0 }],
    [{ ...staged, taskRevision: Number.MAX_SAFE_INTEGER }],
    [{ ...staged, fileBytes: 10 }],
    [{ ...staged, idempotencyKey: createStep.idempotencyKey }, createStep],
    [staged, { ...staged, idempotencyKey: savedStep.idempotencyKey }],
    [staged, { ...staged, fileId: "file.sibling", idempotencyKey: savedStep.idempotencyKey }],
  ]) assert.deepEqual(parseHeadlessBuildPlanProposal({ ...proposalScope, steps }, host, opts), invalid);
});
