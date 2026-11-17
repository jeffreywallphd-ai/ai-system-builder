import assert from "node:assert/strict";
import {createHash, randomUUID} from "node:crypto";
import {mkdtemp, realpath, rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import test from "node:test";
import {openLocalSqliteDatabase, resolveLocalSqliteDatabasePolicy} from "../../sqlite";
import type {StructuredDocumentStore} from "../../shared";
import {createStructuredOrganizationRepositories} from "../../organization";
import {createLocalWorkspaceRepository} from "../../workspace";
import {createStructuredIngestionAcquisitionRepository} from "../createStructuredIngestionAcquisitionRepository";
import {createStructuredHeadlessPlanReviewRepository} from "../../system-builder/createStructuredHeadlessPlanReviewRepository";
import {HeadlessBuildPlanReviewUseCase} from "../../../../application/use-cases/system-builder/headless-build-plan-review.use-case";
import {AuthorizeWorkspaceOperationService, createOrganizationAuthorizationPolicy} from "../../../../application/services/security";
import {composeDesktopHeadlessPlanReview} from "../../../../hosts/desktop/composition/composeDesktopHeadlessPlanReview";
import {composeManagedHeadlessPlanReview} from "../../../../hosts/server/composition/composeManagedHeadlessPlanReview";
import {composeHeadlessDatasetTaskStatus} from "../../../../hosts/shared/composition/headlessPlanReview";
import {normalizeIngestionTaskRecord, normalizeIngestionSourceSnapshot} from "../../../../contracts/ingestion";
import {createOrganizationId} from "../../../../contracts/organization";
import {createWorkspaceId} from "../../../../contracts/workspace";
import {createTenantPlacementConfig} from "../../../../contracts/config";
import {HEADLESS_CONTRACT_VERSION, isHeadlessHostIncarnationId, parseHeadlessBuildPlanProposal,
  readHeadlessPlanReviewAgentRequest} from "../../../../contracts/headless";

for (const host of ["Desktop", "Managed"] as const) for (const channel of ["app-popup", "authenticated-chat"] as const)
test(`${host} approved dataset ${channel} starts once and retains an accepted receipt after outward access ends`, async () => {
  const directory = await realpath(await mkdtemp(join(await realpath(tmpdir()), "headless-dataset-host-")));
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
    const authorization = new AuthorizeWorkspaceOperationService({organizationContext: contexts, authorizer: {async execute(input) {
      const decision = await policy.authorize(input); if (!decision.allowed) throw new Error("Synthetic access ended."); return decision;
    }}});
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
    let current = true, starts = 0, statusReads = 0, loseAccessAfterStart = false;
    const scope = {organizationId, principalId, workspaceId, registeredClientId};
    const registration = {...scope, purpose: "plan-review" as const, isCurrent: () => current};
    const grant = {...scope, planReview: true as const, workspaceIds: [workspaceId], isCurrent: () => current};
    const systems = {composeHeadlessAuthoring() {throw new Error("Dataset task cannot use system commands.");}} as never;
    const getDatasetStart = async () => async (command: any, context: any, admission: any) => {
      assert.equal(context.organizationId, organizationId); assert.equal(context.principalId, principalId);
      assert.equal(command.recipe.task.textInputMode, "provided"); assert.equal(command.recipe.generation, undefined);
      assert.equal(command.quality.reviewRequired, true); assert.equal(admission.sources[0].storageKey, "private/synthetic.csv");
      assert.ok(await admission.stillAllowed()); assert.equal(await admission.issue(), "issued");
      starts++;
      if (loseAccessAfterStart) current = false;
      return {ok: true as const, value: {requestId: admission.taskId, taskType: "prepare-training-dataset", accepted: true as const, status: "queued" as const}};
    };
    const desktop = composeDesktopHeadlessPlanReview({hostIncarnationId, identity, platform, rootDirectory: directory,
      workspaces, authorization, isOpen: () => current, systems, getDatasetStart});
    // SQLite serializes this fixture's publication. Real Managed/PostgreSQL
    // stable-read behavior belongs to the controlled browser journey.
    const managedPlatform: StructuredDocumentStore = {...platform, async publishWithStableReads(check, publish) {
      return platform.runInOwnedTransaction!(async owner => await check(owner) && publish(), () => {});
    }};
    const managed = composeManagedHeadlessPlanReview({hostIncarnationId, platform: managedPlatform, rootDirectory: directory, workspaces,
      contexts, authorization, placement, systems, getDatasetStart});
    const input = {hostIncarnationId, workspaceId, steps: [{operation: "data.prepare-local-dataset", idempotencyKey: randomUUID(),
      sources: [{taskId: "source.task", fileId: "source.file", taskRevision: 1}],
      recipe: {kind: "provided-instruction-rows-v1", inputColumn: "question", outputColumn: "answer"},
      split: {trainRatio: 0.8, validationRatio: 0.1, testRatio: 0.1, seed: 42}, qualityPreset: "recommended"}]};
    const plan = parseHeadlessBuildPlanProposal(input, hostIncarnationId, {allowLocalFileSave: false, allowLocalDatasetPreparation: true});
    assert.ok(plan.ok);
    const fingerprint = createHash("sha256").update(JSON.stringify(plan.preview)).digest("hex");
    const submit = readHeadlessPlanReviewAgentRequest({version: HEADLESS_CONTRACT_VERSION, operation: "plan.submit",
      input: {...input, fingerprint}}, hostIncarnationId, {allowLocalFileSave: false, allowLocalDatasetPreparation: true});
    assert.ok(submit.ok);
    const submitted = host === "Desktop" ? await desktop.execute(submit.request, grant, async () => grant)
      : await managed(submit.request, registration, () => current);
    assert.ok(submitted.ok, JSON.stringify(submitted));
    const step = {version: HEADLESS_CONTRACT_VERSION, operation: "plan.run-step" as const,
      input: {hostIncarnationId, workspaceId, fingerprint, step: 1, approvalRevision: 2}};
    const run = () => host === "Desktop" ? desktop.runStep!(step, grant, async () => grant)
      : managed.runStep!(step, registration, () => current);
    assert.equal((await run()).result.ok, false); assert.equal(starts, 0);
    const reviews = createStructuredHeadlessPlanReviewRepository(platform, async () => current);
    const app = new HeadlessBuildPlanReviewUseCase(reviews, Date.now);
    const approved = await app.decide({fingerprint, expectedRevision: 1, decision: {kind: "approve", mode: "whole-plan"}},
      hostIncarnationId, scope, {...identity, channel, isCurrent: () => current, canDecide: async () => current});
    assert.ok(approved.ok);
    loseAccessAfterStart = true;
    assert.equal((await run()).result.ok, false); assert.equal(starts, 1);
    current = true; loseAccessAfterStart = false;
    const replay = await run(); assert.ok(replay.result.ok, JSON.stringify(replay));
    assert.equal(replay.result.value.kind, "replayed"); assert.equal(starts, 1);
    assert.doesNotMatch(JSON.stringify(replay), /private\/synthetic|private-source|storageKey|sourceArtifactIds/);
    assert.equal(await replay.publishIfCurrent?.(() => true), true);
    const status = composeHeadlessDatasetTaskStatus(platform, async () => ({async readAdmittedLocalDatasetStatus(taskId) {
      statusReads++; return {taskId, state: "review-required" as const};
    }}));
    const query = {version: HEADLESS_CONTRACT_VERSION, operation: "data.dataset-task-status" as const,
      input: {hostIncarnationId, workspaceId, selection: {kind: "plan-step" as const, fingerprint, step: 1}}};
    const authority = {context: scope, clientId: registeredClientId, stillAllowed: async () => current};
    assert.equal((await status.execute(query, authority)).ok, true); assert.equal(statusReads, 1);
    assert.equal((await status.execute(query, {...authority, clientId: randomUUID()})).ok, false); assert.equal(statusReads, 1);
    await repositories.memberships.saveMembership({...membership, status: "removed"});
    assert.equal(await replay.publishIfCurrent?.(() => true), false);
    assert.equal((await run()).result.ok, false); assert.equal(starts, 1);
  } finally {await db.close(); await rm(directory, {recursive: true, force: true});}
});
