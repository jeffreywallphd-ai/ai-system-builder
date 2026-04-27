export type DesktopPageKey = "home" | "artifacts" | "settings" | "system";

export interface DesktopPageDefinition {
  key: DesktopPageKey;
  label: string;
}

export const desktopPageDefinitions: readonly DesktopPageDefinition[] = [
  {
    key: "artifacts",
    label: "Data",
  },
  {
    key: "settings",
    label: "Settings",
  },
  {
    key: "system",
    label: "System",
  },
];
