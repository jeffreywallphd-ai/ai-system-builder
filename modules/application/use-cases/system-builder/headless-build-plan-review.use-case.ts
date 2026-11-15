import { HEADLESS_MAX_BUILD_PLAN_STEPS, isDesktopHeadlessClientId, isHeadlessHostIncarnationId,
  type HeadlessHostIncarnationId } from "../../../contracts/headless";
import { isOrganizationId } from "../../../contracts/organization";
import { copyBoundedPassiveData, hasKnownPassiveCredential, readStrictPassiveRecord } from "../../../contracts/shared";
import { isWorkspaceId } from "../../../contracts/workspace";
import type {
  HeadlessPlanReviewChannel, HeadlessPlanReviewMode, HeadlessPlanReviewPort,
  HeadlessPlanReviewResult, HeadlessPlanReviewState, HeadlessPlanReviewTarget,
} from "../../ports/system-builder/headless-build-plan-review.port";
import type { HeadlessOperationScope } from "../../ports/system-builder";

type Decision = { readonly kind: "approve"; readonly mode: "whole-plan" } |
  { readonly kind: "approve"; readonly mode: "each-change"; readonly step: number } |
  { readonly kind: "deny" | "cancel" | "revoke" };

interface ReviewRequest {
  readonly fingerprint: string;
  readonly expectedRevision: number;
  readonly decision: Decision;
}

/** These members come from the host's verified human channel, separate from agent registration. */
export interface HeadlessPlanReviewActor {
  readonly organizationId: HeadlessOperationScope["organizationId"];
  readonly principalId: string;
  readonly channel: HeadlessPlanReviewChannel;
  readonly isCurrent: () => boolean;
  readonly canDecide: (target: HeadlessPlanReviewTarget) => Promise<boolean>;
}

const invalid = { ok: false, code: "invalid" } as const;
const forbidden = { ok: false, code: "forbidden" } as const;
const stale = { ok: false, code: "stale" } as const;
const expired = { ok: false, code: "expired" } as const;
const unconfirmed = { ok: false, code: "unconfirmed" } as const;

export class HeadlessBuildPlanReviewUseCase {
  public constructor(private readonly store: HeadlessPlanReviewPort, private readonly now: () => number) {}

  public async decide(
    raw: unknown, hostIncarnationId: HeadlessHostIncarnationId,
    scope: HeadlessOperationScope, actor: HeadlessPlanReviewActor,
  ): Promise<HeadlessPlanReviewResult> {
    const request = parseRequest(raw);
    if (!request) return invalid;
    const { organizationId, workspaceId, principalId, registeredClientId } = scope;
    const { channel, isCurrent } = actor;
    if (!isHeadlessHostIncarnationId(hostIncarnationId) || !isWorkspaceId(workspaceId) ||
        !isOrganizationId(organizationId) || !isDesktopHeadlessClientId(registeredClientId) ||
        !validPrincipal(principalId) || actor.organizationId !== organizationId || actor.principalId !== principalId ||
        (channel !== "app-popup" && channel !== "authenticated-chat")) return forbidden;

    const target: HeadlessPlanReviewTarget = {
      hostIncarnationId, scope: { organizationId, workspaceId, principalId, registeredClientId },
      fingerprint: request.fingerprint,
    };
    const authorize = async () => {
      try { return isCurrent() && await actor.canDecide(target) && isCurrent(); }
      catch { return false; }
    };
    if (!await authorize()) return forbidden;
    try {
      let expiresAt: number | undefined;
      const result = await this.store.decide({
        target, isCurrent,
        update: state => {
          expiresAt = state.expiresAt;
          return isCurrent() ? transition(state, request, channel, this.now()) : forbidden;
        },
      });
      if (!await authorize()) return forbidden;
      const observedAt = this.now();
      if (result.ok && (expiresAt === undefined || !positiveInteger(observedAt) || observedAt >= expiresAt))
        return expired;
      return result;
    } catch {
      return await authorize() ? unconfirmed : forbidden;
    }
  }
}

