export const PERSISTENCE_ADAPTER_ID_FORMAT_DESCRIPTION =
  "a non-empty, lowercase adapter identifier using letters, numbers, dots, hyphens, or underscores";

export const PERSISTENCE_NAMESPACE_FORMAT_DESCRIPTION =
  "a non-empty, lowercase namespace using letters, numbers, dots, hyphens, or underscores";

export const PERSISTENCE_OPERATION_TIMEOUT_MS_FORMAT_DESCRIPTION =
  "a positive integer timeout in milliseconds";

export type PersistenceAdapterId = string;
export type PersistenceNamespace = string;
export type PersistenceOperationTimeoutMs = number;

export interface PersistenceConfig {
  adapter: PersistenceAdapterId;
  namespace?: PersistenceNamespace;
  operationTimeoutMs?: PersistenceOperationTimeoutMs;
}

const CONFIG_TOKEN_PATTERN = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/;

function invalidPersistenceAdapterMessage(adapter: string): string {
  return `Persistence adapter must be ${PERSISTENCE_ADAPTER_ID_FORMAT_DESCRIPTION}. Received "${adapter}".`;
}

function invalidPersistenceNamespaceMessage(namespace: string): string {
  return `Persistence namespace must be ${PERSISTENCE_NAMESPACE_FORMAT_DESCRIPTION}. Received "${namespace}".`;
}

function invalidPersistenceOperationTimeoutMessage(timeoutMs: number): string {
  return `Persistence operation timeout must be ${PERSISTENCE_OPERATION_TIMEOUT_MS_FORMAT_DESCRIPTION}. Received "${timeoutMs}".`;
}

export function isPersistenceAdapterId(
  adapter: string,
): adapter is PersistenceAdapterId {
  return CONFIG_TOKEN_PATTERN.test(adapter.trim());
}

export function normalizePersistenceAdapterId(
  adapter: string,
): PersistenceAdapterId {
  const normalizedAdapter = adapter.trim().toLowerCase();

  if (!isPersistenceAdapterId(normalizedAdapter)) {
    throw new Error(invalidPersistenceAdapterMessage(adapter));
  }

  return normalizedAdapter;
}

export function isPersistenceNamespace(
  namespace: string,
): namespace is PersistenceNamespace {
  return CONFIG_TOKEN_PATTERN.test(namespace.trim());
}

export function normalizePersistenceNamespace(
  namespace: string,
): PersistenceNamespace {
  const normalizedNamespace = namespace.trim().toLowerCase();

  if (!isPersistenceNamespace(normalizedNamespace)) {
    throw new Error(invalidPersistenceNamespaceMessage(namespace));
  }

  return normalizedNamespace;
}

export function normalizePersistenceOperationTimeoutMs(
  timeoutMs: number,
): PersistenceOperationTimeoutMs {
  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) {
    throw new Error(invalidPersistenceOperationTimeoutMessage(timeoutMs));
  }

  return timeoutMs;
}

export function createPersistenceConfig(options: {
  adapter: string;
  namespace?: string;
  operationTimeoutMs?: number;
}): PersistenceConfig {
  return {
    adapter: normalizePersistenceAdapterId(options.adapter),
    namespace:
      options.namespace === undefined
        ? undefined
        : normalizePersistenceNamespace(options.namespace),
    operationTimeoutMs:
      options.operationTimeoutMs === undefined
        ? undefined
        : normalizePersistenceOperationTimeoutMs(options.operationTimeoutMs),
  };
}
