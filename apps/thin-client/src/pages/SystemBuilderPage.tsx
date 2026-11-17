import { useLayoutEffect, useMemo, useState } from "react";
import {
  SystemBuilderWorkspace,
  SystemManagementWorkspace,
  type SavedSystemsRefresh,
  SystemBuildTestModal,
  SystemPublishWorkspace,
} from "../../../../modules/ui/shared/system-builder";
import { PageDashboardHeader } from "../../../../modules/ui/shared";
import type {
  SystemBuilderRecord,
  SystemBuilderRevision,
} from "../../../../modules/contracts/system-builder";
import { TabbedPanel } from "../components/ui/TabbedPanel";
import { createThinClientSystemBuilderClient } from "../features/system-builder/api/thinClientSystemBuilderClient";
import { createThinClientSystemBuildClient } from "../features/system-builder/api/thinClientSystemBuildClient";
import { createThinClientSystemPublishedLifecycleClient } from "../features/system-builder/api/thinClientSystemPublishedLifecycleClient";
import { createThinClientSystemPublishedFormClient } from "../features/system-builder/api/thinClientSystemPublishedFormClient";
import { ThinClientPageDashboard } from "../features/page-dashboard/ThinClientPageDashboard";
import { observeManagedSavedSystems } from "../features/system-builder/api/observeManagedSavedSystems";
import { pairedDeviceTokenStore } from "../security/pairedDeviceTokenStore";
import { useWindowTakeover } from "../../../../modules/ui/shared/takeover/WindowTakeoverContext";
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
  const lifecycleClient = useMemo(
    () => createThinClientSystemPublishedLifecycleClient(),
    [],
  );
  const publishedFormsClient = useMemo(createThinClientSystemPublishedFormClient, []);
  const [activeTabId, setActiveTabId] = useState("compose");
  const { controller, presentationAttached } = useWindowTakeover();
  const userOwnsView = () => {
    const status = controller?.getSnapshot().status;
    return status !== "active" && status !== "activating";
  };
  const [composeSystemId, setComposeSystemId] = useState<string>();
  const [activeSystemsRevision, setActiveSystemsRevision] = useState(0);
  const [managedSavedRefresh, setManagedSavedRefresh] = useState<SavedSystemsRefresh>();
  const observeSavedState = activeTabId !== "publish";
  useLayoutEffect(() => {
    if (!observeSavedState) return;
    return observeManagedSavedSystems({
      workspaceId, visibility: document,
      changed: (isCurrent) => setManagedSavedRefresh({ isCurrent }),
    });
  }, [workspaceId, observeSavedState]);
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
          <ThinClientPageDashboard kind="systems" workspaceId={workspaceId} />
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
              <fieldset disabled={presentationAttached} style={{minWidth:0,border:0,padding:0,margin:0}}>
              <SystemManagementWorkspace
                workspaceId={workspaceId}
                client={client}
                activeSystemsRevision={activeSystemsRevision}
                managedSavedRefresh={managedSavedRefresh}
                captureSavedRead={pairedDeviceTokenStore.captureToken}
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
                managedSavedRefresh={managedSavedRefresh}
                captureSavedRead={pairedDeviceTokenStore.captureToken}
                onBuildAndTest={(target) => { if (userOwnsView()) setBuildTarget(target); }}
                takeoverReadOnly={presentationAttached}
              />
            ),
          },
          {
            id: "publish",
            label: "Publish",
            content: (
              <fieldset disabled={presentationAttached} style={{minWidth:0,border:0,padding:0,margin:0}}>
              <SystemPublishWorkspace
                workspaceId={workspaceId}
                buildClient={buildClient}
                lifecycleClient={lifecycleClient}
                publishedFormsClient={publishedFormsClient}
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
