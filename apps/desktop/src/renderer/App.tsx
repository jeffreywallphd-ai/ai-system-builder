import { Suspense, useEffect, useState, type ReactNode } from "react";
import {
  ContextTaskNotificationBridge,
  ModelDownloadNotificationBridge,
  NotificationProvider,
  useNotificationCenter,
} from "../../../../modules/ui/shared";

import { AppShell } from "./components/layout/AppShell";
import { DesktopPageLoadingFallback } from "./components/layout/DesktopPageLoadingFallback";
import { useDesktopPage } from "./hooks/useDesktopPage";
import {
  ActiveWorkspaceProvider,
  WorkspaceGate,
  WorkspaceRequiredSurface,
  useActiveWorkspace,
  type WorkspaceUiRecord,
} from "./features/workspace";
import {
  desktopPageDefinitions,
  desktopPageRequiresWorkspace,
  type DesktopPageKey,
} from "./routes/desktopPages";
import {
  desktopLazyPages,
  type DesktopLazyPageDiagnosticContext,
  type DesktopLazyPageRegistry,
} from "./routes/lazyDesktopPages";
import { resolveDesktopWorkspaceRouteBoundary } from "./routes/workspaceRouteBoundary";
import { recordRendererMemorySnapshot } from "./diagnostics/rendererMemoryDiagnostics";
import { createDesktopModelsClient } from "./features/models/api/desktopModelsClient";
import { createDesktopDatasetPreparationClient } from "./features/dataset-preparation/api/desktopDatasetPreparationClient";
import { DatasetPreparationNotificationBridge } from "./features/dataset-preparation/components/DatasetPreparationNotificationBridge";
import { ModelTrainingNotificationBridge } from "./features/models/components/ModelTrainingNotificationBridge";
import { createDesktopContextManagementClient } from "./features/context-management/api/desktopContextManagementClient";

type DesktopWorkspacePageKey = Extract<
  DesktopPageKey,
  "artifacts" | "context" | "assets" | "models" | "image-generation" | "systems"
>;
const desktopModelDownloadNotificationClient = {
  listModelDownloads: (
    input: Parameters<
      ReturnType<typeof createDesktopModelsClient>["listModelDownloads"]
    >[0],
  ) => createDesktopModelsClient().listModelDownloads(input),
};
const desktopDatasetPreparationNotificationClient = {
  readPrepareTrainingDatasetTask: (requestId: string, workspaceId?: string) =>
    createDesktopDatasetPreparationClient().readPrepareTrainingDatasetTask(
      requestId,
      workspaceId,
    ),
};
const desktopModelTrainingNotificationClient = {
  readModelTrainingStatus: (input: { runId: string; workspaceId: string }) =>
    createDesktopModelsClient().readModelTrainingStatus(input),
};
const desktopContextNotificationClient = createDesktopContextManagementClient();

export function App() {
  useEffect(() => {
    recordRendererMemorySnapshot({
      milestone: "renderer.app.mounted",
      component: "desktop-renderer",
    });
  }, []);

  return (
    <ActiveWorkspaceProvider>
      <NotificationProvider>
        <WorkspaceAwareDesktopApp />
      </NotificationProvider>
    </ActiveWorkspaceProvider>
  );
}

export interface WorkspaceAwareDesktopAppProps {
  readonly lazyPages?: DesktopLazyPageRegistry;
}

