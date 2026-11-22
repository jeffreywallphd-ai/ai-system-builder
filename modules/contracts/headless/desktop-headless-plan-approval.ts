import { copyBoundedPassiveData, readStrictPassiveRecord } from "../shared";
import { isWorkspaceId, type WorkspaceId } from "../workspace";
import { isDesktopHeadlessClientId, isDesktopHeadlessFingerprint } from "./desktop-headless-pairing";
import { HEADLESS_CONTRACT_VERSION, isHeadlessHostIncarnationId } from "./headless-read-request";
import {readHeadlessModelDownloadPlanRequest, readHeadlessModelReferenceSavePlanRequest} from "./headless-model-download-plan";
import {readHeadlessModelTrainingPlanRequest} from "./headless-model-training-plan";
import { readHeadlessPlanReviewAgentResult, readHeadlessPlanReviewDecisionChoice,
  type HeadlessPlanReviewAgentResult, type HeadlessPlanReviewDecisionChoice } from "./headless-plan-review-wire";
import { HEADLESS_MAX_BUILD_PLAN_STEPS, parseHeadlessBuildPlanProposal, type HeadlessBuildPlanCapabilities } from "./headless-system-management";
import {HEADLESS_CONTEXT_QUERY_MAX_CHARACTERS} from "./headless-context-query-preview";
import {CONTEXT_GENERATION_LIMITS} from "../context-management";
import {HEADLESS_DATASET_MAX_SOURCE_BYTES, HEADLESS_DATASET_MAX_TOTAL_BYTES, HEADLESS_DATASET_MAX_ROWS_PER_SOURCE} from "./headless-dataset-preparation";
import {HEADLESS_CONTEXT_MAX_SOURCE_BYTES, HEADLESS_CONTEXT_MAX_SOURCES} from "./headless-context-preview";

export const DESKTOP_HEADLESS_PLAN_APPROVAL_CHANNELS = Object.freeze({
  list: "desktop.headless.plan-approvals.list",
  open: "desktop.headless.plan-approvals.open",
  dismiss: "desktop.headless.plan-approvals.dismiss",
  decide: "desktop.headless.plan-approvals.decide",
});
export const DESKTOP_HEADLESS_PLAN_CHAT_CHANNELS = Object.freeze({
  open: "desktop.headless.plan-chat.open",
  dismiss: "desktop.headless.plan-chat.dismiss",
  decide: "desktop.headless.plan-chat.decide",
});

export interface DesktopPlanApprovalSelection {
  readonly workspaceId: WorkspaceId;
  readonly registeredClientId: string;
  readonly fingerprint: string;
}

export interface DesktopPlanApprovalDecision {
  readonly selection: DesktopPlanApprovalSelection;
  readonly viewId: string;
  readonly expectedRevision: number;
  readonly decision: HeadlessPlanReviewDecisionChoice;
}

export interface DesktopPlanApprovalListEntry extends DesktopPlanApprovalSelection {
  readonly expiresAt: number;
}

type PlanPreview = Extract<ReturnType<typeof parseHeadlessBuildPlanProposal>, { ok: true }>["preview"];
type PlanState = Extract<HeadlessPlanReviewAgentResult, { ok: true }>["value"];
export interface DesktopPlanApprovalView {
  readonly selection: DesktopPlanApprovalSelection;
  readonly viewId: string;
  readonly preview: PlanPreview;
  readonly state: PlanState;
}

export function sameDesktopPlanApproval(left: DesktopPlanApprovalSelection, right: DesktopPlanApprovalSelection) {
  return left.workspaceId === right.workspaceId && left.registeredClientId === right.registeredClientId &&
    left.fingerprint === right.fingerprint;
}

export function readDesktopPlanApprovalSelection(value: unknown): DesktopPlanApprovalSelection | undefined {
  try {
    const { workspaceId, registeredClientId, fingerprint } =
      readStrictPassiveRecord(value, ["workspaceId", "registeredClientId", "fingerprint"]);
    if (isWorkspaceId(workspaceId) && isDesktopHeadlessClientId(registeredClientId) && isDesktopHeadlessFingerprint(fingerprint))
      return { workspaceId, registeredClientId, fingerprint };
  } catch { return undefined; }
}

