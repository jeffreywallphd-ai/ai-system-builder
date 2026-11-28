import assert from "node:assert/strict";
import {createHash, randomUUID} from "node:crypto";
import {lstat, mkdtemp, realpath, rm} from "node:fs/promises";
import {request} from "node:https";
import {tmpdir} from "node:os";
import path from "node:path";
import test, {type TestContext} from "node:test";
import {openLocalSqliteDatabase, resolveLocalSqliteDatabasePolicy} from "../../../../adapters/persistence/sqlite";
import {createStructuredOrganizationRepositories} from "../../../../adapters/persistence/organization";
import {initializeLocalIdentityProfile} from "../../../../adapters/security/local-identity";
import {createLocalWorkspaceRepository} from "../../../../adapters/persistence/workspace";
import {createDesktopPinnedLoopbackAgent} from "../../../../adapters/transport/headless-loopback";
import {AuthorizeOperationService, createOrganizationAuthorizationPolicy} from "../../../../application/services/security";
import {createTenantPlacementConfig} from "../../../../contracts/config";
import {createWorkspaceId} from "../../../../contracts/workspace";
import {HEADLESS_CONTRACT_VERSION as version, HEADLESS_PLAN_REVIEW_PATH, HEADLESS_PLAN_STEP_PATH,
  HEADLESS_MODEL_TASK_CONTROL_PATH, parseHeadlessBuildPlanProposal, readHeadlessPlanReviewAgentRequest,
  type HeadlessHostIncarnationId} from "../../../../contracts/headless";
import {composeDesktopHost} from "../../../desktop/composition/composeDesktopHost";
import {composeServerHost} from "../../../server/composition/composeServerHost";
import {identifyManagedHeadlessRouteCaller} from "../../../../../apps/server/src/createServer";
import {MANAGED_HEADLESS_AGENT_PATHS} from "../../../../adapters/transport/api-express/security/apiRouteSecurityPolicy";
import {createOrganizationId} from "../../../../contracts/organization";

import {fixture, proposal, post, revision, modelId, timestamp, workspaceId, closeFixtureOwners} from "./headless-model-download-root-fixture";

test("original host shutdown is attempted after an API closure failure, including falsy failures", async () => {
  for (const failure of [undefined, null, false, new Error("Controlled API closure failure")]) {
    const calls: string[] = [];
    await assert.rejects(closeFixtureOwners(async () => {calls.push("api"); throw failure;},
      async () => {calls.push("host");}), (error: unknown) => error instanceof AggregateError && error.errors[0] === failure);
    assert.deepEqual(calls, ["api", "host"]);
  }
  const calls: string[] = [];
  await closeFixtureOwners(async () => {calls.push("api");}, async () => {calls.push("host");});
  assert.deepEqual(calls, ["api", "host"]);
});

test("production Managed route admission uses the plan registration for Model cancellation and keeps ordinary credentials separate", () => {
  const input = {organization: {organizationId: createOrganizationId("org.synthetic"), principalId: "synthetic-principal"}};
  const identity = {...input.organization, registeredClientId: randomUUID(), isCurrent: () => true};
  const planRoutes = new Set(["plan-review", "plan-step", "model-task-control", "local-file-preview", "provider-file-preview"]);
  for (const allowed of ["agent", "plan-review"] as const) for (const enabled of [false, true])
  for (const kind of Object.keys(MANAGED_HEADLESS_AGENT_PATHS) as Array<keyof typeof MANAGED_HEADLESS_AGENT_PATHS>) {
    const calls: string[] = [];
    const policy = {identify(request: Parameters<Parameters<typeof identifyManagedHeadlessRouteCaller>[0]["identify"]>[0]) {
      assert.deepEqual(request.organization, input.organization); calls.push(request.purpose);
      return request.purpose === allowed ? {...identity, purpose: allowed} : undefined;
    }};
    const result = identifyManagedHeadlessRouteCaller(policy, input, kind, enabled);
    const expected = planRoutes.has(kind) ? enabled && allowed === "plan-review" :
      kind === "read" ? allowed === "agent" || enabled : allowed === "agent";
    assert.equal(result?.purpose, expected ? allowed : undefined, `${kind}/${allowed}/${enabled}`);
    if (planRoutes.has(kind)) assert.ok(!calls.includes("agent"), "Plan-only routes never admit ordinary agent credentials.");
    if (!enabled) assert.ok(!calls.includes("plan-review"), "Missing plan support does not attempt plan registration.");
  }
});

