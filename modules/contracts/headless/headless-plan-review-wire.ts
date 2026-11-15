import { copyBoundedPassiveData, readStrictPassiveRecord } from "../shared";
import { isWorkspaceId, type WorkspaceId } from "../workspace";
import { HEADLESS_CONTRACT_VERSION, isHeadlessHostIncarnationId, type HeadlessHostIncarnationId } from "./headless-read-request";
import { HEADLESS_MAX_BUILD_PLAN_STEPS, parseHeadlessBuildPlanProposal } from "./headless-system-management";

export const HEADLESS_PLAN_REVIEW_PATH = "/aisb-headless/v1/plan-review";
export const HEADLESS_PLAN_REVIEW_MAX_REQUEST_BYTES = 32 * 1024;

interface PlanTarget {
  readonly hostIncarnationId: HeadlessHostIncarnationId;
  readonly workspaceId: WorkspaceId;
  readonly fingerprint: string;
}

type ParsedProposal = Extract<ReturnType<typeof parseHeadlessBuildPlanProposal>, { ok: true }>;
export type HeadlessPlanReviewAgentRequest =
  | { readonly operation: "plan.submit"; readonly target: PlanTarget; readonly proposal: ParsedProposal }
  | { readonly operation: "plan.status"; readonly target: PlanTarget };

const invalid = { ok: false, code: "headless.invalid-request" } as const;
const unavailable = { ok: false, code: "headless.unavailable" } as const;
const failureCodes = [
  "headless.forbidden", "headless.invalid-request", "headless.host-changed", "headless.unavailable",
  "headless.plan-expired", "headless.operation-capacity", "headless.stale",
] as const;
type FailureCode = typeof failureCodes[number];

export type HeadlessPlanReviewDecisionChoice =
  | { readonly kind: "approve"; readonly mode: "whole-plan" }
  | { readonly kind: "approve"; readonly mode: "each-change"; readonly step: number }
  | { readonly kind: "deny" | "cancel" | "revoke" };

export function readHeadlessPlanReviewDecisionChoice(value: unknown): HeadlessPlanReviewDecisionChoice | undefined {
  try {
    const fields = readStrictPassiveRecord(value, ["kind", "mode", "step"]);
    const { kind, mode, step } = fields;
    if (kind === "approve" && mode === "whole-plan" && !("step" in fields)) return { kind, mode };
    if (kind === "approve" && mode === "each-change" && integerAtLeast(step, 1) && step <= HEADLESS_MAX_BUILD_PLAN_STEPS)
      return { kind, mode, step };
    if ((kind === "deny" || kind === "cancel" || kind === "revoke") && Object.keys(fields).length === 1) return { kind };
  } catch { return undefined; }
}

export function readHeadlessPlanReviewAgentRequest(value: unknown, expectedHost: HeadlessHostIncarnationId):
  { readonly ok: true; readonly request: HeadlessPlanReviewAgentRequest } |
  { readonly ok: false; readonly code: "headless.invalid-request" | "headless.host-changed" } {
  try {
    const { version, operation, input } = readStrictPassiveRecord(copyBoundedPassiveData(value), ["version", "operation", "input"]);
    if (version !== HEADLESS_CONTRACT_VERSION || (operation !== "plan.submit" && operation !== "plan.status")) return invalid;
    const { hostIncarnationId, workspaceId, fingerprint, ...proposalFields } = readStrictPassiveRecord(input,
      operation === "plan.submit" ? ["hostIncarnationId", "workspaceId", "fingerprint", "steps"] :
        ["hostIncarnationId", "workspaceId", "fingerprint"]);
    if (!isHeadlessHostIncarnationId(hostIncarnationId) || !isWorkspaceId(workspaceId) || !isDigest(fingerprint))
      return invalid;
    if (hostIncarnationId !== expectedHost) return { ok: false, code: "headless.host-changed" };
    const target = { hostIncarnationId, workspaceId, fingerprint };
    if (operation === "plan.status") return { ok: true, request: { operation, target } };
    const proposal = parseHeadlessBuildPlanProposal({ hostIncarnationId, workspaceId, ...proposalFields }, expectedHost);
    return proposal.ok ? { ok: true, request: { operation, target, proposal } } : invalid;
  } catch { return invalid; }
}

export type HeadlessPlanReviewAgentResult =
  | { readonly ok: false; readonly code: FailureCode }
  | { readonly ok: true; readonly value: {
    readonly fingerprint: string;
    readonly revision: number;
    readonly stepCount: number;
    readonly expiresAt: number;
    readonly status: "pending" | "approved" | "denied" | "cancelled" | "revoked";
    readonly approvedSteps: number;
    readonly mode?: "whole-plan" | "each-change";
  } };

export function readHeadlessPlanReviewAgentResult(value: unknown, exactFingerprint: string,
  expectedStepCount?: number): HeadlessPlanReviewAgentResult {
  try {
    const raw = readStrictPassiveRecord(value, ["ok", "code", "value"]);
    if (raw.ok === false && !("value" in raw) && failureCodes.includes(raw.code as FailureCode))
      return { ok: false, code: raw.code as FailureCode };
    if (raw.ok !== true || "code" in raw) return unavailable;
    const { fingerprint, revision, stepCount, expiresAt, status, approvedSteps, mode } =
      readStrictPassiveRecord(raw.value, ["fingerprint", "revision", "stepCount", "expiresAt", "status", "approvedSteps", "mode"]);
    if (!isDigest(fingerprint) || fingerprint !== exactFingerprint || !integerAtLeast(revision, 1) ||
        !integerAtLeast(stepCount, 1) || stepCount > HEADLESS_MAX_BUILD_PLAN_STEPS || !integerAtLeast(expiresAt, 1) ||
        (expectedStepCount !== undefined && stepCount !== expectedStepCount) ||
        !integerAtLeast(approvedSteps, 0) || approvedSteps > stepCount ||
        (mode !== undefined && mode !== "whole-plan" && mode !== "each-change") ||
        (status !== "pending" && status !== "approved" && status !== "denied" && status !== "cancelled" && status !== "revoked") ||
        (mode === undefined && approvedSteps !== 0) ||
        (status === "approved" && (approvedSteps !== stepCount || mode === undefined)) ||
        (status === "pending" && (approvedSteps === stepCount || mode === "whole-plan")) ||
        (mode === "whole-plan" && (approvedSteps !== stepCount || (status !== "approved" && status !== "revoked"))))
      return unavailable;
    return { ok: true, value: { fingerprint, revision, stepCount, expiresAt, status, approvedSteps,
      ...(mode === undefined ? {} : { mode }) } };
  } catch { return unavailable; }
}

function isDigest(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}

function integerAtLeast(value: unknown, minimum: number): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= minimum;
}
