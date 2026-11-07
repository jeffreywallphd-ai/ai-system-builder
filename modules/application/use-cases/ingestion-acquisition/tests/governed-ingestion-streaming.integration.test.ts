import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { finished } from "node:stream/promises";
import { test, type TestContext } from "node:test";

import { createStructuredIngestionAcquisitionRepository, createStructuredIngestionFilePublicationRepository } from "../../../../adapters/persistence/ingestion";
import { openLocalSqliteDatabase, resolveLocalSqliteDatabasePolicy, type OpenedLocalSqliteDatabase } from "../../../../adapters/persistence/sqlite";
import { createFilesystemIngestionCheckpointStorage } from "../../../../adapters/storage/ingestion-checkpoint";
import { createFilesystemArtifactObjectStorageAdapter } from "../../../../adapters/storage/filesystem/artifact-store";
import { createFilesystemIngestionFileByteStorageAdapter, createLocalArtifactCatalogPersistenceAdapter, createLocalArtifactStorageBindingAdapter } from "../../../../adapters/storage/filesystem";
import { normalizeIngestionTaskRecord, type IngestionTaskRecord } from "../../../../contracts/ingestion";
import { GovernedIngestionTaskUseCases } from "../governed-ingestion-tasks.use-case";
import { IngestionFilePublicationService } from "../ingestion-file-publication.service";

const MIB = 1024 ** 2;
const context = { workspaceId: "streaming-workspace" };
const row = Buffer.from('{"text":"' + "x".repeat(116) + '"}\n');
assert.equal(row.byteLength, 128);
// One reusable chunk: the fixture never constructs the complete source file.
const chunk = Buffer.alloc(MIB);
for (let offset = 0; offset < chunk.byteLength; offset += row.byteLength) row.copy(chunk, offset);
const sha = (bytes: Uint8Array) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;

function value<T>(result: { ok: true; value: T } | { ok: false }): T {
  assert.equal(result.ok, true, "The real ingestion operation must succeed.");
  if (!result.ok) throw new Error("Ingestion operation failed.");
  return result.value;
}

async function fixture(t: TestContext) {
  const root = await mkdtemp(join(tmpdir(), "ingestion-streaming-"));
  let database: OpenedLocalSqliteDatabase | undefined;
  const close = () => { database?.close(); database = undefined; };
  t.after(async () => { close(); await rm(root, { recursive: true, force: true }); });
  const compose = async () => {
    assert.equal(database, undefined, "Close the previous database before reopening it.");
    database = await openLocalSqliteDatabase({ policy: resolveLocalSqliteDatabasePolicy({ dataRootDirectory: root }) });
    const documents = database.documents;
    const repository = createStructuredIngestionAcquisitionRepository(documents);
    const publications = createStructuredIngestionFilePublicationRepository(documents);
    const checkpoints = createFilesystemIngestionCheckpointStorage({ rootDirectory: join(root, "checkpoints") });
    const streamStorage = Object.assign(
      createFilesystemArtifactObjectStorageAdapter({ rootDirectory: join(root, "artifacts") }),
      createFilesystemIngestionFileByteStorageAdapter({ rootDirectory: join(root, "artifacts") }),
    );
    const bindings = createLocalArtifactStorageBindingAdapter({ rootDirectory: join(root, "artifacts"), documents });
    const catalog = createLocalArtifactCatalogPersistenceAdapter({ rootDirectory: join(root, "artifacts"), documents });
    const filePublication = new IngestionFilePublicationService({ repository, publications, checkpoints,
      bytes: streamStorage, bindings, catalog });
    return { repository, checkpoints, useCases: new GovernedIngestionTaskUseCases({ repository, checkpoints,
      streamStorage, artifactCleanup: streamStorage, filePublication }) };
  };
  return { root, close, compose };
}

type IngestionFixture = Awaited<ReturnType<typeof fixture>>;
type IngestionState = Awaited<ReturnType<IngestionFixture["compose"]>>;

