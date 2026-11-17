import { normalizeDatasetPreparationMemoryShortfall } from "../../../contracts/runtime";

/** Fixed copy plus validated numeric facts. Raw runtime messages never enter this sink. */
export function getDatasetPreparationMemoryFailureMessage(value?: unknown): string {
  const shortfall = normalizeDatasetPreparationMemoryShortfall(value);
  if (!shortfall) return "The selected model cannot fit in the memory currently available. Close memory-heavy applications or select a smaller built-in model, then retry.";
  const missing = shortfall.requiredBytes - shortfall.availableBytes - shortfall.allowedOverflowBytes;
  const amount = `${Math.ceil(missing / 1024 ** 2)} MiB`;
  const resource = shortfall.resource === "ram" ? "RAM" : shortfall.resource === "vram" ? "GPU memory (VRAM)" : "combined RAM/GPU memory";
  return `The selected model needs more memory. Free at least ${amount} of ${resource}, then retry, or choose a smaller model. This is the shortfall at the latest check; available memory can change.`;
}
