import type { ApiArtifactUploadClient } from "../api/apiArtifactUploadClient";
import type { ArtifactBrowserApiClient } from "../../artifact-browser/api/apiArtifactBrowserClient";
import { useEffect, useState } from "react";
import { CollapsiblePanel } from "../../../components/ui/CollapsiblePanel";
import { useArtifactUploadFeature } from "../hooks/useArtifactUploadFeature";
import { ArtifactUploadForm } from "./ArtifactUploadForm";
import { ArtifactScrapeForm } from "./ArtifactScrapeForm";
import { ArtifactHuggingFaceForm } from "./ArtifactHuggingFaceForm";
import { PanelHeading } from "../../../../../../modules/ui/shared";

export interface ArtifactIngestionFeatureProps {
  client?: ApiArtifactUploadClient;
  ingestionClient?: ArtifactBrowserApiClient;
  onUploadComplete?: () => void;
  workspaceId?: string;
  workspaceName?: string;
}

type ExpandedPanelsState = {
  uploadData: boolean;
  scrapeWebData: boolean;
  importFromHuggingFace: boolean;
};

const DEFAULT_EXPANDED_PANELS: ExpandedPanelsState = {
  uploadData: false,
  scrapeWebData: false,
  importFromHuggingFace: false,
};

const EXPANDED_PANELS_STORAGE_KEY = "thin-client.artifact-ingestion.expanded-panels";

let persistedExpandedPanels: ExpandedPanelsState = DEFAULT_EXPANDED_PANELS;

function isExpandedPanelsState(value: unknown): value is ExpandedPanelsState {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<Record<keyof ExpandedPanelsState, unknown>>;
  return (
    typeof candidate.uploadData === "boolean"
    && typeof candidate.scrapeWebData === "boolean"
    && typeof candidate.importFromHuggingFace === "boolean"
  );
}

function readStoredExpandedPanels(): ExpandedPanelsState {
  if (typeof window === "undefined") {
    return persistedExpandedPanels;
  }

  try {
    const storedValue = window.sessionStorage.getItem(EXPANDED_PANELS_STORAGE_KEY);
    if (!storedValue) {
      return DEFAULT_EXPANDED_PANELS;
    }

    const parsedValue = JSON.parse(storedValue) as unknown;
    if (!isExpandedPanelsState(parsedValue)) {
      return DEFAULT_EXPANDED_PANELS;
    }

    persistedExpandedPanels = parsedValue;
    return parsedValue;
  } catch {
    return DEFAULT_EXPANDED_PANELS;
  }
}

function writeStoredExpandedPanels(expandedPanels: ExpandedPanelsState): void {
  persistedExpandedPanels = expandedPanels;

  if (typeof window === "undefined") {
    return;
  }

  try {
    window.sessionStorage.setItem(EXPANDED_PANELS_STORAGE_KEY, JSON.stringify(expandedPanels));
  } catch {
    // Panel expansion is ephemeral UI state, so unavailable session storage should not affect ingestion.
  }
}

export function ArtifactIngestionFeature({ client, ingestionClient, onUploadComplete, workspaceId }: ArtifactIngestionFeatureProps) {
  const [expandedPanels, setExpandedPanels] = useState<ExpandedPanelsState>(() => readStoredExpandedPanels());

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
    writeStoredExpandedPanels(expandedPanels);
  }, [expandedPanels]);

  return (
    <section className="ui-panel ui-panel--elevated ui-panel--sectioned">
      <header className="ui-panel__section-header">
        <PanelHeading icon="upload" tone="cyan">Data Artifact Ingester</PanelHeading>
      </header>
      <div className="ui-panel__section-body ui-stack ui-stack--sm">
        <p>Please select a method below to add data to the system.</p>

        <CollapsiblePanel
          title="Upload data"
          contentId="thin-client-artifact-upload-panel-content"
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
          contentId="thin-client-artifact-scrape-panel-content"
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
            workspaceId={workspaceId}
          />
        </CollapsiblePanel>

        <CollapsiblePanel
          title="Import from Hugging Face"
          contentId="thin-client-artifact-huggingface-panel-content"
          isExpanded={expandedPanels.importFromHuggingFace}
          onToggle={() => togglePanel("importFromHuggingFace")}
        >
          <ArtifactHuggingFaceForm client={ingestionClient} onRegistered={() => onUploadComplete?.()} workspaceId={workspaceId} />
        </CollapsiblePanel>
      </div>
    </section>
  );
}