async function transfer(state: IngestionState,
  count: number, checkDuplicate = false) {
  let task = value(await state.useCases.createTask({ files: [
    { fileName: "synthetic-stream.jsonl", mediaType: "application/jsonl", sizeBytes: count * MIB },
  ] }, context));
  const file = task.files[0]!;
  const digest = createHash("sha256");
  let previousPercent = 0;
  for (let index = 0; index < count; index++) {
    const request = { taskId: task.taskId, fileId: file.fileId, chunkIndex: index,
      expectedOffset: index * MIB, bytes: chunk, sha256: sha(chunk) };
    task = value(await state.useCases.appendChunk(request, context));
    assert.equal(task.progress.acceptedBytes, (index + 1) * MIB);
    assert.equal(task.progress.totalBytes, count * MIB);
    assert.equal(task.progress.percent, Math.floor(((index + 1) / count) * 100));
    assert.ok(task.progress.percent >= previousPercent && task.progress.percent <= 100);
    previousPercent = task.progress.percent;
    digest.update(chunk);
    if (checkDuplicate && index === 0) assert.deepEqual(value(await state.useCases.appendChunk(request, context)), task);
  }
  return { task, file, digest: `sha256:${digest.digest("hex")}` };
}

async function verifySavedBytes(root: string, task: IngestionTaskRecord, expectedDigest: string) {
  const output = task.files[0]!.output;
  assert.ok(output);
  assert.match(output.key, /^workspaces\/streaming-workspace\/artifacts\/files\/ingestion\/[a-f0-9]{32}$/);
  const stream = createReadStream(join(root, "artifacts", output.key), { highWaterMark: 64 * 1024 });
  const hash = createHash("sha256");
  let bytes = 0;
  try {
    for await (const part of stream) {
      assert.ok(part.byteLength <= MIB);
      bytes += part.byteLength;
      hash.update(part);
    }
    await finished(stream, { cleanup: true });
  } finally {
    stream.destroy();
    await finished(stream, { cleanup: true }).catch(() => {});
  }
  assert.equal(bytes, output.sizeBytes);
  assert.equal(`sha256:${hash.digest("hex")}`, expectedDigest);
  assert.equal(output.digest, expectedDigest);
}

for (const count of [8, 64]) {
  test(`${count} MiB streams through real SQLite and files with immutable restart/retry`, { timeout: 120_000 }, async t => {
    const started = performance.now();
    const owned = await fixture(t);
    let state = await owned.compose();
    const { task, file, digest } = await transfer(state, count, true);
    const command = { taskId: task.taskId, fileId: file.fileId, sha256: digest };
    const completed = value(await state.useCases.finalizeFile(command, context));
    assert.equal(completed.status, "succeeded");
    assert.equal(completed.cleanupPending, false);
    assert.equal(completed.progress.percent, 100);
    assert.equal(completed.progress.acceptedBytes, count * MIB);
    const sourceId = completed.files[0]!.output!.sourceId!;
    const snapshots = await state.repository.listSourceSnapshots(context.workspaceId as never, sourceId as never);
    assert.equal(snapshots.length, 1);
    await verifySavedBytes(owned.root, completed, digest);
    assert.deepEqual(await state.checkpoints.inspectCheckpoint({ workspaceId: context.workspaceId,
      checkpointId: file.checkpointId }), { chunkCount: 0, sizeBytes: 0 });
    owned.close();
    state = await owned.compose();
    assert.deepEqual(value(await state.useCases.readTask(task.taskId, context)), completed);
    assert.deepEqual(value(await state.useCases.finalizeFile(command, context)), completed);
    assert.deepEqual(await state.repository.listSourceSnapshots(context.workspaceId as never, sourceId as never), snapshots);
    await verifySavedBytes(owned.root, completed, digest);
    const peakRssBytes = process.resourceUsage().maxRSS * 1024;
    assert.ok(peakRssBytes <= 1024 * MIB, "Observed test-process RSS must stay within 1 GiB.");
    t.diagnostic(JSON.stringify({ schemaVersion: "local-ingestion-stream-measurement-v1", inputBytes: count * MIB,
      producerChunkBytes: MIB, outputReadChunkBytes: 64 * 1024, peakRssBytes,
      elapsedMilliseconds: Math.round(performance.now() - started), databaseReopened: true, immutableRetry: true,
      scope: "Observed local application/SQLite/files only. No renderer, hard memory enforcement, provider, website, native race or parent qualification." }));
  });
}

