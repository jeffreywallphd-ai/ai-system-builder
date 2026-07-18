import { useMemo } from "react";
import {
  SystemBuilderWorkspace,
  SystemBuildReleaseWorkflow,
  SystemDataRunTest,
  SystemReviewRunTest,
  SystemDeploymentWorkflow,
} from "../../../../modules/ui/shared/system-builder";
import { TabbedPanel } from "../components/ui/TabbedPanel";
import { AssetPlansTab } from "../features/asset-composition/components/AssetPlansTab";
import { createThinClientAssetCompositionClient } from "../features/asset-composition/api/thinClientAssetCompositionClient";
import { createThinClientEffectiveAssetProjectionsClient } from "../features/effective-asset-projections/api/thinClientEffectiveAssetProjectionsClient";
import { ConversationRunTestTab } from "../features/conversations/components/ConversationRunTestTab";
import { createThinClientSystemBuilderClient } from "../features/system-builder/api/thinClientSystemBuilderClient";
import { createThinClientSystemBuildClient } from "../features/system-builder/api/thinClientSystemBuildClient";

import { createThinClientSystemDataClient } from "../features/system-builder/api/thinClientSystemDataClient";
import { createThinClientSystemReviewClient } from "../features/system-builder/api/thinClientSystemReviewClient";
import { createThinClientSystemDeploymentClient } from "../features/system-builder/api/thinClientSystemDeploymentClient";
export interface SystemBuilderPageProps {
  readonly workspaceId: string;
  readonly workspaceName: string;
}
export function SystemBuilderPage({
  workspaceId,
  workspaceName,
}: SystemBuilderPageProps) {
  const client = useMemo(() => createThinClientSystemBuilderClient(), []);
  const buildClient = useMemo(() => createThinClientSystemBuildClient(), []);
  const compositionClient = useMemo(
    () => createThinClientAssetCompositionClient(),
    [],
  );
  const projectionClient = useMemo(
    () => createThinClientEffectiveAssetProjectionsClient(),
    [],
  );
  const dataClient = useMemo(() => createThinClientSystemDataClient(), []);
  const reviewClient = useMemo(() => createThinClientSystemReviewClient(), []);
  const deploymentClient = useMemo(
    () => createThinClientSystemDeploymentClient(),
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
                defaultDeploymentProfile="thin-client"
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
                  deploymentProfiles={["campus-server", "cloud-server"]}
                  controlSurfaceOnly
                />
              </div>
            ),
          },
        ]}
      />
    </section>
  );
}