export function readDesktopPlanApprovalDecision(value: unknown): DesktopPlanApprovalDecision | undefined {
  try {
    const { selection: target, viewId, expectedRevision, decision } =
      readStrictPassiveRecord(copyBoundedPassiveData(value), ["selection", "viewId", "expectedRevision", "decision"]);
    const selection = readDesktopPlanApprovalSelection(target);
    if (!selection || !isDesktopHeadlessClientId(viewId) || !positiveInteger(expectedRevision)) return;
    const choice = readHeadlessPlanReviewDecisionChoice(decision);
    if (choice) return { selection, viewId, expectedRevision, decision: choice };
  } catch { return undefined; }
}

export function readDesktopPlanApprovalList(value: unknown, workspaceId: WorkspaceId):
  readonly DesktopPlanApprovalListEntry[] | undefined {
  try {
    const entries = copyBoundedPassiveData(value);
    if (!Array.isArray(entries) || entries.length > 32) return;
    const list = entries.map(row => {
      const { expiresAt, ...rawSelection } = readStrictPassiveRecord(row,
        ["workspaceId", "registeredClientId", "fingerprint", "expiresAt"]);
      const selection = readDesktopPlanApprovalSelection(rawSelection);
      if (!selection || selection.workspaceId !== workspaceId || !positiveInteger(expiresAt))
        throw new Error("Invalid approval reference.");
      return { ...selection, expiresAt };
    });
    if (new Set(list.map(entry => JSON.stringify([entry.registeredClientId, entry.fingerprint]))).size === list.length)
      return list;
  } catch { return undefined; }
}

