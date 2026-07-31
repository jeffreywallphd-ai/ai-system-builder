export interface SystemBuildFailure { readonly code: string; readonly message: string; readonly field?: string; }
export type SystemBuildResult<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: SystemBuildFailure };
export const systemBuildSuccess = <T>(value: T): SystemBuildResult<T> => ({ ok: true, value });
export const systemBuildFailure = (code: string, message: string, field?: string): SystemBuildResult<never> => ({ ok: false, error: { code, message, ...(field ? { field } : {}) } });
