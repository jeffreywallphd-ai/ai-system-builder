import { copyBoundedPassiveData, readStrictPassiveRecord } from "../shared";
import { isWorkspaceId, type WorkspaceId } from "../workspace";
import { isDesktopHeadlessClientId, isDesktopHeadlessFingerprint } from "./desktop-headless-pairing";
import { isHeadlessHostIncarnationId } from "./headless-read-request";
import { readHeadlessPlanReviewAgentResult, readHeadlessPlanReviewDecisionChoice,
  type HeadlessPlanReviewAgentResult, type HeadlessPlanReviewDecisionChoice } from "./headless-plan-review-wire";
import { HEADLESS_MAX_BUILD_PLAN_STEPS, parseHeadlessBuildPlanProposal } from "./headless-system-management";

export const DESKTOP_HEADLESS_PLAN_APPROVAL_CHANNELS = Object.freeze({
  list: "desktop.headless.plan-approvals.list",
  open: "desktop.headless.plan-approvals.open",
  dismiss: "desktop.headless.plan-approvals.dismiss",
  decide: "desktop.headless.plan-approvals.decide",
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

export function readDesktopPlanApprovalView(value: unknown, selection: DesktopPlanApprovalSelection): DesktopPlanApprovalView | undefined {
  try {
    const raw = readStrictPassiveRecord(copyBoundedPassiveData(value), ["selection", "viewId", "preview", "state"]);
    const actual = readDesktopPlanApprovalSelection(raw.selection);
    if (!actual || !sameDesktopPlanApproval(actual, selection) || !isDesktopHeadlessClientId(raw.viewId)) return;
    const { version, hostIncarnationId, workspaceId, approval, steps } = readStrictPassiveRecord(raw.preview,
      ["version", "hostIncarnationId", "workspaceId", "approval", "steps"]);
    if (version !== "aisb-build-plan-preview-v1" || workspaceId !== selection.workspaceId || approval !== "required" ||
        !isHeadlessHostIncarnationId(hostIncarnationId) || !Array.isArray(steps) ||
        steps.length < 1 || steps.length > HEADLESS_MAX_BUILD_PLAN_STEPS) return;
    const decoded = parseHeadlessBuildPlanProposal({ hostIncarnationId, workspaceId, steps: steps.map(step => {
      const { operation, input, effect, externalProviderCalls } = readStrictPassiveRecord(step,
        ["operation", "input", "effect", "externalProviderCalls"]);
      if (effect !== "saved-system-write" || externalProviderCalls !== 0) throw new Error("Invalid approval effects.");
      const fields = readStrictPassiveRecord(input, ["idempotencyKey", "name", "templateId", "systemId",
        "baseRecordRevision", "baseRevisionId", "description"]);
      return { operation, ...fields };
    }) }, hostIncarnationId);
    if (!decoded.ok) return;
    const state = readHeadlessPlanReviewAgentResult({ ok: true, value: raw.state }, selection.fingerprint, decoded.requests.length);
    if (state.ok) return { selection: actual, viewId: raw.viewId, preview: decoded.preview, state: state.value };
  } catch { return undefined; }
}

function positiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}