function validPrincipal(value: string) {
  return typeof value === "string" && value.length > 0 && value.length <= 160 &&
    value.trim() === value && !/[\u0000-\u001f\u007f]/.test(value) && !hasKnownPassiveCredential(value);
}

function parseRequest(value: unknown): ReviewRequest | undefined {
  try {
    const { fingerprint, expectedRevision, decision } = readStrictPassiveRecord(
      copyBoundedPassiveData(value), ["fingerprint", "expectedRevision", "decision"],
    );
    if (typeof fingerprint !== "string" || !/^[a-f0-9]{64}$/.test(fingerprint) ||
        !positiveInteger(expectedRevision)) return;
    const raw = readStrictPassiveRecord(decision, ["kind", "mode", "step"]);
    const { kind, mode, step } = raw;
    if (kind === "approve" && mode === "whole-plan" && !("step" in raw))
      return { fingerprint, expectedRevision, decision: { kind, mode } };
    if (kind === "approve" && mode === "each-change" && positiveInteger(step) && step <= HEADLESS_MAX_BUILD_PLAN_STEPS)
      return { fingerprint, expectedRevision, decision: { kind, mode, step } };
    if ((kind === "deny" || kind === "cancel" || kind === "revoke") && Object.keys(raw).length === 1)
      return { fingerprint, expectedRevision, decision: { kind } };
  } catch { return undefined; }
}

function transition(
  state: HeadlessPlanReviewState, request: ReviewRequest, channel: HeadlessPlanReviewChannel, now: number,
): HeadlessPlanReviewResult {
  if (!positiveInteger(now) || !positiveInteger(state.expiresAt) || state.expiresAt <= now) return expired;
  if (state.revision !== request.expectedRevision || state.revision >= Number.MAX_SAFE_INTEGER ||
      (state.status !== "pending" && state.status !== "approved")) return stale;
  if (!positiveInteger(state.stepCount) || state.stepCount > HEADLESS_MAX_BUILD_PLAN_STEPS ||
      !Number.isSafeInteger(state.approvedSteps) || state.approvedSteps < 0 || state.approvedSteps > state.stepCount ||
      (state.status === "approved") !== (state.approvedSteps === state.stepCount) ||
      (state.mode === undefined && state.approvedSteps !== 0) ||
      (state.mode === "whole-plan" && state.status !== "approved") ||
      (state.mode !== undefined && state.mode !== "whole-plan" && state.mode !== "each-change"))
    return unconfirmed;
  const { decision } = request;
  const updated = { revision: state.revision + 1, stepCount: state.stepCount, expiresAt: state.expiresAt,
    approvedSteps: state.approvedSteps, ...(state.mode === undefined ? {} : { mode: state.mode }), lastChannel: channel };
  if (decision.kind === "revoke") return { ok: true, state: { ...updated, status: "revoked" } };
  if (state.status !== "pending") return stale;
  if (decision.kind === "deny") return { ok: true, state: { ...updated, status: "denied" } };
  if (decision.kind === "cancel") return { ok: true, state: { ...updated, status: "cancelled" } };
  if (decision.kind !== "approve" || (state.mode !== undefined && state.mode !== decision.mode)) return stale;
  const mode: HeadlessPlanReviewMode = decision.mode;
  if (mode === "whole-plan") {
    if (state.approvedSteps !== 0) return stale;
    return { ok: true, state: { ...updated, mode, approvedSteps: state.stepCount, status: "approved" } };
  }
  if (!("step" in decision) || decision.step !== state.approvedSteps + 1 || decision.step > state.stepCount) return stale;
  const approvedSteps = decision.step;
  return { ok: true, state: { ...updated, mode, approvedSteps, status: approvedSteps === state.stepCount ? "approved" : "pending" } };
}

function positiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}