export function WorkspaceAwareDesktopApp({
  lazyPages = desktopLazyPages,
}: WorkspaceAwareDesktopAppProps = {}) {
  const { activePage, setActivePage } = useDesktopPage();
  const workspace = useActiveWorkspace();
  const notifications = useNotificationCenter();
  const setNotificationWorkspace = notifications.setActiveWorkspaceId;
  const [artifactRefreshToken, setArtifactRefreshToken] = useState(0);
  const [contextLaunchArtifactId, setContextLaunchArtifactId] =
    useState<string>();
  const [artifactDetailIntent, setArtifactDetailIntent] = useState<string>();
  const notificationWorkspaceId =
    workspace.status === "ready" ? workspace.activeWorkspace?.id : undefined;

  useEffect(() => {
    setNotificationWorkspace(notificationWorkspaceId);
    setContextLaunchArtifactId(undefined);
    setArtifactDetailIntent(undefined);
  }, [notificationWorkspaceId, setNotificationWorkspace]);

  const activePageDefinition = desktopPageDefinitions.find(
    (page) => page.key === activePage,
  );
  const routeRequiresWorkspace = desktopPageRequiresWorkspace(activePage);
  const routeBoundary = resolveDesktopWorkspaceRouteBoundary(
    activePage,
    workspace.status,
  );
  const lazyLoadContext: DesktopLazyPageDiagnosticContext = {
    activePage,
    visibleActivePage: routeBoundary.visibleActivePage,
    workspaceStatus: workspace.status,
    routeRequiresWorkspace,
  };

  const lazyPageFallback = (
    <DesktopPageLoadingFallback
      activePage={activePage}
      visibleActivePage={routeBoundary.visibleActivePage}
      workspaceStatus={workspace.status}
      routeRequiresWorkspace={routeRequiresWorkspace}
    />
  );

  const renderWorkspacePageContent = (
    page: DesktopWorkspacePageKey,
    activeWorkspace: WorkspaceUiRecord,
  ): ReactNode => {
    switch (page) {
      case "artifacts": {
        const ArtifactsPage = lazyPages.artifacts;
        return (
          <ArtifactsPage
            __lazyLoadContext={lazyLoadContext}
            workspaceId={activeWorkspace.id}
            workspaceName={activeWorkspace.displayName}
            refreshToken={artifactRefreshToken}
            initialSelectedStorageKey={artifactDetailIntent}
            onInitialSelectionHandled={() => setArtifactDetailIntent(undefined)}
            onConvertToRag={(artifactId) => {
              setContextLaunchArtifactId(artifactId);
              setArtifactDetailIntent(undefined);
              setActivePage("context");
            }}
            onUploaded={() => {
              setArtifactRefreshToken((current) => current + 1);
            }}
          />
        );
      }
      case "context": {
        const ContextPage = lazyPages.context;
        return (
          <ContextPage
            __lazyLoadContext={lazyLoadContext}
            workspaceId={activeWorkspace.id}
            workspaceName={activeWorkspace.displayName}
            initialArtifactId={contextLaunchArtifactId}
            onInitialArtifactHandled={() =>
              setContextLaunchArtifactId(undefined)
            }
            onViewSource={(artifactId) => {
              setArtifactDetailIntent(artifactId);
              setContextLaunchArtifactId(undefined);
              setActivePage("artifacts");
            }}
          />
        );
      }
      case "assets": {
        const AssetLibraryPage = lazyPages.assets;
        return (
          <AssetLibraryPage
            __lazyLoadContext={lazyLoadContext}
            workspaceId={activeWorkspace.id}
            workspaceName={activeWorkspace.displayName}
          />
        );
      }
      case "models": {
        const ModelsPage = lazyPages.models;
        return (
          <ModelsPage
            __lazyLoadContext={lazyLoadContext}
            workspaceId={activeWorkspace.id}
            workspaceName={activeWorkspace.displayName}
          />
        );
      }
      case "image-generation": {
        const ImageGenerationPage = lazyPages["image-generation"];
        return (
          <ImageGenerationPage
            __lazyLoadContext={lazyLoadContext}
            workspaceId={activeWorkspace.id}
            workspaceName={activeWorkspace.displayName}
          />
        );
      }
      case "systems": {
        const SystemBuilderPage = lazyPages.systems;
        return (
          <SystemBuilderPage
            __lazyLoadContext={lazyLoadContext}
            workspaceId={activeWorkspace.id}
            workspaceName={activeWorkspace.displayName}
          />
        );
      }
    }
  };

  const renderGlobalPageContent = (page: DesktopPageKey): ReactNode => {
    switch (page) {
      case "home": {
        const HomePage = lazyPages.home;
        return (
          <HomePage
            __lazyLoadContext={lazyLoadContext}
            onNavigate={setActivePage}
          />
        );
      }
      case "settings": {
        const SettingsPage = lazyPages.settings;
        return <SettingsPage __lazyLoadContext={lazyLoadContext} />;
      }
      default:
        return <WorkspaceRequiredSurface />;
    }
  };

  useEffect(() => {
    recordRendererMemorySnapshot({
      milestone: "renderer.page.active.changed",
      component: "desktop-renderer",
      detail: {
        activePage,
        visibleActivePage: routeBoundary.visibleActivePage,
        workspaceStatus: workspace.status,
      },
    });
  }, [activePage, routeBoundary.visibleActivePage, workspace.status]);

  const content = routeBoundary.blocked ? (
    <WorkspaceRequiredSurface />
  ) : routeRequiresWorkspace ? (
    <WorkspaceGate pageLabel={activePageDefinition?.label ?? activePage}>
      {(activeWorkspace) =>
        renderWorkspacePageContent(
          activePage as DesktopWorkspacePageKey,
          activeWorkspace,
        )
      }
    </WorkspaceGate>
  ) : (
    renderGlobalPageContent(activePage)
  );

  return (
    <>
      <ModelDownloadNotificationBridge
        client={desktopModelDownloadNotificationClient}
        workspaceId={notificationWorkspaceId}
      />
      <DatasetPreparationNotificationBridge
        client={desktopDatasetPreparationNotificationClient}
        workspaceId={notificationWorkspaceId}
      />
      <ModelTrainingNotificationBridge
        client={desktopModelTrainingNotificationClient}
        workspaceId={notificationWorkspaceId}
      />
      <ContextTaskNotificationBridge
        client={desktopContextNotificationClient}
        workspaceId={notificationWorkspaceId}
      />
      <AppShell
        activePage={routeBoundary.visibleActivePage}
        onNavigate={setActivePage}
        pages={desktopPageDefinitions}
      >
        <Suspense fallback={lazyPageFallback}>{content}</Suspense>
      </AppShell>
    </>
  );
}

export default App;
