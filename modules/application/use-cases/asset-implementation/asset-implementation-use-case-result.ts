export type AssetImplementationUseCaseResult<T> =
  | { readonly ok: true; readonly value: T }
  | {
      readonly ok: false;
      readonly error: { readonly code: string; readonly message: string };
    };

export const implementationSuccess = <T>(
  value: T,
): AssetImplementationUseCaseResult<T> => ({ ok: true, value });
export const implementationFailure = <T>(
  code: string,
  message: string,
): AssetImplementationUseCaseResult<T> => ({
  ok: false,
  error: { code, message },
});
