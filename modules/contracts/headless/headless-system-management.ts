import { copyBoundedPassiveData, hasKnownPassiveCredential, readStrictPassiveRecord } from "../shared";
import {
  isSystemBuilderSystemId, normalizeSystemBuilderRevisionId, normalizeSystemBuilderTemplateId,
  type SystemBuilderRevisionId, type SystemBuilderSystemId, type SystemBuilderTemplateId,
} from "../system-builder";
import { isWorkspaceId, type WorkspaceId } from "../workspace";
import { HEADLESS_CONTRACT_VERSION, isHeadlessHostIncarnationId, type HeadlessHostIncarnationId } from "./headless-read-request";
import { readHeadlessLocalFileSavePlanRequest, type HeadlessLocalFileSavePlanRequest } from "./headless-data-local-file";
import { readHeadlessProviderFileSavePlanRequest, type HeadlessProviderFileSavePlanRequest } from "./headless-data-provider-file";
import {readHeadlessLocalDatasetPlanRequest, type HeadlessLocalDatasetPlanRequest} from "./headless-dataset-plan";
import {readHeadlessDatasetResultSavePlanRequest, type HeadlessDatasetResultSavePlanRequest} from "./headless-dataset-result-plan";
import {readHeadlessContextGenerationPlanRequest, type HeadlessContextGenerationPlanRequest,
  type HeadlessContextPackPlanRequest, type HeadlessContextRagPlanRequest} from "./headless-context-plan";
import {HEADLESS_CONTEXT_MAX_SOURCE_BYTES, HEADLESS_CONTEXT_MAX_SOURCES} from "./headless-context-preview";
import {readHeadlessContextResultSavePlanRequest, type HeadlessContextResultSavePlanRequest} from "./headless-context-result-plan";
import {readHeadlessContextQueryPlanRequest, type HeadlessContextQueryPlanRequest} from "./headless-context-query-plan";
import {HEADLESS_CONTEXT_QUERY_MAX_CHARACTERS} from "./headless-context-query-preview";
import {CONTEXT_GENERATION_LIMITS} from "../context-management";
import {HEADLESS_DATASET_MAX_SOURCE_BYTES, HEADLESS_DATASET_MAX_TOTAL_BYTES, HEADLESS_DATASET_MAX_ROWS_PER_SOURCE} from "./headless-dataset-preparation";
import type { HeadlessSemanticBatchRequest } from "./headless-semantic-batch";
import {readHeadlessModelDownloadPlanRequest, type HeadlessModelDownloadPlanRequest} from "./headless-model-download-plan";

interface ManagementTarget {
  readonly hostIncarnationId: HeadlessHostIncarnationId;
  readonly workspaceId: WorkspaceId;
  readonly idempotencyKey: string;
  readonly name: string;
}

interface SavedTarget extends ManagementTarget {
  readonly systemId: SystemBuilderSystemId;
  readonly baseRecordRevision: number;
  readonly baseRevisionId: SystemBuilderRevisionId;
}

export type HeadlessSystemManagementRequest =
  { readonly version: typeof HEADLESS_CONTRACT_VERSION } & (
    | { readonly operation: "systems.create"; readonly input: ManagementTarget & { readonly templateId: SystemBuilderTemplateId } }
    | { readonly operation: "systems.rename"; readonly input: SavedTarget & { readonly description?: string } }
    | { readonly operation: "systems.clone"; readonly input: SavedTarget }
  );

type PreQueryBuildPlanRequest = HeadlessSystemManagementRequest | HeadlessLocalFileSavePlanRequest | HeadlessProviderFileSavePlanRequest |
  HeadlessLocalDatasetPlanRequest | HeadlessDatasetResultSavePlanRequest | HeadlessContextGenerationPlanRequest | HeadlessContextResultSavePlanRequest;
