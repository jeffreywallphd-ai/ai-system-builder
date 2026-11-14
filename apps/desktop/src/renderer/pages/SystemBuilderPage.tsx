import { useEffect, useMemo, useState } from "react";
import { useWindowTakeover } from "../../../../../modules/ui/shared/takeover/WindowTakeoverControls";
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
import { observeDesktopSavedSystems } from "../features/system-builder/api/observeDesktopSavedSystems";
import { getDesktopApi } from "../lib/desktopApi";
import { createDesktopSystemBuildClient } from "../features/system-builder/api/desktopSystemBuildClient";
import { createDesktopSystemPublishedLifecycleClient } from "../features/system-builder/api/desktopSystemPublishedLifecycleClient";
import { createDesktopSystemPublishedFormClient } from "../features/system-builder/api/desktopSystemPublishedFormClient";
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
  const publishedFormsClient = useMemo(createDesktopSystemPublishedFormClient, []);
  const [activeTabId, setActiveTabId] = useState("compose");
  const { controller, state } = useWindowTakeover();
  const attached = state.status === "activating" || state.status === "active";
  const userOwnsView = () => {
    const status = controller?.getSnapshot().status;
    return status !== "activating" && status !== "active";
  };
  const [composeSystemId, setComposeSystemId] = useState<string>();
  const [activeSystemsRevision, setActiveSystemsRevision] = useState(0);
  useEffect(() => {
    const api = getDesktopApi();
    if (activeTabId === "publish" || !api.readSystemBuilderChangeWatermark) return;
    return observeDesktopSavedSystems({
      visibility: document,
      read: () => api.readSystemBuilderChangeWatermark!(workspaceId),
      changed: () => setActiveSystemsRevision((current) => current + 1),
    });
  }, [workspaceId, activeTabId === "publish"]);
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
        onTabChange={(id) => { if (userOwnsView()) setActiveTabId(id); }}
        defaultTabId="compose"
        tabListAriaLabel="System Builder sections"
        tabs={[
          {
            id: "manage",
            label: "Manage",
            content: (
              <fieldset disabled={attached} style={{ minWidth: 0, border: 0, padding: 0, margin: 0 }}>
              <SystemManagementWorkspace
                workspaceId={workspaceId}
                client={client}
                activeSystemsRevision={activeSystemsRevision}
                onOpenInCompose={(systemId) => {
                  if (!userOwnsView()) return;
                  setComposeSystemId(systemId);
                  setActiveTabId("compose");
                }}
                onActiveSystemsChanged={() =>
                  setActiveSystemsRevision((current) => current + 1)
                }
              />
              </fieldset>
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
                onBuildAndTest={(target) => { if (userOwnsView()) setBuildTarget(target); }}
                takeoverReadOnly={attached}
              />
            ),
          },
          {
            id: "publish",
            label: "Publish",
            content: (
              <fieldset disabled={attached} style={{ minWidth: 0, border: 0, padding: 0, margin: 0 }}>
              <SystemPublishWorkspace
                workspaceId={workspaceId}
                buildClient={buildClient}
                lifecycleClient={lifecycleClient}
                publishedFormsClient={publishedFormsClient}
                visualStartNotice="The system opened in its own window."
              />
              </fieldset>
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
