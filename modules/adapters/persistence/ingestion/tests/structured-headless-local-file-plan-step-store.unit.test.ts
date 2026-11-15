import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import type { HeadlessLocalFileSelection } from "../../../../application/ports/ingestion/headless-local-file-selection.port";
import { normalizeIngestionFilePublication } from "../../../../application/shared/ingestion-file-publication";
import { HeadlessBuildPlanReviewUseCase } from "../../../../application/use-cases/system-builder/headless-build-plan-review.use-case";
import { isHeadlessHostIncarnationId, parseHeadlessBuildPlanProposal, readHeadlessPlanStepResult } from "../../../../contracts/headless";
import { normalizeIngestionTaskRecord, type IngestionSourceSnapshot } from "../../../../contracts/ingestion";
import { createOrganizationId } from "../../../../contracts/organization";
import { createWorkspaceId } from "../../../../contracts/workspace";
import { createInMemoryStructuredDocumentStore, type StructuredDocumentStore } from "../../shared";
import { prepareStructuredHeadlessPlanStep } from "../../system-builder/createStructuredHeadlessPlanStepOperationStore";
import { createStructuredHeadlessPlanReviewRepository } from "../../system-builder/createStructuredHeadlessPlanReviewRepository";
import {
  createStructuredHeadlessLocalFileSelectionRepository, readStructuredHeadlessLocalFileSelection,
} from "../createStructuredHeadlessLocalFileSelectionRepository";
import { createStructuredIngestionAcquisitionRepository } from "../createStructuredIngestionAcquisitionRepository";
import { createStructuredIngestionFilePublicationRepository } from "../createStructuredIngestionFilePublicationRepository";

const hostIncarnationId = "d52c0a60-3384-48ce-80e4-6102898ad428";
assert.ok(isHeadlessHostIncarnationId(hostIncarnationId));
const workspaceId = createWorkspaceId("workspace.synthetic");
const organizationId = createOrganizationId("organization-synthetic");
const principalId = "principal.synthetic";
const registeredClientId = "83739bf2-c08e-4d9d-ad84-da05ae2d17f3";
const otherClientId = "36c91778-901d-4e0b-8e71-329157e9d79f";
const start = "2026-11-15T10:00:00.000Z";
const checkpointExpiresAt = "2026-11-15T10:05:00.000Z";
const digest = `sha256:${"a".repeat(64)}` as const;

