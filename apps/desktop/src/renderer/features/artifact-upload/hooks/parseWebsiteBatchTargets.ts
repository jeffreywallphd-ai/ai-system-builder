import type { DesktopWebsiteIngestionTarget } from "../../../lib/desktopApi";

export function parseWebsiteBatchTargets(value: string): DesktopWebsiteIngestionTarget[] {
  return value
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((url) => ({ url }));
}
