import type { ApplicationRequestContext } from "../../ports";
import type { GovernedWebsiteCapturePort, GovernedWebsitePageCapture, IngestionAcquisitionRepositoryPort } from "../../ports/ingestion";
import type { WorkspaceOperationAuthorizationPort } from "../../ports/security";
import type { ArtifactStoragePort, ArtifactStreamStoragePort } from "../../ports/storage";
import type { WorkspaceRepository } from "../../ports/workspace";
import {
  normalizeGovernedWebsiteScopeRequest, normalizeIngestionSourceId, normalizeIngestionTaskFileId,
  normalizeIngestionTaskId, normalizeIngestionTaskRecord, type GovernedWebsiteScopeRequest,
  type IngestionSourceRefreshRecord, type IngestionSourceSnapshot, type IngestionTaskFileRecord,
  type IngestionTaskRecord,
} from "../../../contracts/ingestion";
import { createContractError, createFailureResult, createSuccessResult, type ContractResult } from "../../../contracts/shared";
import { createDeleteArtifactRequest } from "../../../contracts/storage";
import { resolveArtifactWorkspaceContext } from "../artifact-workspace-context";

export type GovernedWebsiteTaskResult<T = IngestionTaskRecord> = ContractResult<T>;
export interface GovernedWebsiteIngestionUseCasesDependencies {
  readonly repository: IngestionAcquisitionRepositoryPort;
  readonly capture: GovernedWebsiteCapturePort;
  readonly streamStorage: ArtifactStreamStoragePort;
  readonly artifactCleanup: Pick<ArtifactStoragePort, "deleteArtifact">;
  readonly workspaceRepository?: Pick<WorkspaceRepository, "readWorkspace">;
  readonly workspaceAuthorization?: WorkspaceOperationAuthorizationPort;
  readonly now?: () => string;
  readonly createId?: () => string;
}

export class GovernedWebsiteIngestionUseCases {
  private readonly now: () => string;
  private readonly createId: () => string;
  public constructor(private readonly dependencies: GovernedWebsiteIngestionUseCasesDependencies) {
    this.now = dependencies.now ?? (() => new Date().toISOString());
    this.createId = dependencies.createId ?? (() => {
      if (!globalThis.crypto?.randomUUID) throw new Error("Secure ingestion id generation is unavailable.");
      return globalThis.crypto.randomUUID();
    });
  }

  public async createTask(scopeValue: GovernedWebsiteScopeRequest, context: ApplicationRequestContext = {}): Promise<GovernedWebsiteTaskResult> {
    const scope = await this.authorize(context, "ingestion.website.create", "artifact:write");
    if (!scope.ok) return scope;
    try {
      const requestedScope = normalizeGovernedWebsiteScopeRequest(scopeValue);
      const urls = await this.dependencies.capture.resolveScope(requestedScope, context);
      if (urls.length < 1 || urls.length > requestedScope.maximumPages!) throw new Error("The selected website scope did not resolve within its page limit.");
      const createdAt = this.now();
      const taskId = normalizeIngestionTaskId(`ingestion.${this.createId()}`);
      const files: IngestionTaskFileRecord[] = urls.map((url, index) => ({
        fileId: normalizeIngestionTaskFileId(`file.${this.createId()}`), checkpointId: `checkpoint.${this.createId()}`,
        fileName: `page-${String(index + 1).padStart(3, "0")}.html`, mediaType: "text/html", totalBytes: 0,
        status: "pending", acceptedBytes: 0, nextChunkIndex: 0, websiteSource: { requestedUrl: url },
      }));
      const task = normalizeIngestionTaskRecord({
        schemaVersion: "1.0", taskId, ...(context.organizationId ? { organizationId: context.organizationId } : {}),
        workspaceId: scope.value.workspaceId, kind: "website", status: "queued", files,
        progress: { acceptedBytes: 0, totalBytes: 0, completedItems: 0, totalItems: files.length, percent: 0, message: "Ready to capture the selected pages." },
        revision: 1, cleanupPending: false, createdAt, updatedAt: createdAt,
      });
      return createSuccessResult(await this.dependencies.repository.createTask(task), context);
    } catch (error) { return failure("validation", safeMessage(error, "The website capture task could not be created."), context); }
  }

