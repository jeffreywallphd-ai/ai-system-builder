import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import test from "node:test";
import { createInMemoryStructuredDocumentStore, type StructuredDocumentStore } from "../../shared";
import { GovernedIngestionTaskUseCases } from "../../../../application/use-cases/ingestion-acquisition/governed-ingestion-tasks.use-case";
import { RegisterArtifactFromRepoUseCase } from "../../../../application/use-cases/register-artifact-from-repo.use-case";
import { HeadlessBuildPlanReviewUseCase } from "../../../../application/use-cases/system-builder/headless-build-plan-review.use-case";
import { createOrganizationId } from "../../../../contracts/organization";
import { createWorkspaceId } from "../../../../contracts/workspace";
import { createHasArtifactInRepoSuccessResult } from "../../../../contracts/storage";
import { isHeadlessHostIncarnationId, parseHeadlessBuildPlanProposal } from "../../../../contracts/headless";
import { createStructuredIngestionAcquisitionRepository } from "../createStructuredIngestionAcquisitionRepository";
import { createStructuredHeadlessProviderFileSelectionRepository } from "../createStructuredHeadlessLocalFileSelectionRepository";
import { createStructuredHeadlessPlanReviewRepository } from "../../system-builder/createStructuredHeadlessPlanReviewRepository";
import { prepareStructuredHeadlessPlanStep } from "../../system-builder/createStructuredHeadlessPlanStepOperationStore";
import type { OwnedProviderPublication } from "../createStructuredHeadlessProviderFilePlanStepStore";

