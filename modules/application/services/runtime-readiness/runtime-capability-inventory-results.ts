import type { RuntimeInventorySourceId, RuntimeInventorySourceKind, RuntimeProviderAvailabilityStatus } from "../../../contracts/runtime-readiness";

export type RuntimeCapabilityInventoryOperationResult<T> =
  | { readonly status: "success"; readonly value: T; readonly diagnostics: readonly string[] }
  | { readonly status: "partial-success"; readonly value: T; readonly diagnostics: readonly string[] }
  | { readonly status: "validation-failure"; readonly reason: string; readonly diagnostics: readonly string[] }
  | { readonly status: "not-found"; readonly reason: string; readonly diagnostics: readonly string[] }
  | { readonly status: "unavailable"; readonly reason: string; readonly diagnostics: readonly string[] };

export interface RuntimeCapabilitySummary {
  readonly capabilityId: string;
  readonly capabilityKind: string;
  readonly capabilityKey: string;
  readonly label: string;
  readonly summary?: string;
  readonly providerKind?: string;
  readonly availabilityStatus: RuntimeProviderAvailabilityStatus;
  readonly configurationStatus?: RuntimeProviderAvailabilityStatus;
  readonly diagnosticCount: number;
  readonly blockerCount: number;
  readonly inventorySourceId: RuntimeInventorySourceId;
  readonly inventorySourceKind: RuntimeInventorySourceKind;
}

export interface RuntimeProviderCandidateSummary {
  readonly providerCandidateId: string;
  readonly providerKind: string;
  readonly inventorySourceId: RuntimeInventorySourceId;
  readonly availabilityStatus: RuntimeProviderAvailabilityStatus;
  readonly configurationStatus?: RuntimeProviderAvailabilityStatus;
  readonly displayLabel: string;
  readonly capabilityCount: number;
  readonly diagnosticCount: number;
  readonly blockerCount: number;
}

export interface WorkspaceRuntimeCapabilitySummary {
  readonly inventorySources: number;
  readonly providerCandidates: number;
  readonly capabilities: number;
  readonly capabilitiesByKind: Readonly<Record<string, number>>;
  readonly providerKinds: Readonly<Record<string, number>>;
  readonly availabilityStatuses: Readonly<Record<string, number>>;
  readonly requiresConfigurationCount: number;
  readonly requiresPermissionCount: number;
  readonly blockedCount: number;
  readonly staleCount: number;
  readonly diagnosticCount: number;
  readonly lastCheckedAt?: string;
  readonly capabilitySummaries: readonly RuntimeCapabilitySummary[];
  readonly providerSummaries: readonly RuntimeProviderCandidateSummary[];
}
