export interface SystemDeploymentFailure {
  readonly code: string;
  readonly message: string;
  readonly field?: string;
}

export type SystemDeploymentResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: SystemDeploymentFailure };

export const systemDeploymentSuccess = <T>(
  value: T,
): SystemDeploymentResult<T> => ({ ok: true, value });

export const systemDeploymentFailure = (
  code: string,
  message: string,
  field?: string,
): SystemDeploymentResult<never> => ({
  ok: false,
  error: { code, message, ...(field ? { field } : {}) },
});
