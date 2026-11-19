export interface CompletedModelDownload {
  readonly provider: "transformers";
  readonly modelId: string;
  /** Worker-confirmed exact revision, never inferred from a request alone. */
  readonly revision?: string;
  /** Verified selected bytes at the worker's read, never loading or future file authority. */
  readonly verifiedManifestDigest?: string;
  readonly downloaded: boolean;
  readonly fromCache: boolean;
  readonly localPath: string;
}

/**
 * Host-internal completion data used to register a downloaded model exactly once.
 * This port must never be exposed through API, IPC, preload, renderer, or logs.
 */
export interface ModelDownloadCompletionPort {
  readCompletedModelDownload(requestId: string): Promise<CompletedModelDownload | undefined>;
}
