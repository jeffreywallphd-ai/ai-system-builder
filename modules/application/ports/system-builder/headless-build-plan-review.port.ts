import type { HeadlessHostIncarnationId } from "../../../contracts/headless";
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
  | { readonly ok: false; readonly code: "invalid" | "forbidden" | "stale" | "expired" | "unconfirmed" };

export interface HeadlessPlanReviewPort {
  /**
   * Select the immutable proposal under the exact target and apply the decision
   * in an owned transaction. The host policy must authorize within this
   * transaction. Check the synchronous fence again immediately before commit.
   * Return success only after confirming the owned commit. A veto must
   * discard the proposed update and return a non-success result.
   * Absent or inaccessible targets must return the same forbidden response.
   */
  decide(input: {
    readonly target: HeadlessPlanReviewTarget;
    readonly isCurrent: () => boolean;
    readonly update: (state: HeadlessPlanReviewState) => HeadlessPlanReviewResult;
  }): Promise<HeadlessPlanReviewResult>;
}
