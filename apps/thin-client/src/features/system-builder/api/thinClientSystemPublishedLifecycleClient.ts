import type {
  SystemDeploymentResult,
  SystemPublishedLifecycleProjection,
} from "../../../../../../modules/contracts/system-deployment";
import type { SystemPublishedLifecycleClient } from "../../../../../../modules/ui/shared/system-builder";
import { parseApiEnvelope } from "../../../security/apiErrorEnvelope";
import { secureFetch } from "../../../security/secureFetch";

const failure = (
  message = "Published system lifecycle is unavailable.",
  code = "unavailable",
): SystemDeploymentResult<SystemPublishedLifecycleProjection> => ({
  ok: false,
  error: { code, message },
});

async function request(
  url: string,
  init?: RequestInit,
): Promise<SystemDeploymentResult<SystemPublishedLifecycleProjection>> {
  try {
    const response = await secureFetch(url, init);
    const envelope = parseApiEnvelope(await response.json());
    if (envelope.ok)
      return {
        ok: true,
        value: envelope.value as SystemPublishedLifecycleProjection,
      };
    return failure(
      envelope.error?.message ?? "The published system lifecycle request failed.",
      envelope.error?.code ?? "internal",
    );
  } catch {
    return failure();
  }
}

export function createThinClientSystemPublishedLifecycleClient(
  baseUrl = "/api",
): SystemPublishedLifecycleClient {
  const root = baseUrl.replace(/\/+$/, "");
  return {
    read: (input) =>
      request(
        `${root}/systems/published-lifecycle?workspaceId=${encodeURIComponent(input.workspaceId)}&releaseId=${encodeURIComponent(input.releaseId)}`,
      ),
    invoke: (input) =>
      request(`${root}/systems/published-lifecycle/invoke`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input),
      }),
  };
}
