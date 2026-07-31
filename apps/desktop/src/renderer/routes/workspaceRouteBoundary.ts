import type { ActiveWorkspaceReadinessStatus } from "../features/workspace";
import { desktopPageRequiresWorkspace, type DesktopPageKey } from "./desktopPages";

export interface WorkspaceRouteBoundaryDecision {
  readonly blocked: boolean;
  readonly visibleActivePage?: DesktopPageKey;
}

export function resolveDesktopWorkspaceRouteBoundary(
  requestedPage: DesktopPageKey,
  workspaceStatus: ActiveWorkspaceReadinessStatus,
): WorkspaceRouteBoundaryDecision {
  const blocked = desktopPageRequiresWorkspace(requestedPage) && workspaceStatus !== "ready";
  return {
    blocked,
    visibleActivePage: blocked ? undefined : requestedPage,
  };
}
