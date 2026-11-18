import assert from "node:assert/strict";
import {createHash, randomUUID} from "node:crypto";
import {mkdir, mkdtemp, realpath, rm, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import test from "node:test";
import {openLocalSqliteDatabase, resolveLocalSqliteDatabasePolicy} from "../../sqlite";
import type {StructuredDocumentStore} from "../../shared";
import {createStructuredOrganizationRepositories} from "../../organization";
import {createLocalWorkspaceRepository} from "../../workspace";
import {createStructuredDatasetVersionRepository} from "../../dataset-version";
import {createStructuredHeadlessPlanReviewRepository} from "../../system-builder/createStructuredHeadlessPlanReviewRepository";
import {reserveStructuredDatasetPlanTask, issueStructuredDatasetPlanTask, acceptStructuredDatasetPlanTask} from "../createStructuredHeadlessDatasetPlanTaskStore";
import {HeadlessBuildPlanReviewUseCase} from "../../../../application/use-cases/system-builder/headless-build-plan-review.use-case";
import {AuthorizeWorkspaceOperationService, createOrganizationAuthorizationPolicy} from "../../../../application/services/security";
import {composeDesktopHeadlessPlanReview} from "../../../../hosts/desktop/composition/composeDesktopHeadlessPlanReview";
import {composeManagedHeadlessPlanReview} from "../../../../hosts/server/composition/composeManagedHeadlessPlanReview";
import type {HeadlessDatasetResultOwner} from "../../../../hosts/shared/composition/headlessPlanReview";
import {normalizeDatasetVersionRecord} from "../../../../contracts/dataset";
import {createOrganizationId} from "../../../../contracts/organization";
import {createWorkspaceId} from "../../../../contracts/workspace";
import {createTenantPlacementConfig} from "../../../../contracts/config";
import {HEADLESS_CONTRACT_VERSION, isHeadlessHostIncarnationId, parseHeadlessBuildPlanProposal,
  readHeadlessLocalDatasetPlanRequest, readHeadlessPlanReviewAgentRequest} from "../../../../contracts/headless";
import {assertCurrentProvidedDatasetWorker} from "../../../../../dev-tools/scripts/qualification/visual-composer/managed-reference-host";

test("provided-data host qualification refuses an older packaged entry or mapper before runtime use", async () => {
  const root = await realpath(await mkdtemp(join(await realpath(tmpdir()), "headless-worker-freshness-")));
  try {
    for (const directory of ["modules/adapters/runtime/python/worker", "out/ai-system-builder-win32-x64/resources/worker"])
      for (const name of ["main.py", "tasks/prepare_training_dataset.py"]) {
        const target = join(root, directory, name); await mkdir(join(target, ".."), {recursive: true});
        await writeFile(target, "# current synthetic worker\n", {flag: "wx"});
      }
    await assertCurrentProvidedDatasetWorker(root);
    const mapper = join(root, "out/ai-system-builder-win32-x64/resources/worker/tasks/prepare_training_dataset.py");
    await writeFile(mapper, "# old synthetic worker\n");
    await assert.rejects(assertCurrentProvidedDatasetWorker(root), /Rebuild the packaged worker/);
    await writeFile(mapper, "# current synthetic worker\n");
    await rm(join(root, "out/ai-system-builder-win32-x64/resources/worker/main.py"));
    await assert.rejects(assertCurrentProvidedDatasetWorker(root));
  } finally {await rm(root, {recursive: true, force: true});}
});

type Host = "Desktop" | "Managed";
type Variation = "normal" | "lost-ack" | "withdrawn" | "removed-role" | "changed-report";
async function fixture(host: Host, variation: Variation) {
  const directory = await realpath(await mkdtemp(join(await realpath(tmpdir()), "headless-result-host-")));
  const db = await openLocalSqliteDatabase({policy: resolveLocalSqliteDatabasePolicy({dataRootDirectory: directory})});
  try {
  let loseNextCommitAck = false;
  const platform: StructuredDocumentStore = {...db.documents, async runInOwnedTransaction(work, fence) {
    const result = await db.documents.runInOwnedTransaction!(work, fence);
    if (loseNextCommitAck) {loseNextCommitAck = false; throw new Error("Synthetic commit acknowledgement loss.");}
    return result;
  }};
  const organizationId = createOrganizationId("org.synthetic"), workspaceId = createWorkspaceId("workspace.synthetic");
  const hostIncarnationId = randomUUID(); assert.ok(isHeadlessHostIncarnationId(hostIncarnationId));
  const principalId = "principal.synthetic", registeredClientId = randomUUID(), at = "2026-11-17T00:00:00.000Z";
  const scope = {organizationId, workspaceId, principalId, registeredClientId};
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
  const original = readHeadlessLocalDatasetPlanRequest({version: HEADLESS_CONTRACT_VERSION, operation: "data.prepare-local-dataset", input: {
    hostIncarnationId, workspaceId, idempotencyKey: randomUUID(), sources: [{taskId: "source.task", fileId: "source.file", taskRevision: 1}],
    recipe: {kind: "provided-instruction-rows-v1", inputColumn: "question", outputColumn: "answer"},
    split: {trainRatio: 0.8, validationRatio: 0.1, testRatio: 0.1, seed: 42}, qualityPreset: "recommended"}}, hostIncarnationId);
  assert.ok(original.ok);
  const originalEffect = {key: randomUUID(), target: {hostIncarnationId, fingerprint: "a".repeat(64), scope},
    approvalRevision: 2, step: 1, request: original.request};
  const task = await platform.runInOwnedTransaction!(owner => reserveStructuredDatasetPlanTask(owner.forOrganization(organizationId),
    originalEffect, "b".repeat(64), 1), () => {});
  assert.ok("taskId" in task);
  await platform.runInOwnedTransaction!(async owner => {
    const part = owner.forOrganization(organizationId);
    assert.ok(await issueStructuredDatasetPlanTask(part, originalEffect, task.taskId, "b".repeat(64), 2));
    assert.ok(await acceptStructuredDatasetPlanTask(part, originalEffect, task.taskId, 3));
  }, () => {});
  const review = {taskId: task.taskId, reportFingerprint: "c".repeat(64), policyFingerprint: `sha256:${"e".repeat(64)}` as const,
    status: "ready" as const, counts: {inputRows: 2, acceptedRows: 2, quarantinedRows: 0}, reasonCounts: {},
    splits: {trainRows: 2, validationRows: 0, testRows: 0}, approvalAllowed: true, saveAvailable: true};
  const digest = `sha256:${"f".repeat(64)}` as const;
  const version = normalizeDatasetVersionRecord({schemaVersion: "1.0", workspaceId, organizationId, datasetId: "reviewed-answers",
    versionId: "reviewed-answers:1234", versionDigest: digest,
    artifacts: [{role: "dataset", artifactKey: "prepared/answers.jsonl", digest, mediaType: "application/x-ndjson", sizeBytes: 64, rowCount: 2},
      {role: "train", artifactKey: "prepared/train.jsonl", digest, mediaType: "application/x-ndjson", sizeBytes: 64, rowCount: 2},
      {role: "recipe", artifactKey: "prepared/recipe.json", digest, mediaType: "application/json", sizeBytes: 32}],
    lineage: {sources: [{artifactKey: "source.one", digest, mediaType: "text/csv"}],
      recipe: {artifactKey: "prepared/recipe.json", digest, implementationId: "builtin.dataset-preparation", implementationVersion: "1.0.0"},
      quality: {policyId: "recommended", policyVersion: "1", policyFingerprint: review.policyFingerprint,
        reportFingerprint: `sha256:${review.reportFingerprint}`}, split: {strategy: "source-group", seed: 42}},
    documentation: {name: "Reviewed answers", summary: "Synthetic support answers.", intendedUses: ["Tests."], limitations: ["Synthetic only."]},
    totalRows: 2, createdAt: at, createdBy: principalId});
  let current = true, saves = 0, commits = 0;
  const processor: HeadlessDatasetResultOwner = {
    peekAdmittedLocalDatasetReview(taskId, context) {
      return taskId === task.taskId && context.organizationId === organizationId && context.principalId === principalId &&
        context.workspaceId === workspaceId ? structuredClone(review) : undefined;
    },
    async saveAdmittedLocalProvidedDataset(approval, context, admission) {
      assert.equal(approval.requestId, task.taskId); assert.equal(context.principalId, principalId);
      assert.ok(admission.isCurrent()); assert.ok(await admission.stillAllowed());
      // The production owner marks the attempt before issue. This transient
      // availability change must not change the approved quality identity.
      review.saveAvailable = false;
      assert.equal(await admission.issue(), "issued"); saves++;
      if (variation === "withdrawn") current = false;
      if (variation === "removed-role") await repositories.memberships.saveMembership({...membership, status: "removed"});
      if (variation === "changed-report") review.reportFingerprint = "d".repeat(64);
      if (variation === "lost-ack") loseNextCommitAck = true;
      try {await admission.commit(version); commits++;}
      catch {return {ok: false, error: {code: "unavailable", message: "Synthetic save unavailable."}} as never;}
      return {ok: true, value: {}} as never;
    },
  };
  const registration = {...scope, purpose: "plan-review" as const, isCurrent: () => current};
  const grant = {...scope, planReview: true as const, workspaceIds: [workspaceId], isCurrent: () => current};
  const systems = {composeHeadlessAuthoring() {throw new Error("A dataset save cannot call system authoring.");}} as never;
  const desktop = composeDesktopHeadlessPlanReview({hostIncarnationId, identity, platform, rootDirectory: directory,
    workspaces, authorization, isOpen: () => current, systems, getDatasetResults: async () => processor});
  // The production Managed journey separately qualifies PostgreSQL stable reads.
  const managedPlatform: StructuredDocumentStore = {...platform, async publishWithStableReads(check, publish) {
    return platform.runInOwnedTransaction!(async owner => await check(owner) && publish(), () => {});
  }};
  const managed = composeManagedHeadlessPlanReview({hostIncarnationId, platform: managedPlatform, rootDirectory: directory,
    workspaces, contexts, authorization, placement, systems, getDatasetResults: async () => processor});
  const input = {hostIncarnationId, workspaceId, steps: [{operation: "data.save-prepared-dataset", idempotencyKey: randomUUID(),
    taskId: task.taskId, reportFingerprint: review.reportFingerprint, outputBaseName: "Reviewed answers"}]};
  const capabilities = {allowLocalFileSave: false, allowDatasetResultSave: true};
  const proposal = parseHeadlessBuildPlanProposal(input, hostIncarnationId, capabilities); assert.ok(proposal.ok);
  const fingerprint = createHash("sha256").update(JSON.stringify(proposal.preview)).digest("hex");
  const submit = readHeadlessPlanReviewAgentRequest({version: HEADLESS_CONTRACT_VERSION, operation: "plan.submit",
    input: {...input, fingerprint}}, hostIncarnationId, capabilities); assert.ok(submit.ok);
  const submitted = host === "Desktop" ? await desktop.execute(submit.request, grant, async () => grant)
    : await managed(submit.request, registration, () => current);
  assert.ok(submitted.ok, JSON.stringify(submitted));
  const request = {version: HEADLESS_CONTRACT_VERSION, operation: "plan.run-step" as const,
    input: {hostIncarnationId, workspaceId, fingerprint, step: 1, approvalRevision: 2}};
  const run = () => host === "Desktop" ? desktop.runStep!(request, grant, async () => grant)
    : managed.runStep!(request, registration, () => current);
  const app = new HeadlessBuildPlanReviewUseCase(createStructuredHeadlessPlanReviewRepository(platform, async () => current), Date.now);
  return {run, scope, review, version, saves: () => saves, commits: () => commits,
    versions: createStructuredDatasetVersionRepository(documents),
    async approve(channel: "app-popup" | "authenticated-chat", mode: "whole-plan" | "each-change") {
      const approved = await app.decide({fingerprint, expectedRevision: 1,
        decision: mode === "whole-plan" ? {kind: "approve", mode} : {kind: "approve", mode, step: 1}},
      hostIncarnationId, scope, {...identity, channel, isCurrent: () => current, canDecide: async () => current});
      assert.ok(approved.ok, JSON.stringify(approved));
    },
    async close() {await db.close(); await rm(directory, {recursive: true, force: true});},
  };
  } catch (error) {
    await db.close(); await rm(directory, {recursive: true, force: true}); throw error;
  }
}

for (const host of ["Desktop", "Managed"] as const) {
  for (const channel of ["app-popup", "authenticated-chat"] as const) for (const mode of ["whole-plan", "each-change"] as const)
    test(`${host} ${channel} ${mode} saves one reviewed version and replays its exact receipt`, async () => {
      const f = await fixture(host, "normal");
      try {
        assert.equal((await f.run()).result.ok, false); assert.equal(f.saves(), 0);
        await f.approve(channel, mode);
        const result = await f.run(); assert.ok(result.result.ok, JSON.stringify(result));
        assert.equal(result.result.value.kind, "committed");
        assert.equal(result.result.value.operation, "data.save-prepared-dataset");
        assert.equal(await result.publishIfCurrent?.(() => true), true);
        const replay = await f.run(); assert.ok(replay.result.ok, JSON.stringify(replay));
        assert.equal(replay.result.value.kind, "replayed"); assert.equal(f.saves(), 1); assert.equal(f.commits(), 1);
        assert.deepEqual(await f.versions.listVersions(f.scope.workspaceId), [f.version]);
        assert.doesNotMatch(JSON.stringify(result), /prepared\/|source\.one|policyFingerprint|saveId|sourceDigest/);
      } finally {await f.close();}
    });
  test(`${host} confirms a lost metadata commit acknowledgement without a second publication`, async () => {
    const f = await fixture(host, "lost-ack");
    try {
      await f.approve("app-popup", "whole-plan");
      const saved = await f.run(); assert.ok(saved.result.ok, JSON.stringify(saved));
      const replay = await f.run(); assert.ok(replay.result.ok);
      assert.equal(replay.result.value.kind, "replayed"); assert.equal(f.saves(), 1); assert.equal(f.commits(), 1);
      assert.deepEqual(await f.versions.listVersions(f.scope.workspaceId), [f.version]);
    } finally {await f.close();}
  });
  for (const variation of ["withdrawn", "removed-role", "changed-report"] as const)
    test(`${host} ${variation} before final publication cannot create or retry a dataset version`, async () => {
      const f = await fixture(host, variation);
      try {
        await f.approve("authenticated-chat", "each-change");
        assert.equal((await f.run()).result.ok, false); assert.equal(f.saves(), 1); assert.equal(f.commits(), 0);
        assert.deepEqual(await f.versions.listVersions(f.scope.workspaceId), []);
        assert.equal((await f.run()).result.ok, false); assert.equal(f.saves(), 1);
      } finally {await f.close();}
    });
}
