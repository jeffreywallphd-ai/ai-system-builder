import type { ArtifactUploadClient } from "../api/desktopArtifactUploadClient";
import type { DesktopArtifactBrowserClient } from "../../artifact-browser/api/desktopArtifactBrowserClient";
import { useEffect, useState } from "react";
import { CollapsiblePanel } from "../../../components/ui/CollapsiblePanel";
import { useArtifactUploadFeature } from "../hooks/useArtifactUploadFeature";
import { ArtifactUploadForm } from "./ArtifactUploadForm";
import { ArtifactScrapeForm } from "./ArtifactScrapeForm";
import { ArtifactHuggingFaceForm } from "./ArtifactHuggingFaceForm";
import { PanelHeading } from "../../../../../../../modules/ui/shared";

export interface ArtifactIngestionFeatureProps {
  client?: ArtifactUploadClient;
  ingestionClient?: DesktopArtifactBrowserClient;
  onUploadComplete?: () => void;
  workspaceId?: string;
  workspaceName?: string;
}

type ExpandedPanelsState = {
  uploadData: boolean;
  scrapeWebData: boolean;
  importFromHuggingFace: boolean;
};

let persistedExpandedPanels: ExpandedPanelsState = {
  uploadData: true,
  scrapeWebData: false,
  importFromHuggingFace: false,
};

export function ArtifactIngestionFeature({ client, ingestionClient, onUploadComplete, workspaceId }: ArtifactIngestionFeatureProps) {
  const shouldPersistPanelState = client === undefined && ingestionClient === undefined;
  const [expandedPanels, setExpandedPanels] = useState<ExpandedPanelsState>(shouldPersistPanelState ? persistedExpandedPanels : {
    uploadData: true,
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
    selectedFiles,
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
    onCancelUpload,
    setWebsiteSingleUrl,
    setWebsiteSingleMode,
    setWebsiteBatchInput,
    setWebsiteBatchMode,
    ingestWebsiteSingle,
    ingestWebsiteBatch,
  } = useArtifactUploadFeature(client, onUploadComplete, workspaceId);

  useEffect(() => {
    if (!shouldPersistPanelState) return;
    persistedExpandedPanels = expandedPanels;
  }, [expandedPanels, shouldPersistPanelState]);

  return (
    <section className="ui-panel ui-panel--elevated ui-panel--sectioned">
      <header className="ui-panel__section-header">
        <PanelHeading icon="upload" tone="cyan">Data Artifact Ingester</PanelHeading>
      </header>
      <div className="ui-panel__section-body ui-stack ui-stack--sm">
        <p>Please select a method below to add data to the system.</p>

        <CollapsiblePanel
          title="Upload data"
          contentId="artifact-upload-panel-content"
          isExpanded={expandedPanels.uploadData}
          onToggle={() => togglePanel("uploadData")}
        >
          <ArtifactUploadForm
            selectedFiles={selectedFiles}
            viewState={viewState}
            acceptedFileTypes={acceptedFileTypes}
            onFileChange={onFileChange}
            onSubmit={(event) => void onUploadSubmit(event)}
            onCancelUpload={onCancelUpload}
            workspaceId={workspaceId}
          />
        </CollapsiblePanel>

        <CollapsiblePanel
          title="Scrape web data"
          contentId="artifact-scrape-panel-content"
          isExpanded={expandedPanels.scrapeWebData}
          onToggle={() => togglePanel("scrapeWebData")}
        >
          {expandedPanels.scrapeWebData ? (
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
              workspaceId={workspaceId}
            />
          ) : <p>Open this section to configure website scraping.</p>}
        </CollapsiblePanel>

        <CollapsiblePanel
          title="Import from Hugging Face"
          contentId="artifact-huggingface-panel-content"
          isExpanded={expandedPanels.importFromHuggingFace}
          onToggle={() => togglePanel("importFromHuggingFace")}
        >
          {expandedPanels.importFromHuggingFace ? (
            <ArtifactHuggingFaceForm client={ingestionClient} onRegistered={() => onUploadComplete?.()} workspaceId={workspaceId} />
          ) : <p>Open this section to register or import Hugging Face artifacts.</p>}
        </CollapsiblePanel>
      </div>
    </section>
  );
}
