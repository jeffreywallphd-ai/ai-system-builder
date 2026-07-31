import { type ComponentType } from "react";

import { recordRendererMemorySnapshot } from "../diagnostics/rendererMemoryDiagnostics";
import type { ActiveWorkspaceReadinessStatus } from "../features/workspace";
import type { DesktopPageKey } from "./desktopPages";

export interface WorkspaceScopedPageProps {
  readonly workspaceId: string;
  readonly workspaceName: string;
}

export interface ArtifactsLazyPageProps extends WorkspaceScopedPageProps {
  readonly refreshToken: number;
  readonly onUploaded: () => void;
}

export interface HomeLazyPageProps {
  readonly onNavigate: (nextPage: DesktopPageKey) => void;
}

export type DesktopLazyPagePropsByKey = {
  readonly home: HomeLazyPageProps;
  readonly artifacts: ArtifactsLazyPageProps;
  readonly assets: WorkspaceScopedPageProps;
  readonly "user-library": WorkspaceScopedPageProps;
  readonly models: WorkspaceScopedPageProps;
  readonly "image-generation": WorkspaceScopedPageProps;
  readonly settings: object;
  readonly systems: WorkspaceScopedPageProps;
};

export type DesktopLazyPageDiagnosticContext = {
  readonly activePage: DesktopPageKey;
  readonly visibleActivePage?: DesktopPageKey;
  readonly workspaceStatus?: ActiveWorkspaceReadinessStatus;
  readonly routeRequiresWorkspace?: boolean;
};

export type DesktopLazyPageComponent<TKey extends DesktopPageKey> = ComponentType<
  DesktopLazyPagePropsByKey[TKey] & { readonly __lazyLoadContext?: DesktopLazyPageDiagnosticContext }
>;

export type DesktopLazyPageModule<TKey extends DesktopPageKey> = {
  readonly default: ComponentType<DesktopLazyPagePropsByKey[TKey]>;
};

export type DesktopLazyPageLoader<TKey extends DesktopPageKey> = () => Promise<DesktopLazyPageModule<TKey>>;

export type DesktopLazyPageRegistry = {
  readonly [TKey in DesktopPageKey]: DesktopLazyPageComponent<TKey>;
};

function createLazyPageDiagnosticDetail(
  pageKey: DesktopPageKey,
  context?: DesktopLazyPageDiagnosticContext,
): Record<string, unknown> {
  return {
    activePage: context?.activePage ?? pageKey,
    visibleActivePage: context?.visibleActivePage,
    workspaceStatus: context?.workspaceStatus,
    routeRequiresWorkspace: context?.routeRequiresWorkspace,
  };
}

function lazyDesktopPage<TKey extends DesktopPageKey>(
  pageKey: TKey,
  loadPage: DesktopLazyPageLoader<TKey>,
): DesktopLazyPageComponent<TKey> {
  let loadedPage: DesktopLazyPageModule<TKey> | undefined;
  let loadError: unknown;
  let loadPromise: Promise<void> | undefined;

  return function DesktopLazyPage(props: DesktopLazyPagePropsByKey[TKey] & { readonly __lazyLoadContext?: DesktopLazyPageDiagnosticContext }) {
    if (loadError) {
      throw loadError;
    }

    if (loadedPage) {
      const Page = loadedPage.default;
      const { __lazyLoadContext: _context, ...pageProps } = props;
      return <Page {...(pageProps as DesktopLazyPagePropsByKey[TKey])} />;
    }

    if (!loadPromise) {
      const context = props.__lazyLoadContext;
      recordRendererMemorySnapshot({
        milestone: "renderer.page.lazy-load.start",
        component: "desktop-renderer",
        detail: createLazyPageDiagnosticDetail(pageKey, context),
      });

      loadPromise = loadPage()
        .then((module) => {
          loadedPage = module;
          recordRendererMemorySnapshot({
            milestone: "renderer.page.lazy-load.resolved",
            component: "desktop-renderer",
            detail: createLazyPageDiagnosticDetail(pageKey, context),
          });
        })
        .catch((error) => {
          loadError = error;
          recordRendererMemorySnapshot({
            milestone: "renderer.page.lazy-load.failed",
            component: "desktop-renderer",
            detail: {
              ...createLazyPageDiagnosticDetail(pageKey, context),
              error: error instanceof Error ? error.message : "unknown lazy page load failure",
            },
          });
          throw error;
        });
    }

    throw loadPromise;
  };
}

export function createLazyDesktopPageRegistry(
  loaders: { readonly [TKey in DesktopPageKey]: DesktopLazyPageLoader<TKey> },
): DesktopLazyPageRegistry {
  return {
    home: lazyDesktopPage("home", loaders.home),
    artifacts: lazyDesktopPage("artifacts", loaders.artifacts),
    assets: lazyDesktopPage("assets", loaders.assets),
    "user-library": lazyDesktopPage("user-library", loaders["user-library"]),
    models: lazyDesktopPage("models", loaders.models),
    "image-generation": lazyDesktopPage("image-generation", loaders["image-generation"]),
    settings: lazyDesktopPage("settings", loaders.settings),
    systems: lazyDesktopPage("systems", loaders.systems),
  };
}

export const desktopLazyPages = createLazyDesktopPageRegistry({
  home: async () => {
    const module = await import("../pages/HomePage");
    return { default: module.HomePage };
  },
  artifacts: async () => {
    const module = await import("../pages/ArtifactsPage");
    return { default: module.ArtifactsPage };
  },
  assets: async () => {
    const module = await import("../pages/AssetLibraryPage");
    return { default: module.AssetLibraryPage };
  },
  "user-library": async () => {
    const module = await import("../pages/UserLibraryPage");
    return { default: module.UserLibraryPage };
  },
  models: async () => {
    const module = await import("../pages/ModelsPage");
    return { default: module.ModelsPage };
  },
  "image-generation": async () => {
    const module = await import("../pages/ImageGenerationPage");
    return { default: module.ImageGenerationPage };
  },
  settings: async () => {
    const module = await import("../pages/SettingsPage");
    return { default: module.SettingsPage };
  },
  systems: async () => {
    const module = await import("../pages/SystemBuilderPage");
    return { default: module.SystemBuilderPage };
  },
});
