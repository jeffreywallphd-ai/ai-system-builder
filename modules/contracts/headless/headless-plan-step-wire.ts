import { copyBoundedPassiveData, readStrictPassiveRecord } from "../shared";
import { isWorkspaceId, type WorkspaceId } from "../workspace";
import { isDesktopHeadlessFingerprint } from "./desktop-headless-pairing";
import { readHeadlessAuthoringWireResult, type HeadlessAuthoringWireResult } from "./headless-authoring-result";
import { readHeadlessLocalFileImportRequest, type HeadlessLocalFileImportRequest } from "./headless-data-local-file";
import { HEADLESS_CONTRACT_VERSION, isHeadlessHostIncarnationId, type HeadlessHostIncarnationId } from "./headless-read-request";
import { HEADLESS_MAX_BUILD_PLAN_STEPS, type HeadlessBuildPlanCapabilities } from "./headless-system-management";

export const HEADLESS_PLAN_STEP_PATH = "/aisb-headless/v1/plan-step";
export const MANAGED_HEADLESS_PLAN_STEP_PATH = "/api/headless/agent/plan-step";
export interface HeadlessPlanStepTarget {
  readonly hostIncarnationId: HeadlessHostIncarnationId;
  readonly workspaceId: WorkspaceId;
  readonly fingerprint: string;
  readonly approvalRevision: number;
  readonly step: number;
}
export type HeadlessPlanStepRequest = {
  readonly version: typeof HEADLESS_CONTRACT_VERSION;
  readonly operation: "plan.run-step";
  readonly input: HeadlessPlanStepTarget;
};
type SavedEffect = Extract<Extract<HeadlessAuthoringWireResult, { ok: true }>["value"], { kind: "committed" | "replayed" }>;
type LocalFileReference = Pick<HeadlessLocalFileImportRequest["input"], "workspaceId" | "taskId" | "fileId" | "taskRevision">;
type SavedLocalFileEffect = { readonly kind: "committed" | "replayed"; readonly operation: "data.save-local-source" | "data.save-provider-source";
  readonly reference: LocalFileReference };
type StartedLocalDatasetEffect = {readonly kind: "started" | "replayed"; readonly operation: "data.prepare-local-dataset";
  readonly reference: {readonly workspaceId: WorkspaceId; readonly taskId: string}};
export type HeadlessPlanStepResult = Extract<HeadlessAuthoringWireResult, { ok: false }> |
  { readonly ok: true; readonly value: (SavedEffect | SavedLocalFileEffect | StartedLocalDatasetEffect) & Pick<HeadlessPlanStepTarget, "fingerprint" | "step" | "approvalRevision"> &
    { readonly expiresAt: number } };

const invalid = { ok: false, code: "headless.invalid-request" } as const;
const unavailable = { ok: false, code: "headless.unavailable" } as const;

export function readHeadlessPlanStepRequest(value: unknown, expectedHost: HeadlessHostIncarnationId):
  { readonly ok: true; readonly request: HeadlessPlanStepRequest } |
  { readonly ok: false; readonly code: "headless.invalid-request" | "headless.host-changed" } {
  try {
    const { version, operation, input } = readStrictPassiveRecord(copyBoundedPassiveData(value), ["version", "operation", "input"]);
    if (version !== HEADLESS_CONTRACT_VERSION || operation !== "plan.run-step") return invalid;
    const { hostIncarnationId, workspaceId, fingerprint, approvalRevision, step } = readStrictPassiveRecord(
      input, ["hostIncarnationId", "workspaceId", "fingerprint", "approvalRevision", "step"],
    );
    if (!isHeadlessHostIncarnationId(hostIncarnationId) || !isWorkspaceId(workspaceId) || !isDesktopHeadlessFingerprint(fingerprint) ||
        !strictPositiveInteger(approvalRevision) || !strictPositiveInteger(step) || step > HEADLESS_MAX_BUILD_PLAN_STEPS) return invalid;
    if (hostIncarnationId !== expectedHost) return { ok: false, code: "headless.host-changed" };
    return { ok: true, request: { version, operation, input: { hostIncarnationId, workspaceId, fingerprint, approvalRevision, step } } };
  } catch { return invalid; }
}

export function readHeadlessPlanStepResult(value: unknown, exact: HeadlessPlanStepTarget,
  options?: HeadlessBuildPlanCapabilities): HeadlessPlanStepResult {
  try {
    const raw = readStrictPassiveRecord(copyBoundedPassiveData(value), ["ok", "code", "value"]);
    if (raw.ok === false && !("value" in raw)) {
      const fault = readHeadlessAuthoringWireResult({ ok: false, code: raw.code });
      return fault.ok ? unavailable : fault;
    }
    if (raw.ok !== true || "code" in raw) return unavailable;
    const { fingerprint, step, approvalRevision, expiresAt, kind, reference, ...operationField } = readStrictPassiveRecord(
      raw.value, ["fingerprint", "step", "approvalRevision", "expiresAt", "kind", "reference", "operation"],
    );
    if (fingerprint !== exact.fingerprint || step !== exact.step || approvalRevision !== exact.approvalRevision ||
        !strictPositiveInteger(expiresAt) || (kind !== "committed" && kind !== "replayed" && kind !== "started")) return unavailable;
    if ("operation" in operationField) {
      const operation = operationField.operation;
      if (operation === "data.prepare-local-dataset") {
        if (!options?.allowLocalDatasetPreparation || (kind !== "started" && kind !== "replayed")) return unavailable;
        const fields = readStrictPassiveRecord(reference, ["workspaceId", "taskId"]);
        if (fields.workspaceId !== exact.workspaceId || !isHeadlessHostIncarnationId(fields.taskId)) return unavailable;
        return {ok: true, value: {kind, operation, fingerprint, step, approvalRevision, expiresAt,
          reference: {workspaceId: exact.workspaceId, taskId: fields.taskId}}};
      }
      if (kind === "started") return unavailable;
      if (operation !== "data.save-local-source" && operation !== "data.save-provider-source") return unavailable;
      if ((operation === "data.save-local-source" && !options?.allowLocalFileSave) ||
          (operation === "data.save-provider-source" && !options?.allowProviderFileSave)) return unavailable;
      const fields = readStrictPassiveRecord(reference, ["workspaceId", "taskId", "fileId", "taskRevision"]);
      const parsed = readHeadlessLocalFileImportRequest({ version: HEADLESS_CONTRACT_VERSION,
        operation: "data.prepare-local-file", input: { ...fields, hostIncarnationId: exact.hostIncarnationId },
      }, exact.hostIncarnationId);
      if (!parsed.ok || parsed.request.input.workspaceId !== exact.workspaceId) return unavailable;
      const { workspaceId, taskId, fileId, taskRevision } = parsed.request.input;
      return { ok: true, value: { kind, operation, fingerprint, step, approvalRevision, expiresAt,
        reference: { workspaceId, taskId, fileId, taskRevision } } };
    }
    const receipt = readHeadlessAuthoringWireResult({ ok: true, value: { kind, reference } });
    if (!receipt.ok || (receipt.value.kind !== "committed" && receipt.value.kind !== "replayed")) return unavailable;
    return { ok: true, value: { ...receipt.value, fingerprint, step, approvalRevision, expiresAt } };
  } catch { return unavailable; }
}

function strictPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}
