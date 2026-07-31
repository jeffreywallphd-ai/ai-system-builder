export type AssetPackageResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: { readonly code: string; readonly message: string } };

export const packageSuccess = <T>(value: T): AssetPackageResult<T> => ({ ok: true, value });
export const packageFailure = <T>(code: string, message: string): AssetPackageResult<T> => ({ ok: false, error: { code, message } });
