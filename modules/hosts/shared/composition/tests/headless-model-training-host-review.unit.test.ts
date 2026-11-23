import assert from "node:assert/strict";
import {createHash, randomUUID} from "node:crypto";
import {lstat, mkdtemp, realpath, rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {dirname, join} from "node:path";
import test, {type TestContext} from "node:test";
import {HEADLESS_CONTRACT_VERSION, isHeadlessHostIncarnationId, parseHeadlessBuildPlanProposal, readHeadlessPlanReviewAgentRequest,
  type HeadlessHostIncarnationId} from "../../../../contracts/headless";
import {createOrganizationId} from "../../../../contracts/organization";
import {createWorkspaceId} from "../../../../contracts/workspace";
import {createTenantPlacementConfig} from "../../../../contracts/config";
import {normalizeDatasetVersionRecord} from "../../../../contracts/dataset";
import type {SecurityScope} from "../../../../contracts/security";
import {createInMemoryStructuredDocumentStore, type StructuredDocumentStore} from "../../../../adapters/persistence/shared";
import {openLocalSqliteDatabase, resolveLocalSqliteDatabasePolicy} from "../../../../adapters/persistence/sqlite";
import {createStructuredOrganizationRepositories} from "../../../../adapters/persistence/organization";
import {createLocalWorkspaceRepository} from "../../../../adapters/persistence/workspace";
import {createLocalModelRegistryAdapter} from "../../../../adapters/persistence/model";
import {createStructuredDatasetVersionRepository} from "../../../../adapters/persistence/dataset-version";
import {DATASET_VERSION_NAMESPACE} from "../../../../adapters/persistence/dataset-version/createStructuredDatasetVersionRepository";
import {createStructuredHeadlessPlanReviewRepository, readStructuredHeadlessPlanModelPermission,
  readStructuredHeadlessTrainingPlanReview, readStructuredHeadlessTrainingPlanPermission} from "../../../../adapters/persistence/system-builder/createStructuredHeadlessPlanReviewRepository";
import {AuthorizeWorkspaceOperationService, createOrganizationAuthorizationPolicy} from "../../../../application/services/security";
import {version as datasetFixture} from "../../../../application/use-cases/dataset-version/tests/headless-dataset-metadata.fixture";
import {prepareHeadlessModelTrainingReviews} from "../headlessModelTrainingReview";
import {composeDesktopHeadlessPlanReview} from "../../../desktop/composition/composeDesktopHeadlessPlanReview";
import {composeDesktopHeadlessPlanApprovals} from "../../../desktop/composition/composeDesktopHeadlessPlanApprovals";
import {composeManagedHeadlessPlanReview} from "../../../server/composition/composeManagedHeadlessPlanReview";
import {composeManagedHeadlessPlanApprovals} from "../../../server/composition/composeManagedHeadlessPlanApprovals";
import {composeHeadlessTrainingPlanInputs, HEADLESS_TRAINING_REVIEW_SCOPES, verifyHeadlessTrainingReviewInputs,
  verifyStoredHeadlessTrainingReviewInputs, captureHeadlessTrainingMethod} from "../headlessTrainingPlanInputs";

const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

async function fixture(t: TestContext, storage: "Core" | "SQLite", stepCount: 1 | 2 = 1, emptyTags = false) {
  const boundary = await realpath(tmpdir()), directory = await realpath(await mkdtemp(join(boundary, "tapproval-")));
  const identity = await lstat(directory, {bigint: true});
  const database = storage === "SQLite" ? await openLocalSqliteDatabase({policy: resolveLocalSqliteDatabasePolicy({dataRootDirectory: directory})}) : undefined;
  t.after(async () => {
    await database?.close();
    const current = await lstat(directory, {bigint: true});
    assert.equal(dirname(directory), boundary); assert.equal(await realpath(directory), directory);
    assert.ok(current.isDirectory() && !current.isSymbolicLink()); assert.equal(current.dev, identity.dev); assert.equal(current.ino, identity.ino);
    // Only this fresh document-only fixture exists here. No model or worker.
    await rm(directory, {recursive: true});
  });
  const base = database?.documents ?? createInMemoryStructuredDocumentStore(), transaction = base.runInOwnedTransaction!.bind(base);
  let transactionDepth = 0;
  const platform = Object.create(base) as StructuredDocumentStore;
  Object.defineProperty(platform, "runInOwnedTransaction", {value: async <T,>(visit: (owner: StructuredDocumentStore) => Promise<T>, fence: () => void) =>
    transaction(async owner => {transactionDepth++; try {return await visit(owner);} finally {transactionDepth--; }}, fence)});
  const managedPlatform = Object.create(platform) as StructuredDocumentStore;
  Object.defineProperty(managedPlatform, "publishWithStableReads", {value: async (check: (owner: StructuredDocumentStore) => Promise<boolean>, publish: () => boolean) =>
    platform.runInOwnedTransaction!(async owner => await check(owner) && publish(), () => {})});
  const organizationId = createOrganizationId("org.training-approval"), workspaceId = createWorkspaceId("workspace.training-approval");
  const principalId = "principal.synthetic", registeredClientId = randomUUID(), candidateHost = randomUUID();
  assert.ok(isHeadlessHostIncarnationId(candidateHost));
  const hostIncarnationId: HeadlessHostIncarnationId = candidateHost;
  const at = "2026-11-23T00:00:00.000Z", repositories = createStructuredOrganizationRepositories(platform);
  await repositories.organizations.saveOrganization({organizationId, displayName: "Synthetic", status: "active", createdAt: at, updatedAt: at});
  const membership = {organizationId, principalId, role: "owner" as const, status: "active" as const, createdAt: at, updatedAt: at};
  await repositories.memberships.saveMembership(membership);
  const documents = platform.forOrganization(organizationId), workspaces = createLocalWorkspaceRepository({rootDirectory: directory, documents});
  await workspaces.saveWorkspace({organizationId, workspaceId, displayName: "Synthetic", status: "active", createdAt: at, updatedAt: at});
  const state = {current: true, readCurrent: true, hostOpen: true, ambient: true, denied: new Set<SecurityScope>(), scopes: [] as SecurityScope[][],
    preparations: 0, beforePolicy: undefined as (() => Promise<void>) | undefined, onFactory: undefined as (() => Promise<void>) | undefined,
    afterPreview: undefined as (() => Promise<void>) | undefined};
  const contexts = {getCurrentOrganizationContext: () => state.ambient ? {organizationId, principalId} : undefined};
  const placement = createTenantPlacementConfig(), policy = createOrganizationAuthorizationPolicy({...repositories, tenantPlacement: placement});
  const applicationAuthorization = new AuthorizeWorkspaceOperationService({organizationContext: contexts, authorizer: {async execute(input) {
    if (!(await policy.authorize(input)).allowed) throw new Error("Synthetic current policy denied.");
  }}});
  const authorization = {async authorizeWorkspaceOperation(input: Parameters<typeof applicationAuthorization.authorizeWorkspaceOperation>[0]) {
    state.scopes.push([...input.requiredScopes]); await state.beforePolicy?.();
    if (input.requiredScopes.some(scope => state.denied.has(scope))) throw new Error("PRIVATE-POLICY-DETAIL");
    await applicationAuthorization.authorizeWorkspaceOperation(input);
  }};
  const models = createLocalModelRegistryAdapter({documents, rootDirectory: directory, filePath: join(directory, "nonexistent-models.json"),
    discovery: {enabled: false}, now: () => at});
  await models.registerDownloadedModel({workspaceId, modelRecordId: "model.synthetic", displayName: "PRIVATE-MODEL-LABEL", source: "local",
    provider: "huggingface", artifactForm: "full-model", modelId: "fixture/base", localPath: "PRIVATE-MODEL-PATH",
    inferenceMode: "causal", serializationFormat: "safetensors", taskTags: emptyTags ? [] : ["chat", "text-generation"]});
  const model = await models.readRecordedModel!(workspaceId, "model.synthetic"); assert.ok(model);
  const version = normalizeDatasetVersionRecord({...datasetFixture(1), organizationId, workspaceId, createdBy: principalId,
    documentation: {...datasetFixture(1).documentation, license: "CC0-1.0"}});
  await createStructuredDatasetVersionRepository(documents).createVersion(version);
  const scope = {organizationId, principalId, workspaceId, registeredClientId};
  const proposal = {hostIncarnationId, workspaceId, steps: [{operation: "models.train", idempotencyKey: randomUUID(), name: "Saved synthetic trial",
    model: {modelRecordId: model.modelRecordId, updatedAt: model.updatedAt ?? model.createdAt},
    dataset: {datasetId: version.datasetId, versionId: version.versionId, versionDigest: version.versionDigest},
    training: {trainingTask: "llm-instruction", method: "lora", commonParameters: {maxSteps: 1, seed: 0}, validation: {enabled: false}}}]};
  if (stepCount === 2) proposal.steps.push({...clone(proposal.steps[0]), idempotencyKey: randomUUID(), name: "Second saved trial"});
  const parsed = parseHeadlessBuildPlanProposal(proposal, hostIncarnationId, {allowLocalFileSave: false, allowModelTraining: true});
  assert.ok(parsed.ok, JSON.stringify({parsed, proposal}));
  const target = {hostIncarnationId, scope, fingerprint: hash(parsed.preview)};
  const submit = readHeadlessPlanReviewAgentRequest({version: HEADLESS_CONTRACT_VERSION, operation: "plan.submit",
    input: {...proposal, fingerprint: target.fingerprint}}, hostIncarnationId, {allowLocalFileSave: false, allowModelTraining: true}); assert.ok(submit.ok);
  const status = readHeadlessPlanReviewAgentRequest({version: HEADLESS_CONTRACT_VERSION, operation: "plan.status",
    input: {hostIncarnationId, workspaceId, fingerprint: target.fingerprint}}, hostIncarnationId); assert.ok(status.ok);
  const grant = {...scope, planReview: true as const, operations: [], workspaceIds: [workspaceId] as const,
    isCurrent: () => state.current, isReadCurrent: () => state.readCurrent};
  const registration = {...scope, purpose: "plan-review" as const, isCurrent: () => state.current};
  const stillAllowed = async () => {
    if (!state.current) return false;
    const workspace = await workspaces.readWorkspace(workspaceId); if (!workspace) return false;
    await authorization.authorizeWorkspaceOperation({workspace, operation: "headless.training-review", requiredScopes: HEADLESS_TRAINING_REVIEW_SCOPES});
    return state.current;
  };
  const inputs = composeHeadlessTrainingPlanInputs(documents, directory, workspaces, authorization);
  const readInputs = inputs.execute.bind(inputs);
  const outsideInputs = {async execute(...args: Parameters<typeof readInputs>) {const value = await readInputs(...args); await state.afterPreview?.(); return value;}};
  const prepared = await prepareHeadlessModelTrainingReviews({target, requests: parsed.requests, getInputs: async () => inputs,
    isCurrent: () => state.current, stillAllowed}); assert.ok(prepared.ok);
  const bind = prepared.bind;
  const bindings = await bind(documents, target, parsed.requests); assert.ok(bindings);
  const metadata = {documents, rootDirectory: directory, target, workspaces, authorization, isCurrent: () => state.current, stillAllowed};
  async function save(historicalBindings?: typeof bindings) {
    const owner = createStructuredHeadlessPlanReviewRepository(platform, async () => state.current, Date.now, async () => true,
      false, false, false, false, false, false, undefined, false, false, undefined, false, false,
      {bind: historicalBindings ? async () => historicalBindings : bind});
    return owner.propose({target, proposal, isCurrent: () => state.current});
  }
  async function changeDataset() {
    const key = `${workspaceId}/${version.versionId}`, row = await documents.readDocument(DATASET_VERSION_NAMESPACE, key); assert.ok(row);
    await documents.writeDocument(DATASET_VERSION_NAMESPACE, key, {...version,
      lineage: {...version.lineage, recipe: {...version.lineage.recipe, digest: "sha256:" + "f".repeat(64)}}}, {expectedRevision: row.revision});
  }
  function desktop(enabled = true) {
    const options: Parameters<typeof composeDesktopHeadlessPlanReview>[0] = {hostIncarnationId, identity: {organizationId, principalId, principalDisplayName: "Synthetic", createdAt: at, updatedAt: at},
      platform, rootDirectory: directory, workspaces, authorization, isOpen: () => state.hostOpen,
      getModelTrainingInputs: enabled ? async function(this: Parameters<typeof composeDesktopHeadlessPlanReview>[0]) {
        assert.equal(this, options); assert.equal(transactionDepth, 0, "Outside factory cannot run in a metadata transaction.");
        state.preparations++; await state.onFactory?.(); return outsideInputs;
      } : undefined};
    const owner = composeDesktopHeadlessPlanReview(options);
    return {owner, options};
  }
  function desktopApprovals(enabled = true) {
    return composeDesktopHeadlessPlanApprovals({hostIncarnationId,
      identity: {organizationId, principalId, principalDisplayName: "Synthetic", createdAt: at, updatedAt: at},
      platform, rootDirectory: directory, isOpen: () => state.hostOpen, allowModelTrainingReview: enabled,
      capturePlanReviewClients: async () => [{registeredClientId, isCurrent: () => state.current}]});
  }
  function managed(enabled = true, stable = true) {
    const options: Parameters<typeof composeManagedHeadlessPlanReview>[0] = {hostIncarnationId, platform: stable ? managedPlatform : platform,
      rootDirectory: directory, workspaces, contexts, authorization, placement,
      getModelTrainingInputs: enabled ? async function(this: Parameters<typeof composeManagedHeadlessPlanReview>[0]) {
        assert.equal(this, options); assert.equal(transactionDepth, 0, "Outside factory cannot run in a metadata transaction.");
        state.preparations++; await state.onFactory?.(); return outsideInputs;
      } : undefined};
    return {owner: composeManagedHeadlessPlanReview(options), options};
  }
  const browserDocument = {hostIncarnationId, workspaceId, windowId: randomUUID(), uiIncarnationId: randomUUID()};
  function managedApprovals(enabled = true, stable = true) {
    return composeManagedHeadlessPlanApprovals({hostIncarnationId, planClientId: registeredClientId,
      platform: stable ? managedPlatform : platform, rootDirectory: directory, contexts, placement, allowModelTrainingReview: enabled});
  }
  return {platform, documents, directory, scope, target, parsed, proposal, model, models, version, metadata, bindings,
    state, inputs, prepared, save, changeDataset, authorization, workspaces, contexts, placement, repositories, membership, at,
    desktop, desktopApprovals, managed, managedApprovals, managedPlatform, browserDocument,
    actor: {organizationId, principalId}, selection: {workspaceId, registeredClientId, fingerprint: target.fingerprint},
    grant, registration, submit: submit.request, status: status.request};
}

async function inspectServiceScopes<T>(denied: readonly SecurityScope[], run: (seen: readonly SecurityScope[][]) => Promise<T>): Promise<T> {
  const prototype = AuthorizeWorkspaceOperationService.prototype, key = "authorizeWorkspaceOperation";
  const descriptor = Object.getOwnPropertyDescriptor(prototype, key); assert.ok(descriptor && typeof descriptor.value === "function");
  const original = descriptor.value, seen: SecurityScope[][] = [];
  const wrapped = async function(this: AuthorizeWorkspaceOperationService, input: Parameters<AuthorizeWorkspaceOperationService["authorizeWorkspaceOperation"]>[0]) {
    seen.push([...input.requiredScopes]);
    if (input.requiredScopes.some(scope => denied.includes(scope))) throw new Error("PRIVATE-SYNTHETIC-SCOPE-DENIAL");
    await Reflect.apply(original, this, [input]);
  };
  Object.defineProperty(prototype, key, {...descriptor, value: wrapped});
  try {return await run(seen);}
  finally {assert.equal(Object.getOwnPropertyDescriptor(prototype, key)?.value, wrapped); Object.defineProperty(prototype, key, descriptor);}
}

for (const storage of ["Core", "SQLite"] as const) for (const channel of ["app-popup", "authenticated-chat"] as const)
for (const mode of ["whole-plan", "each-change"] as const)
test(`${storage}/Desktop/${channel}/${mode}: both trusted channels approve current saved training without Dataset write`, async t => {
  const f = await fixture(t, storage); const {owner} = f.desktop();
  assert.ok((await owner.execute(f.submit, f.grant, async () => f.grant)).ok);
  await inspectServiceScopes(["artifact:write", "provider-credential:use"], async seen => {
    const approvals = f.desktopApprovals(), caller = {channel, isCurrent: () => f.state.current};
    const view = await approvals.open(f.selection, caller); assert.ok(view.ok, JSON.stringify(view));
    assert.equal(view.snapshot.preview.steps[0].operation, "models.train");
    const decision = mode === "whole-plan" ? {kind: "approve" as const, mode} : {kind: "approve" as const, mode, step: 1};
    const result = await approvals.decide(f.selection, {fingerprint: f.target.fingerprint, expectedRevision: 1, decision}, caller);
    assert.ok(result.ok, JSON.stringify(result)); assert.equal(result.state.mode, mode); assert.equal(result.state.approvedSteps, 1);
    assert.ok(seen.some(scopes => scopes.includes("artifact:read"))); assert.ok(seen.some(scopes => scopes.includes("model:write")));
    assert.doesNotMatch(JSON.stringify([view, result]), /PRIVATE|private\//);
  });
});

for (const storage of ["Core", "SQLite"] as const)
test(`${storage}/Desktop: stale training metadata denies positive approval while authorized revocation still works`, async t => {
  const f = await fixture(t, storage); const {owner} = f.desktop(); assert.ok((await owner.execute(f.submit, f.grant, async () => f.grant)).ok);
  const caller = {channel: "app-popup" as const, isCurrent: () => f.state.current};
  assert.equal((await f.desktopApprovals(false).open(f.selection, caller)).ok, false);
  const approvals = f.desktopApprovals(); assert.ok((await approvals.open(f.selection, caller)).ok);
  await f.changeDataset();
  assert.equal((await approvals.open(f.selection, caller)).ok, false);
  const approve = await approvals.decide(f.selection, {fingerprint: f.target.fingerprint, expectedRevision: 1,
    decision: {kind: "approve", mode: "whole-plan"}}, caller); assert.equal(approve.ok, false);
  const unchanged = await readStructuredHeadlessTrainingPlanReview(f.documents, f.target, async () => true); assert.equal(unchanged?.state.revision, 1);
  const revoked = await approvals.decide(f.selection, {fingerprint: f.target.fingerprint, expectedRevision: 1,
    decision: {kind: "revoke"}}, caller); assert.ok(revoked.ok, JSON.stringify(revoked)); assert.equal(revoked.state.status, "revoked");
});

for (const storage of ["Core", "SQLite"] as const) for (const channel of ["app-popup", "authenticated-chat"] as const)
for (const mode of ["whole-plan", "each-change"] as const)
test(`${storage}/Managed/${channel}/${mode}: current saved training approval and publication use the same existing channel owners`, async t => {
  const f = await fixture(t, storage), {owner} = f.managed();
  assert.ok((await owner(f.submit, f.registration, () => f.state.current && f.state.readCurrent)).ok);
  await inspectServiceScopes(["artifact:write", "provider-credential:use"], async seen => {
    const approvals = f.managedApprovals(), current = () => f.state.current;
    const opened = await approvals({operation: "open", document: f.browserDocument, selection: f.selection}, f.actor, current, current, channel);
    assert.ok(opened.ok && "value" in opened && opened.value && typeof opened.value === "object" && "viewId" in opened.value, JSON.stringify(opened));
    assert.ok("publishIfCurrent" in opened && typeof opened.publishIfCurrent === "function");
    let published = 0; assert.equal(await opened.publishIfCurrent(() => {published++; return true;}), true); assert.equal(published, 1);
    const decision = mode === "whole-plan" ? {kind: "approve" as const, mode} : {kind: "approve" as const, mode, step: 1};
    const result = await approvals({operation: "decide", document: f.browserDocument, decision: {selection: f.selection,
      viewId: opened.value.viewId, expectedRevision: 1, decision}}, f.actor, current, current, channel);
    assert.ok(result.ok && "value" in result && result.value && typeof result.value === "object" && "mode" in result.value, JSON.stringify(result));
    assert.equal(result.value.mode, mode);
    assert.ok("publishIfCurrent" in result && typeof result.publishIfCurrent === "function");
    assert.equal(await result.publishIfCurrent(() => true), true);
    assert.ok(seen.some(scopes => scopes.includes("artifact:read"))); assert.ok(seen.some(scopes => scopes.includes("model:write")));
    assert.doesNotMatch(JSON.stringify([opened, result]), /PRIVATE|private\//);
  });
});

for (const storage of ["Core", "SQLite"] as const)
test(`${storage}/Managed: disabled training, stale positive approval and publication fail closed; authorized revocation stays possible`, async t => {
  const f = await fixture(t, storage), current = () => f.state.current;
  assert.ok((await f.managed().owner(f.submit, f.registration, current)).ok);
  for (const approvals of [f.managedApprovals(false), f.managedApprovals(true, false)])
    assert.equal((await approvals({operation: "open", document: f.browserDocument, selection: f.selection}, f.actor, current, current)).ok, false);
  const approvals = f.managedApprovals(), opened = await approvals({operation: "open", document: f.browserDocument,
    selection: f.selection}, f.actor, current, current);
  assert.ok(opened.ok && "value" in opened && opened.value && typeof opened.value === "object" && "viewId" in opened.value, JSON.stringify(opened));
  await f.changeDataset();
  assert.ok("publishIfCurrent" in opened && typeof opened.publishIfCurrent === "function");
  let published = false; assert.equal(await opened.publishIfCurrent(() => {published = true; return true;}), false); assert.equal(published, false);
  const revoked = await approvals({operation: "decide", document: f.browserDocument, decision: {selection: f.selection,
    viewId: opened.value.viewId, expectedRevision: 1, decision: {kind: "revoke"}}}, f.actor, current, current);
  assert.ok(revoked.ok, JSON.stringify(revoked));
  const saved = await readStructuredHeadlessTrainingPlanReview(f.documents, f.target, async () => true); assert.equal(saved?.state.status, "revoked");
  const g = await fixture(t, storage), live = () => g.state.current;
  assert.ok((await g.managed().owner(g.submit, g.registration, live)).ok);
  const positiveOwner = g.managedApprovals(), view = await positiveOwner({operation: "open", document: g.browserDocument,
    selection: g.selection}, g.actor, live, live);
  assert.ok(view.ok && "value" in view && view.value && typeof view.value === "object" && "viewId" in view.value);
  await g.changeDataset();
  const denied = await positiveOwner({operation: "decide", document: g.browserDocument, decision: {selection: g.selection,
    viewId: view.value.viewId, expectedRevision: 1, decision: {kind: "approve", mode: "whole-plan"}}}, g.actor, live, live);
  assert.equal(denied.ok, false);
  assert.equal((await readStructuredHeadlessTrainingPlanReview(g.documents, g.target, async () => true))?.state.revision, 1);
});

for (const storage of ["Core", "SQLite"] as const) {
  test(`${storage}: original training metadata recompiles from the same recorded owner without model files or Dataset write`, async t => {
    const f = await fixture(t, storage); f.state.denied.add("artifact:write");
    assert.equal(await verifyHeadlessTrainingReviewInputs({...f.metadata, requests: f.parsed.requests, bindings: f.bindings}), true);
    assert.ok(f.state.scopes.length > 0); assert.ok(f.state.scopes.every(row => !row.includes("artifact:write")));
    assert.doesNotMatch(JSON.stringify(f.bindings), /PRIVATE-MODEL|private\//);
    assert.throws(() => composeHeadlessTrainingPlanInputs(f.platform, f.directory, f.workspaces, f.authorization));
  });

  test(`${storage}: private pending training bindings need current exact-owner authorization; legacy permission read stays unavailable`, async t => {
    const f = await fixture(t, storage); assert.ok((await f.save()).ok);
    assert.equal(await readStructuredHeadlessPlanModelPermission(f.documents, f.target), undefined);
    assert.equal(await readStructuredHeadlessTrainingPlanReview(f.documents, f.target, async () => false), undefined);
    const saved = await readStructuredHeadlessTrainingPlanReview(f.documents, f.target, f.metadata.stillAllowed); assert.ok(saved);
    assert.equal(saved.state.status, "pending"); assert.deepEqual(saved.bindings, f.bindings);
    const permission = await readStructuredHeadlessTrainingPlanPermission(f.documents, f.target, f.metadata.stillAllowed);
    assert.deepEqual(permission, {requiresModelRead: false, requiresArtifactWrite: false, requiresModelWrite: true,
      requiresTrainingInputs: true, requiresModelSourceRead: false});
    assert.equal(await verifyStoredHeadlessTrainingReviewInputs(f.metadata), true);
    assert.equal(await readStructuredHeadlessTrainingPlanReview(f.documents, {...f.target, scope: {...f.scope, registeredClientId: randomUUID()}}, async () => true), undefined);
    let reads = 0;
    assert.equal(await readStructuredHeadlessTrainingPlanReview(f.documents, f.target, async () => ++reads === 1), undefined);
  });

  test(`${storage}: current saved facts and every required permission fence training metadata`, async t => {
    const f = await fixture(t, storage);
    for (const scope of HEADLESS_TRAINING_REVIEW_SCOPES) {
      f.state.denied.add(scope);
      assert.equal(await verifyHeadlessTrainingReviewInputs({...f.metadata, requests: f.parsed.requests, bindings: f.bindings}), false, scope);
      f.state.denied.delete(scope);
    }
    await f.models.updateModelRecord({workspaceId: f.scope.workspaceId, modelRecordId: f.model.modelRecordId, patch: {sizeBytes: 321}});
    assert.equal(await verifyHeadlessTrainingReviewInputs({...f.metadata, requests: f.parsed.requests, bindings: f.bindings}), false);
    await f.models.updateModelRecord({workspaceId: f.scope.workspaceId, modelRecordId: f.model.modelRecordId, patch: {sizeBytes: undefined}});
    // A separate fresh version proves drift even when its recorded digest stays.
    const data = await fixture(t, storage); await data.changeDataset();
    assert.equal(await verifyHeadlessTrainingReviewInputs({...data.metadata, requests: data.parsed.requests, bindings: data.bindings}), false);
  });

  test(`${storage}/Desktop: saved training proposal uses outside preparation and same-owner revalidation without provider consent or Dataset write`, async t => {
    const f = await fixture(t, storage); f.state.denied.add("artifact:write"); f.state.denied.add("provider-credential:use");
    const {owner} = f.desktop();
    const result = await owner.execute(f.submit, f.grant, async () => f.grant); assert.ok(result.ok, JSON.stringify(result));
    assert.equal(result.value.status, "pending"); assert.equal(f.state.preparations, 1);
    assert.equal(await readStructuredHeadlessPlanModelPermission(f.documents, f.target), undefined);
    const read = await owner.execute(f.status, f.grant, async () => f.grant); assert.ok(read.ok);
    assert.equal(f.state.preparations, 1, "Status cannot resolve another metadata factory.");
    assert.equal("allowModelTraining" in owner, false); assert.doesNotMatch(JSON.stringify([result, read]), /PRIVATE|private\//);
  });

  test(`${storage}/Desktop: absent training configuration and changed saved facts cannot publish a training proposal`, async t => {
    const f = await fixture(t, storage);
    assert.equal((await f.desktop(false).owner.execute(f.submit, f.grant, async () => f.grant)).ok, false);
    assert.equal(f.state.preparations, 0);
    f.state.afterPreview = async () => {await f.changeDataset();};
    const result = await f.desktop().owner.execute(f.submit, f.grant, async () => f.grant); assert.equal(result.ok, false);
    assert.equal(await readStructuredHeadlessTrainingPlanReview(f.documents, f.target, async () => true), undefined);
  });

  test(`${storage}/Managed: exact saved training preparation and status reuse current original metadata without provider or Dataset write`, async t => {
    const f = await fixture(t, storage); f.state.denied.add("artifact:write"); f.state.denied.add("provider-credential:use");
    const {owner} = f.managed(); const current = () => f.state.current && f.state.readCurrent;
    const result = await owner(f.submit, f.registration, current); assert.ok(result.ok, JSON.stringify(result));
    assert.equal(result.value.status, "pending"); assert.equal(f.state.preparations, 1);
    const status = await owner(f.status, f.registration, current); assert.ok(status.ok, JSON.stringify(status));
    assert.equal(f.state.preparations, 1); assert.equal("allowModelTraining" in owner, false);
    assert.doesNotMatch(JSON.stringify([result, status]), /PRIVATE|private\//);
  });

  test(`${storage}/Managed: missing trusted/stable configuration and changed metadata cannot create a training approval`, async t => {
    const f = await fixture(t, storage), current = () => f.state.current && f.state.readCurrent;
    assert.equal((await f.managed(false).owner(f.submit, f.registration, current)).ok, false);
    assert.equal((await f.managed(true, false).owner(f.submit, f.registration, current)).ok, false);
    assert.equal(f.state.preparations, 0);
    f.state.afterPreview = async () => {await f.changeDataset();};
    assert.equal((await f.managed().owner(f.submit, f.registration, current)).ok, false);
    assert.equal(await readStructuredHeadlessTrainingPlanReview(f.documents, f.target, async () => true), undefined);
  });
}

test("training metadata captures original methods and refuses active configuration without invoking it", () => {
  let invoked = 0;
  assert.equal(captureHeadlessTrainingMethod({get run() {invoked++; throw new Error("PRIVATE");}}, "run"), undefined);
  assert.equal(invoked, 0);
  const owner = {calls: 0, run(this: {calls: number}) {this.calls++; return this.calls;}};
  const original = captureHeadlessTrainingMethod<() => number>(owner, "run"); assert.ok(original);
  owner.run = () => {assert.fail("Replaced callback.");}; assert.equal(original(), 1); assert.equal(owner.calls, 1);
  assert.ok(Object.isFrozen(HEADLESS_TRAINING_REVIEW_SCOPES));
});

for (const storage of ["Core", "SQLite"] as const) for (const host of ["Desktop", "Managed"] as const)
for (const channel of ["app-popup", "authenticated-chat"] as const) for (const mode of ["whole-plan", "each-change"] as const)
test(`${storage}/${host}/${channel}/${mode}: two saved training steps preserve exact partial revisions and approval order`, async t => {
  const f = await fixture(t, storage, 2), current = () => f.state.current;
  const submitted = host === "Desktop" ? await f.desktop().owner.execute(f.submit, f.grant, async () => f.grant)
    : await f.managed().owner(f.submit, f.registration, current);
  assert.ok(submitted.ok); assert.equal(submitted.value.stepCount, 2);
  const desktop = f.desktopApprovals(), managed = f.managedApprovals();
  async function decide(revision: number, step: number) {
    const decision = mode === "whole-plan" ? {kind: "approve" as const, mode} : {kind: "approve" as const, mode, step};
    if (host === "Desktop") return desktop.decide(f.selection, {fingerprint: f.target.fingerprint, expectedRevision: revision, decision},
      {channel, isCurrent: current});
    const opened = await managed({operation: "open", document: f.browserDocument, selection: f.selection}, f.actor, current, current, channel);
    assert.ok(opened.ok && "value" in opened && opened.value && typeof opened.value === "object" && "viewId" in opened.value);
    return managed({operation: "decide", document: f.browserDocument, decision: {selection: f.selection,
      viewId: opened.value.viewId, expectedRevision: revision, decision}}, f.actor, current, current, channel);
  }
  if (mode === "each-change") {
    assert.equal((await decide(1, 2)).ok, false, "Cannot approve the second step first.");
    assert.ok((await decide(1, 1)).ok);
    const partial = await readStructuredHeadlessTrainingPlanReview(f.documents, f.target, async () => true); assert.ok(partial);
    assert.equal(partial.state.status, "pending"); assert.equal(partial.state.revision, 2); assert.equal(partial.state.approvedSteps, 1);
    assert.equal((await decide(1, 2)).ok, false, "Cannot repair a stale revision automatically.");
    assert.ok((await decide(2, 2)).ok);
  } else assert.ok((await decide(1, 1)).ok);
  const saved = await readStructuredHeadlessTrainingPlanReview(f.documents, f.target, async () => true); assert.ok(saved);
  assert.equal(saved.state.approvedSteps, 2); assert.equal(saved.state.stepCount, 2); assert.equal(saved.state.status, "approved");
  assert.equal(saved.state.revision, mode === "each-change" ? 3 : 2);
  assert.equal(f.state.preparations, 1, "Interactive approvals reuse metadata owners, never the outer factory.");
});

function legacyBindings(f: Awaited<ReturnType<typeof fixture>>, tagsPresent: boolean) {
  return f.bindings.map(binding => {
    const model = binding.inputs.model;
    const names: (keyof typeof model)[] = ["modelRecordId", "source", "lifecycleStatus", "artifactForm", "provider", "modelId", "inferenceMode",
      "serializationFormat", ...(tagsPresent ? ["taskTags" as const] : []), "sizeBytes", "parameterCount", "updatedAt", ...(!tagsPresent ? ["taskTags" as const] : [])];
    const selected = Object.fromEntries(names.filter(name => Object.prototype.hasOwnProperty.call(model, name)).map(name => [name, model[name]])) as unknown as typeof model;
    const inputs = {...binding.inputs, model: selected};
    return {...binding, inputs, proposalDigest: "sha256:" + hash({request: f.parsed.requests[binding.step - 1], inputs})};
  });
}

for (const storage of ["Core", "SQLite"] as const) for (const host of ["Desktop", "Managed"] as const)
for (const tagsPresent of [true, false])
test(`${storage}/${host}: original ${tagsPresent ? "tagged" : "missing-tag-column"} legacy training binding survives current approval without digest migration`, async t => {
  const f = await fixture(t, storage, 1, !tagsPresent), legacy = legacyBindings(f, tagsPresent), current = () => f.state.current;
  assert.notEqual(legacy[0].proposalDigest, f.bindings[0].proposalDigest);
  assert.equal(await verifyHeadlessTrainingReviewInputs({...f.metadata, requests: f.parsed.requests, bindings: legacy}), true);
  assert.ok((await f.save(legacy)).ok);
  if (host === "Desktop") {
    const approvals = f.desktopApprovals(), caller = {channel: "app-popup" as const, isCurrent: current};
    assert.ok((await approvals.open(f.selection, caller)).ok);
    assert.ok((await approvals.decide(f.selection, {fingerprint: f.target.fingerprint, expectedRevision: 1,
      decision: {kind: "approve", mode: "whole-plan"}}, caller)).ok);
  } else {
    const approvals = f.managedApprovals(), opened = await approvals({operation: "open", document: f.browserDocument,
      selection: f.selection}, f.actor, current, current);
    assert.ok(opened.ok && "value" in opened && opened.value && typeof opened.value === "object" && "viewId" in opened.value);
    assert.ok((await approvals({operation: "decide", document: f.browserDocument, decision: {selection: f.selection,
      viewId: opened.value.viewId, expectedRevision: 1, decision: {kind: "approve", mode: "whole-plan"}}}, f.actor, current, current)).ok);
  }
  const saved = await readStructuredHeadlessTrainingPlanReview(f.documents, f.target, async () => true); assert.ok(saved);
  assert.equal(saved.bindings[0].proposalDigest, legacy[0].proposalDigest); assert.deepEqual(saved.bindings[0].inputs, legacy[0].inputs);
  assert.equal(f.state.preparations, 0);
});

for (const storage of ["Core", "SQLite"] as const) for (const host of ["Desktop", "Managed"] as const)
test(`${storage}/${host}: every current training permission fences actual approval without changing its saved revision`, async t => {
  const f = await fixture(t, storage), current = () => f.state.current;
  assert.ok((await f.save()).ok);
  for (const scope of HEADLESS_TRAINING_REVIEW_SCOPES) {
    await inspectServiceScopes([scope], async () => {
      const result = host === "Desktop"
        ? await f.desktopApprovals().open(f.selection, {channel: "app-popup", isCurrent: current})
        : await f.managedApprovals()({operation: "open", document: f.browserDocument, selection: f.selection}, f.actor, current, current);
      assert.equal(result.ok, false, scope);
    });
    assert.equal((await readStructuredHeadlessTrainingPlanReview(f.documents, f.target, async () => true))?.state.revision, 1);
  }
});

for (const storage of ["Core", "SQLite"] as const) for (const host of ["Desktop", "Managed"] as const)
test(`${storage}/${host}: proposal captures the original metadata factory and rejects retired lifetime despite replaced callbacks`, async t => {
  const f = await fixture(t, storage), current = () => f.state.current;
  const original = host === "Desktop" ? f.desktop() : f.managed();
  Object.defineProperty(original.options, "getModelTrainingInputs", {value: () => {assert.fail("Replacement factory must not execute.");}});
  const saved = host === "Desktop"
    ? await (original as ReturnType<typeof f.desktop>).owner.execute(f.submit, f.grant, async () => f.grant)
    : await (original as ReturnType<typeof f.managed>).owner(f.submit, f.registration, current);
  assert.ok(saved.ok); assert.equal(f.state.preparations, 1);

  const g = await fixture(t, storage), next = host === "Desktop" ? g.desktop() : g.managed();
  g.state.onFactory = async () => {
    g.state.current = false; g.state.hostOpen = false; g.state.ambient = false;
    Object.defineProperty(g.grant, "isCurrent", {value: () => true});
    Object.defineProperty(g.registration, "isCurrent", {value: () => true});
    Object.defineProperty(next.options, "isOpen", {value: () => true});
    Object.defineProperty(g.contexts, "getCurrentOrganizationContext", {value: () => g.actor});
  };
  const rejected = host === "Desktop"
    ? await (next as ReturnType<typeof g.desktop>).owner.execute(g.submit, g.grant, async () => g.grant)
    : await (next as ReturnType<typeof g.managed>).owner(g.submit, g.registration, () => true);
  assert.equal(rejected.ok, false);
  assert.equal(await readStructuredHeadlessTrainingPlanReview(g.documents, g.target, async () => true), undefined);
});
