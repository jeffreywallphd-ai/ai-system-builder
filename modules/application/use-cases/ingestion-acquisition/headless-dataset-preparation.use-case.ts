import type {ApplicationRequestContext} from "../../ports";
import type {IngestionAcquisitionRepositoryPort} from "../../ports/ingestion";
import type {LocalDatasetPreparationAdmission} from "../../ports/runtime";
import {normalizeIngestionTaskRecord, normalizeIngestionSourceSnapshot, normalizeIngestionSourceSnapshotId} from "../../../contracts/ingestion";
import {resolveDatasetPreparationSourceCapability} from "../../../contracts/runtime";
import {HEADLESS_DATASET_MAX_SOURCE_BYTES, HEADLESS_DATASET_MAX_TOTAL_BYTES, HEADLESS_DATASET_MAX_ROWS_PER_SOURCE,
  readHeadlessDatasetPreparationRequest} from "../../../contracts/headless";
import type {HeadlessHostIncarnationId} from "../../../contracts/headless";
import type {PrepareTrainingDatasetFromArtifactsCommand} from "../prepare-training-dataset-from-artifacts.use-case";

const forbidden = {ok: false, code: "headless.forbidden"} as const;
const unavailable = {ok: false, code: "headless.unavailable"} as const;
const notReady = {ok: false, code: "headless.source-not-ready"} as const;

/** Internal source admission only. The private command is never a transport result. */
export class PrepareHeadlessDatasetInputsUseCase {
  constructor(private readonly sources: Pick<IngestionAcquisitionRepositoryPort, "readTask" | "readSourceSnapshot">) {}

  async execute(request: unknown, authority: {
    readonly hostIncarnationId: HeadlessHostIncarnationId;
    readonly context: ApplicationRequestContext;
    readonly stillAllowed: () => Promise<boolean>;
  }) {
    const {context, stillAllowed} = authority;
    const parsed = readHeadlessDatasetPreparationRequest(request, authority.hostIncarnationId);
    if (!parsed.ok) return parsed;
    const {input} = parsed.request;
    if (!context.organizationId || !context.principalId || context.workspaceId !== input.workspaceId) return forbidden;
    const artifactIds: string[] = [];
    const admissionSources: Array<LocalDatasetPreparationAdmission["sources"][number]> = [];
    const previewSources = [];
    let totalBytes = 0;
    try {
      for (const selected of input.sources) {
        if (!await stillAllowed()) return forbidden;
        const record = await this.sources.readTask(input.workspaceId, selected.taskId);
        if (!await stillAllowed()) return forbidden;
        if (!record) return notReady;
        if (record.organizationId !== context.organizationId || record.workspaceId !== input.workspaceId || record.taskId !== selected.taskId) return forbidden;
        const task = normalizeIngestionTaskRecord(record);
        if (task.revision !== selected.taskRevision) return {ok: false, code: "headless.stale"} as const;
        if (task.kind !== "file-batch" || task.status !== "succeeded" || task.cleanupPending) return notReady;
        const file = task.files.find(item => item.fileId === selected.fileId);
        const output = file?.output;
        if (!file || file.status !== "finalized" || !output?.digest || !output.sourceId || !output.sourceSnapshotId) return notReady;
        if (file.providerSource || file.websiteSource || output.providerRevision || output.providerLicenseIds ||
            output.sizeBytes !== file.totalBytes || output.sizeBytes < 1 || output.sizeBytes > HEADLESS_DATASET_MAX_SOURCE_BYTES) return notReady;
        totalBytes += output.sizeBytes;
        if (totalBytes > HEADLESS_DATASET_MAX_TOTAL_BYTES || artifactIds.includes(output.key)) return notReady;
        const capability = resolveDatasetPreparationSourceCapability({fileName: file.fileName, mediaType: file.mediaType});
        if (!capability || capability.kind !== "structured" || !capability.taskTypes.includes("llm-instruction") ||
            !capability.mediaTypes.some(media => media === file.mediaType.split(";", 1)[0].trim().toLowerCase())) return notReady;
        if (!await stillAllowed()) return forbidden;
        const saved = await this.sources.readSourceSnapshot(input.workspaceId, normalizeIngestionSourceSnapshotId(output.sourceSnapshotId));
        if (!await stillAllowed()) return forbidden;
        if (!saved) return notReady;
        if (saved.organizationId !== context.organizationId || saved.workspaceId !== input.workspaceId ||
            saved.snapshotId !== output.sourceSnapshotId || saved.sourceId !== output.sourceId) return forbidden;
        const snapshot = normalizeIngestionSourceSnapshot(saved);
        if (snapshot.locator.kind !== "file" || snapshot.rawArtifactKey !== output.key || snapshot.contentDigest !== output.digest ||
            snapshot.sizeBytes !== output.sizeBytes || snapshot.mediaType !== output.mediaType || file.mediaType !== output.mediaType) return unavailable;
        artifactIds.push(output.key);
        admissionSources.push({artifactId: output.key, storageKey: output.key, format: capability.format,
          mediaType: snapshot.mediaType, sizeBytes: snapshot.sizeBytes, digest: snapshot.contentDigest});
        previewSources.push({...selected, sourceSnapshotId: snapshot.snapshotId, format: capability.format,
          sizeBytes: output.sizeBytes, digest: output.digest, licenseStatus: "unknown" as const});
      }
      if (!await stillAllowed()) return forbidden;
      const command: PrepareTrainingDatasetFromArtifactsCommand = {
        sourceArtifactIds: artifactIds,
        recipe: {task: {taskType: "llm-instruction", textInputMode: "provided", promptStyle: "instruction-response",
          inputField: input.recipe.inputColumn, outputField: input.recipe.outputColumn, sourceContextPolicy: "omit"}},
        split: {...input.split, shuffle: true},
        output: {format: "jsonl", destinations: {local: {enabled: true}}},
        quality: {policy: {preset: input.qualityPreset, maxRowsPerSource: HEADLESS_DATASET_MAX_ROWS_PER_SOURCE}, reviewRequired: true},
      };
      return {ok: true, prepared: {command, admissionSources, preview: {workspaceId: input.workspaceId, sources: previewSources,
        recipe: input.recipe, split: input.split, qualityPreset: input.qualityPreset, totalBytes,
        maximumRowsPerSource: HEADLESS_DATASET_MAX_ROWS_PER_SOURCE, outputFormat: "jsonl" as const,
        reviewRequired: true as const, externalProviderCalls: 0 as const, modelCalls: 0 as const}}} as const;
    } catch {
      try {return await stillAllowed() ? unavailable : forbidden;} catch {return forbidden;}
    }
  }
}
