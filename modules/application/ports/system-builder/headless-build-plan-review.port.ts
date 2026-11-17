import type { HeadlessHostIncarnationId, parseHeadlessBuildPlanProposal } from "../../../contracts/headless";
import type { HeadlessOperationScope } from "./headless-operation-store.port";

export type HeadlessPlanReviewChannel = "app-popup" | "authenticated-chat";
export type HeadlessPlanReviewMode = "whole-plan" | "each-change";

export interface HeadlessPlanReviewTarget {
  readonly hostIncarnationId: HeadlessHostIncarnationId;
  readonly scope: HeadlessOperationScope;
  readonly fingerprint: string;
}

export interface HeadlessPlanReviewState {
  readonly revision: number;
  readonly stepCount: number;
  readonly expiresAt: number;
  readonly status: "pending" | "approved" | "denied" | "cancelled" | "revoked";
  readonly mode?: HeadlessPlanReviewMode;
  readonly approvedSteps: number;
  readonly lastChannel?: HeadlessPlanReviewChannel;
}

export type HeadlessPlanReviewResult =
  | { readonly ok: true; readonly state: HeadlessPlanReviewState }
  | { readonly ok: false; readonly code: "invalid" | "forbidden" | "stale" | "expired" | "capacity" | "unconfirmed" };

export interface HeadlessPlanReviewPort {
  /**
   * Select the immutable proposal under the exact target and apply the decision
   * in an owned transaction. The host policy must authorize within this
   * transaction. Check actor liveness and the stored deadline immediately
   * before commit. Return success only after confirming the owned commit.
   * An inactive actor gets a denial. A current actor with an expired proposal
   * gets an expiry result. Both vetoes discard the proposed update.
   * Absent or inaccessible targets must return the same forbidden response.
   */
  decide(input: {
    readonly target: HeadlessPlanReviewTarget;
    /** Checks the actor and request. The repository enforces its stored deadline. */
    readonly isCurrent: () => boolean;
    readonly update: (state: HeadlessPlanReviewState) => HeadlessPlanReviewResult;
  }): Promise<HeadlessPlanReviewResult>;
}

export type HeadlessPlanReviewSnapshot = {
  readonly state: HeadlessPlanReviewState;
  readonly preview: Extract<ReturnType<typeof parseHeadlessBuildPlanProposal>, { ok: true }>["preview"];
};

export type HeadlessPlanReviewSnapshotResult =
  | { readonly ok: true; readonly snapshot: HeadlessPlanReviewSnapshot }
  | Extract<HeadlessPlanReviewResult, { ok: false }>;

export interface HeadlessPlanReviewQuery {
  readonly target: HeadlessPlanReviewTarget;
  readonly isCurrent: () => boolean;
}

export interface HeadlessPlanReviewRepository extends HeadlessPlanReviewPort {
  propose(input: HeadlessPlanReviewQuery & { readonly proposal: unknown }): Promise<HeadlessPlanReviewSnapshotResult>;
  read(input: HeadlessPlanReviewQuery): Promise<HeadlessPlanReviewSnapshotResult>;
}

export interface HeadlessPlanReviewListTarget {
  readonly hostIncarnationId: HeadlessHostIncarnationId;
  readonly scope: Omit<HeadlessOperationScope, "registeredClientId">;
}

export interface HeadlessPlanReviewListEntry {
  readonly registeredClientId: string;
  readonly fingerprint: string;
  readonly expiresAt: number;
}

export type HeadlessPlanReviewListResult =
  | { readonly ok: true; readonly requests: readonly HeadlessPlanReviewListEntry[] }
  | Extract<HeadlessPlanReviewResult, { ok: false }>;
