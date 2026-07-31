import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "../../../../testing/node-test";
import { createInMemoryStructuredDocumentStore } from "../../../../adapters/persistence/shared";
import { createStructuredIngestionAcquisitionRepository } from "../../../../adapters/persistence/ingestion";
import { createFilesystemArtifactObjectStorageAdapter } from "../../../../adapters/storage/filesystem/artifact-store";
import { createHasArtifactRequest } from "../../../../contracts/storage";
import type { GovernedWebsiteCapturePort, GovernedWebsitePageCapture } from "../../../ports/ingestion";
import { GovernedWebsiteIngestionUseCases } from "../governed-website-ingestion.use-case";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });
const digest = (bytes: Uint8Array) => `sha256:${createHash("sha256").update(bytes).digest("hex")}` as const;
function captured(url: string, value: string): GovernedWebsitePageCapture {
  const rawBytes = new TextEncoder().encode(`<main>${value}</main>`);
  return { outcome: "captured", requestedUrl: url, canonicalUrl: url, rawBytes, derivedTextBytes: new TextEncoder().encode(value), mediaType: "text/html", httpStatus: 200, contentDigest: digest(rawBytes), robots: { policyUrl: new URL("/robots.txt", url).toString(), checkedAt: "2026-07-30T12:00:00.000Z", decision: "allowed" } };
}
async function fixture(capture: GovernedWebsiteCapturePort, cancelBeforeCommit = false) {
  const root = await mkdtemp(join(tmpdir(), "governed-website-")); roots.push(root);
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
  const useCases = new GovernedWebsiteIngestionUseCases({ repository: taskRepository, capture, streamStorage: storage, artifactCleanup: storage, now: () => "2026-07-30T12:00:00.000Z", createId: () => `id-${++sequence}` });
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
});