test("wrong digest survives database reopen and resumes; partial cancellation removes checkpoints", { timeout: 120_000 }, async t => {
  const owned = await fixture(t);
  let state = await owned.compose();
  const { task, file, digest } = await transfer(state, 8);
  const failed = value(await state.useCases.finalizeFile({ taskId: task.taskId, fileId: file.fileId,
    sha256: sha(Buffer.from("wrong synthetic checksum")) }, context));
  assert.equal(failed.status, "failed");
  assert.equal(failed.cleanupPending, true);
  assert.deepEqual(await state.checkpoints.inspectCheckpoint({ workspaceId: context.workspaceId,
    checkpointId: file.checkpointId }), { chunkCount: 8, sizeBytes: 8 * MIB });
  owned.close();
  state = await owned.compose();
  const resumed = value(await state.useCases.resumeTask(task.taskId, context));
  assert.equal(resumed.status, "transferring");
  assert.equal(resumed.progress.acceptedBytes, 8 * MIB);
  const completed = value(await state.useCases.finalizeFile({ taskId: task.taskId, fileId: file.fileId, sha256: digest }, context));
  assert.equal(completed.status, "succeeded");
  await verifySavedBytes(owned.root, completed, digest);
  const partial = value(await state.useCases.createTask({ files: [
    { fileName: "cancelled-stream.jsonl", mediaType: "application/jsonl", sizeBytes: 16 * MIB },
  ] }, context));
  const cancelledFile = partial.files[0]!;
  value(await state.useCases.appendChunk({ taskId: partial.taskId, fileId: cancelledFile.fileId,
    chunkIndex: 0, expectedOffset: 0, bytes: chunk, sha256: sha(chunk) }, context));
  const cancelled = value(await state.useCases.cancelTask(partial.taskId, context));
  assert.equal(cancelled.status, "cancelled");
  assert.equal(cancelled.cleanupPending, false);
  assert.equal(cancelled.files[0]!.output, undefined);
  assert.deepEqual(await state.checkpoints.inspectCheckpoint({ workspaceId: context.workspaceId,
    checkpointId: cancelledFile.checkpointId }), { chunkCount: 0, sizeBytes: 0 });
});

test("a chunk larger than the declared remainder leaves progress and retry intact", async t => {
  const owned = await fixture(t);
  const state = await owned.compose();
  const task = value(await state.useCases.createTask({ files: [
    { fileName: "synthetic-size.jsonl", mediaType: "application/jsonl", sizeBytes: 2 * row.length },
  ] }, context));
  const file = task.files[0]!;
  const append = (chunkIndex: number, bytes: Buffer) => state.useCases.appendChunk({
    taskId: task.taskId, fileId: file.fileId, chunkIndex,
    expectedOffset: chunkIndex * row.length, bytes, sha256: sha(bytes),
  }, context);
  const progress = value(await append(0, row));
  const checkpoint = { workspaceId: context.workspaceId, checkpointId: file.checkpointId };

  assert.equal((await append(1, Buffer.concat([row, row]))).ok, false);
  assert.deepEqual(await state.checkpoints.inspectCheckpoint(checkpoint), { chunkCount: 1, sizeBytes: row.length });
  assert.deepEqual(value(await state.useCases.readTask(task.taskId, context)), progress);
  assert.equal(value(await append(1, row)).progress.acceptedBytes, 2 * row.length);

  const digest = sha(Buffer.concat([row, row]));
  const complete = value(await state.useCases.finalizeFile({ taskId: task.taskId, fileId: file.fileId, sha256: digest }, context));
  assert.equal(complete.status, "succeeded");
  await verifySavedBytes(owned.root, complete, digest);
  assert.deepEqual(await state.checkpoints.inspectCheckpoint(checkpoint), { chunkCount: 0, sizeBytes: 0 });
});

