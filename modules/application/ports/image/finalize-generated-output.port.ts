import type { AssetMetadata } from "../../../contracts/asset";
import type { WorkspaceId } from "../../../contracts/workspace";

export interface FinalizeGeneratedOutputRequest {
  readonly workspaceId: WorkspaceId;
  readonly generatedOutputId: string;
  readonly sourceViewId?: string;
  readonly displayName?: string;
  readonly requestId?: string;
  readonly correlationId?: string;
  readonly idempotencyKey?: string;
}

export interface FinalizedGeneratedImageDescriptor {
  readonly workspaceId: WorkspaceId;
  readonly imageAssetId: string;
  readonly backingArtifactId: string;
  readonly source: "generated";
  readonly displayName?: string;
  readonly mediaType?: string;
  readonly width?: number;
  readonly height?: number;
  readonly seed?: number;
  readonly model?: string;
  readonly engine?: string;
  readonly createdAt?: string;
  readonly metadata?: AssetMetadata;
}

export type FinalizeGeneratedOutputFailureCode =
  | "validation"
  | "not-found"
  | "unavailable"
  | "internal";

export interface FinalizeGeneratedOutputFailure {
  readonly code: FinalizeGeneratedOutputFailureCode;
  readonly message: string;
  readonly diagnostics?: readonly FinalizeGeneratedOutputDiagnostic[];
  readonly safeDetails?: AssetMetadata;
}

export interface FinalizeGeneratedOutputDiagnostic {
  readonly severity: "info" | "warning" | "error";
  readonly code: string;
  readonly message: string;
  readonly safeDetails?: AssetMetadata;
}

export interface FinalizeGeneratedOutputSuccess {
  readonly ok: true;
  readonly status: "finalized" | "already-finalized";
  readonly finalizedImage: FinalizedGeneratedImageDescriptor;
  readonly diagnostics?: readonly FinalizeGeneratedOutputDiagnostic[];
}

export interface FinalizeGeneratedOutputFailureResult {
  readonly ok: false;
  readonly failure: FinalizeGeneratedOutputFailure;
  readonly diagnostics?: readonly FinalizeGeneratedOutputDiagnostic[];
}

export type FinalizeGeneratedOutputResult =
  | FinalizeGeneratedOutputSuccess
  | FinalizeGeneratedOutputFailureResult;

export interface FinalizeGeneratedOutputPort {
  /**
   * Finalizes an already-known generated image output into the image/artifact
   * system. Requests and results carry safe identifiers and summaries only:
   * opaque resource content and provider-native payloads stay behind the seam.
   */
  finalizeGeneratedOutput(
    request: FinalizeGeneratedOutputRequest,
  ): Promise<FinalizeGeneratedOutputResult>;
}
