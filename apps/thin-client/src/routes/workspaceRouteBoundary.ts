import type { ActiveWorkspaceReadinessStatus } from "../features/workspace";
import { thinClientPageRequiresWorkspace, type ThinClientPageKey } from "./thinClientPages";

export interface WorkspaceRouteBoundaryDecision {
  readonly blocked: boolean;
  readonly visibleActivePage?: ThinClientPageKey;
}

export function resolveThinClientWorkspaceRouteBoundary(
  requestedPage: ThinClientPageKey,
  workspaceStatus: ActiveWorkspaceReadinessStatus,
): WorkspaceRouteBoundaryDecision {
  const blocked = thinClientPageRequiresWorkspace(requestedPage) && workspaceStatus !== "ready";
  return {
    blocked,
    visibleActivePage: blocked ? undefined : requestedPage,
  };
}
