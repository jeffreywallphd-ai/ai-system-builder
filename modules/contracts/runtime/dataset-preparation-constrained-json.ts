const GIBIBYTE = 1024 ** 3;

export const DATASET_PREPARATION_GENERATION_MODEL_ESTIMATED_BYTES: Readonly<
  Record<string, number>
> = {
  "Qwen/Qwen2.5-7B-Instruct": 15 * GIBIBYTE,
  "Qwen/Qwen2.5-3B-Instruct": 7 * GIBIBYTE,
};

export const DATASET_PREPARATION_CAPACITY_SNAPSHOT_MAX_AGE_MS =
  5 * 60 * 1000;
export const DATASET_PREPARATION_MIN_CPU_LOGICAL_PROCESSORS = 8;

export const DATASET_PREPARATION_CONSTRAINED_JSON_REASONS = [
  "recommended-cuda",
  "recommended-cpu",
  "decoder-unavailable",
  "schema-unsupported",
  "snapshot-missing",
  "snapshot-stale",
  "model-size-unknown",
  "capacity-insufficient",
] as const;

export type DatasetPreparationConstrainedJsonRecommendationReason =
  (typeof DATASET_PREPARATION_CONSTRAINED_JSON_REASONS)[number];

export interface DatasetPreparationGenerationCapacitySnapshot {
  schemaVersion: "1";
  capturedAt: string;
  decoderAvailable: boolean;
  schemaSupported: boolean;
  logicalProcessorCount?: number;
  totalSystemMemoryBytes?: number;
  totalAcceleratorMemoryBytes?: number;
}

export interface DatasetPreparationConstrainedJsonResolution {
  enabled: boolean;
  source: "adaptive" | "explicit";
  recommended: boolean;
  recommendationReason: DatasetPreparationConstrainedJsonRecommendationReason;
}

export interface DatasetPreparationConstrainedJsonResolutionInput {
  preference?: boolean;
  selectedDevice: "cpu" | "cuda" | "auto";
  estimatedModelBytes?: number;
  capacity?: DatasetPreparationGenerationCapacitySnapshot;
  now?: string | number | Date;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const boundedPositiveInteger = (value: unknown): number | undefined =>
  typeof value === "number" &&
  Number.isSafeInteger(value) &&
  value > 0
    ? value
    : undefined;

const normalizedTimestamp = (value: unknown): string | undefined => {
  if (typeof value !== "string" || value.length > 64) return undefined;
  const milliseconds = Date.parse(value);
  return Number.isFinite(milliseconds)
    ? new Date(milliseconds).toISOString()
    : undefined;
};

/**
 * Normalizes untrusted host facts without retaining hardware identity, paths, or
 * live utilization. Invalid snapshots intentionally become unavailable.
 */
export function normalizeDatasetPreparationGenerationCapacitySnapshot(
  value: unknown,
): DatasetPreparationGenerationCapacitySnapshot | undefined {
  if (!isRecord(value) || value.schemaVersion !== "1") return undefined;
  const capturedAt = normalizedTimestamp(value.capturedAt);
  if (
    !capturedAt ||
    typeof value.decoderAvailable !== "boolean" ||
    typeof value.schemaSupported !== "boolean"
  ) {
    return undefined;
  }

  const logicalProcessorCount = boundedPositiveInteger(
    value.logicalProcessorCount,
  );
  const totalSystemMemoryBytes = boundedPositiveInteger(
    value.totalSystemMemoryBytes,
  );
  const totalAcceleratorMemoryBytes = boundedPositiveInteger(
    value.totalAcceleratorMemoryBytes,
  );

  return {
    schemaVersion: "1",
    capturedAt,
    decoderAvailable: value.decoderAvailable,
    schemaSupported: value.schemaSupported,
    ...(logicalProcessorCount ? { logicalProcessorCount } : {}),
    ...(totalSystemMemoryBytes ? { totalSystemMemoryBytes } : {}),
    ...(totalAcceleratorMemoryBytes
      ? { totalAcceleratorMemoryBytes }
      : {}),
  };
}

export function normalizeConstrainedJsonDecodingPreference(
  value: unknown,
): boolean | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "boolean") {
    throw new Error(
      "generation.structuredOutput.constrainedDecoding must be a boolean when provided.",
    );
  }
  return value;
}

export function resolveDatasetPreparationGenerationModelEstimatedBytes(
  modelId: string | undefined,
): number | undefined {
  const normalized = modelId?.trim();
  return normalized
    ? DATASET_PREPARATION_GENERATION_MODEL_ESTIMATED_BYTES[normalized]
    : undefined;
}

