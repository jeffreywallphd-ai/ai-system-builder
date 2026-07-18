import { useMemo } from "react";
import { AssetPackageManager } from "../../../../../modules/ui/shared/asset-package";
import { AssetStudioManager } from "../../../../../modules/ui/shared/asset-studio";

import { TabbedPanel } from "../components/ui/TabbedPanel";
import { AssetAuthoringFeature } from "../features/asset-authoring/components/AssetAuthoringFeature";
import { AssetLibraryFeature } from "../features/asset-library";
import { createDesktopAssetPackageClient } from "../features/asset-package/api/desktopAssetPackageClient";
import { createDesktopAssetStudioClient } from "../features/asset-studio/api/desktopAssetStudioClient";

export interface WorkspaceScopedPageProps {
  workspaceId: string;
  workspaceName: string;
}

export function AssetLibraryPage({ workspaceId }: WorkspaceScopedPageProps) {
  return (
    <section className="ui-stack ui-stack--sm">
      <h1>Assets</h1>
      <TabbedPanel
        defaultTabId="browse"
        tabListAriaLabel="Assets sections"
        tabs={[
          {
            id: "browse",
            label: "Browse",
            content: (
              <AssetLibraryFeature
                key={`assets-${workspaceId}`}
                workspaceId={workspaceId}
              />
            ),
          },
          {
            id: "packages",
            label: "Import Assets",
            content: <DesktopAssetPackages workspaceId={workspaceId} />,
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
            content: <DesktopAssetStudio workspaceId={workspaceId} />,
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

function DesktopAssetStudio({ workspaceId }: { readonly workspaceId: string }) {
  const client = useMemo(() => createDesktopAssetStudioClient(), []);
  return <AssetStudioManager workspaceId={workspaceId} client={client} />;
}
