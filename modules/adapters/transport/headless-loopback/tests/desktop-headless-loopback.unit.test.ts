import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { request } from "node:https";
import { connect } from "node:net";
import { setTimeout as delay } from "node:timers/promises";
import { test } from "node:test";
import { createOrganizationId } from "../../../../contracts/organization";
import { normalizeIngestionTaskFileId, normalizeIngestionTaskId } from "../../../../contracts/ingestion";
import { createWorkspaceId } from "../../../../contracts/workspace";
import { HEADLESS_APPROVED_TURN_OPERATION, HEADLESS_APPROVED_TURN_PATH, HEADLESS_CONTRACT_VERSION, HEADLESS_PLAN_REVIEW_PATH,
  HEADLESS_LOCAL_FILE_PREVIEW_PATH, HEADLESS_WINDOW_CONTROL_PATH, UI_CONTROL_VERSION, isHeadlessHostIncarnationId, parseHeadlessBuildPlanProposal,
  readHeadlessPlanReviewAgentResult, type DesktopHeadlessClientAccess } from "../../../../contracts/headless";
import {HEADLESS_MODEL_TASK_CONTROL_PATH} from "../../../../contracts/headless";
import { createInMemoryStructuredDocumentStore } from "../../../persistence/shared";
import { createStructuredHeadlessPlanReviewRepository } from "../../../persistence/system-builder/createStructuredHeadlessPlanReviewRepository";
import { createDesktopHeadlessClientAuthority } from "../../../security/headless";
import { createDesktopPinnedLoopbackAgent, startDesktopHeadlessLoopback } from "../index";
import { createHuggingFaceModelBrowseDetailsAdapter } from "../../../model/huggingface";
import { composeDesktopHeadlessReads } from "../../../../hosts/desktop/composition/composeDesktopHeadlessReads";
import { composeHeadlessModelSourcePreview } from "../../../../hosts/shared/composition/headlessModelSourcePreview";

const workspaceId = createWorkspaceId("loopback-fixture-workspace");
const organizationId = createOrganizationId("loopback-fixture-org");
const identity = { organizationId, principalId: "loopback-fixture-user" };
const incarnation = "f06f4016-f0ee-43fa-808f-09f815df8d6b";
assert.ok(isHeadlessHostIncarnationId(incarnation));
const describe = JSON.stringify({ version: HEADLESS_CONTRACT_VERSION, operation: "host.describe", input: {} });
const readPath = "/aisb-headless/v1/read";
const pairPath = "/aisb-headless/v1/pair";
const authorPath = "/aisb-headless/v1/author";

test("disconnecting a held source read denies lazy SDK, credentials and provider work", {timeout: 12_000}, async () => {
  const documents = createInMemoryStructuredDocumentStore().forOrganization(organizationId);
  const registry = createDesktopHeadlessClientAuthority({documents, identity, canReadWorkspace: async () => true,
    canReviewPlans: async () => true, allowNewModelSourcePairings: true});
  const pending = await registry.beginPairing(workspaceId, () => true, "plan-review");
  assert.equal(pending.status, "ready");
  const paired = await registry.completePairing(pending.pairingCode);
  assert.equal(paired.status, "paired");
  let entered!: () => void, resume!: () => void, finished!: () => void;
  const checking = new Promise<void>(resolve => {entered = resolve;});
  const released = new Promise<void>(resolve => {resume = resolve;});
  const settled = new Promise<void>(resolve => {finished = resolve;});
  const counts = {owners: 0, sdk: 0, keys: 0, requests: 0};
  const provider = createHuggingFaceModelBrowseDetailsAdapter({officialHubClientLoader: async () => {
    counts.sdk++; throw new Error("A disconnected read must not initialize the SDK.");
  }, accessTokenProvider: () => {counts.keys++; return undefined;}});
  const owner = composeHeadlessModelSourcePreview(documents, provider);
  const reader = composeDesktopHeadlessReads({hostIncarnationId: incarnation, identity, isOpen: () => true,
    workspaceRepository: {async readWorkspace() {return {workspaceId, organizationId, displayName: "Source test",
      status: "active", createdAt: "2026-11-19T00:00:00.000Z", updatedAt: "2026-11-19T00:00:00.000Z"};}},
    authorization: {async authorizeWorkspaceOperation(input) {
      if (input.requiredScopes?.includes("provider-credential:use")) {entered(); await released;}
    }},
    getUseCases() {assert.fail("Source reads must not open System Builder.");},
    async getModelSource() {counts.owners++; return owner;},
  });
  let readCurrent: (() => boolean) | undefined;
  let result: unknown;
  const connector = await startDesktopHeadlessLoopback({registrations: registry,
    planReview: {hostIncarnationId: incarnation, async execute() {return {ok: false, code: "headless.forbidden"};}},
    async read(raw, getGrant) {
      try {
        result = await reader(raw, async () => {
          const grant = await getGrant(); readCurrent = grant?.isReadCurrent; return grant;
        });
        return result as Awaited<ReturnType<typeof reader>>;
      } finally {finished();}
    },
  });
  const agent = createDesktopPinnedLoopbackAgent(connector.endpoint, connector.fingerprint);
  const previousFetch = globalThis.fetch;
  globalThis.fetch = (async () => {counts.requests++; throw new Error("No provider request is authorized.");}) as typeof fetch;
  const body = JSON.stringify({version: HEADLESS_CONTRACT_VERSION, operation: "models.preview-source", input: {
    hostIncarnationId: incarnation, workspaceId, modelId: "Qwen/synthetic-model", revision: "a".repeat(40)}});
  const client = request(new URL(readPath, connector.endpoint), {method: "POST", agent,
    headers: {"Content-Type": "application/json", "Content-Length": Buffer.byteLength(body), Authorization: "Bearer " + paired.credential}});
  const closed = new Promise<void>(resolve => {client.once("close", resolve);});
  client.on("error", () => {});
  client.setTimeout(8_000, () => client.destroy());
  client.end(body);
  try {
    await Promise.race([checking, closed.then(() => {throw new Error("Fixture closed before entering source authorization.");})]);
    assert.equal(readCurrent?.(), true);
    client.destroy(); await closed;
    const until = Date.now() + 2_000;
    while (readCurrent?.() && Date.now() < until) await delay(5);
    assert.equal(readCurrent?.(), false);
    resume(); await settled;
    assert.deepEqual(result, {ok: false, code: "headless.forbidden"});
    assert.deepEqual(counts, {owners: 0, sdk: 0, keys: 0, requests: 0});
    assert.ok(await registry.verifyCredential(paired.credential));
  } finally {
    resume(); client.destroy(); agent.destroy();
    await connector.close(); registry.close(); globalThis.fetch = previousFetch;
  }
});

