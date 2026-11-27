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
import {ReadDatasetVersionUseCase} from "../../../../application/use-cases/dataset-version/dataset-version-read.use-cases";
import {ReadHeadlessModelTrainingModelUseCase} from "../../../../application/use-cases/model/headless-model-training-model.use-case";
import {ReadHeadlessModelTrainingDatasetUseCase} from "../../../../application/use-cases/model/headless-model-training-dataset.use-case";
import type {ArtifactObjectStoragePort} from "../../../../application/ports/storage";
import type {ApprovedLocalTrainingAdmission, ApprovedLocalTrainingControl, ApprovedLocalTrainingCompletionReview,
  ApprovedLocalTrainingCandidateReview} from "../../../../application/ports/model";
import {readModelTrainingExecutionHistory, type ModelTrainingResult} from "../../../../contracts/model";
import {composeHeadlessModelMetadata} from "../headlessModelMetadata";
import type {OriginalTrainingRunOptions} from "../headlessModelTrainingTasks";
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

async function fixture(t: TestContext, storage: "Core" | "SQLite", stepCount: 1 | 2 = 1, emptyTags = false, executionData = false) {
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
    inferenceMode: "causal", serializationFormat: "safetensors", taskTags: emptyTags ? [] : ["chat", "text-generation"],
    ...(executionData ? {localPath: join(directory, "synthetic-base-model")} : {})});
  const model = await models.readRecordedModel!(workspaceId, "model.synthetic"); assert.ok(model);
  let sourceVersion = clone(datasetFixture(1)); const content = new Map<string, Uint8Array>();
  if (executionData) {
    const artifacts = sourceVersion.artifacts.map(artifact => {
      const bytes = new TextEncoder().encode(JSON.stringify({text: "Synthetic " + artifact.role}) + "\n");
      content.set(artifact.artifactKey, bytes);
      return {...artifact, digest: `sha256:${createHash("sha256").update(bytes).digest("hex")}` as const, sizeBytes: bytes.byteLength};
    });
    const recipe = new TextEncoder().encode('{"synthetic":true}');
    const recipeDigest = `sha256:${createHash("sha256").update(recipe).digest("hex")}` as const;
    sourceVersion = {...sourceVersion, artifacts: [...artifacts, {role: "recipe", artifactKey: sourceVersion.lineage.recipe.artifactKey,
      digest: recipeDigest, mediaType: "application/json", sizeBytes: recipe.byteLength}],
      lineage: {...sourceVersion.lineage, recipe: {...sourceVersion.lineage.recipe, digest: recipeDigest}}};
    content.set(sourceVersion.lineage.recipe.artifactKey, recipe);
  }
  const version = normalizeDatasetVersionRecord({...sourceVersion, organizationId, workspaceId, createdBy: principalId,
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
    isCurrent: () => state.current, isReadCurrent: () => state.readCurrent, isOperationCurrent: () => state.current && state.readCurrent};
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
  function desktop(enabled = true, extension: Partial<Parameters<typeof composeDesktopHeadlessPlanReview>[0]> = {}) {
    const options: Parameters<typeof composeDesktopHeadlessPlanReview>[0] = {hostIncarnationId, identity: {organizationId, principalId, principalDisplayName: "Synthetic", createdAt: at, updatedAt: at},
      platform, rootDirectory: directory, workspaces, authorization, isOpen: () => state.hostOpen,
      getModelTrainingInputs: enabled ? async function(this: Parameters<typeof composeDesktopHeadlessPlanReview>[0]) {
        assert.equal(this, options); assert.equal(transactionDepth, 0, "Outside factory cannot run in a metadata transaction.");
        state.preparations++; await state.onFactory?.(); return outsideInputs;
      } : undefined, ...extension};
    const owner = composeDesktopHeadlessPlanReview(options);
    return {owner, options};
  }
  function desktopApprovals(enabled = true) {
    return composeDesktopHeadlessPlanApprovals({hostIncarnationId,
      identity: {organizationId, principalId, principalDisplayName: "Synthetic", createdAt: at, updatedAt: at},
      platform, rootDirectory: directory, isOpen: () => state.hostOpen, allowModelTrainingReview: enabled,
      capturePlanReviewClients: async () => [{registeredClientId, isCurrent: () => state.current}]});
  }
  function managed(enabled = true, stable = true, extension: Partial<Parameters<typeof composeManagedHeadlessPlanReview>[0]> = {}) {
    const options: Parameters<typeof composeManagedHeadlessPlanReview>[0] = {hostIncarnationId, platform: stable ? managedPlatform : platform,
      rootDirectory: directory, workspaces, contexts, authorization, placement,
      getModelTrainingInputs: enabled ? async function(this: Parameters<typeof composeManagedHeadlessPlanReview>[0]) {
        assert.equal(this, options); assert.equal(transactionDepth, 0, "Outside factory cannot run in a metadata transaction.");
        state.preparations++; await state.onFactory?.(); return outsideInputs;
      } : undefined, ...extension};
    return {owner: composeManagedHeadlessPlanReview(options), options};
  }
  const browserDocument = {hostIncarnationId, workspaceId, windowId: randomUUID(), uiIncarnationId: randomUUID()};
  function managedApprovals(enabled = true, stable = true) {
    return composeManagedHeadlessPlanApprovals({hostIncarnationId, planClientId: registeredClientId,
      platform: stable ? managedPlatform : platform, rootDirectory: directory, contexts, placement, allowModelTrainingReview: enabled});
  }
  const execution = {starts: 0, reads: 0, cancels: 0, resolutions: 0, readerFactories: 0,
    completionEnabled: false, completionReads: 0, onCompletion: undefined as (() => Promise<void>) | undefined,
    candidateEnabled: false, candidateReads: 0, onCandidate: undefined as (() => Promise<void>) | undefined,
    transformCandidate: undefined as ((value: unknown) => unknown) | undefined,
    currentState: "running" as ModelTrainingResult["status"], onStart: undefined as (() => Promise<void>) | undefined,
    onRead: undefined as (() => Promise<void>) | undefined, onCancel: undefined as (() => Promise<void>) | undefined,
    business: undefined as ApprovedLocalTrainingControl | undefined, admission: undefined as ApprovedLocalTrainingAdmission | undefined};
  const retrieved: string[] = [];
  const modelReader = new ReadHeadlessModelTrainingModelUseCase({organizationId, models, metadata: composeHeadlessModelMetadata(documents, directory)});
  const datasetReader = new ReadHeadlessModelTrainingDatasetUseCase({organizationId,
    versions: new ReadDatasetVersionUseCase({repository: createStructuredDatasetVersionRepository(documents),
      workspaceRepository: workspaces, workspaceAuthorization: authorization}),
    artifacts: {retrieveArtifact: (async (request: {key: string}) => {
      assert.equal(transactionDepth, 0, "Private byte retrieval must stay outside metadata transactions.");
      const bytes = content.get(request.key); assert.ok(bytes); retrieved.push(request.key);
      const artifact = version.artifacts.find(row => row.artifactKey === request.key); assert.ok(artifact);
      return {ok: true, value: {content: new Uint8Array(bytes), descriptor: {key: request.key, mediaType: artifact.mediaType, sizeBytes: artifact.sizeBytes}}};
    }) as ArtifactObjectStoragePort["retrieveArtifact"]}});
  const getModelTrainingReaders: OriginalTrainingRunOptions["getReaders"] = async () => {
    assert.equal(transactionDepth, 0); execution.readerFactories++; return {model: modelReader, dataset: datasetReader};
  };
  const getModelTrainingStart: OriginalTrainingRunOptions["resolveStart"] = async () => {
    assert.equal(transactionDepth, 0); execution.resolutions++;
    return async (_request, admission) => {
      assert.equal(transactionDepth, 0); execution.starts++; execution.admission = admission; execution.business = admission.control;
      if (!admission.isAdmissionCurrent() || !await admission.control.stillAllowed() || !await admission.acknowledgeIssued()) return {kind: "unavailable"};
      await execution.onStart?.();
      const summary = (): ModelTrainingResult => ({runId: admission.requestId, status: execution.currentState,
        progress: {epoch: 1, totalEpochs: 2, batch: 2, totalBatches: 4}});
      // Inert original capability: this tests host routing/policy, not runtime
      // settlement or physical files, which the App-owner fixtures test separately.
      const completion: ApprovedLocalTrainingCompletionReview = {kind: "ready", requestId: admission.requestId, workspaceId,
        provenance: {modelRecordId: _request.baseModel.modelRecordId!, modelUpdatedAt: admission.modelUpdatedAt,
          datasetId: admission.datasetId, versionId: admission.versionId, versionDigest: admission.versionDigest,
          recipeDigest: admission.recipe.digest, proposalDigest: admission.proposalDigest, trainingTask: _request.trainingTask, method: _request.method,
          trainingInputCount: admission.inputs.filter(row => row.role === "train").length,
          validationInputCount: admission.inputs.filter(row => row.role === "validation").length,
          inputBytes: admission.inputs.reduce((sum, row) => sum + row.content.byteLength, 0), recipeBytes: admission.recipe.content.byteLength},
        candidate: {requestedName: _request.output.outputModelName, artifactForm: "adapter", serializationFormat: "adapter-safetensors", recordedSizeBytes: null},
        comparison: {state: "not-recorded"}, verification: {inputs: "recorded-not-rechecked", retainedFiles: "not-checked", runtimeReadiness: "not-checked",
          hardware: "not-recorded", outputQuality: "not-evaluated"}, registration: "requires-separate-approval"};
      return {kind: "accepted", value: {runId: admission.requestId, status: "running"},
        task: {requestId: admission.requestId, workspaceId,
          async read(control) {assert.equal(transactionDepth, 0); assert.ok(control.isCurrent() && await control.stillAllowed()); execution.reads++; await execution.onRead?.(); return summary();},
          async cancel(control) {assert.equal(transactionDepth, 0); assert.ok(control.isCurrent() && await control.stillAllowed()); execution.cancels++; await execution.onCancel?.(); execution.currentState = "cancelled"; return summary();},
          ...(execution.completionEnabled ? {async reviewCompletion(control: ApprovedLocalTrainingControl): Promise<ApprovedLocalTrainingCompletionReview> {
            assert.equal(transactionDepth, 0); assert.ok(control.isCurrent() && await control.stillAllowed()); execution.completionReads++;
            await execution.onCompletion?.(); return execution.currentState === "succeeded" ? clone(completion) : {kind: "not-ready"};
          }} : {}),
          ...(execution.candidateEnabled ? {async reviewCandidate(control: ApprovedLocalTrainingControl): Promise<ApprovedLocalTrainingCandidateReview> {
            assert.equal(transactionDepth, 0); assert.ok(control.isCurrent() && await control.stillAllowed()); execution.candidateReads++;
            await execution.onCandidate?.();
            if (execution.currentState !== "succeeded") return {kind: "not-ready"};
            const files = ["adapter_config.json", "adapter_model.safetensors", "tokenizer.json"].map((name, fileIndex) => ({
              fileIndex, groupIndex: 0, name, role: "candidate" as const,
              mediaType: name.endsWith(".json") ? "application/json" as const : "application/octet-stream" as const,
              expectedSizeBytes: 3, expectedSha256: "sha256:" + "b".repeat(64),
              key: `workspaces/${workspaceId}/artifacts/training-results/${"a".repeat(32)}/${fileIndex}`}));
            const snapshot = {schema: "training-result-finalized-files-v1" as const, publicationId: "a".repeat(32), totalBytes: 9, files};
            const manifestDigest = "sha256:" + hash(snapshot), history = clone(completion);
            const value: ApprovedLocalTrainingCandidateReview = {kind: "ready", requestId: admission.requestId, workspaceId, history,
              retainedFiles: {...snapshot, verification: "sha256-current-local-v1", manifestDigest},
              candidateDigest: "sha256:" + hash({requestId: admission.requestId, workspaceId,
                owner: {organizationId, principalId, clientId: registeredClientId, hostIncarnationId}, history, manifestDigest})};
            return (execution.transformCandidate ? execution.transformCandidate(value) : value) as ApprovedLocalTrainingCandidateReview;
          }} : {})}};
    };
  };
  const executionOptions = {systems: {composeHeadlessAuthoring() {assert.fail("Training must not dispatch ordinary authoring.");}},
    getModelTrainingStart, getModelTrainingReaders, isModelHostCurrent: () => state.hostOpen};
  return {platform, documents, directory, scope, target, parsed, proposal, model, models, version, metadata, bindings,
    state, inputs, prepared, save, changeDataset, authorization, workspaces, contexts, placement, repositories, membership, at,
    desktop, desktopApprovals, managed, managedApprovals, managedPlatform, browserDocument, execution, executionOptions, retrieved,
    actor: {organizationId, principalId}, selection: {workspaceId, registeredClientId, fingerprint: target.fingerprint},
    grant, registration, submit: submit.request, status: status.request};
}

