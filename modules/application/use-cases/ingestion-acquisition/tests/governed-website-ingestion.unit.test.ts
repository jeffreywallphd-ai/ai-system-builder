import { createHash } from "node:crypto";
import { lstat, mkdtemp, readdir, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";

import { afterEach, describe, expect, it } from "../../../../testing/node-test";
import { createInMemoryStructuredDocumentStore } from "../../../../adapters/persistence/shared";
import { createStructuredIngestionAcquisitionRepository } from "../../../../adapters/persistence/ingestion";
import { createFilesystemArtifactObjectStorageAdapter } from "../../../../adapters/storage/filesystem/artifact-store";
import type { IngestionSourceSnapshot } from "../../../../contracts/ingestion";
import { createHasArtifactRequest } from "../../../../contracts/storage";
import { createContractError, createFailureResult, createSuccessResult } from "../../../../contracts/shared";
import type { GovernedWebsiteCapturePort, GovernedWebsitePageCapture } from "../../../ports/ingestion";
import { GovernedWebsiteIngestionUseCases, type GovernedWebsiteIngestionUseCasesDependencies } from "../governed-website-ingestion.use-case";

const roots: { root: string; parent: string; dev: bigint; ino: bigint }[] = [];
afterEach(async () => { for (const owned of roots.splice(0)) {
  const info = await lstat(owned.root, { bigint: true });
  expect({ dev: info.dev, ino: info.ino }).toEqual({ dev: owned.dev, ino: owned.ino });
  expect(info.isDirectory() && !info.isSymbolicLink()).toBe(true); expect(await realpath(owned.root)).toBe(owned.root);
  expect(dirname(owned.root)).toBe(owned.parent); expect(basename(owned.root).startsWith("governed-website-")).toBe(true);
  let count = 0, bytes = 0;
  async function inspect(parent: string) { for (const name of await readdir(parent)) { const file = join(parent, name), entry = await lstat(file); expect(++count <= 128 && !entry.isSymbolicLink()).toBe(true); if (entry.isDirectory()) await inspect(file); else { expect(entry.isFile()).toBe(true); bytes += entry.size; expect(bytes <= 1024 * 1024).toBe(true); } } }
  await inspect(owned.root); await rm(owned.root, { recursive: true });
} });
const digest = (bytes: Uint8Array) => `sha256:${createHash("sha256").update(bytes).digest("hex")}` as const;
function captured(url: string, value: string): GovernedWebsitePageCapture {
  const rawBytes = new TextEncoder().encode(`<main>${value}</main>`);
  return { outcome: "captured", requestedUrl: url, canonicalUrl: url, rawBytes, derivedTextBytes: new TextEncoder().encode(value), mediaType: "text/html", httpStatus: 200, contentDigest: digest(rawBytes), robots: { policyUrl: new URL("/robots.txt", url).toString(), checkedAt: "2026-07-30T12:00:00.000Z", decision: "allowed" } };
}
async function fixture(capture: GovernedWebsiteCapturePort, cancelBeforeCommit = false, overrides?: (storage: ReturnType<typeof createFilesystemArtifactObjectStorageAdapter>, repository: ReturnType<typeof createStructuredIngestionAcquisitionRepository>) => Partial<Pick<GovernedWebsiteIngestionUseCasesDependencies, "repository" | "artifactCleanup" | "artifactCatalogCleanup" | "streamStorage">>) {
  const parent = await realpath(tmpdir()), root = await mkdtemp(join(parent, "governed-website-")), info = await lstat(root, { bigint: true });
  expect(info.ino !== 0n).toBe(true); roots.push({ root, parent, dev: info.dev, ino: info.ino });
  const repository = createStructuredIngestionAcquisitionRepository(createInMemoryStructuredDocumentStore());
  const storage = createFilesystemArtifactObjectStorageAdapter({ rootDirectory: root, now: () => "2026-07-30T12:00:00.000Z" });
  let raced = false;
  const taskRepository = cancelBeforeCommit ? {
    ...repository,
    async saveTaskWithSourceSnapshot(task: Parameters<typeof repository.saveTaskWithSourceSnapshot>[0], expectedRevision: number, snapshot: Parameters<typeof repository.saveTaskWithSourceSnapshot>[2]) {
      if (!raced) {
        raced = true;
        const current = await repository.readTask(task.workspaceId, task.taskId);
        if (!current) throw new Error("task missing");
        await repository.saveTask({
          ...current,
          status: "cancelled",
          files: current.files.map((file) => ({ ...file, status: file.status === "finalized" ? "finalized" as const : "cancelled" as const, error: undefined })),
          revision: current.revision + 1,
          cleanupPending: false,
          updatedAt: "2026-07-30T12:00:00.000Z",
          completedAt: "2026-07-30T12:00:00.000Z",
        }, current.revision);
      }
      return repository.saveTaskWithSourceSnapshot(task, expectedRevision, snapshot);
    },
  } : repository;
  let sequence = 0;
  const useCases = new GovernedWebsiteIngestionUseCases({ repository: taskRepository, capture, streamStorage: storage, artifactCleanup: storage, ...overrides?.(storage, repository), now: () => "2026-07-30T12:00:00.000Z", createId: () => `id-${++sequence}` });
  return { repository, storage, useCases, context: { workspaceId: "workspace-a" } };
}

describe("governed website ingestion", () => {
  it("captures a bounded task into immutable raw and derived snapshots with authoritative progress", async () => {
    const capture: GovernedWebsiteCapturePort = {
      resolveScope: async () => ["https://example.com/a", "https://example.com/b"],
      capturePage: async (url) => captured(url, url.endsWith("/a") ? "alpha" : "beta"),
    };
    const { repository, useCases, context } = await fixture(capture);
    const created = await useCases.createTask({ kind: "pages", urls: ["https://example.com/a", "https://example.com/b"], maximumPages: 2 }, context);
    if (!created.ok) throw new Error(created.error.message);
    const completed = await useCases.runTask(created.value.taskId, context);

    expect(completed).toMatchObject({ ok: true, value: { status: "succeeded", cleanupPending: false, progress: { completedItems: 2, totalItems: 2, percent: 100 } } });
    if (!completed.ok) return;
    expect(completed.value.files[0]?.output).toMatchObject({ mediaType: "text/html", derivedArtifactKeys: [expect.stringMatching(/\.txt$/)] });
    const sourceId = completed.value.files[0]!.output!.sourceId!;
    const snapshots = await repository.listSourceSnapshots("workspace-a" as never, sourceId as never);
    expect(snapshots.length).toBe(1);
    expect(snapshots[0]).toMatchObject({ locator: { requestedUrl: "https://example.com/a", canonicalUrl: "https://example.com/a" }, robots: { decision: "allowed" } });
    await expect(useCases.runTask(created.value.taskId, { workspaceId: "workspace-b" })).resolves.toMatchObject({ ok: false, error: { code: "not-found" } });
  });

  it("records unchanged, changed, removed, and unavailable refreshes without mutating snapshots", async () => {
    let next: GovernedWebsitePageCapture | Error = captured("https://example.com/a", "one");
    const capture: GovernedWebsiteCapturePort = {
      resolveScope: async () => ["https://example.com/a"],
      capturePage: async () => { if (next instanceof Error) throw next; return next; },
    };
    const { repository, useCases, context } = await fixture(capture);
    const created = await useCases.createTask({ kind: "pages", urls: ["https://example.com/a"] }, context); if (!created.ok) throw new Error("create failed");
    const completed = await useCases.runTask(created.value.taskId, context); if (!completed.ok) throw new Error("run failed");
    const sourceId = completed.value.files[0]!.output!.sourceId!;

    expect(await useCases.refreshSource(sourceId, context)).toMatchObject({ ok: true, value: { outcome: "unchanged" } });
    next = captured("https://example.com/a", "two");
    expect(await useCases.refreshSource(sourceId, context)).toMatchObject({ ok: true, value: { outcome: "changed" } });
    expect((await repository.listSourceSnapshots("workspace-a" as never, sourceId as never)).length).toBe(2);
    next = { outcome: "removed", requestedUrl: "https://example.com/a", canonicalUrl: "https://example.com/a", httpStatus: 410, robots: { policyUrl: "https://example.com/robots.txt", checkedAt: "2026-07-30T12:00:00.000Z", decision: "allowed" } };
    expect(await useCases.refreshSource(sourceId, context)).toMatchObject({ ok: true, value: { outcome: "removed" } });
    next = new Error("network unavailable");
    expect(await useCases.refreshSource(sourceId, context)).toMatchObject({ ok: true, value: { outcome: "unavailable" } });
  });

  it("cleans raw and derived artifacts when cancellation wins the final commit race", async () => {
    const capture: GovernedWebsiteCapturePort = {
      resolveScope: async () => ["https://example.com/a"],
      capturePage: async (url) => captured(url, "alpha"),
    };
    const { repository, storage, useCases, context } = await fixture(capture, true);
    const created = await useCases.createTask({ kind: "pages", urls: ["https://example.com/a"] }, context);
    if (!created.ok) throw new Error("create failed");
    const completed = await useCases.runTask(created.value.taskId, context);
    expect(completed).toMatchObject({ ok: true, value: { status: "cancelled" } });
    const file = created.value.files[0]!;
    const prefix = `workspaces/workspace-a/artifacts/files/website/source.${created.value.taskId}.${file.fileId}/snapshot.${created.value.taskId}.${file.fileId}`;
    await expect(storage.hasArtifact(createHasArtifactRequest(`${prefix}.html`), context)).resolves.toMatchObject({ ok: true, value: { exists: false } });
    await expect(storage.hasArtifact(createHasArtifactRequest(`${prefix}.txt`), context)).resolves.toMatchObject({ ok: true, value: { exists: false } });
    expect(await repository.listSourceSnapshots("workspace-a" as never, `source.${created.value.taskId}.${file.fileId}` as never)).toEqual([]);
  });

  for (const committed of [true, false]) {
    it(`retains website files when a capture response is lost (committed: ${committed})`, async () => {
      const url = "https://example.com/a";
      let attempted: IngestionSourceSnapshot | undefined;
      let deletes = 0;
      const { repository, storage, useCases, context } = await fixture(
        { resolveScope: async () => [url], capturePage: async () => captured(url, "first capture") },
        false,
        (storage, repository) => ({
          repository: {
            ...repository,
            async saveTaskWithSourceSnapshot(...args) {
              attempted = args[2];
              if (committed) await repository.saveTaskWithSourceSnapshot(...args);
              throw new Error("synthetic storage implementation detail");
            },
            async readSourceSnapshot(...args) {
              if (!committed) throw new Error("synthetic readback unavailable");
              return repository.readSourceSnapshot(...args);
            },
          },
          artifactCleanup: { async deleteArtifact(...args) { deletes++; return storage.deleteArtifact(...args); } },
        }),
      );
      const created = await useCases.createTask({ kind: "pages", urls: [url] }, context);
      if (!created.ok) throw new Error("Synthetic creation failed.");
      const result = await useCases.runTask(created.value.taskId, context);
      if (!attempted) throw new Error("Synthetic publication was not reached.");
      const snapshot = await repository.readSourceSnapshot(created.value.workspaceId, attempted.snapshotId);
      const savedTask = await repository.readTask(created.value.workspaceId, created.value.taskId);
      expect(snapshot?.snapshotId).toBe(committed ? attempted.snapshotId : undefined);
      expect(savedTask?.status).toBe(committed ? "succeeded" : "transferring");
      for (const key of [attempted.rawArtifactKey, ...attempted.derivedArtifactKeys!]) {
        await expect(storage.hasArtifact(createHasArtifactRequest(key), context)).resolves.toMatchObject({ ok: true, value: { exists: true } });
      }
      expect(deletes).toBe(0);
      expect(result).toMatchObject(committed
        ? { ok: true, value: { status: "succeeded", progress: { percent: 100 } } }
        : { ok: false, error: { code: "unavailable", message: "The website capture save could not be confirmed." } });
    });

    it(`retains website files when a changed refresh response is lost (committed: ${committed})`, async () => {
      const url = "https://example.com/a";
      let value = "first capture";
      let attempted: IngestionSourceSnapshot | undefined;
      let deletes = 0;
      const { repository, storage, useCases, context } = await fixture(
        { resolveScope: async () => [url], capturePage: async () => captured(url, value) },
        false,
        (storage, repository) => ({
          repository: {
            ...repository,
            async recordSourceRefreshWithSnapshot(...args) {
              attempted = args[0];
              if (committed) await repository.recordSourceRefreshWithSnapshot(...args);
              throw new Error("synthetic storage implementation detail");
            },
          },
          artifactCleanup: { async deleteArtifact(...args) { deletes++; return storage.deleteArtifact(...args); } },
        }),
      );
      const created = await useCases.createTask({ kind: "pages", urls: [url] }, context);
      if (!created.ok) throw new Error("Synthetic creation failed.");
      const completed = await useCases.runTask(created.value.taskId, context);
      if (!completed.ok || completed.value.status !== "succeeded") throw new Error("Synthetic initial capture failed.");
      const sourceId = completed.value.files[0]!.output!.sourceId!;
      const prior = await repository.listSourceSnapshots(created.value.workspaceId, sourceId);
      value = "changed capture";
      const result = await useCases.refreshSource(sourceId, context).then((value) => ({ value }), () => ({ rejected: true }));
      if (!attempted) throw new Error("Synthetic refresh publication was not reached.");
      const saved = await repository.listSourceSnapshots(created.value.workspaceId, sourceId);
      expect(saved.find((snapshot) => snapshot.snapshotId === prior[0]!.snapshotId)).toEqual(prior[0]);
      expect(saved.length).toBe(committed ? 2 : 1);
      expect((await repository.listSourceRefreshes(created.value.workspaceId, sourceId)).length).toBe(committed ? 1 : 0);
      for (const key of [prior[0]!.rawArtifactKey, attempted.rawArtifactKey, ...attempted.derivedArtifactKeys!]) {
        await expect(storage.hasArtifact(createHasArtifactRequest(key), context)).resolves.toMatchObject({ ok: true, value: { exists: true } });
      }
      expect(deletes).toBe(0);
      expect(result).toMatchObject({ value: committed
        ? { ok: true, value: { outcome: "changed", previousSnapshotId: prior[0]!.snapshotId, currentSnapshotId: attempted.snapshotId } }
        : { ok: false, error: { code: "unavailable", message: "The website refresh save could not be confirmed." } } });
    });
  }
  it("does not capture another page when lost-response readback sees a failed task", async () => {
    const urls = ["https://example.com/a", "https://example.com/b"];
    const visited: string[] = [];
    const { useCases, context } = await fixture(
      { resolveScope: async () => urls, capturePage: async (url) => { visited.push(url); return captured(url, "synthetic page"); } },
      false,
      (_storage, repository) => ({
        repository: {
          ...repository,
          async saveTaskWithSourceSnapshot(...args) {
            const saved = await repository.saveTaskWithSourceSnapshot(...args);
            if (saved.snapshot.locator.requestedUrl !== urls[0]) return saved;
            await repository.saveTask({
              ...saved.task,
              status: "failed",
              files: saved.task.files.map((file) => file.status === "finalized" ? file : {
                ...file,
                status: "failed",
                error: { code: "website-removed", message: "This website page is no longer available.", retryable: false },
              }),
              revision: saved.task.revision + 1,
              completedAt: saved.task.updatedAt,
            }, saved.task.revision);
            throw new Error("synthetic response lost after the first page save");
          },
        },
      }),
    );
    const created = await useCases.createTask({ kind: "pages", urls }, context);
    if (!created.ok) throw new Error("Synthetic creation failed.");
    const result = await useCases.runTask(created.value.taskId, context);
    expect(visited).toEqual([urls[0]]);
    expect(result).toMatchObject({ ok: true, value: { status: "failed", progress: { completedItems: 1, totalItems: 2 } } });
    expect(await useCases.runTask(created.value.taskId, context)).toMatchObject({ ok: false, error: { code: "validation" } });
    expect(visited).toEqual([urls[0]]);
  });

  it("removes only corresponding catalog entries after their byte cleanup is acknowledged", async () => {
    const calls: { workspaceId?: string; storageKey: string }[] = [];
    const { useCases, context } = await fixture({ resolveScope: async () => ["https://example.com/a"], capturePage: async url => captured(url, "alpha") }, true, storage => ({
      artifactCatalogCleanup: { async deleteArtifactCatalogRecord(request, requestContext) {
        expect(request.workspaceId).toBe("workspace-a"); expect(requestContext?.workspaceId).toBe("workspace-a");
        expect(await storage.hasArtifact(createHasArtifactRequest(request.storageKey), requestContext)).toMatchObject({ ok: true, value: { exists: false } });
        calls.push(request); return createSuccessResult({ deleted: true }, requestContext);
      } },
    }));
    const created = await useCases.createTask({ kind: "pages", urls: ["https://example.com/a"] }, context); if (!created.ok) throw new Error("Synthetic creation failed.");
    expect(await useCases.runTask(created.value.taskId, context)).toMatchObject({ ok: true, value: { status: "cancelled" } });
    expect(calls.length).toBe(2); expect(new Set(calls.map(value => value.storageKey)).size).toBe(2);
    for (const value of calls) expect(value.storageKey.startsWith(`workspaces/workspace-a/artifacts/files/website/source.${created.value.taskId}.${created.value.files[0]!.fileId}/`)).toBe(true);
  });
  it("keeps catalog evidence when byte cleanup fails", async () => {
    let catalogCalls = 0, byteCalls = 0;
    const { useCases, context, storage } = await fixture({ resolveScope: async () => ["https://example.com/a"], capturePage: async url => captured(url, "alpha") }, true, () => ({
      artifactCleanup: { async deleteArtifact(_request, requestContext) { byteCalls++; return createFailureResult(createContractError("unavailable", "Synthetic byte cleanup denied."), requestContext); } },
      artifactCatalogCleanup: { async deleteArtifactCatalogRecord(_request, requestContext) { catalogCalls++; return createSuccessResult({ deleted: true }, requestContext); } },
    }));
    const created = await useCases.createTask({ kind: "pages", urls: ["https://example.com/a"] }, context); if (!created.ok) throw new Error("Synthetic creation failed.");
    expect(await useCases.runTask(created.value.taskId, context)).toMatchObject({ ok: true, value: { status: "cancelled" } });
    expect(byteCalls).toBe(2); expect(catalogCalls).toBe(0);
    const prefix = `workspaces/workspace-a/artifacts/files/website/source.${created.value.taskId}.${created.value.files[0]!.fileId}/snapshot.${created.value.taskId}.${created.value.files[0]!.fileId}`;
    for (const extension of ["html", "txt"]) expect(await storage.hasArtifact(createHasArtifactRequest(`${prefix}.${extension}`), context)).toMatchObject({ ok: true, value: { exists: true } });
  });
  it("compensates only successful raw output when the derived write fails", async () => {
    let writes = 0; const cleaned: string[] = [];
    const { useCases, context } = await fixture({ resolveScope: async () => ["https://example.com/a"], capturePage: async url => captured(url, "alpha") }, false, storage => ({
      streamStorage: { async storeArtifactStream(request, requestContext) { return ++writes === 1 ? storage.storeArtifactStream(request, requestContext) : createFailureResult(createContractError("unavailable", "Synthetic derived write denied."), requestContext); } },
      artifactCatalogCleanup: { async deleteArtifactCatalogRecord(request, requestContext) { expect(await storage.hasArtifact(createHasArtifactRequest(request.storageKey), requestContext)).toMatchObject({ ok: true, value: { exists: false } }); cleaned.push(request.storageKey); return createSuccessResult({ deleted: true }, requestContext); } },
    }));
    const created = await useCases.createTask({ kind: "pages", urls: ["https://example.com/a"] }, context); if (!created.ok) throw new Error("Synthetic creation failed.");
    expect(await useCases.runTask(created.value.taskId, context)).toMatchObject({ ok: true, value: { status: "failed" } }); expect(writes).toBe(2); expect(cleaned.length).toBe(1); expect(cleaned[0]!.endsWith(".html")).toBe(true);
  });
});
