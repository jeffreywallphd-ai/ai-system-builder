import type { SystemBuildClient } from "../../../../../../../modules/ui/shared/system-builder";
import type { SystemBuildResult } from "../../../../../../../modules/contracts/system-build";
import { getDesktopApi } from "../../../lib/desktopApi";

interface DesktopResultEnvelope {
  readonly ok?: boolean;
  readonly value?: unknown;
  readonly error?: { readonly code?: unknown; readonly message?: unknown };
}

const unavailable = <T,>(message = "System builds are unavailable.", code = "unavailable"): SystemBuildResult<T> => ({
  ok: false,
  error: { code, message },
});

function unwrap<T>(response: unknown): SystemBuildResult<T> {
  if (!response || typeof response !== "object" || Array.isArray(response)) return unavailable("The desktop build response was invalid.", "invalid-response");
  const envelope = response as DesktopResultEnvelope;
  if (envelope.ok === true) return { ok: true, value: envelope.value as T };
  const message = typeof envelope.error?.message === "string" ? envelope.error.message : "The system build request failed.";
  const code = typeof envelope.error?.code === "string" ? envelope.error.code : "internal";
  return unavailable(message, code);
}

export function createDesktopSystemBuildClient(): SystemBuildClient {
  const api = getDesktopApi();
  return {
    prepare: async (input) => typeof api.prepareSystemBuild === "function" ? unwrap(await api.prepareSystemBuild(input)) : unavailable(),
    request: async (input) => typeof api.requestSystemBuild === "function" ? unwrap(await api.requestSystemBuild(input)) : unavailable(),
    cancel: async (input) => typeof api.cancelSystemBuild === "function" ? unwrap(await api.cancelSystemBuild(input)) : unavailable(),
    listBuilds: async (input) => typeof api.listSystemBuilds === "function" ? unwrap(await api.listSystemBuilds(input)) : unavailable(),
    approve: async (input) => typeof api.approveSystemRelease === "function" ? unwrap(await api.approveSystemRelease(input)) : unavailable(),
    listReleases: async (input) => typeof api.listSystemReleases === "function" ? unwrap(await api.listSystemReleases(input)) : unavailable(),
    publicationWorkspace: async (input) => typeof api.listSystemPublicationWorkspace === "function" ? unwrap(await api.listSystemPublicationWorkspace(input)) : unavailable(),
    compare: async (input) => typeof api.compareSystemReleases === "function" ? unwrap(await api.compareSystemReleases(input)) : unavailable(),
  };
}
