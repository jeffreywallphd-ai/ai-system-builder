import type { AssetPackageClient, AssetPackageClientResult } from "../../../../../../modules/ui/shared/asset-package";
import { parseApiEnvelope } from "../../../security/apiErrorEnvelope";
import { secureFetch } from "../../../security/secureFetch";

function failure<T>(message = "Asset package management is unavailable.", code = "unavailable"): AssetPackageClientResult<T> {
  return { ok: false, error: { code, message } };
}

async function request<T>(url: string, init?: RequestInit): Promise<AssetPackageClientResult<T>> {
  try {
    const response = await secureFetch(url, init);
    const envelope = parseApiEnvelope(await response.json()) as { ok: boolean; value?: T; error?: { code?: string; message?: string } };
    return envelope.ok
      ? { ok: true, value: envelope.value as T }
      : failure(envelope.error?.message ?? "The request could not be completed.", envelope.error?.code ?? "internal");
  } catch {
    return failure();
  }
}

function post<T>(url: string, body: unknown): Promise<AssetPackageClientResult<T>> {
  return request(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
}

function encodeBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, Math.min(offset + chunkSize, bytes.length)));
  }
  return btoa(binary);
}

export function createThinClientAssetPackageClient(baseUrl = "/api"): AssetPackageClient {
  const root = baseUrl.replace(/\/+$/, "");
  return {
    inspect: ({ workspaceId, bytes }) => post(`${root}/asset-packages/inspect`, { workspaceId, contentBase64: encodeBase64(bytes) }),
    admit: (input) => post(`${root}/asset-packages/admit`, input),
    list: (workspaceId) => request(`${root}/asset-packages?workspaceId=${encodeURIComponent(workspaceId)}`),
    activate: (input) => post(`${root}/asset-packages/activate`, input),
    disable: (input) => post(`${root}/asset-packages/disable`, input),
    rollback: (input) => post(`${root}/asset-packages/rollback`, input),
  };
}
