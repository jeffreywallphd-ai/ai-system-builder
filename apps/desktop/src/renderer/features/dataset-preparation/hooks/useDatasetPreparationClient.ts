import { useMemo } from "react";

import {
  createDesktopDatasetPreparationClient,
  type DesktopDatasetPreparationClient,
} from "../api/desktopDatasetPreparationClient";

export function useDatasetPreparationClient(client?: DesktopDatasetPreparationClient): DesktopDatasetPreparationClient {
  return useMemo(() => client ?? createDesktopDatasetPreparationClient(), [client]);
}