export function readDesktopPlanApprovalView(value: unknown, selection: DesktopPlanApprovalSelection,
  options: HeadlessBuildPlanCapabilities = { allowLocalFileSave: true, allowProviderFileSave: true, allowLocalDatasetPreparation: true,
    allowDatasetResultSave: true, allowContextPackGeneration: true, allowContextRagGeneration: true, allowContextResultSave: true,
    allowContextQuery: true }): DesktopPlanApprovalView | undefined {
  try {
    const raw = readStrictPassiveRecord(copyBoundedPassiveData(value), ["selection", "viewId", "preview", "state"]);
    const actual = readDesktopPlanApprovalSelection(raw.selection);
    if (!actual || !sameDesktopPlanApproval(actual, selection) || !isDesktopHeadlessClientId(raw.viewId)) return;
    const { version, hostIncarnationId, workspaceId, approval, steps } = readStrictPassiveRecord(raw.preview,
      ["version", "hostIncarnationId", "workspaceId", "approval", "steps"]);
    if (workspaceId !== selection.workspaceId || approval !== "required" ||
        !isHeadlessHostIncarnationId(hostIncarnationId) || !Array.isArray(steps) ||
        steps.length < 1 || steps.length > HEADLESS_MAX_BUILD_PLAN_STEPS) return;
    const decoded = parseHeadlessBuildPlanProposal({ hostIncarnationId, workspaceId, steps: steps.map(step => {
      const { operation, input, effect, externalProviderCalls, ...limits } = readStrictPassiveRecord(step,
        ["operation", "input", "effect", "externalProviderCalls", "modelCalls", "maximumSourceBytes", "maximumTotalBytes",
          "maximumRowsPerSource", "outputFormat", "reviewRequired", "immutableVersion", "maximumSources", "maximumChunks",
          "explicitSaveRequired", "maximumArtifactBytes", "exactReviewRequired", "maximumQueryCharacters", "writesSavedData",
          "temporaryStorageEstimateBytes", "maximumDurationSeconds", "loadsModel", "writesModelRegistry", "fileTransferAccess",
          "storageAuthority", "runtimeReadiness", "resourceAdmission"]);
      const dataset = operation === "data.prepare-local-dataset";
      const resultSave = operation === "data.save-prepared-dataset";
      const contextPack = operation === "context.generate-pack";
      const contextRag = operation === "context.generate-rag";
      const contextSave = operation === "context.save-result";
      const contextQuery = operation === "context.query";
      const modelDownload = operation === "models.download";
      const modelSaving = operation === "models.save-download";
      const modelTraining = operation === "models.train";
      const training = modelTraining ? readHeadlessModelTrainingPlanRequest({version: HEADLESS_CONTRACT_VERSION, operation,
        input: {...readStrictPassiveRecord(input, ["idempotencyKey", "name", "model", "dataset", "training"]),
          hostIncarnationId, workspaceId}}, hostIncarnationId) : undefined;
      const savedModel = modelSaving ? readHeadlessModelReferenceSavePlanRequest({version: HEADLESS_CONTRACT_VERSION, operation,
        input: {...readStrictPassiveRecord(input, ["idempotencyKey", "name", "taskId", "sourceManifest"]), hostIncarnationId, workspaceId}}, hostIncarnationId) : undefined;
      const model = modelDownload ? readHeadlessModelDownloadPlanRequest({version: HEADLESS_CONTRACT_VERSION, operation,
        input: {...readStrictPassiveRecord(input, ["idempotencyKey", "name", "sourceManifest", "allowedOrigins", "maximumDurationSeconds", "inferenceMode"]),
          hostIncarnationId, workspaceId}}, hostIncarnationId) : undefined;
      const contextGeneration = contextPack || contextRag;
      if (modelTraining ? !training?.ok || !exactLimitFields(limits,
          ["modelCalls", "loadsModel", "writesModelRegistry", "explicitSaveRequired", "runtimeReadiness", "resourceAdmission"]) ||
          limits.modelCalls !== "required" || limits.loadsModel !== true || limits.writesModelRegistry !== false ||
          limits.explicitSaveRequired !== true || limits.runtimeReadiness !== "not-checked" || limits.resourceAdmission !== "not-checked" :
          modelSaving ? !savedModel?.ok || !exactLimitFields(limits,
          ["modelCalls", "loadsModel", "writesModelRegistry", "storageAuthority", "runtimeReadiness", "exactReviewRequired"]) ||
          limits.modelCalls !== 0 || limits.loadsModel !== false || limits.writesModelRegistry !== true ||
          limits.storageAuthority !== "reference-only" || limits.runtimeReadiness !== "not-checked" || limits.exactReviewRequired !== true :
          modelDownload ? !model?.ok || !exactLimitFields(limits, ["modelCalls", "maximumTotalBytes", "temporaryStorageEstimateBytes",
          "maximumDurationSeconds", "explicitSaveRequired", "loadsModel", "writesModelRegistry", "fileTransferAccess"]) || limits.modelCalls !== 0 ||
          limits.maximumTotalBytes !== model.request.input.sourceManifest.source.totalBytes ||
          limits.temporaryStorageEstimateBytes !== model.request.input.sourceManifest.source.totalBytes * 2 ||
          limits.maximumDurationSeconds !== model.request.input.maximumDurationSeconds || limits.explicitSaveRequired !== true ||
          limits.loadsModel !== false || limits.writesModelRegistry !== false || limits.fileTransferAccess !== "public-without-credentials" :
          contextQuery ? !exactLimitFields(limits, ["modelCalls", "maximumArtifactBytes", "maximumQueryCharacters", "outputFormat", "writesSavedData"]) ||
          limits.modelCalls !== "required" || limits.maximumArtifactBytes !== CONTEXT_GENERATION_LIMITS.maximumArtifactBytes ||
          limits.maximumQueryCharacters !== HEADLESS_CONTEXT_QUERY_MAX_CHARACTERS || limits.outputFormat !== "citation-summary" || limits.writesSavedData !== false :
          contextSave ? !exactLimitFields(limits, ["modelCalls", "maximumArtifactBytes", "exactReviewRequired"]) ||
          limits.modelCalls !== 0 || limits.maximumArtifactBytes !== CONTEXT_GENERATION_LIMITS.maximumArtifactBytes || limits.exactReviewRequired !== true :
          contextGeneration ? !exactLimitFields(limits, ["modelCalls", "maximumSources", "maximumSourceBytes", "maximumTotalBytes",
          "maximumChunks", "reviewRequired", "explicitSaveRequired"]) || limits.modelCalls !== (contextRag ? "required" : 0) ||
          limits.maximumSources !== HEADLESS_CONTEXT_MAX_SOURCES || limits.maximumSourceBytes !== HEADLESS_CONTEXT_MAX_SOURCE_BYTES ||
          limits.maximumTotalBytes !== HEADLESS_CONTEXT_MAX_SOURCES * HEADLESS_CONTEXT_MAX_SOURCE_BYTES ||
          limits.maximumChunks !== 1000 || limits.reviewRequired !== true || limits.explicitSaveRequired !== true : dataset ?
          !exactLimitFields(limits, ["modelCalls", "maximumSourceBytes", "maximumTotalBytes", "maximumRowsPerSource", "outputFormat", "reviewRequired"]) ||
          limits.modelCalls !== 0 || limits.maximumSourceBytes !== HEADLESS_DATASET_MAX_SOURCE_BYTES ||
          limits.maximumTotalBytes !== HEADLESS_DATASET_MAX_TOTAL_BYTES || limits.maximumRowsPerSource !== HEADLESS_DATASET_MAX_ROWS_PER_SOURCE ||
          limits.outputFormat !== "jsonl" || limits.reviewRequired !== true : resultSave ?
          Object.keys(limits).sort().join(",") !== "immutableVersion,modelCalls,outputFormat" || limits.modelCalls !== 0 ||
            limits.outputFormat !== "jsonl" || limits.immutableVersion !== true : Object.keys(limits).length !== 0)
        throw new Error("Invalid processing limits.");
      const providerFile = operation === "data.save-provider-source";
      const savingFile = operation === "data.save-local-source" || providerFile;
      if (effect !== (modelTraining ? "train-local-model" : modelSaving ? "save-reviewed-model-reference" : modelDownload ? "download-model-files" : contextQuery ? "query-saved-context" : contextSave ? "save-reviewed-context" : contextRag ? "generate-rag-database" : contextPack ? "generate-context-pack" : dataset ? "prepare-local-dataset" : resultSave ? "save-prepared-dataset" : providerFile ? "save-provider-source" : savingFile ? "save-local-source" : "saved-system-write") ||
          externalProviderCalls !== (providerFile || modelDownload ? "required" : 0))
        throw new Error("Invalid approval effects.");
      const fields = readStrictPassiveRecord(input, modelTraining ? ["idempotencyKey", "name", "model", "dataset", "training"] :
        modelSaving ? ["idempotencyKey", "name", "taskId", "sourceManifest"] :
        modelDownload ? ["idempotencyKey", "name", "sourceManifest", "allowedOrigins", "maximumDurationSeconds", "inferenceMode"] :
        contextQuery ? ["idempotencyKey", "reference", "queryDigest", "modelRecordId", "modelUpdatedAt", "maximumResults", "embeddingDevice"] :
        contextSave ? ["idempotencyKey", "taskId", "reportFingerprint", "name"] :
        contextGeneration ? ["idempotencyKey", "name", "sources", "settings", "rebuildOf"] :
        dataset ? ["idempotencyKey", "sources", "recipe", "split", "qualityPreset"] :
        resultSave ? ["idempotencyKey", "taskId", "reportFingerprint", "outputBaseName"] :
        savingFile ? ["idempotencyKey", "taskId", "fileId", "taskRevision"] :
        ["idempotencyKey", "name", "templateId", "systemId", "baseRecordRevision", "baseRevisionId", "description"]);
      return { operation, ...fields };
    }) }, hostIncarnationId, options);
    if (!decoded.ok || decoded.preview.version !== version) return;
    const state = readHeadlessPlanReviewAgentResult({ ok: true, value: raw.state }, selection.fingerprint, decoded.requests.length);
    if (state.ok) return { selection: actual, viewId: raw.viewId, preview: decoded.preview, state: state.value };
  } catch { return undefined; }
}

function exactLimitFields(value: Record<string, unknown>, fields: readonly string[]): boolean {
  return Object.keys(value).sort().join(",") === [...fields].sort().join(",");
}

function positiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}
