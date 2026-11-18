import type {ApplicationRequestContext} from "../../ports";
import type {ModelRegistryPort} from "../../ports/model/model-registry.port";
import type {IngestionAcquisitionRepositoryPort} from "../../ports/ingestion";
import type {DatasetVersionRepositoryPort} from "../../ports/dataset-version";
import {APPROVED_CONTEXT_MAX_LICENSE_CHARACTERS, type ApprovedContextGenerationAdmission} from "../../ports/context-management";
import {compileApprovedContextEmbeddingModel} from "./approved-context-embedding-model";
import {hasKnownPassiveCredential} from "../../../contracts/shared";
import {normalizeIngestionTaskRecord, normalizeIngestionSourceSnapshot, normalizeIngestionSourceSnapshotId,
  normalizeIngestionTaskId} from "../../../contracts/ingestion";
import {normalizeDatasetVersionId, normalizeDatasetVersionRecord} from "../../../contracts/dataset";
import {evaluateContextSourceCapability, validateStartContextGenerationCommand, type StartContextGenerationCommand} from "../../../contracts/context-management";
import {HEADLESS_CONTEXT_MAX_MODELS, HEADLESS_CONTEXT_MAX_SOURCE_BYTES, HEADLESS_CONTEXT_MAX_SOURCES,
  readHeadlessContextReadRequest, readHeadlessContextModels, readHeadlessContextPreview, isHeadlessContextModelId,
  isHeadlessContextTimestamp, type HeadlessContextModel, type HeadlessContextPreview, type HeadlessHostIncarnationId} from "../../../contracts/headless";

const forbidden = {ok: false, code: "headless.forbidden"} as const;
const unavailable = {ok: false, code: "headless.unavailable"} as const;
const notReady = {ok: false, code: "headless.source-not-ready"} as const;
const stale = {ok: false, code: "headless.stale"} as const;

/** Passive metadata compiler. It has no artifact-byte, processor, model or task ports. */
export class PreviewHeadlessContextInputsUseCase {
  constructor(private readonly dependencies: {
    readonly sources: Pick<IngestionAcquisitionRepositoryPort, "readTask" | "readSourceSnapshot">;
    readonly versions: Pick<DatasetVersionRepositoryPort, "readVersion">;
    readonly models: Pick<ModelRegistryPort, "readRecordedModel" | "listModels">;
  }) {}

