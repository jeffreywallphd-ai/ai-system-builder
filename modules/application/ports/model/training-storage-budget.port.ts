import type {OrganizationId} from "../../../contracts/organization";
import type {WorkspaceId} from "../../../contracts/workspace";

export type TrainingStorageBudgetRole = "model" | "inputs" | "worker-output" | "parent-output" | "overhead";
export interface TrainingStorageBudgetScope {
  readonly organizationId: OrganizationId;
  readonly workspaceId: WorkspaceId;
  readonly principalId: string;
  readonly clientId: string;
  readonly hostIncarnationId: string;
  readonly requestId: string;
}
export interface TrainingStorageBudgetRequest {
  readonly scope: TrainingStorageBudgetScope;
  readonly definitionDigest: string;
  readonly storageScopeDigest: string;
  readonly profileFingerprint: string;
  readonly limits: Readonly<Record<TrainingStorageBudgetRole, number>>;
  readonly maximumReservedBytes: number;
}
export type TrainingStorageBudgetResult = {readonly kind: "reserved" | "capacity" | "denied" | "unconfirmed"};

/** Private configured-store admission, not Native capacity/provenance/readiness.
 * The original owner must retain the actual pending operation before awaiting.
 * Only its acknowledged commit can satisfy budget admission. Existing records,
 * lost replies and crashes never grant a new attempt, expiry or byte credit.
 * This port deliberately exposes no release, adoption or initialization method.
 * A separately qualified single authoritative pool/store and original physical
 * custody/anti-rollback/cleanup remain prerequisites for host activation. */
export interface TrainingStorageBudgetPort {
  reserve(request: TrainingStorageBudgetRequest, control: {readonly isCurrent: () => boolean}): Promise<TrainingStorageBudgetResult>;
}
