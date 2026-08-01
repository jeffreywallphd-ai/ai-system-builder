import { useEffect, useState, type ReactNode } from "react";
import { ModelDownloadNotificationBridge, NotificationProvider, useNotificationCenter } from "../../../modules/ui/shared";

import { AppShell } from "./components/layout/AppShell";
import { AssetLibraryPage } from "./pages/AssetLibraryPage";
import { ArtifactsPage } from "./pages/ArtifactsPage";
import { HomePage } from "./pages/HomePage";
import { ImageGenerationPage } from "./pages/ImageGenerationPage";
import { ModelsPage } from "./pages/ModelsPage";
import { ActiveWorkspaceProvider, WorkspaceGate, WorkspaceRequiredSurface, useActiveWorkspace, type WorkspaceUiRecord } from "./features/workspace";
import { SecurityPage } from "./pages/SecurityPage";
import { SettingsPage } from "./pages/SettingsPage";
import { SystemBuilderPage } from "./pages/SystemBuilderPage";
import {
  resolveThinClientPage,
  thinClientPageDefinitions,
  thinClientPageRequiresWorkspace,
  type ThinClientPageKey,
} from "./routes/thinClientPages";
import { resolveThinClientWorkspaceRouteBoundary } from "./routes/workspaceRouteBoundary";
import { createApiModelManagementClient } from "./features/model-management/api/apiModelManagementClient";

type ThinClientWorkspacePageKey = Extract<ThinClientPageKey, "systems" | "artifacts" | "assets" | "models" | "image-generation">;
const modelDownloadNotificationClient = createApiModelManagementClient();
const thinClientDownloadNotificationBridgeClient = {
  listModelDownloads: modelDownloadNotificationClient.listModelDownloads!,
};

function navigateToPage(page: ThinClientPageKey): void {
  const path = page === "systems" ? "/systems" : page === "artifacts" ? "/artifacts" : page === "assets" ? "/assets" : page === "image-generation" ? "/image-generation" : page === "models" ? "/models" : page === "security" ? "/security" : page === "settings" ? "/settings" : "/";
  window.history.pushState({}, "", path);
}

export function App() {
  return (
    <ActiveWorkspaceProvider>
      <NotificationProvider>
        <WorkspaceAwareThinClientApp />
      </NotificationProvider>
    </ActiveWorkspaceProvider>
  );
}

function WorkspaceAwareThinClientApp() {
  const [activePage, setActivePage] = useState<ThinClientPageKey>(resolveThinClientPage(window.location.pathname));
  const workspace = useActiveWorkspace();
  const notifications = useNotificationCenter();
  const setNotificationWorkspace = notifications.setActiveWorkspaceId;
  useEffect(() => {
    setNotificationWorkspace(workspace.activeWorkspaceId);
  }, [setNotificationWorkspace, workspace.activeWorkspaceId]);
  const activePageDefinition = thinClientPageDefinitions.find((page) => page.key === activePage);
  const routeRequiresWorkspace = thinClientPageRequiresWorkspace(activePage);
  const routeBoundary = resolveThinClientWorkspaceRouteBoundary(activePage, workspace.status);

  const setRoute = (nextPage: ThinClientPageKey) => {
    navigateToPage(nextPage);
    setActivePage(nextPage);
  };

  const renderWorkspacePageContent = (page: ThinClientWorkspacePageKey, activeWorkspace: WorkspaceUiRecord): ReactNode => {
    switch (page) {
      case "systems":
        return <SystemBuilderPage workspaceId={activeWorkspace.id} workspaceName={activeWorkspace.displayName} />;
      case "artifacts":
        return <ArtifactsPage workspaceId={activeWorkspace.id} workspaceName={activeWorkspace.displayName} />;
      case "image-generation":
        return (
          <ImageGenerationPage
            workspaceId={activeWorkspace.id}
            workspaceName={activeWorkspace.displayName}
            onNavigateToArtifacts={() => setRoute("artifacts")}
            onNavigateToModels={() => setRoute("models")}
          />
        );
      case "assets":
        return <AssetLibraryPage workspaceId={activeWorkspace.id} workspaceName={activeWorkspace.displayName} />;
      case "models":
        return <ModelsPage workspaceId={activeWorkspace.id} workspaceName={activeWorkspace.displayName} />;
    }
  };

  const renderGlobalPageContent = (page: ThinClientPageKey): ReactNode => {
    switch (page) {
      case "security":
        return <SecurityPage />;
      case "settings":
        return <SettingsPage />;
      case "home":
        return <HomePage onNavigate={setRoute} />;
      default:
        return <WorkspaceRequiredSurface />;
    }
  };

  const content = routeBoundary.blocked ? (
    <WorkspaceRequiredSurface />
  ) : routeRequiresWorkspace ? (
    <WorkspaceGate pageLabel={activePageDefinition?.label ?? activePage}>
      {(activeWorkspace) => renderWorkspacePageContent(activePage as ThinClientWorkspacePageKey, activeWorkspace)}
    </WorkspaceGate>
  ) : renderGlobalPageContent(activePage);

  return (
    <>
      <ModelDownloadNotificationBridge client={thinClientDownloadNotificationBridgeClient} workspaceId={workspace.activeWorkspaceId} />
      <AppShell
        activePage={routeBoundary.visibleActivePage}
        pages={thinClientPageDefinitions}
        onNavigate={setRoute}
      >
        {content}
      </AppShell>
    </>
  );
}

export default App;
