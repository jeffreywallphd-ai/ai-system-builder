import assert from "node:assert/strict";
import test from "node:test";
import { createStructuredHeadlessLocalFileSelectionRepository } from "../../../../adapters/persistence/ingestion/createStructuredHeadlessLocalFileSelectionRepository";
import { createStructuredIngestionAcquisitionRepository } from "../../../../adapters/persistence/ingestion";
import { createInMemoryStructuredDocumentStore } from "../../../../adapters/persistence/shared";
import { HEADLESS_CONTRACT_VERSION, type HeadlessHostIncarnationId, type HeadlessLocalFileImportRequest } from "../../../../contracts/headless";
import { normalizeIngestionTaskFileId, normalizeIngestionTaskId, type IngestionTaskRecord } from "../../../../contracts/ingestion";
import { createOrganizationId } from "../../../../contracts/organization";
import { createWorkspaceId } from "../../../../contracts/workspace";
import { ReadHeadlessIngestionStatusUseCase } from "../headless-ingestion-status.use-case";
import { HeadlessLocalFileSelectionUseCase } from "../headless-local-file-selection.use-case";

const organizationId = createOrganizationId("org.data-sample");
const workspaceId = createWorkspaceId("workspace.data-sample");
const hostIncarnationId = "54133645-536c-43d2-8309-30701194add7" as HeadlessHostIncarnationId;
const registeredClientId = "34012ffc-feed-411f-b86b-1b80f5d0ba2f";
const anotherClient = "5aa32add-4a86-4a83-8123-ddf283420d00";
const taskId = normalizeIngestionTaskId("ingestion.selected");
const fileId = normalizeIngestionTaskFileId("file.selected");
const checkpointExpiresAt = "2025-01-01T00:01:00.000Z";
const epoch = "2025-01-01T00:00:00.000Z";
const request: HeadlessLocalFileImportRequest = {
  version: HEADLESS_CONTRACT_VERSION,
  operation: "data.prepare-local-file",
  input: { hostIncarnationId, workspaceId, taskId, fileId, taskRevision: 1 },
};
const forbidden = { ok: false, code: "headless.forbidden" };

async function fixture() {
  const documents = createInMemoryStructuredDocumentStore().forOrganization(organizationId);
  const tasks = createStructuredIngestionAcquisitionRepository(documents);
  const task: IngestionTaskRecord = await tasks.createTask({
    schemaVersion: "1.0", organizationId, workspaceId, taskId, kind: "file-batch", status: "queued",
    revision: 1, cleanupPending: true, createdAt: epoch, updatedAt: epoch, checkpointExpiresAt,
    files: [{ fileId, checkpointId: "checkpoint.empty", fileName: "synthetic.csv", mediaType: "text/csv",
      status: "pending", totalBytes: 0, acceptedBytes: 0, nextChunkIndex: 0 }],
    progress: { totalItems: 1, completedItems: 0, totalBytes: 0, acceptedBytes: 0, percent: 0 },
  });
  const observed = { calls: 0, current: true, now: Date.parse(epoch), onRead: async () => {} };
  const read = new ReadHeadlessIngestionStatusUseCase({
    async executeCommand(command, context) {
      assert.deepEqual(command, { action: "read", taskId });
      assert.equal(context.organizationId, organizationId);
      assert.equal(context.workspaceId, workspaceId);
      observed.calls++;
      await observed.onRead();
      return { ok: true, value: { kind: "task", task: (await tasks.readTask(workspaceId, taskId))! } };
    },
  }, () => observed.now);
  const authority = {
    context: { workspaceId, organizationId, principalId: "fixture-owner" },
    hostIncarnationId, registeredClientId,
    expectedSelectionRevision: 0,
    stillAllowed: async () => true,
    isCurrent: () => observed.current,
  };
  const selections = createStructuredHeadlessLocalFileSelectionRepository(documents, () => observed.now);
  return { sut: new HeadlessLocalFileSelectionUseCase(selections, read, () => observed.now),
    read, tasks, task, selections, documents, observed, authority };
}