type PreModelBuildPlanRequest = PreQueryBuildPlanRequest | HeadlessContextQueryPlanRequest;
export type HeadlessBuildPlanRequest = PreModelBuildPlanRequest | HeadlessModelDownloadPlanRequest;
type PreContextResultBuildPlanRequest = Exclude<PreQueryBuildPlanRequest, HeadlessContextResultSavePlanRequest>;
type LegacyBuildPlanRequest = Exclude<PreContextResultBuildPlanRequest, HeadlessContextGenerationPlanRequest>;
export interface HeadlessBuildPlanCapabilities {
  readonly allowLocalFileSave: boolean;
  readonly allowProviderFileSave?: boolean;
  readonly allowLocalDatasetPreparation?: boolean;
  readonly allowDatasetResultSave?: boolean;
  readonly allowContextPackGeneration?: boolean;
  readonly allowContextRagGeneration?: boolean;
  readonly allowContextResultSave?: boolean;
  readonly allowContextQuery?: boolean;
  readonly allowModelDownload?: boolean;
}

/** Serialize the saved effect without the connection identity or its receipt key. */
export function serializeHeadlessMutationInput(
  request: HeadlessBuildPlanRequest | Extract<HeadlessSemanticBatchRequest, { operation: "systems.apply-edits" }>,
): string {
  const { hostIncarnationId: _host, idempotencyKey: _key, ...input } = request.input;
  return JSON.stringify({ version: request.version, operation: request.operation, input }, (_name, item: unknown) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return item;
    return Object.fromEntries(Object.entries(item).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0));
  });
}

const commonFields = ["hostIncarnationId", "workspaceId", "idempotencyKey", "name"];
const savedFields = [...commonFields, "systemId", "baseRecordRevision", "baseRevisionId"];
const invalid = { ok: false, code: "headless.invalid-request" } as const;

export const HEADLESS_MAX_BUILD_PLAN_STEPS = 8;
const PLAN_PREVIEW_VERSION = "aisb-build-plan-preview-v1";
const PROVIDER_FILE_PLAN_PREVIEW_VERSION = "aisb-build-plan-preview-v3";
const LOCAL_FILE_PLAN_PREVIEW_VERSION = "aisb-build-plan-preview-v2";
const LOCAL_DATASET_PLAN_PREVIEW_VERSION = "aisb-build-plan-preview-v4";
const DATASET_RESULT_PLAN_PREVIEW_VERSION = "aisb-build-plan-preview-v5";
const CONTEXT_PACK_PLAN_PREVIEW_VERSION = "aisb-build-plan-preview-v6";
const CONTEXT_RAG_PLAN_PREVIEW_VERSION = "aisb-build-plan-preview-v7";
const CONTEXT_RESULT_PLAN_PREVIEW_VERSION = "aisb-build-plan-preview-v8";
const CONTEXT_REBUILD_PLAN_PREVIEW_VERSION = "aisb-build-plan-preview-v9";
const CONTEXT_QUERY_PLAN_PREVIEW_VERSION = "aisb-build-plan-preview-v10";
const MODEL_DOWNLOAD_PLAN_PREVIEW_VERSION = "aisb-build-plan-preview-v11";
const proposalFields = ["operation", "idempotencyKey", "name", "templateId", "systemId",
  "baseRecordRevision", "baseRevisionId", "description", "taskId", "fileId", "taskRevision", "sources", "recipe", "split", "qualityPreset",
  "reportFingerprint", "outputBaseName", "settings", "rebuildOf", "reference", "queryDigest", "modelRecordId", "modelUpdatedAt", "maximumResults", "embeddingDevice",
  "sourceManifest", "allowedOrigins", "maximumDurationSeconds", "inferenceMode"];

