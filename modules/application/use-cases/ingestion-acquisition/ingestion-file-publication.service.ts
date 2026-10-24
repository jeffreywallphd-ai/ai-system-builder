import type { ApplicationRequestContext } from "../../ports/application-request-context";
import type { ArtifactCatalogCreatePort, ArtifactCatalogReadPort, ArtifactCatalogRecord } from "../../ports/artifact-catalog";
import type { ArtifactStorageBindingCreatePort, ArtifactStorageBindingPort } from "../../ports/storage";
import type {
  IngestionAcquisitionRepositoryPort, IngestionCheckpointStoragePort,
  IngestionFilePublication, IngestionFilePublicationPort, IngestionFilePublicationRepositoryPort,
  IngestionFileByteStoragePort, IngestionFilePublicationOutcome,
} from "../../ports/ingestion";
import { assertPublicationOutput, assertPublicationTask, normalizeIngestionFilePublication, publicationUnavailable, samePublicationData } from "../../shared/ingestion-file-publication";
import { resolveArtifactFamily } from "../../shared/artifact-family-classifier";
import { normalizeIngestionSha256Digest, normalizeIngestionTaskRecord, type IngestionTaskRecord } from "../../../contracts/ingestion";
import type { ArtifactStorageBinding } from "../../../contracts/storage";
import { createWorkspaceId } from "../../../contracts/workspace";

interface Dependencies {
  readonly repository: IngestionAcquisitionRepositoryPort;
  readonly publications: IngestionFilePublicationRepositoryPort;
  readonly checkpoints: IngestionCheckpointStoragePort;
  /** Raw exclusive storage, with no automatic binding or catalog appender. */
  readonly bytes: IngestionFileByteStoragePort;
  readonly bindings: ArtifactStorageBindingCreatePort & Pick<ArtifactStorageBindingPort, "readArtifactStorageBindings">;
  readonly catalog: ArtifactCatalogCreatePort & Pick<ArtifactCatalogReadPort, "readArtifactCatalogRecord">;
  readonly now?: () => string;
  readonly createId?: () => string;
}
type Request = Parameters<IngestionFilePublicationPort["publishFile"]>[0];

/** Orchestrates one private, owner-bound publication; it never deletes artifacts. */
export class IngestionFilePublicationService implements IngestionFilePublicationPort {
  public constructor(private readonly dependencies: Dependencies) {}