  public async runTask(taskIdValue: string, context: ApplicationRequestContext = {}): Promise<GovernedWebsiteTaskResult> {
    const scope = await this.authorize(context, "ingestion.website.run", "artifact:write");
    if (!scope.ok) return scope;
    try {
      let task = await this.requireTask(scope.value.workspaceId, normalizeIngestionTaskId(taskIdValue));
      if (task.kind !== "website") throw new Error("This is not a website capture task.");
      if (task.status === "succeeded" || task.status === "cancelled") return createSuccessResult(task, context);
      if (task.status === "failed") {
        if (task.files.some((file) => file.status === "failed" && !file.error?.retryable)) throw new Error("This website capture cannot be resumed safely.");
        task = await this.dependencies.repository.saveTask(updateTask(task, {
          status: "transferring", files: task.files.map((file) => file.status === "failed" ? { ...file, status: "pending", error: undefined } : file),
          updatedAt: this.now(), progressMessage: "Resuming website capture.",
        }), task.revision);
      }
      for (const candidate of task.files) {
        task = await this.requireTask(scope.value.workspaceId, task.taskId);
        if (task.status === "cancelled") return createSuccessResult(task, context);
        const file = requireFile(task, candidate.fileId);
        if (file.status === "finalized") continue;
        if (!file.websiteSource) throw new Error("Website task coordinates are unavailable.");
        if (task.status === "queued") task = await this.dependencies.repository.saveTask(updateTask(task, {
          status: "transferring", files: task.files, updatedAt: this.now(), progressMessage: "Capturing the selected website pages.",
        }), task.revision);
        let capture: GovernedWebsitePageCapture;
        try { capture = await this.dependencies.capture.capturePage(file.websiteSource.requestedUrl, context); }
        catch (error) {
          return createSuccessResult(await this.failTask(task, file, "website-unavailable", safeMessage(error, "This website page could not be captured."), isRetryableCaptureError(error)), context);
        }
        if (capture.outcome === "unchanged") return createSuccessResult(await this.failTask(task, file, "website-not-captured", "The website did not return content for the initial capture.", true), context);
        if (capture.outcome === "removed") return createSuccessResult(await this.failTask(task, file, "website-removed", "This website page is no longer available.", false), context);
        const sourceId = normalizeIngestionSourceId(`source.${task.taskId}.${file.fileId}`);
        const snapshotId = `snapshot.${task.taskId}.${file.fileId}`;
        const stored = await this.storeCapture(task, sourceId, snapshotId, file.fileName, capture, context);
        if (!stored.ok) return createSuccessResult(await this.failTask(task, file, "website-storage-failed", stored.error.message, true), context);
        const capturedAt = this.now();
        const snapshot = toSnapshot(task, sourceId, snapshotId, file.fileName, capture, stored.value.rawKey, stored.value.derivedKey, capturedAt);
        const files = replaceFile(task, file.fileId, { ...file, status: "finalized", output: {
          key: stored.value.rawKey, mediaType: "text/html", sizeBytes: capture.rawBytes.byteLength, digest: capture.contentDigest,
          sourceId, sourceSnapshotId: snapshotId, derivedArtifactKeys: [stored.value.derivedKey],
        } });
        const allFinalized = files.every((entry) => entry.status === "finalized");
        const nextTask = updateTask(task, {
          status: allFinalized ? "succeeded" : "transferring", files, updatedAt: capturedAt,
          ...(allFinalized ? { completedAt: capturedAt } : {}),
          progressMessage: allFinalized ? "Website capture is ready." : "Page captured. Continuing with the remaining pages.",
        });
        try {
          task = (await this.dependencies.repository.saveTaskWithSourceSnapshot(nextTask, task.revision, snapshot)).task;
        } catch (error) {
          await this.deleteStoredCapture(stored.value, context).catch(() => undefined);
          const latest = await this.dependencies.repository.readTask(task.workspaceId, task.taskId);
          if (latest?.status === "cancelled") return createSuccessResult(latest, context);
          throw error;
        }
      }
      return createSuccessResult(task, context);
    } catch (error) { return failure(error instanceof MissingWebsiteTaskError ? "not-found" : "validation", safeMessage(error, "The website capture task could not be run."), context); }
  }