test("rejects a cancelled file before writing a checkpoint in a mixed-status upload", async t => {
  const owned = await fixture(t);
  const state = await owned.compose();
  const task = value(await state.useCases.createTask({ files: ["cancelled", "active"].map(name => ({
    fileName: `${name}.jsonl`, mediaType: "application/jsonl", sizeBytes: row.length,
  })) }, context));
  const cancelled = task.files[0]!;
  const mixed = normalizeIngestionTaskRecord({
    ...task, revision: task.revision + 1,
    files: [{ ...cancelled, status: "cancelled" }, task.files[1]!],
  });
  await state.repository.saveTask(mixed, task.revision);
  const append = (index: number) => state.useCases.appendChunk({
    taskId: task.taskId, fileId: task.files[index]!.fileId, chunkIndex: 0, expectedOffset: 0,
    bytes: row, sha256: sha(row),
  }, context);

  assert.equal((await append(0)).ok, false);
  assert.deepEqual(await state.checkpoints.inspectCheckpoint({ workspaceId: context.workspaceId,
    checkpointId: cancelled.checkpointId }), { chunkCount: 0, sizeBytes: 0 });
  const active = value(await append(1));
  assert.deepEqual(active.files.map(file => file.status), ["cancelled", "transferring"]);
  assert.deepEqual(active.files.map(file => file.acceptedBytes), [0, row.length]);
});

for (const intervening of ["a second file", "a second file with a lost reply", "cancellation"] as const) {
  test(`an upload progress write survives or defers to ${intervening}`, { timeout: 10_000 }, async t => {
    const owned = await fixture(t);
    const state = await owned.compose();
    const task = value(await state.useCases.createTask({ files: ["first", "second"].map(name => ({
      fileName: `${name}.jsonl`, mediaType: "application/jsonl", sizeBytes: row.length,
    })) }, context));
    let saveReached!: () => void;
    let releaseSave!: () => void;
    const reached = new Promise<void>(resolve => { saveReached = resolve; });
    const hold = new Promise<void>(resolve => { releaseSave = resolve; });
    const save = state.repository.saveTask.bind(state.repository);
    let saves = 0;
    state.repository.saveTask = async (...args) => {
      const attempt = ++saves;
      if (attempt === 1) {
        saveReached();
        await hold;
      }
      const saved = await save(...args);
      if (attempt === 3 && intervening === "a second file with a lost reply") {
        throw new Error("Synthetic lost acknowledgement after the retried update.");
      }
      return saved;
    };
    const write = state.checkpoints.appendChunk.bind(state.checkpoints);
    let writes = 0;
    state.checkpoints.appendChunk = async (...args) => {
      writes += 1;
      return write(...args);
    };
    const append = (index: number) => state.useCases.appendChunk({
      taskId: task.taskId, fileId: task.files[index]!.fileId,
      chunkIndex: 0, expectedOffset: 0, bytes: row, sha256: sha(row),
    }, context);
    const first = append(0);
    try {
      await Promise.race([reached, first.then(() => { throw new Error("First chunk did not reach its progress write."); })]);
      if (intervening === "cancellation") {
        assert.equal(value(await state.useCases.cancelTask(task.taskId, context)).status, "cancelled");
        releaseSave();
        assert.equal((await first).ok, false);
        const final = value(await state.useCases.readTask(task.taskId, context));
        assert.equal(final.status, "cancelled");
        assert.equal(final.cleanupPending, false);
        assert.equal(saves, 3);
        assert.equal(writes, 1);
        assert.deepEqual(await state.checkpoints.inspectCheckpoint({ workspaceId: context.workspaceId,
          checkpointId: task.files[0]!.checkpointId }), { chunkCount: 0, sizeBytes: 0 });
      } else {
        const second = value(await append(1));
        assert.deepEqual(second.files.map(file => file.acceptedBytes), [0, row.length]);
        releaseSave();
        assert.deepEqual(value(await first).files.map(file => file.acceptedBytes), [row.length, row.length]);
        const final = value(await state.useCases.readTask(task.taskId, context));
        assert.deepEqual(final.files.map(file => file.acceptedBytes), [row.length, row.length]);
        assert.equal(final.progress.acceptedBytes, 2 * row.length);
        assert.equal(saves, 3);
        assert.equal(writes, 2);
        for (const file of task.files) {
          assert.deepEqual(await state.checkpoints.inspectCheckpoint({ workspaceId: context.workspaceId,
            checkpointId: file.checkpointId }), { chunkCount: 1, sizeBytes: row.length });
        }
      }
    } finally {
      releaseSave();
      await first;
    }
  });
}

