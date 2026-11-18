import type {ApplicationRequestContext} from "../../ports";
import type {IngestionAcquisitionRepositoryPort} from "../../ports/ingestion";
import type {DatasetVersionRepositoryPort} from "../../ports/dataset-version";
import {isWorkspaceId} from "../../../contracts/workspace";
import {normalizeIngestionTaskId, normalizeIngestionTaskRecord, normalizeIngestionSourceSnapshot,
  normalizeIngestionSourceSnapshotId} from "../../../contracts/ingestion";
import {normalizeDatasetVersionId, normalizeDatasetVersionRecord} from "../../../contracts/dataset";
import {isUiDataPresentationIntent, readUiPresentationDetail, readUiPresentationIntent, readHeadlessDatasetTaskReviewValue,
  type UiDataPresentationIntent, type UiPresentationDetail} from "../../../contracts/headless";

/** Exact interactive metadata only. No source bytes, provider calls or task effects. */
export class ReadHeadlessDataPresentationUseCase {
  constructor(private readonly dependencies: {
    readonly sources: Pick<IngestionAcquisitionRepositoryPort, "readTask" | "readSourceSnapshot">;
    readonly versions: Pick<DatasetVersionRepositoryPort, "readVersion">;
    /** Must prove durable accepted task/host/actor ownership before resolving a processor. */
    readonly readAcceptedTask: (taskId: string, context: ApplicationRequestContext, stillAllowed: () => Promise<boolean>) => Promise<unknown>;
  }) {}

  async execute(raw: UiDataPresentationIntent, context: ApplicationRequestContext, stillAllowed: () => Promise<boolean>): Promise<UiPresentationDetail | undefined> {
    const intent = readUiPresentationIntent(raw);
    if (!intent || !isUiDataPresentationIntent(intent) || !context.organizationId || !context.principalId || !isWorkspaceId(context.workspaceId)) return;
    try {
      if (!await stillAllowed()) return;
      if (intent.action === "show-dataset-task") {
        const value = readHeadlessDatasetTaskReviewValue(await this.dependencies.readAcceptedTask(intent.taskId, context, stillAllowed), {kind: "task", taskId: intent.taskId});
        if (!value || !await stillAllowed()) return;
        const review = value.review;
        return readUiPresentationDetail({title: "Dataset preparation", summary: review
          ? `Review required: ${review.counts.acceptedRows} accepted rows, ${review.counts.quarantinedRows} rows set aside. Quality: ${review.status}.`
          : `Task status: ${value.state}.`});
      }
      if (intent.action === "show-dataset-version") {
        const saved = await this.dependencies.versions.readVersion(context.workspaceId, normalizeDatasetVersionId(intent.versionId));
        if (!saved || !await stillAllowed()) return;
        const version = normalizeDatasetVersionRecord(saved);
        if (version.organizationId !== context.organizationId || version.workspaceId !== context.workspaceId ||
            version.datasetId !== intent.datasetId || version.versionId !== intent.versionId || version.versionDigest !== intent.versionDigest) return;
        return readUiPresentationDetail({title: "Saved dataset version",
          summary: `${version.totalRows} rows from ${version.lineage.sources.length} sources. Immutable saved version.`});
      }
      const saved = await this.dependencies.sources.readTask(context.workspaceId, normalizeIngestionTaskId(intent.taskId));
      if (!saved || !await stillAllowed()) return;
      const task = normalizeIngestionTaskRecord(saved);
      if (task.organizationId !== context.organizationId || task.workspaceId !== context.workspaceId || task.taskId !== intent.taskId ||
          task.revision !== intent.taskRevision || task.status !== "succeeded" || task.cleanupPending) return;
      const file = task.files.find(item => item.fileId === intent.fileId), output = file?.output;
      if (file?.status !== "finalized" || !output?.digest || !output.sourceId || !output.sourceSnapshotId) return;
      const selected = await this.dependencies.sources.readSourceSnapshot(context.workspaceId, normalizeIngestionSourceSnapshotId(output.sourceSnapshotId));
      if (!selected || !await stillAllowed()) return;
      const snapshot = normalizeIngestionSourceSnapshot(selected);
      if (snapshot.organizationId !== context.organizationId || snapshot.workspaceId !== context.workspaceId ||
          snapshot.snapshotId !== output.sourceSnapshotId || snapshot.sourceId !== output.sourceId || snapshot.rawArtifactKey !== output.key ||
          snapshot.contentDigest !== output.digest || snapshot.sizeBytes !== output.sizeBytes || snapshot.mediaType !== output.mediaType ||
          snapshot.locator.kind !== task.kind.replace("-batch", "") || snapshot.providerRevision !== output.providerRevision ||
          JSON.stringify(snapshot.providerLicenseIds ?? []) !== JSON.stringify(output.providerLicenseIds ?? [])) return;
      // Names, URLs, paths and provider coordinates stay out of this projection.
      // Exact opaque selection remains visible alongside the fixed detail.
      return {title: "Saved source data", summary: `Source type: ${snapshot.locator.kind}. ${snapshot.sizeBytes} bytes. License: ${
        snapshot.providerLicenseIds?.length ? "recorded with the source" : "not recorded"}.`};
    } catch {return;}
  }
}
