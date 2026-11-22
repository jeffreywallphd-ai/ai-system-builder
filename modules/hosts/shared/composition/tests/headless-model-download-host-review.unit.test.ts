import assert from "node:assert/strict";
import {createHash, randomUUID} from "node:crypto";
import {lstat, mkdtemp, realpath, rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {dirname, join} from "node:path";
import test, {type TestContext} from "node:test";
import {openLocalSqliteDatabase, resolveLocalSqliteDatabasePolicy} from "../../../../adapters/persistence/sqlite";
import type {StructuredDocumentStore} from "../../../../adapters/persistence/shared";
import {createStructuredOrganizationRepositories} from "../../../../adapters/persistence/organization";
import {createLocalWorkspaceRepository} from "../../../../adapters/persistence/workspace";
import {createStructuredHeadlessStoredPlanReviewRepository, readStructuredHeadlessPlanModelPermission} from "../../../../adapters/persistence/system-builder/createStructuredHeadlessPlanReviewRepository";
import {AuthorizeWorkspaceOperationService, createOrganizationAuthorizationPolicy} from "../../../../application/services/security";
import {PreviewHeadlessModelSourceUseCase} from "../../../../application/use-cases/model/headless-model-source-preview.use-case";
import {composeDesktopHeadlessPlanReview} from "../../../desktop/composition/composeDesktopHeadlessPlanReview";
import {composeManagedHeadlessPlanReview} from "../../../server/composition/composeManagedHeadlessPlanReview";
import {composeDesktopHeadlessPlanApprovals} from "../../../desktop/composition/composeDesktopHeadlessPlanApprovals";
import {composeManagedHeadlessPlanApprovals} from "../../../server/composition/composeManagedHeadlessPlanApprovals";
import {createOrganizationId} from "../../../../contracts/organization";
import {createWorkspaceId} from "../../../../contracts/workspace";
import {createTenantPlacementConfig} from "../../../../contracts/config";
import {readModelDownloadSource, type ModelInventoryRecord} from "../../../../contracts/model";
import {HEADLESS_CONTRACT_VERSION, parseHeadlessBuildPlanProposal, readHeadlessPlanReviewAgentRequest, readDesktopPlanApprovalView,
  type HeadlessHostIncarnationId} from "../../../../contracts/headless";
import {prepareHeadlessModelDownloadReviews} from "../headlessModelDownloadReview";
import {prepareHeadlessModelReferenceSaveReviews} from "../headlessModelReferenceSave";
import {ModelDownloadTasksUseCase} from "../../../../application/use-cases/model/model-download-tasks.use-case";
import {OwnedTaskReconcilerService} from "../../../../application/services/runtime/owned-task-reconciler.service";
import type {ApprovedModelSourceDownloadControl} from "../../../../application/ports/model";
import {TaskType, type RuntimeTaskRecord} from "../../../../contracts/runtime";
import {readStructuredModelPlanAttemptByPlan} from "../../../../adapters/persistence/system-builder/createStructuredHeadlessModelPlanTaskStore";
import {prepareStructuredHeadlessPlanStep, prepareStructuredHeadlessPlanStepWithModels} from "../../../../adapters/persistence/system-builder/createStructuredHeadlessPlanStepOperationStore";
import {runOwnedHeadlessModelDownloadTask} from "../headlessModelDownloadTasks";

type Host = "Desktop" | "Managed";
async function fixture(t: TestContext, host: Host) {
  const boundary = await realpath(tmpdir()), directory = await realpath(await mkdtemp(join(boundary, "model-review-host-")));
  const original = await lstat(directory, {bigint: true});
  const db = await openLocalSqliteDatabase({policy: resolveLocalSqliteDatabasePolicy({dataRootDirectory: directory})});
  t.after(async () => {
    await db.close(); const current = await lstat(directory, {bigint: true});
    assert.equal(dirname(directory), boundary); assert.equal(await realpath(directory), directory);
    assert.ok(current.isDirectory() && !current.isSymbolicLink()); assert.equal(current.dev, original.dev); assert.equal(current.ino, original.ino);
    await rm(directory, {recursive: true});
  });
  const platform = db.documents, organizationId = createOrganizationId("org.model-review"), workspaceId = createWorkspaceId("workspace.model-review");
  const hostIncarnationId = randomUUID() as HeadlessHostIncarnationId, principalId = "principal.synthetic", registeredClientId = randomUUID();
  const at = "2026-11-21T00:00:00.000Z", identity = {organizationId, principalId, principalDisplayName: "Synthetic", createdAt: at, updatedAt: at};
  const repositories = createStructuredOrganizationRepositories(platform);
  await repositories.organizations.saveOrganization({organizationId, displayName: "Synthetic", status: "active", createdAt: at, updatedAt: at});
  const membership = {organizationId, principalId, role: "owner" as const, status: "active" as const, createdAt: at, updatedAt: at};
  await repositories.memberships.saveMembership(membership);
  const documents = platform.forOrganization(organizationId), workspaces = createLocalWorkspaceRepository({rootDirectory: directory, documents});
  await workspaces.saveWorkspace({organizationId, workspaceId, displayName: "Synthetic", status: "active", createdAt: at, updatedAt: at});
  const state = {current: true, sourceConsent: true, readCurrent: true, operationCurrent: true, hostCurrent: true, ambientCurrent: true,
    inspections: 0, sourceResolutions: 0, denyWrite: false, sourceStarts: 0, startResolutions: 0, nativeReads: 0, nativeCancels: 0, registrations: 0,
    sourceOutcome: "accepted" as "accepted" | "unavailable" | "unknown", loseOutwardOnStart: false,
    onResolveStart: undefined as (() => Promise<void>) | undefined, onInspect: undefined as (() => Promise<void>) | undefined,
    modelOwnerAvailable: true, ownerLookups: 0, controlPolicies: 0, nativeCancellationAccepted: true,
    onControlPolicy: undefined as (() => Promise<void>) | undefined, onNativeCancel: undefined as (() => Promise<void>) | undefined,
    completionReady: false, onCompletionRead: undefined as (() => Promise<void>) | undefined, authoringCalls: 0};
  const contexts = {getCurrentOrganizationContext: () => state.ambientCurrent ? {organizationId, principalId} : undefined}, placement = createTenantPlacementConfig();
  const policy = createOrganizationAuthorizationPolicy({...repositories, tenantPlacement: placement});
  const authorization = new AuthorizeWorkspaceOperationService({organizationContext: contexts, authorizer: {async execute(input) {
    if (!(await policy.authorize(input)).allowed) throw new Error("Synthetic policy refusal.");
  }}});
  const source = readModelDownloadSource({provider: "huggingface", modelId: "fixture/model", revision: "a".repeat(40),
    format: "transformers-safetensors", license: {kind: "unknown"}, files: ["config.json", "model.safetensors", "tokenizer.json"].map(path => ({
      path, sizeBytes: 10, integrity: {algorithm: path.endsWith("safetensors") ? "sha256" : "git-blob-sha1",
        digest: "b".repeat(path.endsWith("safetensors") ? 64 : 40)}})), totalBytes: 30, excludedFileCount: 0,
    sourceVerification: "provider-metadata", bytesVerification: "not-checked", runtimeReadiness: "not-checked"},
    {provider: "huggingface", modelId: "fixture/model", revision: "a".repeat(40)});
  const provider = {inspectModelDownloadSource: async () => {
    state.inspections++;
    // A nested owned read must work: provider preparation cannot hold the proposal transaction.
    await platform.runInOwnedTransaction!(async owner => {assert.equal(owner.organizationId, undefined);}, () => {});
    await state.onInspect?.(); return structuredClone(source);
  }};
  const sourcePreview = new PreviewHeadlessModelSourceUseCase({organizationId, provider});
  const getSource = async () => {state.sourceResolutions++; return sourcePreview;};
  const reconciler = new OwnedTaskReconcilerService(); t.after(() => reconciler.stopObservation());
  const records = new Map<string, RuntimeTaskRecord>(), sourceControls: ApprovedModelSourceDownloadControl[] = [];
  const model = new ModelDownloadTasksUseCase({taskReconciler: reconciler, now: () => at,
    runtimeTaskRegistry: {async startTask() {assert.fail("No ordinary Model start.");}, async getTaskStatus() {assert.fail("No shared-ID lookup.");},
      async listTasks() {assert.fail("No task enumeration.");}, async cancelTask() {assert.fail("No generic cancellation.");}},
    modelRegistry: {async registerDownloadedModel() {state.registrations++; assert.fail("A separate save is required.");}} as never,
    modelDownloadCompletion: {async readCompletedModelDownload() {assert.fail("No ordinary completion.");}},
    approvedModelSourceDownload: {async startApprovedModelSource(request, control) {
      state.sourceStarts++; sourceControls.push(control);
      assert.equal(request.workspaceId, workspaceId); assert.deepEqual(request.sourceManifest.source, source);
      if (state.sourceOutcome === "unavailable") return {kind: "unavailable"};
      if (state.sourceOutcome === "unknown") throw new Error("private-source-start C:/private/worker");
      const record: RuntimeTaskRecord = {requestId: request.requestId, workspaceId, taskType: TaskType.MODEL_DOWNLOAD,
        concurrencyClass: "io", status: "running", updatedAt: at}; records.set(request.requestId, record);
      if (state.loseOutwardOnStart) {state.current = false; state.operationCurrent = false; state.ambientCurrent = false;}
      return {kind: "accepted", value: {requestId: request.requestId, status: "running"}, task: Object.freeze({
        requestId: request.requestId, workspaceId, modelId: source.modelId, revision: source.revision,
        manifestDigest: request.sourceManifest.manifestDigest,
        read: async () => {state.nativeReads++; return {...record};},
        cancel: async () => {state.nativeCancels++;
          await platform.runInOwnedTransaction!(async metadata => {assert.equal(metadata.organizationId, undefined);}, () => {});
          await state.onNativeCancel?.();
          return {requestId: request.requestId, status: record.status, cancelled: state.nativeCancellationAccepted};},
        readCompleted: async () => {await state.onCompletionRead?.(); return state.completionReady ? {provider: "transformers" as const, modelId: source.modelId, revision: source.revision,
          verifiedManifestDigest: request.sourceManifest.manifestDigest, downloaded: true, fromCache: false,
          localPath: join(directory, "synthetic-shared-cache-reference")} : undefined;}})};
    }}});
  const getStart = async () => {state.startResolutions++; await state.onResolveStart?.(); return model.startApprovedSource.bind(model);};
  const scope = {organizationId, workspaceId, principalId, registeredClientId};
  const grant = {...scope, planReview: true as const, operations: [], workspaceIds: [workspaceId] as const, isCurrent: () => state.current,
    isReadCurrent: () => state.readCurrent, isOperationCurrent: () => state.operationCurrent,
    get modelSourceRead() {return state.sourceConsent ? true as const : undefined;}};
  const registration = {...scope, purpose: "plan-review" as const, isCurrent: () => state.current,
    get modelSourceRead() {return state.sourceConsent ? true as const : undefined;}};
  const guardedAuthorization = {async authorizeWorkspaceOperation(input: Parameters<typeof authorization.authorizeWorkspaceOperation>[0]) {
    if (input.operation === "headless.models.cancel-download") {state.controlPolicies++; await state.onControlPolicy?.();}
    if (state.denyWrite && input.requiredScopes.includes("model:write")) throw new Error("Synthetic ModelWrite refusal.");
    return authorization.authorizeWorkspaceOperation(input);
  }};
  // This SQLite fixture serializes the same local metadata proof. It grants no PostgreSQL/real-host pass.
  const managedPlatform: StructuredDocumentStore = {...platform, async publishWithStableReads(check, publish) {
    return platform.runInOwnedTransaction!(async owner => await check(owner) && publish(), () => {});
  }};
  const systems = {composeHeadlessAuthoring() {state.authoringCalls++; assert.fail("Model review cannot dispatch an ordinary system command.");}};
  const peekModelDownloadTasks = () => {state.ownerLookups++; return state.modelOwnerAvailable ? model : undefined;};
  const peekModelReferenceSave = () => {state.ownerLookups++; return state.modelOwnerAvailable ? model : undefined;};
  const compose = (enabled = true, executes = false, hostProof = true, controls = executes, saves = false) => host === "Desktop"
    ? composeDesktopHeadlessPlanReview({hostIncarnationId, identity, platform, rootDirectory: directory, workspaces,
      authorization: guardedAuthorization, systems, isOpen: () => state.hostCurrent,
      ...(enabled ? {getModelSourcePreview: getSource} : {}), ...(executes ? {getModelDownloadStart: getStart} : {}),
      ...(controls ? {peekModelDownloadTasks} : {}), ...(saves ? {peekModelReferenceSave} : {})})
    : composeManagedHeadlessPlanReview({hostIncarnationId, platform: managedPlatform, rootDirectory: directory, workspaces,
      contexts, authorization: guardedAuthorization, placement, systems, ...(enabled ? {getModelSourcePreview: getSource} : {}),
      ...(executes ? {getModelDownloadStart: getStart} : {}), ...((executes || controls || saves) && hostProof ? {isModelHostCurrent: () => state.hostCurrent} : {}),
      ...(controls ? {peekModelDownloadTasks} : {}), ...(saves ? {peekModelReferenceSave} : {})});
  const input = {hostIncarnationId, workspaceId, steps: [{operation: "models.download", idempotencyKey: randomUUID(), name: "Small support model",
    sourceManifest: {source: structuredClone(source), manifestDigest: "sha256:" + createHash("sha256").update(JSON.stringify(source)).digest("hex")},
    allowedOrigins: ["https://huggingface.co"], maximumDurationSeconds: 1800}]};
  const capabilities = {allowLocalFileSave: false, allowModelDownload: true};
  const parsed = parseHeadlessBuildPlanProposal(input, hostIncarnationId, capabilities); assert.ok(parsed.ok);
  const fingerprint = createHash("sha256").update(JSON.stringify(parsed.preview)).digest("hex");
  const submit = readHeadlessPlanReviewAgentRequest({version: HEADLESS_CONTRACT_VERSION, operation: "plan.submit",
    input: {...input, fingerprint}}, hostIncarnationId, capabilities); assert.ok(submit.ok);
  const read = readHeadlessPlanReviewAgentRequest({version: HEADLESS_CONTRACT_VERSION, operation: "plan.status",
    input: {hostIncarnationId, workspaceId, fingerprint}}, hostIncarnationId, capabilities); assert.ok(read.ok);
  const owner = compose();
  const execute = (request = submit.request, selectedOwner = owner) => host === "Desktop"
    ? (selectedOwner as ReturnType<typeof composeDesktopHeadlessPlanReview>).execute(request, grant, async () => grant)
    : (selectedOwner as ReturnType<typeof composeManagedHeadlessPlanReview>)(request, registration, () => state.current && state.readCurrent);
  const target = {hostIncarnationId, scope, fingerprint}, selection = {workspaceId, registeredClientId, fingerprint};
  const makeDesktopApprovals = (enabled: boolean, saves = false) => composeDesktopHeadlessPlanApprovals({hostIncarnationId, identity, platform,
    rootDirectory: directory, isOpen: () => state.current, allowModelDownloadReview: enabled, allowModelReferenceSaveReview: saves,
    capturePlanReviewClients: async () => [{registeredClientId, isCurrent: () => state.current}]});
  const makeManagedApprovals = (enabled: boolean, saves = false) => composeManagedHeadlessPlanApprovals({hostIncarnationId, planClientId: registeredClientId,
    platform: managedPlatform, rootDirectory: directory, contexts, placement, allowModelDownloadReview: enabled, allowModelReferenceSaveReview: saves});
  const document = {hostIncarnationId, workspaceId, windowId: randomUUID(), uiIncarnationId: randomUUID()};
  return {host, state, input, parsed, submit: submit.request, read: read.request, target, selection, scope, source, platform, documents,
    repositories, membership, owner, compose, execute, makeDesktopApprovals, makeManagedApprovals, identity, document, getSource, grant, registration,
    model, reconciler, records, sourceControls, directory};
}

for (const host of ["Desktop", "Managed"] as const) for (const channel of ["app-popup", "authenticated-chat"] as const)
for (const mode of ["whole-plan", "each-change"] as const)
test(`${host}/${channel}/${mode}: current pinned metadata prepares one private review and trusted exact approval`, async t => {
  const f = await fixture(t, host);
  const submitted = await f.execute(); assert.ok(submitted.ok, JSON.stringify(submitted));
  assert.equal(submitted.value.status, "pending"); assert.equal(f.state.inspections, 1); assert.equal(f.state.sourceResolutions, 1);
  const permissions = await readStructuredHeadlessPlanModelPermission(f.documents, f.target);
  assert.deepEqual(permissions, {requiresModelRead: false, requiresArtifactWrite: false, requiresModelWrite: true});
  const decision = mode === "whole-plan" ? {kind: "approve" as const, mode} : {kind: "approve" as const, mode, step: 1};
  if (host === "Desktop") {
    const approvals = f.makeDesktopApprovals(true), caller = {channel, isCurrent: () => f.state.current};
    const opened = await approvals.open(f.selection, caller); assert.ok(opened.ok, JSON.stringify(opened));
    assert.equal(opened.snapshot.preview.steps[0].operation, "models.download");
    const outcome = await approvals.decide(f.selection, {fingerprint: f.target.fingerprint, expectedRevision: 1, decision}, caller);
    assert.ok(outcome.ok, JSON.stringify(outcome)); assert.equal(outcome.state.mode, mode);
  } else {
    const approvals = f.makeManagedApprovals(true);
    const opened = await approvals({operation: "open", document: f.document, selection: f.selection}, f.identity, () => true, () => true, channel);
    assert.ok(opened.ok && "value" in opened && typeof opened.value === "object" && opened.value && "viewId" in opened.value, JSON.stringify(opened));
    const outcome = await approvals({operation: "decide", document: f.document, decision: {selection: f.selection,
      viewId: opened.value.viewId, expectedRevision: 1, decision}}, f.identity, () => true, () => true, channel);
    assert.ok(outcome.ok, JSON.stringify(outcome));
    assert.ok("value" in outcome && typeof outcome.value === "object" && outcome.value && "mode" in outcome.value);
    assert.equal(outcome.value.mode, mode);
  }
  assert.ok((await f.execute(f.read)).ok); assert.equal(f.state.inspections, 1, "Stored reads/decisions perform no provider I/O.");
  assert.equal((f.owner as {allowModelDownload?: unknown}).allowModelDownload, undefined, "Private review does not advertise execution.");
  const step = {version: HEADLESS_CONTRACT_VERSION, operation: "plan.run-step" as const,
    input: {workspaceId: f.scope.workspaceId, hostIncarnationId: f.target.hostIncarnationId, fingerprint: f.target.fingerprint, approvalRevision: 2, step: 1}} as const;
  const outcome = host === "Desktop" ? await (f.owner as ReturnType<typeof composeDesktopHeadlessPlanReview>).runStep!(step, f.grant, async () => f.grant)
    : await (f.owner as ReturnType<typeof composeManagedHeadlessPlanReview>).runStep!(step, f.registration, () => true);
  assert.equal(outcome.result.ok, false, "Private review support must not activate the unqualified Model execution path.");
});

for (const host of ["Desktop", "Managed"] as const)
test(`${host}: source consent, read lifetime and ModelWrite deny before lazy provider resolution`, async t => {
  for (const variant of ["unconfigured", "consent", "read", "writer"] as const) {
    const f = await fixture(t, host);
    if (variant === "consent") f.state.sourceConsent = false;
    if (variant === "read") f.state.readCurrent = false;
    if (variant === "writer") f.state.denyWrite = true;
    const result = await f.execute(f.submit, variant === "unconfigured" ? f.compose(false) : f.owner);
    assert.equal(result.ok, false); assert.equal(f.state.sourceResolutions, 0); assert.equal(f.state.inspections, 0);
  }
});

for (const host of ["Desktop", "Managed"] as const)
test(`${host}: changed source, withdrawn consent/policy/read and private supplier failure never create an approvable review`, async t => {
  for (const variant of ["source", "consent", "read", "membership", "error"] as const) {
    const f = await fixture(t, host);
    f.state.onInspect = async () => {
      if (variant === "source") (f.source as {excludedFileCount: number}).excludedFileCount = 1;
      if (variant === "consent") f.state.sourceConsent = false;
      if (variant === "read") f.state.readCurrent = false;
      if (variant === "membership") await f.repositories.memberships.saveMembership({...f.membership, status: "removed"});
      if (variant === "error") throw new Error("private-token C:/private/provider-response");
    };
    const result = await f.execute(); assert.equal(result.ok, false);
    assert.doesNotMatch(JSON.stringify(result), /private-token|provider-response/);
    if (variant === "source") assert.equal(result.code, "headless.stale");
    assert.equal((await createStructuredHeadlessStoredPlanReviewRepository(f.platform, async () => true, Date.now, true)
      .read({target: f.target, isCurrent: () => true})).ok, false);
  }
});

for (const host of ["Desktop", "Managed"] as const)
test(`${host}: unconfigured approval and revoked membership cannot decide or disclose a stored Model review`, async t => {
  const f = await fixture(t, host); assert.ok((await f.execute()).ok);
  const caller = {channel: "app-popup" as const, isCurrent: () => true};
  if (host === "Desktop") {
    assert.equal((await f.makeDesktopApprovals(false).open(f.selection, caller)).ok, false);
    assert.ok((await f.makeDesktopApprovals(true).open(f.selection, caller)).ok);
    await f.repositories.memberships.saveMembership({...f.membership, status: "removed"});
    const result = await f.makeDesktopApprovals(true).decide(f.selection, {fingerprint: f.target.fingerprint,
      expectedRevision: 1, decision: {kind: "approve", mode: "whole-plan"}}, caller);
    assert.equal(result.ok, false);
  } else {
    assert.equal((await f.makeManagedApprovals(false)({operation: "open", document: f.document, selection: f.selection},
      f.identity, () => true, () => true)).ok, false);
    const approvals = f.makeManagedApprovals(true);
    const opened = await approvals({operation: "open", document: f.document, selection: f.selection}, f.identity, () => true, () => true);
    assert.ok(opened.ok && "value" in opened && typeof opened.value === "object" && opened.value && "viewId" in opened.value);
    await f.repositories.memberships.saveMembership({...f.membership, status: "removed"});
    assert.equal((await approvals({operation: "decide", document: f.document, decision: {selection: f.selection,
      viewId: opened.value.viewId, expectedRevision: 1, decision: {kind: "approve", mode: "whole-plan"}}}, f.identity, () => true, () => true)).ok, false);
  }
});

test("prepared host bindings reject changed target, step/order, name or duration and perform no provider I/O inside a transaction", async t => {
  const f = await fixture(t, "Desktop");
  const result = await prepareHeadlessModelDownloadReviews({target: f.target, requests: f.parsed.requests, getSource: f.getSource,
    isCurrent: () => f.state.current, stillAllowed: async () => true}); assert.ok(result.ok);
  const bind = (target = f.target, requests = f.parsed.requests) => f.platform.runInOwnedTransaction!(owner =>
    result.bind(owner.forOrganization(f.scope.organizationId), target, requests), () => {});
  assert.deepEqual(await bind(), [{step: 1, manifestDigest: f.input.steps[0].sourceManifest.manifestDigest}]);
  assert.equal(await bind({...f.target, fingerprint: "f".repeat(64)}), undefined);
  assert.equal(await bind({...f.target, scope: {...f.scope, registeredClientId: randomUUID()}}), undefined);
  for (const change of [{name: "Changed name"}, {maximumDurationSeconds: 1}]) {
    const requests = f.parsed.requests.map(request => request.operation === "models.download"
      ? {...request, input: {...request.input, ...change}} : request);
    assert.equal(await bind(f.target, requests), undefined);
  }
  assert.equal(f.state.inspections, 1); assert.equal(f.state.sourceResolutions, 1);
  f.state.current = false; assert.equal(await bind(), undefined);
});

for (const host of ["Desktop", "Managed"] as const)
test(`${host}: ordinary proposals keep their fingerprints and do not acquire Model consent or provider dependencies`, async t => {
  const f = await fixture(t, host); f.state.sourceConsent = false; f.state.denyWrite = true;
  const input = {hostIncarnationId: f.target.hostIncarnationId, workspaceId: f.scope.workspaceId,
    steps: [{operation: "systems.create", idempotencyKey: randomUUID(), name: "Ordinary support system", templateId: "reference.secured-data-review@1.0.0"}]};
  const legacy = parseHeadlessBuildPlanProposal(input, f.target.hostIncarnationId, {allowLocalFileSave: false});
  const opted = parseHeadlessBuildPlanProposal(input, f.target.hostIncarnationId, {allowLocalFileSave: false, allowModelDownload: true});
  assert.ok(legacy.ok && opted.ok); assert.deepEqual(legacy.preview, opted.preview);
  const fingerprint = createHash("sha256").update(JSON.stringify(legacy.preview)).digest("hex");
  const submit = readHeadlessPlanReviewAgentRequest({version: HEADLESS_CONTRACT_VERSION, operation: "plan.submit",
    input: {...input, fingerprint}}, f.target.hostIncarnationId); assert.ok(submit.ok);
  const result = await f.execute(submit.request); assert.ok(result.ok); assert.equal(result.value.fingerprint, fingerprint);
  const status = readHeadlessPlanReviewAgentRequest({version: HEADLESS_CONTRACT_VERSION, operation: "plan.status",
    input: {hostIncarnationId: f.target.hostIncarnationId, workspaceId: f.scope.workspaceId, fingerprint}}, f.target.hostIncarnationId);
  assert.ok(status.ok); assert.ok((await f.execute(status.request)).ok);
  assert.equal(f.state.inspections, 0); assert.equal(f.state.sourceResolutions, 0);
});

for (const host of ["Desktop", "Managed"] as const)
test(`${host}: stored Model status needs current source consent and ModelWrite without another provider call`, async t => {
  const f = await fixture(t, host); assert.ok((await f.execute()).ok);
  f.state.sourceConsent = false; assert.equal((await f.execute(f.read)).ok, false);
  f.state.sourceConsent = true; f.state.denyWrite = true; assert.equal((await f.execute(f.read)).ok, false);
  f.state.denyWrite = false; assert.ok((await f.execute(f.read)).ok);
  assert.equal(f.state.inspections, 1);
});

for (const host of ["Desktop", "Managed"] as const)
test(`${host}: a proposal changed during provider preparation cannot replace the reviewed request`, async t => {
  const f = await fixture(t, host); assert.equal(f.submit.operation, "plan.submit");
  if (f.submit.operation !== "plan.submit") assert.fail();
  const request = f.submit.proposal.requests[0]; assert.equal(request.operation, "models.download");
  if (request.operation !== "models.download") assert.fail();
  f.state.onInspect = async () => {(request.input as {name: string}).name = "Changed during preparation";};
  assert.equal((await f.execute()).ok, false);
  assert.equal((await createStructuredHeadlessStoredPlanReviewRepository(f.platform, async () => true, Date.now, true)
    .read({target: f.target, isCurrent: () => true})).ok, false);
});

test("active proposal values never reach a provider and stored-only approval has no proposal method", async t => {
  const f = await fixture(t, "Desktop"); let getterCalls = 0;
  const request = {get operation() {getterCalls++; return "models.download";}};
  const result = await prepareHeadlessModelDownloadReviews({target: f.target, requests: [request] as never,
    getSource: async () => {assert.fail("No provider for active input.");}, isCurrent: () => true, stillAllowed: async () => true});
  assert.equal(result.ok, false); assert.equal(getterCalls, 0);
  const stored = createStructuredHeadlessStoredPlanReviewRepository(f.platform, async () => true, Date.now, true);
  assert.deepEqual(Object.keys(stored).sort(), ["decide", "read"]);
});

async function approvedExecution(t: TestContext, host: Host, hostProof = true) {
  const f = await fixture(t, host), owner = f.compose(true, true, hostProof);
  assert.ok((await f.execute(f.submit, owner)).ok);
  const decision = {kind: "approve" as const, mode: "whole-plan" as const};
  if (host === "Desktop") {
    const approvals = f.makeDesktopApprovals(true), caller = {channel: "app-popup" as const, isCurrent: () => true};
    assert.ok((await approvals.open(f.selection, caller)).ok);
    assert.ok((await approvals.decide(f.selection, {fingerprint: f.target.fingerprint, expectedRevision: 1, decision}, caller)).ok);
  } else {
    const approvals = f.makeManagedApprovals(true);
    const opened = await approvals({operation: "open", document: f.document, selection: f.selection}, f.identity, () => true, () => true);
    assert.ok(opened.ok && "value" in opened && typeof opened.value === "object" && opened.value && "viewId" in opened.value);
    assert.ok((await approvals({operation: "decide", document: f.document, decision: {selection: f.selection,
      viewId: opened.value.viewId, expectedRevision: 1, decision}}, f.identity, () => true, () => true)).ok);
  }
  const request = {version: HEADLESS_CONTRACT_VERSION, operation: "plan.run-step" as const, input: {
    hostIncarnationId: f.target.hostIncarnationId, workspaceId: f.scope.workspaceId, fingerprint: f.target.fingerprint, approvalRevision: 2, step: 1}} as const;
  const run = () => host === "Desktop"
    ? (owner as ReturnType<typeof composeDesktopHeadlessPlanReview>).runStep!(request, f.grant, async () => f.grant)
    : (owner as ReturnType<typeof composeManagedHeadlessPlanReview>).runStep!(request, f.registration, () => f.state.current && f.state.operationCurrent);
  const attempt = () => f.platform.runInOwnedTransaction!(metadata => readStructuredModelPlanAttemptByPlan(
    metadata.forOrganization(f.scope.organizationId), f.scope, f.target.hostIncarnationId, f.target.fingerprint, 1), () => {});
  return {...f, owner, run, request, attempt};
}

async function reviewedSave(t: TestContext, host: Host, complete = true) {
  const f = await approvedExecution(t, host), started = await f.run(); assert.ok(started.result.ok);
  const accepted = await f.attempt(); assert.ok(accepted?.kind === "accepted"); const taskId = accepted.reference.taskId;
  if (complete) {
    f.state.completionReady = true; f.records.get(taskId)!.status = "succeeded";
    await f.reconciler.reconcileNow(); assert.equal(f.reconciler.status.pending, 0);
  }
  const capabilities = {allowLocalFileSave: false, allowModelReferenceSave: true};
  const input = {hostIncarnationId: f.target.hostIncarnationId, workspaceId: f.scope.workspaceId,
    steps: [{operation: "models.save-download", idempotencyKey: randomUUID(), taskId, name: "Reviewed support model",
      sourceManifest: structuredClone(f.input.steps[0].sourceManifest)}]};
  const parsed = parseHeadlessBuildPlanProposal(input, f.target.hostIncarnationId, capabilities); assert.ok(parsed.ok);
  const fingerprint = createHash("sha256").update(JSON.stringify(parsed.preview)).digest("hex");
  const submit = readHeadlessPlanReviewAgentRequest({version: HEADLESS_CONTRACT_VERSION, operation: "plan.submit",
    input: {...input, fingerprint}}, f.target.hostIncarnationId, capabilities); assert.ok(submit.ok);
  const owner = f.compose(true, false, true, false, true), selection = {...f.selection, fingerprint};
  const request = {...f.request, input: {...f.request.input, fingerprint}};
  const run = () => host === "Desktop" ? (owner as ReturnType<typeof composeDesktopHeadlessPlanReview>).runStep!(request, f.grant, async () => f.grant)
    : (owner as ReturnType<typeof composeManagedHeadlessPlanReview>).runStep!(request, f.registration, () => f.state.current && f.state.operationCurrent);
  const rows = async () => (await f.documents.readDocument<{models: unknown[]}>("model-registry", "models.json"))?.value.models ?? [];
  const approve = async (channel: "app-popup" | "authenticated-chat" = "app-popup", mode: "whole-plan" | "each-change" = "whole-plan", enabled = true,
    selected = selection) => {
    const fingerprint = selected.fingerprint;
    const decision = mode === "whole-plan" ? {kind: "approve" as const, mode} : {kind: "approve" as const, mode, step: 1};
    if (host === "Desktop") {
      const approvals = f.makeDesktopApprovals(false, enabled), caller = {channel, isCurrent: () => f.state.current};
      const opened = await approvals.open(selected, caller); if (!opened.ok) return opened;
      assert.equal(opened.snapshot.preview.steps[0].operation, "models.save-download");
      return approvals.decide(selected, {fingerprint, expectedRevision: 1, decision}, caller);
    }
    const approvals = f.makeManagedApprovals(false, enabled);
    const opened = await approvals({operation: "open", document: f.document, selection: selected}, f.identity, () => true, () => true, channel);
    if (!opened.ok) return opened;
    assert.ok("value" in opened && typeof opened.value === "object" && opened.value && "viewId" in opened.value);
    return approvals({operation: "decide", document: f.document, decision: {selection: selected, viewId: opened.value.viewId, expectedRevision: 1, decision}},
      f.identity, () => true, () => true, channel);
  };
  return {...f, owner, input, taskId, parsed, selection, saveSubmit: submit.request, saveRun: run, saveRows: rows, approveSave: approve};
}

for (const scope of ["model:read", "model:write"] as const)
for (const boundary of ["open", "decide", "publish-open", "publish-decision"] as const)
test(`Managed saved-model approval requires ${scope} at ${boundary}`, async t => {
  const f = await reviewedSave(t, "Managed");
  assert.ok((await f.execute(f.saveSubmit, f.owner)).ok);
  let deny = false, refusals = 0, published = 0;
  const original = AuthorizeWorkspaceOperationService.prototype.authorizeWorkspaceOperation;
  t.mock.method(AuthorizeWorkspaceOperationService.prototype, "authorizeWorkspaceOperation",
    async function(this: AuthorizeWorkspaceOperationService, input: Parameters<typeof original>[0]) {
      if (deny && input.requiredScopes.includes(scope)) {refusals++; throw new Error("Synthetic current Model policy refusal.");}
      return Reflect.apply(original, this, [input]);
    });
  const approvals = f.makeManagedApprovals(false, true);
  const channel = boundary === "decide" || boundary === "publish-decision" ? "authenticated-chat" : "app-popup";
  const open = () => approvals({operation: "open", document: f.document, selection: f.selection},
    f.identity, () => true, () => true, channel);
  if (boundary === "open") {
    deny = true;
    assert.equal((await open()).ok, false, "Missing current Model permission must refuse before disclosure.");
  } else {
    const opened = await open(); assert.ok(opened.ok && "value" in opened);
    const view = readDesktopPlanApprovalView(opened.value, f.selection, {allowLocalFileSave: false, allowModelReferenceSave: true});
    assert.ok(view, "The opened response must match the exact Model-save view contract.");
    if (boundary === "publish-open") {
      assert.equal(typeof opened.publishIfCurrent, "function", "Model save views need a current-policy publication fence.");
      deny = true;
      assert.equal(await opened.publishIfCurrent!(() => {published++; return true;}), false);
    } else {
      const mode = boundary === "decide" ? "each-change" as const : "whole-plan" as const;
      const decision = mode === "each-change" ? {kind: "approve" as const, mode, step: 1} : {kind: "approve" as const, mode};
      deny = boundary === "decide";
      const decided = await approvals({operation: "decide", document: f.document, decision: {
        selection: f.selection, viewId: view.viewId, expectedRevision: 1, decision}},
        f.identity, () => true, () => true, channel);
      if (boundary === "decide") {
        assert.equal(decided.ok, false, "Current Model permission is required to approve the saved reference.");
        deny = false;
        const latest = await open(); assert.ok(latest.ok && "value" in latest);
        const latestView = readDesktopPlanApprovalView(latest.value, f.selection, {allowLocalFileSave: false, allowModelReferenceSave: true});
        assert.ok(latestView, "The reopened response must still match the exact Model-save view contract.");
        assert.equal(latestView.state.status, "pending", "Refusal must not commit an approval.");
      } else {
        assert.ok(decided.ok);
        assert.equal(typeof decided.publishIfCurrent, "function", "Model decisions need a current-policy publication fence.");
        deny = true;
        assert.equal(await decided.publishIfCurrent!(() => {published++; return true;}), false);
      }
    }
  }
  assert.ok(refusals > 0, "The real host must request the missing Model scope from its authorization service.");
  assert.equal(published, 0);
  assert.deepEqual(await f.saveRows(), [], "Approval tests do not write a saved Model record.");
});

for (const mutation of ["replace", "mutate"] as const)
test(`Model save review captures the original target before first policy wait (${mutation})`, async t => {
  const f = await reviewedSave(t, "Desktop"); let enter!: () => void, release!: () => void, checks = 0, peeks = 0;
  const entered = new Promise<void>(resolve => {enter = resolve;}), held = new Promise<void>(resolve => {release = resolve;});
  const target = {hostIncarnationId: f.target.hostIncarnationId, fingerprint: f.selection.fingerprint,
    scope: {...f.scope, principalId: "principal.another-authorized-writer"}};
  const options = {documents: f.platform, target, requests: f.parsed.requests, isCurrent: () => true,
    stillAllowed: async () => {if (++checks === 1) {enter(); await held;} return true;}, peekOwner: () => {peeks++; return f.model;}};
  const pending = prepareHeadlessModelReferenceSaveReviews(options); await entered;
  if (mutation === "replace") options.target = {...target, scope: {...f.scope}};
  else target.scope.principalId = f.scope.principalId;
  release(); const result = await pending;
  assert.equal(result.ok, false, "The original writer owns no source task; changing the target after admission must not adopt another writer's result.");
  assert.equal(peeks, 0); assert.deepEqual(await f.saveRows(), []); assert.equal(f.state.sourceStarts, 1);
});

for (const host of ["Desktop", "Managed"] as const)
test(`${host}: save-only configuration refuses every effect in a plan containing an unsupported download`, async t => {
  const f = await reviewedSave(t, host), capabilities = {allowLocalFileSave: false, allowModelDownload: true};
  const input = {...f.input, steps: [{operation: "systems.create", idempotencyKey: randomUUID(), name: "Must not create a partial system",
    templateId: "reference.secured-data-review@1.0.0"}, {operation: "models.download", idempotencyKey: randomUUID(),
    name: "Unsupported later download", sourceManifest: f.input.steps[0].sourceManifest,
    allowedOrigins: ["https://huggingface.co"], maximumDurationSeconds: 10}]};
  const parsed = parseHeadlessBuildPlanProposal(input, f.target.hostIncarnationId, capabilities); assert.ok(parsed.ok);
  const fingerprint = createHash("sha256").update(JSON.stringify(parsed.preview)).digest("hex"), selection = {...f.selection, fingerprint};
  const submit = readHeadlessPlanReviewAgentRequest({version: HEADLESS_CONTRACT_VERSION, operation: "plan.submit",
    input: {...input, fingerprint}}, f.target.hostIncarnationId, capabilities); assert.ok(submit.ok);
  assert.ok((await f.execute(submit.request, f.owner)).ok, "Metadata review is separately configured; download execution is absent.");
  const decision = {kind: "approve" as const, mode: "whole-plan" as const};
  if (host === "Desktop") {
    const approvals = f.makeDesktopApprovals(true, true), caller = {channel: "app-popup" as const, isCurrent: () => true};
    assert.ok((await approvals.open(selection, caller)).ok);
    assert.ok((await approvals.decide(selection, {fingerprint, expectedRevision: 1, decision}, caller)).ok);
  } else {
    const approvals = f.makeManagedApprovals(true, true), opened = await approvals({operation: "open", document: f.document, selection}, f.identity, () => true, () => true);
    assert.ok(opened.ok && "value" in opened && typeof opened.value === "object" && opened.value && "viewId" in opened.value);
    assert.ok((await approvals({operation: "decide", document: f.document, decision: {selection,
      viewId: opened.value.viewId, expectedRevision: 1, decision}}, f.identity, () => true, () => true)).ok);
  }
  const request = {...f.request, input: {...f.request.input, fingerprint, step: 1}};
  const result = host === "Desktop" ? await (f.owner as ReturnType<typeof composeDesktopHeadlessPlanReview>).runStep!(request, f.grant, async () => f.grant)
    : await (f.owner as ReturnType<typeof composeManagedHeadlessPlanReview>).runStep!(request, f.registration, () => true);
  assert.equal(result.result.ok, false); assert.equal(f.state.authoringCalls, 0, "No ordinary writer is constructed before the unsupported family is rejected.");
  assert.equal(f.state.sourceStarts, 1); assert.deepEqual(await f.saveRows(), []);
});

for (const host of ["Desktop", "Managed"] as const) for (const channel of ["app-popup", "authenticated-chat"] as const)
for (const mode of ["whole-plan", "each-change"] as const)
test(`${host}/${channel}/${mode}: separate approved save registers one private reference and publishes/replays without another download`, async t => {
  const f = await reviewedSave(t, host); assert.deepEqual(await f.saveRows(), []);
  const before = {inspections: f.state.inspections, starts: f.state.sourceStarts, reads: f.state.nativeReads, resolves: f.state.startResolutions};
  assert.equal((await f.saveRun()).result.ok, false, "The old download approval does not authorize a fresh save.");
  const submitted = await f.execute(f.saveSubmit, f.owner); assert.ok(submitted.ok, JSON.stringify(submitted));
  assert.equal((await f.approveSave(channel, mode, false)).ok, false, "Stored-only approval remains separately opt-in.");
  assert.ok((await f.approveSave(channel, mode)).ok);
  const saved = await f.saveRun(); assert.ok(saved.result.ok, JSON.stringify(saved));
  assert.equal(saved.result.value.kind, "committed"); assert.ok("operation" in saved.result.value);
  assert.equal(saved.result.value.operation, "models.save-download"); assert.equal((await f.saveRows()).length, 1);
  assert.doesNotMatch(JSON.stringify(saved.result), /localPath|synthetic-shared-cache-reference|principal|registeredClientId|sourceManifest/);
  let publications = 0; assert.equal(await saved.publishIfCurrent?.(() => {publications++; return true;}), true); assert.equal(publications, 1);
  f.state.modelOwnerAvailable = false;
  const replay = await f.saveRun(); assert.ok(replay.result.ok, JSON.stringify(replay)); assert.equal(replay.result.value.kind, "replayed");
  assert.deepEqual(replay.result.value.reference, saved.result.value.reference); assert.equal((await f.saveRows()).length, 1);
  assert.deepEqual({inspections: f.state.inspections, starts: f.state.sourceStarts, reads: f.state.nativeReads, resolves: f.state.startResolutions}, before);
  assert.equal(f.state.registrations, 0, "The ordinary registration fallback is never used.");
  await f.repositories.memberships.saveMembership({...f.membership, status: "removed"});
  assert.equal(await replay.publishIfCurrent?.(() => {publications++; return true;}), false); assert.equal(publications, 1);
  assert.equal((await f.saveRun()).result.ok, false); assert.equal((await f.saveRows()).length, 1);
});

for (const host of ["Desktop", "Managed"] as const)
test(`${host}: pending completion, missing source consent, ModelWrite and unconfigured save cannot become approvable metadata`, async t => {
  for (const variant of ["pending", "consent", "read", "writer", "unconfigured", "unloaded", "host"] as const) {
    const f = await reviewedSave(t, host, variant !== "pending");
    if (variant === "consent") f.state.sourceConsent = false; if (variant === "read") f.state.readCurrent = false;
    if (variant === "writer") f.state.denyWrite = true; if (variant === "unloaded") f.state.modelOwnerAvailable = false;
    if (variant === "host") f.state.hostCurrent = false;
    const result = await f.execute(f.saveSubmit, variant === "unconfigured" ? f.compose() : f.owner);
    assert.equal(result.ok, false, variant); assert.deepEqual(await f.saveRows(), []); assert.equal(f.state.registrations, 0);
    assert.doesNotMatch(JSON.stringify(result), /synthetic-shared-cache|localPath/);
  }
});

for (const host of ["Desktop", "Managed"] as const)
test(`${host}: foreign task/client or a different source manifest denies before looking up the loaded Model owner`, async t => {
  for (const variant of ["task", "client", "source"] as const) {
    const f = await reviewedSave(t, host), input = structuredClone(f.input);
    if (variant === "task") input.steps[0].taskId = randomUUID();
    if (variant === "client") {
      if (host === "Desktop") f.grant.registeredClientId = randomUUID(); else f.registration.registeredClientId = randomUUID();
    }
    if (variant === "source") {
      input.steps[0].sourceManifest.source = {...input.steps[0].sourceManifest.source, modelId: "fixture/other-model"};
      input.steps[0].sourceManifest.manifestDigest = "sha256:" + createHash("sha256").update(JSON.stringify(input.steps[0].sourceManifest.source)).digest("hex");
    }
    const caps = {allowLocalFileSave: false, allowModelReferenceSave: true};
    const parsed = parseHeadlessBuildPlanProposal(input, f.target.hostIncarnationId, caps); assert.ok(parsed.ok);
    const fingerprint = createHash("sha256").update(JSON.stringify(parsed.preview)).digest("hex");
    const request = readHeadlessPlanReviewAgentRequest({version: HEADLESS_CONTRACT_VERSION, operation: "plan.submit", input: {...input, fingerprint}},
      f.target.hostIncarnationId, caps); assert.ok(request.ok);
    const lookups = f.state.ownerLookups; assert.equal((await f.execute(request.request, f.owner)).ok, false);
    assert.equal(f.state.ownerLookups, lookups); assert.deepEqual(await f.saveRows(), []); assert.equal(f.state.sourceStarts, 1);
  }
});

for (const host of ["Desktop", "Managed"] as const)
test(`${host}: actual membership revocation during cached preparation rolls back an approved save`, async t => {
  const f = await reviewedSave(t, host); assert.ok((await f.execute(f.saveSubmit, f.owner)).ok); assert.ok((await f.approveSave()).ok);
  f.state.onCompletionRead = async () => {await f.repositories.memberships.saveMembership({...f.membership, status: "removed"});};
  const result = await f.saveRun(); assert.equal(result.result.ok, false); assert.deepEqual(await f.saveRows(), []);
  assert.equal((await f.documents.listDocuments("headless/models/reference-saves")).length, 0);
  assert.equal((await f.documents.listDocuments("headless/models/reference-save-sources")).length, 0);
  assert.equal(f.state.sourceStarts, 1); assert.equal(f.state.registrations, 0);
});

for (const host of ["Desktop", "Managed"] as const)
test(`${host}: a later user edit prevents saved-reference publication/replay and is never overwritten`, async t => {
  const f = await reviewedSave(t, host); assert.ok((await f.execute(f.saveSubmit, f.owner)).ok); assert.ok((await f.approveSave()).ok);
  const saved = await f.saveRun(); assert.ok(saved.result.ok);
  const row = await f.documents.readDocument<{models: ModelInventoryRecord[]}>("model-registry", "models.json"); assert.ok(row);
  const edited = {...row.value, models: row.value.models.map(model => ({...model, displayName: "User-edited library model"}))};
  await f.documents.writeDocument("model-registry", "models.json", edited, {expectedRevision: row.revision});
  let sends = 0; assert.equal(await saved.publishIfCurrent?.(() => {sends++; return true;}), false); assert.equal(sends, 0);
  f.state.modelOwnerAvailable = false; assert.equal((await f.saveRun()).result.ok, false);
  assert.deepEqual(await f.saveRows(), edited.models); assert.equal(f.state.sourceStarts, 1); assert.equal(f.state.registrations, 0);
});

for (const host of ["Desktop", "Managed"] as const)
test(`${host}: expired exact save approval cannot write a library reference`, async t => {
  const f = await reviewedSave(t, host); assert.ok((await f.execute(f.saveSubmit, f.owner)).ok); assert.ok((await f.approveSave()).ok);
  const original = Date.now, expired = original() + 20 * 60 * 1000;
  try {Date.now = () => expired; assert.equal((await f.saveRun()).result.ok, false);} finally {Date.now = original;}
  assert.deepEqual(await f.saveRows(), []); assert.equal(f.state.sourceStarts, 1);
});

for (const host of ["Desktop", "Managed"] as const)
test(`${host}: a later plan step waits for the exact saved reference; legacy owners cannot inherit Model saving`, async t => {
  const f = await reviewedSave(t, host), capabilities = {allowLocalFileSave: false, allowModelReferenceSave: true};
  const input = {...f.input, steps: [...f.input.steps, {operation: "systems.create", idempotencyKey: randomUUID(),
    name: "System after model review", templateId: "reference.secured-data-review@1.0.0"}]};
  const parsed = parseHeadlessBuildPlanProposal(input, f.target.hostIncarnationId, capabilities); assert.ok(parsed.ok);
  const fingerprint = createHash("sha256").update(JSON.stringify(parsed.preview)).digest("hex");
  const submit = readHeadlessPlanReviewAgentRequest({version: HEADLESS_CONTRACT_VERSION, operation: "plan.submit",
    input: {...input, fingerprint}}, f.target.hostIncarnationId, capabilities); assert.ok(submit.ok);
  assert.ok((await f.execute(submit.request, f.owner)).ok);
  assert.ok((await f.approveSave("app-popup", "whole-plan", true, {...f.selection, fingerprint})).ok);
  const query = {target: {...f.target, fingerprint}, approvalRevision: 2, step: 2, isCurrent: () => true};
  const preparation: Parameters<typeof prepareStructuredHeadlessPlanStepWithModels> = [f.platform, query, async () => true, Date.now,
    "serialized-owner", false, undefined, undefined, undefined, undefined, f.directory, undefined, false, true];
  assert.equal(await prepareStructuredHeadlessPlanStepWithModels(...preparation), undefined, "No ordinary system step before the causal save receipt.");
  const request = {...f.request, input: {...f.request.input, fingerprint, step: 1}};
  const saved = host === "Desktop" ? await (f.owner as ReturnType<typeof composeDesktopHeadlessPlanReview>).runStep!(request, f.grant, async () => f.grant)
    : await (f.owner as ReturnType<typeof composeManagedHeadlessPlanReview>).runStep!(request, f.registration, () => true);
  assert.ok(saved.result.ok, JSON.stringify(saved));
  assert.equal((await prepareStructuredHeadlessPlanStepWithModels(...preparation))?.kind, "system");
  assert.equal(await prepareStructuredHeadlessPlanStep(...preparation), undefined, "An old owner never borrows the new opt-in.");
  assert.equal((await f.saveRows()).length, 1); assert.equal(f.state.sourceStarts, 1);
});

for (const host of ["Desktop", "Managed"] as const)
test(`${host}: private approved execution starts one captured source and replays without resolving runtime`, async t => {
  const f = await approvedExecution(t, host);
  f.state.readCurrent = false; // The short metadata-read lifetime is not download-start lifetime.
  const first = await f.run(); assert.ok(first.result.ok, JSON.stringify(first));
  assert.equal(first.result.value.kind, "started"); assert.equal(f.state.sourceStarts, 1); assert.equal(f.state.startResolutions, 1);
  const accepted = await f.attempt(); assert.ok(accepted?.kind === "accepted");
  assert.deepEqual(first.result.value.reference, accepted.reference);
  const replay = await f.run(); assert.ok(replay.result.ok); assert.equal(replay.result.value.kind, "replayed");
  assert.equal(f.state.sourceStarts, 1); assert.equal(f.state.startResolutions, 1); assert.equal(f.state.registrations, 0);
  assert.equal(await f.sourceControls[0].stillAllowed(), true);
  f.records.get(accepted.reference.taskId)!.status = "succeeded";
  await f.reconciler.reconcileNow(); assert.equal(f.reconciler.status.pending, 0);
  assert.equal((f.owner as {allowModelDownload?: unknown}).allowModelDownload, undefined);
});

for (const host of ["Desktop", "Managed"] as const)
test(`${host}: accepted task and original business policy outlive the caller and ambient request context`, async t => {
  const f = await approvedExecution(t, host); f.state.loseOutwardOnStart = true;
  const result = await f.run(); assert.deepEqual(result.result, {ok: false, code: "headless.forbidden"});
  const accepted = await f.attempt(); assert.ok(accepted?.kind === "accepted");
  assert.equal(f.sourceControls[0].isCurrent(), true); assert.equal(await f.sourceControls[0].stillAllowed(), true);
  const observed = await runOwnedHeadlessModelDownloadTask({documents: f.platform, hostIncarnationId: f.target.hostIncarnationId,
    scope: f.scope, selection: {kind: "plan-step", fingerprint: f.target.fingerprint, step: 1}, action: "read",
    isCurrent: () => true, authorize: async () => true, peekOwner: () => f.model});
  assert.ok(observed.ok); assert.equal(observed.value.taskId, accepted.reference.taskId);
  await f.repositories.memberships.saveMembership({...f.membership, status: "removed"});
  assert.equal(await f.sourceControls[0].stillAllowed(), false, "Business policy rereads the original actor's real membership.");
  f.records.get(accepted.reference.taskId)!.status = "cancelled";
  await f.reconciler.reconcileNow(); assert.equal(f.reconciler.status.pending, 0); assert.equal(f.state.registrations, 0);
});

for (const host of ["Desktop", "Managed"] as const)
test(`${host}: retired operation, host or policy cannot enter or reserve a Model download`, async t => {
  for (const stage of ["operation", "host", "policy", "during-resolution"] as const) {
    const f = await approvedExecution(t, host);
    if (stage === "operation") f.state.operationCurrent = false;
    if (stage === "host") f.state.hostCurrent = false;
    if (stage === "policy") f.state.denyWrite = true;
    if (stage === "during-resolution") f.state.onResolveStart = async () => {f.state.operationCurrent = false;};
    assert.equal((await f.run()).result.ok, false);
    assert.equal(f.state.sourceStarts, 0); assert.equal(await f.attempt(), undefined); assert.equal(f.reconciler.status.pending, 0);
  }
});

test("Desktop Model execution requires a distinct trusted operation fence; Managed requires independent host proof", async t => {
  const desktop = await approvedExecution(t, "Desktop");
  const grant = {...desktop.grant, isOperationCurrent: undefined};
  assert.equal((await (desktop.owner as ReturnType<typeof composeDesktopHeadlessPlanReview>).runStep!(desktop.request, grant,
    async () => grant)).result.ok, false); assert.equal(desktop.state.startResolutions, 0);
  const managed = await approvedExecution(t, "Managed", false);
  assert.equal((await managed.run()).result.ok, false); assert.equal(managed.state.startResolutions, 0);
});

test("the original Desktop operation callback cannot be replaced during held owner resolution", async t => {
  const f = await approvedExecution(t, "Desktop"); let originalCurrent = true;
  f.grant.isOperationCurrent = () => originalCurrent;
  let entered!: () => void, release!: () => void;
  const resolving = new Promise<void>(resolve => {entered = resolve;});
  const held = new Promise<void>(resolve => {release = resolve;}); t.after(() => release());
  f.state.onResolveStart = async () => {entered(); await held;};
  const pending = f.run(); await resolving;
  originalCurrent = false; f.grant.isOperationCurrent = () => true; release();
  const result = await pending;
  assert.equal(f.state.sourceStarts, 0, "Replacing a request callback cannot revive its original stopped operation.");
  assert.equal(result.result.ok, false); assert.equal(await f.attempt(), undefined);
});

test("the original Desktop metadata callback cannot be replaced during held provider observation", async t => {
  const f = await fixture(t, "Desktop"); let originalCurrent = true;
  f.grant.isReadCurrent = () => originalCurrent;
  let entered!: () => void, release!: () => void;
  const observing = new Promise<void>(resolve => {entered = resolve;});
  const held = new Promise<void>(resolve => {release = resolve;}); t.after(() => release());
  f.state.onInspect = async () => {entered(); await held;};
  const pending = f.execute(); await observing;
  originalCurrent = false; f.grant.isReadCurrent = () => true; release();
  const result = await pending;
  assert.equal(result.ok, false, "Replacing a read callback cannot revive its original stopped metadata request.");
  assert.equal((await createStructuredHeadlessStoredPlanReviewRepository(f.platform, async () => true, Date.now, true)
    .read({target: f.target, isCurrent: () => true})).ok, false);
});

for (const host of ["Desktop", "Managed"] as const)
test(`${host}: known non-start stays terminal and unknown source cannot become discovery or a retry`, async t => {
  for (const outcome of ["unavailable", "unknown"] as const) {
    const f = await approvedExecution(t, host); f.state.sourceOutcome = outcome;
    const first = await f.run();
    assert.deepEqual(first.result, {ok: false, code: outcome === "unavailable" ? "headless.not-started" : "headless.operation-unconfirmed"});
    assert.deepEqual(await f.attempt(), {kind: outcome === "unavailable" ? "not-started" : "unconfirmed"});
    f.state.sourceOutcome = "accepted";
    const replay = await f.run(); assert.equal(replay.result.ok, false);
    assert.equal(f.state.startResolutions, 1); assert.equal(f.state.sourceStarts, 1); assert.equal(f.state.nativeReads, 0);
    assert.equal(f.reconciler.status.pending, outcome === "unavailable" ? 0 : 1);
    assert.doesNotMatch(JSON.stringify(first), /private-source-start|private\/worker/);
  }
});

async function cancellableExecution(t: TestContext, host: Host) {
  const f = await approvedExecution(t, host);
  assert.ok((await f.run()).result.ok);
  const accepted = await f.attempt(); assert.ok(accepted?.kind === "accepted");
  // A retained task can be controlled without enabling any new source start.
  const controller = f.compose(true, false, true, true);
  const request = {version: HEADLESS_CONTRACT_VERSION, operation: "models.cancel-download" as const, input: {
    hostIncarnationId: f.target.hostIncarnationId, workspaceId: f.scope.workspaceId,
    selection: {kind: "task" as const, taskId: accepted.reference.taskId}}};
  const cancel = (incoming: unknown = request) => host === "Desktop"
    ? (controller as ReturnType<typeof composeDesktopHeadlessPlanReview>).cancelModelDownload!(incoming, f.grant, async () => f.grant)
    : (controller as ReturnType<typeof composeManagedHeadlessPlanReview>).cancelModelDownload!(incoming, f.registration,
      () => f.state.operationCurrent);
  return {...f, controller, taskId: accepted.reference.taskId, cancelRequest: request, cancel};
}

for (const host of ["Desktop", "Managed"] as const) {
  for (const selected of ["task", "plan-step"] as const)
  test(host + ": original " + selected + " cancellation acknowledges without claiming native settlement", async t => {
    const f = await cancellableExecution(t, host);
    f.state.readCurrent = false; f.state.sourceConsent = false;
    const input = {...f.cancelRequest.input, selection: selected === "task" ? f.cancelRequest.input.selection
      : {kind: "plan-step" as const, fingerprint: f.target.fingerprint, step: 1}};
    const result = await f.cancel({...f.cancelRequest, input});
    assert.ok(result.ok, JSON.stringify(result));
    assert.deepEqual(result.value, {workspaceId: f.scope.workspaceId, taskId: f.taskId,
      plan: {fingerprint: f.target.fingerprint, step: 1}, state: "running", percent: null,
      registration: "requires-separate-approval", runtimeReadiness: "not-checked", cancellationAccepted: true});
    assert.equal(f.state.nativeCancels, 1); assert.equal(f.state.sourceStarts, 1); assert.equal(f.state.startResolutions, 1);
    assert.equal(f.state.registrations, 0); assert.equal(f.reconciler.status.pending, 1);
    assert.equal(await f.sourceControls[0].stillAllowed(), true);
    f.records.get(f.taskId)!.status = "cancelled"; await f.reconciler.reconcileNow();
    assert.equal(f.reconciler.status.pending, 0);
  });

  test(host + ": current policy, request, host, original client and exact task constrain cancellation", async t => {
    for (const denied of ["write", "request", "host", "client", "task", "plan", "membership"] as const) {
      const f = await cancellableExecution(t, host);
      let request = f.cancelRequest as unknown;
      if (denied === "write") f.state.denyWrite = true;
      if (denied === "request") f.state.operationCurrent = false;
      if (denied === "host") f.state.hostCurrent = false;
      if (denied === "client") {f.grant.registeredClientId = randomUUID(); f.registration.registeredClientId = f.grant.registeredClientId;}
      if (denied === "task") request = {...f.cancelRequest, input: {...f.cancelRequest.input, selection: {kind: "task", taskId: randomUUID()}}};
      if (denied === "plan") request = {...f.cancelRequest, input: {...f.cancelRequest.input,
        selection: {kind: "plan-step", fingerprint: "b".repeat(64), step: 1}}};
      if (denied === "membership") await f.repositories.memberships.saveMembership({...f.membership, status: "removed"});
      assert.equal((await f.cancel(request)).ok, false);
      assert.equal(f.state.nativeCancels, 0); assert.equal(f.state.ownerLookups, 0);
      assert.equal(f.state.sourceStarts, 1); assert.equal(f.state.registrations, 0);
    }
  });

  test(host + ": unavailable loaded owner does not initialize or substitute a source", async t => {
    const f = await cancellableExecution(t, host); f.state.modelOwnerAvailable = false;
    assert.deepEqual(await f.cancel(), {ok: false, code: "headless.unavailable"});
    assert.equal(f.state.nativeCancels, 0); assert.equal(f.state.sourceStarts, 1); assert.equal(f.state.startResolutions, 1);
  });

  test(host + ": request selector is detached before policy awaits", {timeout: 5000}, async t => {
    const f = await cancellableExecution(t, host);
    let entered!: () => void, release!: () => void;
    const started = new Promise<void>(resolve => {entered = resolve;});
    const pending = new Promise<void>(resolve => {release = resolve;});
    f.state.onControlPolicy = async () => {if (f.state.controlPolicies === 1) {entered(); await pending;}};
    const request = structuredClone(f.cancelRequest);
    const result = f.cancel(request); await started;
    request.input.selection.taskId = randomUUID();
    release();
    const cancelled = await result; assert.ok(cancelled.ok, JSON.stringify(cancelled));
    assert.equal(cancelled.value.taskId, f.taskId); assert.equal(f.state.nativeCancels, 1);
  });

  test(host + ": final source-admission policy cannot revive a retired operation by replacing its callback", {timeout: 5000}, async t => {
    const f = await cancellableExecution(t, host);
    let entered!: () => void, release!: () => void;
    const started = new Promise<void>(resolve => {entered = resolve;});
    const pending = new Promise<void>(resolve => {release = resolve;});
    f.state.onControlPolicy = async () => {if (f.state.controlPolicies === 2) {entered(); await pending;}};
    const result = f.cancel(); await started;
    f.state.operationCurrent = false;
    f.grant.isOperationCurrent = () => true;
    f.registration.isCurrent = () => true;
    release(); assert.equal((await result).ok, false);
    assert.equal(f.state.nativeCancels, 0); assert.equal(f.state.sourceStarts, 1);
  });

  test(host + ": captured registration callback cannot be replaced during final cancellation admission", {timeout: 5000}, async t => {
    const f = await cancellableExecution(t, host);
    let entered!: () => void, release!: () => void;
    const started = new Promise<void>(resolve => {entered = resolve;});
    const pending = new Promise<void>(resolve => {release = resolve;});
    f.state.onControlPolicy = async () => {if (f.state.controlPolicies === 2) {entered(); await pending;}};
    const result = f.cancel(); await started;
    f.state.current = false; f.grant.isCurrent = () => true; f.registration.isCurrent = () => true;
    release(); assert.equal((await result).ok, false);
    assert.equal(f.state.operationCurrent, true); assert.equal(f.state.hostCurrent, true); assert.equal(f.state.nativeCancels, 0);
  });

  test(host + ": a declined cancellation acknowledgement is distinct from stopped work", async t => {
    const f = await cancellableExecution(t, host); f.state.nativeCancellationAccepted = false;
    const result = await f.cancel(); assert.ok(result.ok);
    assert.equal(result.value.cancellationAccepted, false); assert.equal(result.value.state, "running");
    assert.equal(f.state.nativeCancels, 1); assert.equal(f.reconciler.status.pending, 1); assert.equal(f.state.registrations, 0);
  });

  test(host + ": lost or withdrawn cancellation reply is unconfirmed with independent task custody", async t => {
    for (const failure of ["lost", "withdrawn"] as const) {
      const f = await cancellableExecution(t, host);
      f.state.onNativeCancel = async () => {
        if (failure === "lost") throw new Error("private/source/path cancellation failure");
        f.state.operationCurrent = false; f.state.current = false;
      };
      const result = await f.cancel();
      assert.deepEqual(result, {ok: false, code: "headless.operation-unconfirmed"});
      assert.equal(f.state.nativeCancels, 1); assert.equal(f.state.sourceStarts, 1); assert.equal(f.state.registrations, 0);
      assert.equal(f.reconciler.status.pending, 1);
      assert.equal(f.sourceControls[0].isCurrent(), true);
      assert.equal(await f.sourceControls[0].stillAllowed(), true);
    }
  });

  test(host + ": absent private control configuration exposes no cancellation handler", async t => {
    const f = await fixture(t, host);
    assert.equal(f.compose(true, false).cancelModelDownload, undefined);
    if (host === "Managed") assert.equal(f.compose(true, false, false, true).cancelModelDownload, undefined);
    assert.equal(f.state.nativeCancels, 0); assert.equal(f.state.sourceStarts, 0); assert.equal(f.state.ownerLookups, 0);
  });
}

test("Desktop cancellation refuses asynchronous latest authority callbacks without unhandled rejections", async t => {
  for (const field of ["isCurrent", "isOperationCurrent"] as const) {
    const f = await cancellableExecution(t, "Desktop");
    const latest = {...f.grant, [field]: () => Promise.reject(new Error("private callback rejection"))};
    const result = await (f.controller as ReturnType<typeof composeDesktopHeadlessPlanReview>).cancelModelDownload!(
      f.cancelRequest, f.grant, async () => latest as never);
    assert.deepEqual(result, {ok: false, code: "headless.forbidden"});
    assert.equal(f.state.nativeCancels, 0); assert.equal(f.state.ownerLookups, 0);
    await new Promise<void>(resolve => setImmediate(resolve));
  }
});