  async execute(request: unknown, authority: {readonly hostIncarnationId: HeadlessHostIncarnationId;
    readonly context: ApplicationRequestContext; readonly stillAllowed: () => Promise<boolean>}) {
    const parsed = readHeadlessContextReadRequest(request, authority.hostIncarnationId);
    if (!parsed.ok) return parsed;
    const {operation, input} = parsed.request, {context, stillAllowed} = authority;
    if (!context.organizationId || !context.principalId || context.workspaceId !== input.workspaceId) return forbidden;
    try {
      if (!await stillAllowed()) return forbidden;
      if (operation === "context.models") {
        const listed = await this.dependencies.models.listModels({workspaceId: input.workspaceId, limit: HEADLESS_CONTEXT_MAX_MODELS + 1,
          includeDiscovered: false, includeSharedStorage: false});
        if (!await stillAllowed()) return forbidden;
        if (listed.models.length > HEADLESS_CONTEXT_MAX_MODELS + 1 || listed.models.some(model => model.workspaceId !== input.workspaceId)) return unavailable;
        const models: HeadlessContextModel[] = listed.models.slice(0, HEADLESS_CONTEXT_MAX_MODELS).map(model => ({modelRecordId: model.modelRecordId,
          updatedAt: model.updatedAt ?? model.createdAt, lifecycleStatus: model.lifecycleStatus,
          embeddings: model.taskTags?.includes("embeddings") === true,
          textGeneration: model.taskTags?.some(tag => tag === "text-generation" || tag === "text2text-generation" || tag === "chat") === true,
          runtimeReadiness: "not-checked"}));
        const value = readHeadlessContextModels({workspaceId: input.workspaceId, models,
          truncated: listed.models.length > HEADLESS_CONTEXT_MAX_MODELS || Boolean(listed.nextCursor), runtimeReadiness: "not-checked"}, input.workspaceId);
        return value ? {ok: true, operation, value} as const : unavailable;
      }
      const {settings} = input;
      const bindings: Array<{artifactId: string; digest: string; sizeBytes: number; mediaType: string}> = [];
      const admissionSources: Array<ApprovedContextGenerationAdmission["sources"][number]> = [];
      const previewSources: HeadlessContextPreview["sources"][number][] = [];
      for (const reference of input.sources) {
        if (!await stillAllowed()) return forbidden;
        let artifactId: string, digest: string, sizeBytes: number, mediaType: string, fileName: string | undefined;
        let licenseStatus: "recorded" | "unknown" = "unknown";
        let declaredLicense: string | undefined;
        if (reference.kind === "ingestion-file") {
          const record = await this.dependencies.sources.readTask(input.workspaceId, normalizeIngestionTaskId(reference.taskId));
          if (!await stillAllowed()) return forbidden;
          if (!record) return notReady;
          const task = normalizeIngestionTaskRecord(record);
          if (task.organizationId !== context.organizationId || task.workspaceId !== input.workspaceId || task.taskId !== reference.taskId) return forbidden;
          if (task.revision !== reference.taskRevision) return stale;
          if (task.status !== "succeeded" || task.cleanupPending) return notReady;
          const file = task.files.find(item => item.fileId === reference.fileId), output = file?.output;
          if (file?.status !== "finalized" || !output?.digest || !output.sourceId || !output.sourceSnapshotId ||
              file.mediaType !== output.mediaType || file.totalBytes !== output.sizeBytes) return notReady;
          const saved = await this.dependencies.sources.readSourceSnapshot(input.workspaceId, normalizeIngestionSourceSnapshotId(output.sourceSnapshotId));
          if (!await stillAllowed()) return forbidden;
          if (!saved) return notReady;
          const snapshot = normalizeIngestionSourceSnapshot(saved);
          if (snapshot.organizationId !== context.organizationId || snapshot.workspaceId !== input.workspaceId || snapshot.sourceId !== output.sourceId ||
              snapshot.snapshotId !== output.sourceSnapshotId) return forbidden;
          if (snapshot.rawArtifactKey !== output.key || snapshot.contentDigest !== output.digest || snapshot.sizeBytes !== output.sizeBytes ||
              snapshot.mediaType !== output.mediaType || snapshot.locator.kind !== task.kind.replace("-batch", "") ||
              snapshot.providerRevision !== output.providerRevision ||
              JSON.stringify(snapshot.providerLicenseIds ?? []) !== JSON.stringify(output.providerLicenseIds ?? [])) return unavailable;
          artifactId = output.key; digest = output.digest; sizeBytes = output.sizeBytes; mediaType = output.mediaType; fileName = file.fileName;
          licenseStatus = snapshot.providerLicenseIds?.length ? "recorded" : "unknown";
          declaredLicense = snapshot.providerLicenseIds?.length ? snapshot.providerLicenseIds.join(", ") : undefined;
        } else {
          const saved = await this.dependencies.versions.readVersion(input.workspaceId, normalizeDatasetVersionId(reference.versionId));
          if (!await stillAllowed()) return forbidden;
          if (!saved) return notReady;
          const version = normalizeDatasetVersionRecord(saved);
          if (version.organizationId !== context.organizationId || version.workspaceId !== input.workspaceId ||
              version.datasetId !== reference.datasetId || version.versionId !== reference.versionId) return forbidden;
          if (version.versionDigest !== reference.versionDigest) return stale;
          const artifact = version.artifacts.find(item => item.role === reference.role);
          if (!artifact) return notReady;
          artifactId = artifact.artifactKey; digest = artifact.digest; sizeBytes = artifact.sizeBytes; mediaType = artifact.mediaType;
          licenseStatus = version.documentation.license ? "recorded" : "unknown";
          declaredLicense = version.documentation.license?.trim();
        }
        const readiness = evaluateContextSourceCapability({fileName, mediaType});
        if (!readiness.ready || !readiness.capability || !readiness.capability.mediaTypes.includes(mediaType.split(";", 1)[0].trim().toLowerCase()) ||
            sizeBytes < 1 || sizeBytes > HEADLESS_CONTEXT_MAX_SOURCE_BYTES || bindings.some(binding => binding.artifactId === artifactId)) return notReady;
        if (declaredLicense !== undefined && (!declaredLicense || declaredLicense.length > APPROVED_CONTEXT_MAX_LICENSE_CHARACTERS ||
            hasKnownPassiveCredential(declaredLicense) || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(declaredLicense))) return notReady;
        bindings.push({artifactId, digest, sizeBytes, mediaType});
        admissionSources.push({artifactId, storageKey: artifactId, digest, sizeBytes, mediaType, format: readiness.capability.format,
          ...(declaredLicense ? {declaredLicense} : {})});
        previewSources.push({reference, digest, sizeBytes, format: readiness.capability.format, licenseStatus});
      }
      const totalBytes = bindings.reduce((sum, source) => sum + source.sizeBytes, 0);
      if (totalBytes > HEADLESS_CONTEXT_MAX_SOURCES * HEADLESS_CONTEXT_MAX_SOURCE_BYTES) return notReady;
      if (!await stillAllowed()) return forbidden;
      let modelId: string | undefined;
      let embeddingModel: ApprovedContextGenerationAdmission["embeddingModel"];
      if (settings.kind === "rag-database") {
        if (!this.dependencies.models.readRecordedModel) return unavailable;
        const model = await this.dependencies.models.readRecordedModel(input.workspaceId, settings.modelRecordId);
        if (!await stillAllowed()) return forbidden;
        if (!model || model.workspaceId !== input.workspaceId || model.modelRecordId !== settings.modelRecordId) return notReady;
        const updatedAt = model.updatedAt ?? model.createdAt;
        if (!isHeadlessContextModelId(model.modelRecordId) || !isHeadlessContextTimestamp(updatedAt) || updatedAt !== settings.modelUpdatedAt) return stale;
        if (!model.taskTags?.includes("embeddings") || !["downloaded", "generated", "validated"].includes(model.lifecycleStatus) ||
            model.artifactForm === "adapter" || model.validationStatus === "invalid" ||
            typeof model.modelId !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,95}\/[A-Za-z0-9][A-Za-z0-9._-]{0,95}$/.test(model.modelId)) return notReady;
        embeddingModel = compileApprovedContextEmbeddingModel(model, input.workspaceId);
        if (!embeddingModel) return notReady;
        modelId = embeddingModel.modelId;
      }
      const command: StartContextGenerationCommand = validateStartContextGenerationCommand({kind: settings.kind, name: input.name,
        sources: bindings.map(({artifactId}) => ({artifactId})), chunking: {strategy: settings.kind === "rag-database" ? "fixed-length" : "topic-aware",
          chunkCharacters: settings.chunkCharacters, overlapCharacters: settings.overlapCharacters, maximumChunks: settings.maximumChunks,
          textFields: settings.textFields},
        ...(settings.kind === "rag-database" ? {sourceChecks: settings.sourceChecks,
          embedding: {provider: "transformers" as const, modelId: modelId!, batchSize: settings.batchSize, device: settings.device}}
          : {contextPack: {inputMode: "source-materials" as const, method: "none" as const, cleaningPreset: settings.cleaningPreset}})});
      if (!await stillAllowed()) return forbidden;
      const preview = readHeadlessContextPreview({workspaceId: input.workspaceId, name: input.name, sources: previewSources, settings, totalBytes,
        runtimeReadiness: "not-checked", approvalRequired: true, reviewRequired: true, modelCalls: 0, externalProviderCalls: 0}, input);
      return preview ? {ok: true, operation, prepared: {command, bindings, admissionSources, preview,
        ...(embeddingModel ? {embeddingModel} : {})}} as const : unavailable;
    } catch {
      try {return await stillAllowed() ? unavailable : forbidden;} catch {return forbidden;}
    }
  }
}
