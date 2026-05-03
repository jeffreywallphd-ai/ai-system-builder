const TRANSIENT_DISCONNECT_PATTERNS = [
  "failed to fetch",
  "fetch failed",
  "networkerror",
  "network request failed",
  "load failed",
] as const;

function resolveErrorMessage(error: unknown): string | undefined {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === "string") {
    return error;
  }
  return undefined;
}

export function isTransientDatasetPreparationTransportMessage(message: string): boolean {
  const normalized = message.trim().toLowerCase();
  if (normalized.length === 0) {
    return false;
  }

  return TRANSIENT_DISCONNECT_PATTERNS.some((pattern) => normalized === pattern || normalized.includes(pattern));
}

export function isTransientDatasetPreparationTransportError(error: unknown): boolean {
  const message = resolveErrorMessage(error);
  return typeof message === "string" && isTransientDatasetPreparationTransportMessage(message);
}

export function normalizeDatasetPreparationTransportError(error: unknown): Error {
  if (isTransientDatasetPreparationTransportError(error)) {
    return new Error("fetch failed");
  }

  if (error instanceof Error) {
    return error;
  }

  if (typeof error === "string" && error.trim().length > 0) {
    return new Error(error);
  }

  return new Error("Dataset preparation failed.");
}

export function resolveUserFacingDatasetPreparationErrorMessage(error: unknown): string {
  if (isTransientDatasetPreparationTransportError(error)) {
    return "We lost connection while preparing the dataset. Re-run preparation if this persists.";
  }

  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message;
  }

  return "Dataset preparation failed.";
}
