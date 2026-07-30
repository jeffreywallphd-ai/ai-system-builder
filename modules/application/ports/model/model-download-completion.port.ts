export interface CompletedModelDownload {
  readonly provider: "transformers";
  readonly modelId: string;
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
