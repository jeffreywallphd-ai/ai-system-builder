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
import {createStructuredIngestionAcquisitionRepository} from "../../../../adapters/persistence/ingestion/createStructuredIngestionAcquisitionRepository";
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
import {CONTEXT_MARKDOWN_PACK_MEDIA_TYPE} from "../../../../contracts/context-management";
import {TaskType, type ContextGenerationTaskRequest} from "../../../../contracts/runtime";
import {createOrganizationId} from "../../../../contracts/organization";
import {createWorkspaceId} from "../../../../contracts/workspace";
import {createTenantPlacementConfig} from "../../../../contracts/config";
import {HEADLESS_CONTRACT_VERSION as version, isHeadlessHostIncarnationId, parseHeadlessBuildPlanProposal,
  readHeadlessPlanReviewAgentRequest, type HeadlessPlanStepRequest} from "../../../../contracts/headless";

const sha = (bytes: Uint8Array) => "sha256:" + createHash("sha256").update(bytes).digest("hex");

for (const host of ["Desktop", "Managed"] as const)
for (const channel of ["app-popup", "authenticated-chat"] as const)
for (const mode of ["whole-plan", "each-change"] as const)
test(`${host} ${channel} ${mode} separately approves and saves an actual owned Context result once`, async () => {
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
    let starts = 0, writes = 0, current = true, ownerAvailable = true, peeks = 0;
    let payload: ContextGenerationTaskRequest | undefined;
    const resultStorage = createFilesystemContextResultByteStorageAdapter({rootDirectory: directory});
    const core = new ContextGenerationUseCase({taskReconciler: reconciler,
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
            data: {output: {name: handle, outputHandle: handle, mediaType: CONTEXT_MARKDOWN_PACK_MEDIA_TYPE,
              sizeBytes: resultBytes.length, digest: sha(resultBytes)},
            sourceInspections: [{...common, ready: true, sourceKind: "structured", format: "csv", textFields: ["text"], alreadyChunked: false, chunkCount: 1}],
            preview: {kind: "markdown-context-pack", name: payload.name, sourceCount: 1, manualEntryCount: 0, chunkCount: 1,
              items: [{id: "synthetic.topic", kind: "topic", text: "Synthetic reviewed content", citations: [{sourceArtifactId: source.artifactId, chunkIndex: 0}]}]},
            manifest: {schemaVersion: "1", kind: "markdown-context-pack", name: payload.name, mediaType: CONTEXT_MARKDOWN_PACK_MEDIA_TYPE,
              createdAt: at, sources: [{...common, chunkCount: 1, chunkingMode: "extracted"}], manualEntries: [],
              chunking: payload.chunking, contextPack: payload.contextPack}}} as never;
        },
        async cancelTask() {assert.fail("A successful save cannot cancel the source task.");},
        async listTasks() {assert.fail("No task discovery or adoption.");},
      },
      storage: {async retrieveArtifact(request) {
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
    const desktop = composeDesktopHeadlessPlanReview({hostIncarnationId, identity, platform, rootDirectory: directory,
      workspaces, authorization, isOpen: () => current, systems, getContextStart: async () => core.startAdmittedContext.bind(core), peekContextResults});
    // A real SQLite transaction exercises the composed Managed application. It
    // does not claim physical PostgreSQL, browser or model qualification.
    const managedPlatform: StructuredDocumentStore = {...platform, async publishWithStableReads(check, publish) {
      return platform.runInOwnedTransaction!(async owner => await check(owner) && publish(), () => {});
    }};
    const managed = composeManagedHeadlessPlanReview({hostIncarnationId, platform: managedPlatform, rootDirectory: directory, workspaces,
      contexts, authorization, placement, systems, getContextStart: async () => core.startAdmittedContext.bind(core), peekContextResults});
    const capability = {allowLocalFileSave: false, allowContextPackGeneration: true, allowContextResultSave: true};
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
    const settings = {kind: "markdown-context-pack", cleaningPreset: "standard", chunkCharacters: 500, overlapCharacters: 50,
      maximumChunks: 100, textFields: ["text"]};
    const generation = await propose([{operation: "context.generate-pack", idempotencyKey: randomUUID(), name: "Synthetic context",
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
    ownerAvailable = false;
    const replay = await run(save.fingerprint); assert.ok(replay.result.ok, JSON.stringify(replay.result));
    assert.deepEqual(replay.result.value, {...saved.result.value, kind: "replayed"}); assert.equal(writes, 1); assert.equal(starts, 1);
    assert.equal(await replay.publishIfCurrent?.(() => true), true);
    current = false;
    assert.equal((await run(save.fingerprint)).result.ok, false);
    assert.equal((await reads.execute(request, {context, clientId: registeredClientId, stillAllowed: async () => current})).ok, false);
    current = true;
    await repositories.memberships.saveMembership({...membership, status: "removed"});
    assert.equal(await replay.publishIfCurrent?.(() => true), false); assert.equal((await run(save.fingerprint)).result.ok, false);
    assert.equal(writes, 1); assert.equal(starts, 1);
  } finally {
    await reconciler.settleAfterRuntimeStop(["python"]); await db.close();
    if (originalTemp === undefined) delete process.env.TEMP; else process.env.TEMP = originalTemp;
    if (originalTmp === undefined) delete process.env.TMP; else process.env.TMP = originalTmp;
    assert.equal(await realpath(directory), directory); await rm(directory, {recursive: true, force: true});
  }
});
