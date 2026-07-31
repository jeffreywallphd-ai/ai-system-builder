import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "../../testing/node-test";
import { createOrganizationId } from "../organization";

import {
  createDefaultDeploymentPersistenceTarget,
  createHostConfig,
  createLoggingConfig,
  createPersistenceConfig,
  createRuntimeConfig,
  createStorageConfig,
  createSystemConfig,
  createTenantPlacementConfig,
  tenantPlacementAllowsOrganization,
} from ".";

describe("config contracts", () => {
  it("defaults to pooled placement and constrains premium dedicated placement", () => {
    expect(createTenantPlacementConfig()).toEqual({ mode: "pooled" });
    const dedicated = createTenantPlacementConfig({
      mode: "dedicated",
      organizationId: "org-premium",
    });
    expect(dedicated).toEqual({
      mode: "dedicated",
      organizationId: "org-premium",
    });
    expect(tenantPlacementAllowsOrganization(
      dedicated,
      createOrganizationId("org-premium"),
    )).toBe(true);
    expect(tenantPlacementAllowsOrganization(
      dedicated,
      createOrganizationId("org-other"),
    )).toBe(false);
    expect(() => createTenantPlacementConfig({ mode: "dedicated" })).toThrow(
      /requires an organization id/,
    );
    expect(() => createTenantPlacementConfig({
      mode: "pooled",
      organizationId: "org-invalid-for-pooled",
    })).toThrow(/must not configure/);
  });
  it("selects deployment-shaped structured persistence targets", () => {
    expect(createDefaultDeploymentPersistenceTarget(" LOCAL ")).toEqual({
      deploymentShape: "local",
      persistence: {
        adapter: "sqlite",
        namespace: "app.data",
        operationTimeoutMs: undefined,
      },
      accessMode: "embedded-single-host",
    });

    for (const deploymentShape of [
      "campus-server",
      "corporate-server",
      "cloud",
    ]) {
      expect(createDefaultDeploymentPersistenceTarget(deploymentShape)).toEqual({
        deploymentShape,
        persistence: {
          adapter: "postgres",
          namespace: "app.data",
          operationTimeoutMs: undefined,
        },
        accessMode: "client-server",
      });
    }
  });

  it("rejects deployment shapes without an accepted persistence target", () => {
    expect(() => createDefaultDeploymentPersistenceTarget("hybrid")).toThrow(
      'Deployment shape must be one of local, campus-server, corporate-server, cloud. Received "hybrid".',
    );
  });

  it("keeps managed deployment profiles aligned with typed persistence targets", () => {
    const configRoot = path.resolve("config", "environments", "server");
    const document = JSON.parse(readFileSync(path.join(configRoot, "deployment-profiles.json"), "utf8")) as {
      schemaVersion: number;
      profiles: Array<{
        shape: string;
        structuredPersistence: string;
        requiredSecretEnvironment: string[];
        requiredEnvironment: string[];
      }>;
    };
    expect(document.schemaVersion).toBe(1);
    expect(document.profiles.map(({ shape }) => shape).sort()).toEqual([
      "campus-server", "cloud", "corporate-server",
    ]);
    for (const profile of document.profiles) {
      expect(createDefaultDeploymentPersistenceTarget(profile.shape).persistence.adapter).toBe("postgres");
      expect(profile.structuredPersistence).toBe("postgres");
      expect(profile.requiredSecretEnvironment).toContain("DATABASE_URL");
      expect(profile.requiredSecretEnvironment).not.toContain("SERVER_TOKEN_HASH_SECRET");

      const exampleName = profile.shape === "campus-server" ? "campus.env.example"
        : profile.shape === "corporate-server" ? "corporate.env.example"
          : "cloud.env.example";
      const example = readFileSync(path.join(configRoot, exampleName), "utf8");
      for (const name of profile.requiredEnvironment) expect(example).toContain(`${name}=`);
      expect(example).toContain(`DEPLOYMENT_SHAPE=${profile.shape}`);
      expect(example).toContain("POSTGRES_SSL_MODE=verify-full");
      expect(example).toContain("AI_SYSTEM_BUILDER_SECURITY_MODE=oidc-bearer");
      expect(example).toContain("AI_SYSTEM_BUILDER_TENANT_PLACEMENT_MODE=pooled");
      expect(example).not.toMatch(/^DATABASE_URL=/m);
      expect(example).not.toMatch(/^SERVER_TOKEN_HASH_SECRET=/m);
    }
  });

  it("does not treat a deployment target as an active host adapter", () => {
    expect(createSystemConfig().persistence).toBeUndefined();
  });

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
