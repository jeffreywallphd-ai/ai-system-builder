export type DesktopPageKey = "home" | "artifacts" | "assets" | "user-library" | "models" | "image-generation" | "settings" | "systems";

export interface DesktopPageDefinition {
  key: DesktopPageKey;
  label: string;
  requiresWorkspace?: boolean;
}

export const desktopPageDefinitions: readonly DesktopPageDefinition[] = [
  {
    key: "artifacts",
    label: "Data",
    requiresWorkspace: true,
  },
  {
    key: "assets",
    label: "Assets",
    requiresWorkspace: true,
  },
  {
    key: "user-library",
    label: "Reusable Library",
    requiresWorkspace: true,
  },
  {
    key: "models",
    label: "Models",
    requiresWorkspace: true,
  },
  {
    key: "image-generation",
    label: "Image Generation",
    requiresWorkspace: true,
  },
  {
    key: "settings",
    label: "Settings",
  },
  {
    key: "systems",
    label: "Systems",
    requiresWorkspace: true,
  },
];

export function desktopPageRequiresWorkspace(pageKey: DesktopPageKey): boolean {
  return desktopPageDefinitions.some((page) => page.key === pageKey && page.requiresWorkspace === true);
}
