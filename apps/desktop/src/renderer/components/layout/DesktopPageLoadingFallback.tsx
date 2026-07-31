import { useEffect } from "react";

import { recordRendererMemorySnapshot } from "../../diagnostics/rendererMemoryDiagnostics";
import type { ActiveWorkspaceReadinessStatus } from "../../features/workspace";
import type { DesktopPageKey } from "../../routes/desktopPages";

export interface DesktopPageLoadingFallbackProps {
  readonly activePage: DesktopPageKey;
  readonly visibleActivePage?: DesktopPageKey;
  readonly workspaceStatus: ActiveWorkspaceReadinessStatus;
  readonly routeRequiresWorkspace: boolean;
}

export function DesktopPageLoadingFallback({
  activePage,
  visibleActivePage,
  workspaceStatus,
  routeRequiresWorkspace,
}: DesktopPageLoadingFallbackProps) {
  useEffect(() => {
    recordRendererMemorySnapshot({
      milestone: "renderer.page.lazy-render.fallback",
      component: "desktop-renderer",
      detail: {
        activePage,
        visibleActivePage,
        workspaceStatus,
        routeRequiresWorkspace,
      },
    });
  }, [activePage, visibleActivePage, workspaceStatus, routeRequiresWorkspace]);

  return (
    <section
      className="ui-panel ui-page-loading-surface ui-stack ui-stack--sm"
      aria-label="Page loading"
      role="status"
      aria-live="polite"
    >
      <p>Loading page…</p>
    </section>
  );
}
