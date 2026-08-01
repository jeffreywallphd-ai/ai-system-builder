import { useMemo, useState } from "react";
import { AssetPackageManager } from "../../../../modules/ui/shared/asset-package";
import { PageDashboardHeader } from "../../../../modules/ui/shared";
import {
  AssetStudioWorkspace,
  SavedAssetDrafts,
} from "../../../../modules/ui/shared/asset-studio";

import { TabbedPanel } from "../components/ui/TabbedPanel";
import { AssetAuthoringFeature } from "../features/asset-authoring/components/AssetAuthoringFeature";
import { createThinClientAssetAuthoringClient } from "../features/asset-authoring/api/thinClientAssetAuthoringClient";
import { AssetLibraryFeature } from "../features/asset-library";
import { createThinClientAssetPackageClient } from "../features/asset-package/api/thinClientAssetPackageClient";
import { createThinClientAssetStudioClient } from "../features/asset-studio/api/thinClientAssetStudioClient";
import { ThinClientPageDashboard } from "../features/page-dashboard/ThinClientPageDashboard";

export interface WorkspaceScopedPageProps {
  workspaceId: string;
  workspaceName: string;
}

export function AssetLibraryPage({ workspaceId }: WorkspaceScopedPageProps) {
  const [activeTabId, setActiveTabId] = useState("browse");
  const [studioDraftId, setStudioDraftId] = useState<string>();
  const [initialCustomizationTarget, setInitialCustomizationTarget] = useState<{
    definitionId: string;
    version: string;
  }>();
  return (
    <section className="ui-stack ui-stack--sm">
      <PageDashboardHeader
        title="Assets"
        dashboard={
          <ThinClientPageDashboard kind="assets" workspaceId={workspaceId} />
        }
      />
      <TabbedPanel
        activeTabId={activeTabId}
        defaultTabId="browse"
        onTabChange={setActiveTabId}
        tabListAriaLabel="Assets sections"
        tabs={[
          {
            id: "browse",
            label: "Browse",
            content: (
              <AssetLibraryFeature
                key={`assets-${workspaceId}`}
                workspaceId={workspaceId}
                onCustomizeDefinition={(definition) => {
                  setInitialCustomizationTarget({
                    definitionId: String(definition.definitionId),
                    version: definition.version,
                  });
                  setActiveTabId("customizations");
                }}
              />
            ),
          },
          {
            id: "packages",
            label: "Import Assets",
            content: <ThinClientAssetPackages workspaceId={workspaceId} />,
          },
          {
            id: "studio",
            label: "Studio",
            content: (
              <ThinClientAssetStudio
                workspaceId={workspaceId}
                initialDraftId={studioDraftId}
              />
            ),
          },
          {
            id: "saved",
            label: "Saved",
            content: (
              <ThinClientSavedAssets
                workspaceId={workspaceId}
                onOpenDraft={(draftId) => {
                  setStudioDraftId(draftId);
                  setActiveTabId("studio");
                }}
              />
            ),
          },
          {
            id: "customizations",
            label: "Customizations",
            content: (
              <AssetAuthoringFeature
                workspaceId={workspaceId}
                initialSection="customizations"
                initialCustomizationTarget={initialCustomizationTarget}
              />
            ),
          },
        ]}
      />
    </section>
  );
}

function ThinClientAssetPackages({
  workspaceId,
}: {
  readonly workspaceId: string;
}) {
  const client = useMemo(() => createThinClientAssetPackageClient(), []);
  return <AssetPackageManager workspaceId={workspaceId} client={client} />;
}

function ThinClientAssetStudio({
  workspaceId,
  initialDraftId,
}: {
  readonly workspaceId: string;
  readonly initialDraftId?: string;
}) {
  const client = useMemo(() => createThinClientAssetStudioClient(), []);
  return (
    <AssetStudioWorkspace
      workspaceId={workspaceId}
      client={client}
      initialDraftId={initialDraftId}
    />
  );
}

function ThinClientSavedAssets({
  workspaceId,
  onOpenDraft,
}: {
  readonly workspaceId: string;
  readonly onOpenDraft: (draftId: string) => void;
}) {
  const client = useMemo(() => createThinClientAssetStudioClient(), []);
  const legacyClient = useMemo(
    () => createThinClientAssetAuthoringClient(),
    [],
  );
  return (
    <SavedAssetDrafts
      workspaceId={workspaceId}
      client={client}
      legacyClient={legacyClient}
      onOpenDraft={onOpenDraft}
    />
  );
}