test("only an app-selected ready file grants its paired agent a bounded preview", async () => {
  const { sut, task, tasks, authority, observed } = await fixture();
  assert.deepEqual(await sut.previewSelectedFile(request, authority), forbidden);
  assert.equal(observed.calls, 0);
  const preview = await sut.recordSelectedFile(request, authority);
  assert.deepEqual(preview, { ok: true, value: { workspaceId, taskId, fileId, taskRevision: 1,
    mediaType: "text/csv", fileBytes: 0, checkpointExpiresAt: Date.parse(checkpointExpiresAt),
    effect: "save-local-source", externalProviderCalls: 0 }, selectionRevision: 1 });
  assert.ok(preview.ok);
  assert.deepEqual(await sut.recordSelectedFile(request, authority), preview);
  assert.deepEqual(await sut.previewSelectedFile(request, authority), { ok: true, value: preview.value });
  assert.deepEqual(await tasks.readTask(workspaceId, taskId), task);
});

test("the exact organization, workspace, user, host and registration stay bound to the offered file", async () => {
  const { sut, authority, observed } = await fixture();
  const offered = await sut.recordSelectedFile(request, authority);
  assert.ok(offered.ok);
  const before = observed.calls;
  const otherOwner = { ...authority, context: { ...authority.context, principalId: "fixture-other-owner" } };
  const otherRegistration = { ...authority, registeredClientId: anotherClient };
  for (const other of [
    otherOwner,
    otherRegistration,
    { ...authority, context: { ...authority.context, organizationId: createOrganizationId("org.another") } },
    { ...authority, context: { ...authority.context, workspaceId: createWorkspaceId("workspace.another") } },
    { ...authority, hostIncarnationId: "d31e430a-34d1-4b43-b78b-af87d055ea2b" as HeadlessHostIncarnationId },
  ]) assert.deepEqual(await sut.previewSelectedFile(request, other), forbidden);
  assert.equal(observed.calls, before);
  assert.deepEqual(await sut.recordSelectedFile(request, { ...otherOwner, expectedSelectionRevision: 1 }), forbidden);
  assert.deepEqual(await sut.previewSelectedFile(request, authority), { ok: true, value: offered.value });

  // An explicit selection by the same app user can give the file to a different live registration.
  assert.deepEqual(await sut.recordSelectedFile(request, { ...otherRegistration, expectedSelectionRevision: 1 }),
    { ...offered, selectionRevision: 2 });
  assert.deepEqual(await sut.previewSelectedFile(request, authority), forbidden);
  assert.deepEqual(await sut.recordSelectedFile(request, authority), forbidden);
  assert.deepEqual(await sut.previewSelectedFile(request, otherRegistration), { ok: true, value: offered.value });
  assert.deepEqual(await sut.recordSelectedFile(request, { ...authority, expectedSelectionRevision: 2 }),
    { ...offered, selectionRevision: 3 });
  assert.deepEqual(await sut.previewSelectedFile(request, otherRegistration), forbidden);
});

test("stale, expired and retired selections cannot return a preview", async () => {
  const { sut, tasks, task, authority, observed } = await fixture();
  assert.ok((await sut.recordSelectedFile(request, authority)).ok);
  observed.now = Date.parse(checkpointExpiresAt);
  assert.deepEqual(await sut.previewSelectedFile(request, authority), { ok: false, code: "headless.source-not-ready" });
  observed.now = Date.parse(epoch);
  await tasks.saveTask({ ...task, revision: 2, updatedAt: "2025-01-01T00:00:01.000Z" }, 1);
  assert.deepEqual(await sut.previewSelectedFile(request, authority), { ok: false, code: "headless.stale" });
  const updated = { ...request, input: { ...request.input, taskRevision: 2 } };
  assert.deepEqual(await sut.previewSelectedFile(updated, authority), forbidden);
  assert.ok((await sut.recordSelectedFile(updated, { ...authority, expectedSelectionRevision: 1 })).ok);
  assert.deepEqual(await sut.previewSelectedFile(updated, { ...authority, stillAllowed: async () => false }), forbidden);
  observed.onRead = async () => { observed.current = false; };
  assert.deepEqual(await sut.previewSelectedFile(updated, authority), forbidden);
});

