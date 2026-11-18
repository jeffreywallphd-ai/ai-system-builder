import assert from "node:assert/strict";
import {createHash, randomUUID} from "node:crypto";
import {mkdtemp, readFile, realpath, rm, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import test from "node:test";
import {openLocalSqliteDatabase, resolveLocalSqliteDatabasePolicy} from "../../../../adapters/persistence/sqlite";
import type {StructuredDocumentStore} from "../../../../adapters/persistence/shared";
import {createStructuredOrganizationRepositories} from "../../../../adapters/persistence/organization";
import {createLocalWorkspaceRepository} from "../../../../adapters/persistence/workspace";
import {createStructuredIngestionAcquisitionRepository, INGESTION_TASK_NAMESPACE} from "../../../../adapters/persistence/ingestion/createStructuredIngestionAcquisitionRepository";
import {createStructuredHeadlessPlanReviewRepository} from "../../../../adapters/persistence/system-builder/createStructuredHeadlessPlanReviewRepository";
import {createFilesystemContextResultByteStorageAdapter, createFilesystemContextResultOutputSourceAdapter}
  from "../../../../adapters/storage/filesystem/artifact-store";
import {HeadlessBuildPlanReviewUseCase} from "../../../../application/use-cases/system-builder/headless-build-plan-review.use-case";
import {ContextGenerationUseCase} from "../../../../application/use-cases/context-management";
import {OwnedTaskReconcilerService} from "../../../../application/services/runtime/owned-task-reconciler.service";
import {AuthorizeWorkspaceOperationService, createOrganizationAuthorizationPolicy} from "../../../../application/services/security";
import {composeDesktopHeadlessPlanReview} from "../../../desktop/composition/composeDesktopHeadlessPlanReview";
import {composeManagedHeadlessPlanReview} from "../../../server/composition/composeManagedHeadlessPlanReview";
import {composeHeadlessContextSaved} from "../headlessContextResults";
import {normalizeIngestionTaskRecord, normalizeIngestionSourceSnapshot} from "../../../../contracts/ingestion";
import {CONTEXT_MARKDOWN_PACK_MEDIA_TYPE, CONTEXT_RAG_DATABASE_MEDIA_TYPE} from "../../../../contracts/context-management";
import {createLocalModelRegistryAdapter} from "../../../../adapters/persistence/model";
import {TaskType, type ContextGenerationTaskRequest} from "../../../../contracts/runtime";
import {createOrganizationId} from "../../../../contracts/organization";
import {createWorkspaceId} from "../../../../contracts/workspace";
import {createTenantPlacementConfig} from "../../../../contracts/config";
import {HEADLESS_CONTRACT_VERSION as version, isHeadlessHostIncarnationId, parseHeadlessBuildPlanProposal,
  readHeadlessPlanReviewAgentRequest, type HeadlessPlanStepRequest} from "../../../../contracts/headless";
import {composeHeadlessContextRebuildPreview, compileRecordedHeadlessContextInputs} from "../headlessContextRebuild";
import {composeHeadlessContextQueryPreview} from "../headlessContextQueryPreview";
import {composeDesktopHeadlessReads} from "../../../desktop/composition/composeDesktopHeadlessReads";
import {composeManagedAgentReads} from "../../../server/composition/composeManagedAgentReads";
import {HEADLESS_READ_OPERATIONS} from "../../../../contracts/headless";

const sha = (bytes: Uint8Array) => "sha256:" + createHash("sha256").update(bytes).digest("hex");

for (const host of ["Desktop", "Managed"] as const)
for (const channel of ["app-popup", "authenticated-chat"] as const)
for (const mode of ["whole-plan", "each-change"] as const)
for (const kind of ["pack", "rag"] as const)
test(`${host} ${channel} ${mode} ${kind} separately builds, saves and rebuilds Context with exact replay and late-parent denial`, async () => {
  const originalTemp = process.env.TEMP, originalTmp = process.env.TMP;
  const directory = await realpath(await mkdtemp(join(await realpath(tmpdir()), "headless-context-result-")));
  process.env.TEMP = directory; process.env.TMP = directory;
  const db = await openLocalSqliteDatabase({policy: resolveLocalSqliteDatabasePolicy({dataRootDirectory: directory})});
  const reconciler = new OwnedTaskReconcilerService(); reconciler.stopObservation();
  try {
    const platform = db.documents, organizationId = createOrganizationId("org.synthetic"), workspaceId = createWorkspaceId("workspace.synthetic");
    const hostIncarnationId = randomUUID(); assert.ok(isHeadlessHostIncarnationId(hostIncarnationId));
    const principalId = "principal.synthetic", registeredClientId = randomUUID(), at = "2026-11-18T00:00:00.000Z";
    const identity = {organizationId, principalId, principalDisplayName: "Synthetic", createdAt: at, updatedAt: at};
    const repositories = createStructuredOrganizationRepositories(platform);
    await repositories.organizations.saveOrganization({organizationId, displayName: "Synthetic", status: "active", createdAt: at, updatedAt: at});
    const membership = {organizationId, principalId, role: "owner" as const, status: "active" as const, createdAt: at, updatedAt: at};
    await repositories.memberships.saveMembership(membership);
    const documents = platform.forOrganization(organizationId), workspaces = createLocalWorkspaceRepository({rootDirectory: directory, documents});
    await workspaces.saveWorkspace({organizationId, workspaceId, status: "active", displayName: "Synthetic", createdAt: at, updatedAt: at});
    const contexts = {getCurrentOrganizationContext: () => ({organizationId, principalId})}, placement = createTenantPlacementConfig();
    const policy = createOrganizationAuthorizationPolicy({...repositories, tenantPlacement: placement});
    const authorization = new AuthorizeWorkspaceOperationService({organizationContext: contexts, authorizer: {async execute(input) {
      const decision = await policy.authorize(input); if (!decision.allowed) throw new Error("Synthetic access ended."); return decision;
    }}});
    const sourceBytes = Buffer.from("text\nSynthetic documented capability.\n"), sourceDigest = sha(sourceBytes);
    const resultBytes = Buffer.from("Synthetic controlled runtime output, not an actual archive/model qualification.");
    const sourceKey = "private/synthetic.csv", handle = "synthetic.context.zip";
    const sources = createStructuredIngestionAcquisitionRepository(documents);
    await sources.createTask(normalizeIngestionTaskRecord({schemaVersion: "1.0", taskId: "source.task", organizationId, workspaceId,
      kind: "file-batch", status: "succeeded", revision: 1, cleanupPending: false, createdAt: at, updatedAt: at, completedAt: at,
      files: [{fileId: "source.file", checkpointId: "source.checkpoint", fileName: "private-source.csv", mediaType: "text/csv",
        totalBytes: sourceBytes.length, status: "finalized", acceptedBytes: sourceBytes.length, nextChunkIndex: 1,
        lastChunk: {index: 0, sizeBytes: sourceBytes.length, digest: sourceDigest}, output: {key: sourceKey, mediaType: "text/csv",
          sizeBytes: sourceBytes.length, digest: sourceDigest, sourceId: "source.one", sourceSnapshotId: "snapshot.one"}}],
      progress: {completedItems: 1, totalItems: 1, acceptedBytes: sourceBytes.length, totalBytes: sourceBytes.length, percent: 100}}));
    await sources.createSourceSnapshot(normalizeIngestionSourceSnapshot({schemaVersion: "1.0", organizationId, workspaceId,
      sourceId: "source.one", snapshotId: "snapshot.one", locator: {kind: "file", displayName: "private-source.csv"},
      contentDigest: sourceDigest, sizeBytes: sourceBytes.length, mediaType: "text/csv", rawArtifactKey: sourceKey, capturedAt: at}));
    const models = createLocalModelRegistryAdapter({rootDirectory: directory, filePath: join(directory, "model-registry/models.json"),
      documents, discovery: {enabled: false}, now: () => at});
    const model = {workspaceId, modelRecordId: "model.embedding", displayName: "Synthetic embedding", source: "local" as const,
      provider: "huggingface" as const, artifactForm: "full-model" as const, modelId: "synthetic/embedding",
      localPath: join(directory, "private/model"), taskTags: ["embeddings" as const], serializationFormat: "safetensors" as const};
    if (kind === "rag") await models.registerDownloadedModel(model);
    const mediaType = kind === "rag" ? CONTEXT_RAG_DATABASE_MEDIA_TYPE : CONTEXT_MARKDOWN_PACK_MEDIA_TYPE;
    let starts = 0, writes = 0, current = true, ownerAvailable = true, peeks = 0;
    let resolutions = 0, hideParentAtStaging = false, parentKey = "";
    let hiddenParent: {key: string; value: unknown} | undefined;
    let payload: ContextGenerationTaskRequest | undefined;
    const resultStorage = createFilesystemContextResultByteStorageAdapter({rootDirectory: directory});
    const core = new ContextGenerationUseCase({taskReconciler: reconciler,
      embeddingModels: {async resolveExistingModel(witness) {
        assert.equal(kind, "rag"); assert.equal(witness.modelRecordId, model.modelRecordId);
        // Controlled runtime metadata test, not physical model-file evidence.
        return {localModelReference: model.localPath};
      }},
      taskPowerLifecycle: {async startTask() {}, async completeTask() {}},
      runtimeTaskRegistry: {
        async startTask() {assert.fail("The installed-only admission must be used.");},
        async startTaskWithoutInstalling(request) {
          starts++; payload = request.payload as ContextGenerationTaskRequest;
          await writeFile(join(payload.runtime.runtimeWorkingDirectory, handle), resultBytes, {flag: "wx"});
          return {kind: "accepted", value: {requestId: request.requestId!, status: "queued"}} as const;
        },
        async getTaskStatus(requestId) {
          assert.ok(payload); const source = payload.sources[0];
          const common = {artifactId: source.artifactId, digest: source.sourceDigest, mediaType: source.mediaType, sizeBytes: source.sizeBytes};
          return {requestId, workspaceId, taskType: TaskType.CONTEXT_GENERATION, status: "succeeded", concurrencyClass: "cpu-heavy",
            data: {output: {name: handle, outputHandle: handle, mediaType,
              sizeBytes: resultBytes.length, digest: sha(resultBytes)},
            sourceInspections: [{...common, ready: true, sourceKind: "structured", format: "csv", textFields: ["text"], alreadyChunked: false, chunkCount: 1}],
            preview: {kind: payload.kind, name: payload.name, sourceCount: 1, manualEntryCount: 0, chunkCount: 1,
              items: [{id: "synthetic.topic", kind: kind === "rag" ? "chunk" : "topic", text: "Synthetic reviewed content", citations: [{sourceArtifactId: source.artifactId, chunkIndex: 0}]}]},
            manifest: {schemaVersion: "1", kind: payload.kind, name: payload.name, mediaType,
              createdAt: at, sources: [{...common, chunkCount: 1, chunkingMode: "extracted"}], manualEntries: [],
              chunking: payload.chunking, ...(payload.embedding ? {embedding: {provider: "transformers", modelId: payload.embedding.modelId, dimensions: 3},
                sourceChecks: payload.sourceChecks} : {contextPack: payload.contextPack})}}} as never;
        },
        async cancelTask() {assert.fail("A successful save cannot cancel the source task.");},
        async listTasks() {assert.fail("No task discovery or adoption.");},
      },
      storage: {async retrieveArtifact(request) {
        if (hideParentAtStaging) {
          hideParentAtStaging = false;
          // Fault injection only in this fresh synthetic database: remove the
          // known test parent's point index after staging starts, then restore
          // the exact test row after the denied attempt. No retained data/file.
          const row = await documents.readDocument("headless/context/saved-contexts", parentKey);
          assert.ok(row); assert.equal(row.revision, 1);
          hiddenParent = {key: parentKey, value: row.value};
          assert.equal(await documents.deleteDocument("headless/context/saved-contexts", parentKey, 1), true);
        }
        assert.equal(request.key, sourceKey); return {ok: true, value: {descriptor: {key: sourceKey, mediaType: "text/csv", sizeBytes: sourceBytes.length,
          metadata: {originalFileName: "synthetic.csv"}}, content: sourceBytes}} as never;
      }, async storeArtifact() {assert.fail("Use only the admitted byte publisher.");},
      async deleteArtifact() {assert.fail("No source or unknown-result deletion.");}} as never,
      storageBindings: {async readArtifactStorageBindings() {return {ok: true, value: {artifactId: sourceKey, bindings: []}} as never;},
        async upsertArtifactStorageBinding() {assert.fail("Metadata belongs in the causal transaction.");}},
      artifactCatalog: {async readArtifactCatalogRecord() {return {ok: false, error: {code: "not-found", message: "Synthetic missing catalog"}} as never;},
        async appendArtifactCatalogRecord() {assert.fail("No ordinary catalog append.");}, async deleteArtifactCatalogRecord() {assert.fail("No ordinary delete.");}},
      resultSource: createFilesystemContextResultOutputSourceAdapter(),
      resultBytes: {async publishResult(input, actor) {
        writes++; const result = await resultStorage.publishResult(input, actor);
        return result;
      }},
    });
    const scope = {organizationId, principalId, workspaceId, registeredClientId};
    const grant = {...scope, planReview: true as const, workspaceIds: [workspaceId], isCurrent: () => current};
    const registration = {...scope, purpose: "plan-review" as const, isCurrent: () => current};
    const systems = {composeHeadlessAuthoring() {throw new Error("No system commands.");}} as never;
    const peekContextResults = () => {peeks++; return ownerAvailable ? core : undefined;};
    const getContextStart = async () => {resolutions++; return core.startAdmittedContext.bind(core);};
    const desktop = composeDesktopHeadlessPlanReview({hostIncarnationId, identity, platform, rootDirectory: directory,
      workspaces, authorization, isOpen: () => current, systems, getContextStart, peekContextResults});
    // A real SQLite transaction exercises the composed Managed application. It
    // does not claim physical PostgreSQL, browser or model qualification.
    const managedPlatform: StructuredDocumentStore = {...platform, async publishWithStableReads(check, publish) {
      return platform.runInOwnedTransaction!(async owner => await check(owner) && publish(), () => {});
    }};
    const managed = composeManagedHeadlessPlanReview({hostIncarnationId, platform: managedPlatform, rootDirectory: directory, workspaces,
      contexts, authorization, placement, systems, getContextStart, peekContextResults});
    const capability = {allowLocalFileSave: false, allowContextPackGeneration: true, allowContextRagGeneration: true, allowContextResultSave: true};
    const reviews = new HeadlessBuildPlanReviewUseCase(createStructuredHeadlessPlanReviewRepository(platform, async () => current), Date.now);
    async function propose(steps: unknown[], client = registeredClientId) {
      const input = {hostIncarnationId, workspaceId, steps}, plan = parseHeadlessBuildPlanProposal(input, hostIncarnationId, capability);
      assert.ok(plan.ok); const fingerprint = createHash("sha256").update(JSON.stringify(plan.preview)).digest("hex");
      const submitted = readHeadlessPlanReviewAgentRequest({version, operation: "plan.submit", input: {...input, fingerprint}}, hostIncarnationId, capability);
      assert.ok(submitted.ok);
      const result = host === "Desktop" ? await desktop.execute(submitted.request, {...grant, registeredClientId: client}, async () => ({...grant, registeredClientId: client}))
        : await managed(submitted.request, {...registration, registeredClientId: client}, () => current);
      return {result, fingerprint};
    }
    async function approve(fingerprint: string) {
      const result = await reviews.decide({fingerprint, expectedRevision: 1, decision: mode === "whole-plan"
        ? {kind: "approve", mode} : {kind: "approve", mode, step: 1}}, hostIncarnationId, scope,
        {...identity, channel, isCurrent: () => current, canDecide: async () => current});
      assert.ok(result.ok, JSON.stringify(result));
    }
    const run = (fingerprint: string) => {
      const request: HeadlessPlanStepRequest = {version, operation: "plan.run-step", input: {hostIncarnationId, workspaceId, fingerprint, approvalRevision: 2, step: 1}};
      return host === "Desktop" ? desktop.runStep!(request, grant, async () => grant) : managed.runStep!(request, registration, () => current);
    };
    const settings = {chunkCharacters: 500, overlapCharacters: 50, maximumChunks: 100, textFields: ["text"],
      ...(kind === "rag" ? {kind: "rag-database", modelRecordId: model.modelRecordId, modelUpdatedAt: at, batchSize: 4, device: "cpu",
        sourceChecks: {preset: "recommended", allowedLanguages: ["en"], requireLicenseMetadata: false, requireConsentMetadata: false, includeSourceAttribution: true}}
        : {kind: "markdown-context-pack", cleaningPreset: "standard"})};
    const generation = await propose([{operation: kind === "rag" ? "context.generate-rag" : "context.generate-pack", idempotencyKey: randomUUID(), name: "Synthetic context",
      sources: [{kind: "ingestion-file", taskId: "source.task", fileId: "source.file", taskRevision: 1}], settings}]);
    assert.ok(generation.result.ok, JSON.stringify(generation.result)); await approve(generation.fingerprint);
    const started = await run(generation.fingerprint); assert.ok(started.result.ok, JSON.stringify(started.result));
    const taskId = (started.result.value.reference as {taskId: string}).taskId;
    assert.equal(starts, 1); assert.equal(writes, 0);
    const context = {organizationId, principalId, workspaceId};
    const reviewed = await core.readAdmittedContextTask(taskId, context);
    assert.equal(reviewed?.state, "review-required", JSON.stringify(reviewed)); assert.ok(reviewed?.review);
    const saveStep = {operation: "context.save-result", idempotencyKey: randomUUID(), taskId,
      reportFingerprint: reviewed.review.reportFingerprint, name: "Synthetic context"};
    for (const bad of [{...saveStep, reportFingerprint: "f".repeat(64)}, {...saveStep, name: "Substituted name"}, {...saveStep, taskId: randomUUID()}])
      assert.equal((await propose([bad])).result.ok, false);
    assert.equal((await propose([saveStep], randomUUID())).result.ok, false);
    const save = await propose([saveStep]); assert.ok(save.result.ok, JSON.stringify(save.result));
    assert.equal(writes, 0, "Proposal reads no runtime output and publishes no bytes.");
    assert.equal((await run(save.fingerprint)).result.ok, false); assert.equal(writes, 0);
    await approve(save.fingerprint);
    const saved = await run(save.fingerprint); assert.ok(saved.result.ok, JSON.stringify(saved.result));
    assert.equal(saved.result.value.kind, "committed"); assert.equal(saved.result.value.operation, "context.save-result");
    const reference = saved.result.value.reference as {contextId: string; taskId: string};
    assert.equal(reference.taskId, taskId); assert.equal(writes, 1); assert.equal(starts, 1);
    assert.deepEqual(await readFile(join(directory, `workspaces/${workspaceId}/artifacts/context/${reference.contextId.replace(/-/g, "")}`)), resultBytes);
    assert.doesNotMatch(JSON.stringify(saved.result), /storageKey|private-source|outputHandle|runtimeWorkingDirectory|Synthetic reviewed content/);
    const reads = composeHeadlessContextSaved(platform, directory), before = peeks;
    const request = {version, operation: "context.saved" as const, input: {hostIncarnationId, workspaceId, contextId: reference.contextId}};
    const metadata = await reads.execute(request, {context, clientId: randomUUID(), stillAllowed: async () => current});
    assert.ok(metadata.ok); assert.deepEqual(metadata.value.reference, saved.result.value.reference);
    assert.equal(metadata.value.byteAvailability, "not-checked"); assert.equal(peeks, before, "Saved workspace reads cannot initialize or inspect the task owner.");
    const rebuild = composeHeadlessContextRebuildPreview(platform, directory);
    const rebuildRequest = {version, operation: "context.preview-rebuild" as const,
      input: {hostIncarnationId, workspaceId, reference: metadata.value.reference}};
    const rebuildAuthority = {context, clientId: randomUUID(), isCurrent: () => current, stillAllowed: async () => current};
    const rebuilt = await rebuild.execute(rebuildRequest, rebuildAuthority);
    assert.ok(rebuilt.ok, JSON.stringify(rebuilt));
    assert.deepEqual(rebuilt.value.reference, metadata.value.reference);
    assert.equal(rebuilt.value.preview.settings.kind, kind === "rag" ? "rag-database" : "markdown-context-pack");
    assert.equal(rebuilt.value.preview.sources[0].digest, sourceDigest);
    assert.equal(rebuilt.value.byteAvailability, "not-checked");
    assert.equal(rebuilt.value.preview.runtimeReadiness, "not-checked");
    assert.equal(rebuilt.value.preview.approvalRequired, true);
    assert.doesNotMatch(JSON.stringify(rebuilt), /storageKey|private-source|outputHandle|runtimeWorkingDirectory|Synthetic reviewed content|principalId|registeredClientId|contextModels/);
    assert.equal(peeks, before, "Rebuild preview must not inspect or resolve an execution owner.");
    assert.equal(starts, 1); assert.equal(writes, 1);
    let denyModelRead = false, metadataLoads = 0;
    const readAuthorization = {async authorizeWorkspaceOperation(input: Parameters<typeof authorization.authorizeWorkspaceOperation>[0]) {
      if (denyModelRead && input.requiredScopes.includes("model:read")) throw new Error("Synthetic model permission ended.");
      return authorization.authorizeWorkspaceOperation(input);
    }};
    const getContextRebuildInputs = async () => {metadataLoads++; return rebuild;};
    const queryPreview = composeHeadlessContextQueryPreview(platform, directory);
    const getContextQueryPreview = async () => {metadataLoads++; return queryPreview;};
    const desktopReads = composeDesktopHeadlessReads({hostIncarnationId, identity, workspaceRepository: workspaces,
      authorization: readAuthorization, getUseCases() {assert.fail("Rebuild metadata cannot load System Builder.");},
      getContextRebuildInputs, getContextQueryPreview, isOpen: () => current});
    const managedReads = composeManagedAgentReads({hostIncarnationId, workspaces, contexts, authorization: readAuthorization,
      systems: {listTemplates() {assert.fail("No System Builder lookup.");}, read() {assert.fail("No System Builder lookup.");}},
      getContextRebuildInputs, getContextQueryPreview});
    const readGrant = {...grant, operations: HEADLESS_READ_OPERATIONS};
    const viaHost = () => host === "Desktop" ? desktopReads(rebuildRequest, async () => readGrant)
      : managedReads(rebuildRequest, registration, () => current);
    const queryRequest = {version, operation: "context.preview-query" as const, input: {hostIncarnationId, workspaceId,
      reference: metadata.value.reference, query: "What does the synthetic corpus contain? café 📄", maximumResults: 5, embeddingDevice: "cpu" as const}};
    const viaQuery = () => host === "Desktop" ? desktopReads(queryRequest, async () => readGrant)
      : managedReads(queryRequest, registration, () => current);
    if (kind === "rag") {
      const ready = await viaQuery(); assert.ok(ready.ok && ready.operation === "context.preview-query", JSON.stringify(ready));
      assert.equal(ready.value.queryDigest, sha(new TextEncoder().encode(queryRequest.input.query)));
      assert.equal(ready.value.modelRecordId, model.modelRecordId); assert.equal(ready.value.modelUpdatedAt, at);
      assert.equal(ready.value.sourceCount, 1); assert.equal(ready.value.maximumResults, 5);
      assert.equal(ready.value.runtimeReadiness, "not-checked"); assert.equal(ready.value.byteAvailability, "not-checked");
      assert.doesNotMatch(JSON.stringify(ready), /What does the synthetic|café|private\/model|localPath|storageKey|"query":/);
      assert.equal(peeks, before); assert.equal(starts, 1); assert.equal(writes, 1);
    } else assert.equal((await viaQuery()).ok, false, "A context pack cannot become a queryable RAG artifact.");
    assert.deepEqual(await viaHost(), rebuilt);
    const retiredBuildApproval = await reviews.decide({fingerprint: generation.fingerprint, expectedRevision: 2,
      decision: {kind: "revoke"}}, hostIncarnationId, scope,
      {...identity, channel, isCurrent: () => current, canDecide: async () => current});
    assert.ok(retiredBuildApproval.ok, JSON.stringify(retiredBuildApproval));
    assert.equal((await run(generation.fingerprint)).result.ok, false, "Old build permission is no longer executable.");
    assert.deepEqual(await viaHost(), rebuilt, "Current saved-resource authority can read immutable lineage without reusing old permission.");
    if (kind === "rag") assert.equal((await viaQuery()).ok, true, "Metadata preview uses current saved-resource authority, not old execution permission.");
    if (kind === "rag") {
      await models.registerDownloadedModel({...model, localPath: join(directory, "private/replaced-model")});
      assert.equal((await viaHost()).ok, false, "The same logical model ID and timestamp cannot hide a different saved model.");
      assert.equal((await viaQuery()).ok, false, "Query preview cannot substitute the original model behind the same ID/timestamp.");
      await models.registerDownloadedModel(model);
      assert.equal((await viaHost()).ok, true);
    }
    const loaded = metadataLoads;
    denyModelRead = true;
    assert.deepEqual(await viaHost(), {ok: false, code: "headless.forbidden"});
    if (kind === "rag") assert.deepEqual(await viaQuery(), {ok: false, code: "headless.forbidden"});
    assert.equal(metadataLoads, loaded, "Current model permission is checked before the metadata provider.");
    denyModelRead = false;
    const nonPlanner = host === "Desktop" ? await desktopReads(rebuildRequest, async () => ({...readGrant, planReview: undefined}))
      : await managedReads(rebuildRequest, {...registration, purpose: "read"} as never, () => current);
    assert.deepEqual(nonPlanner, {ok: false, code: "headless.forbidden"});
    if (kind === "rag") {
      const deniedQuery = host === "Desktop" ? await desktopReads(queryRequest, async () => ({...readGrant, planReview: undefined}))
        : await managedReads(queryRequest, {...registration, purpose: "read"} as never, () => current);
      assert.deepEqual(deniedQuery, {ok: false, code: "headless.forbidden"});
    }
    for (const changed of [{...metadata.value.reference, taskId: randomUUID()},
      {...metadata.value.reference, artifactDigest: "sha256:" + "f".repeat(64)},
      {...metadata.value.reference, contextId: randomUUID()}]) {
      assert.equal((await rebuild.execute({...rebuildRequest, input: {...rebuildRequest.input, reference: changed}}, rebuildAuthority)).ok, false);
    }
    const rebuildStep = {operation: kind === "rag" ? "context.generate-rag" : "context.generate-pack",
      idempotencyKey: randomUUID(), name: "Rebuilt context", rebuildOf: metadata.value.reference,
      sources: rebuilt.value.preview.sources.map(source => source.reference), settings: rebuilt.value.preview.settings};
    const beforeRebuildResolutions = resolutions;
    for (const changed of [{...rebuildStep, rebuildOf: {...metadata.value.reference, contextId: randomUUID()}},
      {...rebuildStep, rebuildOf: {...metadata.value.reference, taskId: randomUUID()}},
      {...rebuildStep, rebuildOf: {...metadata.value.reference, artifactDigest: "sha256:" + "f".repeat(64)}},
      {...rebuildStep, settings: {...rebuildStep.settings, chunkCharacters: 600}},
      {...rebuildStep, sources: [{kind: "ingestion-file", taskId: "source.task", fileId: "source.file", taskRevision: 2}]}])
      assert.equal((await propose([changed])).result.ok, false, "A rebuild cannot replace the exact original input definition.");
    assert.equal(resolutions, beforeRebuildResolutions, "Invalid parent metadata must deny before a runtime owner is resolved.");
    const regenerate = await propose([rebuildStep]); assert.ok(regenerate.result.ok, JSON.stringify(regenerate.result));
    assert.equal((await run(regenerate.fingerprint)).result.ok, false, "A saved parent and revoked old approval do not approve a new task.");
    assert.equal(starts, 1); assert.equal(resolutions, beforeRebuildResolutions);
    await approve(regenerate.fingerprint);
    const restarted = await run(regenerate.fingerprint); assert.ok(restarted.result.ok, JSON.stringify(restarted.result));
    assert.equal(starts, 2); assert.equal(writes, 1);
    const rebuiltTask = (restarted.result.value.reference as {taskId: string}).taskId;
    assert.notEqual(rebuiltTask, taskId);
    const exactReplay = await run(regenerate.fingerprint); assert.ok(exactReplay.result.ok);
    assert.deepEqual(exactReplay.result.value, {...restarted.result.value, kind: "replayed"});
    assert.equal(starts, 2); assert.equal(resolutions, beforeRebuildResolutions + 1);
    const newReview = await core.readAdmittedContextTask(rebuiltTask, context); assert.ok(newReview?.review);
    const newSave = await propose([{operation: "context.save-result", idempotencyKey: randomUUID(), taskId: rebuiltTask,
      reportFingerprint: newReview.review.reportFingerprint, name: "Rebuilt context"}]); assert.ok(newSave.result.ok);
    await approve(newSave.fingerprint);
    const savedRebuild = await run(newSave.fingerprint); assert.ok(savedRebuild.result.ok, JSON.stringify(savedRebuild.result));
    const rebuiltReference = savedRebuild.result.value.reference;
    assert.ok("contextId" in rebuiltReference); assert.notEqual(rebuiltReference.contextId, reference.contextId);
    assert.equal(writes, 2);
    parentKey = `${workspaceId}/${reference.contextId}`;
    await platform.runInOwnedTransaction!(async tx => {
      const partition = tx.forOrganization(organizationId);
      const withoutAncestor: StructuredDocumentStore = {...partition, async readDocument(namespace, key) {
        assert.ok(namespace !== "headless/context/saved-contexts" || key !== parentKey,
          "Reading a rebuilt artifact's own definition must not require its ancestor's point index.");
        return partition.readDocument(namespace, key);
      }};
      const ownDefinition = await compileRecordedHeadlessContextInputs(withoutAncestor, directory,
        {...rebuildRequest, input: {...rebuildRequest.input, reference: rebuiltReference}}, context, async () => current);
      assert.ok(ownDefinition); assert.equal(ownDefinition.prepared.preview.name, "Rebuilt context");
    }, () => {});
    const lateParent = await propose([{...rebuildStep, idempotencyKey: randomUUID(), name: "Late parent check"}]);
    assert.ok(lateParent.result.ok); await approve(lateParent.fingerprint);
    hideParentAtStaging = true;
    const deniedLate = await run(lateParent.fingerprint);
    assert.equal(deniedLate.result.ok, false, "A missing parent after staging cannot issue under the earlier preview.");
    assert.ok(hiddenParent, "The fault must run between input admission and final issue.");
    assert.equal(starts, 2); assert.equal(writes, 2);
    await documents.writeDocument("headless/context/saved-contexts", hiddenParent.key, hiddenParent.value, {expectedRevision: 0});
    hiddenParent = undefined;
    assert.equal((await run(lateParent.fingerprint)).result.ok, false, "A denied admitted attempt must not become a fresh dispatch after restoration.");
    assert.equal(starts, 2);
    assert.deepEqual(await readFile(join(directory, `workspaces/${workspaceId}/artifacts/context/${reference.contextId.replace(/-/g, "")}`)), resultBytes);
    const priorSource = await sources.readTask(workspaceId, "source.task" as never);
    assert.ok(priorSource);
    await assert.rejects(sources.saveTask({...priorSource, revision: priorSource.revision + 1}, priorSource.revision), /immutable/);
    // Fault injection only in this newly owned synthetic database. The ordinary
    // repository correctly refuses to rewrite a completed source task.
    await documents.writeDocument(INGESTION_TASK_NAMESPACE, `${workspaceId}/${priorSource.taskId}`,
      {...priorSource, revision: priorSource.revision + 1}, {expectedRevision: priorSource.revision});
    assert.equal((await viaHost()).ok, false, "A later source revision cannot silently replace the recorded input.");
    if (kind === "rag") assert.equal((await viaQuery()).ok, false, "Query preview must reject a changed original source.");
    assert.equal(starts, 2); assert.equal(writes, 2);
    ownerAvailable = false;
    const replay = await run(save.fingerprint); assert.ok(replay.result.ok, JSON.stringify(replay.result));
    assert.deepEqual(replay.result.value, {...saved.result.value, kind: "replayed"}); assert.equal(writes, 2); assert.equal(starts, 2);
    assert.equal(await replay.publishIfCurrent?.(() => true), true);
    current = false;
    assert.equal((await run(save.fingerprint)).result.ok, false);
    assert.equal((await reads.execute(request, {context, clientId: registeredClientId, stillAllowed: async () => current})).ok, false);
    current = true;
    await repositories.memberships.saveMembership({...membership, status: "removed"});
    assert.equal(await replay.publishIfCurrent?.(() => true), false); assert.equal((await run(save.fingerprint)).result.ok, false);
    assert.equal(writes, 2); assert.equal(starts, 2);
  } finally {
    await reconciler.settleAfterRuntimeStop(["python"]); await db.close();
    if (originalTemp === undefined) delete process.env.TEMP; else process.env.TEMP = originalTemp;
    if (originalTmp === undefined) delete process.env.TMP; else process.env.TMP = originalTmp;
    assert.equal(await realpath(directory), directory); await rm(directory, {recursive: true, force: true});
  }
});
