export type ThinClientPageKey = "home" | "systems" | "artifacts" | "assets" | "user-library" | "image-generation" | "models" | "security" | "settings";

export interface ThinClientPageDefinition {
  key: ThinClientPageKey;
  label: string;
  path: string;
  requiresWorkspace?: boolean;
}

export const thinClientPageDefinitions: readonly ThinClientPageDefinition[] = [
  { key: "home", label: "Home", path: "/" },
  { key: "systems", label: "Systems", path: "/systems", requiresWorkspace: true },
  { key: "artifacts", label: "Artifacts", path: "/artifacts", requiresWorkspace: true },
  { key: "assets", label: "Assets", path: "/assets", requiresWorkspace: true },
    { key: "user-library", label: "Reusable Library", path: "/user-library", requiresWorkspace: true },
  { key: "image-generation", label: "Image Generation", path: "/image-generation", requiresWorkspace: true },
  { key: "models", label: "Models", path: "/models", requiresWorkspace: true },
  { key: "security", label: "Security", path: "/security" },
  { key: "settings", label: "Settings", path: "/settings" },
];

export function thinClientPageRequiresWorkspace(pageKey: ThinClientPageKey): boolean {
  return thinClientPageDefinitions.some((page) => page.key === pageKey && page.requiresWorkspace === true);
}

export function resolveThinClientPage(pathname: string): ThinClientPageKey {
  if (pathname === "/systems") return "systems";
  if (pathname === "/artifacts") return "artifacts";
  if (pathname === "/assets") return "assets";
  if (pathname === "/asset-authoring") return "assets";
  if (pathname === "/user-library") return "user-library";
  if (pathname === "/image-generation") return "image-generation";
  if (pathname === "/models") return "models";
  if (pathname === "/security") return "security";
  if (pathname === "/settings") return "settings";
  return "home";
}
