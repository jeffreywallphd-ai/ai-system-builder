import type { SystemReleaseId } from "../system-build";
import type { WorkspaceId } from "../workspace";

export type SystemReviewAction =
  "describe" | "browse" | "detail" | "preview" | "audit";
export type SystemReviewPreviewKind =
  "text" | "table" | "image" | "pdf" | "unsupported";
export type SystemReviewPreviewStatus =
  "ready" | "unavailable" | "oversized" | "malformed" | "unsupported";

export interface SystemReviewPrincipal {
  readonly actorId: string;
  readonly roles: readonly string[];
  readonly authenticated: boolean;
}

export interface SystemReviewContext {
  readonly workspaceId: WorkspaceId;
  readonly releaseId: SystemReleaseId;
  readonly principal: SystemReviewPrincipal;
}

export interface SystemReviewDescriptor {
  readonly schemaVersion: "1.0";
  readonly targetWorkspaceId: WorkspaceId;
  readonly releaseId: SystemReleaseId;
  readonly title: string;
  readonly allowedMediaTypes: readonly string[];
  readonly maximumListItems: number;
  readonly maximumPreviewBytes: number;
}

export interface SystemReviewArtifactSummary {
  readonly artifactRef: string;
  readonly displayName: string;
  readonly artifactFamily: string;
  readonly mediaType?: string;
  readonly sizeBytes?: number;
  readonly createdAt?: string;
}

export interface SystemReviewArtifactPage {
  readonly items: readonly SystemReviewArtifactSummary[];
  readonly total: number;
  readonly limit: number;
}

export type SystemReviewMetadataValue = string | number | boolean | null;

export interface SystemReviewArtifactDetail extends SystemReviewArtifactSummary {
  readonly metadata: Readonly<Record<string, SystemReviewMetadataValue>>;
}

export interface SystemReviewTable {
  readonly columns: readonly string[];
  readonly rows: readonly (readonly string[])[];
}

export interface SystemReviewPreview {
  readonly artifactRef: string;
  readonly displayName: string;
  readonly mediaType?: string;
  readonly kind: SystemReviewPreviewKind;
  readonly status: SystemReviewPreviewStatus;
  readonly message: string;
  readonly text?: string;
  readonly table?: SystemReviewTable;
  readonly bytes?: Uint8Array;
  readonly truncated?: boolean;
}

export type SystemReviewAuditOutcome =
  | "allowed"
  | "denied"
  | "unavailable"
  | "malformed"
  | "oversized"
  | "unsupported";

export interface SystemReviewAuditEntry {
  readonly auditId: string;
  readonly targetWorkspaceId: WorkspaceId;
  readonly releaseId: SystemReleaseId;
  readonly action: SystemReviewAction;
  readonly outcome: SystemReviewAuditOutcome;
  readonly actorId: string;
  readonly artifactRef?: string;
  readonly occurredAt: string;
}

export interface DescribeSystemReviewQuery extends SystemReviewContext {}

export interface BrowseSystemReviewArtifactsQuery extends SystemReviewContext {
  readonly nameQuery?: string;
  readonly limit?: number;
}

export interface ReadSystemReviewArtifactQuery extends SystemReviewContext {
  readonly artifactRef: string;
}

export interface PreviewSystemReviewArtifactQuery extends ReadSystemReviewArtifactQuery {}

export interface ListSystemReviewAuditQuery extends SystemReviewContext {
  readonly limit?: number;
}

export interface SystemReviewFailure {
  readonly code: string;
  readonly message: string;
}

export type SystemReviewResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: SystemReviewFailure };

export const systemReviewSuccess = <T>(value: T): SystemReviewResult<T> => ({
  ok: true,
  value,
});
export const systemReviewFailure = (
  code: string,
  message: string,
): SystemReviewResult<never> => ({
  ok: false,
  error: { code, message },
});
