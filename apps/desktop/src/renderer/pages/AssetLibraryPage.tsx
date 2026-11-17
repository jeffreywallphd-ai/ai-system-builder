import { useMemo, useState } from "react";
import { AssetPackageManager } from "../../../../../modules/ui/shared/asset-package";
import { PageDashboardHeader } from "../../../../../modules/ui/shared";
import {
  AssetStudioWorkspace,
  SavedAssetDrafts,
} from "../../../../../modules/ui/shared/asset-studio";

import { TabbedPanel } from "../components/ui/TabbedPanel";
import { AssetAuthoringFeature } from "../features/asset-authoring/components/AssetAuthoringFeature";
import { createDesktopAssetAuthoringClient } from "../features/asset-authoring/api/desktopAssetAuthoringClient";
import { AssetLibraryFeature } from "../features/asset-library";
import { createDesktopAssetPackageClient } from "../features/asset-package/api/desktopAssetPackageClient";
import { createDesktopAssetStudioClient } from "../features/asset-studio/api/desktopAssetStudioClient";
import { DesktopPageDashboard } from "../features/page-dashboard/DesktopPageDashboard";

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
          <DesktopPageDashboard kind="assets" workspaceId={workspaceId} />
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
            content: <DesktopAssetPackages workspaceId={workspaceId} />,
          },
          {
            id: "studio",
            label: "Studio",
            content: (
              <DesktopAssetStudio
                workspaceId={workspaceId}
                initialDraftId={studioDraftId}
              />
            ),
          },
          {
            id: "saved",
            label: "Saved",
            content: (
              <DesktopSavedAssets
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

function DesktopAssetPackages({
  workspaceId,
}: {
  readonly workspaceId: string;
}) {
  const client = useMemo(() => createDesktopAssetPackageClient(), []);
  return <AssetPackageManager workspaceId={workspaceId} client={client} />;
}

function DesktopAssetStudio({
  workspaceId,
  initialDraftId,
}: {
  readonly workspaceId: string;
  readonly initialDraftId?: string;
}) {
  const client = useMemo(() => createDesktopAssetStudioClient(), []);
  return (
    <AssetStudioWorkspace
      workspaceId={workspaceId}
      client={client}
      initialDraftId={initialDraftId}
    />
  );
}

function DesktopSavedAssets({
  workspaceId,
  onOpenDraft,
}: {
  readonly workspaceId: string;
  readonly onOpenDraft: (draftId: string) => void;
}) {
  const client = useMemo(() => createDesktopAssetStudioClient(), []);
  const legacyClient = useMemo(() => createDesktopAssetAuthoringClient(), []);
  return (
    <SavedAssetDrafts
      workspaceId={workspaceId}
      client={client}
      legacyClient={legacyClient}
      onOpenDraft={onOpenDraft}
    />
  );
}
