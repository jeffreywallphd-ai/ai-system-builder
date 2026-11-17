import { useEffect, useMemo, useState } from "react";

import { ArtifactBrowserFeature } from "../features/artifact-browser";
import { ArtifactIngestionFeature } from "../features/artifact-upload/components/ArtifactIngestionFeature";
import { DatasetPreparationFeature } from "../features/dataset-preparation/components/DatasetPreparationFeature";
import { PythonRuntimeFooter } from "../features/python-runtime/components/PythonRuntimeFooter";
import { TabbedPanel } from "../components/ui/TabbedPanel";
import { DatasetReviewWorkspace } from "../../../../../modules/ui/shared/dataset-review";
import { PageDashboardHeader } from "../../../../../modules/ui/shared";
import { createDesktopDatasetPreparationClient } from "../features/dataset-preparation/api/desktopDatasetPreparationClient";
import { DesktopPageDashboard } from "../features/page-dashboard/DesktopPageDashboard";
import { createDesktopContextManagementClient } from "../features/context-management/api/desktopContextManagementClient";

import type { DatasetVersionPanelService } from "../../../../../modules/ui/shared/dataset-version";
import { useDatasetVersionReplayHandoff } from "../../../../../modules/ui/shared/dataset-version/useDatasetVersionReplayHandoff";

export interface ArtifactsPageProps {
  workspaceId: string;
  workspaceName: string;
  refreshToken: number;
  onUploaded: () => void;
  initialSelectedStorageKey?: string;
  onInitialSelectionHandled?: () => void;
  onConvertToRag?: (artifactId: string) => void;
}

export function ArtifactsPage({
  workspaceId,
  refreshToken,
  onUploaded,
  initialSelectedStorageKey,
  onInitialSelectionHandled,
  onConvertToRag,
}: ArtifactsPageProps) {
  const [activeTabId, setActiveTabId] = useState("ingestion");
  const replayHandoff = useDatasetVersionReplayHandoff(workspaceId, activeTabId === "dataset-preparation", () => setActiveTabId("dataset-preparation"));
  const [preparedArtifactStorageKey, setPreparedArtifactStorageKey] =
    useState<string>();
  const onDatasetPrepared = (artifactStorageKey: string) => {
    setPreparedArtifactStorageKey(artifactStorageKey);
    setActiveTabId("browser");
    onUploaded();
  };
  const datasetVersionService = useMemo<DatasetVersionPanelService>(() => {
    const client = createDesktopDatasetPreparationClient();
    return {
      list: async (workspaceId, datasetId) => {
        if (!client.listVersions) throw new Error("Version history is unavailable.");
        return client.listVersions(workspaceId, datasetId);
      },
      compare: async (workspaceId, fromVersionId, toVersionId) => {
        if (!client.compareVersions) throw new Error("Version comparison is unavailable.");
        return client.compareVersions(workspaceId, fromVersionId, toVersionId);
      },
      reproduce: async (workspaceId, versionId) => {
        if (!client.readReproduction) throw new Error("Saved setup is unavailable.");
        return client.readReproduction(workspaceId, versionId);
      },
      publish: async input => {
        if (!client.publishVersion) throw new Error("Version publication is unavailable.");
        return client.publishVersion(input);
      },
    };
  }, []);
  const datasetReviewService = useMemo(() => {
    const client = createDesktopDatasetPreparationClient();
    return {
      listTargets: async (targetWorkspaceId: string) => {
        if (!client.listReviewTargets)
          throw new Error("Dataset review is unavailable.");
        return client.listReviewTargets(targetWorkspaceId);
      },
      readPage: async (
        input: Parameters<NonNullable<typeof client.readReviewPage>>[0],
      ) => {
        if (!client.readReviewPage)
          throw new Error("Dataset row review is unavailable.");
        return client.readReviewPage(input);
      },
      rejectRow: async (
        input: Parameters<NonNullable<typeof client.rejectReviewRow>>[0],
      ) => {
        if (!client.rejectReviewRow)
          throw new Error("Dataset row rejection is unavailable.");
        return client.rejectReviewRow(input);
      },
      editRow: async (
        input: Parameters<NonNullable<typeof client.editReviewRow>>[0],
      ) => {
        if (!client.editReviewRow)
          throw new Error("Dataset row editing is unavailable.");
        return client.editReviewRow(input);
      },
    };
  }, []);
  const parquetPreviewReader = useMemo(() => {
    const client = createDesktopDatasetPreparationClient();
    return async (input: { workspaceId: string; artifactKey: string }) => {
      if (!client.readReviewPage)
        throw new Error("Parquet preview is unavailable.");
      return client.readReviewPage({ ...input, page: 0, pageSize: 10 });
    };
  }, []);
  const contextClient = useMemo(
    () => createDesktopContextManagementClient(),
    [],
  );
  const readContextConversionReadiness = useMemo(
    () => async (artifactId: string) => {
      const result = await contextClient.execute({
        workspaceId,
        command: {
          action: "source-inspect",
          artifactId,
          chunking: {
            strategy: "structure-aware",
            chunkCharacters: 1200,
            overlapCharacters: 120,
            maximumChunks: 10000,
          },
        },
      });
      if (result.action !== "source-inspect") {
        throw new Error("Context readiness response was invalid.");
      }
      return result.readiness;
    },
    [contextClient, workspaceId],
  );

  useEffect(() => {
    if (initialSelectedStorageKey) setActiveTabId("browser");
  }, [initialSelectedStorageKey]);

  return (
    <section
      className="ui-stack ui-stack--sm"
      data-refresh-token={refreshToken}
    >
      <PageDashboardHeader
        title="Data Management"
        description="Add source data, prepare and review training datasets, and manage workspace artifacts."
        dashboard={
          <DesktopPageDashboard kind="artifacts" workspaceId={workspaceId} />
        }
      />
      <TabbedPanel
        tabListAriaLabel="Artifact workspace panels"
        activeTabId={activeTabId}
        defaultTabId="ingestion"
        onTabChange={setActiveTabId}
        tabs={[
          {
            id: "ingestion",
            label: "Artifact Ingestion",
            content: (
              <ArtifactIngestionFeature
                key={`ingest-${workspaceId}`}
                workspaceId={workspaceId}
                onUploadComplete={onUploaded}
              />
            ),
          },
          {
            id: "browser",
            label: "Artifact Browser",
            content: (
              <ArtifactBrowserFeature
                key={`${workspaceId}-${refreshToken}`}
                workspaceId={workspaceId}
                datasetVersionService={datasetVersionService}
                onReuseDatasetVersion={replayHandoff.enqueue}
                readParquetPreview={parquetPreviewReader}
                initialSelectedStorageKey={
                  preparedArtifactStorageKey ?? initialSelectedStorageKey
                }
                onInitialSelectionHandled={() => {
                  if (preparedArtifactStorageKey) {
                    setPreparedArtifactStorageKey(undefined);
                  } else {
                    onInitialSelectionHandled?.();
                  }
                }}
                readContextConversionReadiness={readContextConversionReadiness}
                onConvertToRag={onConvertToRag}
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
                onPrepared={onDatasetPrepared}
                replayHandoff={replayHandoff}
              />
            ),
          },
          {
            id: "dataset-review",
            label: "Dataset Review",
            content: (
              <DatasetReviewWorkspace
                key={`review-${workspaceId}`}
                workspaceId={workspaceId}
                service={datasetReviewService}
              />
            ),
          },
        ]}
      />
      <PythonRuntimeFooter
        enabled={
          activeTabId === "dataset-preparation" ||
          activeTabId === "dataset-review"
        }
      />
    </section>
  );
}