for (const outcome of ["late write", "cleanup retry", "lost write reply"] as const) {
  test(`cancellation recovers a ${outcome}`, { timeout: 10_000 }, async t => {
    const owned = await fixture(t);
    let state = await owned.compose();
    const task = value(await state.useCases.createTask({ files: [
      { fileName: "late-chunk.jsonl", mediaType: "application/jsonl", sizeBytes: row.length },
    ] }, context));
    const file = task.files[0]!;
    const checkpoint = { workspaceId: context.workspaceId, checkpointId: file.checkpointId };
    let enteredWrite!: () => void;
    let releaseWrite!: () => void;
    const entered = new Promise<void>(resolve => { enteredWrite = resolve; });
    const hold = new Promise<void>(resolve => { releaseWrite = resolve; });
    const write = state.checkpoints.appendChunk.bind(state.checkpoints);
    state.checkpoints.appendChunk = async (...args) => {
      enteredWrite();
      await hold;
      const saved = await write(...args);
      if (outcome === "lost write reply") throw new Error("Synthetic lost checkpoint acknowledgement.");
      return saved;
    };
    const remove = state.checkpoints.deleteCheckpoint.bind(state.checkpoints);
    let failCleanup = false;
    state.checkpoints.deleteCheckpoint = async (...args) => {
      if (failCleanup) throw new Error("Synthetic checkpoint cleanup failure.");
      return remove(...args);
    };
    const transfer = state.useCases.appendChunk({
      taskId: task.taskId, fileId: file.fileId, chunkIndex: 0, expectedOffset: 0,
      bytes: row, sha256: sha(row),
    }, context);
    try {
      await Promise.race([entered, transfer.then(() => { throw new Error("Transfer did not reach checkpoint storage."); })]);
      const cancelled = value(await state.useCases.cancelTask(task.taskId, context));
      assert.equal(cancelled.status, "cancelled");
      assert.equal(cancelled.cleanupPending, false);
      failCleanup = outcome === "cleanup retry";
      releaseWrite();
      assert.equal((await transfer).ok, false);
      const final = value(await state.useCases.readTask(task.taskId, context));
      assert.equal(final.status, "cancelled");
      assert.equal(final.cleanupPending, failCleanup);
      assert.equal(final.files[0]!.acceptedBytes, 0);
      if (failCleanup) {
        assert.deepEqual(await state.checkpoints.inspectCheckpoint(checkpoint), { chunkCount: 1, sizeBytes: row.length });
        owned.close();
        state = await owned.compose();
        const persisted = value(await state.useCases.readTask(task.taskId, context));
        assert.equal(persisted.cleanupPending, true);
        const retried = value(await state.useCases.cancelTask(task.taskId, context));
        assert.equal(retried.status, "cancelled");
        assert.equal(retried.cleanupPending, false);
      }
      assert.deepEqual(await state.checkpoints.inspectCheckpoint(checkpoint), { chunkCount: 0, sizeBytes: 0 });
    } finally {
      releaseWrite();
      await transfer;
    }
  });
}
