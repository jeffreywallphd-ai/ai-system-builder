export type WorkspaceUseCaseIssueCode =
  | "workspace-display-name-required"
  | "workspace-display-name-invalid"
  | "workspace-id-generation-failed"
  | "workspace-id-invalid"
  | "workspace-already-exists"
  | "workspace-save-failed"
  | "workspace-system-pack-activation-save-failed"
  | "workspace-selection-save-failed";

export type WorkspaceUseCaseDiagnosticCode =
  | "workspace-display-name-normalized"
  | "workspace-create-validation-failed"
  | "workspace-create-reference-only-system-foundation-activation"
  | "workspace-create-system-foundation-activation-disabled"
  | "workspace-create-workspace-persisted"
  | "workspace-create-active-selection-persisted"
  | WorkspaceUseCaseIssueCode;

export type WorkspaceUseCaseSeverity = "info" | "warning" | "error";

export interface WorkspaceUseCaseIssue {
  readonly code: WorkspaceUseCaseIssueCode;
  readonly message: string;
}

export interface WorkspaceUseCaseDiagnostic {
  readonly code: WorkspaceUseCaseDiagnosticCode;
  readonly severity: WorkspaceUseCaseSeverity;
  readonly message: string;
}

export function workspaceIssue(
  code: WorkspaceUseCaseIssueCode,
  message: string,
): WorkspaceUseCaseIssue {
  return { code, message };
}

export function workspaceDiagnostic(
  code: WorkspaceUseCaseDiagnosticCode,
  severity: WorkspaceUseCaseSeverity,
  message: string,
): WorkspaceUseCaseDiagnostic {
  return { code, severity, message };
}
