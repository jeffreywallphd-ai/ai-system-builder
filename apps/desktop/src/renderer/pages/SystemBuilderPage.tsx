import { useMemo, useState } from "react";
import {
  SystemBuilderWorkspace,
  SystemManagementWorkspace,
  SystemBuildTestModal,
  SystemPublishWorkspace,
} from "../../../../../modules/ui/shared/system-builder";
import { PageDashboardHeader } from "../../../../../modules/ui/shared";
import type {
  SystemBuilderRecord,
  SystemBuilderRevision,
} from "../../../../../modules/contracts/system-builder";
import { TabbedPanel } from "../components/ui/TabbedPanel";
import { createDesktopSystemBuilderClient } from "../features/system-builder/api/desktopSystemBuilderClient";
import { createDesktopSystemBuildClient } from "../features/system-builder/api/desktopSystemBuildClient";
import { createDesktopSystemPublishedLifecycleClient } from "../features/system-builder/api/desktopSystemPublishedLifecycleClient";
import { DesktopPageDashboard } from "../features/page-dashboard/DesktopPageDashboard";
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
  const lifecycleClient = useMemo(
    () => createDesktopSystemPublishedLifecycleClient(),
    [],
  );
  const [activeTabId, setActiveTabId] = useState("compose");
  const [composeSystemId, setComposeSystemId] = useState<string>();
  const [activeSystemsRevision, setActiveSystemsRevision] = useState(0);
  const [buildTarget, setBuildTarget] = useState<{
    readonly system: SystemBuilderRecord;
    readonly revision: SystemBuilderRevision;
  }>();
  return (
    <section className="ui-stack ui-stack--sm" aria-labelledby="systems-title">
      <PageDashboardHeader
        title="Systems"
        titleId="systems-title"
        description={`Build systems in ${workspaceName} from reusable, versioned assets.`}
        dashboard={
          <DesktopPageDashboard kind="systems" workspaceId={workspaceId} />
        }
      />
      <TabbedPanel
        activeTabId={activeTabId}
        onTabChange={setActiveTabId}
        defaultTabId="compose"
        tabListAriaLabel="System Builder sections"
        tabs={[
          {
            id: "manage",
            label: "Manage",
            content: (
              <SystemManagementWorkspace
                workspaceId={workspaceId}
                client={client}
                onOpenInCompose={(systemId) => {
                  setComposeSystemId(systemId);
                  setActiveTabId("compose");
                }}
                onActiveSystemsChanged={() =>
                  setActiveSystemsRevision((current) => current + 1)
                }
              />
            ),
          },
          {
            id: "compose",
            label: "Compose",
            keepMounted: true,
            content: (
              <SystemBuilderWorkspace
                workspaceId={workspaceId}
                client={client}
                initialSystemId={composeSystemId}
                activeSystemsRevision={activeSystemsRevision}
                onBuildAndTest={setBuildTarget}
              />
            ),
          },
          {
            id: "publish",
            label: "Publish",
            content: (
              <SystemPublishWorkspace
                workspaceId={workspaceId}
                buildClient={buildClient}
                lifecycleClient={lifecycleClient}
                visualStartNotice="The system opened in its own window."
              />
            ),
          },
        ]}
      />
      <SystemBuildTestModal
        open={Boolean(buildTarget)}
        workspaceId={workspaceId}
        system={buildTarget?.system}
        revision={buildTarget?.revision}
        buildClient={buildClient}
        onClose={() => setBuildTarget(undefined)}
      />
    </section>
  );
}
