/** Controlled public software integration, not provider/model or paired-app qualification. */
import assert from "node:assert/strict";
import {createHash, randomUUID} from "node:crypto";
import {once} from "node:events";
import {lstat, mkdir, readFile, readdir, realpath, writeFile} from "node:fs/promises";
import {request as httpRequest} from "node:http";
import {createServer} from "node:net";
import path from "node:path";
import test from "node:test";
import express from "express";
import {fixture, post, proposal, modelId, revision, timestamp, workspaceId, closeFixtureOwners} from "../../../../modules/hosts/shared/composition/tests/headless-model-download-root-fixture";
import {composeDesktopHost} from "../../../../modules/hosts/desktop/composition/composeDesktopHost";
import {composeServerHost} from "../../../../modules/hosts/server/composition/composeServerHost";
import {AuthorizeOperationService, createOrganizationAuthorizationPolicy} from "../../../../modules/application/services/security";
import {createTenantPlacementConfig} from "../../../../modules/contracts/config";
import {readModelDownloadSource} from "../../../../modules/contracts/model";
import {HEADLESS_CONTRACT_VERSION as version, HEADLESS_PLAN_REVIEW_PATH, HEADLESS_PLAN_STEP_PATH,
  HEADLESS_MODEL_TASK_CONTROL_PATH, parseHeadlessBuildPlanProposal, type HeadlessHostIncarnationId} from "../../../../modules/contracts/headless";
import {registerManagedHeadlessAgentRoutes} from "../../../../modules/adapters/transport/api-express/headless/registerManagedHeadlessAgentRoutes";
import {createExpressSecurityMiddleware} from "../../../../modules/adapters/transport/api-express/security/createExpressSecurityMiddleware";
import {setExpressOrganizationContext} from "../../../../modules/adapters/transport/api-express/security/expressOrganizationContext";
import {MANAGED_HEADLESS_AGENT_PATHS} from "../../../../modules/adapters/transport/api-express/security/apiRouteSecurityPolicy";
import {identifyManagedHeadlessRouteCaller} from "../../../../apps/server/src/createServer";

const contents = {"config.json": Buffer.from('{"model_type":"synthetic"}'), "tokenizer.json": Buffer.from('{"version":1}'),
  "model.safetensors": Buffer.from("synthetic; not model weights")};
const workerModule = "modules.adapters.runtime.python.worker.tests.model_source_identity_fixture";
const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function unusedPort() {
  const server = createServer(); server.listen(0, "127.0.0.1"); await once(server, "listening");
  const address = server.address(); assert.ok(address && typeof address !== "string");
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); return address.port;
}
function value(reply: any) {
  const code = typeof reply?.code === "string" && /^headless\.[a-z-]+$/.test(reply.code) ? reply.code : "unconfirmed";
  assert.equal(reply?.ok, true, "Controlled public operation: " + code); return reply.value;
}
function describeFailure(error: unknown): Record<string, unknown> {
  if (!(error instanceof Error)) return {kind: "non-error"};
  const kind = ["Error", "TypeError", "AssertionError", "AggregateError"].includes(error.name) ? error.name : "Error";
  const result: Record<string, unknown> = {kind};
  const fields = error as Error & {code?: unknown; actual?: unknown; expected?: unknown};
  if (["ERR_ASSERTION", "ECONNRESET", "ECONNREFUSED", "ETIMEDOUT", "EPIPE"].includes(String(fields.code))) result.code = fields.code;
  const publicCode = /^Controlled public operation: (headless\.[a-z-]+)$/.exec(error.message)?.[1];
  if (publicCode) result.publicCode = publicCode;
  if (error.message === "Background task shutdown reconciliation remains pending.") result.reason = "background-reconciliation-pending";
  for (const key of ["actual", "expected"] as const) {
    const supplied = fields[key];
    if (typeof supplied === "boolean" || typeof supplied === "number" && Number.isSafeInteger(supplied) && supplied >= 0 && supplied <= 100 ||
        typeof supplied === "string" && ["queued", "running", "succeeded", "failed", "cancelled", "started", "committed", "replayed"].includes(supplied)) result[key] = supplied;
  }
  if (error instanceof AggregateError) result.causes = error.errors.slice(0, 2).map(cause => cause instanceof Error &&
    cause.message === "Background task shutdown reconciliation remains pending." ? {kind: "Error", reason: "background-reconciliation-pending"} : {kind: "Error"});
  return result;
}
function plan(host: HeadlessHostIncarnationId, steps: unknown[]) {
  const input = {hostIncarnationId: host, workspaceId, steps};
  const parsed = parseHeadlessBuildPlanProposal(input, host, {allowLocalFileSave: false, allowModelDownload: true, allowModelReferenceSave: true});
  assert.ok(parsed.ok); return {...input, fingerprint: createHash("sha256").update(JSON.stringify(parsed.preview)).digest("hex")};
}
async function httpPost(endpoint: string, route: string, body: unknown, credential: string, organization: string) {
  const bytes = JSON.stringify(body);
  return await new Promise<any>((resolve, reject) => {
    const call = httpRequest(new URL(route, endpoint), {method: "POST", headers: {"Content-Type": "application/json",
      "Content-Length": Buffer.byteLength(bytes), Authorization: "Bearer " + credential, "X-Organization-ID": organization}}, response => {
      let text = ""; response.setEncoding("utf8");
      response.on("data", chunk => {text += chunk; if (Buffer.byteLength(text) > 128 * 1024) call.destroy(new Error("Controlled response exceeds bound."));});
      response.on("error", reject); response.on("end", () => {try {resolve(JSON.parse(text));} catch (error) {reject(error);}});
    });
    call.setTimeout(15_000, () => call.destroy(new Error("Controlled public request timed out.")));
    call.on("error", reject); call.end(bytes);
  });
}