const toNowMilliseconds = (
  value: DatasetPreparationConstrainedJsonResolutionInput["now"],
): number => {
  if (value instanceof Date) return value.getTime();
  if (typeof value === "number") return value;
  if (typeof value === "string") return Date.parse(value);
  return Date.now();
};

function capacityRecommendation(input: {
  selectedDevice: DatasetPreparationConstrainedJsonResolutionInput["selectedDevice"];
  estimatedModelBytes?: number;
  capacity?: DatasetPreparationGenerationCapacitySnapshot;
  nowMilliseconds: number;
}): {
  recommended: boolean;
  reason: DatasetPreparationConstrainedJsonRecommendationReason;
} {
  const capacity = input.capacity;
  if (!capacity) return { recommended: false, reason: "snapshot-missing" };

  const capturedAtMilliseconds = Date.parse(capacity.capturedAt);
  if (
    !Number.isFinite(input.nowMilliseconds) ||
    !Number.isFinite(capturedAtMilliseconds) ||
    capturedAtMilliseconds > input.nowMilliseconds + 30_000 ||
    input.nowMilliseconds - capturedAtMilliseconds >
      DATASET_PREPARATION_CAPACITY_SNAPSHOT_MAX_AGE_MS
  ) {
    return { recommended: false, reason: "snapshot-stale" };
  }
  if (!capacity.decoderAvailable) {
    return { recommended: false, reason: "decoder-unavailable" };
  }
  if (!capacity.schemaSupported) {
    return { recommended: false, reason: "schema-unsupported" };
  }

  const estimatedModelBytes = boundedPositiveInteger(
    input.estimatedModelBytes,
  );
  if (!estimatedModelBytes) {
    return { recommended: false, reason: "model-size-unknown" };
  }

  // Model bytes receive a 25% loading margin and the decoder receives a fixed
  // 1 GiB reserve. Hosts provide total capacity rather than volatile free-memory
  // readings so an untouched checkbox cannot oscillate with live utilization.
  const requiredDeviceBytes =
    Math.ceil(estimatedModelBytes * 1.25) + GIBIBYTE;
  const totalSystemMemoryBytes = boundedPositiveInteger(
    capacity.totalSystemMemoryBytes,
  );
  const totalAcceleratorMemoryBytes = boundedPositiveInteger(
    capacity.totalAcceleratorMemoryBytes,
  );

  const cudaSufficient =
    totalAcceleratorMemoryBytes !== undefined &&
    totalAcceleratorMemoryBytes >= requiredDeviceBytes &&
    totalSystemMemoryBytes !== undefined &&
    totalSystemMemoryBytes >= 8 * GIBIBYTE;
  if (
    (input.selectedDevice === "cuda" || input.selectedDevice === "auto") &&
    cudaSufficient
  ) {
    return { recommended: true, reason: "recommended-cuda" };
  }

  const cpuSufficient =
    totalSystemMemoryBytes !== undefined &&
    totalSystemMemoryBytes - 4 * GIBIBYTE >= requiredDeviceBytes &&
    boundedPositiveInteger(capacity.logicalProcessorCount) !== undefined &&
    capacity.logicalProcessorCount! >=
      DATASET_PREPARATION_MIN_CPU_LOGICAL_PROCESSORS;
  if (
    (input.selectedDevice === "cpu" || input.selectedDevice === "auto") &&
    cpuSufficient
  ) {
    return { recommended: true, reason: "recommended-cpu" };
  }

  return { recommended: false, reason: "capacity-insufficient" };
}

/**
 * Resolves an initial checkbox state. An explicit user choice always wins;
 * otherwise unavailable, stale, or insufficient facts fail safe to unchecked.
 */
export function resolveDatasetPreparationConstrainedJson(
  input: DatasetPreparationConstrainedJsonResolutionInput,
): DatasetPreparationConstrainedJsonResolution {
  const recommendation = capacityRecommendation({
    selectedDevice: input.selectedDevice,
    estimatedModelBytes: input.estimatedModelBytes,
    capacity: input.capacity,
    nowMilliseconds: toNowMilliseconds(input.now),
  });
  const preference = normalizeConstrainedJsonDecodingPreference(
    input.preference,
  );
  return {
    enabled: preference ?? recommendation.recommended,
    source: preference === undefined ? "adaptive" : "explicit",
    recommended: recommendation.recommended,
    recommendationReason: recommendation.reason,
  };
}
