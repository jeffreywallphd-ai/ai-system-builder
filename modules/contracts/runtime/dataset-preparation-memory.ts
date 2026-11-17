import { DATASET_PREPARATION_CAPACITY_SNAPSHOT_MAX_AGE_MS, type DatasetPreparationGenerationCapacitySnapshot } from "./dataset-preparation-constrained-json";

/** Explicit versioned loading policy; it never grants overflow or changes precision. */
export type DatasetPreparationMemoryMode = "standard" | "offload-v1";

export const DATASET_PREPARATION_OFFLOAD_CAPABILITY =
  "dataset-preparation.offload-v1";

/** Parameter-placement and owned-staging limits, not a total-process memory cap. */
export const DATASET_PREPARATION_OFFLOAD_PROFILE = Object.freeze({
  mode: "offload-v1" as const,
  maximumCpuWeightBytes: 1024 ** 3,
  maximumAcceleratorWeightBytes: 2 * 1024 ** 3,
  maximumOwnedStagingBytes: 12 * 1024 ** 3,
});

export function normalizeDatasetPreparationMemoryMode(
  value: unknown,
): DatasetPreparationMemoryMode {
  if (value === undefined || value === "standard") return "standard";
  if (value === "offload-v1") return value;
  throw new Error("Unsupported local-model memory profile.");
}

export function supportsDatasetPreparationOffload(
  capabilities: unknown,
): boolean {
  return (
    Array.isArray(capabilities) &&
    capabilities.includes(DATASET_PREPARATION_OFFLOAD_CAPABILITY)
  );
}

export function resolveDatasetPreparationMemoryProfile(value: unknown) {
  return normalizeDatasetPreparationMemoryMode(value) === "offload-v1"
    ? DATASET_PREPARATION_OFFLOAD_PROFILE
    : undefined;
}

export function isDatasetPreparationOffloadAvailable(
  capacity: DatasetPreparationGenerationCapacitySnapshot | undefined,
  nowMilliseconds = Date.now(),
): boolean {
  if (capacity?.offloadAvailable !== true || !Number.isFinite(nowMilliseconds)) return false;
  const captured = Date.parse(capacity.capturedAt);
  return Number.isFinite(captured) && captured <= nowMilliseconds + 30_000
    && nowMilliseconds - captured <= DATASET_PREPARATION_CAPACITY_SNAPSHOT_MAX_AGE_MS;
}
