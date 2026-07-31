import type { AssetPackageClient, AssetPackageClientResult } from "../../../../../../../modules/ui/shared/asset-package";
import { getDesktopApi } from "../../../lib/desktopApi";

function unavailable<T>(message = "Asset package management is unavailable."): AssetPackageClientResult<T> {
  return { ok: false, error: { code: "unavailable", message } };
}

function unwrap<T>(response: unknown): AssetPackageClientResult<T> {
  const envelope = response as { ok?: boolean; value?: T; error?: { code?: string; message?: string } };
  return envelope?.ok
    ? { ok: true, value: envelope.value as T }
    : { ok: false, error: { code: envelope?.error?.code ?? "internal", message: envelope?.error?.message ?? "The request could not be completed." } };
}

export function createDesktopAssetPackageClient(): AssetPackageClient {
  const api = getDesktopApi();
  return {
    inspect: async (input) => api.inspectAssetPackage ? unwrap(await api.inspectAssetPackage(input)) : unavailable(),
    admit: async (input) => api.admitAssetPackage ? unwrap(await api.admitAssetPackage(input as never)) : unavailable(),
    list: async (workspaceId) => api.listAssetPackages ? unwrap(await api.listAssetPackages(workspaceId)) : unavailable(),
    activate: async (input) => api.activateAssetPackage ? unwrap(await api.activateAssetPackage(input as never)) : unavailable(),
    disable: async (input) => api.disableAssetPackage ? unwrap(await api.disableAssetPackage(input as never)) : unavailable(),
    rollback: async (input) => api.rollbackAssetPackage ? unwrap(await api.rollbackAssetPackage(input as never)) : unavailable(),
  };
}
