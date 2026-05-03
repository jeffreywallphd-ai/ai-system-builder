import { useMemo } from "react";

import { createDesktopModelsClient, type DesktopModelsClient } from "../api/desktopModelsClient";

export function useModelsClient(client?: DesktopModelsClient): DesktopModelsClient {
  return useMemo(() => client ?? createDesktopModelsClient(), [client]);
}
