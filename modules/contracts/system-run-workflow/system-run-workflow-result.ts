export type SystemRunWorkflowFailureCode =
  | "workflow.validation"
  | "workflow.not-found"
  | "workflow.source-not-found"
  | "workflow.source-stale"
  | "workflow.unsupported"
  | "workflow.blocked"
  | "workflow.unauthorized"
  | "workflow.conflict"
  | "workflow.failed";

export interface SystemRunWorkflowFailure {
  readonly code: SystemRunWorkflowFailureCode;
  readonly message: string;
  readonly field?: string;
}

export type SystemRunWorkflowResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: SystemRunWorkflowFailure };

export const systemRunWorkflowSuccess = <T>(
  value: T,
): SystemRunWorkflowResult<T> => ({ ok: true, value });

export const systemRunWorkflowFailure = (
  code: SystemRunWorkflowFailureCode,
  message: string,
  field?: string,
): SystemRunWorkflowResult<never> => ({
  ok: false,
  error: {
    code,
    message,
    ...(field ? { field } : {}),
  },
});