for (const profile of ["Desktop", "Managed"] as const) test(`${profile}: original public download, separate Save and queued cancellation`, {timeout: 150_000}, async t => {
  const diagnostics = path.resolve(".local-codex/headless-public-model-download-feature");
  await mkdir(diagnostics, {recursive: true});
  assert.equal(await realpath(diagnostics), diagnostics);
  const diagnosticDirectory = await lstat(diagnostics); assert.ok(diagnosticDirectory.isDirectory() && !diagnosticDirectory.isSymbolicLink());
  assert.ok((await readdir(diagnostics)).length < 64, "Preserve and archive bounded feature diagnostics before another run.");
  const python = process.env.ASB_HEADLESS_MODEL_DOWNLOAD_TEST_PYTHON;
  assert.ok(python && path.isAbsolute(python), "Select the existing installed Python for this explicit feature profile.");
  assert.equal(await realpath(python), path.resolve(python));
  const executable = await lstat(python); assert.ok(executable.isFile() && !executable.isSymbolicLink());
  const port = await unusedPort(); let shutdownConfirmed = false;
  const f = await fixture(t, {contents, runtimeOrigin: "http://127.0.0.1:" + port, canCleanup: () => shutdownConfirmed});
  const cache = path.join(f.folder, "cache"); await mkdir(cache);
  const selectedEnvironment: Record<string, string> = {PYTHON_RUNTIME_HOST: "127.0.0.1", PYTHON_RUNTIME_PORT: String(port),
    PYTHON_RUNTIME_COMMAND: python, PYTHON_RUNTIME_ARGS: "-B -m " + workerModule, PYTHON_RUNTIME_WORKER_DIR: process.cwd(),
    AISB_MODEL_SOURCE_FIXTURE_HOST: "owned-runtime-v1", AISB_MODEL_SOURCE_FIXTURE_CACHE: cache,
    HF_HUB_CACHE: cache, HF_HOME: path.join(f.folder, "hf"), TRANSFORMERS_CACHE: cache,
    TEMP: f.folder, TMP: f.folder, HF_HUB_OFFLINE: "1", TRANSFORMERS_OFFLINE: "1", PIP_NO_INDEX: "1"};
  const previous = new Map(Object.keys(selectedEnvironment).map(key => [key, process.env[key]]));
  Object.assign(process.env, selectedEnvironment);
  let closeHost: (() => Promise<void>) | undefined, closeHttp: (() => Promise<void>) | undefined;
  let phase = "compose", bodyPassed = false, failure = "none", bodyThrew = false, bodyFailure: unknown;
  try {
    let hostId: HeadlessHostIncarnationId, clientId: string;
    let call: (operation: string, input: unknown, ordinary?: boolean) => Promise<any>;
    let approve: (input: ReturnType<typeof plan>, revision: number) => Promise<number>;
    if (profile === "Desktop") {
      const host = composeDesktopHost({persistence: f, localIdentity: f.identity, runtimeDataRootDirectory: f.folder,
        pythonRuntimeLaunch: {command: python, args: ["-B", "-m", workerModule], cwd: process.cwd()},
        artifactRepo: {huggingFaceTokenConfigFilePath: path.join(f.folder, "no-token.json")},
        settings: {localSettingsFilePath: path.join(f.folder, "settings.json")}, logSink() {}, now: () => timestamp});
      closeHost = () => host.shutdownBackgroundTasks();
      host.registerDesktopIpc({ipcMain: {handle() {}}, senderTrust: {isTrustedSender: () => true}, storageRootDirectory: f.folder,
        runtimeRootDirectory: path.join(f.folder, "runtime")});
      const connector = host.getHeadlessConnection(); assert.ok(connector);
      async function pair(purpose: "plan-review" | "read") {
        const pending = await connector!.beginPairing(workspaceId, () => true, purpose); assert.equal(pending.status, "ready");
        assert.ok(pending.status === "ready"); return {...pending, ...value(await post(pending, "/aisb-headless/v1/pair", {pairingCode: pending.pairingCode}))};
      }
      const paired = await pair("plan-review"), ordinary = await pair("read"); clientId = paired.registeredClientId;
      call = (operation, input, useOrdinary = false) => {
        const route = operation === "plan.submit" || operation === "plan.status" ? HEADLESS_PLAN_REVIEW_PATH :
          operation === "plan.run-step" ? HEADLESS_PLAN_STEP_PATH : operation === "models.cancel-download" ? HEADLESS_MODEL_TASK_CONTROL_PATH : "/aisb-headless/v1/read";
        return post(paired, route, {version, operation, input}, useOrdinary ? ordinary.credential : paired.credential, 15_000);
      };
      hostId = value(await call("host.describe", {})).hostIncarnationId;
      const approvals = host.getHeadlessPlanApprovals(); assert.ok(approvals);
      approve = async (input, expectedRevision) => {
        const selection = {workspaceId, registeredClientId: clientId, fingerprint: input.fingerprint};
        const control = {channel: "app-popup" as const, isCurrent: () => true};
        assert.ok((await approvals.open(selection, control)).ok);
        const result = await approvals.decide(selection, {fingerprint: input.fingerprint, expectedRevision,
          decision: {kind: "approve", mode: "whole-plan"}}, control); assert.ok(result.ok); return result.state.revision;
      };
    } else {
      const placement = createTenantPlacementConfig({mode: "dedicated", organizationId: f.identity.organizationId});
      const authorize = new AuthorizeOperationService(createOrganizationAuthorizationPolicy({...f.repositories, tenantPlacement: placement}),
        {now: () => timestamp, createEventId: () => randomUUID()});
      const documents = {...f.documents, async publishWithStableReads(check: any, publish: any) {
        return f.documents.runInOwnedTransaction!(async owner => await check(owner) && publish(), () => {});
      }};
      clientId = randomUUID(); const ordinaryId = randomUUID();
      const host = composeServerHost({env: {...process.env, ...selectedEnvironment, NODE_ENV: "test"},
        persistence: {documents, organizationDocuments: f.organizationDocuments}, organizationContextProvider: {getCurrentOrganizationContext: () => f.identity},
        organizationAuthorizer: authorize, managedSavedState: {authorize, listActiveSystems: async () => []},
        managedHeadlessAgent: {placement, planReviewClientId: clientId, browserObservationAuthorizer: authorize, modelSourceRead: true},
        pythonRuntimeEnvironmentPreparer: async () => {assert.fail("The installed-only source workflow must never install dependencies.");},
        settings: {localSettingsFilePath: path.join(f.folder, "settings.json")},
        artifactRepo: {providerCredentialRootDirectory: path.join(f.folder, "credentials"), huggingFaceTokenConfigFilePath: path.join(f.folder, "no-token.json")},
        logSink() {}, now: () => timestamp});
      closeHost = async () => {await host.shutdownBackgroundTasks(); await host.closeRuntimeDatabases();};
      host.registerApi({app: {get() {}, post() {}, patch() {}, delete() {}}, storageRootDirectory: f.folder,
        runtimeRootDirectory: path.join(f.folder, "runtime")});
      await host.waitForAssetFoundation(); const handlers = host.getManagedHeadlessAgent(); assert.ok(handlers?.planReview);
      hostId = handlers.hostIncarnationId; const review = handlers.planReview;
      const planToken = "synthetic-plan-" + randomUUID(), ordinaryToken = "synthetic-agent-" + randomUUID();
      const registration = {...f.identity, registeredClientId: clientId, purpose: "plan-review" as const, modelSourceRead: true as const, isCurrent: () => true};
      const agentRegistration = {...f.identity, registeredClientId: ordinaryId, purpose: "agent" as const, isCurrent: () => true};
      const app = express(); app.enable("case sensitive routing");
      app.use(createExpressSecurityMiddleware({mode: "oidc-bearer", authRequired: true, httpsRequired: false,
        async verifyToken({token}) {
          assert.ok(token === planToken || token === ordinaryToken);
          return {authenticated: true, authMethod: "oidc-bearer", oidcAccessTokenClientId: token,
            principal: {kind: "user", principalId: f.identity.principalId, roles: [], scopes: []}};
        }}));
      app.use((request, _response, next) => {setExpressOrganizationContext(request, f.identity); next();});
      const policy = {identify(input: Parameters<Parameters<typeof identifyManagedHeadlessRouteCaller>[0]["identify"]>[0]) {
        if (input.organization?.organizationId !== f.identity.organizationId || input.organization.principalId !== f.identity.principalId) return;
        if (input.purpose === "plan-review" && input.auth?.oidcAccessTokenClientId === planToken) return registration;
        if (input.purpose === "agent" && input.auth?.oidcAccessTokenClientId === ordinaryToken) return agentRegistration;
      }};
      const retire = registerManagedHeadlessAgentRoutes(app, () => ({hostIncarnationId: hostId,
        identify: (input, kind) => identifyManagedHeadlessRouteCaller(policy, input, kind, true), isCurrent: admitted => admitted.isCurrent(),
        allowModelSourceRead: true, allowModelDownload: true, allowModelReferenceSave: true,
        read: handlers.read, author: async () => ({ok: false, code: "headless.forbidden"}),
        planReview: async (input, admitted, current) => admitted.purpose === "plan-review" ? review(input, admitted, current) : {ok: false, code: "headless.forbidden"},
        planStep: async (input, admitted, current) => admitted.purpose === "plan-review" ? review.runStep!(input, admitted, current) : {result: {ok: false, code: "headless.forbidden"}},
        modelTaskControl: async (input, admitted, current) => admitted.purpose === "plan-review" ? review.cancelModelDownload!(input, admitted, current) : {ok: false, code: "headless.forbidden"}}));
      const server = app.listen(0, "127.0.0.1");
      closeHttp = async () => {retire(); await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));};
      await once(server, "listening");
      const address = server.address(); assert.ok(address && typeof address !== "string");
      const endpoint = "http://127.0.0.1:" + address.port;
      call = (operation, input, ordinary = false) => {
        const kind = operation === "plan.submit" || operation === "plan.status" ? "plan-review" : operation === "plan.run-step" ? "plan-step" :
          operation === "models.cancel-download" ? "model-task-control" : "read";
        return httpPost(endpoint, MANAGED_HEADLESS_AGENT_PATHS[kind], {version, operation, input}, ordinary ? ordinaryToken : planToken, f.identity.organizationId);
      };
      const consent = host.getManagedBrowserConsent(); assert.ok(consent?.planApproval);
      const binding = {sameCredential(other: unknown) {return binding === other;}};
      const browser = {...f.identity, purpose: "browser" as const, registeredClientId: randomUUID(), isCurrent: () => true, credentialBinding: binding};
      const tab = await consent.register(browser, workspaceId, () => true); assert.ok(tab?.target && tab.proof);
      const document = {identity: browser, target: tab.target, proof: tab.proof};
      approve = async (input, expectedRevision) => {
        const selection = {workspaceId, registeredClientId: clientId, fingerprint: input.fingerprint};
        const opened = await consent.planApproval!(document, {operation: "open", document: tab.target, selection}, () => true);
        assert.ok(opened); assert.ok(opened.canPublish()); if (opened.publishIfCurrent) assert.equal(await opened.publishIfCurrent(() => true), true);
        const view = opened.value as {viewId: string};
        const decided = await consent.planApproval!(document, {operation: "decide", document: tab.target,
          decision: {selection, viewId: view.viewId, expectedRevision, decision: {kind: "approve", mode: "whole-plan"}}}, () => true);
        assert.ok(decided); assert.ok(decided.canPublish()); if (decided.publishIfCurrent) assert.equal(await decided.publishIfCurrent(() => true), true);
        return (decided.value as {revision: number}).revision;
      };
    }
    const scope = {hostIncarnationId: hostId!, workspaceId};
    phase = "source-preview";
    const source = value(await call!("models.preview-source", {...scope, modelId, revision}));
    const first = proposal(hostId!, source.source);
    const submitted = value(await call!("plan.submit", first));
    const approved = await approve!(first, submitted.revision);
    const run = { ...scope, fingerprint: first.fingerprint, approvalRevision: approved, step: 1};
    phase = "accepted-download";
    const started = value(await call!("plan.run-step", run)); assert.equal(started.kind, "started");
    const taskId = started.reference.taskId;
    const task = {...scope, selection: {kind: "task", taskId}};
    let status = value(await call!("models.task", task)); const deadline = Date.now() + 20_000;
    while (["queued", "running"].includes(status.state) && Date.now() < deadline) {await pause(100); status = value(await call!("models.task", task));}
    assert.equal(status.state, "succeeded");
    const completion = value(await call!("models.review-download", task));
    assert.equal(completion.taskId, taskId); assert.equal(completion.revision, revision);
    assert.equal(completion.registration, "requires-separate-approval");
    assert.equal(completion.selectedFilesVerification, "verified-at-completion");
    assert.equal(completion.runtimeReadiness, "not-checked");
    assert.equal(value(await call!("plan.run-step", run)).reference.taskId, taskId);
    const observations = async () => JSON.parse(await readFile(path.join(f.folder, "worker-observations.json"), "utf8"));
    assert.equal((await observations()).submissions, 1, "Exact replay cannot dispatch again.");
    assert.equal(value(await call!("models.inventory", scope)).models.length, 0, "Download does not register a Model.");
    phase = "uncommitted-save-policy-denial";
    const deniedSave = plan(hostId!, [{operation: "models.save-download", idempotencyKey: randomUUID(), name: "Controlled denied save", taskId,
      sourceManifest: first.steps[0].sourceManifest}]);
    const deniedSubmit = value(await call!("plan.submit", deniedSave));
    const deniedRun = {...scope, fingerprint: deniedSave.fingerprint, approvalRevision: await approve!(deniedSave, deniedSubmit.revision), step: 1};
    await f.repositories.memberships.saveMembership({...f.membership, status: "suspended"});
    assert.equal((await call!("plan.run-step", deniedRun)).ok, false);
    await f.repositories.memberships.saveMembership(f.membership);
    assert.equal(value(await call!("models.inventory", scope)).models.length, 0);
    phase = "separate-save";
    const savedPlan = plan(hostId!, [{operation: "models.save-download", idempotencyKey: randomUUID(), name: "Controlled saved model", taskId,
      sourceManifest: first.steps[0].sourceManifest}]);
    const savedSubmit = value(await call!("plan.submit", savedPlan));
    const saveRun = {...scope, fingerprint: savedPlan.fingerprint, approvalRevision: await approve!(savedPlan, savedSubmit.revision), step: 1};
    const saved = value(await call!("plan.run-step", saveRun)); assert.equal(saved.kind, "committed");
    assert.equal(saved.reference.storageAuthority, "reference-only");
    assert.equal(saved.reference.runtimeReadiness, "not-checked");
    const replayed = value(await call!("plan.run-step", saveRun)); assert.equal(replayed.kind, "replayed");
    assert.deepEqual(replayed.reference, saved.reference);
    const inventory = value(await call!("models.inventory", scope)); assert.equal(inventory.models.length, 1);
    assert.equal(inventory.models[0].modelRecordId, saved.reference.modelRecordId);
    phase = "queued-cancellation";
    const second = proposal(hostId!, source.source), secondSubmit = value(await call!("plan.submit", second));
    const secondRun = {...scope, fingerprint: second.fingerprint, approvalRevision: await approve!(second, secondSubmit.revision), step: 1};
    const queued = value(await call!("plan.run-step", secondRun));
    const cancelTarget = {...scope, selection: {kind: "task", taskId: queued.reference.taskId}};
    // Public acquisition is running while its original Python Future is queued.
    // The real Future cancellation acknowledgement below proves that queue path.
    assert.ok(["queued", "running"].includes(value(await call!("models.task", cancelTarget)).state));
    assert.equal((await call!("models.cancel-download", cancelTarget, true)).ok, false);
    assert.equal(value(await call!("models.cancel-download", cancelTarget)).cancellationAccepted, true);
    assert.equal(value(await call!("models.task", cancelTarget)).state, "cancelled");
    assert.equal(value(await call!("models.cancel-download", cancelTarget)).state, "cancelled");
    assert.equal((await observations()).submissions, 2);
    phase = "uncommitted-save-source-mismatch";
    // Valid, self-consistent metadata for another revision cannot be associated
    // with this original task. This tests lineage, not parser syntax or a new
    // promise that metadata-only Save inspects shared cache files.
    const originalSource = readModelDownloadSource(first.steps[0].sourceManifest.source, {provider: "huggingface", modelId, revision});
    const changedSource = {...originalSource, revision: "b".repeat(40)};
    const changedManifest = {source: changedSource,
      manifestDigest: "sha256:" + createHash("sha256").update(JSON.stringify(changedSource)).digest("hex")};
    const changedSave = plan(hostId!, [{operation: "models.save-download", idempotencyKey: randomUUID(), name: "Controlled wrong source", taskId,
      sourceManifest: changedManifest}]);
    assert.equal((await call!("plan.submit", changedSave)).ok, false);
    const unchangedReview = value(await call!("models.review-download", task));
    assert.equal(unchangedReview.revision, revision);
    assert.equal(unchangedReview.selectedFilesVerification, "verified-at-completion");
    assert.equal(unchangedReview.runtimeReadiness, "not-checked");
    assert.equal(value(await call!("models.inventory", scope)).models.length, 1);
    assert.equal((await observations()).submissions, 2);
    phase = "fresh-policy-denial";
    await f.repositories.memberships.saveMembership({...f.membership, status: "suspended"});
    assert.equal((await call!("plan.run-step", saveRun)).ok, false);
    assert.equal((await call!("models.cancel-download", cancelTarget)).ok, false);
    t.diagnostic(JSON.stringify({profile, provider: "controlled-synthetic-bytes", acceptedDownloads: 2, savedReferences: 1,
      cancellation: "original-queued-task", exactReplay: true, freshPolicyDenial: true, sourceMismatchDenial: true,
      saveSemantics: "historical-reference-only", actualProviderQualification: "pending", modelQualityTested: false}));
    bodyPassed = true;
  } catch (error) {
    bodyThrew = true; bodyFailure = error;
    failure = error instanceof TypeError ? "TypeError" : error instanceof Error && error.name === "AssertionError" ? "AssertionError" : "Error";
    t.diagnostic(JSON.stringify({profile, stage: phase, failure, modelQualityTested: false}));
    throw error;
  } finally {
    let closeThrew = false, closeFailure: unknown;
    try {await closeFixtureOwners(closeHttp, closeHost); shutdownConfirmed = true;}
    catch (error) {closeThrew = true; closeFailure = error;}
    finally {
      for (const [key, old] of previous) {if (old === undefined) delete process.env[key]; else process.env[key] = old;}
      const evidence = JSON.stringify({schema: "controlled-public-download-diagnostic-v1", profile, stage: phase, failure,
        bodyPassed, originalHostShutdownConfirmed: shutdownConfirmed, cleanup: "verified-separately-by-test-hook",
        root: {name: path.basename(f.folder), ...f.rootIdentity},
        ...(bodyThrew ? {bodyFailure: describeFailure(bodyFailure)} : {}),
        ...(closeThrew ? {shutdownFailure: describeFailure(closeFailure)} : {}),
        provider: "synthetic", modelQualityTested: false, interpretation: "diagnostic-not-parent-qualification"}) + "\n";
      assert.ok(Buffer.byteLength(evidence) <= 1024);
      await writeFile(path.join(diagnostics, randomUUID() + ".json"), evidence, {flag: "wx"});
    }
    if (closeThrew) {
      if (bodyThrew) throw new AggregateError([bodyFailure, closeFailure], "Controlled journey and original shutdown failed.");
      throw closeFailure;
    }
  }
});