/** A decoded request carries data only. The running host supplies and checks identity. */
export function parseHeadlessSystemManagementRequest(value: unknown, host: HeadlessHostIncarnationId):
  { readonly ok: true; readonly request: HeadlessSystemManagementRequest } |
  { readonly ok: false; readonly code: "headless.invalid-request" | "headless.host-changed" | "headless.unsupported-version" } {
  try {
    const { version, operation, input: rawInput } = readStrictPassiveRecord(
      copyBoundedPassiveData(value), ["version", "operation", "input"],
    );
    if (typeof version !== "string" || !isHeadlessHostIncarnationId(host)) return invalid;
    if (version !== HEADLESS_CONTRACT_VERSION) return { ok: false, code: "headless.unsupported-version" };
    if (operation !== "systems.create" && operation !== "systems.rename" && operation !== "systems.clone") return invalid;
    const input = readStrictPassiveRecord(rawInput, operation === "systems.create" ? [...commonFields, "templateId"]
      : operation === "systems.rename" ? [...savedFields, "description"] : savedFields);
    const { hostIncarnationId, workspaceId, idempotencyKey, name } = input;
    if (!isHeadlessHostIncarnationId(hostIncarnationId) || !isWorkspaceId(workspaceId) ||
        !isHeadlessHostIncarnationId(idempotencyKey) || !boundedText(name, 120)) return invalid;
    const common = { hostIncarnationId, workspaceId, idempotencyKey, name };
    let request: HeadlessSystemManagementRequest;
    if (operation === "systems.create") {
      if (typeof input.templateId !== "string" || input.templateId.length > 128) return invalid;
      const templateId = normalizeSystemBuilderTemplateId(input.templateId);
      if (templateId !== input.templateId) return invalid;
      request = { version, operation, input: { ...common, templateId } };
    } else {
      const { systemId, baseRecordRevision, baseRevisionId: rawRevision } = input;
      if (!isSystemBuilderSystemId(systemId) || typeof baseRecordRevision !== "number" ||
          !Number.isSafeInteger(baseRecordRevision) || baseRecordRevision <= 0 || !boundedText(rawRevision, 160)) return invalid;
      const baseRevisionId = normalizeSystemBuilderRevisionId(rawRevision);
      const saved = { ...common, systemId, baseRecordRevision, baseRevisionId };
      if (operation === "systems.clone") request = { version, operation, input: saved };
      else {
        const { description } = input;
        if (description !== undefined && !boundedText(description, 1_000, true)) return invalid;
        request = { version, operation, input: { ...saved, ...(description !== undefined ? { description } : {}) } };
      }
    }
    return hostIncarnationId === host ? { ok: true, request } : { ok: false, code: "headless.host-changed" };
  } catch {
    return invalid;
  }
}

function boundedText(value: unknown, limit: number, allowLineBreaks = false): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= limit && value === value.trim() &&
    !(allowLineBreaks ? /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/ : /[\u0000-\u001f\u007f]/).test(value) &&
    !hasKnownPassiveCredential(value);
}

function projectSystemPlanStep({ operation, input: { hostIncarnationId: _host, workspaceId: _workspace, ...input } }:
  HeadlessSystemManagementRequest) {
  return { operation, input, effect: "saved-system-write" as const, externalProviderCalls: 0 as const };
}

function projectLocalFilePlanStep({ operation, input: { hostIncarnationId: _host, workspaceId: _workspace, ...input } }:
  HeadlessLocalFileSavePlanRequest) {
  return { operation, input, effect: "save-local-source" as const, externalProviderCalls: 0 as const };
}

function projectProviderFilePlanStep({ operation, input: { hostIncarnationId: _host, workspaceId: _workspace, ...input } }:
  HeadlessProviderFileSavePlanRequest) {
  return { operation, input, effect: "save-provider-source" as const, externalProviderCalls: "required" as const };
}

function projectLocalDatasetPlanStep({operation, input: {hostIncarnationId: _host, workspaceId: _workspace, ...input}}:
  HeadlessLocalDatasetPlanRequest) {
  return {operation, input, effect: "prepare-local-dataset" as const, externalProviderCalls: 0 as const, modelCalls: 0 as const,
    maximumSourceBytes: HEADLESS_DATASET_MAX_SOURCE_BYTES, maximumTotalBytes: HEADLESS_DATASET_MAX_TOTAL_BYTES,
    maximumRowsPerSource: HEADLESS_DATASET_MAX_ROWS_PER_SOURCE, outputFormat: "jsonl" as const, reviewRequired: true as const};
}

