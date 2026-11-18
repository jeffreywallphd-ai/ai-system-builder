import type {ApprovedContextEmbeddingModelWitness} from "./approved-context-embedding-model.port";

/** Trusted host wiring only. Never serialize this capability into a client command or context. */
export interface ApprovedContextGenerationAdmission {
  readonly taskId: string;
  readonly organizationId: string;
  readonly principalId: string;
  readonly workspaceId: string;
  /** Hash of the canonical private command, including the exact selected model/settings. */
  readonly commandDigest: string;
  /** Required for admitted RAG; absence remains valid for source-derived no-model packs. */
  readonly embeddingModel?: ApprovedContextEmbeddingModelWitness;
  readonly sources: readonly {
    readonly artifactId: string;
    readonly storageKey: string;
    readonly digest: string;
    readonly sizeBytes: number;
    readonly mediaType: string;
    readonly format: string;
    /** Exact declared terms from the selected immutable Data record; absence stays unknown. */
    readonly declaredLicense?: string;
  }[];
  /** Current host acceptance and exact approved plan/actor/client/source/model scope, not just a timestamp. */
  readonly isCurrent: () => boolean;
  readonly stillAllowed: () => Promise<boolean>;
  /**
   * Atomically validate current plan/source/model authority and issue this exact
   * attempt once. Only acknowledged issuance permits dispatch. An uncertain
   * response never proves rollback and must not be retried as a new permission.
   */
  readonly issue: () => Promise<"issued" | "denied" | "unconfirmed">;
}

export const APPROVED_CONTEXT_MAX_SOURCES = 4;
export const APPROVED_CONTEXT_MAX_SOURCE_BYTES = 4 * 1024 * 1024;
export const APPROVED_CONTEXT_MAX_PENDING = 4;
export const APPROVED_CONTEXT_MAX_TASK_HISTORY = 256;
export const APPROVED_CONTEXT_MAX_LICENSE_CHARACTERS = 512;
