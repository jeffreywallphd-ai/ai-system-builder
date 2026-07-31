import { ArtifactBrowserFeature } from "../features/artifact-browser";
import { ArtifactIngestionFeature } from "../features/artifact-upload";
import { DatasetPreparationFeature } from "../features/dataset-preparation";
import { TabbedPanel } from "../components/ui/TabbedPanel";

export interface WorkspaceScopedPageProps {
  workspaceId: string;
  workspaceName: string;
}
export function ArtifactsPage({ workspaceId }: WorkspaceScopedPageProps) {
  return (
    <section className="ui-stack ui-stack--sm">
      <h1>Data Management</h1>
      <TabbedPanel
        tabListAriaLabel="Artifact workspace panels"
        defaultTabId="ingestion"
        tabs={[
          {
            id: "ingestion",
            label: "Artifact Ingestion",
            content: (
              <ArtifactIngestionFeature
                key={`ingest-${workspaceId}`}
                workspaceId={workspaceId}
              />
            ),
          },
          {
            id: "browser",
            label: "Artifact Browser",
            content: (
              <ArtifactBrowserFeature
                key={`browser-${workspaceId}`}
                workspaceId={workspaceId}
              />
            ),
          },
          {
            id: "dataset-preparation",
            label: "Dataset Preparation",
            content: (
              <DatasetPreparationFeature
                key={`dataset-${workspaceId}`}
                workspaceId={workspaceId}
              />
            ),
          },
        ]}
      />
    </section>
  );
}
