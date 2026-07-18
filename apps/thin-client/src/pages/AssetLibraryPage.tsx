import { useMemo, useState } from "react";
import { AssetPackageManager } from "../../../../modules/ui/shared/asset-package";
import { AssetStudioManager } from "../../../../modules/ui/shared/asset-studio";

import { TabbedPanel } from "../components/ui/TabbedPanel";
import { AssetAuthoringFeature } from "../features/asset-authoring/components/AssetAuthoringFeature";
import { AssetLibraryFeature } from "../features/asset-library";
import { createThinClientAssetPackageClient } from "../features/asset-package/api/thinClientAssetPackageClient";
import { createThinClientAssetStudioClient } from "../features/asset-studio/api/thinClientAssetStudioClient";

export interface WorkspaceScopedPageProps {
  workspaceId: string;
  workspaceName: string;
}

export function AssetLibraryPage({ workspaceId }: WorkspaceScopedPageProps) {
  const [activeTabId, setActiveTabId] = useState("browse");
  const [initialCustomizationTarget, setInitialCustomizationTarget] = useState<{
    definitionId: string;
    version: string;
  }>();
  return (
    <section className="ui-stack ui-stack--sm">
      <h1>Assets</h1>
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
            id: "create",
            label: "Create",
            content: (
              <AssetAuthoringFeature
                workspaceId={workspaceId}
                initialSection="create"
              />
            ),
          },
          {
            id: "studio",
            label: "Studio",
            content: <ThinClientAssetStudio workspaceId={workspaceId} />,
          },
          {
            id: "drafts",
            label: "Drafts",
            content: (
              <AssetAuthoringFeature
                workspaceId={workspaceId}
                initialSection="drafts"
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
}: {
  readonly workspaceId: string;
}) {
  const client = useMemo(() => createThinClientAssetStudioClient(), []);
  return <AssetStudioManager workspaceId={workspaceId} client={client} />;
}
