import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "../../../../testing/node-test";
import { createInMemoryStructuredDocumentStore, writeDocumentRecord } from "../../../../adapters/persistence/shared";
import { createStructuredIngestionAcquisitionRepository, createStructuredIngestionFilePublicationRepository, INGESTION_FILE_PUBLICATION_NAMESPACE } from "../../../../adapters/persistence/ingestion";
import { createFilesystemIngestionCheckpointStorage } from "../../../../adapters/storage/ingestion-checkpoint";
import { createFilesystemArtifactObjectStorageAdapter } from "../../../../adapters/storage/filesystem/artifact-store";
import { createFilesystemIngestionFileByteStorageAdapter, createLocalArtifactCatalogPersistenceAdapter, createLocalArtifactStorageBindingAdapter } from "../../../../adapters/storage/filesystem";
import { GovernedIngestionTaskUseCases } from "../governed-ingestion-tasks.use-case";
import { IngestionFilePublicationService } from "../ingestion-file-publication.service";
import { DeleteRegisteredArtifactUseCase } from "../../delete-registered-artifact.use-case";
import type { RegisterArtifactFromRepoUseCase } from "../../register-artifact-from-repo.use-case";
import { createContractError } from "../../../../contracts/shared";
import { createRetrieveArtifactRequest } from "../../../../contracts/storage";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});
const sha = (bytes: Uint8Array) =>
  `sha256:${createHash("sha256").update(bytes).digest("hex")}`;

async function fixture(
  registerArtifactFromRepo?: Pick<RegisterArtifactFromRepoUseCase, "execute">,
  nowOverride?: () => string,
) {
  const root = await mkdtemp(join(tmpdir(), "governed-ingestion-"));
  roots.push(root);
  const documents = createInMemoryStructuredDocumentStore();
  const repository = createStructuredIngestionAcquisitionRepository(documents);
  const publications = createStructuredIngestionFilePublicationRepository(documents);
  const checkpoints = createFilesystemIngestionCheckpointStorage({
    rootDirectory: join(root, "checkpoints"),
  });
  const streamStorage = Object.assign(createFilesystemArtifactObjectStorageAdapter({
    rootDirectory: join(root, "artifacts"),
    now: () => "2026-07-30T04:00:00.000Z",
  }), createFilesystemIngestionFileByteStorageAdapter({ rootDirectory: join(root, "artifacts") }));
  const bindings = createLocalArtifactStorageBindingAdapter({ rootDirectory: join(root, "artifacts"), documents });
  const catalog = createLocalArtifactCatalogPersistenceAdapter({ rootDirectory: join(root, "artifacts"), documents });
  const filePublication = new IngestionFilePublicationService({ repository, publications, checkpoints, bytes: streamStorage,
    bindings, catalog, now: () => "2026-07-30T04:00:00.000Z" });
  let sequence = 0;
  const useCases = new GovernedIngestionTaskUseCases({
    repository,
    checkpoints,
    streamStorage,
    artifactCleanup: streamStorage,
    filePublication,
    ...(registerArtifactFromRepo ? { registerArtifactFromRepo } : {}),
    now:
      nowOverride ?? (() => `2026-07-30T04:00:0${Math.min(sequence, 9)}.000Z`),
    createId: () => `id-${++sequence}`,
  });
  return {
    root,
    repository,
    publications, bindings, catalog, filePublication, documents,
    checkpoints,
    streamStorage,
    useCases,
    context: { workspaceId: "workspace-a" },
  };
}