async function fixture() {
  const physical = createInMemoryStructuredDocumentStore();
  const clock = { time: Date.parse(start), expireCheckpointAtCommit: false };
  const root: StructuredDocumentStore = {
    ...physical,
    runInOwnedTransaction: (visit, beforeCommit) => physical.runInOwnedTransaction!(visit, () => {
      if (clock.expireCheckpointAtCommit) {
        clock.expireCheckpointAtCommit = false;
        clock.time = Date.parse(checkpointExpiresAt);
      }
      beforeCommit();
    }),
  };
  const partition = root.forOrganization(organizationId);
  const tasks = createStructuredIngestionAcquisitionRepository(partition);
  const publications = createStructuredIngestionFilePublicationRepository(partition);
  const now = () => clock.time;
  let current = true;
  let permitted = true;
  const isCurrent = () => current;
  const authorize = async () => permitted;
  const staged = normalizeIngestionTaskRecord({ schemaVersion: "1.0", taskId: "ingestion.synthetic", workspaceId, organizationId,
    kind: "file-batch", status: "transferring", revision: 1, cleanupPending: true, checkpointExpiresAt,
    createdAt: start, updatedAt: start, progress: { acceptedBytes: 3, totalBytes: 3, completedItems: 0, totalItems: 1, percent: 100 },
    files: [{ fileId: "file.synthetic", checkpointId: "checkpoint.synthetic", fileName: "synthetic.csv", mediaType: "text/csv", totalBytes: 3,
      acceptedBytes: 3, nextChunkIndex: 1, lastChunk: { index: 0, sizeBytes: 3, digest }, status: "transferring" }] });
  await tasks.createTask(staged);
  const { taskId } = staged;
  const { fileId } = staged.files[0]!;
  const scope = { workspaceId, organizationId, principalId, registeredClientId };
  const selected: HeadlessLocalFileSelection = { organizationId, principalId, registeredClientId,
    target: { workspaceId, taskId, fileId, taskRevision: 1, hostIncarnationId } };
  const selections = createStructuredHeadlessLocalFileSelectionRepository(partition, now);
  assert.equal(await selections.record(selected, 0, isCurrent), 1);
  const raw = { workspaceId, hostIncarnationId, steps: [
    { operation: "data.save-local-source", taskId, fileId, taskRevision: 1, idempotencyKey: "e6b5f077-1a85-4ca3-8067-34f8aa6086da" },
    { operation: "systems.create", name: "Synthetic intake", templateId: "reference.secured-data-review@1.0.0",
      idempotencyKey: "d49581b9-04b0-4af6-8fc0-fd38d21ef68f" },
  ] };
  const parsed = parseHeadlessBuildPlanProposal(raw, hostIncarnationId, { allowLocalFileSave: true });
  assert.ok(parsed.ok);
  const fingerprint = createHash("sha256").update(JSON.stringify(parsed.preview)).digest("hex");
  const target = { hostIncarnationId, fingerprint, scope };
  const reviews = createStructuredHeadlessPlanReviewRepository(root, authorize, now,
    async owner => (await readStructuredHeadlessLocalFileSelection(owner, selected, now))?.ok === true, true);
  assert.ok((await reviews.propose({ target, isCurrent, proposal: raw })).ok);
  const request = { target, approvalRevision: 2, step: 1, isCurrent };
  const prepare = (allowLocalFileSave = true, client = registeredClientId, step = 1) =>
    prepareStructuredHeadlessPlanStep(root, { ...request, step, target: { ...target, scope: { ...scope, registeredClientId: client } } },
      authorize, now, "serialized-owner", allowLocalFileSave);
  const approval = new HeadlessBuildPlanReviewUseCase(reviews, now);
  const actor = { organizationId, principalId, channel: "app-popup" as const, isCurrent, canDecide: authorize };
  async function approve() {
    const result = await approval.decide({ fingerprint, expectedRevision: 1,
      decision: { kind: "approve", mode: "whole-plan" } }, hostIncarnationId, scope, actor);
    assert.ok(result.ok);
  }
  async function withdraw() {
    assert.ok((await approval.decide({ fingerprint, expectedRevision: 2,
      decision: { kind: "revoke" } }, hostIncarnationId, scope, actor)).ok);
  }
  async function reserve() {
    const finalizing = await tasks.saveTask({ ...staged, status: "finalizing", revision: 2 }, 1);
    const publication = await publications.createPublication(normalizeIngestionFilePublication({
      schemaVersion: "1.0", publicationId: "b".repeat(32), workspaceId, organizationId, taskId, fileId,
      checkpointId: "checkpoint.synthetic", taskCreatedAt: start, checkpointExpiresAt, fileName: "synthetic.csv",
      mediaType: "text/csv", totalBytes: 3, acceptedBytes: 3, nextChunkIndex: 1, expectedSha256: digest,
      key: `workspaces/${workspaceId}/artifacts/files/ingestion/${"b".repeat(32)}`, capturedAt: start, revision: 1, state: "reserved",
    }));
    return { finalizing, publication };
  }
  return { clock, prepare, approve, withdraw, reserve, tasks, publications, scope, taskId, fileId, request, fingerprint,
    retire: () => { current = false; }, changeRole: () => { permitted = false; } };
}

test("an exact approved plan exclusively issues both file effects and re-reads the committed source", async () => {
  const subject = await fixture();
  assert.equal(await subject.prepare(), undefined);
  await subject.approve();
  assert.equal(await subject.prepare(false), undefined);
  assert.equal(await subject.prepare(true, otherClientId), undefined);
  assert.equal(await subject.prepare(true, registeredClientId, 2), undefined);
  const preparation = await subject.prepare();
  assert.equal(preparation?.kind, "local-file");
  if (preparation?.kind !== "local-file") throw new Error("The local-file step is missing.");
  assert.equal((await preparation.inspect())?.kind, "staged");
  const { finalizing, publication } = await subject.reserve();
  const writing = { ...publication, state: "writing" as const, revision: 2 };
  const claims = await Promise.allSettled([preparation.issuePublication(writing, 1), preparation.issuePublication(writing, 1)]);
  assert.equal(claims.filter(claim => claim.status === "fulfilled").length, 1);
  const acknowledged = await subject.publications.savePublication({ ...writing, state: "bytes-acknowledged", revision: 3, digest }, 2);
  const origin = await preparation.issuePublication({ ...acknowledged, state: "origin-issued", revision: 4 }, 3);
  assert.equal(await preparation.readReceipt(), undefined);
  assert.equal(await subject.prepare(true, registeredClientId, 2), undefined);
  assert.equal(await preparation.publishIfCurrent(() => { throw new Error("A pending effect must never be released."); }), false);
  await subject.publications.savePublication({ ...origin, state: "origin-complete", revision: 5 }, 4);
  const snapshot: IngestionSourceSnapshot = { schemaVersion: "1.0", snapshotId: "snapshot.ingestion.synthetic.file.synthetic" as never,
    sourceId: "source.ingestion.synthetic.file.synthetic" as never, organizationId, workspaceId,
    locator: { kind: "file", displayName: "synthetic.csv", originalName: "synthetic.csv" },
    contentDigest: digest, sizeBytes: 3, mediaType: "text/csv", rawArtifactKey: publication.key, capturedAt: start };
  const committed = await subject.tasks.saveTaskWithSourceSnapshot(normalizeIngestionTaskRecord({ ...finalizing, revision: 3,
    progress: { ...finalizing.progress, completedItems: 1 },
    files: [{ ...finalizing.files[0]!, status: "finalized",
      output: { key: publication.key, mediaType: "text/csv", sizeBytes: 3, digest,
        sourceId: snapshot.sourceId, sourceSnapshotId: snapshot.snapshotId } }],
  }), 2, snapshot);
  const returned = { workspaceId, taskId: subject.taskId, fileId: subject.fileId, taskRevision: 3 };
  assert.deepEqual(await preparation.readReceipt(), returned);
  assert.equal((await subject.prepare(true, registeredClientId, 2))?.kind, "system");
  assert.deepEqual(await preparation.inspect(), { kind: "replayed", receipt: returned });
  await subject.tasks.saveTask(normalizeIngestionTaskRecord({ ...committed.task, status: "succeeded", revision: 4,
    completedAt: start, cleanupPending: false }), 3);
  assert.deepEqual(await preparation.readReceipt(), returned);
  let releases = 0;
  assert.equal(await preparation.publishIfCurrent(() => { releases++; return true; }), true);
  assert.equal(releases, 1);
  await subject.withdraw();
  assert.equal(await preparation.publishIfCurrent(() => { releases++; return true; }), false);
  assert.equal(releases, 1);
  assert.equal(await subject.prepare(), undefined);
});

