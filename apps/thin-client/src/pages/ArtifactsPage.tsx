import { useMemo, useState } from "react";
import { ArtifactBrowserFeature } from "../features/artifact-browser";
import { ArtifactIngestionFeature } from "../features/artifact-upload";
import { DatasetPreparationFeature } from "../features/dataset-preparation";
import { TabbedPanel } from "../components/ui/TabbedPanel";
import { DatasetReviewWorkspace } from "../../../../modules/ui/shared/dataset-review";
import { PageDashboardHeader } from "../../../../modules/ui/shared";
import { createApiDatasetPreparationClient } from "../features/dataset-preparation";
import { ThinClientPageDashboard } from "../features/page-dashboard/ThinClientPageDashboard";

export interface WorkspaceScopedPageProps {
  workspaceId: string;
  workspaceName: string;
}
export function ArtifactsPage({ workspaceId }: WorkspaceScopedPageProps) {
  const [activeTabId, setActiveTabId] = useState("ingestion");
  const [preparedArtifactStorageKey, setPreparedArtifactStorageKey] =
    useState<string>();
  const onDatasetPrepared = (artifactStorageKey: string) => {
    setPreparedArtifactStorageKey(artifactStorageKey);
    setActiveTabId("browser");
  };
  const datasetReviewService = useMemo(() => {
    const client = createApiDatasetPreparationClient();
    return {
      listTargets: async (targetWorkspaceId: string) => {
        if (!client.listReviewTargets)
          throw new Error("Dataset review is unavailable.");
        return (
          await client.listReviewTargets({ workspaceId: targetWorkspaceId })
        ).groups;
      },
      readPage: async (
        input: Parameters<NonNullable<typeof client.readReviewPage>>[0],
      ) => {
        if (!client.readReviewPage)
          throw new Error("Dataset row review is unavailable.");
        return (await client.readReviewPage(input)).page;
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
    const client = createApiDatasetPreparationClient();
    return async (input: { workspaceId: string; artifactKey: string }) => {
      if (!client.readReviewPage)
        throw new Error("Parquet preview is unavailable.");
      return (
        await client.readReviewPage({ ...input, page: 0, pageSize: 10 })
      ).page;
    };
  }, []);
  return (
    <section className="ui-stack ui-stack--sm">
      <PageDashboardHeader
        title="Data Management"
        description="Add source data, prepare and review training datasets, and manage workspace artifacts."
        dashboard={
          <ThinClientPageDashboard kind="artifacts" workspaceId={workspaceId} />
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
                readParquetPreview={parquetPreviewReader}
                initialSelectedStorageKey={preparedArtifactStorageKey}
                onInitialSelectionHandled={() =>
                  setPreparedArtifactStorageKey(undefined)
                }
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
    </section>
  );
}
