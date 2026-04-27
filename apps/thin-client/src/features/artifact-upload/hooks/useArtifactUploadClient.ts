import { useMemo } from "react";

import { resolveApiBaseUrl } from "../../../lib";
import {
  createApiArtifactUploadClient,
  type ApiArtifactUploadClient,
} from "../api/apiArtifactUploadClient";

export function useArtifactUploadClient(client?: ApiArtifactUploadClient): ApiArtifactUploadClient {
  return useMemo(
    () => client ?? createApiArtifactUploadClient({ apiBaseUrl: resolveApiBaseUrl() }),
    [client],
  );
}
