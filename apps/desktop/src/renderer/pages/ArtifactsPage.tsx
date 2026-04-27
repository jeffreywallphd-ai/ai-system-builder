import { useState } from "react";

import { ArtifactBrowserFeature } from "../features/artifact-browser";
import { ArtifactIngestionFeature } from "../features/artifact-upload/components/ArtifactIngestionFeature";
import { DatasetPreparationFeature } from "../features/dataset-preparation/components/DatasetPreparationFeature";
import { PythonRuntimeFooter } from "../features/python-runtime/components/PythonRuntimeFooter";
import { TabbedPanel } from "../components/ui/TabbedPanel";

export interface ArtifactsPageProps {
  refreshToken: number;
  onUploaded: () => void;
}

export function ArtifactsPage({ refreshToken, onUploaded }: ArtifactsPageProps) {
  const [activeTabId, setActiveTabId] = useState("ingestion");

  return (
    <section className="ui-stack ui-stack--sm" data-refresh-token={refreshToken}>
      <h1>Data Management</h1>
      <p>Use the Artifact Ingestion tool to add data artifacts into the system and view/manage data artifacts with the Artifact Browser</p>
      <TabbedPanel
        tabListAriaLabel="Artifact workspace panels"
        defaultTabId="ingestion"
        onTabChange={setActiveTabId}
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
          {
            id: "dataset-preparation",
            label: "Dataset Preparation",
            content: <DatasetPreparationFeature onPrepared={onUploaded} />,
          },
        ]}
      />
      <PythonRuntimeFooter enabled={activeTabId === "dataset-preparation"} />
    </section>
  );
}