test("a changed dataset preparation source returns a conflict through the pinned read route", async () => {
  const registry = createDesktopHeadlessClientAuthority({
    documents: createInMemoryStructuredDocumentStore().forOrganization(organizationId), identity,
    canReadWorkspace: async target => target === workspaceId,
    canReviewPlans: async target => target === workspaceId,
  });
  const connector = await startDesktopHeadlessLoopback({registrations: registry,
    planReview: {hostIncarnationId: incarnation, async execute() {return {ok: false, code: "headless.forbidden"};}},
    async read(_raw, getGrant) {
      return (await getGrant())?.planReview ? {ok: false, code: "headless.stale"} : {ok: false, code: "headless.forbidden"};
    },
  });
  try {
    const pending = await registry.beginPairing(workspaceId, () => true, "plan-review");
    assert.equal(pending.status, "ready");
    const paired = await post(connector, pairPath, JSON.stringify({pairingCode: pending.pairingCode}));
    assert.ok(paired.json.value?.credential);
    const result = await post(connector, readPath, JSON.stringify({version: HEADLESS_CONTRACT_VERSION,
      operation: "data.preview-dataset-preparation", input: {hostIncarnationId: incarnation, workspaceId,
        sources: [{taskId: "source-task", fileId: "source-file", taskRevision: 1}],
        recipe: {kind: "provided-instruction-rows-v1", inputColumn: "question", outputColumn: "answer"},
        split: {trainRatio: 0.8, validationRatio: 0.1, testRatio: 0.1, seed: 42}, qualityPreset: "recommended"},
    }), {Authorization: "Bearer " + paired.json.value.credential});
    assert.equal(result.status, 409);
    assert.deepEqual(result.json, {ok: false, code: "headless.stale"});
  } finally {await connector.close();}
});

function post(connector: { endpoint: string; fingerprint: string }, path: string, body: string, headers: Record<string, string> = {}) {
  return new Promise<{
    status: number;
    cacheControl?: string;
    json: { ok: boolean; code?: string; value?: { credential?: string; registeredClientId?: string } };
  }>((resolve, reject) => {
    const req = request(new URL(path, connector.endpoint), {
      method: "POST",
      headers: { "Content-Length": String(Buffer.byteLength(body)), "Content-Type": "application/json", ...headers },
      agent: createDesktopPinnedLoopbackAgent(connector.endpoint, connector.fingerprint),
    }, (res) => {
      let text = "";
      res.setEncoding("utf8");
      res.on("data", (part: string) => { text += part; });
      res.on("error", reject);
      res.on("end", () => {
        try {
          resolve({ status: res.statusCode!, cacheControl: res.headers["cache-control"], json: JSON.parse(text) });
        } catch (error) {
          reject(error);
        }
      });
    });
    req.setTimeout(8_000, () => req.destroy(new Error("Fixture response timed out.")));
    req.on("error", reject);
    req.end(body);
  });
}

function registrations() {
  return createDesktopHeadlessClientAuthority({
    documents: createInMemoryStructuredDocumentStore().forOrganization(organizationId),
    identity,
    canReadWorkspace: async (id) => id === workspaceId,
  });
}