  public async refreshSource(sourceIdValue: string, context: ApplicationRequestContext = {}): Promise<GovernedWebsiteTaskResult<IngestionSourceRefreshRecord>> {
    const scope = await this.authorize(context, "ingestion.website.refresh", "artifact:write");
    if (!scope.ok) return scope;
    const sourceId = normalizeIngestionSourceId(sourceIdValue);
    const previous = (await this.dependencies.repository.listSourceSnapshots(scope.value.workspaceId, sourceId, 1))[0];
    if (!previous || previous.locator.kind !== "website" || !previous.locator.requestedUrl) return failure("not-found", "The website source was not found.", context);
    const checkedAt = this.now();
    let capture: GovernedWebsitePageCapture;
    try { capture = await this.dependencies.capture.capturePage(previous.locator.requestedUrl, context, { etag: previous.etag, lastModified: previous.lastModified }); }
    catch {
      const refresh = createRefresh(previous, `refresh.${this.createId()}`, "unavailable", checkedAt, "The source could not be checked right now.");
      return createSuccessResult(await this.dependencies.repository.recordSourceRefresh(refresh), context);
    }
    if (capture.outcome === "unchanged") {
      const refresh = createRefresh(previous, `refresh.${this.createId()}`, "unchanged", checkedAt, "No source changes were found.", previous.snapshotId);
      return createSuccessResult(await this.dependencies.repository.recordSourceRefresh(refresh), context);
    }
    if (capture.outcome === "removed") {
      const refresh = createRefresh(previous, `refresh.${this.createId()}`, "removed", checkedAt, "The source is no longer available.");
      return createSuccessResult(await this.dependencies.repository.recordSourceRefresh(refresh), context);
    }
    if (capture.contentDigest === previous.contentDigest) {
      const refresh = createRefresh(previous, `refresh.${this.createId()}`, "unchanged", checkedAt, "No source changes were found.", previous.snapshotId);
      return createSuccessResult(await this.dependencies.repository.recordSourceRefresh(refresh), context);
    }
    const snapshotId = `snapshot.${this.createId()}`;
    const stored = await this.storeCapture(previous, sourceId, snapshotId, "page.html", capture, context);
    if (!stored.ok) return stored;
    const snapshot = toSnapshot(previous, sourceId, snapshotId, previous.locator.displayName, capture, stored.value.rawKey, stored.value.derivedKey, checkedAt, previous.snapshotId);
    const refresh = createRefresh(previous, `refresh.${this.createId()}`, "changed", checkedAt, "The source changed and a new snapshot was saved.", snapshot.snapshotId);
    try {
      const committed = await this.dependencies.repository.recordSourceRefreshWithSnapshot(snapshot, refresh);
      return createSuccessResult(committed.refresh, context);
    } catch (error) {
      await this.deleteStoredCapture(stored.value, context).catch(() => undefined);
      throw error;
    }
  }

  private async storeCapture(task: Pick<IngestionTaskRecord, "workspaceId">, sourceId: string, snapshotId: string, fileName: string, capture: Extract<GovernedWebsitePageCapture, { outcome: "captured" }>, context: ApplicationRequestContext): Promise<ContractResult<{ rawKey: string; derivedKey: string }>> {
    const prefix = `workspaces/${task.workspaceId}/artifacts/files/website/${sourceId}`;
    const rawKey = `${prefix}/${snapshotId}.html`; const derivedKey = `${prefix}/${snapshotId}.txt`;
    const raw = await this.dependencies.streamStorage.storeArtifactStream({
      content: singleChunk(capture.rawBytes), descriptor: { key: rawKey, mediaType: "text/html", metadata: { originalFileName: fileName, ingestionSourceId: sourceId } },
      maximumBytes: capture.rawBytes.byteLength, expectedSizeBytes: capture.rawBytes.byteLength, expectedSha256: capture.contentDigest,
    }, context);
    if (!raw.ok) return raw;
    const derived = await this.dependencies.streamStorage.storeArtifactStream({
      content: singleChunk(capture.derivedTextBytes), descriptor: { key: derivedKey, mediaType: "text/plain", metadata: { originalFileName: fileName.replace(/\.html$/i, ".txt"), ingestionSourceId: sourceId } },
      maximumBytes: capture.derivedTextBytes.byteLength, expectedSizeBytes: capture.derivedTextBytes.byteLength,
    }, context);
    if (!derived.ok) {
      await this.dependencies.artifactCleanup.deleteArtifact(createDeleteArtifactRequest(rawKey), context).catch(() => undefined);
      return derived;
    }
    return createSuccessResult({ rawKey, derivedKey }, context);
  }

  private async failTask(task: IngestionTaskRecord, file: IngestionTaskFileRecord, code: string, message: string, retryable: boolean): Promise<IngestionTaskRecord> {
    const completedAt = this.now();
    return this.dependencies.repository.saveTask(updateTask(task, {
      status: "failed", files: replaceFile(task, file.fileId, { ...file, status: "failed", error: { code, message, retryable } }),
      updatedAt: completedAt, completedAt, progressMessage: retryable ? "Website capture paused. Try again when the source is available." : message,
    }), task.revision);
  }
  private async deleteStoredCapture(stored: { readonly rawKey: string; readonly derivedKey: string }, context: ApplicationRequestContext): Promise<void> {
    const results = await Promise.all([
      this.dependencies.artifactCleanup.deleteArtifact(createDeleteArtifactRequest(stored.rawKey), context),
      this.dependencies.artifactCleanup.deleteArtifact(createDeleteArtifactRequest(stored.derivedKey), context),
    ]);
    if (results.some((result) => !result.ok)) throw new Error("The uncommitted website capture could not be cleaned up.");
  }
  private async requireTask(workspaceId: string, taskId: ReturnType<typeof normalizeIngestionTaskId>): Promise<IngestionTaskRecord> {
    const task = await this.dependencies.repository.readTask(workspaceId as never, taskId); if (!task) throw new MissingWebsiteTaskError(); return task;
  }
  private authorize(context: ApplicationRequestContext, operation: string, scope: "artifact:read" | "artifact:write") {
    return resolveArtifactWorkspaceContext(context, this.dependencies.workspaceRepository, this.dependencies.workspaceAuthorization ? { port: this.dependencies.workspaceAuthorization, operation, requiredScopes: [scope] } : undefined);
  }
}

