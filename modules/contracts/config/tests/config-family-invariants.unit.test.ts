import { describe, expect, it } from "../../../testing/node-test";

import * as configContracts from "..";

describe("config family invariants", () => {
  it("exports only config-family contract surfaces from the family barrel", () => {
    expect(Object.keys(configContracts).sort()).toEqual([
      "PERSISTENCE_ADAPTER_ID_FORMAT_DESCRIPTION",
      "PERSISTENCE_NAMESPACE_FORMAT_DESCRIPTION",
      "PERSISTENCE_OPERATION_TIMEOUT_MS_FORMAT_DESCRIPTION",
      "STORAGE_ADAPTER_ID_FORMAT_DESCRIPTION",
      "STORAGE_NAMESPACE_FORMAT_DESCRIPTION",
      "STORAGE_OPERATION_TIMEOUT_MS_FORMAT_DESCRIPTION",
      "createHostConfig",
      "createLoggingConfig",
      "createPersistenceConfig",
      "createRuntimeConfig",
      "createStorageConfig",
      "createSystemConfig",
      "isPersistenceAdapterId",
      "isPersistenceNamespace",
      "isStorageAdapterId",
      "isStorageNamespace",
      "normalizePersistenceAdapterId",
      "normalizePersistenceNamespace",
      "normalizePersistenceOperationTimeoutMs",
      "normalizeStorageAdapterId",
      "normalizeStorageNamespace",
      "normalizeStorageOperationTimeoutMs",
    ]);
  });

  it("keeps persistence and storage config typed, normalized, and concern-specific", () => {
    const persistence = configContracts.createPersistenceConfig({
      adapter: " postgres.primary ",
      namespace: " app.data ",
      operationTimeoutMs: 2500,
    });
    const storage = configContracts.createStorageConfig({
      adapter: " filesystem.local ",
      namespace: " artifacts.work ",
      operationTimeoutMs: 5000,
    });

    expect(persistence).toEqual({
      adapter: "postgres.primary",
      namespace: "app.data",
      operationTimeoutMs: 2500,
    });
    expect(storage).toEqual({
      adapter: "filesystem.local",
      namespace: "artifacts.work",
      operationTimeoutMs: 5000,
    });
  });

  it("rejects generic-bag drift in system and concern config helpers", () => {
    expect(() =>
      configContracts.createPersistenceConfig({
        adapter: "postgres primary",
      }),
    ).toThrow(
      'Persistence adapter must be a non-empty, lowercase adapter identifier using letters, numbers, dots, hyphens, or underscores. Received "postgres primary".',
    );

    expect(() =>
      configContracts.createStorageConfig({
        adapter: "filesystem",
        operationTimeoutMs: 0,
      }),
    ).toThrow(
      'Storage operation timeout must be a positive integer timeout in milliseconds. Received "0".',
    );

    expect(() =>
      configContracts.createSystemConfig(
        {
          host: configContracts.createHostConfig(),
          runtime: configContracts.createRuntimeConfig(),
          logging: configContracts.createLoggingConfig({
            verbosity: "verbose",
          }),
          settings: {
            any: "value",
          },
        } as unknown as Parameters<typeof configContracts.createSystemConfig>[0],
      ),
    ).toThrow(
      'System config only supports host/runtime/logging/persistence/storage sections. Received unknown section "settings".',
    );
  });
});
