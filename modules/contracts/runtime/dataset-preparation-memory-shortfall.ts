/** Safe numeric resource facts only; never carries runtime paths or exception text. */
export interface DatasetPreparationMemoryShortfall {
  readonly resource: "ram" | "vram" | "combined";
  readonly requiredBytes: number;
  readonly availableBytes: number;
  readonly allowedOverflowBytes: number;
}

export function normalizeDatasetPreparationMemoryShortfall(
  value: unknown,
): DatasetPreparationMemoryShortfall | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  const { resource, requiredBytes, availableBytes, allowedOverflowBytes } = record;
  const boundedBytes = (bytes: unknown): bytes is number =>
    typeof bytes === "number" && Number.isSafeInteger(bytes) && bytes >= 0 && bytes <= 1024 ** 5;
  if ((resource !== "ram" && resource !== "vram" && resource !== "combined")
    || !boundedBytes(requiredBytes) || !boundedBytes(availableBytes)
    || !boundedBytes(allowedOverflowBytes)
    || requiredBytes <= availableBytes + allowedOverflowBytes
    || (resource === "vram" && allowedOverflowBytes !== 0)) return undefined;
  return { resource, requiredBytes, availableBytes, allowedOverflowBytes };
}
