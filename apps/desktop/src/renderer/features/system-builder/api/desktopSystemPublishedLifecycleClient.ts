import type {
  SystemDeploymentResult,
  SystemPublishedLifecycleProjection,
} from "../../../../../../../modules/contracts/system-deployment";
import type { SystemPublishedLifecycleClient } from "../../../../../../../modules/ui/shared/system-builder";
import { getDesktopApi } from "../../../lib/desktopApi";

interface Envelope {
  readonly ok?: boolean;
  readonly value?: unknown;
  readonly error?: { readonly code?: unknown; readonly message?: unknown };
}

const unavailable = <T,>(
  message = "Published system lifecycle is unavailable.",
  code = "unavailable",
): SystemDeploymentResult<T> => ({ ok: false, error: { code, message } });

function unwrap(response: unknown): SystemDeploymentResult<SystemPublishedLifecycleProjection> {
  if (!response || typeof response !== "object" || Array.isArray(response))
    return unavailable("The desktop lifecycle response was invalid.", "invalid-response");
  const envelope = response as Envelope;
  if (envelope.ok === true)
    return { ok: true, value: envelope.value as SystemPublishedLifecycleProjection };
  return unavailable(
    typeof envelope.error?.message === "string"
      ? envelope.error.message
      : "The published system lifecycle request failed.",
    typeof envelope.error?.code === "string" ? envelope.error.code : "internal",
  );
}

export function createDesktopSystemPublishedLifecycleClient(): SystemPublishedLifecycleClient {
  const api = getDesktopApi();
  return {
    read: async (input) =>
      typeof api.readPublishedSystemLifecycle === "function"
        ? unwrap(await api.readPublishedSystemLifecycle(input))
        : unavailable(),
    invoke: async (input) =>
      typeof api.invokePublishedSystemLifecycle === "function"
        ? unwrap(await api.invokePublishedSystemLifecycle(input))
        : unavailable(),
  };
}