class MissingWebsiteTaskError extends Error {}
function toSnapshot(task: Pick<IngestionTaskRecord, "workspaceId" | "organizationId">, sourceId: string, snapshotId: string, displayName: string, capture: Extract<GovernedWebsitePageCapture, { outcome: "captured" }>, rawKey: string, derivedKey: string, capturedAt: string, previousSnapshotId?: string): IngestionSourceSnapshot {
  return { schemaVersion: "1.0", snapshotId: snapshotId as never, sourceId: sourceId as never,
    ...(task.organizationId ? { organizationId: task.organizationId } : {}), workspaceId: task.workspaceId,
    locator: { kind: "website", displayName, requestedUrl: capture.requestedUrl, canonicalUrl: capture.canonicalUrl },
    contentDigest: capture.contentDigest, sizeBytes: capture.rawBytes.byteLength, mediaType: capture.mediaType,
    rawArtifactKey: rawKey, derivedArtifactKeys: [derivedKey], capturedAt, ...(previousSnapshotId ? { previousSnapshotId: previousSnapshotId as never } : {}),
    ...(capture.etag ? { etag: capture.etag } : {}), ...(capture.lastModified ? { lastModified: capture.lastModified } : {}),
    httpStatus: capture.httpStatus, robots: capture.robots };
}
function createRefresh(previous: IngestionSourceSnapshot, refreshId: string, outcome: IngestionSourceRefreshRecord["outcome"], checkedAt: string, summary: string, currentSnapshotId?: string): IngestionSourceRefreshRecord {
  return { schemaVersion: "1.0", refreshId: refreshId as never, sourceId: previous.sourceId,
    ...(previous.organizationId ? { organizationId: previous.organizationId } : {}), workspaceId: previous.workspaceId,
    outcome, previousSnapshotId: previous.snapshotId, ...(currentSnapshotId ? { currentSnapshotId: currentSnapshotId as never } : {}), checkedAt, summary };
}
function updateTask(task: IngestionTaskRecord, input: { status: IngestionTaskRecord["status"]; files: readonly IngestionTaskFileRecord[]; updatedAt: string; completedAt?: string; progressMessage: string }): IngestionTaskRecord {
  return normalizeIngestionTaskRecord({ ...task, status: input.status, files: input.files, revision: task.revision + 1, updatedAt: input.updatedAt, cleanupPending: false, progress: { ...task.progress, message: input.progressMessage }, ...(input.completedAt ? { completedAt: input.completedAt } : { completedAt: undefined }) });
}
function replaceFile(task: IngestionTaskRecord, fileId: string, replacement: IngestionTaskFileRecord): readonly IngestionTaskFileRecord[] { return task.files.map((file) => file.fileId === fileId ? replacement : file); }
function requireFile(task: IngestionTaskRecord, fileId: string): IngestionTaskFileRecord { const file = task.files.find((candidate) => candidate.fileId === fileId); if (!file) throw new Error("The website page was not found in this task."); return file; }
function safeMessage(error: unknown, fallback: string): string { const message = error instanceof Error ? error.message.trim() : ""; return message && message.length <= 512 && !/[A-Za-z]:\\|\/Users\/|authorization|cookie|token=/i.test(message) ? message : fallback; }
function isRetryableCaptureError(error: unknown): boolean { const message = error instanceof Error ? error.message.toLowerCase() : ""; return !message.includes("not allowed") && !message.includes("does not allow") && !message.includes("credentials"); }
async function* singleChunk(bytes: Uint8Array): AsyncIterable<Uint8Array> { yield bytes; }
function failure<T = IngestionTaskRecord>(code: "validation" | "not-found" | "unavailable" | "internal", message: string, context: ApplicationRequestContext): ContractResult<T> { return createFailureResult(createContractError(code, message, { requestId: context.requestId, correlationId: context.correlationId }), context); }
