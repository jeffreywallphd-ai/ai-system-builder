import type {DatasetPreparationSourceFormat} from "../../../contracts/runtime";

/** Trusted host wiring only. Never place this object in a command or request context. */
export interface LocalDatasetPreparationAdmission {
  /** Host-minted task UUID, reserved by the owning durable plan effect. */
  readonly taskId: string;
  readonly sources: readonly {
    readonly artifactId: string;
    readonly storageKey: string;
    readonly mediaType: string;
    readonly format: DatasetPreparationSourceFormat;
    readonly sizeBytes: number;
    readonly digest: `sha256:${string}`;
  }[];
  readonly isCurrent: () => boolean;
  readonly stillAllowed: () => Promise<boolean>;
  /**
   * Atomically validate current plan/source authority and issue this attempt once.
   * Only an acknowledged `issued` permits the one runtime call. An uncertain
   * response must never be retried or interpreted as a rollback/no-effect proof.
   */
  readonly issue: () => Promise<"issued" | "denied" | "unconfirmed">;
}

export const LOCAL_DATASET_ADMISSION_MAX_SOURCES = 4;
export const LOCAL_DATASET_ADMISSION_MAX_SOURCE_BYTES = 4 * 1024 * 1024;
export const LOCAL_DATASET_ADMISSION_MAX_PENDING = 4;