for (const interruption of ["revoked-at-commit", "selection-expires-at-commit", "receipt-write-failed",
  "reply-lost-after-commit", "ordinary-app-import"] as const) {
  test(`approved provider publication handles ${interruption} without adopting another result`, async () => {
    const base = createInMemoryStructuredDocumentStore();
    let current = true;
    let clock = Date.now();
    let interrupted = false;
    const createdAt = new Date(clock - 24 * 60 * 60 * 1_000 + 5_000).toISOString();
    const selectionDeadline = Date.parse(createdAt) + 24 * 60 * 60 * 1_000;
    const platform: StructuredDocumentStore = {
      ...base,
      async runInOwnedTransaction(work, beforeCommit) {
        let wroteEffect = false;
        const watch = (owner: StructuredDocumentStore): StructuredDocumentStore => ({
          ...owner,
          forOrganization: id => watch(owner.forOrganization(id)),
          runInTransaction: callback => owner.runInTransaction(transaction => callback(watch(transaction))),
          async writeDocument(namespace, key, value, options) {
            if (namespace === "headless/data/provider-file-plan-effects" && interruption === "receipt-write-failed") {
              interrupted = true;
              throw new Error("Synthetic receipt write failure.");
            }
            const result = await owner.writeDocument(namespace, key, value, options);
            if (namespace === "headless/data/provider-file-plan-effects") wroteEffect = true;
            return result;
          },
        });
        const result = await base.runInOwnedTransaction!(owner => work(watch(owner)), () => {
          if (wroteEffect && !interrupted) {
            interrupted = true;
            if (interruption === "revoked-at-commit") current = false;
            if (interruption === "selection-expires-at-commit") clock = selectionDeadline;
          }
          beforeCommit();
        });
        if (wroteEffect && interruption === "reply-lost-after-commit") throw new Error("Synthetic acknowledgement loss.");
        return result;
      },
    };
    const organizationId = createOrganizationId("provider-plan-fixture");
    const workspaceId = createWorkspaceId("provider-workspace");
    const principalId = "provider-owner";
    const registeredClientId = randomUUID();
    const hostIncarnationId = randomUUID();
    assert.ok(isHeadlessHostIncarnationId(hostIncarnationId));
    const documents = platform.forOrganization(organizationId);
    const context = { organizationId, principalId, workspaceId };
    const makeRepository = (owner: StructuredDocumentStore) =>
      createStructuredIngestionAcquisitionRepository(owner, async (transaction, artifact) => {
        await transaction.writeDocument("synthetic/provider-catalog", artifact.catalog.storageKey, artifact.catalog, { expectedRevision: 0 });
        await transaction.writeDocument("synthetic/provider-binding", artifact.binding.artifactId, artifact.binding, { expectedRevision: 0 });
      });
    const publish: OwnedProviderPublication = (owner, ...input) => makeRepository(owner).saveTaskWithProviderArtifact!(...input);
    const repository = makeRepository(documents);
    let providerReads = 0;
    const ingestion = new GovernedIngestionTaskUseCases({
      repository, checkpoints: {} as never, streamStorage: {} as never, artifactCleanup: {} as never,
      organizationContextProvider: { getCurrentOrganizationContext: () => context },
      now: () => new Date(clock).toISOString(),
      registerArtifactFromRepo: new RegisterArtifactFromRepoUseCase({
        artifactRepoStorage: { async hasArtifactInRepo() {
          providerReads++;
          return createHasArtifactInRepoSuccessResult(true);
        } } as never,
        artifactBindingStorage: {} as never, artifactCatalogAppend: {} as never, logging: { log() {} },
      }),
    });
    const source = { repository: "example/synthetic", path: "data/train.parquet", revision: "b".repeat(40) };
    const selectedAt = clock;
    clock = Date.parse(createdAt);
    const created = await ingestion.createHuggingFaceTask({ files: [source] }, context);
    assert.ok(created.ok);
    clock = selectedAt;
    // A source selected near its own expiry can outlive neither that deadline nor approval.
    const staged = created.value;
    const selected = { hostIncarnationId, workspaceId, taskId: staged.taskId,
      fileId: staged.files[0]!.fileId, taskRevision: staged.revision };
    const choice = { organizationId, principalId, registeredClientId, target: selected };
    assert.equal(await createStructuredHeadlessProviderFileSelectionRepository(documents, () => clock)
      .record(choice, 0, () => current), 1);
    const proposal = { hostIncarnationId, workspaceId, steps: [{
      operation: "data.save-provider-source", taskId: selected.taskId, fileId: selected.fileId,
      taskRevision: selected.taskRevision, idempotencyKey: randomUUID(),
    }] };
    const decoded = parseHeadlessBuildPlanProposal(proposal, hostIncarnationId, { allowLocalFileSave: false, allowProviderFileSave: true });
    assert.ok(decoded.ok);
    const fingerprint = createHash("sha256").update(JSON.stringify(decoded.preview)).digest("hex");
    const target = { hostIncarnationId, fingerprint, scope: { ...context, registeredClientId } };
    const plans = createStructuredHeadlessPlanReviewRepository(platform, async () => current, () => clock,
      async () => true, false, true);
    assert.ok((await plans.propose({ target, proposal, isCurrent: () => current })).ok);
    assert.ok((await new HeadlessBuildPlanReviewUseCase(plans, () => clock).decide({
      fingerprint, expectedRevision: 1, decision: { kind: "approve", mode: "whole-plan" },
    }, hostIncarnationId, target.scope, { organizationId, principalId, channel: "app-popup",
      isCurrent: () => current, canDecide: async () => current })).ok);
    const prepare = () => prepareStructuredHeadlessPlanStep(platform, { target, approvalRevision: 2, step: 1,
      isCurrent: () => current }, async () => current, () => clock, "serialized-owner", false, publish);
    const prepared = await prepare();
    assert.ok(prepared?.kind === "provider-file");
    if (interruption === "ordinary-app-import") {
      const imported = await ingestion.runHuggingFaceTask(staged.taskId, context);
      assert.ok(imported.ok && imported.value.status === "succeeded");
      assert.equal(await prepared.inspect(), undefined);
      assert.equal(await prepared.readReceipt(), undefined);
      assert.equal(providerReads, 1);
      assert.equal((await documents.listDocuments("synthetic/provider-catalog")).length, 1);
      assert.equal((await documents.listDocuments("headless/data/provider-file-plan-effects")).length, 0);
      return;
    }
    const observed = await prepared.inspect();
    assert.ok(observed?.kind === "staged");
    const outcome = await ingestion.finalizeApprovedProviderFile({
      preview: observed.preview, isCurrent: prepared.isCurrent, stillAllowed: prepared.stillAllowed, publish: prepared.publish,
    }, context);
    assert.equal(interrupted, true);
    assert.equal(outcome.ok, false);
    assert.equal(providerReads, 1);
    const after = await repository.readTask(workspaceId, staged.taskId);
    const catalogs = await documents.listDocuments("synthetic/provider-catalog");
    const effects = await documents.listDocuments("headless/data/provider-file-plan-effects");
    if (interruption === "reply-lost-after-commit") {
      assert.ok(after?.status === "succeeded");
      assert.equal(catalogs.length, 1);
      assert.equal(effects.length, 1);
      const retry = await prepare();
      assert.ok(retry?.kind === "provider-file");
      const replay = await retry.inspect();
      assert.ok(replay?.kind === "replayed");
      assert.equal(replay.receipt.taskRevision, staged.revision + 1);
      assert.equal(providerReads, 1);
    } else {
      assert.deepEqual(after, staged);
      assert.equal(catalogs.length, 0);
      assert.equal(effects.length, 0);
    }
  });
}
