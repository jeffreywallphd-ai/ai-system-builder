import type {
  AssetImplementationReleaseSummary,
  AssetImplementationResolutionRequest,
  AssetImplementationResolutionResult,
} from "../../../../../../modules/contracts/asset-implementation";
import { parseApiEnvelope } from "../../../security/apiErrorEnvelope";
import { secureFetch } from "../../../security/secureFetch";

export function createThinClientAssetImplementationClient(base = "/api") {
  const root = base.replace(/\/+$/, "");
  const value = <T>(raw: unknown): T => {
    const envelope = parseApiEnvelope(raw);
    if (!envelope.ok) {
      throw new Error(
        envelope.error?.message ?? "Asset implementation request failed.",
      );
    }
    return envelope.value as T;
  };
  return {
    async listReleases(
      workspaceId: string,
    ): Promise<readonly AssetImplementationReleaseSummary[]> {
      const response = await secureFetch(
        `${root}/asset-implementations/releases?workspaceId=${encodeURIComponent(workspaceId)}`,
        { method: "GET" },
      );
      return value<readonly AssetImplementationReleaseSummary[]>(
        await response.json(),
      );
    },
    async resolve(
      request: AssetImplementationResolutionRequest,
    ): Promise<AssetImplementationResolutionResult> {
      const response = await secureFetch(
        `${root}/asset-implementations/resolve`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(request),
        },
      );
      return value<AssetImplementationResolutionResult>(await response.json());
    },
  };
}
