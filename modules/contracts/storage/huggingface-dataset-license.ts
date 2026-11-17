export interface HuggingFaceDatasetSummary {
  readonly namespace: string;
  readonly repository: string;
  readonly licenseIds?: readonly string[];
}

export type DatasetLicenseCategory = "creative-commons" | "other-open" | "non-open" | "unknown";

const openCreativeCommons = new Set([
  "cc0-1.0", "cc-by-2.0", "cc-by-2.5", "cc-by-3.0", "cc-by-4.0",
  "cc-by-sa-3.0", "cc-by-sa-4.0",
]);
const otherOpen = new Set([
  "apache-2.0", "mit", "bsd-2-clause", "bsd-3-clause", "isc", "mpl-2.0",
  "gpl-2.0", "gpl-3.0", "lgpl-2.1", "lgpl-3.0", "agpl-3.0",
  "cdla-permissive-1.0", "cdla-permissive-2.0", "cdla-sharing-1.0",
  "etalab-2.0", "odc-by", "odbl", "pddl", "unlicense",
]);
const nonOpen = new Set([
  "cc-by-nc-2.0", "cc-by-nc-3.0", "cc-by-nc-4.0", "cc-by-nd-4.0",
  "cc-by-nc-nd-3.0", "cc-by-nc-nd-4.0",
  "cc-by-nc-sa-2.0", "cc-by-nc-sa-3.0", "cc-by-nc-sa-4.0",
  "fair-noncommercial-research-license", "proprietary", "all-rights-reserved",
]);
const maximumLicenseIds = 8;

/** Accept only known identifiers from an untrusted provider or transport. */
export function readHuggingFaceDatasetLicenseIds(input: unknown): readonly string[] {
  const values = typeof input === "string" ? [input] : input;
  if (!Array.isArray(values) || values.length > maximumLicenseIds) return [];

  const ids = new Set<string>();
  for (const value of values) {
    const id = typeof value === "string" && value.length <= 64 ? value.trim().toLowerCase() : "";
    if (openCreativeCommons.has(id) || otherOpen.has(id) || nonOpen.has(id) || id === "other") {
      ids.add(id);
    } else {
      ids.add("unknown");
    }
  }
  return [...ids].sort();
}

export function describeHuggingFaceDatasetLicense(input: unknown): {
  readonly ids: readonly string[];
  readonly category: DatasetLicenseCategory;
} {
  const ids = readHuggingFaceDatasetLicenseIds(input);
  if (ids.some((id) => nonOpen.has(id))) return { ids, category: "non-open" };
  if (ids.length && ids.every((id) => openCreativeCommons.has(id))) return { ids, category: "creative-commons" };
  if (ids.length && ids.every((id) => otherOpen.has(id))) return { ids, category: "other-open" };
  return { ids, category: "unknown" };
}