test("pinned model cancellation is separate, plan-client scoped and validates finite owner acknowledgements", {timeout: 12_000}, async () => {
  const registry = createDesktopHeadlessClientAuthority({documents: createInMemoryStructuredDocumentStore().forOrganization(organizationId),
    identity, canReadWorkspace: async id => id === workspaceId, canReviewPlans: async id => id === workspaceId});
  const input = {hostIncarnationId: incarnation, workspaceId, selection: {kind: "plan-step", fingerprint: "a".repeat(64), step: 1}};
  const command = {version: HEADLESS_CONTRACT_VERSION, operation: "models.cancel-download", input};
  const value = {workspaceId, taskId: incarnation, plan: {fingerprint: "a".repeat(64), step: 1}, state: "running", percent: null,
    cancellationAccepted: true, registration: "requires-separate-approval", runtimeReadiness: "not-checked"};
  let calls = 0, mode = "valid", operationCurrent: (() => boolean) | undefined, asyncCurrent = false;
  const connector = await startDesktopHeadlessLoopback({registrations: {completePairing: registry.completePairing,
    async verifyCredential(credential) {
      const grant = await registry.verifyCredential(credential);
      return grant && asyncCurrent ? {...grant, isCurrent: (() => Promise.reject(new Error("private currentness"))) as never} : grant;
    }},
    read: async () => ({ok: false, code: "headless.forbidden"}),
    planReview: {hostIncarnationId: incarnation, execute: async () => ({ok: false, code: "headless.forbidden"})},
    modelTaskControl: {hostIncarnationId: incarnation, async execute(request, grant) {
      calls++; assert.deepEqual(request, command); assert.equal(grant.planReview, true);
      operationCurrent = grant.isOperationCurrent; assert.equal(operationCurrent?.(), true);
      if (mode === "throw") throw new Error("private/model/path");
      if (mode.startsWith("headless.")) return {ok: false, code: mode} as never;
      if (mode === "withdraw") registry.close();
      return {ok: true, operation: "models.cancel-download", value: {...value,
        ...(mode === "extra" ? {privatePath: "private/model/path"} : {}),
        ...(mode === "plan" ? {plan: {fingerprint: "b".repeat(64), step: 1}} : {})}} as never;
    }}});
  try {
    const pair = async (access: DesktopHeadlessClientAccess) => {
      const pending = await registry.beginPairing(workspaceId, () => true, access); assert.equal(pending.status, "ready");
      const paired = await post(connector, pairPath, JSON.stringify({pairingCode: pending.pairingCode}));
      assert.ok(paired.json.value?.credential); return {Authorization: "Bearer " + paired.json.value.credential};
    };
    const reader = await pair("read"), planner = await pair("plan-review");
    const control = (body: unknown = command, headers = planner) => post(connector, HEADLESS_MODEL_TASK_CONTROL_PATH, JSON.stringify(body), headers);
    asyncCurrent = true; assert.equal((await control()).status, 403); asyncCurrent = false;
    assert.equal(calls, 0);
    assert.equal((await control(command, reader)).status, 403); assert.equal(calls, 0);
    assert.equal((await control({...command, transient: {action: "private"}})).status, 400);
    assert.equal((await control({...command, input: {...input, workspaceId: createWorkspaceId("workspace.foreign")}})).status, 403);
    assert.equal(calls, 0);
    const accepted = await control(); assert.equal(accepted.status, 200); assert.equal(accepted.cacheControl, "no-store");
    assert.deepEqual(accepted.json, {ok: true, operation: "models.cancel-download", value});
    assert.equal(operationCurrent?.(), false, "The response lifetime is not retained as task custody.");
    for (const next of ["extra", "plan", "throw", "headless.invalid-request", "headless.unsupported-operation", "headless.host-changed"]) {
      mode = next; const result = await control(); assert.equal(result.status, 503);
      assert.deepEqual(result.json, {ok: false, code: "headless.operation-unconfirmed"});
      assert.doesNotMatch(JSON.stringify(result.json), /private\/model/);
    }
    mode = "withdraw"; assert.equal((await control()).status, 403); assert.equal(calls, 8);
  } finally {registry.close(); await connector.close();}
});

test("the paired Desktop preview route rejects app actions, foreign grants and withdrawn replies", { timeout: 12_000 }, async () => {
  const registry = createDesktopHeadlessClientAuthority({
    documents: createInMemoryStructuredDocumentStore().forOrganization(organizationId), identity,
    canReadWorkspace: async target => target === workspaceId,
    canReviewPlans: async target => target === workspaceId,
  });
  const target = { hostIncarnationId: incarnation, workspaceId, taskId: normalizeIngestionTaskId("ingestion.source"),
    fileId: normalizeIngestionTaskFileId("file.source"), taskRevision: 3 };
  const request = { version: HEADLESS_CONTRACT_VERSION, operation: "data.prepare-local-file", input: target };
  const value = { workspaceId, taskId: target.taskId, fileId: target.fileId, taskRevision: target.taskRevision,
    mediaType: "text/csv", fileBytes: 64, checkpointExpiresAt: Date.now() + 60_000,
    effect: "save-local-source" as const, externalProviderCalls: 0 as const };
  let release = true;
  let responseShape = true;
  let stale = false;
  let reads = 0;
  const connector = await startDesktopHeadlessLoopback({
    registrations: registry,
    async read() { return { ok: false, code: "headless.forbidden" }; },
    planReview: { hostIncarnationId: incarnation, async execute() { return { ok: false, code: "headless.forbidden" }; } },
    dataPreview: { hostIncarnationId: incarnation, async execute(input, grant) {
      reads++;
      assert.deepEqual(input.input, target);
      assert.equal(grant.planReview, true);
      if (stale) return { result: { ok: false, code: "headless.stale" },
        publishIfCurrent: async publish => release && publish() };
      return { result: { ok: true, value: { ...value, ...(responseShape ? {} : { fileName: "synthetic-private-name.csv" }) } },
        publishIfCurrent: async publish => release && publish() };
    } },
  });
  try {
    async function credentials(mode: DesktopHeadlessClientAccess) {
      const pending = await registry.beginPairing(workspaceId, () => true, mode);
      assert.equal(pending.status, "ready");
      const paired = await post(connector, pairPath, JSON.stringify({ pairingCode: pending.pairingCode }));
      assert.equal(paired.status, 200);
      assert.ok(paired.json.value?.credential);
      return { Authorization: "Bearer " + paired.json.value.credential };
    }
    const readOnly = await credentials("read");
    const review = await credentials("plan-review");
    const local = (value: object, headers = review) =>
      post(connector, HEADLESS_LOCAL_FILE_PREVIEW_PATH, JSON.stringify(value), headers);
    assert.equal((await local(request, readOnly)).status, 403);
    assert.equal((await local({ ...request, operation: "data.select-local-file" })).status, 400);
    assert.equal((await local({ ...request, input: { ...target, bytes: [1] } })).status, 400);
    assert.equal((await local({ ...request, input: { ...target, workspaceId: createWorkspaceId("workspace.foreign") } })).status, 403);
    assert.equal(reads, 0);
    assert.deepEqual((await local(request)).json, { ok: true, value });
    release = false;
    assert.deepEqual((await local(request)).json, { ok: false, code: "headless.forbidden" });
    release = true;
    responseShape = false;
    assert.deepEqual((await local(request)).json, { ok: false, code: "headless.unavailable" });
    stale = true;
    assert.deepEqual((await local(request)).json, { ok: false, code: "headless.stale" });
    release = false;
    assert.deepEqual((await local(request)).json, { ok: false, code: "headless.forbidden" });
    assert.equal(reads, 5);
  } finally {
    registry.close();
    await connector.close();
  }
});