test("Desktop production Root accepts exact public download review without loading the model feature and gates dispatch", {timeout: 30_000}, async t => {
  const f = await fixture(t);
  const host = composeDesktopHost({persistence: f, localIdentity: f.identity, runtimeDataRootDirectory: f.folder,
    artifactRepo: {huggingFaceTokenConfigFilePath: path.join(f.folder, "no-token.json")},
    settings: {localSettingsFilePath: path.join(f.folder, "settings.json")}, logSink() {}, now: () => timestamp});
  t.after(() => host.shutdownBackgroundTasks());
  host.registerDesktopIpc({ipcMain: {handle() {}}, senderTrust: {isTrustedSender: () => true},
    storageRootDirectory: f.folder, runtimeRootDirectory: path.join(f.folder, "runtime")});
  const connector = host.getHeadlessConnection(); assert.ok(connector);
  const pairing = await connector.beginPairing(workspaceId, () => true, "plan-review"); assert.equal(pairing.status, "ready");
  if (pairing.status !== "ready") return;
  const paired = await post(pairing, "/aisb-headless/v1/pair", {pairingCode: pairing.pairingCode}); assert.ok(paired.ok);
  const credential = paired.value.credential, registeredClientId = paired.value.registeredClientId;
  const description = await post(pairing, "/aisb-headless/v1/read", {version, operation: "host.describe", input: {}}, credential);
  assert.ok(description.ok); const hostIncarnationId = description.value.hostIncarnationId;
  const preview = await post(pairing, "/aisb-headless/v1/read", {version, operation: "models.preview-source",
    input: {hostIncarnationId, workspaceId, modelId, revision}}, credential);
  assert.ok(preview.ok, JSON.stringify(preview));
  const input = proposal(hostIncarnationId, preview.value.source);
  const submitted = await post(pairing, HEADLESS_PLAN_REVIEW_PATH, {version, operation: "plan.submit", input}, credential);
  assert.ok(submitted.ok, JSON.stringify(submitted)); assert.equal(submitted.value.status, "pending");
  const target = {hostIncarnationId, workspaceId, fingerprint: input.fingerprint};
  const step = await post(pairing, HEADLESS_PLAN_STEP_PATH, {version, operation: "plan.run-step",
    input: {...target, approvalRevision: 1, step: 1}}, credential);
  assert.equal(step.ok, false);
  const approvals = host.getHeadlessPlanApprovals(); assert.ok(approvals);
  const selection = {workspaceId, registeredClientId, fingerprint: input.fingerprint};
  for (const channel of ["app-popup", "authenticated-chat"] as const) {
    const opened = await approvals.open(selection, {channel, isCurrent: () => true}); assert.ok(opened.ok);
    assert.equal(opened.snapshot.preview.steps[0].operation, "models.download");
  }
  const decision = await approvals.decide(selection, {fingerprint: input.fingerprint, expectedRevision: 1,
    decision: {kind: "approve", mode: "whole-plan"}}, {channel: "app-popup", isCurrent: () => true});
  assert.ok(decision.ok);
  const replay = await post(pairing, HEADLESS_PLAN_REVIEW_PATH, {version, operation: "plan.submit", input}, credential);
  assert.ok(replay.ok); assert.equal(replay.value.revision, decision.state.revision);
  assert.equal(f.reads(), 6, "Exact submit revalidates provider metadata; it starts no model or worker.");
  const cancel = await post(pairing, HEADLESS_MODEL_TASK_CONTROL_PATH, {version, operation: "models.cancel-download",
    input: {hostIncarnationId, workspaceId, selection: {kind: "task", taskId: randomUUID()}}}, credential);
  assert.equal(cancel.ok, false); assert.notEqual(cancel.code, "headless.unsupported-operation");
  for (const key of ["model-registry", "runtime-task-registry"])
    assert.equal(host.getFeatureLifecycleState().find(entry => entry.featureKey === key)?.loaded, false);
  await f.repositories.memberships.saveMembership({...f.membership, status: "suspended"});
  assert.equal((await approvals.open(selection, {channel: "app-popup", isCurrent: () => true})).ok, false);
  assert.equal(f.reads(), 6);
});

