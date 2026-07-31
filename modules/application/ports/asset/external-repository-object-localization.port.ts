import type {
  AssetExternalRepositoryObjectReference,
  AssetMetadata,
  AssetReference,
  AssetResourceBacking,
  AssetSourceIdentity,
} from "../../../contracts/asset";

export type ExternalRepositoryObjectLocalizationOperation =
  | "import"
  | "localize";

export interface ExternalRepositoryObjectLocalizationRequest {
  readonly operation: ExternalRepositoryObjectLocalizationOperation;
  readonly viewId: string;
  readonly externalObjectRef: AssetExternalRepositoryObjectReference;
  readonly sourceIdentity: AssetSourceIdentity;
  readonly targetDefinitionRef?: AssetReference;
  readonly importMode?: "remote-reference" | "catalog-registration";
  readonly requestId?: string;
  readonly correlationId?: string;
  readonly idempotencyKey?: string;
}

export interface ExternalRepositoryObjectLocalizationDiagnostic {
  readonly severity: "info" | "warning" | "error";
  readonly code: string;
  readonly message: string;
  readonly safeDetails?: AssetMetadata;
}

export type ExternalRepositoryObjectLocalizationFailureCode =
  | "validation"
  | "permission"
  | "not-found"
  | "unavailable"
  | "internal";

export interface ExternalRepositoryObjectLocalizationFailure {
  readonly code: ExternalRepositoryObjectLocalizationFailureCode;
  readonly message: string;
  readonly diagnostics?: readonly ExternalRepositoryObjectLocalizationDiagnostic[];
  readonly safeDetails?: AssetMetadata;
}

export interface ExternalRepositoryObjectLocalizationSuccess {
  readonly ok: true;
  readonly status: "imported" | "localized" | "existing";
  readonly internalResourceRefs?: readonly AssetReference[];
  readonly internalBackings?: readonly AssetResourceBacking[];
  readonly externalObjectRef?: AssetExternalRepositoryObjectReference;
  readonly providerLabel?: string;
  readonly repositoryLabel?: string;
  readonly objectLabel?: string;
  readonly resultId?: string;
  readonly durableState?: boolean;
  readonly diagnostics?: readonly ExternalRepositoryObjectLocalizationDiagnostic[];
  readonly metadata?: AssetMetadata;
}

export interface ExternalRepositoryObjectLocalizationFailureResult {
  readonly ok: false;
  readonly failure: ExternalRepositoryObjectLocalizationFailure;
  readonly diagnostics?: readonly ExternalRepositoryObjectLocalizationDiagnostic[];
}

export type ExternalRepositoryObjectLocalizationResult =
  | ExternalRepositoryObjectLocalizationSuccess
  | ExternalRepositoryObjectLocalizationFailureResult;

export interface ExternalRepositoryObjectLocalizationPort {
  /**
   * Imports or localizes an already-known external repository object using
   * safe descriptor references only. Provider clients, credentials, network
   * access, byte reads, and storage writes must stay behind this seam.
   */
  processExternalRepositoryObject(
    request: ExternalRepositoryObjectLocalizationRequest,
  ): Promise<ExternalRepositoryObjectLocalizationResult>;
}