test("the pinned desktop plan-review route admits stage and status only for a dedicated current grant", { timeout: 12_000 }, async () => {
  const documents = createInMemoryStructuredDocumentStore();
  const registry = createDesktopHeadlessClientAuthority({
    documents: documents.forOrganization(organizationId), identity,
    canReadWorkspace: async target => target === workspaceId,
    canReviewPlans: async target => target === workspaceId,
    canAuthorWorkspace: async target => target === workspaceId,
  });
  const proposals = createStructuredHeadlessPlanReviewRepository(documents, async (_owner, target) =>
    target.scope.organizationId === organizationId && target.scope.principalId === identity.principalId &&
    target.scope.workspaceId === workspaceId);
  let retiredAgent: string | undefined;
  let retireBeforeReply = false;
  let malformedReply = false;
  let expireBeforeReply = false;
  let replyDeadline: number | undefined;
  let retireBeforeDispatch = false;
  let verifierPasses = 0;
  let liveDuringDispatch = true;
  let planCalls = 0;
  let editCalls = 0;
  const connector = await startDesktopHeadlessLoopback({
    registrations: {
      ...registry,
      async verifyCredential(credential) {
        const grant = await registry.verifyCredential(credential);
        if (!grant?.planReview) return grant;
        if (replyDeadline !== undefined) {
          const remaining = replyDeadline - Date.now();
          if (remaining >= 0) await delay(remaining + 1);
        }
        if (!retireBeforeDispatch) return grant;
        const pass = ++verifierPasses;
        return { ...grant, isCurrent() {
          if (pass === 2) queueMicrotask(() => { liveDuringDispatch = false; });
          return liveDuringDispatch && grant.isCurrent();
        } };
      },
    },
    async read() { return { ok: false, code: "headless.forbidden" }; },
    authoring: { hostIncarnationId: incarnation, async execute() {
      editCalls++;
      return { ok: false, code: "headless.unavailable" };
    } },
    planReview: { hostIncarnationId: incarnation, async execute(request, grant, currentGrant) {
      planCalls++;
      assert.equal(grant.planReview, true);
      assert.ok(await currentGrant());
      const { hostIncarnationId, workspaceId, fingerprint } = request.target;
      const query = { target: { hostIncarnationId, fingerprint, scope: {
        workspaceId, organizationId: grant.organizationId, principalId: grant.principalId, registeredClientId: grant.registeredClientId,
      } }, isCurrent: () => grant.isCurrent?.() === true };
      const stored = request.operation === "plan.submit" ? await proposals.propose({ ...query, proposal: {
        hostIncarnationId, workspaceId,
        steps: request.proposal.preview.steps.map(({ operation, input }) => ({ operation, ...input })),
      } }) : await proposals.read(query);
      if (!stored.ok) return stored.code === "invalid" ? { ok: false, code: "headless.invalid-request" } :
        { ok: false, code: "headless.forbidden" };
      if (retireBeforeReply) {
        assert.equal(retiredAgent, grant.registeredClientId);
        assert.equal(await registry.revokeClient(grant.registeredClientId), true);
      }
      const { revision, stepCount, approvedSteps, status, expiresAt } = stored.snapshot.state;
      if (expireBeforeReply) replyDeadline = Date.now() + (retireBeforeReply ? -1 : 25);
      return { ok: true, value: { fingerprint, revision, stepCount, approvedSteps, status, expiresAt: replyDeadline ?? expiresAt,
        ...(malformedReply ? { actor: "synthetic unexpected field" } : {}) } };
    } },
  });
  try {
    async function pair(mode: DesktopHeadlessClientAccess) {
      const pending = await registry.beginPairing(workspaceId, () => true, mode);
      assert.equal(pending.status, "ready");
      const result = await post(connector, pairPath, JSON.stringify({ pairingCode: pending.pairingCode }));
      assert.equal(result.status, 200);
      assert.ok(result.json.value?.credential && result.json.value.registeredClientId);
      return { registeredClientId: result.json.value.registeredClientId,
        headers: { Authorization: "Bearer " + result.json.value.credential } };
    }

    const editor = await pair("author");
    const planner = await pair("plan-review");
    retiredAgent = planner.registeredClientId;
    const scope = { hostIncarnationId: incarnation, workspaceId };
    const { operation, ...fields } = {
      operation: "systems.create", name: "Synthetic plan proposal",
      templateId: "reference.secured-data-review@1.0.0",
      idempotencyKey: "3a6112ce-ab8a-456f-876f-64730ff719df",
    };
    const steps = [{ operation, ...fields }];
    const preview = parseHeadlessBuildPlanProposal({ ...scope, steps }, incarnation);
    assert.ok(preview.ok);
    const fingerprint = createHash("sha256").update(JSON.stringify(preview.preview), "utf8").digest("hex");
    const version = HEADLESS_CONTRACT_VERSION;
    const target = { ...scope, fingerprint };
    const planCall = (operation: string, input: unknown, headers: Record<string, string> = planner.headers) =>
      post(connector, HEADLESS_PLAN_REVIEW_PATH, JSON.stringify({ version, operation, input }), headers);
    assert.equal((await planCall("plan.submit", { ...target, steps }, editor.headers)).status, 403);
    assert.equal((await planCall("plan.status", target, {})).status, 403);
    assert.equal((await planCall("plan.approve", target)).status, 400);
    assert.equal((await planCall("plan.submit", { ...target, steps, decision: "approve" })).status, 400);
    assert.equal((await planCall("plan.status", { ...target, workspaceId: "other-workspace" })).status, 403);
    assert.equal((await planCall("plan.status", { ...target, hostIncarnationId: fields.idempotencyKey })).status, 409);
    assert.equal((await planCall("plan.submit", { ...target, steps, extra: "x".repeat(34 * 1024) })).status, 413);
    assert.equal((await post(connector, authorPath, JSON.stringify({ version, operation, input: { ...scope, ...fields } }),
      planner.headers)).status, 403);
    assert.equal(editCalls, 0);
    assert.equal(planCalls, 0);

    const submission = await planCall("plan.submit", { ...target, steps });
    assert.equal(submission.status, 200);
    const staged = readHeadlessPlanReviewAgentResult(submission.json, fingerprint);
    assert.ok(staged.ok && staged.value.status === "pending" && staged.value.revision === 1 && staged.value.approvedSteps === 0);
    assert.deepEqual((await planCall("plan.status", target)).json, submission.json);
    assert.deepEqual((await planCall("plan.submit", { ...target, steps })).json, submission.json);
    const callsBeforeDispatch = planCalls;
    retireBeforeDispatch = true;
    const retiredBeforeDispatch = await planCall("plan.status", target);
    assert.equal(retiredBeforeDispatch.status, 403);
    assert.equal(planCalls, callsBeforeDispatch);
    assert.equal(liveDuringDispatch, false);
    retireBeforeDispatch = false;
    expireBeforeReply = true;
    const expiredBeforeReply = await planCall("plan.status", target);
    assert.equal(expiredBeforeReply.status, 410);
    assert.deepEqual(expiredBeforeReply.json, { ok: false, code: "headless.plan-expired" });
    expireBeforeReply = false;
    replyDeadline = undefined;
    malformedReply = true;
    const malformed = await planCall("plan.status", target);
    assert.equal(malformed.status, 503);
    assert.deepEqual(malformed.json, { ok: false, code: "headless.unavailable" });
    malformedReply = false;
    expireBeforeReply = true;
    retireBeforeReply = true;
    const retired = await planCall("plan.status", target);
    assert.equal(retired.status, 403);
    assert.deepEqual(retired.json, { ok: false, code: "headless.forbidden" });
    assert.equal((await documents.forOrganization(organizationId).listDocuments("headless/system-builder/plan-reviews")).length, 1);
  } finally {
    await connector.close();
  }
});