test("Managed production Root requires stable publication and explicit source opt-in for download plans", {timeout: 30_000}, async t => {
  const f = await fixture(t), placement = createTenantPlacementConfig({mode: "dedicated", organizationId: f.identity.organizationId});
  const contexts = {getCurrentOrganizationContext: () => f.identity};
  const authorize = new AuthorizeOperationService(createOrganizationAuthorizationPolicy({...f.repositories, tenantPlacement: placement}),
    {now: () => timestamp, createEventId: () => randomUUID()});
  for (const enabled of [false, true]) {
    // SQLite provides only local serialized stable-read evidence here. Actual PostgreSQL/RLS stays in final host qualification.
    const documents = {...f.documents, async publishWithStableReads(check: any, publish: any) {
      return f.documents.runInOwnedTransaction!(async owner => await check(owner) && publish(), () => {});
    }};
    const client = randomUUID();
    const host = composeServerHost({env: {NODE_ENV: "test"}, persistence: {documents, organizationDocuments: f.organizationDocuments},
      organizationContextProvider: contexts, organizationAuthorizer: authorize,
      managedSavedState: {authorize, listActiveSystems: async () => []},
      managedHeadlessAgent: {placement, planReviewClientId: client, browserObservationAuthorizer: authorize,
        ...(enabled ? {modelSourceRead: true} : {})},
      pythonRuntimeEnvironmentPreparer: async () => {assert.fail("Review cannot prepare a runtime.");},
      settings: {localSettingsFilePath: path.join(f.folder, "settings.json")},
      artifactRepo: {providerCredentialRootDirectory: path.join(f.folder, "credentials"), huggingFaceTokenConfigFilePath: path.join(f.folder, "no-token.json")},
      logSink() {}, now: () => timestamp});
    try {
      host.registerApi({app: {get() {}, post() {}, patch() {}, delete() {}}, storageRootDirectory: f.folder,
        runtimeRootDirectory: path.join(f.folder, "runtime")});
      await host.waitForAssetFoundation();
      const agent = host.getManagedHeadlessAgent(); assert.ok(agent?.planReview);
      assert.equal(agent.planReview.allowModelDownload, enabled ? true : undefined);
      const registration = {...f.identity, registeredClientId: client, purpose: "plan-review" as const,
        isCurrent: () => true, ...(enabled ? {modelSourceRead: true as const} : {})};
      const metadata = {provider: "huggingface", modelId, revision, format: "transformers-safetensors", license: {kind: "provider-declared", identifier: "apache-2.0"},
        files: ["config.json", "model.safetensors", "tokenizer.json"].map(name => ({path: name, sizeBytes: 10,
          integrity: {algorithm: name.endsWith("safetensors") ? "sha256" : "git-blob-sha1", digest: (name.endsWith("safetensors") ? "c".repeat(64) : "b".repeat(40))}})),
        totalBytes: 30, excludedFileCount: 0, sourceVerification: "provider-metadata", bytesVerification: "not-checked", runtimeReadiness: "not-checked"};
      const input = proposal(agent.hostIncarnationId, metadata), wire = {version, operation: "plan.submit", input};
      const decoded = readHeadlessPlanReviewAgentRequest(wire, agent.hostIncarnationId, {allowLocalFileSave: false, allowModelDownload: true}); assert.ok(decoded.ok);
      const before = f.reads(), result = await agent.planReview(decoded.request, registration, () => true);
      assert.equal(result.ok, enabled, JSON.stringify(result)); assert.equal(f.reads() - before, enabled ? 2 : 0);
      if (enabled) {
        assert.ok(result.ok);
        assert.equal(result.value.status, "pending");
        assert.equal((await agent.planReview(decoded.request, {...registration, principalId: "other-principal"}, () => true)).ok, false);
        const consent = host.getManagedBrowserConsent(); assert.ok(consent?.planApproval);
      }
      await host.shutdownBackgroundTasks();
      assert.equal((await agent.planReview(decoded.request, registration, () => true)).ok, false);
    } finally {await host.closeRuntimeDatabases();}
  }
});
