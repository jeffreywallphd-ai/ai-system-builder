export type ThinClientPageKey = "home" | "artifacts";

export interface ThinClientPageDefinition {
  key: ThinClientPageKey;
  label: string;
  path: string;
}

export const thinClientPageDefinitions: readonly ThinClientPageDefinition[] = [
  { key: "home", label: "Home", path: "/" },
  { key: "artifacts", label: "Artifacts", path: "/artifacts" },
];

export function resolveThinClientPage(pathname: string): ThinClientPageKey {
  return pathname === "/artifacts" ? "artifacts" : "home";
}
