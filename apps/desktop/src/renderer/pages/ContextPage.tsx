import { useMemo } from "react";

import {
  ContextStudio,
  PageDashboardHeader,
} from "../../../../../modules/ui/shared";
import { createDesktopContextManagementClient } from "../features/context-management/api/desktopContextManagementClient";
import { DesktopPageDashboard } from "../features/page-dashboard/DesktopPageDashboard";
import { PythonRuntimeFooter } from "../features/python-runtime/components/PythonRuntimeFooter";

export interface ContextPageProps {
  readonly workspaceId: string;
  readonly workspaceName: string;
  readonly initialArtifactId?: string;
  readonly onInitialArtifactHandled?: () => void;
  readonly onViewSource?: (artifactId: string) => void;
}

export function ContextPage(props: ContextPageProps) {
  const client = useMemo(() => createDesktopContextManagementClient(), []);
  return (
    <section className="ui-stack ui-stack--sm">
      <PageDashboardHeader
        title="Context"
        description="Create portable RAG databases and Markdown context packs, then inspect and test saved context."
        dashboard={
          <DesktopPageDashboard
            kind="context"
            workspaceId={props.workspaceId}
          />
        }
      />
      <ContextStudio
        key={props.workspaceId}
        workspaceId={props.workspaceId}
        client={client}
        initialArtifactId={props.initialArtifactId}
        onInitialArtifactHandled={props.onInitialArtifactHandled}
        onViewSource={props.onViewSource}
      />
      <PythonRuntimeFooter enabled />
    </section>
  );
}
