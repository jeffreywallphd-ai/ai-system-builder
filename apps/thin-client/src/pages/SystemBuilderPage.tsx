import { useMemo, useState } from "react";
import {
  SystemBuilderWorkspace,
  SystemManagementWorkspace,
  SystemBuildTestModal,
  SystemPublishWorkspace,
} from "../../../../modules/ui/shared/system-builder";
import type {
  SystemBuilderRecord,
  SystemBuilderRevision,
} from "../../../../modules/contracts/system-builder";
import { TabbedPanel } from "../components/ui/TabbedPanel";
import { createThinClientSystemBuilderClient } from "../features/system-builder/api/thinClientSystemBuilderClient";
import { createThinClientSystemBuildClient } from "../features/system-builder/api/thinClientSystemBuildClient";
import { createThinClientSystemPublishedLifecycleClient } from "../features/system-builder/api/thinClientSystemPublishedLifecycleClient";
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
  const [activeTabId, setActiveTabId] = useState("compose");
  const [composeSystemId, setComposeSystemId] = useState<string>();
  const [activeSystemsRevision, setActiveSystemsRevision] = useState(0);
  const [buildTarget, setBuildTarget] = useState<{
    readonly system: SystemBuilderRecord;
    readonly revision: SystemBuilderRevision;
  }>();
  return (
    <section className="ui-stack ui-stack--sm" aria-labelledby="systems-title">
      <header className="ui-stack ui-stack--sm">
        <h1 id="systems-title">Systems</h1>
        <p className="ui-text-muted">
          Build systems in {workspaceName} from reusable, versioned assets.
        </p>
      </header>
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
