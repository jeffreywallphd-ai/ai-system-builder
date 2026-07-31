import type { DatasetPreparationMemoryOverflowPolicy } from "./dataset-preparation";

const GIBIBYTE = 1024 ** 3;

export const DATASET_PREPARATION_MEMORY_OVERFLOW_BYTES: Readonly<
  Record<DatasetPreparationMemoryOverflowPolicy, number>
> = {
  none: 0,
  limited: GIBIBYTE,
  extended: 4 * GIBIBYTE,
};

export const DATASET_PREPARATION_GENERATION_MODEL_ESTIMATED_BYTES: Readonly<
  Record<string, number>
> = {
  "Qwen/Qwen2.5-7B-Instruct": 15 * GIBIBYTE,
  "Qwen/Qwen2.5-3B-Instruct": 5.75 * GIBIBYTE,
  "Qwen/Qwen2.5-1.5B-Instruct": 3 * GIBIBYTE,
};

export const DATASET_PREPARATION_CAPACITY_SNAPSHOT_MAX_AGE_MS = 5 * 60 * 1000;
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
  availableSystemMemoryBytes?: number;
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
  memoryOverflowPolicy?: DatasetPreparationMemoryOverflowPolicy;
  capacity?: DatasetPreparationGenerationCapacitySnapshot;
  now?: string | number | Date;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const boundedPositiveInteger = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isSafeInteger(value) && value > 0
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
 * Normalizes untrusted host facts without retaining hardware identity or paths.
 * Desktop may provide current available memory; shared server hosts can omit it.
 * Invalid snapshots intentionally become unavailable.
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
  const availableSystemMemoryBytes = boundedPositiveInteger(
    value.availableSystemMemoryBytes,
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
    ...(availableSystemMemoryBytes ? { availableSystemMemoryBytes } : {}),
    ...(totalAcceleratorMemoryBytes ? { totalAcceleratorMemoryBytes } : {}),
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

export interface DatasetPreparationGenerationModelCapacityResolution {
  supported: boolean;
  reason:
    | "capacity-sufficient-cuda"
    | "capacity-sufficient-cpu"
    | "capacity-insufficient"
    | "capacity-unknown";
  requiredMemoryBytes?: number;
  availableMemoryBytes?: number;
  estimatedMemoryShortfallBytes?: number;
  allowedMemoryOverflowBytes?: number;
  memoryOverflowRequired?: boolean;
}

export function resolveDatasetPreparationAllowedMemoryOverflowBytes(
  policy: DatasetPreparationMemoryOverflowPolicy | undefined,
): number {
  return DATASET_PREPARATION_MEMORY_OVERFLOW_BYTES[policy ?? "none"];
}

export function resolveDatasetPreparationGenerationModelCapacity(input: {
  selectedDevice: "cpu" | "cuda" | "auto";
  estimatedModelBytes?: number;
  capacity?: DatasetPreparationGenerationCapacitySnapshot;
  memoryOverflowPolicy?: DatasetPreparationMemoryOverflowPolicy;
}): DatasetPreparationGenerationModelCapacityResolution {
  const estimatedModelBytes = boundedPositiveInteger(input.estimatedModelBytes);
  if (!estimatedModelBytes || !input.capacity) {
    return { supported: false, reason: "capacity-unknown" };
  }

  const requiredMemoryBytes = Math.ceil(estimatedModelBytes * 1.25) + GIBIBYTE;
  const totalSystemMemoryBytes = boundedPositiveInteger(
    input.capacity.totalSystemMemoryBytes,
  );
  const availableSystemMemoryBytes = boundedPositiveInteger(
    input.capacity.availableSystemMemoryBytes,
  );
  const totalAcceleratorMemoryBytes = boundedPositiveInteger(
    input.capacity.totalAcceleratorMemoryBytes,
  );
  const allowedMemoryOverflowBytes =
    resolveDatasetPreparationAllowedMemoryOverflowBytes(
      input.memoryOverflowPolicy,
    );
  if (
    (input.selectedDevice === "cuda" || input.selectedDevice === "auto") &&
    totalAcceleratorMemoryBytes !== undefined &&
    totalAcceleratorMemoryBytes >= requiredMemoryBytes
  ) {
    return {
      supported: true,
      reason: "capacity-sufficient-cuda",
      requiredMemoryBytes,
      availableMemoryBytes: totalAcceleratorMemoryBytes,
      estimatedMemoryShortfallBytes: 0,
      allowedMemoryOverflowBytes: 0,
      memoryOverflowRequired: false,
    };
  }

  const availableCpuMemoryBytes =
    availableSystemMemoryBytes ??
    (totalSystemMemoryBytes !== undefined
      ? totalSystemMemoryBytes - 4 * GIBIBYTE
      : undefined);
  const estimatedMemoryShortfallBytes =
    availableCpuMemoryBytes === undefined
      ? undefined
      : Math.max(0, requiredMemoryBytes - availableCpuMemoryBytes);
  if (
    (input.selectedDevice === "cpu" || input.selectedDevice === "auto") &&
    availableCpuMemoryBytes !== undefined &&
    availableCpuMemoryBytes + allowedMemoryOverflowBytes >= requiredMemoryBytes
  ) {
    return {
      supported: true,
      reason: "capacity-sufficient-cpu",
      requiredMemoryBytes,
      availableMemoryBytes: availableCpuMemoryBytes,
      estimatedMemoryShortfallBytes,
      allowedMemoryOverflowBytes,
      memoryOverflowRequired: (estimatedMemoryShortfallBytes ?? 0) > 0,
    };
  }

  return {
    supported: false,
    reason:
      totalSystemMemoryBytes === undefined &&
      availableSystemMemoryBytes === undefined &&
      totalAcceleratorMemoryBytes === undefined
        ? "capacity-unknown"
        : "capacity-insufficient",
    requiredMemoryBytes,
    availableMemoryBytes:
      input.selectedDevice === "cuda"
        ? totalAcceleratorMemoryBytes
        : availableCpuMemoryBytes,
    estimatedMemoryShortfallBytes,
    allowedMemoryOverflowBytes:
      input.selectedDevice === "cuda" ? 0 : allowedMemoryOverflowBytes,
    memoryOverflowRequired: false,
  };
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
  memoryOverflowPolicy?: DatasetPreparationMemoryOverflowPolicy;
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

  if (!boundedPositiveInteger(input.estimatedModelBytes)) {
    return { recommended: false, reason: "model-size-unknown" };
  }

  const modelCapacity = resolveDatasetPreparationGenerationModelCapacity({
    selectedDevice: input.selectedDevice,
    estimatedModelBytes: input.estimatedModelBytes,
    memoryOverflowPolicy: input.memoryOverflowPolicy,
    capacity,
  });
  if (
    modelCapacity.reason === "capacity-sufficient-cuda" &&
    boundedPositiveInteger(capacity.totalSystemMemoryBytes) !== undefined &&
    capacity.totalSystemMemoryBytes! >= 8 * GIBIBYTE
  ) {
    return { recommended: true, reason: "recommended-cuda" };
  }

  if (
    modelCapacity.reason === "capacity-sufficient-cpu" &&
    boundedPositiveInteger(capacity.logicalProcessorCount) !== undefined &&
    capacity.logicalProcessorCount! >=
      DATASET_PREPARATION_MIN_CPU_LOGICAL_PROCESSORS
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
    memoryOverflowPolicy: input.memoryOverflowPolicy,
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
