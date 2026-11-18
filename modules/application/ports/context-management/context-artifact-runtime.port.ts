import type {
  ContextArtifactInspection,
  ContextChunkingSettings,
  ContextRetrievalMatch,
  ContextSourceCheckSettings,
  ContextSourceInformation,
  ContextSourceInspection,
} from "../../../contracts/context-management";
import type { WorkspaceId } from "../../../contracts/workspace";

interface ContextArtifactRuntimeInput {
  readonly workspaceId: WorkspaceId;
  readonly artifactId: string;
  readonly content: Uint8Array;
  readonly mediaType: string;
  readonly digest: string;
}

export interface InspectContextSourceInput extends ContextArtifactRuntimeInput {
  readonly originalName?: string;
  readonly chunking: ContextChunkingSettings;
  readonly sourceInformation?: ContextSourceInformation;
  readonly sourceChecks?: ContextSourceCheckSettings;
}

export interface InspectContextArtifactInput extends ContextArtifactRuntimeInput {}

export interface QueryContextArtifactInput extends ContextArtifactRuntimeInput {
  readonly query: string;
  readonly maximumResults: number;
  readonly embeddingDevice?: "cpu" | "cuda" | "auto";
}

/** Private owning capability, never a client command or portable manifest. The
 * caller resolves the original safe model and binds current actor/plan policy. */
export interface ApprovedContextQueryAdmission {
  readonly taskId: string;
  readonly workspaceId: WorkspaceId;
  readonly artifactId: string;
  readonly artifactDigest: string;
  readonly queryDigest: string;
  readonly maximumResults: number;
  readonly embeddingDevice: "cpu" | "cuda";
  readonly embeddingModel: {readonly modelId: string; readonly localModelReference: string};
  readonly isCurrent: () => boolean;
  readonly stillAllowed: () => Promise<boolean>;
  readonly issue: () => Promise<"issued" | "denied" | "unconfirmed">;
  /** Record only this exact acknowledged task before outward task disclosure. */
  readonly accept: (taskId: string) => Promise<boolean>;
  /** Exact owned cleanup observation only. It grants no cleanup or task authority.
   * May arrive after the result promise settles; callers must retain capacity. */
  readonly cleanupRetired?: (taskId: string) => void;
}

export type AdmittedContextQueryResult =
  | {readonly kind: "succeeded"; readonly matches: readonly ContextRetrievalMatch[]; readonly cleanupPending: boolean}
  | {readonly kind: "not-started"}
  | {readonly kind: "failed" | "unconfirmed"; readonly cleanupPending: boolean};

export interface ContextArtifactRuntimePort {
  inspectSource(
    input: InspectContextSourceInput,
  ): Promise<ContextSourceInspection>;
  inspectArtifact(
    input: InspectContextArtifactInput,
  ): Promise<ContextArtifactInspection>;
  query(
    input: QueryContextArtifactInput,
  ): Promise<readonly ContextRetrievalMatch[]>;
  /** Installed-only; the caller can retain the promise and observe `accept` for
   * asynchronous task admission. This port grants no public query/egress right.
   * Failed means terminal processing/result delivery failed; it is not non-start. */
  queryAdmitted?(
    input: QueryContextArtifactInput & {readonly embeddingDevice: "cpu" | "cuda"},
    admission: ApprovedContextQueryAdmission,
  ): Promise<AdmittedContextQueryResult>;
}
