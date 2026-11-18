import type {ApplicationRequestContext} from "../application-request-context";

/** Exact saved metadata, not a client-supplied path or physical readiness claim. */
export interface ApprovedContextEmbeddingModelWitness {
  readonly modelRecordId: string;
  readonly modelUpdatedAt: string;
  readonly modelId: string;
  readonly recordDigest: string;
}

/** Trusted host composition only. Resolution reads existing files; it never installs or downloads. */
export interface ApprovedContextEmbeddingModelResolverPort {
  resolveExistingModel(witness: ApprovedContextEmbeddingModelWitness, context: ApplicationRequestContext,
    stillAllowed: () => Promise<boolean>): Promise<{readonly localModelReference: string} | undefined>;
}

/** Existing-file inspection only. The host supplies configured roots; this port grants no model execution. */
export interface ContextInstalledEmbeddingModelFilesPort {
  inspectExistingDirectory(localPath: string): Promise<{readonly localModelReference: string} | undefined>;
}
