import type {ApplicationRequestContext} from "../application-request-context";

export interface StoreGeneratedModelRequest {
  sourceDirectory: string;
  outputModelName: string;
  runId: string;
  repository?: string;
}

export interface StoreGeneratedModelResult {
  localPath: string;
  modelId?: string;
}

export interface GeneratedModelStoragePort {
  storeGeneratedModel(request: StoreGeneratedModelRequest): Promise<StoreGeneratedModelResult>;
  /** Explicit private capability only. Binding is synchronous and performs no
   * IO. Absence grants no fallback to ordinary copying. The application owns
   * original source/actor binding, exact Save consent and registry publication. */
  createReviewedSession?(request: ReviewedGeneratedModelRequest, context: ApplicationRequestContext,
    control: ReviewedGeneratedModelControl): ReviewedGeneratedModelStorageSession | undefined;
}
export interface ReviewedGeneratedModelRequest {
  readonly taskId: string;
  readonly saveId: string;
  readonly candidateDigest: string;
  /** Original application-owned staging only; never a public request path. */
  readonly sourceDirectory: string;
  readonly artifactForm: "full-model" | "adapter";
  readonly files: readonly Readonly<{name: string; expectedSizeBytes: number; expectedSha256: string}>[];
}
export interface ReviewedGeneratedModelControl {
  isCurrent(): boolean;
  stillAllowed(): Promise<boolean>;
  /** Independent cleanup authority. Prove no committed or uncertain registry
   * reference can use this copy; it does not expire with the write caller. */
  mayDiscard(): Promise<boolean>;
}
export interface ReviewedGeneratedModelResult {
  readonly storageProfile: "bounded-local-v1";
  readonly localPath: string;
  readonly candidateDigest: string;
  readonly fileCount: number;
  readonly totalBytes: number;
}
export interface ReviewedGeneratedModelStorageSession {
  readonly storageProfile: "bounded-local-v1";
  /** One original attempt. The caller retains its native Promise through an
   * outward deadline; status or timeout alone never closes IO. */
  write(): Promise<ReviewedGeneratedModelResult>;
  fence(): void;
  inspect(): Readonly<{phase: "bound" | "writing" | "ready" | "failed" | "discarding" | "discarded" | "unconfirmed";
    fenced: boolean; pendingOperations: number; openFiles: number; ioClosed: boolean;
    declaredPayloadBytes: number; physicalQuotaEnforced: false}>;
  /** Only fresh owned unchanged entries after actual IO closure and a separate
   * no-reference decision. Never use this to delete a registered Model. */
  discard(): Promise<boolean>;
}
