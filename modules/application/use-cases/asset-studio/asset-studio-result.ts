import type { AssetStudioDiagnostic, AssetStudioResult } from "../../../contracts/asset-studio";

export const studioSuccess = <T>(value: T): AssetStudioResult<T> => ({ ok: true, value });
export const studioFailure = <T>(code: string, message: string, diagnostics?: readonly AssetStudioDiagnostic[]): AssetStudioResult<T> => ({ ok: false, error: { code, message, ...(diagnostics?.length ? { diagnostics } : {}) } });