test("presentation rollback fences pending pairing and window replies without ending existing reads", { timeout: 8_000 }, async () => {
  let presentationOpen = true;
  let holdPairingPublication = false;
  const pairingAdmitted = Promise.withResolvers<void>();
  const releasePairing = Promise.withResolvers<void>();
  const windowAdmitted = Promise.withResolvers<void>();
  const releaseWindow = Promise.withResolvers<void>();
  const registry = createDesktopHeadlessClientAuthority({
    documents: createInMemoryStructuredDocumentStore().forOrganization(organizationId), identity,
    canReadWorkspace: async (id) => id === workspaceId,
    canPresent: async (id) => id === workspaceId && presentationOpen,
  });
  const code = await registry.beginPairing(workspaceId, () => true, "presentation");
  assert.equal(code.status, "ready");
  const paired = await registry.completePairing(code.pairingCode);
  assert.equal(paired.status, "paired");
  const connector = await startDesktopHeadlessLoopback({
    registrations: {
      completePairing: registry.completePairing,
      async verifyCredential(value) {
        const grant = await registry.verifyCredential(value);
        if (!grant?.presentation) return grant;
        if (holdPairingPublication && value !== paired.credential) {
          pairingAdmitted.resolve();
          await releasePairing.promise;
        }
        return { ...grant, isPresentationCurrent: () => presentationOpen && grant.isPresentationCurrent?.() === true };
      },
    },
    async read() { return { ok: true, operation: "host.describe", value: {
      version: HEADLESS_CONTRACT_VERSION, hostIncarnationId: incarnation, workspaces: [workspaceId], operations: ["host.describe"],
    } }; },
    presentation: {
      async execute() { return { ok: true, value: { kind: "windows", windows: [] } }; },
      async authorizePublication() { windowAdmitted.resolve(); await releaseWindow.promise; return true; },
      canPublish: () => true,
    },
  });
  const authorization = { Authorization: "Bearer " + paired.credential };
  try {
    const pendingCode = await registry.beginPairing(workspaceId, () => true, "presentation");
    assert.equal(pendingCode.status, "ready");
    holdPairingPublication = true;
    const pendingPair = post(connector, pairPath, JSON.stringify({ pairingCode: pendingCode.pairingCode }));
    const pendingWindow = post(connector, HEADLESS_WINDOW_CONTROL_PATH, JSON.stringify({ version: UI_CONTROL_VERSION,
      operation: "window.list", input: { hostIncarnationId: incarnation, workspaceId },
    }), authorization);
    await Promise.all([pairingAdmitted.promise, windowAdmitted.promise]);
    presentationOpen = false;
    releasePairing.resolve();
    releaseWindow.resolve();
    for (const reply of await Promise.all([pendingPair, pendingWindow])) {
      assert.equal(reply.status, 403);
      assert.deepEqual(reply.json, { ok: false, code: "headless.forbidden" });
    }
    const existingRead = await post(connector, readPath, describe, authorization);
    assert.equal(existingRead.status, 200);
    assert.equal(existingRead.json.ok, true);
  } finally {
    releasePairing.resolve();
    releaseWindow.resolve();
    await connector.close();
  }
});

