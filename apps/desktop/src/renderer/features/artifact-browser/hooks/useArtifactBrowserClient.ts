import { useMemo } from "react";

import { createDesktopArtifactBrowserClient, type DesktopArtifactBrowserClient } from "../api/desktopArtifactBrowserClient";

export function useArtifactBrowserClient(client?: DesktopArtifactBrowserClient): DesktopArtifactBrowserClient {
  return useMemo(() => client ?? createDesktopArtifactBrowserClient(), [client]);
}
