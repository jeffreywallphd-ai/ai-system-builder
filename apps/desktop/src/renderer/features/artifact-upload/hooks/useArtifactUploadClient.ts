import { useMemo } from "react";

import {
  createDesktopArtifactUploadClient,
  type ArtifactUploadClient,
} from "../api/desktopArtifactUploadClient";

export function useArtifactUploadClient(client?: ArtifactUploadClient): ArtifactUploadClient {
  return useMemo(() => client ?? createDesktopArtifactUploadClient(), [client]);
}
