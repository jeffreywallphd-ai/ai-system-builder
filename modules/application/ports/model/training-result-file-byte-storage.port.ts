import type {ApplicationRequestContext} from "../application-request-context";
import type {StoreArtifactResult} from "../../../contracts/storage";

/** Private acknowledged inventory, not current file or model-readiness proof.
 * The coordinator still owns final delivery ACK, original worker retirement,
 * fresh review permission, current file verification and separate Save. */
export interface TrainingResultFinalizedFiles {
  readonly schema: "training-result-finalized-files-v1";
  readonly publicationId: string;
  readonly totalBytes: number;
  readonly files: readonly Readonly<{
    fileIndex: number; groupIndex: number; name: string;
    role: "checkpoint" | "candidate";
    mediaType: "application/json" | "application/octet-stream";
    expectedSizeBytes: number; expectedSha256: string; key: string;
  }>[];
}

/** Fresh private read authority, separate from the ended publication lifetime.
 * These capabilities never come from API/IPC or confer Save/cleanup permission. */
export interface TrainingResultFileVerificationControl {
  assertCurrent(): void;
  assertAllowed(): Promise<void>;
}
export interface TrainingResultVerifiedFiles extends TrainingResultFinalizedFiles {
  readonly verification: "sha256-current-local-v1";
  /** Content inventory identity only, never permission or durable custody. */
  readonly manifestDigest: string;
}
export interface TrainingResultRetainedFileVerificationPort {
  /** Verify original known files with bounded memory and actual handle closure.
   * The caller separately proves original task success/retirement and current
   * review permission. Returned observations do not establish model readiness. */
  verifyFinalizedFiles(context: ApplicationRequestContext,
    control: TrainingResultFileVerificationControl): Promise<TrainingResultVerifiedFiles>;
  inspectVerification(): Readonly<{
    phase: "idle" | "reading" | "unconfirmed";
    pendingOperations: number;
    openFiles: number;
  }>;
}

/** Captured private adapter lifetime, never request-selected or Native custody.
 * Capture, fence and inspection are strictly synchronous. Fence returns exactly
 * undefined; Promise results cannot establish local retirement. */
export interface TrainingResultFileIoRetirement {
  fencePublication(): void;
  inspect(): {
    readonly schema: "training-result-file-io-retirement-v1";
    readonly publicationId: string;
    readonly publicationFenced: boolean;
    readonly phase: "open" | "pending" | "closed" | "unconfirmed";
    readonly fileCount: number;
    readonly pendingOperations: number;
    readonly publicationUnconfirmed: boolean;
    readonly declaredPayloadBytes: number;
  };
}

/** One private, configured training publication. The owning coordinator must
 * separately prove source custody, actual capacity and current permission.
 * Neither this capability nor a stream may come from a client command.
 * Stored bytes are not a registered Model, artifact catalog entry or Save. */
export interface TrainingResultFileByteStoragePort {
  /** Optional trusted complete-inventory preparation. Called once after wire
   * validation, before the first manifest acknowledgement permits file bytes.
   * The caller tracks the original operation through abort/deadline. Returning
   * undefined confirms only this local preparation, never capacity or custody.
   * Groups, roles and allowlisted names are validated metadata labels; they do
   * not select physical paths or grant model registration or Save authority. */
  preparePublication?(input: {
    readonly publicationId: string;
    readonly totalBytes: number;
    readonly files: readonly Readonly<{
      fileIndex: number;
      groupIndex: number;
      name: string;
      role: "checkpoint" | "candidate";
      mediaType: "application/json" | "application/octet-stream";
      expectedSizeBytes: number;
      expectedSha256: string;
    }>[];
  }, context: ApplicationRequestContext): Promise<void>;
  /** Optional trusted composition; capture before publishing. Older two-method
   * ports supply no failure-path IO proof. This grants no retry/delete/credit. */
  captureIoRetirement?(input: {readonly publicationId: string}, context: ApplicationRequestContext): TrainingResultFileIoRetirement;
  publishResultFile(input: {
    readonly fileIndex: number;
    readonly mediaType: "application/json" | "application/octet-stream";
    readonly content: AsyncIterable<Uint8Array>;
    readonly expectedSizeBytes: number;
    readonly expectedSha256: string;
  }, context: ApplicationRequestContext): Promise<StoreArtifactResult>;
  /** Local acknowledgements/declarations only, not file readiness, measured
   * allocation, complete custody or global settlement. No IO occurs here. */
  inspectPublication(): {
    readonly phase: "open" | "checking" | "writing" | "unconfirmed";
    readonly attemptedFileCount: number;
    readonly acknowledgedFileCount: number;
    readonly declaredPayloadBytes: number;
  };
}