test("disconnect does not revoke an admitted conversation task but live registration revocation does", { timeout: 8_000 }, async () => {
  const registry = registrations();
  const pairingCode = await registry.beginPairing(workspaceId);
  assert.equal(pairingCode.status, "ready");
  const pairing = await registry.completePairing(pairingCode.pairingCode);
  assert.equal(pairing.status, "paired");
  let entered!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; });
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  let inspected!: (result: boolean) => void;
  const afterDisconnect = new Promise<boolean>(resolve => { inspected = resolve; });
  let revoked!: (result: boolean) => void;
  const afterRevoke = new Promise<boolean>(resolve => { revoked = resolve; });
  let continueAfterRevoke!: () => void;
  const checked = new Promise<void>(resolve => { continueAfterRevoke = resolve; });
  const connector = await startDesktopHeadlessLoopback({
    registrations: {
      completePairing: registry.completePairing,
      async verifyCredential(credential) {
        const grant = await registry.verifyCredential(credential);
        return grant && { ...grant, conversation: true };
      },
    },
    async read() { return { ok: false, code: "headless.unavailable" }; },
    conversation: {
      hostIncarnationId: incarnation,
      async execute(_input, authority) {
        entered();
        await held;
        inspected(Boolean(await authority.currentGrant()));
        await checked;
        revoked(Boolean(await authority.currentGrant()));
        return { ok: true, value: { turnId: "fixture-turn", runId: "fixture-run" } };
      },
    },
  });
  const body = JSON.stringify({ version: HEADLESS_CONTRACT_VERSION, operation: HEADLESS_APPROVED_TURN_OPERATION, input: {
    hostIncarnationId: incarnation, workspaceId, planId: "fixture-plan", planRevision: "plan-r1",
    sessionId: "fixture-session", snapshotRevision: "snapshot-r1", key: "a6f56324-2051-462c-b45b-d9b49bf6dd4a",
    text: "Synthetic turn",
  } });
  let replies = 0;
  const client = request(new URL(HEADLESS_APPROVED_TURN_PATH, connector.endpoint), {
    method: "POST", agent: createDesktopPinnedLoopbackAgent(connector.endpoint, connector.fingerprint),
    headers: { Authorization: "Bearer " + pairing.credential, "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) },
  }, response => { replies++; response.resume(); });
  client.on("error", () => {});
  const closed = new Promise<void>(resolve => client.once("close", resolve));
  client.end(body);
  try {
    await started;
    client.destroy();
    await closed;
    release();
    assert.equal(await afterDisconnect, true);
    assert.equal(await registry.revokeClient(pairing.registeredClientId), true);
    continueAfterRevoke();
    assert.equal(await afterRevoke, false);
    assert.equal(replies, 0);
  } finally {
    client.destroy();
    release();
    continueAfterRevoke();
    registry.close();
    await connector.close();
  }
});

test("a listener closed in the final grant microtask gap cannot admit a turn", { timeout: 8_000 }, async () => {
  const registry = registrations();
  const code = await registry.beginPairing(workspaceId);
  assert.equal(code.status, "ready");
  const pairing = await registry.completePairing(code.pairingCode);
  assert.equal(pairing.status, "paired");
  let verification = 0;
  let dispatches = 0;
  let stopped: Promise<void> | undefined;
  const connector = await startDesktopHeadlessLoopback({
    registrations: {
      completePairing: registry.completePairing,
      async verifyCredential(credential) {
        const grant = await registry.verifyCredential(credential);
        const checked = ++verification;
        return grant && { ...grant, conversation: true, isCurrent() {
          if (checked === 2 && !stopped) queueMicrotask(() => { stopped ??= connector.close(); });
          return grant.isCurrent();
        } };
      },
    },
    async read() { return { ok: false, code: "headless.unavailable" }; },
    conversation: { hostIncarnationId: incarnation, async execute() {
      dispatches++;
      return { ok: true, value: { turnId: "fixture-turn", runId: "fixture-run" } };
    } },
  });
  try {
    const body = JSON.stringify({ version: HEADLESS_CONTRACT_VERSION, operation: HEADLESS_APPROVED_TURN_OPERATION, input: {
      hostIncarnationId: incarnation, workspaceId, planId: "fixture-plan", planRevision: "plan-r1",
      sessionId: "fixture-session", snapshotRevision: "snapshot-r1", key: "a6f56324-2051-462c-b45b-d9b49bf6dd4a", text: "Synthetic turn",
    } });
    await assert.rejects(post(connector, HEADLESS_APPROVED_TURN_PATH, body, { Authorization: "Bearer " + pairing.credential }));
    assert.ok(stopped);
    await stopped;
    assert.ok(await registry.verifyCredential(pairing.credential));
    assert.equal(dispatches, 0);
  } finally { registry.close(); await connector.close(); }
});

