import { describe, expect, it } from "../../testing/node-test";

import {
  createHostConfig,
  createLoggingConfig,
  createPersistenceConfig,
  createRuntimeConfig,
  createStorageConfig,
  createSystemConfig,
} from ".";

describe("config contracts", () => {
  it("creates host and runtime config from shared host/runtime vocabularies", () => {
    const host = createHostConfig({
      kind: " SERVER ",
      id: "server-primary",
    });
    const runtime = createRuntimeConfig({
      runtimeKind: " PYTHON ",
      defaultExecutionOptions: {
        timeoutMs: 1500,
        includeDiagnostics: true,
      },
    });

    expect(host).toEqual({
      kind: "server",
      id: "server-primary",
    });
    expect(runtime).toEqual({
      defaultTarget: {
        kind: "python",
        adapter: undefined,
        capability: undefined,
        metadata: undefined,
      },
      defaultExecutionOptions: {
        timeoutMs: 1500,
        includeDiagnostics: true,
      },
    });
  });

  it("represents logging verbosity through config contracts", () => {
    const logging = createLoggingConfig({
      verbosity: " VERBOSE ",
      level: "info",
      includeDiagnostics: true,
    });

    expect(logging).toEqual({
      verbosity: "verbose",
      level: "info",
      includeDiagnostics: true,
    });
  });

  it("creates a small grouped config envelope with explicit concern sections", () => {
    const config = createSystemConfig({
      persistence: createPersistenceConfig({
        adapter: " POSTGRES ",
        namespace: " APP.DATA ",
        operationTimeoutMs: 2000,
      }),
      storage: createStorageConfig({
        adapter: " FILESYSTEM ",
        namespace: " ARTIFACTS ",
      }),
    });

    expect(config).toEqual({
      host: {
        kind: "desktop",
        id: undefined,
      },
      runtime: {
        defaultTarget: {
          kind: "node",
          adapter: undefined,
          capability: undefined,
          metadata: undefined,
        },
        defaultExecutionOptions: undefined,
      },
      logging: {
        verbosity: "normal",
        level: undefined,
        includeDiagnostics: undefined,
      },
      persistence: {
        adapter: "postgres",
        namespace: "app.data",
        operationTimeoutMs: 2000,
      },
      storage: {
        adapter: "filesystem",
        namespace: "artifacts",
        operationTimeoutMs: undefined,
      },
    });
  });

  it("rejects unknown top-level system config sections", () => {
    expect(() =>
      createSystemConfig(
        {
          host: createHostConfig(),
          runtime: createRuntimeConfig(),
          logging: createLoggingConfig(),
          // Cast to verify runtime anti-drift behavior.
          featureFlags: { alpha: true },
        } as unknown as Parameters<typeof createSystemConfig>[0],
      ),
    ).toThrow(
      'System config only supports host/runtime/logging/persistence/storage sections. Received unknown section "featureFlags".',
    );
  });
});
