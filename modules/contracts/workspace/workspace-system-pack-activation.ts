import type {
  AssetPackId,
  AssetPackVersion,
} from "../asset";
import type { WorkspaceActorReference } from "./workspace-actor-reference";
import type { WorkspaceId } from "./workspace-id";

/**
 * Constrained extension point for safe passive metadata. Contract-level helpers do
 * not sanitize arbitrary values yet; application services/adapters that create
 * workspace records must keep paths, secrets, raw provider payloads, bytes,
 * command lines, stack traces, and env values out of persisted/public metadata.
 */
export type WorkspaceMetadata = Readonly<Record<string, unknown>>;

export const WORKSPACE_SYSTEM_PACK_ACTIVATION_STATUSES = [
  "active",
  "inactive",
  "failed",
] as const;

export type WorkspaceSystemPackActivationStatus =
  (typeof WORKSPACE_SYSTEM_PACK_ACTIVATION_STATUSES)[number];

export const WORKSPACE_SYSTEM_PACK_ACTIVATION_DIAGNOSTIC_SEVERITIES = [
  "info",
  "warning",
  "error",
] as const;

export type WorkspaceSystemPackActivationDiagnosticSeverity =
  (typeof WORKSPACE_SYSTEM_PACK_ACTIVATION_DIAGNOSTIC_SEVERITIES)[number];

export interface WorkspaceSystemPackActivationDiagnostic {
  readonly code: string;
  readonly severity: WorkspaceSystemPackActivationDiagnosticSeverity;
  readonly message: string;
}

/**
 * Workspace-level reference to a system pack activation. It references the pack
 * by id/version only and does not embed/copy/install manifest definitions,
 * asset entries, bytes, provider payloads, or system pack contents.
 */
export interface WorkspaceSystemPackActivation {
  readonly activationId: string;
  readonly workspaceId: WorkspaceId;
  readonly packId: AssetPackId;
  readonly packVersion: AssetPackVersion;
  readonly sourceKind: "system";
  readonly sourceLayer: "system-default";
  readonly trustStatus: "system-trusted";
  readonly status: WorkspaceSystemPackActivationStatus;
  readonly activatedAt: string;
  readonly activatedByActorRef?: WorkspaceActorReference;
  readonly diagnostics?: readonly WorkspaceSystemPackActivationDiagnostic[];
  readonly metadata?: WorkspaceMetadata;
}

export function isWorkspaceSystemPackActivationStatus(
  value: unknown,
): value is WorkspaceSystemPackActivationStatus {
  return WORKSPACE_SYSTEM_PACK_ACTIVATION_STATUSES.includes(
    value as WorkspaceSystemPackActivationStatus,
  );
}

export function isWorkspaceSystemPackActivationDiagnosticSeverity(
  value: unknown,
): value is WorkspaceSystemPackActivationDiagnosticSeverity {
  return WORKSPACE_SYSTEM_PACK_ACTIVATION_DIAGNOSTIC_SEVERITIES.includes(
    value as WorkspaceSystemPackActivationDiagnosticSeverity,
  );
}