describe("governed ingestion tasks", () => {
  it("streams chunks with authoritative progress, idempotent retry, exact finalization, snapshot, and cleanup", async () => {
    const { useCases, repository, checkpoints, context } = await fixture();
    const created = await useCases.createTask(
      {
        files: [
          {
            fileName: "train.jsonl",
            mediaType: "application/jsonl",
            sizeBytes: 5,
          },
        ],
      },
      context,
    );
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const file = created.value.files[0]!;
    const first = new Uint8Array([1, 2]);
    const second = new Uint8Array([3, 4, 5]);
    const all = new Uint8Array([1, 2, 3, 4, 5]);
    const accepted = await useCases.appendChunk(
      {
        taskId: created.value.taskId,
        fileId: file.fileId,
        chunkIndex: 0,
        expectedOffset: 0,
        bytes: first,
        sha256: sha(first),
      },
      context,
    );
    expect(accepted).toMatchObject({
      ok: true,
      value: { progress: { acceptedBytes: 2, percent: 40 } },
    });
    const duplicate = await useCases.appendChunk(
      {
        taskId: created.value.taskId,
        fileId: file.fileId,
        chunkIndex: 0,
        expectedOffset: 0,
        bytes: first,
        sha256: sha(first),
      },
      context,
    );
    expect(duplicate).toMatchObject({ ok: true, value: { revision: 2 } });
    await useCases.appendChunk(
      {
        taskId: created.value.taskId,
        fileId: file.fileId,
        chunkIndex: 1,
        expectedOffset: 2,
        bytes: second,
        sha256: sha(second),
      },
      context,
    );
    const finalized = await useCases.finalizeFile(
      { taskId: created.value.taskId, fileId: file.fileId, sha256: sha(all) },
      context,
    );
    expect(finalized).toMatchObject({
      ok: true,
      value: {
        status: "succeeded",
        cleanupPending: false,
        progress: { acceptedBytes: 5, completedItems: 1, percent: 100 },
      },
    });
    expect(
      await checkpoints.inspectCheckpoint({
        workspaceId: "workspace-a",
        checkpointId: file.checkpointId,
      }),
    ).toEqual({ chunkCount: 0, sizeBytes: 0 });
    expect(
      (
        await repository.listSourceSnapshots(
          "workspace-a" as never,
          `source.${created.value.taskId}.${file.fileId}` as never,
        )
      ).length,
    ).toBe(1);
  });

  it("retains checkpoints after digest failure, resumes from accepted progress, and completes on retry", async () => {
    const { useCases, checkpoints, context } = await fixture();
    const bytes = new Uint8Array([7, 8, 9]);
    const created = await useCases.createTask(
      {
        files: [{ fileName: "train.csv", mediaType: "text/csv", sizeBytes: 3 }],
      },
      context,
    );
    if (!created.ok) throw new Error("create failed");
    const file = created.value.files[0]!;
    await useCases.appendChunk(
      {
        taskId: created.value.taskId,
        fileId: file.fileId,
        chunkIndex: 0,
        expectedOffset: 0,
        bytes,
        sha256: sha(bytes),
      },
      context,
    );
    const failed = await useCases.finalizeFile(
      {
        taskId: created.value.taskId,
        fileId: file.fileId,
        sha256: sha(new Uint8Array([1, 2, 3])),
      },
      context,
    );
    expect(failed).toMatchObject({
      ok: true,
      value: { status: "failed", cleanupPending: true },
    });
    expect(
      await checkpoints.inspectCheckpoint({
        workspaceId: "workspace-a",
        checkpointId: file.checkpointId,
      }),
    ).toEqual({ chunkCount: 1, sizeBytes: 3 });
    const resumed = await useCases.resumeTask(created.value.taskId, context);
    expect(resumed).toMatchObject({
      ok: true,
      value: { status: "transferring", progress: { acceptedBytes: 3 } },
    });
    const completed = await useCases.finalizeFile(
      { taskId: created.value.taskId, fileId: file.fileId, sha256: sha(bytes) },
      context,
    );
    expect(completed).toMatchObject({
      ok: true,
      value: { status: "succeeded" },
    });
  });

  async function transferred() {
    const value=await fixture();const bytes=new Uint8Array([11,22,33]);
    const created=await value.useCases.createTask({files:[{fileName:"retained.bin",mediaType:"application/octet-stream",sizeBytes:bytes.length}]},value.context);
    if(!created.ok)throw new Error("create failed");const file=created.value.files[0]!;
    const accepted=await value.useCases.appendChunk({taskId:created.value.taskId,fileId:file.fileId,chunkIndex:0,expectedOffset:0,bytes,sha256:sha(bytes)},value.context);
    if(!accepted.ok)throw new Error("transfer failed");
    let key="";let deletions=0;
    const store=value.streamStorage.storeArtifactStream.bind(value.streamStorage);value.streamStorage.storeArtifactStream=async(...args)=>{const result=await store(...args);if(result.ok)key=result.value.key;return result;};
    const remove=value.streamStorage.deleteArtifact.bind(value.streamStorage);value.streamStorage.deleteArtifact=async(...args)=>{deletions++;return remove(...args);};
    return {...value,bytes,file,task:accepted.value,command:{taskId:created.value.taskId,fileId:file.fileId,sha256:sha(bytes)},key:()=>key,deletions:()=>deletions};
  }

  it("reconciles an exact uploaded-file commit whose acknowledgement was lost without deleting bytes",async()=>{
    const value=await transferred();const commit=value.repository.saveTaskWithSourceSnapshot.bind(value.repository);
    value.repository.saveTaskWithSourceSnapshot=async(...args)=>{await commit(...args);throw new Error("Synthetic lost acknowledgement");};
    const result=await value.useCases.finalizeFile(value.command,value.context);
    expect(result).toMatchObject({ok:true,value:{status:"succeeded"}});expect(value.deletions()).toBe(0);
    const retained=await value.streamStorage.retrieveArtifact(createRetrieveArtifactRequest(value.key()),value.context);
    expect(retained.ok).toBe(true);if(retained.ok)expect(retained.value.content).toEqual(value.bytes);
  });

  it("permits at most one byte writer when two finalizers race", async () => {
    const value = await transferred();
    const store = value.streamStorage.storeArtifactStream.bind(value.streamStorage); let writes = 0;
    value.streamStorage.storeArtifactStream = async (...args) => { writes++; return store(...args); };
    const results = await Promise.all([value.useCases.finalizeFile(value.command, value.context), value.useCases.finalizeFile(value.command, value.context)]);
    expect(writes).toBe(1); expect(results.some(result => result.ok)).toBe(true); expect(value.deletions()).toBe(0);
    expect(await value.useCases.finalizeFile(value.command, value.context)).toMatchObject({ ok: true, value: { status: "succeeded" } });
    expect(writes).toBe(1);
  });

  for (const mode of ["writing-ack", "byte-ack"] as const) {
    it(`retains ${mode} uncertainty without granting another byte write`, async () => {
      const value = await transferred(); let writes = 0;
      const store = value.streamStorage.storeArtifactStream.bind(value.streamStorage);
      value.streamStorage.storeArtifactStream = async (...args) => { writes++; const result = await store(...args); if (mode === "byte-ack") throw new Error("Synthetic byte acknowledgement loss"); return result; };
      const save = value.publications.savePublication.bind(value.publications);
      value.publications.savePublication = async (...args) => { const saved = await save(...args); if (mode === "writing-ack" && saved.state === "writing") throw new Error("Synthetic CAS acknowledgement loss"); return saved; };
      expect((await value.useCases.finalizeFile(value.command, value.context)).ok).toBe(false);
      expect((await value.useCases.finalizeFile(value.command, value.context)).ok).toBe(false);
      expect(writes).toBe(mode === "byte-ack" ? 1 : 0); expect(value.deletions()).toBe(0);
      expect(await value.publications.readPublication(value.task.workspaceId, value.task.taskId, value.file.fileId)).toMatchObject({ state: "writing", revision: 2 });
      expect(await value.checkpoints.inspectCheckpoint({ workspaceId: "workspace-a", checkpointId: value.file.checkpointId })).toEqual({ chunkCount: 1, sizeBytes: 3 });
      if (mode === "byte-ack") expect((await value.streamStorage.retrieveArtifact(createRetrieveArtifactRequest(value.key()), value.context)).ok).toBe(true);
    });
  }

  for (const state of ["bytes-acknowledged", "origin-complete"] as const) {
    it(`reconciles exact durable ${state} acknowledgement loss with one byte effect`, async () => {
      const value = await transferred(); let writes = 0;
      const store = value.streamStorage.storeArtifactStream.bind(value.streamStorage);
      value.streamStorage.storeArtifactStream = async (...args) => { writes++; return store(...args); };
      const save = value.publications.savePublication.bind(value.publications);
      value.publications.savePublication = async (...args) => { const saved = await save(...args); if (saved.state === state) throw new Error("Synthetic durable acknowledgement loss"); return saved; };
      expect(await value.useCases.finalizeFile(value.command, value.context)).toMatchObject({ ok: true, value: { status: "succeeded" } });
      expect(writes).toBe(1); expect(value.deletions()).toBe(0);
    });
  }

  for (const family of ["binding", "catalog"] as const) {
    it(`reconciles exact conditional ${family} publication whose acknowledgement is lost`, async () => {
      const value = await transferred();
      if (family === "binding") {
        const create = value.bindings.createArtifactStorageBindingIfAbsent.bind(value.bindings);
        value.bindings.createArtifactStorageBindingIfAbsent = async (...args) => { await create(...args); throw new Error("Synthetic binding acknowledgement loss"); };
      } else {
        const create = value.catalog.createArtifactCatalogRecordIfAbsent.bind(value.catalog);
        value.catalog.createArtifactCatalogRecordIfAbsent = async (...args) => { await create(...args); throw new Error("Synthetic catalog acknowledgement loss"); };
      }
      expect(await value.useCases.finalizeFile(value.command, value.context)).toMatchObject({ ok: true, value: { status: "succeeded" } });
      expect(value.deletions()).toBe(0);
    });
  }

  it("retains partial origin issuance without retrying missing metadata", async () => {
    const value = await transferred(); let writes = 0;
    const store = value.streamStorage.storeArtifactStream.bind(value.streamStorage);
    value.streamStorage.storeArtifactStream = async (...args) => { writes++; return store(...args); };
    const create = value.catalog.createArtifactCatalogRecordIfAbsent.bind(value.catalog);
    value.catalog.createArtifactCatalogRecordIfAbsent = async () => ({ ok: false, error: createContractError("unavailable", "Synthetic unavailable metadata.") });
    expect((await value.useCases.finalizeFile(value.command, value.context)).ok).toBe(false);
    expect(await value.publications.readPublication(value.task.workspaceId, value.task.taskId, value.file.fileId)).toMatchObject({ state: "origin-issued" });
    value.catalog.createArtifactCatalogRecordIfAbsent = create;
    let retries = 0;
    value.catalog.createArtifactCatalogRecordIfAbsent = async (...args) => { retries++; return create(...args); };
    expect((await value.useCases.finalizeFile(value.command, value.context)).ok).toBe(false);
    expect(retries).toBe(0);
    expect(writes).toBe(1); expect(value.deletions()).toBe(0);
  });

  it("never resurrects origin after actual registered deletion during an uncertain publication", async () => {
    const value = await transferred();
    const save = value.publications.savePublication.bind(value.publications);
    value.publications.savePublication = async (...args) => {
      if (args[0].state === "origin-complete") throw new Error("Synthetic pre-commit receipt failure");
      return save(...args);
    };
    expect((await value.useCases.finalizeFile(value.command, value.context)).ok).toBe(false);
    const key = value.key();
    expect((await value.catalog.readArtifactCatalogRecord({ workspaceId: value.task.workspaceId, storageKey: key }, value.context)).ok).toBe(true);
    const remove = new DeleteRegisteredArtifactUseCase({ artifactCatalogRead: value.catalog, artifactCatalogDelete: value.catalog,
      artifactBindingStorage: value.bindings, storage: value.streamStorage });
    expect((await remove.execute({ storageKey: key }, value.context)).ok).toBe(true);
    expect((await value.streamStorage.retrieveArtifact(createRetrieveArtifactRequest(key), value.context)).ok).toBe(false);
    expect((await value.catalog.readArtifactCatalogRecord({ workspaceId: value.task.workspaceId, storageKey: key }, value.context)).ok).toBe(false);
    expect(await value.bindings.readArtifactStorageBindings({ workspaceId: value.task.workspaceId, artifactId: key }, value.context))
      .toMatchObject({ ok: true, value: { bindings: [] } });
    value.publications.savePublication = save;
    let originCreates = 0;
    const binding = value.bindings.createArtifactStorageBindingIfAbsent.bind(value.bindings);
    const catalog = value.catalog.createArtifactCatalogRecordIfAbsent.bind(value.catalog);
    value.bindings.createArtifactStorageBindingIfAbsent = async (...args) => { originCreates++; return binding(...args); };
    value.catalog.createArtifactCatalogRecordIfAbsent = async (...args) => { originCreates++; return catalog(...args); };
    for (let attempt = 0; attempt < 2; attempt++) expect((await value.useCases.finalizeFile(value.command, value.context)).ok).toBe(false);
    expect(originCreates).toBe(0);
    expect(value.deletions()).toBe(1); // Only the explicitly invoked registered-delete workflow.
    expect((await value.repository.readTask(value.task.workspaceId, value.task.taskId))!.files[0]!.status).not.toBe("finalized");
    expect(await value.repository.listSourceSnapshots(value.task.workspaceId, `source.${value.task.taskId}.${value.file.fileId}` as never)).toEqual([]);
  });

  for (const mode of ["lost-ack", "substituted-ack"] as const) {
    it(`does not grant origin effect authority after ${mode} of the issuance CAS`, async () => {
      const value = await transferred();
      const save = value.publications.savePublication.bind(value.publications);
      value.publications.savePublication = async (...args) => {
        const saved = await save(...args);
        if (saved.state !== "origin-issued") return saved;
        if (mode === "lost-ack") throw new Error("Synthetic lost issuance acknowledgement");
        return { ...saved, capturedAt: "2026-07-30T03:00:00.000Z" };
      };
      let creates = 0;
      const binding = value.bindings.createArtifactStorageBindingIfAbsent.bind(value.bindings);
      const catalog = value.catalog.createArtifactCatalogRecordIfAbsent.bind(value.catalog);
      value.bindings.createArtifactStorageBindingIfAbsent = async (...args) => { creates++; return binding(...args); };
      value.catalog.createArtifactCatalogRecordIfAbsent = async (...args) => { creates++; return catalog(...args); };
      for (let attempt = 0; attempt < 2; attempt++) expect((await value.useCases.finalizeFile(value.command, value.context)).ok).toBe(false);
      expect(creates).toBe(0);
      expect(await value.publications.readPublication(value.task.workspaceId, value.task.taskId, value.file.fileId))
        .toMatchObject({ state: "origin-issued", revision: 4 });
      expect(value.deletions()).toBe(0);
      expect((await value.streamStorage.retrieveArtifact(createRetrieveArtifactRequest(value.key()), value.context)).ok).toBe(true);
    });
  }

  it("recovers an exact complete issued origin without recreating metadata or bytes", async () => {
    const value = await transferred();
    const save = value.publications.savePublication.bind(value.publications);
    value.publications.savePublication = async (...args) => {
      if (args[0].state === "origin-complete") throw new Error("Synthetic receipt unavailable");
      return save(...args);
    };
    expect((await value.useCases.finalizeFile(value.command, value.context)).ok).toBe(false);
    expect(await value.publications.readPublication(value.task.workspaceId, value.task.taskId, value.file.fileId)).toMatchObject({ state: "origin-issued" });
    value.publications.savePublication = save;
    let effects = 0;
    value.streamStorage.storeArtifactStream = async () => { effects++; throw new Error("Unexpected byte retry"); };
    value.bindings.createArtifactStorageBindingIfAbsent = async () => { effects++; throw new Error("Unexpected binding retry"); };
    value.catalog.createArtifactCatalogRecordIfAbsent = async () => { effects++; throw new Error("Unexpected catalog retry"); };
    expect(await value.useCases.finalizeFile(value.command, value.context)).toMatchObject({ ok: true, value: { status: "succeeded" } });
    expect(effects).toBe(0);
    expect(value.deletions()).toBe(0);
  });

  it("rejects a substituted writing-CAS return before any byte effect", async () => {
    const value = await transferred(); let writes = 0;
    const store = value.streamStorage.storeArtifactStream.bind(value.streamStorage);
    value.streamStorage.storeArtifactStream = async (...args) => { writes++; return store(...args); };
    const save = value.publications.savePublication.bind(value.publications);
    value.publications.savePublication = async (...args) => { const saved = await save(...args); return saved.state === "writing"
      ? { ...saved, publicationId: "d".repeat(32), key: `workspaces/workspace-a/artifacts/files/ingestion/${"d".repeat(32)}` } : saved; };
    expect((await value.useCases.finalizeFile(value.command, value.context)).ok).toBe(false);
    expect(writes).toBe(0); expect(value.deletions()).toBe(0);
  });

  it("denies missing conditional-origin capability before reservation or byte inspection", async () => {
    const value = await transferred(); let reads = 0;
    value.streamStorage.verifyContent = async () => { reads++; throw new Error("Unexpected inspection"); };
    value.bindings.createArtifactStorageBindingIfAbsent = undefined as never;
    expect((await value.useCases.finalizeFile(value.command, value.context)).ok).toBe(false);
    expect(reads).toBe(0);
    expect(await value.publications.readPublication(value.task.workspaceId, value.task.taskId, value.file.fileId)).toBeUndefined();
  });

  it("checks bad checksums before reservation and retains the existing safe retry workflow", async () => {
    const value = await transferred();
    expect(await value.useCases.finalizeFile({ ...value.command, sha256: `sha256:${"f".repeat(64)}` }, value.context)).toMatchObject({ ok: true, value: { status: "failed" } });
    expect(await value.publications.readPublication(value.task.workspaceId, value.task.taskId, value.file.fileId)).toBeUndefined();
    expect(value.key()).toBe("");
    expect((await value.useCases.resumeTask(value.task.taskId, value.context)).ok).toBe(true);
    expect(await value.useCases.finalizeFile(value.command, value.context)).toMatchObject({ ok: true, value: { status: "succeeded" } });
  });

  for (const family of ["binding", "catalog"] as const) {
    for (const mode of ["substitution", "tombstone"] as const) {
      it(`retains acknowledged bytes and refuses ${family} ${mode} without adopting or rewriting it`, async () => {
        const value = await transferred(); let writes = 0;
        const store = value.streamStorage.storeArtifactStream.bind(value.streamStorage);
        value.streamStorage.storeArtifactStream = async (...args) => { writes++; return store(...args); };
        if (family === "binding") {
          const create = value.bindings.createArtifactStorageBindingIfAbsent.bind(value.bindings);
          value.bindings.createArtifactStorageBindingIfAbsent = async (request, context) => {
            if (mode === "tombstone") await writeDocumentRecord({ rootDirectory: join(value.root, "artifacts"), documents: value.documents },
              ".catalog/artifact-storage-bindings.ndjson", [{ workspaceId: "workspace-a", artifactId: request.binding.artifactId, deletedAt: "2026-10-22T12:00:00Z" }]);
            return create(mode === "substitution" ? { binding: { ...request.binding, backing: { ...request.binding.backing, locator: "workspaces/workspace-a/artifacts/foreign" } } } : request, context);
          };
        } else {
          const create = value.catalog.createArtifactCatalogRecordIfAbsent.bind(value.catalog);
          value.catalog.createArtifactCatalogRecordIfAbsent = async (request, context) => {
            if (mode === "tombstone") await writeDocumentRecord({ rootDirectory: join(value.root, "artifacts"), documents: value.documents },
              ".catalog/artifact-catalog.ndjson", [{ workspaceId: "workspace-a", storageKey: request.record.storageKey, deletedAt: "2026-10-22T12:00:00Z" }]);
            return create(mode === "substitution" ? { record: { ...request.record, originalName: "foreign.csv" } } : request, context);
          };
        }
        expect((await value.useCases.finalizeFile(value.command, value.context)).ok).toBe(false);
        expect((await value.useCases.finalizeFile(value.command, value.context)).ok).toBe(false);
        expect(writes).toBe(1); expect(value.deletions()).toBe(0);
        expect(await value.publications.readPublication(value.task.workspaceId, value.task.taskId, value.file.fileId)).toMatchObject({ state: "origin-issued" });
        expect((await value.streamStorage.retrieveArtifact(createRetrieveArtifactRequest(value.key()), value.context)).ok).toBe(true);
      });
    }
  }

  for (const missing of ["private-receipt", "primary-origin"] as const) {
    it(`completed retry never manufactures a missing ${missing}`, async () => {
      const value = await transferred();
      expect(await value.useCases.finalizeFile(value.command, value.context)).toMatchObject({ ok: true, value: { status: "succeeded" } });
      if (missing === "private-receipt") await value.documents.deleteDocument(INGESTION_FILE_PUBLICATION_NAMESPACE,
        `${value.task.workspaceId}/${value.task.taskId}/${value.file.fileId}`, 6);
      else value.bindings.readArtifactStorageBindings = async () => ({ ok: true, value: { bindings: [] } });
      let effects = 0;
      value.publications.createPublication = async () => { effects++; throw new Error("Unexpected adoption"); };
      value.streamStorage.storeArtifactStream = async () => { effects++; throw new Error("Unexpected byte retry"); };
      value.bindings.createArtifactStorageBindingIfAbsent = async () => { effects++; throw new Error("Unexpected origin repair"); };
      value.repository.saveTask = async () => { effects++; throw new Error("Unexpected task rewrite"); };
      expect((await value.useCases.finalizeFile(value.command, value.context)).ok).toBe(false);
      expect(effects).toBe(0); expect(value.deletions()).toBe(0);
    });
  }

  for(const mode of ["no-commit","readback-fails","snapshot-mismatch","snapshot-time-mismatch","missing-snapshot","output-mismatch","foreign-task"] as const) {
    it(`retains uncertain uploaded bytes and checkpoints when ${mode} cannot establish the exact winner`,async()=>{
      const value=await transferred();const commit=value.repository.saveTaskWithSourceSnapshot.bind(value.repository);const read=value.repository.readTask.bind(value.repository);const snapshot=value.repository.readSourceSnapshot.bind(value.repository);
      value.repository.saveTaskWithSourceSnapshot=async(...args)=>{
        if(mode!=="no-commit")await commit(...args);
        if(mode==="readback-fails")value.repository.readTask=async()=>{throw new Error("Synthetic unavailable readback");};
        if(mode==="foreign-task")value.repository.readTask=async(...input)=>{const actual=await read(...input);return actual?{...actual,workspaceId:"workspace-b" as never}:undefined;};
        if(mode==="snapshot-mismatch")value.repository.readSourceSnapshot=async(...input)=>{const actual=await snapshot(...input);return actual?{...actual,rawArtifactKey:"workspaces/workspace-a/artifacts/foreign.bin"}:undefined;};
        if(mode==="snapshot-time-mismatch")value.repository.readSourceSnapshot=async(...input)=>{const actual=await snapshot(...input);return actual?{...actual,capturedAt:"2026-07-30T05:00:00.000Z"}:undefined;};
        if(mode==="missing-snapshot")value.repository.readSourceSnapshot=async()=>undefined;
        if(mode==="output-mismatch")value.repository.readTask=async(...input)=>{const actual=await read(...input);return actual?{...actual,files:actual.files.map(file=>file.output?{...file,output:{...file.output,key:"workspaces/workspace-a/artifacts/foreign.bin"}}:file)}:undefined;};
        throw new Error("Synthetic uncertain metadata commit");
      };
      const result=await value.useCases.finalizeFile(value.command,value.context);expect(result.ok).toBe(false);expect(value.deletions()).toBe(0);
      const retained=await value.streamStorage.retrieveArtifact(createRetrieveArtifactRequest(value.key()),value.context);expect(retained.ok).toBe(true);if(retained.ok)expect(retained.value.content).toEqual(value.bytes);
      expect(await value.checkpoints.inspectCheckpoint({workspaceId:"workspace-a",checkpointId:value.file.checkpointId})).toEqual({chunkCount:1,sizeBytes:3});
    });
  }

  it("retries checkpoint cleanup then returns immutable success without another cleanup or task rewrite",async()=>{
    const value=await transferred();const remove=value.checkpoints.deleteCheckpoint.bind(value.checkpoints);let cleanupCalls=0;
    value.checkpoints.deleteCheckpoint=async(...args)=>{if(++cleanupCalls===1)throw new Error("Synthetic cleanup failure");return remove(...args);};
    expect(await value.useCases.finalizeFile(value.command,value.context)).toMatchObject({ok:true,value:{status:"finalizing"}});
    const second=await value.useCases.finalizeFile(value.command,value.context);expect(second).toMatchObject({ok:true,value:{status:"succeeded",cleanupPending:false}});if(!second.ok)return;
    const save=value.repository.saveTask.bind(value.repository);let writes=0;value.repository.saveTask=async(...args)=>{writes++;return save(...args);};
    const third=await value.useCases.finalizeFile(value.command,value.context);expect(third).toEqual(second);expect(cleanupCalls).toBe(2);expect(writes).toBe(0);
    const denied=await value.useCases.finalizeFile({...value.command,sha256:`sha256:${"a".repeat(64)}`},value.context);expect(denied.ok).toBe(false);expect(cleanupCalls).toBe(2);expect(writes).toBe(0);
  });

  it("reconciles exact cleanup-completion commit acknowledgement loss without a retry rewrite",async()=>{
    const value=await transferred();const save=value.repository.saveTask.bind(value.repository);let succeededWrites=0;
    value.repository.saveTask=async(...args)=>{const result=await save(...args);if(args[0].status==="succeeded"){succeededWrites++;throw new Error("Synthetic cleanup completion acknowledgement loss");}return result;};
    const first=await value.useCases.finalizeFile(value.command,value.context);expect(first).toMatchObject({ok:true,value:{status:"succeeded",cleanupPending:false}});
    expect(await value.useCases.finalizeFile(value.command,value.context)).toEqual(first);expect(succeededWrites).toBe(1);expect(value.deletions()).toBe(0);
  });

  it("denies mismatched persisted snapshots on completed retry before checkpoint or task effects",async()=>{
    const value=await transferred();expect(await value.useCases.finalizeFile(value.command,value.context)).toMatchObject({ok:true,value:{status:"succeeded"}});
    const snapshot=value.repository.readSourceSnapshot.bind(value.repository);value.repository.readSourceSnapshot=async(...args)=>{const actual=await snapshot(...args);return actual?{...actual,contentDigest:`sha256:${"a".repeat(64)}`}:undefined;};
    let writes=0;let cleanup=0;value.repository.saveTask=async()=>{writes++;throw new Error("Unexpected task write");};value.checkpoints.deleteCheckpoint=async()=>{cleanup++;throw new Error("Unexpected checkpoint effect");};
    expect((await value.useCases.finalizeFile(value.command,value.context)).ok).toBe(false);expect(writes).toBe(0);expect(cleanup).toBe(0);expect(value.deletions()).toBe(0);
  });

  it("reconciles exact provider commit acknowledgement loss without deleting or repeating import",async()=>{
    let calls=0;const provider={execute:(async()=>{calls++;return {ok:true,value:{artifactId:"provider-owned-artifact"}};}) as RegisterArtifactFromRepoUseCase["execute"]};
    const value=await fixture(provider);let deletions=0;const remove=value.streamStorage.deleteArtifact.bind(value.streamStorage);value.streamStorage.deleteArtifact=async(...args)=>{deletions++;return remove(...args);};
    const commit=value.repository.saveTaskWithSourceSnapshot.bind(value.repository);value.repository.saveTaskWithSourceSnapshot=async(...args)=>{await commit(...args);throw new Error("Synthetic provider acknowledgement loss");};
    const created=await value.useCases.createHuggingFaceTask({files:[{repository:"owner/synthetic",path:"train.parquet",revision:"a".repeat(40)}]},value.context);if(!created.ok)throw new Error("create failed");
    const result=await value.useCases.runHuggingFaceTask(created.value.taskId,value.context);expect(result).toMatchObject({ok:true,value:{status:"succeeded"}});expect(deletions).toBe(0);expect(calls).toBe(1);
  });

  it("retains published upload bytes when explicit cancellation wins the metadata race",async()=>{
    const value=await transferred();value.repository.saveTaskWithSourceSnapshot=async()=>{expect(await value.useCases.cancelTask(value.task.taskId,value.context)).toMatchObject({ok:true,value:{status:"cancelled"}});throw new Error("Synthetic cancelled finalization conflict");};
    expect(await value.useCases.finalizeFile(value.command,value.context)).toMatchObject({ok:true,value:{status:"cancelled"}});expect(value.deletions()).toBe(0);
    const retained=await value.streamStorage.retrieveArtifact(createRetrieveArtifactRequest(value.key()),value.context);expect(retained.ok).toBe(true);if(retained.ok)expect(retained.value.content).toEqual(value.bytes);
  });

  it("denies uncertain uncommitted provider metadata without deleting its returned artifact",async()=>{
    const provider={execute:(async()=>({ok:true,value:{artifactId:"provider-owned-artifact"}})) as RegisterArtifactFromRepoUseCase["execute"]};const value=await fixture(provider);let deletions=0;
    const remove=value.streamStorage.deleteArtifact.bind(value.streamStorage);value.streamStorage.deleteArtifact=async(...args)=>{deletions++;return remove(...args);};value.repository.saveTaskWithSourceSnapshot=async()=>{throw new Error("Synthetic provider commit unavailable");};
    const created=await value.useCases.createHuggingFaceTask({files:[{repository:"owner/synthetic",path:"train.parquet",revision:"a".repeat(40)}]},value.context);if(!created.ok)throw new Error("create failed");
    expect((await value.useCases.runHuggingFaceTask(created.value.taskId,value.context)).ok).toBe(false);expect(deletions).toBe(0);
  });

  it("cancels with durable cleanup intent and denies guessed tasks in another workspace", async () => {
    const { useCases, checkpoints, context } = await fixture();
    const bytes = new Uint8Array([1]);
    const created = await useCases.createTask(
      {
        files: [
          {
            fileName: "data.parquet",
            mediaType: "application/vnd.apache.parquet",
            sizeBytes: 2,
          },
        ],
      },
      context,
    );
    if (!created.ok) throw new Error("create failed");
    const file = created.value.files[0]!;
    await useCases.appendChunk(
      {
        taskId: created.value.taskId,
        fileId: file.fileId,
        chunkIndex: 0,
        expectedOffset: 0,
        bytes,
        sha256: sha(bytes),
      },
      context,
    );
    const cancelled = await useCases.cancelTask(created.value.taskId, context);
    expect(cancelled).toMatchObject({
      ok: true,
      value: { status: "cancelled", cleanupPending: false },
    });
    expect(
      await checkpoints.inspectCheckpoint({
        workspaceId: "workspace-a",
        checkpointId: file.checkpointId,
      }),
    ).toEqual({ chunkCount: 0, sizeBytes: 0 });
    const denied = await useCases.readTask(created.value.taskId, {
      workspaceId: "workspace-b",
    });
    expect(denied).toMatchObject({ ok: false, error: { code: "not-found" } });
  });

  it("cleans stale checkpoints after the bounded retention window", async () => {
    let currentTime = "2026-07-30T04:00:00.000Z";
    const { useCases, checkpoints, context } = await fixture(
      undefined,
      () => currentTime,
    );
    const bytes = new Uint8Array([4]);
    const created = await useCases.createTask(
      {
        files: [{ fileName: "stale.csv", mediaType: "text/csv", sizeBytes: 2 }],
      },
      context,
    );
    if (!created.ok) throw new Error("create failed");
    const file = created.value.files[0]!;
    await useCases.appendChunk(
      {
        taskId: created.value.taskId,
        fileId: file.fileId,
        chunkIndex: 0,
        expectedOffset: 0,
        bytes,
        sha256: sha(bytes),
      },
      context,
    );
    expect(created.value.checkpointExpiresAt).toBe("2026-07-31T04:00:00.000Z");
    currentTime = "2026-08-01T04:00:00.000Z";
    const cleanup = await useCases.cleanupExpiredTasks(context);
    expect(cleanup).toMatchObject({
      ok: true,
      value: { cleanedTaskIds: [created.value.taskId] },
    });
    expect(
      await checkpoints.inspectCheckpoint({
        workspaceId: "workspace-a",
        checkpointId: file.checkpointId,
      }),
    ).toEqual({ chunkCount: 0, sizeBytes: 0 });
    expect(
      await useCases.readTask(created.value.taskId, context),
    ).toMatchObject({
      ok: true,
      value: { status: "cancelled", cleanupPending: false },
    });
  });

  it("imports exact provider revisions with authoritative item progress and immutable snapshots", async () => {
    let fixtureValue: Awaited<ReturnType<typeof fixture>>;
    let calls = 0;
    const registrations: Array<{ command: unknown; context: unknown }> = [];
    const registerArtifactFromRepo = {
      execute: (async (command: unknown, context: unknown) => {
        registrations.push({ command, context });
        calls += 1;
        if (calls === 2) {
          const tasks = await fixtureValue.repository.listTasks(
            "workspace-a" as never,
          );
          expect(tasks[0]?.progress).toMatchObject({
            completedItems: 1,
            totalItems: 2,
            percent: 50,
          });
        }
        return {
          ok: true as const,
          value: { artifactId: `artifact-${calls}` },
        };
      }) as unknown as RegisterArtifactFromRepoUseCase["execute"],
    };
    fixtureValue = await fixture(registerArtifactFromRepo);
    const revision = "a".repeat(40);
    const invalid = await fixtureValue.useCases.createHuggingFaceTask(
      {
        files: [
          { repository: "owner/data", path: "train.parquet", revision: "main" },
        ],
      },
      fixtureValue.context,
    );
    expect(invalid).toMatchObject({ ok: false, error: { code: "validation" } });
    const created = await fixtureValue.useCases.createHuggingFaceTask(
      {
        files: [
          { repository: "owner/data", path: "train.parquet", revision },
          {
            repository: "owner/data",
            path: "validation.parquet",
            revision,
            mediaType: "application/vnd.apache.parquet",
          },
        ],
      },
      fixtureValue.context,
    );
    expect(created).toMatchObject({
      ok: true,
      value: {
        status: "queued",
        cleanupPending: false,
        progress: { percent: 0 },
      },
    });
    if (!created.ok) return;
    const completed = await fixtureValue.useCases.runHuggingFaceTask(
      created.value.taskId,
      fixtureValue.context,
    );
    expect(completed).toMatchObject({
      ok: true,
      value: {
        status: "succeeded",
        progress: { completedItems: 2, percent: 100 },
      },
    });
    const snapshots = await Promise.all(
      created.value.files.map((file) =>
        fixtureValue.repository.listSourceSnapshots(
          "workspace-a" as never,
          `source.${created.value.taskId}.${file.fileId}` as never,
        ),
      ),
    );
    expect(snapshots.flat().length).toBe(2);
    expect(
      snapshots
        .flat()
        .every((snapshot) => snapshot.providerRevision === revision),
    ).toBe(true);
    expect(registrations.length).toBe(2);
    expect(registrations[0]).toMatchObject({
      command: {
        target: { path: "train.parquet" },
        mediaType: "application/vnd.apache.parquet",
      },
      context: { workspaceId: "workspace-a" },
    });
    expect(registrations[1]).toMatchObject({
      command: {
        target: { path: "validation.parquet" },
        mediaType: "application/vnd.apache.parquet",
      },
      context: { workspaceId: "workspace-a" },
    });
  });

  it("retains completed provider items and resumes a retryable partial failure", async () => {
    let calls = 0;
    const registerArtifactFromRepo = {
      execute: (async () => {
        calls += 1;
        if (calls === 2)
          return {
            ok: false as const,
            error: createContractError(
              "unavailable",
              "Provider is temporarily unavailable.",
            ),
          };
        return {
          ok: true as const,
          value: { artifactId: `artifact-${calls}` },
        };
      }) as unknown as RegisterArtifactFromRepoUseCase["execute"],
    };
    const { useCases, context } = await fixture(registerArtifactFromRepo);
    const revision = "b".repeat(40);
    const created = await useCases.createHuggingFaceTask(
      {
        files: [
          { repository: "owner/data", path: "train.parquet", revision },
          { repository: "owner/data", path: "validation.parquet", revision },
        ],
      },
      context,
    );
    if (!created.ok) throw new Error("create failed");
    const failed = await useCases.runHuggingFaceTask(
      created.value.taskId,
      context,
    );
    expect(failed).toMatchObject({
      ok: true,
      value: { status: "failed", progress: { completedItems: 1, percent: 50 } },
    });
    const resumed = await useCases.resumeTask(created.value.taskId, context);
    expect(resumed).toMatchObject({
      ok: true,
      value: {
        status: "transferring",
        progress: { completedItems: 1, percent: 50 },
      },
    });
    const completed = await useCases.runHuggingFaceTask(
      created.value.taskId,
      context,
    );
    expect(completed).toMatchObject({
      ok: true,
      value: {
        status: "succeeded",
        progress: { completedItems: 2, percent: 100 },
      },
    });
    expect(calls).toBe(3);
  });
});