function projectDatasetResultPlanStep({operation, input: {hostIncarnationId: _host, workspaceId: _workspace, ...input}}:
  HeadlessDatasetResultSavePlanRequest) {
  return {operation, input, effect: "save-prepared-dataset" as const, externalProviderCalls: 0 as const,
    modelCalls: 0 as const, outputFormat: "jsonl" as const, immutableVersion: true as const};
}

function projectContextPackPlanStep({operation, input: {hostIncarnationId: _host, workspaceId: _workspace, ...input}}:
  HeadlessContextPackPlanRequest) {
  return {operation, input, effect: "generate-context-pack" as const, externalProviderCalls: 0 as const, modelCalls: 0 as const,
    maximumSources: HEADLESS_CONTEXT_MAX_SOURCES, maximumSourceBytes: HEADLESS_CONTEXT_MAX_SOURCE_BYTES,
    maximumTotalBytes: HEADLESS_CONTEXT_MAX_SOURCES * HEADLESS_CONTEXT_MAX_SOURCE_BYTES,
    maximumChunks: 1000 as const, reviewRequired: true as const, explicitSaveRequired: true as const};
}

function projectContextRagPlanStep({operation, input: {hostIncarnationId: _host, workspaceId: _workspace, ...input}}:
  HeadlessContextRagPlanRequest) {
  return {operation, input, effect: "generate-rag-database" as const, externalProviderCalls: 0 as const, modelCalls: "required" as const,
    maximumSources: HEADLESS_CONTEXT_MAX_SOURCES, maximumSourceBytes: HEADLESS_CONTEXT_MAX_SOURCE_BYTES,
    maximumTotalBytes: HEADLESS_CONTEXT_MAX_SOURCES * HEADLESS_CONTEXT_MAX_SOURCE_BYTES,
    maximumChunks: 1000 as const, reviewRequired: true as const, explicitSaveRequired: true as const};
}

function projectContextResultPlanStep({operation, input: {hostIncarnationId: _host, workspaceId: _workspace, ...input}}:
  HeadlessContextResultSavePlanRequest) {
  return {operation, input, effect: "save-reviewed-context" as const, externalProviderCalls: 0 as const, modelCalls: 0 as const,
    maximumArtifactBytes: CONTEXT_GENERATION_LIMITS.maximumArtifactBytes, exactReviewRequired: true as const};
}
function projectContextQueryPlanStep({operation, input: {hostIncarnationId: _host, workspaceId: _workspace, ...input}}:
  HeadlessContextQueryPlanRequest) {
  return {operation, input, effect: "query-saved-context" as const, externalProviderCalls: 0 as const, modelCalls: "required" as const,
    maximumArtifactBytes: CONTEXT_GENERATION_LIMITS.maximumArtifactBytes, maximumQueryCharacters: HEADLESS_CONTEXT_QUERY_MAX_CHARACTERS,
    outputFormat: "citation-summary" as const, writesSavedData: false as const};
}
function projectBuildPlanStep(request: PreQueryBuildPlanRequest) {
  return request.operation === "context.save-result" ? projectContextResultPlanStep(request)
    : request.operation === "context.generate-rag" ? projectContextRagPlanStep(request)
      : request.operation === "context.generate-pack" ? projectContextPackPlanStep(request)
        : request.operation === "data.save-prepared-dataset" ? projectDatasetResultPlanStep(request)
          : request.operation === "data.prepare-local-dataset" ? projectLocalDatasetPlanStep(request)
            : request.operation === "data.save-provider-source" ? projectProviderFilePlanStep(request)
              : request.operation === "data.save-local-source" ? projectLocalFilePlanStep(request) : projectSystemPlanStep(request);
}

