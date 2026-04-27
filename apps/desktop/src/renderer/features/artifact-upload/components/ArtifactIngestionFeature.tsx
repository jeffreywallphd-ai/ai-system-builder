import type { ArtifactUploadClient } from "../api/desktopArtifactUploadClient";
import type { DesktopArtifactBrowserClient } from "../../artifact-browser/api/desktopArtifactBrowserClient";
import { useState } from "react";
import { CollapsiblePanel } from "../../../components/ui/CollapsiblePanel";
import { useArtifactUploadFeature } from "../hooks/useArtifactUploadFeature";
import { ArtifactUploadForm } from "./ArtifactUploadForm";
import { ArtifactScrapeForm } from "./ArtifactScrapeForm";
import { ArtifactHuggingFaceForm } from "./ArtifactHuggingFaceForm";

export interface ArtifactIngestionFeatureProps {
  client?: ArtifactUploadClient;
  ingestionClient?: DesktopArtifactBrowserClient;
  onUploadComplete?: () => void;
}

export function ArtifactIngestionFeature({ client, ingestionClient, onUploadComplete }: ArtifactIngestionFeatureProps) {
  const [expandedPanels, setExpandedPanels] = useState({
    uploadData: false,
    scrapeWebData: false,
    importFromHuggingFace: false,
  });

  function togglePanel(panel: keyof typeof expandedPanels): void {
    setExpandedPanels((current) => ({
      ...current,
      [panel]: !current[panel],
    }));
  }

  const {
    selectedFile,
    viewState,
    acceptedFileTypes,
    websiteSingleUrl,
    websiteSingleMode,
    websiteBatchInput,
    websiteBatchMode,
    websiteSingleViewState,
    websiteBatchViewState,
    onFileChange,
    onUploadSubmit,
    setWebsiteSingleUrl,
    setWebsiteSingleMode,
    setWebsiteBatchInput,
    setWebsiteBatchMode,
    ingestWebsiteSingle,
    ingestWebsiteBatch,
  } = useArtifactUploadFeature(client, onUploadComplete);

  return (
    <section className="ui-panel ui-panel--elevated ui-stack ui-stack--sm">
      <h1>Data Artifact Ingester</h1>
      <p>Please select a method below to add data to the system.</p>

      <CollapsiblePanel
        title="Upload data"
        contentId="artifact-upload-panel-content"
        isExpanded={expandedPanels.uploadData}
        onToggle={() => togglePanel("uploadData")}
      >
        <ArtifactUploadForm
          selectedFile={selectedFile}
          viewState={viewState}
          acceptedFileTypes={acceptedFileTypes}
          onFileChange={onFileChange}
          onSubmit={(event) => void onUploadSubmit(event)}
        />
      </CollapsiblePanel>

      <CollapsiblePanel
        title="Scrape web data"
        contentId="artifact-scrape-panel-content"
        isExpanded={expandedPanels.scrapeWebData}
        onToggle={() => togglePanel("scrapeWebData")}
      >
        <ArtifactScrapeForm
          websiteSingleUrl={websiteSingleUrl}
          websiteSingleMode={websiteSingleMode}
          websiteBatchInput={websiteBatchInput}
          websiteBatchMode={websiteBatchMode}
          websiteSingleViewState={websiteSingleViewState}
          websiteBatchViewState={websiteBatchViewState}
          setWebsiteSingleUrl={setWebsiteSingleUrl}
          setWebsiteSingleMode={setWebsiteSingleMode}
          setWebsiteBatchInput={setWebsiteBatchInput}
          setWebsiteBatchMode={setWebsiteBatchMode}
          ingestWebsiteSingle={ingestWebsiteSingle}
          ingestWebsiteBatch={ingestWebsiteBatch}
        />
      </CollapsiblePanel>

      <CollapsiblePanel
        title="Import from HuggingFace"
        contentId="artifact-huggingface-panel-content"
        isExpanded={expandedPanels.importFromHuggingFace}
        onToggle={() => togglePanel("importFromHuggingFace")}
      >
        <ArtifactHuggingFaceForm client={ingestionClient} onRegistered={() => onUploadComplete?.()} />
      </CollapsiblePanel>
    </section>
  );
}

