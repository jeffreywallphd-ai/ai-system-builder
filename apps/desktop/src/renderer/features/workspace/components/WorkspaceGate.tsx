import { type ReactNode } from "react";

import { useActiveWorkspace, type WorkspaceUiRecord } from "../hooks/useActiveWorkspace";
import { WorkspaceRequiredSurface } from "./WorkspaceRequiredSurface";

export interface WorkspaceGateProps {
  pageLabel: string;
  children: ReactNode | ((workspace: WorkspaceUiRecord) => ReactNode);
}

export function WorkspaceGate({ pageLabel, children }: WorkspaceGateProps) {
  const workspace = useActiveWorkspace();

  if (workspace.status === "ready" && workspace.activeWorkspace) {
    return (
      <section className="ui-stack ui-stack--sm" aria-label={`${pageLabel} workspace context`}>
        {typeof children === "function" ? children(workspace.activeWorkspace) : children}
      </section>
    );
  }

  return <WorkspaceRequiredSurface />;
}
