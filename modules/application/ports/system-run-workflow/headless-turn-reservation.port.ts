import type { OrganizationId } from "../../../contracts/organization";
import type { WorkspaceId } from "../../../contracts/workspace";

export type HeadlessTurnScope = {
  readonly organizationId: OrganizationId;
  readonly workspaceId: WorkspaceId;
  readonly principalId: string;
  readonly registeredClientId: string;
};

export type HeadlessTurnReference = { readonly turnId: string; readonly runId: string };
export type HeadlessTurnReservation =
  | { readonly kind: "reserved"; readonly operationId: string }
  | { readonly kind: "observed"; readonly reference: HeadlessTurnReference }
  | { readonly kind: "absent" | "unconfirmed" | "conflict" | "expired" | "capacity" | "denied" };

export interface HeadlessTurnReservationPort {
  reserve(input: {
    readonly scope: HeadlessTurnScope;
    readonly key: string;
    readonly fingerprint: string;
    /** Observation may inspect an existing key but never create one. */
    readonly mode: "observe" | "dispatch";
    readonly isCurrent: () => boolean;
  }): Promise<HeadlessTurnReservation>;
  confirm(input: {
    readonly scope: HeadlessTurnScope;
    readonly key: string;
    readonly operationId: string;
    readonly reference: HeadlessTurnReference;
  }): Promise<boolean>;
}
