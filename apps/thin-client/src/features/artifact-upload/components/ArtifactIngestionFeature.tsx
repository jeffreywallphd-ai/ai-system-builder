import { useMemo } from "react";

import {
  GuidedIngestionTaskPanel,
  PanelHeading,
} from "../../../../../../modules/ui/shared";
import type { ArtifactBrowserApiClient } from "../../artifact-browser/api/apiArtifactBrowserClient";
import { useArtifactBrowserClient } from "../../artifact-browser/hooks/useArtifactBrowserClient";
import { createApiIngestionTaskClient } from "../api/apiIngestionTaskClient";

export interface ArtifactIngestionFeatureProps {
  ingestionClient?: ArtifactBrowserApiClient;
  onUploadComplete?: () => void;
  workspaceId?: string;
}

export function ArtifactIngestionFeature({
  ingestionClient,
  onUploadComplete,
  workspaceId,
}: ArtifactIngestionFeatureProps) {
  const ingestionTaskClient = useMemo(() => createApiIngestionTaskClient(), []);
  const sourceBrowserClient = useArtifactBrowserClient(ingestionClient);

  return (
    <section className="ui-panel ui-panel--elevated ui-panel--sectioned">
      <header className="ui-panel__section-header">
        <PanelHeading icon="upload" tone="cyan">
          Add data
        </PanelHeading>
      </header>
      <div className="ui-panel__section-body ui-stack ui-stack--sm">
        <GuidedIngestionTaskPanel
          client={ingestionTaskClient}
          sourceBrowserClient={sourceBrowserClient}
          workspaceId={workspaceId}
          onComplete={onUploadComplete}
        />
      </div>
    </section>
  );
}
