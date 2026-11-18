import assert from "node:assert/strict";
import test from "node:test";
import {createOrganizationId} from "../../../../contracts/organization";
import {createWorkspaceId} from "../../../../contracts/workspace";
import {HEADLESS_CONTRACT_VERSION as version, type HeadlessContextRebuildRequest,
  type HeadlessHostIncarnationId} from "../../../../contracts/headless";
import {ReadHeadlessContextRebuildUseCase} from "../headless-context-rebuild.use-case";

function fixture() {
  const workspaceId = createWorkspaceId("workspace.synthetic"), organizationId = createOrganizationId("org.synthetic");
  const reference = {workspaceId, contextId: "317d5bb8-9cf8-4245-8c64-d37910c9cfa6",
    taskId: "98861a77-36ee-4691-975f-8c8677257d1e", kind: "markdown-context-pack" as const, artifactDigest: "sha256:" + "a".repeat(64)};
  const request: HeadlessContextRebuildRequest = {version, operation: "context.preview-rebuild", input: {
    hostIncarnationId: "4bad63da-cf35-4a3f-aad3-b00c4c4eca40" as HeadlessHostIncarnationId, workspaceId, reference}};
  const value = {reference: {...reference}, preview: {workspaceId, name: "Synthetic Context", sources: [{reference: {
    kind: "ingestion-file", taskId: "source.task", fileId: "source.file", taskRevision: 1},
    digest: "sha256:" + "b".repeat(64), sizeBytes: 20, format: "csv", licenseStatus: "unknown"}],
    settings: {kind: "markdown-context-pack", chunkCharacters: 512, overlapCharacters: 0, maximumChunks: 100,
      textFields: ["text"], cleaningPreset: "standard"}, totalBytes: 20,
    runtimeReadiness: "not-checked", approvalRequired: true, reviewRequired: true, modelCalls: 0, externalProviderCalls: 0},
    byteAvailability: "not-checked"};
  let current = true, allowed = true, calls = 0;
  const authority = {context: {workspaceId, organizationId, principalId: "principal.synthetic"},
    clientId: "5d8bb953-c587-44bc-a395-5c5b59e35675", isCurrent: () => current, stillAllowed: async () => allowed};
  const useCase = new ReadHeadlessContextRebuildUseCase(async () => {calls++; return value;});
  return {request, value, authority, useCase, calls: () => calls,
    revoke: () => {current = false;}, deny: () => {allowed = false;}};
}

test("rebuild preview returns validated metadata under current authority without an execution owner", async () => {
  const f = fixture();
  assert.deepEqual(await f.useCase.execute(f.request, f.authority), {ok: true, operation: f.request.operation, value: f.value});
  assert.equal(f.calls(), 1);
});

test("rebuild denies missing current resource/client/workspace authority before its metadata callback", async () => {
  const f = fixture();
  assert.deepEqual(await f.useCase.execute(f.request, {...f.authority, clientId: "unknown"}), {ok: false, code: "headless.forbidden"});
  assert.deepEqual(await f.useCase.execute(f.request, {...f.authority, context: {...f.authority.context,
    workspaceId: createWorkspaceId("workspace.other")}}), {ok: false, code: "headless.forbidden"});
  f.deny();
  assert.deepEqual(await f.useCase.execute(f.request, f.authority), {ok: false, code: "headless.forbidden"});
  assert.equal(f.calls(), 0);
});

test("rebuild denies a late permission withdrawal or revoked host before returning data", async () => {
  for (const reason of ["permission", "host"] as const) {
    const f = fixture();
    const owner = new ReadHeadlessContextRebuildUseCase(async () => {
      if (reason === "permission") f.deny(); else f.revoke();
      return f.value;
    });
    assert.deepEqual(await owner.execute(f.request, f.authority), {ok: false, code: "headless.forbidden"});
  }
});

test("rebuild copies caller inputs before awaits and freezes the selected reference", async () => {
  const f = fixture(), expected = structuredClone(f.request);
  const owner = new ReadHeadlessContextRebuildUseCase(async request => {
    assert.deepEqual(request, expected);
    assert.equal(Object.isFrozen(request.input.reference), true);
    return f.value;
  });
  const pending = owner.execute(f.request, f.authority);
  (f.request.input.reference as {artifactDigest: string}).artifactDigest = "sha256:" + "c".repeat(64);
  assert.deepEqual(await pending, {ok: true, operation: expected.operation, value: f.value});
});

test("rebuild hides unavailable history, malformed replies and private exceptions", async () => {
  const f = fixture();
  const absent = new ReadHeadlessContextRebuildUseCase(async () => undefined);
  assert.deepEqual(await absent.execute(f.request, f.authority), {ok: false, code: "headless.not-found"});
  const forged = new ReadHeadlessContextRebuildUseCase(async () => ({...f.value, privatePath: "synthetic-private-detail"}));
  assert.deepEqual(await forged.execute(f.request, f.authority), {ok: false, code: "headless.unavailable"});
  const failed = new ReadHeadlessContextRebuildUseCase(async () => {throw new Error("synthetic private runtime path");});
  assert.deepEqual(await failed.execute(f.request, f.authority), {ok: false, code: "headless.unavailable"});
});
