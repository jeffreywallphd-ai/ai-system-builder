export interface ThinClientWebsiteIngestionTarget {
  url: string;
}

export function parseWebsiteBatchTargets(value: string): ThinClientWebsiteIngestionTarget[] {
  return value
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((url) => ({ url }));
}
