import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "../../../../testing/node-test";
import { createInMemoryStructuredDocumentStore } from "../../../../adapters/persistence/shared";
import { createStructuredIngestionAcquisitionRepository } from "../../../../adapters/persistence/ingestion";
import { createFilesystemIngestionCheckpointStorage } from "../../../../adapters/storage/ingestion-checkpoint";
import { createFilesystemArtifactObjectStorageAdapter } from "../../../../adapters/storage/filesystem/artifact-store";
import { GovernedIngestionTaskUseCases } from "../governed-ingestion-tasks.use-case";
import type { RegisterArtifactFromRepoUseCase } from "../../register-artifact-from-repo.use-case";
import { createContractError } from "../../../../contracts/shared";

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
  const repository = createStructuredIngestionAcquisitionRepository(
    createInMemoryStructuredDocumentStore(),
  );
  const checkpoints = createFilesystemIngestionCheckpointStorage({
    rootDirectory: join(root, "checkpoints"),
  });
  const streamStorage = createFilesystemArtifactObjectStorageAdapter({
    rootDirectory: join(root, "artifacts"),
    now: () => "2026-07-30T04:00:00.000Z",
  });
  let sequence = 0;
  const useCases = new GovernedIngestionTaskUseCases({
    repository,
    checkpoints,
    streamStorage,
    artifactCleanup: streamStorage,
    ...(registerArtifactFromRepo ? { registerArtifactFromRepo } : {}),
    now:
      nowOverride ?? (() => `2026-07-30T04:00:0${Math.min(sequence, 9)}.000Z`),
    createId: () => `id-${++sequence}`,
  });
  return {
    repository,
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
