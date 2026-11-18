import type {ApprovedContextEmbeddingModelWitness} from "./approved-context-embedding-model.port";

/** Private trusted composition capability, never a transport/portable command. */
export interface ApprovedContextQueryOwnerAdmission {
  readonly taskId: string;
  readonly organizationId: string;
  readonly principalId: string;
  readonly workspaceId: string;
  readonly artifactId: string;
  readonly artifactDigest: string;
  readonly artifactSizeBytes: number;
  readonly queryDigest: string;
  readonly maximumResults: number;
  readonly embeddingDevice: "cpu" | "cuda";
  readonly embeddingModel: ApprovedContextEmbeddingModelWitness;
  readonly sources: readonly {readonly artifactId: string; readonly digest: string}[];
  /** Current host/client/plan, original saved/source/model and artifact/model read authority. */
  readonly isCurrent: () => boolean;
  readonly stillAllowed: () => Promise<boolean>;
  /** Atomically revalidate the exact original facts and issue this attempt once. */
  readonly issue: () => Promise<"issued" | "denied" | "unconfirmed">;
  /** Record this exact runtime ACK, including after outward permission retires. */
  readonly accept: (taskId: string) => Promise<boolean>;
}

export interface ApprovedContextQueryCommand {
  readonly artifactId: string;
  readonly query: string;
  readonly maximumResults: number;
  readonly embeddingDevice: "cpu" | "cuda";
}

export type AdmittedContextQueryStart =
  | {readonly kind: "accepted"; readonly taskId: string}
  | {readonly kind: "unavailable" | "not-started" | "unconfirmed"};

/** Source ordinals are derived from the frozen approved list, never worker IDs. */
export interface AdmittedContextQueryMatch {
  readonly rank: number;
  readonly score: number;
  readonly sourceOrdinal: number;
  readonly chunkIndex: number;
  readonly rowIndex?: number;
  readonly normalizedStart?: number;
  readonly normalizedEnd?: number;
  readonly pageNumber?: number;
}

export interface AdmittedContextQuerySnapshot {
  readonly taskId: string;
  readonly state: "running" | "succeeded" | "failed" | "unconfirmed";
  readonly matches: readonly AdmittedContextQueryMatch[];
  /** Owned custody is independent of the business outcome. */
  readonly cleanupPending: boolean;
}
