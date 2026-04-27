import { useMemo } from "react";

import { resolveApiBaseUrl } from "../../../lib";
import {
  createApiArtifactBrowserClient,
  type ArtifactBrowserApiClient,
} from "../api/apiArtifactBrowserClient";

export function useArtifactBrowserClient(client?: ArtifactBrowserApiClient): ArtifactBrowserApiClient {
  return useMemo(
    () => client ?? createApiArtifactBrowserClient({ apiBaseUrl: resolveApiBaseUrl() }),
    [client],
  );
}