function projectModelDownloadPlanStep({operation, input: {hostIncarnationId: _host, workspaceId: _workspace, ...input}}:
  HeadlessModelDownloadPlanRequest) {
  return {operation, input, effect: "download-model-files" as const, externalProviderCalls: "required" as const, modelCalls: 0 as const,
    maximumTotalBytes: input.sourceManifest.source.totalBytes, temporaryStorageEstimateBytes: input.sourceManifest.source.totalBytes * 2,
    maximumDurationSeconds: input.maximumDurationSeconds, explicitSaveRequired: true as const, loadsModel: false as const,
    writesModelRegistry: false as const, fileTransferAccess: "public-without-credentials" as const};
}
function projectAnyBuildPlanStep(request: HeadlessBuildPlanRequest) {
  return request.operation === "models.download" ? projectModelDownloadPlanStep(request) : request.operation === "context.query"
    ? projectContextQueryPlanStep(request) : projectBuildPlanStep(request);
}

type PlanScope = { readonly hostIncarnationId: HeadlessHostIncarnationId; readonly workspaceId: WorkspaceId };
type PlanPreview<V, Step> = PlanScope & {
  readonly version: V;
  readonly approval: "required";
  readonly steps: readonly Step[];
};
type SystemStep = ReturnType<typeof projectSystemPlanStep>;
type LocalFileStep = ReturnType<typeof projectLocalFilePlanStep>;
type ProviderFileStep = ReturnType<typeof projectProviderFilePlanStep>;
type LocalDatasetStep = ReturnType<typeof projectLocalDatasetPlanStep>;
type DatasetResultStep = ReturnType<typeof projectDatasetResultPlanStep>;
type ContextPackStep = ReturnType<typeof projectContextPackPlanStep>;
type ContextRagStep = ReturnType<typeof projectContextRagPlanStep>;
type SystemPreview = PlanPreview<typeof PLAN_PREVIEW_VERSION, SystemStep>;
type MixedPreview = PlanPreview<typeof LOCAL_FILE_PLAN_PREVIEW_VERSION, SystemStep | LocalFileStep> |
  PlanPreview<typeof PROVIDER_FILE_PLAN_PREVIEW_VERSION, SystemStep | LocalFileStep | ProviderFileStep> |
  PlanPreview<typeof LOCAL_DATASET_PLAN_PREVIEW_VERSION, SystemStep | LocalFileStep | ProviderFileStep | LocalDatasetStep> |
  PlanPreview<typeof DATASET_RESULT_PLAN_PREVIEW_VERSION, SystemStep | LocalFileStep | ProviderFileStep | LocalDatasetStep | DatasetResultStep> |
  PlanPreview<typeof CONTEXT_PACK_PLAN_PREVIEW_VERSION, SystemStep | LocalFileStep | ProviderFileStep | LocalDatasetStep | DatasetResultStep | ContextPackStep> |
  PlanPreview<typeof CONTEXT_RAG_PLAN_PREVIEW_VERSION, SystemStep | LocalFileStep | ProviderFileStep | LocalDatasetStep | DatasetResultStep | ContextPackStep | ContextRagStep> |
  PlanPreview<typeof CONTEXT_RESULT_PLAN_PREVIEW_VERSION, ReturnType<typeof projectBuildPlanStep>> |
  PlanPreview<typeof CONTEXT_REBUILD_PLAN_PREVIEW_VERSION, ReturnType<typeof projectBuildPlanStep>> |
  PlanPreview<typeof CONTEXT_QUERY_PLAN_PREVIEW_VERSION, ReturnType<typeof projectBuildPlanStep> | ReturnType<typeof projectContextQueryPlanStep>> |
  PlanPreview<typeof MODEL_DOWNLOAD_PLAN_PREVIEW_VERSION, ReturnType<typeof projectAnyBuildPlanStep>>;
type PlanSuccess<Request, Preview> = { readonly ok: true; readonly scope: PlanScope; readonly requests: readonly Request[];
  readonly preview: Preview };
type PlanFailure = typeof invalid | { readonly ok: false; readonly code: "headless.host-changed" };
type SystemProposal = PlanSuccess<HeadlessSystemManagementRequest, SystemPreview>;
type MixedProposal = PlanSuccess<HeadlessBuildPlanRequest, MixedPreview>;

