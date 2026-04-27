import { ArtifactBrowserFeature } from "../features/artifact-browser";
import { ArtifactIngestionFeature } from "../features/artifact-upload";
import { TabbedPanel } from "../components/ui/TabbedPanel";

export interface ArtifactsPageProps {
  refreshToken: number;
  onUploaded: () => void;
}

export function ArtifactsPage({ refreshToken, onUploaded }: ArtifactsPageProps) {
  return (
    <section className="ui-stack ui-stack--sm" data-refresh-token={refreshToken}>
      <TabbedPanel
        tabListAriaLabel="Artifact workspace panels"
        defaultTabId="ingestion"
        tabs={[
          {
            id: "ingestion",
            label: "Artifact Ingestion",
            content: <ArtifactIngestionFeature onUploadComplete={onUploaded} />,
          },
          {
            id: "browser",
            label: "Artifact Browser",
            content: <ArtifactBrowserFeature key={refreshToken} />,
          },
        ]}
      />
    </section>
  );
}

