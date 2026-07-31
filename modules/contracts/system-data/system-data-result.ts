export interface SystemDataFailure {
  readonly code: string;
  readonly message: string;
  readonly field?: string;
}

export type SystemDataResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: SystemDataFailure };

export const systemDataSuccess = <T>(value: T): SystemDataResult<T> => ({ ok: true, value });

export const systemDataFailure = (code: string, message: string, field?: string): SystemDataResult<never> => ({
  ok: false,
  error: { code, message, ...(field ? { field } : {}) },
});