/** Interpret passive proposals. A host must opt in to the exact local-file effect it can enforce. */
export function parseHeadlessBuildPlanProposal(value: unknown, host: HeadlessHostIncarnationId): SystemProposal | PlanFailure;
export function parseHeadlessBuildPlanProposal(value: unknown, host: HeadlessHostIncarnationId,
  options: HeadlessBuildPlanCapabilities): SystemProposal | MixedProposal | PlanFailure;
export function parseHeadlessBuildPlanProposal(value: unknown, host: HeadlessHostIncarnationId,
  options?: HeadlessBuildPlanCapabilities): SystemProposal | MixedProposal | PlanFailure {
  try {
    const { hostIncarnationId, workspaceId, steps } = readStrictPassiveRecord(
      copyBoundedPassiveData(value), ["hostIncarnationId", "workspaceId", "steps"],
    );
    if (!isHeadlessHostIncarnationId(host) || !isHeadlessHostIncarnationId(hostIncarnationId) ||
        !isWorkspaceId(workspaceId) || !Array.isArray(steps) ||
        steps.length === 0 || steps.length > HEADLESS_MAX_BUILD_PLAN_STEPS) return invalid;
    if (hostIncarnationId !== host) return { ok: false, code: "headless.host-changed" } as const;
    const scope = { hostIncarnationId, workspaceId };
    const proposed: HeadlessBuildPlanRequest[] = [];
    const keys = new Set<string>();
    const renamedSystems = new Set<SystemBuilderSystemId>();
    const selectedUploads = new Set<string>();
    const datasetSources = new Set<string>();
    const savedDatasets = new Set<string>();
    const savedContexts = new Set<string>();
    const selectedModels = new Set<string>();
    for (const step of steps) {
      const { operation, ...fields } = readStrictPassiveRecord(step, proposalFields);
      const input = { version: HEADLESS_CONTRACT_VERSION, operation, input: { ...scope, ...fields } };
      const decoded = operation === "models.download" && options?.allowModelDownload
        ? readHeadlessModelDownloadPlanRequest(input, host)
        : operation === "data.save-local-source" && options?.allowLocalFileSave
        ? readHeadlessLocalFileSavePlanRequest(input, host)
        : operation === "data.save-provider-source" && options?.allowProviderFileSave
          ? readHeadlessProviderFileSavePlanRequest(input, host)
          : operation === "data.prepare-local-dataset" && options?.allowLocalDatasetPreparation
            ? readHeadlessLocalDatasetPlanRequest(input, host)
            : operation === "data.save-prepared-dataset" && options?.allowDatasetResultSave
              ? readHeadlessDatasetResultSavePlanRequest(input, host)
              : operation === "context.query" && options?.allowContextQuery
                ? readHeadlessContextQueryPlanRequest(input, host)
              : operation === "context.save-result" && options?.allowContextResultSave
                ? readHeadlessContextResultSavePlanRequest(input, host)
              : ((operation === "context.generate-pack" && options?.allowContextPackGeneration) ||
                 (operation === "context.generate-rag" && options?.allowContextRagGeneration))
                ? readHeadlessContextGenerationPlanRequest(input, host)
              : parseHeadlessSystemManagementRequest(input, host);
      if (!decoded.ok) return invalid;
      const request = decoded.request;
      if (keys.has(request.input.idempotencyKey)) return invalid;
      keys.add(request.input.idempotencyKey);
      if (request.operation === "data.save-local-source" || request.operation === "data.save-provider-source") {
        // Saving an item advances the shared upload revision. A later step
        // must start from the new revision and a new app selection.
        if (selectedUploads.has(request.input.taskId) || datasetSources.has(request.input.taskId)) return invalid;
        selectedUploads.add(request.input.taskId);
      } else if (request.operation === "data.prepare-local-dataset") {
        // Concrete source revisions must already exist. This plan does not
        // guess a mutable revision produced by an earlier source-save step.
        for (const source of request.input.sources) {
          if (selectedUploads.has(source.taskId)) return invalid;
          datasetSources.add(source.taskId);
        }
      } else if (request.operation === "context.generate-pack" || request.operation === "context.generate-rag") {
        for (const source of request.input.sources) if (source.kind === "ingestion-file") {
          if (selectedUploads.has(source.taskId)) return invalid;
          datasetSources.add(source.taskId);
        }
      } else if (request.operation === "data.save-prepared-dataset") {
        if (savedDatasets.has(request.input.taskId)) return invalid;
        savedDatasets.add(request.input.taskId);
      } else if (request.operation === "context.save-result") {
        if (savedContexts.has(request.input.taskId)) return invalid;
        savedContexts.add(request.input.taskId);
      } else if (request.operation === "models.download") {
        const selected = request.input.sourceManifest.source;
        const key = selected.modelId + "@" + selected.revision;
        if (selectedModels.has(key)) return invalid;
        selectedModels.add(key);
      } else if (request.operation !== "systems.create" && request.operation !== "context.query") {
        // A saved revision cannot be reused after a previous change to that system.
        if (renamedSystems.has(request.input.systemId)) return invalid;
        if (request.operation === "systems.rename") renamedSystems.add(request.input.systemId);
      }
      proposed.push(request);
    }
    const previewScope = { ...scope, approval: "required" as const };
    if (selectedModels.size) return {ok: true, scope, requests: proposed,
      preview: {version: MODEL_DOWNLOAD_PLAN_PREVIEW_VERSION, ...previewScope, steps: proposed.map(projectAnyBuildPlanStep)}};
    const preModelRequests = proposed.filter((request): request is PreModelBuildPlanRequest => request.operation !== "models.download");
    if (preModelRequests.some(request => request.operation === "context.query")) return {ok: true, scope, requests: preModelRequests,
      preview: {version: CONTEXT_QUERY_PLAN_PREVIEW_VERSION, ...previewScope,
        steps: preModelRequests.map(request => request.operation === "context.query" ? projectContextQueryPlanStep(request) : projectBuildPlanStep(request))}};
    const allRequests = preModelRequests.filter((request): request is PreQueryBuildPlanRequest => request.operation !== "context.query");
    if (allRequests.some(request => (request.operation === "context.generate-pack" || request.operation === "context.generate-rag") && request.input.rebuildOf))
      return {ok: true, scope, requests: allRequests, preview: {version: CONTEXT_REBUILD_PLAN_PREVIEW_VERSION,
        ...previewScope, steps: allRequests.map(projectBuildPlanStep)}};
    if (savedContexts.size) return {ok: true, scope, requests: allRequests, preview: {version: CONTEXT_RESULT_PLAN_PREVIEW_VERSION,
      ...previewScope, steps: allRequests.map(projectBuildPlanStep)}};
    const requests = allRequests.filter((request): request is PreContextResultBuildPlanRequest => request.operation !== "context.save-result");
    if (requests.some(request => request.operation === "context.generate-rag")) return {ok: true, scope, requests,
      preview: {version: CONTEXT_RAG_PLAN_PREVIEW_VERSION, ...previewScope,
        steps: requests.map(request => request.operation === "context.generate-rag" ? projectContextRagPlanStep(request)
          : request.operation === "context.generate-pack" ? projectContextPackPlanStep(request)
            : request.operation === "data.save-prepared-dataset" ? projectDatasetResultPlanStep(request)
              : request.operation === "data.prepare-local-dataset" ? projectLocalDatasetPlanStep(request)
                : request.operation === "data.save-provider-source" ? projectProviderFilePlanStep(request)
                  : request.operation === "data.save-local-source" ? projectLocalFilePlanStep(request) : projectSystemPlanStep(request))}};
    const packRequests = requests.filter((request): request is Exclude<PreContextResultBuildPlanRequest, HeadlessContextRagPlanRequest> =>
      request.operation !== "context.generate-rag");
    if (packRequests.some(request => request.operation === "context.generate-pack")) return {ok: true, scope, requests: packRequests,
      preview: {version: CONTEXT_PACK_PLAN_PREVIEW_VERSION, ...previewScope,
        steps: packRequests.map(request => request.operation === "context.generate-pack" ? projectContextPackPlanStep(request)
          : request.operation === "data.save-prepared-dataset" ? projectDatasetResultPlanStep(request)
            : request.operation === "data.prepare-local-dataset" ? projectLocalDatasetPlanStep(request)
              : request.operation === "data.save-provider-source" ? projectProviderFilePlanStep(request)
                : request.operation === "data.save-local-source" ? projectLocalFilePlanStep(request) : projectSystemPlanStep(request))}};
    const legacyRequests = packRequests.filter((request): request is LegacyBuildPlanRequest => request.operation !== "context.generate-pack");
    if (savedDatasets.size) return {ok: true, scope, requests: legacyRequests, preview: {version: DATASET_RESULT_PLAN_PREVIEW_VERSION, ...previewScope,
      steps: legacyRequests.map(request => request.operation === "data.save-prepared-dataset" ? projectDatasetResultPlanStep(request)
        : request.operation === "data.prepare-local-dataset" ? projectLocalDatasetPlanStep(request)
          : request.operation === "data.save-provider-source" ? projectProviderFilePlanStep(request)
            : request.operation === "data.save-local-source" ? projectLocalFilePlanStep(request) : projectSystemPlanStep(request))}};
    const olderRequests = legacyRequests.filter((request): request is Exclude<LegacyBuildPlanRequest, HeadlessDatasetResultSavePlanRequest> =>
      request.operation !== "data.save-prepared-dataset");
    if (olderRequests.some(request => request.operation === "data.prepare-local-dataset")) return {ok: true, scope, requests: olderRequests, preview: {
      version: LOCAL_DATASET_PLAN_PREVIEW_VERSION, ...previewScope,
      steps: olderRequests.map(request => request.operation === "data.prepare-local-dataset" ? projectLocalDatasetPlanStep(request)
        : request.operation === "data.save-provider-source" ? projectProviderFilePlanStep(request)
          : request.operation === "data.save-local-source" ? projectLocalFilePlanStep(request) : projectSystemPlanStep(request)),
    }};
    const priorRequests = olderRequests.filter((request): request is Exclude<LegacyBuildPlanRequest, HeadlessLocalDatasetPlanRequest | HeadlessDatasetResultSavePlanRequest> =>
      request.operation !== "data.prepare-local-dataset");
    if (priorRequests.some(request => request.operation === "data.save-provider-source")) return { ok: true, scope, requests: priorRequests, preview: {
      version: PROVIDER_FILE_PLAN_PREVIEW_VERSION, ...previewScope,
      steps: priorRequests.map(request => request.operation === "data.save-provider-source" ? projectProviderFilePlanStep(request)
        : request.operation === "data.save-local-source" ? projectLocalFilePlanStep(request) : projectSystemPlanStep(request)),
    } };
    const localRequests = priorRequests.filter((request): request is HeadlessSystemManagementRequest | HeadlessLocalFileSavePlanRequest =>
      request.operation !== "data.save-provider-source");
    if (selectedUploads.size) return { ok: true, scope, requests: localRequests, preview: {
      version: LOCAL_FILE_PLAN_PREVIEW_VERSION, ...previewScope,
      steps: localRequests.map(request => request.operation === "data.save-local-source"
        ? projectLocalFilePlanStep(request) : projectSystemPlanStep(request)),
    } };
    const systems = priorRequests.filter((request): request is HeadlessSystemManagementRequest =>
      request.operation !== "data.save-local-source" && request.operation !== "data.save-provider-source");
    return { ok: true, scope, requests: systems, preview: {
      version: PLAN_PREVIEW_VERSION, ...previewScope, steps: systems.map(projectSystemPlanStep),
    } };
  } catch {
    return invalid;
  }
}
