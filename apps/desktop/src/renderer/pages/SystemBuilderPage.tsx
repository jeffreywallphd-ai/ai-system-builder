import { useMemo } from "react";
import {
  SystemBuilderWorkspace,
  SystemBuildReleaseWorkflow,
  SystemDataRunTest,
  SystemReviewRunTest,
  SystemDeploymentWorkflow,
} from "../../../../../modules/ui/shared/system-builder";
import { TabbedPanel } from "../components/ui/TabbedPanel";
import { AssetPlansTab } from "../features/asset-composition/components/AssetPlansTab";
import { createDesktopAssetCompositionClient } from "../features/asset-composition/api/desktopAssetCompositionClient";
import { createDesktopEffectiveAssetProjectionsClient } from "../features/effective-asset-projections/api/desktopEffectiveAssetProjectionsClient";
import { ConversationRunTestTab } from "../features/conversations/components/ConversationRunTestTab";
import { createDesktopSystemBuilderClient } from "../features/system-builder/api/desktopSystemBuilderClient";
import { createDesktopSystemBuildClient } from "../features/system-builder/api/desktopSystemBuildClient";

import { createDesktopSystemDataClient } from "../features/system-builder/api/desktopSystemDataClient";
import { createDesktopSystemReviewClient } from "../features/system-builder/api/desktopSystemReviewClient";
import { createDesktopSystemDeploymentClient } from "../features/system-builder/api/desktopSystemDeploymentClient";
export interface SystemBuilderPageProps {
  readonly workspaceId: string;
  readonly workspaceName: string;
}
export function SystemBuilderPage({
  workspaceId,
  workspaceName,
}: SystemBuilderPageProps) {
  const client = useMemo(() => createDesktopSystemBuilderClient(), []);
  const buildClient = useMemo(() => createDesktopSystemBuildClient(), []);
  const compositionClient = useMemo(
    () => createDesktopAssetCompositionClient(),
    [],
  );
  const projectionClient = useMemo(
    () => createDesktopEffectiveAssetProjectionsClient(),
    [],
  );
  const dataClient = useMemo(() => createDesktopSystemDataClient(), []);
  const reviewClient = useMemo(() => createDesktopSystemReviewClient(), []);
  const deploymentClient = useMemo(
    () => createDesktopSystemDeploymentClient(),
    [],
  );
  return (
    <section className="ui-stack ui-stack--sm" aria-labelledby="systems-title">
      <header className="ui-stack ui-stack--sm">
        <h1 id="systems-title">Systems</h1>
        <p className="ui-text-muted">
          Build systems in {workspaceName} from reusable, versioned assets.
        </p>
      </header>
      <TabbedPanel
        defaultTabId="compose"
        tabListAriaLabel="System Builder sections"
        tabs={[
          {
            id: "compose",
            label: "Compose",
            content: (
              <SystemBuilderWorkspace
                workspaceId={workspaceId}
                client={client}
              />
            ),
          },
          {
            id: "plans",
            label: "Plans",
            content: (
              <AssetPlansTab
                workspaceId={workspaceId}
                client={compositionClient}
                projectionClient={projectionClient}
              />
            ),
          },
          {
            id: "build-release",
            label: "Build & Release",
            content: (
              <SystemBuildReleaseWorkflow
                workspaceId={workspaceId}
                systemBuilderClient={client}
                buildClient={buildClient}
                defaultDeploymentProfile="local-desktop"
              />
            ),
          },
          {
            id: "run-test",
            label: "Run & Test",
            content: (
              <div className="ui-stack ui-stack--md">
                <ConversationRunTestTab workspaceId={workspaceId} />
                <SystemDataRunTest
                  workspaceId={workspaceId}
                  client={dataClient}
                  buildClient={buildClient}
                />
                <SystemReviewRunTest
                  workspaceId={workspaceId}
                  client={reviewClient}
                  buildClient={buildClient}
                />
                <SystemDeploymentWorkflow
                  workspaceId={workspaceId}
                  buildClient={buildClient}
                  deploymentClient={deploymentClient}
                  deploymentProfiles={["local-desktop"]}
                />
              </div>
            ),
          },
        ]}
      />
    </section>
  );
}
