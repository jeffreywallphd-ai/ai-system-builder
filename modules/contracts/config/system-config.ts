import {
  createHostConfig,
  type HostConfig,
} from "./host-config";
import {
  createLoggingConfig,
  type LoggingConfig,
} from "./logging-config";
import {
  createPersistenceConfig,
  type PersistenceConfig,
} from "./persistence-config";
import {
  createRuntimeConfig,
  type RuntimeConfig,
} from "./runtime-config";
import {
  createStorageConfig,
  type StorageConfig,
} from "./storage-config";

const SYSTEM_CONFIG_SECTIONS = [
  "host",
  "runtime",
  "logging",
  "persistence",
  "storage",
] as const;

type SystemConfigSection = (typeof SYSTEM_CONFIG_SECTIONS)[number];

function isSystemConfigSection(key: string): key is SystemConfigSection {
  return (SYSTEM_CONFIG_SECTIONS as readonly string[]).includes(key);
}

function assertOnlyKnownSystemConfigSections(
  options: Record<string, unknown>,
): void {
  const unknownSection = Object.keys(options).find(
    (key) => !isSystemConfigSection(key),
  );

  if (!unknownSection) {
    return;
  }

  throw new Error(
    `System config only supports host/runtime/logging/persistence/storage sections. Received unknown section "${unknownSection}".`,
  );
}

export interface SystemConfig {
  host: HostConfig;
  runtime: RuntimeConfig;
  logging: LoggingConfig;
  persistence?: PersistenceConfig;
  storage?: StorageConfig;
}

export function createSystemConfig(options?: {
  host?: HostConfig;
  runtime?: RuntimeConfig;
  logging?: LoggingConfig;
  persistence?: PersistenceConfig;
  storage?: StorageConfig;
}): SystemConfig {
  if (options) {
    assertOnlyKnownSystemConfigSections(options as Record<string, unknown>);
  }

  return {
    host: options?.host ?? createHostConfig(),
    runtime: options?.runtime ?? createRuntimeConfig(),
    logging: options?.logging ?? createLoggingConfig(),
    persistence:
      options?.persistence === undefined
        ? undefined
        : createPersistenceConfig(options.persistence),
    storage:
      options?.storage === undefined
        ? undefined
        : createStorageConfig(options.storage),
  };
}