  public async publishFile(input: Request, supplied: ApplicationRequestContext): Promise<IngestionFilePublicationOutcome> {
    try {
      const request = { ...input };
      const context = { ...supplied, workspaceId: createWorkspaceId(supplied.workspaceId!) };
      this.requireCapabilities();
      let task = await this.readTask(request, context);
      let publication = await this.dependencies.publications.readPublication(task.workspaceId, request.taskId, request.fileId);
      if (!publication) {
        this.requireActive(task, request.fileId);
        const file = task.files.find(candidate => candidate.fileId === request.fileId)!;
        const checked = await this.dependencies.bytes.verifyContent({
          content: this.dependencies.checkpoints.readChunks({ workspaceId: task.workspaceId, checkpointId: file.checkpointId,
            expectedChunkCount: file.nextChunkIndex, expectedSizeBytes: file.acceptedBytes }, context),
          maximumBytes: file.totalBytes, expectedSizeBytes: file.totalBytes, expectedSha256: request.expectedSha256,
        }, context);
        // This rejection happens before any reservation or target effect; a
        // corrected checksum can still use the normal failed/resume workflow.
        if (!checked.ok) return { kind: "content-rejected" };
        if (checked.value.sizeBytes !== file.totalBytes) publicationUnavailable();
        const verifiedDigest = normalizeIngestionSha256Digest(checked.value.digest);
        if (request.expectedSha256 && verifiedDigest !== request.expectedSha256) publicationUnavailable();
        const publicationId = this.dependencies.createId?.() ?? globalThis.crypto.randomUUID().replaceAll("-", "");
        const proposed = normalizeIngestionFilePublication({
          schemaVersion: "1.0", publicationId, workspaceId: task.workspaceId, organizationId: task.organizationId,
          taskId: task.taskId, fileId: file.fileId, taskCreatedAt: task.createdAt, checkpointExpiresAt: task.checkpointExpiresAt,
          checkpointId: file.checkpointId, fileName: file.fileName, mediaType: file.mediaType,
          totalBytes: file.totalBytes, acceptedBytes: file.acceptedBytes, nextChunkIndex: file.nextChunkIndex,
          expectedSha256: verifiedDigest,
          key: `workspaces/${task.workspaceId}/artifacts/files/ingestion/${publicationId}`,
          capturedAt: this.dependencies.now?.() ?? new Date().toISOString(), revision: 1, state: "reserved",
        });
        try { publication = await this.dependencies.publications.createPublication(proposed); }
        catch {
          // A concurrent reservation can win. It still needs its own exclusive
          // writing CAS; merely reading a writing record grants no byte effect.
          publication = await this.dependencies.publications.readPublication(task.workspaceId, request.taskId, request.fileId);
          if (!publication) publicationUnavailable();
        }
      }
      publication = normalizeIngestionFilePublication(publication);
      this.assertRequest(publication, task, request);
      if (publication.state === "committed") return { kind: "published", publication: await this.verifyFilePublication(request, context) };
      this.requireActive(task, request.fileId);
      if (publication.state === "writing") publicationUnavailable();
      if (publication.state === "reserved") {
        await this.requireAbsentOrigin(publication, context);
        // Never reconcile a lost writing acknowledgement into write authority.
        const writing = normalizeIngestionFilePublication({ ...publication, revision: 2, state: "writing" });
        publication = normalizeIngestionFilePublication(await this.dependencies.publications.savePublication(writing, 1));
        if (!samePublicationData(publication, writing)) publicationUnavailable();
        task = await this.readTask(request, context);
        this.assertRequest(publication, task, request);
        this.requireActive(task, request.fileId);
        const stored = await this.dependencies.bytes.storeArtifactStream({
          content: this.dependencies.checkpoints.readChunks({ workspaceId: publication.workspaceId, checkpointId: publication.checkpointId,
            expectedChunkCount: publication.nextChunkIndex, expectedSizeBytes: publication.acceptedBytes }, context),
          descriptor: { key: publication.key, mediaType: publication.mediaType },
          maximumBytes: publication.totalBytes, expectedSizeBytes: publication.totalBytes,
          ...(publication.expectedSha256 ? { expectedSha256: publication.expectedSha256 } : {}), overwrite: false,
        }, context);
        if (!stored.ok || stored.value.key !== publication.key || stored.value.mediaType !== publication.mediaType
          || stored.value.sizeBytes !== publication.totalBytes || stored.value.checksum?.algorithm !== "sha256") publicationUnavailable();
        const acknowledged = normalizeIngestionFilePublication({ ...publication, revision: 3, state: "bytes-acknowledged", digest: `sha256:${stored.value.checksum.value}` });
        publication = await this.advanceKnown(acknowledged);
      }
      task = await this.readTask(request, context);
      this.assertRequest(publication, task, request);
      this.requireActive(task, request.fileId);
      if (publication.state === "bytes-acknowledged") {
        // Exactly one acknowledged invocation may attempt origin effects. A
        // lost CAS acknowledgement must never be reconciled into write authority.
        const issued = normalizeIngestionFilePublication({ ...publication, revision: 4, state: "origin-issued" });
        publication = normalizeIngestionFilePublication(await this.dependencies.publications.savePublication(issued, 3));
        if (!samePublicationData(publication, issued)) publicationUnavailable();
        this.requireActive(await this.readTask(request, context), publication.fileId);
        await this.publishOrigin(publication, context);
        publication = await this.advanceKnown({ ...publication, revision: 5, state: "origin-complete" });
      } else if (publication.state === "origin-issued") {
        // Absence cannot distinguish an unattempted effect from authorized
        // deletion. Recovery verifies complete exact origin without recreating it.
        await this.verifyOrigin(publication, context);
        publication = await this.advanceKnown({ ...publication, revision: 5, state: "origin-complete" });
      } else if (publication.state === "origin-complete") await this.verifyOrigin(publication, context);
      else publicationUnavailable();
      return { kind: "published", publication };
    } catch { return publicationUnavailable(); }
  }

  public async verifyFilePublication(input: Request, supplied: ApplicationRequestContext): Promise<IngestionFilePublication> {
    try {
      const request = { ...input };
      const context = { ...supplied, workspaceId: createWorkspaceId(supplied.workspaceId!) };
      this.requireCapabilities();
      const task = await this.readTask(request, context);
      const publication = normalizeIngestionFilePublication(await this.dependencies.publications.readPublication(task.workspaceId, request.taskId, request.fileId));
      this.assertRequest(publication, task, request);
      if (publication.state !== "committed") publicationUnavailable();
      assertPublicationOutput(publication, task);
      await this.verifyOrigin(publication, context);
      return publication;
    } catch { return publicationUnavailable(); }
  }

  private requireCapabilities(): void {
    const { bytes, bindings, catalog, publications } = this.dependencies;
    if (typeof bytes?.storeArtifactStream !== "function" || typeof bytes?.verifyContent !== "function" || typeof bindings?.createArtifactStorageBindingIfAbsent !== "function"
      || typeof bindings?.readArtifactStorageBindings !== "function" || typeof catalog?.createArtifactCatalogRecordIfAbsent !== "function"
      || typeof catalog?.readArtifactCatalogRecord !== "function" || typeof publications?.readPublication !== "function"
      || typeof publications?.createPublication !== "function" || typeof publications?.savePublication !== "function") publicationUnavailable();
  }

  private async readTask(request: Request, context: ApplicationRequestContext): Promise<IngestionTaskRecord> {
    const value = await this.dependencies.repository.readTask(createWorkspaceId(context.workspaceId!), request.taskId);
    if (!value) publicationUnavailable();
    const task = normalizeIngestionTaskRecord(value);
    if (task.kind !== "file-batch" || task.workspaceId !== context.workspaceId || task.organizationId !== context.organizationId
      || task.taskId !== request.taskId || !task.files.some(file => file.fileId === request.fileId)) publicationUnavailable();
    return task;
  }