test("a replacement during the last policy check prevents a preview for the former agent", async () => {
  const { authority, sut } = await fixture();
  assert.ok((await sut.recordSelectedFile(request, authority)).ok);
  const replacement = { ...authority, registeredClientId: anotherClient, expectedSelectionRevision: 1 };
  let checks = 0;
  let selected = false;
  const result = await sut.previewSelectedFile(request, {
    ...authority,
    async stillAllowed() {
      if (++checks === 4) selected = (await sut.recordSelectedFile(request, replacement)).ok;
      return true;
    },
  });
  assert.equal(selected, true);
  assert.deepEqual(result, forbidden);
  assert.ok((await sut.previewSelectedFile(request, replacement)).ok);
});

test("the checkpoint deadline still applies after the last policy check", async () => {
  const { authority, sut, observed } = await fixture();
  assert.ok((await sut.recordSelectedFile(request, authority)).ok);
  let checks = 0;
  const result = await sut.previewSelectedFile(request, {
    ...authority,
    async stillAllowed() {
      if (++checks === 4) observed.now = Date.parse(checkpointExpiresAt);
      return true;
    },
  });
  assert.equal(observed.now, Date.parse(checkpointExpiresAt));
  assert.deepEqual(result, { ok: false, code: "headless.source-not-ready" });
});

test("a record from the wrong organization cannot become a scoped Data result", async () => {
  const { task, authority } = await fixture();
  const read = new ReadHeadlessIngestionStatusUseCase({
    async executeCommand() {
      return { ok: true, value: { kind: "task", task: { ...task, organizationId: createOrganizationId("org.other") } } };
    },
  }, () => Date.parse(epoch));
  assert.deepEqual(await read.prepareLocalFileImport(request, authority), forbidden);
});

test("an upload revision changed during final policy cannot return the old preview", async () => {
  const { authority, sut, task, tasks } = await fixture();
  assert.ok((await sut.recordSelectedFile(request, authority)).ok);
  let checks = 0;
  const result = await sut.previewSelectedFile(request, {
    ...authority,
    async stillAllowed() {
      if (++checks === 4)
        await tasks.saveTask({ ...task, revision: 2, updatedAt: "2025-01-01T00:00:01.000Z" }, 1);
      return true;
    },
  });
  assert.deepEqual(result, { ok: false, code: "headless.stale" });
});

test("an upload changed before the selection transaction leaves no stale owner record", async () => {
  const { authority, observed, read, documents, task, tasks, sut: active } = await fixture();
  const owned = documents.runInOwnedTransaction!.bind(documents);
  const store = createStructuredHeadlessLocalFileSelectionRepository({
    ...documents,
    async runInOwnedTransaction(work, beforeCommit) {
      await tasks.saveTask({ ...task, revision: 2, updatedAt: "2025-01-01T00:00:01.000Z" }, 1);
      return owned(work, beforeCommit);
    },
  }, () => observed.now);
  const sut = new HeadlessLocalFileSelectionUseCase(store, read, () => observed.now);
  assert.deepEqual(await sut.recordSelectedFile(request, authority), forbidden);
  const updated = { ...request, input: { ...request.input, taskRevision: 2 } };
  const nextOwner = { ...authority, context: { ...authority.context, principalId: "fixture-next-owner" } };
  const firstSelection = await active.recordSelectedFile(updated, nextOwner);
  assert.ok(firstSelection.ok);
  assert.equal(firstSelection.selectionRevision, 1);
});

for (const reason of ["retired", "expired"] as const) {
  test(`the owned commit refuses an app selection after ${reason === "retired" ? "withdrawal" : "expiry"}`, async () => {
    const { authority, observed, read, documents, sut: active } = await fixture();
    const owned = documents.runInOwnedTransaction!.bind(documents);
    const store = createStructuredHeadlessLocalFileSelectionRepository({
      ...documents,
      runInOwnedTransaction: (work, beforeCommit) => owned(async transaction => {
        const value = await work(transaction);
        if (reason === "retired") observed.current = false;
        else observed.now = Date.parse(checkpointExpiresAt);
        return value;
      }, beforeCommit),
    }, () => observed.now);
    const sut = new HeadlessLocalFileSelectionUseCase(store, read, () => observed.now);
    assert.deepEqual(await sut.recordSelectedFile(request, authority), reason === "retired" ? forbidden :
      { ok: false, code: "headless.source-not-ready" });
    observed.current = true;
    observed.now = Date.parse(epoch);
    assert.deepEqual(await active.previewSelectedFile(request, authority), forbidden);
  });
}
