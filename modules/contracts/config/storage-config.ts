export const STORAGE_ADAPTER_ID_FORMAT_DESCRIPTION =
  "a non-empty, lowercase adapter identifier using letters, numbers, dots, hyphens, or underscores";

export const STORAGE_NAMESPACE_FORMAT_DESCRIPTION =
  "a non-empty, lowercase namespace using letters, numbers, dots, hyphens, or underscores";

export const STORAGE_OPERATION_TIMEOUT_MS_FORMAT_DESCRIPTION =
  "a positive integer timeout in milliseconds";

export type StorageAdapterId = string;
export type StorageNamespace = string;
export type StorageOperationTimeoutMs = number;

export interface StorageConfig {
  adapter: StorageAdapterId;
  namespace?: StorageNamespace;
  operationTimeoutMs?: StorageOperationTimeoutMs;
}

const CONFIG_TOKEN_PATTERN = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/;

function invalidStorageAdapterMessage(adapter: string): string {
  return `Storage adapter must be ${STORAGE_ADAPTER_ID_FORMAT_DESCRIPTION}. Received "${adapter}".`;
}

function invalidStorageNamespaceMessage(namespace: string): string {
  return `Storage namespace must be ${STORAGE_NAMESPACE_FORMAT_DESCRIPTION}. Received "${namespace}".`;
}

function invalidStorageOperationTimeoutMessage(timeoutMs: number): string {
  return `Storage operation timeout must be ${STORAGE_OPERATION_TIMEOUT_MS_FORMAT_DESCRIPTION}. Received "${timeoutMs}".`;
}

export function isStorageAdapterId(adapter: string): adapter is StorageAdapterId {
  return CONFIG_TOKEN_PATTERN.test(adapter.trim());
}

export function normalizeStorageAdapterId(adapter: string): StorageAdapterId {
  const normalizedAdapter = adapter.trim().toLowerCase();

  if (!isStorageAdapterId(normalizedAdapter)) {
    throw new Error(invalidStorageAdapterMessage(adapter));
  }

  return normalizedAdapter;
}

export function isStorageNamespace(namespace: string): namespace is StorageNamespace {
  return CONFIG_TOKEN_PATTERN.test(namespace.trim());
}

export function normalizeStorageNamespace(namespace: string): StorageNamespace {
  const normalizedNamespace = namespace.trim().toLowerCase();

  if (!isStorageNamespace(normalizedNamespace)) {
    throw new Error(invalidStorageNamespaceMessage(namespace));
  }

  return normalizedNamespace;
}

export function normalizeStorageOperationTimeoutMs(
  timeoutMs: number,
): StorageOperationTimeoutMs {
  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) {
    throw new Error(invalidStorageOperationTimeoutMessage(timeoutMs));
  }

  return timeoutMs;
}

export function createStorageConfig(options: {
  adapter: string;
  namespace?: string;
  operationTimeoutMs?: number;
}): StorageConfig {
  return {
    adapter: normalizeStorageAdapterId(options.adapter),
    namespace:
      options.namespace === undefined
        ? undefined
        : normalizeStorageNamespace(options.namespace),
    operationTimeoutMs:
      options.operationTimeoutMs === undefined
        ? undefined
        : normalizeStorageOperationTimeoutMs(options.operationTimeoutMs),
  };
}
