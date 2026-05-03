export type RuntimeInstallStatus =
  | "not-installed"
  | "installing"
  | "checking"
  | "installed"
  | "update-available"
  | "failed"
  | "unknown";