test("the optional pinned authoring route accepts only a current scoped writer and emits a finite result", async () => {
  const registry = registrations();
  const code = await registry.beginPairing(workspaceId);
  assert.equal(code.status, "ready");
  const pairing = await registry.completePairing(code.pairingCode);
  assert.equal(pairing.status, "paired");
  let enabled = false;
  let fenced = false;
  let dispatches = 0;
  let revokeInHandler = false;
  let unexpectedOutput = false;
  let loseFence = false;
  let omitFenceAfterDispatch = false;
  const connector = await startDesktopHeadlessLoopback({
    registrations: {
      completePairing: registry.completePairing,
      async verifyCredential(credential) {
        const grant = await registry.verifyCredential(credential);
        if (!grant) return undefined;
        const { isCurrent: _originalFence, ...identity } = grant;
        return {
          ...identity, authoring: enabled ? ["systems.create"] as const : [],
          ...(loseFence ? {} : { isCurrent: () => !fenced }),
        };
      },
    },
    async read() { return { ok: false, code: "headless.unavailable" }; },
    authoring: {
      hostIncarnationId: incarnation,
      async execute(request, _grant, currentGrant) {
        dispatches++;
        assert.ok(await currentGrant());
        assert.equal(request.operation, "systems.create");
        if (revokeInHandler) fenced = true;
        if (omitFenceAfterDispatch) loseFence = true;
        return { ok: true, value: { kind: "committed", reference: {
          systemId: "fixture-system", revisionId: "fixture-system.r1", recordRevision: 1,
          ...(unexpectedOutput ? { internalField: "fixture diagnostic" } : {}),
        } } };
      },
    },
  });
  const body = {
    version: HEADLESS_CONTRACT_VERSION, operation: "systems.create",
    input: {
      hostIncarnationId: incarnation, workspaceId, name: "Fixture", templateId: "reference.secured-data-review@1.0.0",
      idempotencyKey: "a6f56324-2051-462c-b45b-d9b49bf6dd4a",
    },
  };
  const headers = { Authorization: "Bearer " + pairing.credential };
  try {
    assert.equal((await post(connector, authorPath, JSON.stringify(body), headers)).status, 403);
    enabled = true;
    assert.equal((await post(connector, authorPath, JSON.stringify({ ...body, operation: "systems.archive" }), headers)).status, 400);
    assert.equal((await post(connector, authorPath, JSON.stringify({ ...body, input: { ...body.input,
      workspaceId: "other-fixture-workspace" } }), headers)).status, 403);
    assert.equal(dispatches, 0);
    assert.deepEqual((await post(connector, authorPath, JSON.stringify(body), headers)).json, {
      ok: true, value: { kind: "committed", reference: { systemId: "fixture-system", revisionId: "fixture-system.r1", recordRevision: 1 } },
    });
    unexpectedOutput = true;
    assert.deepEqual((await post(connector, authorPath, JSON.stringify(body), headers)).json, { ok: false, code: "headless.unavailable" });
    unexpectedOutput = false;
    omitFenceAfterDispatch = true;
    assert.deepEqual((await post(connector, authorPath, JSON.stringify(body), headers)).json, { ok: false, code: "headless.forbidden" });
    omitFenceAfterDispatch = false;
    loseFence = false;
    revokeInHandler = true;
    assert.deepEqual((await post(connector, authorPath, JSON.stringify(body), headers)).json, { ok: false, code: "headless.forbidden" });
    assert.equal(dispatches, 4);
  } finally { registry.close(); await connector.close(); }
});

test("the read response is withheld when the final grant fence closes after verification", async () => {
  const registry = registrations();
  const code = await registry.beginPairing(workspaceId);
  assert.equal(code.status, "ready");
  const pairing = await registry.completePairing(code.pairingCode);
  assert.equal(pairing.status, "paired");
  let verifies = 0;
  let checks = 0;
  const connector = await startDesktopHeadlessLoopback({
    registrations: {
      completePairing: registry.completePairing,
      async verifyCredential(credential) {
        const grant = await registry.verifyCredential(credential);
        const ordinal = ++verifies;
        return grant && { ...grant, isCurrent: () => ordinal === 1 || ++checks === 1 };
      },
    },
    async read() { return { ok: false, code: "headless.unavailable" }; },
  });
  try {
    const headers = { Authorization: "Bearer " + pairing.credential };
    assert.equal((await post(connector, authorPath, describe, headers)).status, 404);
    assert.deepEqual((await post(connector, readPath, describe, headers)).json, { ok: false, code: "headless.forbidden" });
    assert.equal(verifies, 2);
    assert.equal(checks, 2);
  } finally { registry.close(); await connector.close(); }
});

test("binds to literal loopback, pairs once and checks the bearer before read dispatch", async () => {
  const registry = registrations();
  let reads = 0;
  const connector = await startDesktopHeadlessLoopback({
    registrations: registry,
    async read(_body, currentGrant) {
      const grant = await currentGrant();
      assert.ok(grant);
      reads++;
      return { ok: true, operation: "host.describe", value: {
        version: HEADLESS_CONTRACT_VERSION, hostIncarnationId: incarnation,
        workspaces: grant.workspaceIds, operations: grant.operations,
      } };
    },
  });
  try {
    const { endpoint } = connector;
    assert.equal(new URL(endpoint).hostname, "127.0.0.1");
    const missing = await post(connector, readPath, describe);
    assert.equal(missing.status, 403);
    assert.equal(missing.json.code, "headless.forbidden");
    assert.equal(reads, 0);
    const pending = await registry.beginPairing(workspaceId);
    assert.equal(pending.status, "ready");
    const pairingBody = JSON.stringify({ pairingCode: pending.pairingCode });
    const paired = await post(connector, pairPath, pairingBody);
    assert.equal(paired.status, 200);
    assert.equal(paired.cacheControl, "no-store");
    const credential = paired.json.value?.credential;
    const clientId = paired.json.value?.registeredClientId;
    assert.ok(credential && clientId);
    assert.equal((await post(connector, pairPath, pairingBody)).status, 403);
    const auth = { Authorization: `Bearer ${credential}` };
    const actual = await post(connector, readPath, describe, auth);
    assert.equal(actual.status, 200);
    assert.equal(actual.cacheControl, "no-store");
    assert.equal(reads, 1);
    assert.equal(await registry.revokeClient(clientId), true);
    assert.equal((await post(connector, readPath, describe, auth)).status, 403);
    assert.equal(reads, 1);
  } finally {
    await connector.close();
  }
  await assert.rejects(post(connector, readPath, describe));
});