async function inspectServiceScopes<T>(denied: readonly SecurityScope[], run: (seen: readonly SecurityScope[][]) => Promise<T>,
  afterAuthorization?: (input: Parameters<AuthorizeWorkspaceOperationService["authorizeWorkspaceOperation"]>[0]) => void): Promise<T> {
  const prototype = AuthorizeWorkspaceOperationService.prototype, key = "authorizeWorkspaceOperation";
  const descriptor = Object.getOwnPropertyDescriptor(prototype, key); assert.ok(descriptor && typeof descriptor.value === "function");
  const original = descriptor.value, seen: SecurityScope[][] = [];
  const wrapped = async function(this: AuthorizeWorkspaceOperationService, input: Parameters<AuthorizeWorkspaceOperationService["authorizeWorkspaceOperation"]>[0]) {
    seen.push([...input.requiredScopes]);
    if (input.requiredScopes.some(scope => denied.includes(scope))) throw new Error("PRIVATE-SYNTHETIC-SCOPE-DENIAL");
    await Reflect.apply(original, this, [input]);
    afterAuthorization?.(input);
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

async function executableTrainingHost(t: TestContext, storage: "Core" | "SQLite", host: "Desktop" | "Managed") {
  const f = await fixture(t, storage, 1, false, true), current = () => f.state.current;
  const desktop = host === "Desktop" ? f.desktop(true, f.executionOptions) : undefined;
  const managed = host === "Managed" ? f.managed(true, true, f.executionOptions) : undefined;
  const submitted = desktop ? await desktop.owner.execute(f.submit, f.grant, async () => f.grant)
    : await managed!.owner(f.submit, f.registration, current);
  assert.ok(submitted.ok, JSON.stringify(submitted));
  if (desktop) {
    const approved = await f.desktopApprovals().decide(f.selection, {fingerprint: f.target.fingerprint, expectedRevision: 1,
      decision: {kind: "approve", mode: "whole-plan"}}, {channel: "app-popup", isCurrent: current});
    assert.ok(approved.ok, JSON.stringify(approved));
  } else {
    const approvals = f.managedApprovals(), opened = await approvals({operation: "open", document: f.browserDocument,
      selection: f.selection}, f.actor, current, current);
    assert.ok(opened.ok && "value" in opened && opened.value && typeof opened.value === "object" && "viewId" in opened.value);
    assert.ok((await approvals({operation: "decide", document: f.browserDocument, decision: {selection: f.selection,
      viewId: opened.value.viewId, expectedRevision: 1, decision: {kind: "approve", mode: "whole-plan"}}}, f.actor, current, current)).ok);
  }
  const step = {version: HEADLESS_CONTRACT_VERSION, operation: "plan.run-step" as const, input: {hostIncarnationId: f.target.hostIncarnationId,
    workspaceId: f.scope.workspaceId, fingerprint: f.target.fingerprint, approvalRevision: 2, step: 1}} as const;
  const run = () => desktop ? desktop.owner.runStep!(step, f.grant, async () => f.grant) : managed!.owner.runStep!(step, f.registration, current);
  const query = (action: "read" | "cancel", selection: {kind: "task"; taskId: string} | {kind: "plan-step"; fingerprint: string; step: number} =
    {kind: "plan-step", fingerprint: f.target.fingerprint, step: 1}) => ({version: HEADLESS_CONTRACT_VERSION,
    operation: action === "read" ? "models.training-task" : "models.cancel-training",
    input: {hostIncarnationId: f.target.hostIncarnationId, workspaceId: f.scope.workspaceId, selection}});
  const control = (action: "read" | "cancel", selection?: Parameters<typeof query>[1]) => {
    if (desktop) return (action === "read" ? desktop.owner.readTrainingTask! : desktop.owner.cancelTrainingTask!)(query(action, selection), f.grant, async () => f.grant);
    return (action === "read" ? managed!.owner.readTrainingTask! : managed!.owner.cancelTrainingTask!)(query(action, selection), f.registration, current);
  };
  const completion = (selection?: Parameters<typeof query>[1]) => desktop
    ? desktop.owner.readTrainingCompletion!(query("read", selection), f.grant, async () => f.grant)
    : managed!.owner.readTrainingCompletion!(query("read", selection), f.registration, current);
  const review = (selection?: Parameters<typeof query>[1], mode?: "current-files") => {
    const target = query("read", selection);
    const request = {...target, operation: "models.review-training", input: {...target.input, ...(mode ? {mode} : {})}};
    return desktop ? desktop.owner.readTrainingReview!(request, f.grant, async () => f.grant)
      : managed!.owner.readTrainingReview!(request, f.registration, current);
  };
  const candidate = (selection?: Parameters<typeof query>[1]) => desktop
    ? desktop.owner.readTrainingCandidate!(query("read", selection), f.grant, async () => f.grant)
    : managed!.owner.readTrainingCandidate!(query("read", selection), f.registration, current);
  return {...f, desktopHost: desktop, managedHost: managed, step, run, query, control, completion, review, candidate};
}

for (const storage of ["Core", "SQLite"] as const) for (const host of ["Desktop", "Managed"] as const) {
  test(`${storage}/${host}: current candidate review uses original private files/history and grants no Save or cached-read fallback`, async t => {
    const f = await executableTrainingHost(t, storage, host); f.execution.candidateEnabled = true;
    assert.ok((await f.run()).result.ok); const before = {...f.execution};
    assert.deepEqual(await f.candidate(), {ok: true, value: {kind: "not-ready"}});
    f.execution.currentState = "succeeded";
    const result = await f.candidate(); assert.ok(result.ok); assert.equal(result.value.kind, "ready");
    if (result.value.kind !== "ready") throw Error("Missing candidate.");
    assert.equal(result.value.requestId, f.execution.admission!.requestId);
    assert.equal(result.value.retainedFiles.verification, "sha256-current-local-v1");
    assert.equal(result.value.history.registration, "requires-separate-approval");
    assert.equal(result.value.history.verification.outputQuality, "not-evaluated");
    assert.deepEqual(await f.candidate({kind: "task", taskId: f.execution.admission!.requestId}), result);
    assert.deepEqual(await f.completion(), {ok: false, code: "headless.unavailable"}, "Current read never fills legacy cache.");
    for (const key of ["starts", "reads", "cancels", "resolutions", "readerFactories", "completionReads"] as const) assert.equal(f.execution[key], before[key], key);
    assert.doesNotMatch(JSON.stringify(result), /localPath|outputDirectory|logs|Synthetic answer/);
    const count = f.execution.candidateReads;
    assert.equal((await f.candidate({kind: "task", taskId: randomUUID()})).ok, false);
    const foreignClient = randomUUID(), request = f.query("read");
    const foreign = f.desktopHost
      ? await f.desktopHost.owner.readTrainingCandidate!(request, {...f.grant, registeredClientId: foreignClient}, async () => ({...f.grant, registeredClientId: foreignClient}))
      : await f.managedHost!.owner.readTrainingCandidate!(request, {...f.registration, registeredClientId: foreignClient}, () => true);
    assert.equal(foreign.ok, false);
    const wrongWorkspace = {...request, input: {...request.input, workspaceId: createWorkspaceId("workspace.other")}};
    assert.equal((f.desktopHost ? await f.desktopHost.owner.readTrainingCandidate!(wrongWorkspace, f.grant, async () => f.grant)
      : await f.managedHost!.owner.readTrainingCandidate!(wrongWorkspace, f.registration, () => true)).ok, false);
    await inspectServiceScopes(["model:read"], async () => {assert.equal((await f.candidate()).ok, false);});
    assert.equal(f.execution.candidateReads, count);
    // Preserve the existing training-review policy, including its ModelWrite
    // requirement. This component does not silently weaken that policy.
    await inspectServiceScopes(["model:write"], async () => {assert.equal((await f.candidate()).ok, false);});
    assert.equal(f.execution.candidateReads, count);
  });
  test(`${storage}/${host}: current candidate review refuses missing capability and late authority loss`, async t => {
    const legacy = await executableTrainingHost(t, storage, host); assert.ok((await legacy.run()).result.ok);
    assert.deepEqual(await legacy.candidate(), {ok: false, code: "headless.unavailable"});
    assert.equal(legacy.execution.reads, 0); assert.equal(legacy.execution.candidateReads, 0);
    const f = await executableTrainingHost(t, storage, host); f.execution.candidateEnabled = true;
    assert.ok((await f.run()).result.ok); f.execution.currentState = "succeeded";
    f.execution.onCandidate = async () => {f.state.readCurrent = false; f.state.hostOpen = false;};
    assert.equal((await f.candidate()).ok, false); assert.equal(f.execution.candidateReads, 1);
    assert.equal(f.execution.starts, 1); assert.equal(f.execution.reads, 0);
  });
}

function resealControlledCandidate(value: any, f: Awaited<ReturnType<typeof executableTrainingHost>>) {
  // Match the application owner's canonical Model report representation.
  // Preserve malformed fixture values so the host must independently deny them.
  if (value.execution) value.execution = readModelTrainingExecutionHistory(value.execution) ?? value.execution;
  const {schema, publicationId, totalBytes, files} = value.retainedFiles;
  const manifestDigest = "sha256:" + hash({schema, publicationId, totalBytes, files});
  value.retainedFiles.manifestDigest = manifestDigest;
  value.candidateDigest = "sha256:" + hash({requestId: value.requestId, workspaceId: value.workspaceId,
    owner: {organizationId: f.scope.organizationId, principalId: f.scope.principalId,
      clientId: f.scope.registeredClientId, hostIncarnationId: f.target.hostIncarnationId}, history: value.history,
    ...(value.execution ? {execution: value.execution} : {}), manifestDigest});
  return value;
}

const currentExecution = () => ({schema: "model-training-execution-v1", runId: "pipeline-original",
  startedAt: "2026-11-27T00:00:00.000Z", completedAt: "2026-11-27T00:00:01.000Z", durationMs: 950,
  hardware: {devices: ["cpu"], precisions: ["float32"], logicalCpuCount: 4,
    pythonVersion: "3.12.8", pytorchVersion: "2.7.0", transformersVersion: "4.52.0"}, interpretation: "reported-runtime-facts"});

for (const storage of ["Core", "SQLite"] as const) for (const host of ["Desktop", "Managed"] as const) {
  test(`${storage}/${host}: explicit current broker review keeps cache and private file observations separate`, async t => {
    const f = await executableTrainingHost(t, storage, host); f.execution.candidateEnabled = true; f.execution.completionEnabled = true;
    f.execution.transformCandidate = value => resealControlledCandidate({...value as object, execution: currentExecution()}, f);
    assert.ok((await f.run()).result.ok);
    assert.deepEqual(await f.review(undefined, "current-files"), {ok: false, code: "headless.source-not-ready"});
    assert.equal(f.execution.completionReads, 0);
    f.execution.currentState = "succeeded";
    const cached = await f.review(); assert.ok(cached.ok); const cacheReads = f.execution.completionReads;
    const current = await f.review(undefined, "current-files"); assert.ok(current.ok && current.operation === "models.review-training");
    if (!current.ok || current.operation !== "models.review-training") throw Error("Missing current broker result.");
    assert.equal(current.value.currentCandidate?.verification, "sha256-current-local-v1");
    assert.equal(current.value.currentCandidate?.fileCount, 3); assert.equal(current.value.currentCandidate?.candidateFileCount, 3);
    assert.equal(current.value.currentCandidate?.totalBytes, 9);
    assert.deepEqual(current.value.currentCandidate?.execution, {state: "recorded", report: currentExecution()});
    assert.equal(current.value.verification.retainedFiles, "not-checked", "Historical fields retain their scope.");
    assert.equal(current.value.registration, "requires-separate-approval");
    assert.equal(f.execution.completionReads, cacheReads); assert.equal(f.execution.reads, 0); assert.equal(f.execution.starts, 1);
    assert.doesNotMatch(JSON.stringify(current), /publicationId|workspaces\/.*artifacts|localPath|outputDirectory|expectedSha256|privatePath/);
    assert.deepEqual(await f.review({kind: "task", taskId: f.execution.admission!.requestId}, "current-files"), current);
  });
}

test("current broker review has no cache fallback when the original candidate capability is missing", async t => {
  const f = await executableTrainingHost(t, "Core", "Managed"); f.execution.completionEnabled = true;
  assert.ok((await f.run()).result.ok); f.execution.currentState = "succeeded";
  assert.ok((await f.review()).ok); const count = f.execution.completionReads;
  assert.deepEqual(await f.review(undefined, "current-files"), {ok: false, code: "headless.unavailable"});
  assert.equal(f.execution.completionReads, count); assert.equal(f.execution.candidateReads, 0); assert.equal(f.execution.reads, 0);
});

test("current broker preserves missing execution facts and stored comparison without asserting quality", async t => {
  const f = await executableTrainingHost(t, "Core", "Desktop"); f.execution.candidateEnabled = true;
  const report = {protocol: "fixed-first-32-validation-loss-v1", maximumRows: 32, sampleCount: 2,
    baselineLoss: 1.25, trainedLoss: 1.5, lossDelta: 0.25, interpretation: "measurement-only"};
  f.execution.transformCandidate = value => {const raw = value as any; raw.history.comparison = {state: "recorded", report}; return resealControlledCandidate(raw, f);};
  assert.ok((await f.run()).result.ok); f.execution.currentState = "succeeded";
  const result = await f.review(undefined, "current-files"); assert.ok(result.ok && result.operation === "models.review-training");
  if (result.ok && result.operation === "models.review-training") {
    assert.deepEqual(result.value.currentCandidate?.execution, {state: "not-recorded"});
    assert.deepEqual(result.value.comparison, {state: "recorded", report}); assert.equal(result.value.verification.outputQuality, "not-evaluated");
  }
  assert.equal(f.execution.reads, 0);
});

for (const storage of ["Core", "SQLite"] as const) for (const host of ["Desktop", "Managed"] as const) {
  test(`${storage}/${host}: current candidate independently binds the optional execution report`, async t => {
    const f = await executableTrainingHost(t, storage, host); f.execution.candidateEnabled = true;
    f.execution.transformCandidate = value => resealControlledCandidate({...value as object, execution: currentExecution()}, f);
    assert.ok((await f.run()).result.ok); f.execution.currentState = "succeeded";
    const result = await f.candidate(); assert.ok(result.ok && result.value.kind === "ready");
    if (!result.ok || result.value.kind !== "ready") throw Error("Missing controlled execution report.");
    assert.notEqual(result.value.requestId, result.value.execution?.runId);
    assert.deepEqual(result.value.execution, currentExecution());
    assert.equal(result.value.history.verification.hardware, "not-recorded");
    assert.equal(result.value.history.verification.outputQuality, "not-evaluated");
    assert.equal(result.value.history.registration, "requires-separate-approval");
    assert.equal(f.execution.starts, 1); assert.equal(f.execution.reads, 0);
  });
}

for (const variant of ["unbound-digest", "extra-field", "duration", "clock"] as const) {
  test(`current candidate refuses ${variant} execution history at the host boundary`, async t => {
    const f = await executableTrainingHost(t, "Core", "Desktop"); f.execution.candidateEnabled = true;
    f.execution.transformCandidate = value => {
      const raw = value as any; raw.execution = currentExecution();
      if (variant === "extra-field") raw.execution.privatePath = "not-a-report-field";
      if (variant === "duration") raw.execution.durationMs = -1;
      if (variant === "clock") raw.execution.completedAt = "2026-11-26T00:00:00.000Z";
      return variant === "unbound-digest" ? raw : resealControlledCandidate(raw, f);
    };
    assert.ok((await f.run()).result.ok); f.execution.currentState = "succeeded";
    assert.deepEqual(await f.candidate(), {ok: false, code: "headless.unavailable"});
    assert.equal(f.execution.starts, 1); assert.equal(f.execution.reads, 0);
  });
}

for (const variant of ["task", "workspace", "history", "model", "dataset", "recipe", "training-task", "name", "foreign-key", "role", "group", "required-file", "size", "duplicate-name",
  "serialization", "quality", "manifest", "candidate-digest", "extra", "proxy", "getter"] as const) {
  test(`private current candidate boundary rejects ${variant}, even with self-consistent digests`, async t => {
    const f = await executableTrainingHost(t, "Core", "Desktop"); f.execution.candidateEnabled = true;
    assert.ok((await f.run()).result.ok); f.execution.currentState = "succeeded"; let hooks = 0;
    f.execution.transformCandidate = (raw: any) => {
      if (variant === "task") raw.requestId = randomUUID();
      if (variant === "workspace") raw.workspaceId = createWorkspaceId("workspace.other");
      if (variant === "history") raw.history.provenance.proposalDigest = "sha256:" + "f".repeat(64);
      if (variant === "model") raw.history.provenance.modelRecordId = "model.different";
      if (variant === "dataset") raw.history.provenance.versionDigest = "sha256:" + "f".repeat(64);
      if (variant === "recipe") raw.history.provenance.recipeDigest = "sha256:" + "f".repeat(64);
      if (variant === "training-task") raw.history.provenance.trainingTask = "llm-causal";
      if (variant === "name") raw.history.candidate.requestedName = "Different candidate";
      if (variant === "foreign-key") raw.retainedFiles.files[0].key = "workspaces/workspace.other/artifacts/training-results/foreign/0";
      if (variant === "role") raw.retainedFiles.files[0].role = "checkpoint";
      if (variant === "group") raw.retainedFiles.files[0].groupIndex = 2;
      if (variant === "required-file") raw.retainedFiles.files[0].name = "generation_config.json";
      if (variant === "size") raw.retainedFiles.totalBytes = 8;
      if (variant === "duplicate-name") raw.retainedFiles.files[2].name = "adapter_config.json";
      if (variant === "serialization") raw.history.candidate.serializationFormat = "safetensors";
      if (variant === "quality") raw.history.verification.outputQuality = "passed";
      if (variant === "extra") raw.logs = ["PRIVATE"];
      resealControlledCandidate(raw, f);
      if (variant === "manifest") raw.retainedFiles.manifestDigest = "sha256:" + "f".repeat(64);
      if (variant === "candidate-digest") raw.candidateDigest = "sha256:" + "f".repeat(64);
      if (variant === "proxy") raw.retainedFiles.files[0] = new Proxy(raw.retainedFiles.files[0], {getPrototypeOf() {hooks++; throw Error("PRIVATE");}});
      if (variant === "getter") Object.defineProperty(raw.retainedFiles, "totalBytes", {enumerable: true, get() {hooks++; throw Error("PRIVATE");}});
      return raw;
    };
    assert.deepEqual(await f.candidate(), {ok: false, code: "headless.unavailable"}); assert.equal(hooks, 0);
    assert.equal(f.execution.candidateReads, 1); assert.equal(f.execution.starts, 1); assert.equal(f.execution.reads, 0);
  });
}

test("current candidate review preserves controlled evaluation measurements without granting quality or runtime readiness", async t => {
  const f = await executableTrainingHost(t, "Core", "Managed"); f.execution.candidateEnabled = true;
  assert.ok((await f.run()).result.ok); f.execution.currentState = "succeeded";
  f.execution.transformCandidate = (raw: any) => {
    raw.history.comparison = {state: "recorded", report: {protocol: "fixed-first-32-validation-loss-v1", maximumRows: 32,
      sampleCount: 4, baselineLoss: 2, trainedLoss: 1.5, lossDelta: -0.5, interpretation: "measurement-only"}};
    return resealControlledCandidate(raw, f);
  };
  const result = await f.candidate(); assert.ok(result.ok && result.value.kind === "ready");
  assert.equal(result.value.history.comparison.state, "recorded");
  assert.equal(result.value.history.verification.outputQuality, "not-evaluated");
  assert.equal(result.value.history.verification.runtimeReadiness, "not-checked");
  assert.equal(result.value.history.registration, "requires-separate-approval");
});

for (const storage of ["Core", "SQLite"] as const) for (const host of ["Desktop", "Managed"] as const) {
  test(`${storage}/${host}: private host completion uses original history and read policy without new dependencies`, async t => {
    const f = await executableTrainingHost(t, storage, host); f.execution.completionEnabled = true;
    assert.ok((await f.run()).result.ok); const before = {...f.execution}, retrieved = [...f.retrieved];
    assert.deepEqual(await f.completion(), {ok: true, value: {kind: "not-ready"}});
    f.execution.currentState = "succeeded"; const result = await f.completion();
    assert.ok(result.ok, JSON.stringify(result)); assert.equal(result.value.kind, "ready");
    if (result.value.kind !== "ready") throw Error("Missing completion.");
    assert.equal(result.value.requestId, f.execution.admission!.requestId); assert.equal(result.value.workspaceId, f.scope.workspaceId);
    assert.equal(result.value.provenance.modelRecordId, f.model.modelRecordId);
    assert.equal(result.value.provenance.versionDigest, f.version.versionDigest);
    assert.equal(result.value.verification.outputQuality, "not-evaluated");
    assert.equal(result.value.verification.retainedFiles, "not-checked");
    assert.equal(result.value.registration, "requires-separate-approval");
    assert.ok((await f.completion({kind: "task", taskId: f.execution.admission!.requestId})).ok);
    for (const key of ["starts", "reads", "cancels", "resolutions", "readerFactories"] as const) assert.equal(f.execution[key], before[key], key);
    assert.deepEqual(f.retrieved, retrieved); assert.doesNotMatch(JSON.stringify(result), /localPath|outputDirectory|logs|Synthetic answer/);
    assert.equal((await f.completion({kind: "task", taskId: randomUUID()})).ok, false);
    const count = f.execution.completionReads;
    const baseQuery = f.query("read");
    const invoke = (request: unknown) => f.desktopHost
      ? f.desktopHost.owner.readTrainingCompletion!(request, f.grant, async () => f.grant)
      : f.managedHost!.owner.readTrainingCompletion!(request, f.registration, () => f.state.current);
    assert.equal((await invoke({...baseQuery, input: {...baseQuery.input, hostIncarnationId: randomUUID()}})).ok, false);
    assert.equal((await invoke({...baseQuery, input: {...baseQuery.input, workspaceId: createWorkspaceId("workspace.other")}})).ok, false);
    const otherClient = randomUUID();
    const foreign = f.desktopHost
      ? await f.desktopHost.owner.readTrainingCompletion!(baseQuery, {...f.grant, registeredClientId: otherClient},
          async () => ({...f.grant, registeredClientId: otherClient}))
      : await f.managedHost!.owner.readTrainingCompletion!(baseQuery, {...f.registration, registeredClientId: otherClient}, () => f.state.current);
    assert.equal(foreign.ok, false); assert.equal(f.execution.completionReads, count);
    await inspectServiceScopes(["model:read"], async () => {assert.equal((await f.completion()).ok, false);});
    assert.equal(f.execution.completionReads, count);
  });

  test(`${storage}/${host}: private host completion has no fallback and denies late read-lifetime loss`, async t => {
    const legacy = await executableTrainingHost(t, storage, host); assert.ok((await legacy.run()).result.ok);
    const before = {...legacy.execution};
    assert.deepEqual(await legacy.completion(), {ok: false, code: "headless.unavailable"});
    assert.equal(legacy.execution.reads, before.reads); assert.equal(legacy.execution.resolutions, before.resolutions);
    const f = await executableTrainingHost(t, storage, host); f.execution.completionEnabled = true;
    assert.ok((await f.run()).result.ok); f.execution.currentState = "succeeded";
    f.execution.onCompletion = async () => {if (host === "Desktop") f.state.readCurrent = false; else f.state.hostOpen = false;};
    assert.equal((await f.completion()).ok, false); assert.equal(f.execution.reads, 0); assert.equal(f.execution.starts, 1);
  });
}

for (const storage of ["Core", "SQLite"] as const) {
  test(`${storage}/Desktop: first fresh training grant cannot be replaced after withdrawal before step selection`, async t => {
    const f = await executableTrainingHost(t, storage, "Desktop"); let firstCurrent = true, observations = 0, armed = true;
    const first = {...f.grant, isCurrent: () => firstCurrent, isOperationCurrent: () => firstCurrent};
    const later = {...f.grant};
    f.state.beforePolicy = async () => {if (armed) {armed = false; firstCurrent = false;}};
    const result = await f.desktopHost!.owner.runStep!(f.step, f.grant, async () => ++observations === 1 ? first : later);
    assert.equal(firstCurrent, false); assert.equal(f.state.current, true);
    assert.equal(result.result.ok, false); assert.equal(f.execution.starts, 0); assert.deepEqual(f.retrieved, []);
  });

  test(`${storage}/Desktop: retained fresh operation lifetime fences later publication transactions and cannot be revived`, async t => {
    const f = await executableTrainingHost(t, storage, "Desktop"); let operationCurrent = true;
    const fresh = {...f.grant, isOperationCurrent: () => operationCurrent};
    const result = await f.desktopHost!.owner.runStep!(f.step, f.grant, async () => fresh); assert.ok(result.result.ok);
    assert.ok("publishIfCurrent" in result && typeof result.publishIfCurrent === "function");
    const publishIfCurrent = result.publishIfCurrent; let policies = 0, published = 0;
    await inspectServiceScopes([], async () => {
      assert.equal(await publishIfCurrent(() => {published++; return true;}), false);
    }, input => {if (input.operation === "headless.plan.run-step" && ++policies === 2) operationCurrent = false;});
    assert.ok(policies >= 2); assert.equal(published, 0); assert.equal(f.state.current, true);
    operationCurrent = true;
    assert.equal(await publishIfCurrent(() => {published++; return true;}), false, "A withdrawn original fresh lifetime cannot be revived.");
    assert.equal(published, 0);
  });

  test(`${storage}/Desktop: fresh read-only lifetime withdrawal cannot reach the original progress reader`, async t => {
    const f = await executableTrainingHost(t, storage, "Desktop"); assert.ok((await f.run()).result.ok);
    let readCurrent = true, armed = true;
    const fresh = {...f.grant, isReadCurrent: () => readCurrent};
    f.state.beforePolicy = async () => {if (armed) {armed = false; readCurrent = false;}};
    const result = await f.desktopHost!.owner.readTrainingTask!(f.query("read"), f.grant, async () => fresh);
    assert.equal(result.ok, false); assert.equal(f.execution.reads, 0); assert.equal(f.state.current, true);
  });

  test(`${storage}/Desktop: fresh training grant withdrawal during publication policy prevents disclosure`, async t => {
    const f = await executableTrainingHost(t, storage, "Desktop"); let freshCurrent = true;
    const fresh = {...f.grant, isCurrent: () => freshCurrent, isOperationCurrent: () => freshCurrent};
    const result = await f.desktopHost!.owner.runStep!(f.step, f.grant, async () => fresh);
    assert.ok(result.result.ok); assert.equal(f.execution.starts, 1);
    assert.ok("publishIfCurrent" in result && typeof result.publishIfCurrent === "function");
    let armed = true, published = 0;
    f.state.beforePolicy = async () => {if (armed) {armed = false; freshCurrent = false;}};
    const allowed = await result.publishIfCurrent(() => {published++; return true;});
    assert.equal(freshCurrent, false); assert.equal(f.state.current, true);
    assert.deepEqual({allowed, published}, {allowed: false, published: 0});
  });

  test(`${storage}/Desktop: fresh training grant withdrawal during cancellation policy prevents the original request`, async t => {
    const f = await executableTrainingHost(t, storage, "Desktop"); assert.ok((await f.run()).result.ok);
    let freshCurrent = true, armed = true;
    const fresh = {...f.grant, isCurrent: () => freshCurrent, isOperationCurrent: () => freshCurrent};
    f.state.beforePolicy = async () => {if (armed) {armed = false; freshCurrent = false;}};
    const result = await f.desktopHost!.owner.cancelTrainingTask!(f.query("cancel"), f.grant, async () => fresh);
    assert.equal(freshCurrent, false); assert.equal(f.state.current, true);
    assert.equal(result.ok, false); assert.equal(f.execution.cancels, 0);
  });
}

for (const storage of ["Core", "SQLite"] as const) for (const host of ["Desktop", "Managed"] as const) {
  test(`${storage}/${host}: concurrent approved training calls cannot issue another original task`, {timeout: 5000}, async t => {
    let release!: () => void, signal!: () => void;
    const held = new Promise<void>(resolve => {release = resolve;}), entered = new Promise<void>(resolve => {signal = resolve;});
    t.after(() => release());
    const f = await executableTrainingHost(t, storage, host);
    f.execution.onStart = async () => {signal(); await held;};
    const first = f.run(); await entered;
    try {assert.equal((await f.run()).result.ok, false); assert.equal(f.execution.starts, 1);}
    finally {release();}
    assert.ok((await first).result.ok); assert.equal(f.execution.starts, 1); assert.equal(f.execution.resolutions, 1);
    assert.equal((await f.documents.listDocuments("headless/models/training-plan-tasks")).length, 1);
  });

  test(`${storage}/${host}: foreign training task scope and active payloads cannot adopt or observe a task`, async t => {
    const f = await executableTrainingHost(t, storage, host); assert.ok((await f.run()).result.ok);
    const request = f.query("read"), forgedClient = {...f.grant, registeredClientId: randomUUID()};
    const denied = f.desktopHost ? await f.desktopHost.owner.readTrainingTask!(request, forgedClient, async () => forgedClient)
      : await f.managedHost!.owner.readTrainingTask!(request, {...f.registration, registeredClientId: randomUUID()}, () => true);
    assert.equal(denied.ok, false); assert.equal(f.execution.reads, 0);
    assert.equal((await f.control("read", {kind: "task", taskId: randomUUID()})).ok, false); assert.equal(f.execution.reads, 0);
    let getters = 0;
    const active = Object.defineProperty({}, "version", {enumerable: true, get() {getters++; throw new Error("PRIVATE");}});
    const result = f.desktopHost ? await f.desktopHost.owner.readTrainingTask!(active, f.grant, async () => f.grant)
      : await f.managedHost!.owner.readTrainingTask!(active, f.registration, () => true);
    assert.equal(result.ok, false); assert.equal(getters, 0); assert.equal(f.execution.reads, 0);
  });

  test(`${storage}/${host}: approved training execution and regular progress polling keep one original accepted task`, async t => {
    const f = await executableTrainingHost(t, storage, host), result = await f.run();
    assert.ok(result.result.ok, JSON.stringify(result)); assert.equal(result.result.value.kind, "started");
    assert.ok("reference" in result.result.value); const taskId = result.result.value.reference.taskId;
    assert.equal(f.execution.starts, 1); assert.equal(f.execution.readerFactories, 1); assert.equal(f.execution.resolutions, 1);
    assert.deepEqual(f.retrieved, f.version.artifacts.filter(row => ["train", "validation", "recipe"].includes(row.role)).map(row => row.artifactKey));
    const before = {...f.execution}, retrieved = [...f.retrieved];
    const replay = await f.run(); assert.ok(replay.result.ok, JSON.stringify(replay)); assert.equal(replay.result.value.kind, "replayed");
    for (const key of ["starts", "readerFactories", "resolutions"] as const) assert.equal(f.execution[key], before[key]);
    assert.deepEqual(f.retrieved, retrieved);
    for (const selection of [{kind: "task" as const, taskId}, {kind: "plan-step" as const, fingerprint: f.target.fingerprint, step: 1}]) {
      const progress = await f.control("read", selection); assert.ok(progress.ok, JSON.stringify(progress));
      assert.equal(progress.operation, "models.training-task"); assert.equal(progress.value.state, "running");
      assert.equal(progress.value.percent, 50); assert.equal(progress.value.progress.batch, 2); assert.equal(progress.value.outputQuality, "not-evaluated");
      assert.doesNotMatch(JSON.stringify(progress), /PRIVATE|private\/|synthetic-base-model|recipeDigest|Synthetic train/);
    }
    assert.equal(f.execution.reads, 2);
    const cancelled = await f.control("cancel"); assert.ok(cancelled.ok, JSON.stringify(cancelled)); assert.equal(cancelled.value.state, "cancelled");
    assert.equal(f.execution.cancels, 1); assert.equal((await f.control("cancel")).ok, false); assert.equal(f.execution.cancels, 1);
    assert.ok("publishIfCurrent" in result && typeof result.publishIfCurrent === "function");
    assert.equal(await result.publishIfCurrent(() => true), true);
    f.state.current = false; assert.equal(await result.publishIfCurrent(() => true), false);
  });

  test(`${storage}/${host}: incomplete or unavailable private configuration never starts ordinary training`, async t => {
    const f = await executableTrainingHost(t, storage, host);
    for (const missing of ["getModelTrainingInputs", "getModelTrainingStart", "getModelTrainingReaders"] as const) {
      const options = {...f.executionOptions, [missing]: undefined};
      assert.equal(host === "Desktop" ? f.desktop(true, options).owner.readTrainingCompletion
        : f.managed(true, true, options).owner.readTrainingCompletion, undefined);
      const result = host === "Desktop" ? await f.desktop(true, options).owner.runStep!(f.step, f.grant, async () => f.grant)
        : await f.managed(true, true, options).owner.runStep!(f.step, f.registration, () => f.state.current);
      assert.equal(result.result.ok, false, missing);
    }
    const options = {...f.executionOptions, getModelTrainingStart: async () => undefined};
    const unavailable = host === "Desktop" ? await f.desktop(true, options).owner.runStep!(f.step, f.grant, async () => f.grant)
      : await f.managed(true, true, options).owner.runStep!(f.step, f.registration, () => f.state.current);
    assert.equal(unavailable.result.ok, false); assert.equal(f.execution.starts, 0); assert.deepEqual(f.retrieved, []);
    assert.equal(f.desktop().owner.readTrainingTask, undefined); assert.equal(f.managed().owner.readTrainingTask, undefined);
    assert.equal(f.desktop().owner.readTrainingCompletion, undefined); assert.equal(f.managed().owner.readTrainingCompletion, undefined);
  });

  test(`${storage}/${host}: changed saved metadata or current permission denies training before task or byte IO`, async t => {
    const f = await executableTrainingHost(t, storage, host); await f.changeDataset();
    assert.equal((await f.run()).result.ok, false); assert.equal(f.execution.starts, 0); assert.deepEqual(f.retrieved, []);
    const g = await executableTrainingHost(t, storage, host);
    await inspectServiceScopes(["artifact:read"], async () => {assert.equal((await g.run()).result.ok, false);});
    assert.equal(g.execution.starts, 0); assert.deepEqual(g.retrieved, []);
  });

  test(`${storage}/${host}: an original accepted task survives caller loss without renewing disclosure or business permission`, async t => {
    const f = await executableTrainingHost(t, storage, host);
    f.execution.onStart = async () => {f.state.current = false;};
    const result = await f.run(); assert.equal(result.result.ok, false); assert.equal(f.execution.starts, 1);
    const rows = await f.documents.listDocuments<{phase: string}>("headless/models/training-plan-tasks");
    assert.equal(rows.length, 1); assert.equal(rows[0].value.phase, "accepted");
    assert.ok(f.execution.business); assert.equal(f.execution.business.isCurrent(), true); assert.equal(await f.execution.business.stillAllowed(), true);
    assert.equal((await f.control("read")).ok, false);
    await f.repositories.memberships.saveMembership({...f.membership, status: "suspended"});
    assert.equal(await f.execution.business.stillAllowed(), false);
  });

  test(`${storage}/${host}: retired reads and lost cancellation replies expose no private output and never cancel twice`, async t => {
    const f = await executableTrainingHost(t, storage, host); assert.ok((await f.run()).result.ok);
    f.execution.onCancel = async () => {throw new Error("PRIVATE-CANCEL-PATH");};
    const failed = await f.control("cancel"); assert.equal(failed.ok, false); assert.doesNotMatch(JSON.stringify(failed), /PRIVATE/);
    assert.equal((await f.control("cancel")).ok, false); assert.equal(f.execution.cancels, 1);
    f.execution.onRead = async () => {f.state.current = false;};
    const retired = await f.control("read"); assert.equal(retired.ok, false); assert.doesNotMatch(JSON.stringify(retired), /PRIVATE/);
  });
}

for (const storage of ["Core", "SQLite"] as const) for (const host of ["Desktop", "Managed"] as const) {
  test(`${storage}/${host}: broker review reuses original completion cache and private read lifetime`, async t => {
    const f = await executableTrainingHost(t, storage, host); f.execution.completionEnabled = true;
    assert.ok((await f.run()).result.ok);
    const before = {...f.execution}, retrieved = [...f.retrieved];
    assert.deepEqual(await f.review(), {ok: false, code: "headless.source-not-ready"});
    assert.deepEqual(await f.completion(), {ok: true, value: {kind: "not-ready"}}, "Existing private API is unchanged.");
    f.execution.currentState = "succeeded";
    const result = await f.review(); assert.ok(result.ok, JSON.stringify(result));
    assert.equal(result.operation, "models.review-training"); assert.equal(result.value.taskId, f.execution.admission!.requestId);
    assert.deepEqual(result.value.plan, {fingerprint: f.target.fingerprint, step: 1});
    assert.equal(result.value.workspaceId, f.scope.workspaceId); assert.equal(result.value.provenance.modelRecordId, f.model.modelRecordId);
    assert.equal(result.value.verification.hardware, "not-recorded"); assert.equal(result.value.verification.outputQuality, "not-evaluated");
    assert.deepEqual(await f.review({kind: "task", taskId: f.execution.admission!.requestId}), result);
    assert.equal((await f.review({kind: "task", taskId: randomUUID()})).ok, false);
    await inspectServiceScopes(["model:read"], async () => {assert.equal((await f.review()).ok, false);});
    for (const key of ["starts", "reads", "cancels", "resolutions", "readerFactories"] as const) assert.equal(f.execution[key], before[key], key);
    assert.deepEqual(f.retrieved, retrieved); assert.doesNotMatch(JSON.stringify(result), /localPath|outputDirectory|logs|Synthetic answer/);
    f.state.current = false; assert.equal((await f.review()).ok, false);
  });
}
