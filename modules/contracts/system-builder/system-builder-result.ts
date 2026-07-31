export interface SystemBuilderFailure {
  readonly code: string;
  readonly message: string;
  readonly field?: string;
}

export type SystemBuilderResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: SystemBuilderFailure };

export const systemBuilderSuccess = <T>(value: T): SystemBuilderResult<T> => ({ ok: true, value });
export const systemBuilderFailure = (code: string, message: string, field?: string): SystemBuilderResult<never> => ({
  ok: false,
  error: { code, message, ...(field ? { field } : {}) },
});

