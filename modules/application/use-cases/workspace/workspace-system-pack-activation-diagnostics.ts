import type { WorkspaceSystemPackActivationDiagnostic } from "../../../contracts/workspace";

export type WorkspaceSystemPackActivationDiagnosticCode =
  | "workspace-system-pack-activation-list-failed"
  | "workspace-system-pack-activation-unknown-pack"
  | "workspace-system-pack-activation-invalid-provenance"
  | "workspace-system-pack-activation-inactive"
  | "workspace-system-pack-activation-failed"
  | "workspace-system-pack-activation-duplicate-id"
  | "workspace-system-pack-activation-duplicate-pack"
  | "workspace-system-pack-activation-status-update-failed"
  | "workspace-system-pack-activation-status-invalid"
  | "workspace-system-pack-activation-workspace-id-invalid"
  | "workspace-system-pack-activation-activation-id-invalid"
  | "workspace-system-pack-activation-not-found";

export type WorkspaceSystemPackActivationIssueCode =
  | "workspace-system-pack-activation-status-update-failed"
  | "workspace-system-pack-activation-status-invalid"
  | "workspace-system-pack-activation-workspace-id-invalid"
  | "workspace-system-pack-activation-activation-id-invalid"
  | "workspace-system-pack-activation-not-found"
  | "workspace-system-pack-activation-unknown-pack"
  | "workspace-system-pack-activation-invalid-provenance"
  | "workspace-system-pack-activation-failed";

export interface WorkspaceSystemPackActivationIssue {
  readonly code: WorkspaceSystemPackActivationIssueCode;
  readonly message: string;
}

export function workspaceSystemPackActivationDiagnostic(
  code: WorkspaceSystemPackActivationDiagnosticCode,
  severity: WorkspaceSystemPackActivationDiagnostic["severity"],
  message: string,
): WorkspaceSystemPackActivationDiagnostic {
  return { code, severity, message };
}

export function workspaceSystemPackActivationIssue(
  code: WorkspaceSystemPackActivationIssueCode,
  message: string,
): WorkspaceSystemPackActivationIssue {
  return { code, message };
}