test("rejects foreign host and origin, unknown paths and malformed or oversized JSON before dispatch", async () => {
  const registry = registrations();
  let reads = 0;
  const connector = await startDesktopHeadlessLoopback({
    registrations: registry,
    async read() { reads++; return { ok: false, code: "headless.unavailable" }; },
  });
  try {
    const pending = await registry.beginPairing(workspaceId);
    assert.equal(pending.status, "ready");
    const paired = await registry.completePairing(pending.pairingCode);
    assert.equal(paired.status, "paired");
    const auth = { Authorization: `Bearer ${paired.credential}` };
    const { endpoint } = connector;
    const rejectedHeaders: ReadonlyArray<Record<string, string>> = [
      { Host: "other.invalid" },
      { Origin: endpoint },
      { Origin: "null" },
      { "X-Forwarded-Host": new URL(endpoint).host },
    ];
    for (const headers of rejectedHeaders) {
      const result = await post(connector, readPath, describe, { ...auth, ...headers });
      assert.equal(result.status, 403);
      assert.equal(result.json.code, "headless.forbidden");
    }
    assert.equal((await post(connector, readPath + "?extra=1", describe, auth)).status, 404);
    assert.equal((await post(connector, "/aisb-headless/v1/READ", describe, auth)).status, 404);
    for (const body of ["not json", " " + describe, '{"operation":"first","operation":"second"}', "\uFEFF" + describe]) {
      assert.equal((await post(connector, readPath, body, auth)).status, 400);
    }
    assert.equal((await post(connector, readPath, "x".repeat(8193), auth)).status, 413);
    assert.equal((await post(connector, readPath, describe, { ...auth, "Content-Encoding": "gzip" })).status, 400);
    assert.equal(reads, 0);
  } finally {
    await connector.close();
  }
});

test("stops admission and drains in-flight work before reporting closed", { timeout: 10_000 }, async () => {
  const registry = registrations();
  const pending = await registry.beginPairing(workspaceId);
  assert.equal(pending.status, "ready");
  const paired = await registry.completePairing(pending.pairingCode);
  assert.equal(paired.status, "paired");
  let entered!: () => void;
  let resume!: () => void;
  const waiting = new Promise<void>((resolve) => { entered = resolve; });
  const released = new Promise<void>((resolve) => { resume = resolve; });
  const connector = await startDesktopHeadlessLoopback({
    registrations: registry,
    async read(_body, currentGrant) {
      assert.ok(await currentGrant());
      entered();
      await released;
      assert.equal(await currentGrant(), undefined);
      return { ok: false, code: "headless.forbidden" };
    },
  });
  const result = post(connector, readPath, describe, { Authorization: `Bearer ${paired.credential}` })
    .then(() => "response", () => "closed");
  try {
    await waiting;
    let settled = false;
    const closing = connector.close().then(() => { settled = true; });
    assert.equal(await result, "closed");
    assert.equal(settled, false);
    resume();
    await closing;
    assert.equal(settled, true);
  } finally {
    resume();
    await connector.close();
  }
});

test("does not return a read admitted before an exact client revocation", { timeout: 10_000 }, async () => {
  const registry = registrations();
  const pending = await registry.beginPairing(workspaceId);
  assert.equal(pending.status, "ready");
  const paired = await registry.completePairing(pending.pairingCode);
  assert.equal(paired.status, "paired");
  let entered!: () => void;
  let resume!: () => void;
  const waiting = new Promise<void>((resolve) => { entered = resolve; });
  const released = new Promise<void>((resolve) => { resume = resolve; });
  const connector = await startDesktopHeadlessLoopback({
    registrations: registry,
    async read(_body, currentGrant) {
      const captured = await currentGrant();
      assert.ok(captured);
      entered();
      await released;
      return { ok: true, operation: "host.describe", value: {
        version: HEADLESS_CONTRACT_VERSION, hostIncarnationId: incarnation,
        workspaces: captured.workspaceIds, operations: captured.operations,
      } };
    },
  });
  const result = post(connector, readPath, describe, { Authorization: `Bearer ${paired.credential}` });
  try {
    await waiting;
    assert.equal(await registry.revokeClient(paired.registeredClientId), true);
    resume();
    const reply = await result;
    assert.equal(reply.status, 403);
    assert.deepEqual(reply.json, { ok: false, code: "headless.forbidden" });
  } finally {
    resume();
    await connector.close();
    await result.catch(() => {});
  }
});

test("never passes a mid-request scope expansion to the read provider", async () => {
  const registry = registrations();
  const pending = await registry.beginPairing(workspaceId);
  assert.equal(pending.status, "ready");
  const paired = await registry.completePairing(pending.pairingCode);
  assert.equal(paired.status, "paired");
  let checks = 0;
  const connector = await startDesktopHeadlessLoopback({
    registrations: {
      ...registry,
      async verifyCredential(credential) {
        const grant = await registry.verifyCredential(credential);
        if (++checks === 2 || !grant) return grant;
        return { ...grant, operations: ["host.describe"] as const };
      },
    },
    async read(_body, currentGrant) {
      const admitted = await currentGrant();
      return admitted ? { ok: true, operation: "host.describe", value: {
        version: HEADLESS_CONTRACT_VERSION, hostIncarnationId: incarnation,
        workspaces: admitted.workspaceIds, operations: admitted.operations,
      } } : { ok: false, code: "headless.forbidden" };
    },
  });
  try {
    const result = await post(connector, readPath, describe, { Authorization: `Bearer ${paired.credential}` });
    assert.equal(checks, 3);
    assert.equal(result.status, 403);
    assert.deepEqual(result.json, { ok: false, code: "headless.forbidden" });
  } finally {
    await connector.close();
  }
});

test("closing the connector terminates owned TCP sockets still waiting for TLS", { timeout: 3_000 }, async () => {
  const connector = await startDesktopHeadlessLoopback({
    registrations: registrations(),
    async read() { throw new Error("Unexpected read before TLS."); },
  });
  const socket = connect({ host: "127.0.0.1", port: Number(new URL(connector.endpoint).port) });
  const connected = new Promise<void>((resolve, reject) => {
    socket.once("connect", resolve);
    socket.once("error", reject);
  });
  const closed = new Promise<void>((resolve) => { socket.once("close", () => resolve()); });
  try {
    await connected;
    await connector.close();
    await closed;
    assert.ok(socket.destroyed);
  } finally {
    socket.destroy();
    await connector.close();
  }
});