  private requireActive(task: IngestionTaskRecord, fileId: string): void {
    const file = task.files.find(candidate => candidate.fileId === fileId)!;
    if (task.status !== "finalizing" || !["pending", "transferring"].includes(file.status) || file.acceptedBytes !== file.totalBytes) publicationUnavailable();
  }

  private assertRequest(publication: IngestionFilePublication, task: IngestionTaskRecord, request: Request): void {
    assertPublicationTask(publication, task);
    if (publication.taskId !== request.taskId || publication.fileId !== request.fileId
      || (request.expectedSha256 && request.expectedSha256 !== (publication.digest ?? publication.expectedSha256))) publicationUnavailable();
  }

  private async advanceKnown(input: IngestionFilePublication): Promise<IngestionFilePublication> {
    const expected = normalizeIngestionFilePublication(input);
    try {
      const saved = normalizeIngestionFilePublication(await this.dependencies.publications.savePublication(expected, expected.revision - 1));
      if (!samePublicationData(saved, expected)) publicationUnavailable();
      return saved;
    } catch {
      const current = await this.dependencies.publications.readPublication(expected.workspaceId, expected.taskId, expected.fileId);
      if (!current || !samePublicationData(normalizeIngestionFilePublication(current), expected)) publicationUnavailable();
      return expected;
    }
  }

  private origin(publication: IngestionFilePublication): { binding: ArtifactStorageBinding; record: ArtifactCatalogRecord } {
    if (!publication.digest) publicationUnavailable();
    return {
      binding: { workspaceId: publication.workspaceId, artifactId: publication.key, role: "primary", createdAt: publication.capturedAt,
        backing: { kind: "artifact-object", provider: "local-filesystem", locator: publication.key } },
      record: { workspaceId: publication.workspaceId, storageKey: publication.key, mediaType: publication.mediaType,
        sizeBytes: publication.totalBytes, artifactFamily: resolveArtifactFamily({ mediaType: publication.mediaType, fileName: publication.fileName }),
        sourceKind: "upload", originalName: publication.fileName, createdAt: publication.capturedAt,
        checksum: { algorithm: "sha256", value: publication.digest.slice(7) } },
    };
  }

  private async requireAbsentOrigin(publication: IngestionFilePublication, context: ApplicationRequestContext): Promise<void> {
    const bindings = await this.dependencies.bindings.readArtifactStorageBindings({ workspaceId: publication.workspaceId, artifactId: publication.key }, context);
    const catalog = await this.dependencies.catalog.readArtifactCatalogRecord({ workspaceId: publication.workspaceId, storageKey: publication.key }, context);
    if (!bindings.ok || bindings.value.bindings.length !== 0 || catalog.ok || catalog.error.code !== "not-found") publicationUnavailable();
  }

  private async publishOrigin(publication: IngestionFilePublication, context: ApplicationRequestContext): Promise<void> {
    const expected = this.origin(publication);
    const bindings = await this.dependencies.bindings.readArtifactStorageBindings({ workspaceId: publication.workspaceId, artifactId: publication.key }, context);
    if (!bindings.ok) publicationUnavailable();
    if (bindings.value.bindings.length === 0) {
      try { await this.dependencies.bindings.createArtifactStorageBindingIfAbsent({ binding: expected.binding }, context); } catch { /* exact readback below */ }
    }
    await this.verifyBinding(publication, context);
    // Reauthorize the actual task between metadata effects. A cancellation is
    // retention evidence, never permission to complete or delete its bytes.
    this.requireActive(await this.readTask(publication, context), publication.fileId);
    const record = await this.dependencies.catalog.readArtifactCatalogRecord({ workspaceId: publication.workspaceId, storageKey: publication.key }, context);
    if (!record.ok && record.error.code === "not-found") {
      try { await this.dependencies.catalog.createArtifactCatalogRecordIfAbsent({ record: expected.record }, context); } catch { /* exact readback below */ }
    }
    await this.verifyOrigin(publication, context);
  }

  private async verifyBinding(publication: IngestionFilePublication, context: ApplicationRequestContext): Promise<void> {
    const result = await this.dependencies.bindings.readArtifactStorageBindings({ workspaceId: publication.workspaceId, artifactId: publication.key }, context);
    if (!result.ok || !samePublicationData(result.value.bindings, [this.origin(publication).binding])) publicationUnavailable();
  }

  private async verifyOrigin(publication: IngestionFilePublication, context: ApplicationRequestContext): Promise<void> {
    await this.verifyBinding(publication, context);
    const record = await this.dependencies.catalog.readArtifactCatalogRecord({ workspaceId: publication.workspaceId, storageKey: publication.key }, context);
    if (!record.ok || !samePublicationData(record.value.record, this.origin(publication).record)) publicationUnavailable();
  }
}