for (const reason of ["revoked", "expired", "connection-ended", "role-changed", "wrong-file", "ordinary-byte-write"] as const) {
  test(`denies a new file phase when ${reason} and retains only proved state`, async () => {
    const subject = await fixture();
    await subject.approve();
    const preparation = await subject.prepare();
    assert.equal(preparation?.kind, "local-file");
    if (preparation?.kind !== "local-file") throw new Error("The local-file step is missing.");
    const { publication } = await subject.reserve();
    const writing = { ...publication, state: "writing" as const, revision: 2 };
    const issued = reason === "ordinary-byte-write" ? await subject.publications.savePublication(writing, 1) :
      await preparation.issuePublication(writing, 1);
    const acknowledged = await subject.publications.savePublication({ ...issued, state: "bytes-acknowledged", revision: 3, digest }, 2);
    if (reason === "revoked") await subject.withdraw();
    if (reason === "expired") subject.clock.time += 16 * 60_000;
    if (reason === "connection-ended") subject.retire();
    if (reason === "role-changed") subject.changeRole();
    await assert.rejects(preparation.issuePublication({ ...acknowledged, state: "origin-issued", revision: 4,
      ...(reason === "wrong-file" ? { fileId: "file.unselected" as never } : {}),
    }, 3));
    assert.equal((await subject.publications.readPublication(workspaceId, subject.taskId, subject.fileId))?.state, "bytes-acknowledged");
  });
}

test("rolls back a newly issued file phase if only the source checkpoint expires just before commit", async () => {
  const subject = await fixture();
  await subject.approve();
  const preparation = await subject.prepare();
  assert.equal(preparation?.kind, "local-file");
  if (preparation?.kind !== "local-file") throw new Error("The local-file step is missing.");
  const { publication } = await subject.reserve();
  subject.clock.expireCheckpointAtCommit = true;
  const writing = { ...publication, state: "writing" as const, revision: 2 };
  await assert.rejects(preparation.issuePublication(writing, 1));
  assert.equal(preparation.isCurrent(), true);
  assert.equal((await subject.publications.readPublication(workspaceId, subject.taskId, subject.fileId))?.state, "reserved");
  // No effect or plan fence survived the transaction rollback.
  subject.clock.time = Date.parse(start) + 1;
  assert.equal((await preparation.issuePublication(writing, 1)).state, "writing");
});

test("the local-file step reply is bounded to the exact request and workspace", () => {
  const target = { hostIncarnationId, workspaceId, fingerprint: "a".repeat(64), step: 1, approvalRevision: 2 };
  const saved = { kind: "committed", operation: "data.save-local-source", fingerprint: target.fingerprint,
    step: 1, approvalRevision: 2, expiresAt: Date.parse(checkpointExpiresAt),
    reference: { workspaceId, taskId: "ingestion.synthetic", fileId: "file.synthetic", taskRevision: 3 } };
  const options = { allowLocalFileSave: true };
  assert.deepEqual(readHeadlessPlanStepResult({ ok: true, value: saved }, target, options), { ok: true, value: saved });
  assert.deepEqual(readHeadlessPlanStepResult({ ok: true, value: saved }, target), { ok: false, code: "headless.unavailable" });
  for (const change of [{ workspaceId: "workspace.foreign" }, { taskRevision: 0 }, { path: "expected-to-be-rejected" }])
    assert.deepEqual(readHeadlessPlanStepResult({ ok: true, value: { ...saved, reference: { ...saved.reference, ...change } } }, target, options),
      { ok: false, code: "headless.unavailable" });
});
