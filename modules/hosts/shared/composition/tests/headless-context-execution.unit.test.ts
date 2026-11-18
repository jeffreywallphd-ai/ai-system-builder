import assert from "node:assert/strict";
import {createHash, randomUUID} from "node:crypto";
import {mkdtemp, realpath, rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import test from "node:test";
import {openLocalSqliteDatabase, resolveLocalSqliteDatabasePolicy} from "../../../../adapters/persistence/sqlite";
import type {StructuredDocumentStore} from "../../../../adapters/persistence/shared";
import {createStructuredOrganizationRepositories} from "../../../../adapters/persistence/organization";
import {createLocalWorkspaceRepository} from "../../../../adapters/persistence/workspace";
import {createStructuredIngestionAcquisitionRepository} from "../../../../adapters/persistence/ingestion/createStructuredIngestionAcquisitionRepository";
import {createStructuredDatasetVersionRepository} from "../../../../adapters/persistence/dataset-version";
import {createLocalModelRegistryAdapter} from "../../../../adapters/persistence/model";
import {version as datasetFixture} from "../../../../application/use-cases/dataset-version/tests/headless-dataset-metadata.fixture";
import {normalizeDatasetVersionRecord} from "../../../../contracts/dataset";
import {createStructuredHeadlessPlanReviewRepository} from "../../../../adapters/persistence/system-builder/createStructuredHeadlessPlanReviewRepository";
import {HeadlessBuildPlanReviewUseCase} from "../../../../application/use-cases/system-builder/headless-build-plan-review.use-case";
import {AuthorizeWorkspaceOperationService, createOrganizationAuthorizationPolicy} from "../../../../application/services/security";
import {composeDesktopHeadlessPlanReview} from "../../../../hosts/desktop/composition/composeDesktopHeadlessPlanReview";
import {composeManagedHeadlessPlanReview} from "../../../../hosts/server/composition/composeManagedHeadlessPlanReview";
import {composeHeadlessContextTask} from "../headlessContextExecution";
import {normalizeIngestionTaskRecord, normalizeIngestionSourceSnapshot} from "../../../../contracts/ingestion";
import {createOrganizationId} from "../../../../contracts/organization";
import {createWorkspaceId} from "../../../../contracts/workspace";
import {createTenantPlacementConfig} from "../../../../contracts/config";
import {HEADLESS_CONTRACT_VERSION, isHeadlessHostIncarnationId, parseHeadlessBuildPlanProposal,
  readHeadlessPlanReviewAgentRequest} from "../../../../contracts/headless";

for (const host of ["Desktop", "Managed"] as const) for (const channel of ["app-popup", "authenticated-chat"] as const)
for (const mode of ["whole-plan", "each-change"] as const)
for (const kind of ["pack", "rag"] as const)
test(`${host} approved Context ${kind} ${channel} ${mode} starts once and retains an accepted receipt after outward access ends`, async () => {
  const directory = await realpath(await mkdtemp(join(await realpath(tmpdir()), "headless-context-host-")));
  const db = await openLocalSqliteDatabase({policy: resolveLocalSqliteDatabasePolicy({dataRootDirectory: directory})});
  try {
    const platform = db.documents, organizationId = createOrganizationId("org.synthetic"), workspaceId = createWorkspaceId("workspace.synthetic");
    const hostIncarnationId = randomUUID(); assert.ok(isHeadlessHostIncarnationId(hostIncarnationId));
    const principalId = "principal.synthetic", registeredClientId = randomUUID(), at = "2026-11-17T00:00:00.000Z";
    const identity = {organizationId, principalId, principalDisplayName: "Synthetic", createdAt: at, updatedAt: at};
    const repositories = createStructuredOrganizationRepositories(platform);
    await repositories.organizations.saveOrganization({organizationId, displayName: "Synthetic", status: "active", createdAt: at, updatedAt: at});
    const membership = {organizationId, principalId, role: "owner" as const, status: "active" as const, createdAt: at, updatedAt: at};
    await repositories.memberships.saveMembership(membership);
    const documents = platform.forOrganization(organizationId), workspaces = createLocalWorkspaceRepository({rootDirectory: directory, documents});
    await workspaces.saveWorkspace({organizationId, workspaceId, status: "active", displayName: "Synthetic", createdAt: at, updatedAt: at});
    const contexts = {getCurrentOrganizationContext: () => ({organizationId, principalId})}, placement = createTenantPlacementConfig();
    const policy = createOrganizationAuthorizationPolicy({...repositories, tenantPlacement: placement});
    const baseAuthorization = new AuthorizeWorkspaceOperationService({organizationContext: contexts, authorizer: {async execute(input) {
      const decision = await policy.authorize(input); if (!decision.allowed) throw new Error("Synthetic access ended."); return decision;
    }}});
    let denyModelRead = false;
    const authorization = {async authorizeWorkspaceOperation(request: Parameters<typeof baseAuthorization.authorizeWorkspaceOperation>[0]) {
      if (denyModelRead && request.requiredScopes.includes("model:read")) throw new Error("Synthetic model permission ended.");
      return baseAuthorization.authorizeWorkspaceOperation(request);
    }};
    const sources = createStructuredIngestionAcquisitionRepository(documents), bytes = Buffer.from("question,answer\nSynthetic question,Synthetic answer\n");
    const digest = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
    const task = normalizeIngestionTaskRecord({schemaVersion: "1.0", taskId: "source.task", organizationId, workspaceId, kind: "file-batch",
      status: "succeeded", revision: 1, cleanupPending: false, createdAt: at, updatedAt: at, completedAt: at,
      files: [{fileId: "source.file", checkpointId: "source.checkpoint", fileName: "private-source.csv", mediaType: "text/csv",
        totalBytes: bytes.length, status: "finalized", acceptedBytes: bytes.length, nextChunkIndex: 1,
        lastChunk: {index: 0, sizeBytes: bytes.length, digest}, output: {key: "private/synthetic.csv", mediaType: "text/csv",
          sizeBytes: bytes.length, digest, sourceId: "source.one", sourceSnapshotId: "snapshot.one"}}],
      progress: {completedItems: 1, totalItems: 1, acceptedBytes: bytes.length, totalBytes: bytes.length, percent: 100}});
    await sources.createTask(task);
    await sources.createSourceSnapshot(normalizeIngestionSourceSnapshot({schemaVersion: "1.0", organizationId, workspaceId,
      sourceId: "source.one", snapshotId: "snapshot.one", locator: {kind: "file", displayName: "private-source.csv"},
      contentDigest: digest, sizeBytes: bytes.length, mediaType: "text/csv", rawArtifactKey: "private/synthetic.csv", capturedAt: at}));
    const declaredLicense = channel === "app-popup" ? "cc-by-4.0" : "LicenseRef-Proprietary";
    const sample = datasetFixture(1);
    const savedVersion = normalizeDatasetVersionRecord({...sample, organizationId, workspaceId, createdBy: principalId,
      documentation: {...sample.documentation, license: declaredLicense}});
    await createStructuredDatasetVersionRepository(documents).createVersion(savedVersion);
    const models = createLocalModelRegistryAdapter({rootDirectory: directory, filePath: join(directory, "model-registry/models.json"),
      documents, discovery: {enabled: false}, now: () => at});
    const savedModel = {workspaceId, modelRecordId: "model.embedding", displayName: "Synthetic embedding", source: "local" as const,
      provider: "huggingface" as const, artifactForm: "full-model" as const, modelId: "synthetic/embedding",
      localPath: join(directory, "private/model"), taskTags: ["embeddings"] as const, serializationFormat: "safetensors" as const};
    if (kind === "rag") await models.registerDownloadedModel({...savedModel, taskTags: [...savedModel.taskTags]});
    let current = true, starts = 0, statusReads = 0, ownerResolutions = 0, loseAccessAfterStart = false, mutateModelBeforeIssue = false, changedIssues = 0;
    const scope = {organizationId, principalId, workspaceId, registeredClientId};
    const registration = {...scope, purpose: "plan-review" as const, isCurrent: () => current};
    const grant = {...scope, planReview: true as const, workspaceIds: [workspaceId], isCurrent: () => current};
    const systems = {composeHeadlessAuthoring() {throw new Error("Context task cannot use system commands.");}} as never;
    const getContextStart = async () => async (command: any, context: any, admission: any) => {
      assert.equal(context.organizationId, organizationId); assert.equal(context.principalId, principalId);
      assert.equal(command.kind, kind === "rag" ? "rag-database" : "markdown-context-pack");
      if (kind === "pack") assert.equal(command.contextPack.method, "none");
      else {
        assert.equal(admission.embeddingModel.modelRecordId, savedModel.modelRecordId);
        assert.equal(admission.embeddingModel.modelId, savedModel.modelId);
        assert.match(admission.embeddingModel.recordDigest, /^sha256:[a-f0-9]{64}$/);
        assert.equal("localModelReference" in command.embedding, false);
        if (mutateModelBeforeIssue) {
          await models.registerDownloadedModel({...savedModel, taskTags: [...savedModel.taskTags], localPath: join(directory, "private/replaced-model")});
          assert.equal(await admission.issue(), "denied", "Same logical ID and timestamp cannot hide changed saved model facts.");
          changedIssues++;
          throw new Error("Synthetic model changed before issue.");
        }
      }
      assert.match(admission.commandDigest, /^sha256:[a-f0-9]{64}$/); assert.equal(admission.sources[0].storageKey, "private/synthetic.csv");
      assert.equal(admission.sources.length, 2); assert.equal(admission.sources[0].declaredLicense, undefined);
      assert.equal(admission.sources[1].storageKey, savedVersion.artifacts[1].artifactKey);
      assert.equal(admission.sources[1].digest, savedVersion.artifacts[1].digest);
      assert.equal(admission.sources[1].declaredLicense, declaredLicense);
      assert.ok(await admission.stillAllowed()); assert.equal(await admission.issue(), "issued");
      starts++;
      if (loseAccessAfterStart) current = false;
      return {ok: true as const, value: {requestId: admission.taskId, taskType: "generate-context-artifact", accepted: true as const, status: "queued" as const}};
    };
    const resolveContextStart = async () => {ownerResolutions++; return getContextStart();};
    const desktop = composeDesktopHeadlessPlanReview({hostIncarnationId, identity, platform, rootDirectory: directory,
      workspaces, authorization, isOpen: () => current, systems, getContextStart: resolveContextStart});
    // SQLite serializes this fixture's publication. Real Managed/PostgreSQL
    // stable-read behavior belongs to the controlled browser journey.
    const managedPlatform: StructuredDocumentStore = {...platform, async publishWithStableReads(check, publish) {
      return platform.runInOwnedTransaction!(async owner => await check(owner) && publish(), () => {});
    }};
    const managed = composeManagedHeadlessPlanReview({hostIncarnationId, platform: managedPlatform, rootDirectory: directory, workspaces,
      contexts, authorization, placement, systems, getContextStart: resolveContextStart});
    const input = {hostIncarnationId, workspaceId, steps: [{operation: kind === "rag" ? "context.generate-rag" : "context.generate-pack", idempotencyKey: randomUUID(),
      name: "Support reference", sources: [{kind: "ingestion-file", taskId: "source.task", fileId: "source.file", taskRevision: 1},
        {kind: "dataset-version", datasetId: savedVersion.datasetId, versionId: savedVersion.versionId,
          versionDigest: savedVersion.versionDigest, role: "train"}],
      settings: {chunkCharacters: 500, overlapCharacters: 50, maximumChunks: 100, textFields: ["question", "answer"],
        ...(kind === "rag" ? {kind: "rag-database", modelRecordId: savedModel.modelRecordId, modelUpdatedAt: at, batchSize: 4, device: "cpu",
          sourceChecks: {preset: "recommended", allowedLanguages: ["en"], requireLicenseMetadata: false, requireConsentMetadata: false, includeSourceAttribution: true}}
          : {kind: "markdown-context-pack", cleaningPreset: "standard"})}}]};
    const capabilities = {allowLocalFileSave: false, allowContextPackGeneration: true, allowContextRagGeneration: true};
    const plan = parseHeadlessBuildPlanProposal(input, hostIncarnationId, capabilities);
    assert.ok(plan.ok);
    const fingerprint = createHash("sha256").update(JSON.stringify(plan.preview)).digest("hex");
    const submit = readHeadlessPlanReviewAgentRequest({version: HEADLESS_CONTRACT_VERSION, operation: "plan.submit",
      input: {...input, fingerprint}}, hostIncarnationId, capabilities);
    assert.ok(submit.ok);
    const submitted = host === "Desktop" ? await desktop.execute(submit.request, grant, async () => grant)
      : await managed(submit.request, registration, () => current);
    assert.ok(submitted.ok, JSON.stringify(submitted));
    assert.doesNotMatch(JSON.stringify(submitted), /contextModels|recordDigest|private\/model/);
    const step = {version: HEADLESS_CONTRACT_VERSION, operation: "plan.run-step" as const,
      input: {hostIncarnationId, workspaceId, fingerprint, step: 1, approvalRevision: 2}};
    const run = () => host === "Desktop" ? desktop.runStep!(step, grant, async () => grant)
      : managed.runStep!(step, registration, () => current);
    assert.equal((await run()).result.ok, false); assert.equal(starts, 0);
    const reviews = createStructuredHeadlessPlanReviewRepository(platform, async () => current);
    const app = new HeadlessBuildPlanReviewUseCase(reviews, Date.now);
    const approved = await app.decide({fingerprint, expectedRevision: 1, decision: mode === "whole-plan"
      ? {kind: "approve", mode} : {kind: "approve", mode, step: 1}},
      hostIncarnationId, scope, {...identity, channel, isCurrent: () => current, canDecide: async () => current});
    assert.ok(approved.ok);
    if (kind === "rag") {
      denyModelRead = true;
      assert.equal((await run()).result.ok, false); assert.equal(starts, 0);
      denyModelRead = false;
      await models.registerDownloadedModel({...savedModel, taskTags: [...savedModel.taskTags], localPath: join(directory, "private/before-first-run")});
      const beforePreparation = ownerResolutions;
      assert.equal((await run()).result.ok, false, "Proposal-time model facts must survive approval and bind the first run.");
      assert.equal(starts, 0); assert.equal(ownerResolutions, beforePreparation, "Stale input must not resolve the runtime owner.");
      await models.registerDownloadedModel({...savedModel, taskTags: [...savedModel.taskTags]});
    }
    loseAccessAfterStart = true;
    assert.equal((await run()).result.ok, false); assert.equal(starts, 1);
    current = true; loseAccessAfterStart = false;
    const replay = await run(); assert.ok(replay.result.ok, JSON.stringify(replay));
    assert.equal(replay.result.value.kind, "replayed"); assert.equal(starts, 1);
    assert.doesNotMatch(JSON.stringify(replay), /private\/synthetic|private-source|storageKey|sourceArtifactIds/);
    assert.equal(await replay.publishIfCurrent?.(() => true), true);
    if (kind === "rag") {
      const changedInput = {...input, steps: [{...input.steps[0], idempotencyKey: randomUUID(), name: "Changed-model denial"}]};
      const changedPlan = parseHeadlessBuildPlanProposal(changedInput, hostIncarnationId, capabilities); assert.ok(changedPlan.ok);
      const changedFingerprint = createHash("sha256").update(JSON.stringify(changedPlan.preview)).digest("hex");
      const changedSubmit = readHeadlessPlanReviewAgentRequest({version: HEADLESS_CONTRACT_VERSION, operation: "plan.submit",
        input: {...changedInput, fingerprint: changedFingerprint}}, hostIncarnationId, capabilities); assert.ok(changedSubmit.ok);
      const result = host === "Desktop" ? await desktop.execute(changedSubmit.request, grant, async () => grant)
        : await managed(changedSubmit.request, registration, () => current); assert.ok(result.ok);
      assert.equal((await app.decide({fingerprint: changedFingerprint, expectedRevision: 1,
        decision: {kind: "approve", mode: "whole-plan"}}, hostIncarnationId, scope,
        {...identity, channel, isCurrent: () => current, canDecide: async () => current})).ok, true);
      const changedStep = {...step, input: {...step.input, fingerprint: changedFingerprint}};
      const runChanged = () => host === "Desktop" ? desktop.runStep!(changedStep, grant, async () => grant)
        : managed.runStep!(changedStep, registration, () => current);
      mutateModelBeforeIssue = true;
      assert.equal((await runChanged()).result.ok, false); assert.equal(starts, 1); assert.equal(changedIssues, 1);
      assert.equal((await runChanged()).result.ok, false); assert.equal(starts, 1); assert.equal(changedIssues, 1);
      mutateModelBeforeIssue = false;
      const acceptedAfterModelChange = await run();
      assert.ok(acceptedAfterModelChange.result.ok, "An accepted historical receipt remains replayable after model metadata changes.");
      assert.equal(acceptedAfterModelChange.result.value.kind, "replayed"); assert.equal(starts, 1);
    }
    let retireWhileOpening = false, processorOpens = 0;
    const status = composeHeadlessContextTask(platform, async () => {
      processorOpens++; if (retireWhileOpening) current = false;
      return {async readAdmittedContextTask(taskId) {
      statusReads++; return {taskId, state: "review-required" as const, review: {kind: kind === "rag" ? "rag-database" as const : "markdown-context-pack" as const, reportFingerprint: "b".repeat(64), sourceCount: 2, chunkCount: 2, sizeBytes: 500, requiresExplicitSave: true as const}};
    }};});
    const query = {version: HEADLESS_CONTRACT_VERSION, operation: "context.task" as const,
      input: {hostIncarnationId, workspaceId, selection: {kind: "plan-step" as const, fingerprint, step: 1}}};
    const authority = {context: scope, clientId: registeredClientId, stillAllowed: async () => current};
    assert.equal((await status.execute(query, authority)).ok, true); assert.equal(statusReads, 1);
    assert.equal((await status.execute(query, {...authority, clientId: randomUUID()})).ok, false); assert.equal(statusReads, 1);
    assert.equal(processorOpens, 1, "A foreign client must not resolve the processor.");
    retireWhileOpening = true;
    assert.equal((await status.execute(query, authority)).ok, false); assert.equal(statusReads, 1);
    current = true; retireWhileOpening = false;
    await repositories.memberships.saveMembership({...membership, status: "removed"});
    assert.equal(await replay.publishIfCurrent?.(() => true), false);
    assert.equal((await run()).result.ok, false); assert.equal(starts, 1);
  } finally {await db.close(); await rm(directory, {recursive: true, force: true});}
});
