import { constants as fsConstants, existsSync, readFileSync } from "node:fs";
import { access, statfs } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import http from "node:http";
import https from "node:https";
import path from "node:path";

import express from "express";

import {
  composeServerHost,
  type ServerSystemRuntimeDatabaseAdapter,
} from "../../../modules/hosts/server";
import {
  applySecurityHeaders,
  createExpressJsonBodyErrorMiddleware,
  createExpressOrganizationAuthorizationMiddleware,
  createHttpsServerOptions,
  registerSecurityRoutes,
} from "../../../modules/adapters/transport/api-express/security";
import { composeServerSecurity } from "../../../modules/hosts/server/security/composeServerSecurity";
import type { LoggingPort } from "../../../modules/application/ports/logging";
import type { StructuredLogSink } from "../../../modules/adapters/observability/logging";
import {
  normalizeDeploymentShape,
  type DeploymentShape,
} from "../../../modules/contracts/config";
import {
  openPostgresDatabase,
  resolvePostgresPoolConfig,
  type OpenedPostgresDatabase,
} from "../../../modules/adapters/persistence/postgres";
import { importJsonStructuredData } from "../../../modules/adapters/persistence/migration";
import {
  createOrganizationContextStructuredDocumentStore,
  type StructuredDocumentStore,
} from "../../../modules/adapters/persistence/shared";
import { createStructuredOrganizationRepositories } from "../../../modules/adapters/persistence/organization";
import {
  AuthorizeOperationService,
  createOrganizationAuthorizationPolicy,
} from "../../../modules/application/services/security";
import { createJsonlSecurityAuditLogAdapter } from "../../../modules/adapters/security/audit/createJsonlSecurityAuditLogAdapter";

export const DEFAULT_SERVER_PORT = 3010;
export const DEFAULT_SERVER_STORAGE_ROOT_DIRECTORY_NAME = "server-artifacts";
export const DEFAULT_SERVER_LOCAL_STATE_DIRECTORY_NAME = ".local";
export const DEFAULT_SERVER_RUNTIME_ROOT_DIRECTORY_NAME = "server-runtime";

export interface ServerRuntimeConfig {
  port: number;
  storageRootDirectory: string;
  runtimeRootDirectory: string;
  security: Awaited<ReturnType<typeof composeServerSecurity>>["config"];
  deploymentShape?: DeploymentShape;
  persistenceAdapter: "json-compatibility" | "postgres";
}

export interface ResolvedServerRuntimePaths {
  port: number;
  storageRootDirectory: string;
  runtimeRootDirectory: string;
}

export interface CreateServerOptions {
  env?: NodeJS.ProcessEnv;
  logSink?: StructuredLogSink;
  now?: () => string;
  restartServer?: () => void | Promise<void>;
  postgresDatabase?: OpenedPostgresDatabase;
  /** Explicit non-production composition seam for controlled tests and qualification. */
  structuredDocuments?: StructuredDocumentStore;
  /** Explicit non-production runtime-data seam for controlled tests and qualification. */
  runtimeDatabases?: ServerSystemRuntimeDatabaseAdapter;
}

export interface CreatedServer {
  app: express.Express;
  config: ServerRuntimeConfig;
  loggingPort: LoggingPort;
  closePersistence(): Promise<void>;
}

interface PersistenceReadinessResponse {
  readonly status: "ready" | "not-ready";
  readonly checks: {
    readonly persistence: {
      readonly status: "ready" | "not-ready";
      readonly adapter: ServerRuntimeConfig["persistenceAdapter"];
      readonly schemaVersion?: number;
      readonly expectedSchemaVersion?: number;
      readonly queryLatencyMs?: number;
      readonly pool?: {
        total: number;
        idle: number;
        waiting: number;
        idleClientErrorCount: number;
        lastIdleClientErrorAt?: string;
      };
    };
    readonly artifactStorage: {
      readonly status: "ready" | "not-ready";
      readonly availableBytes?: string;
      readonly totalBytes?: string;
    };
  };
}

export type ServerListener = http.Server | https.Server;

interface ServerRootResolutionOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
}

function normalizePort(rawPort: string | undefined): number {
  const parsedPort = Number(rawPort);
  if (!Number.isInteger(parsedPort) || parsedPort < 1 || parsedPort > 65535) {
    return DEFAULT_SERVER_PORT;
  }

  return parsedPort;
}

function isServerAppRootDirectory(directory: string): boolean {
  const packageJsonPath = path.join(directory, "package.json");
  if (!existsSync(packageJsonPath)) {
    return false;
  }

  try {
    const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8")) as {
      name?: unknown;
    };
    return packageJson.name === "@ai-system-builder/server";
  } catch {
    return false;
  }
}

function findServerAppRootFromSeed(seedDirectory: string): string | undefined {
  let cursor = path.resolve(seedDirectory);
  while (true) {
    if (isServerAppRootDirectory(cursor)) {
      return cursor;
    }

    const workspaceServerDirectory = path.join(cursor, "apps", "server");
    if (isServerAppRootDirectory(workspaceServerDirectory)) {
      return workspaceServerDirectory;
    }

    const parent = path.dirname(cursor);
    if (parent === cursor) {
      return undefined;
    }
    cursor = parent;
  }
}

export function resolveServerAppRootDirectory(
  options: ServerRootResolutionOptions = {},
): string {
  const env = options.env ?? process.env;
  const seedDirectories = [options.cwd, env.INIT_CWD, process.cwd()].filter(
    (value): value is string =>
      typeof value === "string" && value.trim().length > 0,
  );

  for (const seedDirectory of seedDirectories) {
    const serverAppRoot = findServerAppRootFromSeed(seedDirectory);
    if (serverAppRoot) {
      return serverAppRoot;
    }
  }

  return path.resolve("apps", "server");
}

export function resolveDefaultServerStorageRootDirectory(
  options: ServerRootResolutionOptions = {},
): string {
  return path.join(
    resolveServerAppRootDirectory(options),
    DEFAULT_SERVER_STORAGE_ROOT_DIRECTORY_NAME,
  );
}

export function resolveDefaultServerRuntimeRootDirectory(
  options: ServerRootResolutionOptions = {},
): string {
  return path.join(
    resolveServerAppRootDirectory(options),
    DEFAULT_SERVER_LOCAL_STATE_DIRECTORY_NAME,
    DEFAULT_SERVER_RUNTIME_ROOT_DIRECTORY_NAME,
  );
}

export function resolveServerRuntimeRootDirectory(
  env: NodeJS.ProcessEnv = process.env,
  options: { cwd?: string } = {},
): string {
  const runtimeRootFromEnv = env.SERVER_RUNTIME_ROOT?.trim();
  return runtimeRootFromEnv && runtimeRootFromEnv.length > 0
    ? path.resolve(runtimeRootFromEnv)
    : resolveDefaultServerRuntimeRootDirectory({ cwd: options.cwd, env });
}

export function resolveServerRuntimePaths(
  env: NodeJS.ProcessEnv = process.env,
  options: { cwd?: string } = {},
): ResolvedServerRuntimePaths {
  const storageRootFromEnv = env.SERVER_STORAGE_ROOT?.trim();
  const rootResolutionOptions = { cwd: options.cwd, env };

  const storageRootDirectory =
    storageRootFromEnv && storageRootFromEnv.length > 0
      ? path.resolve(storageRootFromEnv)
      : resolveDefaultServerStorageRootDirectory(rootResolutionOptions);

  const runtimeRootDirectory = resolveServerRuntimeRootDirectory(env, options);
  return {
    port: normalizePort(env.PORT),
    storageRootDirectory,
    runtimeRootDirectory,
  };
}

export function resolveServerRuntimeConfig(
  env: NodeJS.ProcessEnv = process.env,
  options: { cwd?: string } = {},
): ResolvedServerRuntimePaths {
  return resolveServerRuntimePaths(env, options);
}

export async function createServer(
  options: CreateServerOptions = {},
): Promise<CreatedServer> {
  const env = options.env ?? process.env;
  const runtimePaths = resolveServerRuntimePaths(options.env);
  if (env.NODE_ENV === "production" && options.runtimeDatabases) {
    throw new Error(
      "The explicit runtime database seam is unavailable in production server startup.",
    );
  }
  const security = await composeServerSecurity(
    env,
    runtimePaths.storageRootDirectory,
  );
  const deploymentShapeValue = env.DEPLOYMENT_SHAPE?.trim();
  if (!deploymentShapeValue && env.NODE_ENV === "production") {
    throw new Error(
      "DEPLOYMENT_SHAPE is required for production server startup.",
    );
  }
  const deploymentShape = deploymentShapeValue
    ? normalizeDeploymentShape(deploymentShapeValue)
    : undefined;
  if (deploymentShape === "local") {
    throw new Error(
      "The server host cannot use the local deployment shape; use the desktop host for local SQLite.",
    );
  }
  if (env.NODE_ENV === "production" && security.config.mode !== "oidc-bearer") {
    throw new Error(
      "Production managed-server startup requires AI_SYSTEM_BUILDER_SECURITY_MODE=oidc-bearer.",
    );
  }
  const postgresDatabase = deploymentShape
    ? (options.postgresDatabase ??
      (await openPostgresDatabase({
        config: resolvePostgresPoolConfig(env),
        now: options.now,
      })))
    : undefined;
  let startupSucceeded = false;
  let closeRuntimeDatabasesOnFailure: (() => Promise<void>) | undefined;
  try {
    if (postgresDatabase) {
      await importJsonStructuredData({
        sourceRootDirectory: runtimePaths.storageRootDirectory,
        rollbackRootDirectory: path.join(
          runtimePaths.runtimeRootDirectory,
          "persistence",
          "json-rollback",
        ),
        documents: postgresDatabase.documents,
        now: options.now,
      });
    }
    const config: ServerRuntimeConfig = {
      ...runtimePaths,
      security: security.config,
      ...(deploymentShape ? { deploymentShape } : {}),
      persistenceAdapter: postgresDatabase ? "postgres" : "json-compatibility",
    };
    const persistenceDocuments =
      postgresDatabase?.documents ?? options.structuredDocuments;
    const organizationDocuments = postgresDatabase
      ? createOrganizationContextStructuredDocumentStore(
          postgresDatabase.documents,
          security.organizationContextScope,
        )
      : options.structuredDocuments;
    const organizationAuthorizer =
      postgresDatabase && security.config.mode === "oidc-bearer"
        ? new AuthorizeOperationService(
            createOrganizationAuthorizationPolicy({
              ...createStructuredOrganizationRepositories(
                postgresDatabase.documents,
              ),
              tenantPlacement: security.config.tenantPlacement,
            }),
            {
              audit: createJsonlSecurityAuditLogAdapter(
                path.join(
                  config.runtimeRootDirectory,
                  "security",
                  "authorization-audit.jsonl",
                ),
              ),
              createEventId: () => `evt-${randomUUID()}`,
              now: options.now,
            },
          )
        : undefined;
    const serverHost = composeServerHost({
      env: options.env,
      logging: {
        verbosity: options.env?.LOG_VERBOSITY,
        level: "info",
      },
      logSink: options.logSink,
      now: options.now,
      restartServer: options.restartServer,
      organizationContextProvider: postgresDatabase
        ? security.organizationContextScope
        : undefined,
      organizationAuthorizer,
      runtimeDatabases: options.runtimeDatabases,
      ...(persistenceDocuments
        ? {
            persistence: {
              documents: persistenceDocuments,
              organizationDocuments,
            },
          }
        : {}),
      artifactRepo: {
        huggingFaceAccessToken:
          options.env?.HF_TOKEN ?? options.env?.HUGGING_FACE_TOKEN,
        huggingFaceTokenConfigFilePath: path.join(
          config.storageRootDirectory,
          "config",
          "hugging-face-token.json",
        ),
        providerCredentialRootDirectory: path.join(
          config.storageRootDirectory,
          "config",
          "provider-credentials",
        ),
        huggingFaceCredentialMigrationOrganizationId:
          options.env?.HF_TOKEN_ORGANIZATION_ID ??
          (security.config.tenantPlacement.mode === "dedicated"
            ? security.config.tenantPlacement.organizationId
            : undefined),
      },
    });
    closeRuntimeDatabasesOnFailure = () => serverHost.closeRuntimeDatabases();

    const app = express();
    app.enable("case sensitive routing");
    applySecurityHeaders(app);
    registerOperationalHealthRoutes(
      app,
      config.persistenceAdapter,
      config.storageRootDirectory,
      postgresDatabase,
    );
    app.use(security.middleware);
    if (organizationAuthorizer) {
      app.use(
        createExpressOrganizationAuthorizationMiddleware({
          authorizer: organizationAuthorizer,
        }),
      );
    }
    app.use(express.json({ limit: "5mb" }));
    app.use(createExpressJsonBodyErrorMiddleware());
    registerSecurityRoutes(app, {
      getStatus: async (authContext) => ({
        ...(await security.services.getStatusService.execute({
          config: {
            mode: security.config.mode,
            httpsRequired: security.config.httpsRequired,
            authRequired: security.config.authRequired,
            allowLocalhostWithoutAuth:
              security.config.allowLocalhostWithoutAuth,
          },
          httpsEnabled: security.config.httpsEnabled,
          pairingEnabled: security.config.pairingEnabled,
          now: new Date(),
          currentAuthContext: authContext,
          devSecurityToggleEnabled: security.config.devSecurityToggleEnabled,
          devSecurityEnforcementMode:
            security.devSecurityEnforcement.isEnabled()
              ? security.devSecurityEnforcement.getMode()
              : undefined,
          requiresRestartToChangeTransportSecurity: true,
        })),
        tls: security.config.tlsStatus,
      }),
      completePairing: (body) =>
        security.services.completePairing.execute(body),
      revokeToken: (body) =>
        security.credentials.revokeDevice({
          deviceId: body.deviceId,
          revokedAt: new Date(),
        }),
      getDevMode: security.devSecurityEnforcement.isEnabled()
        ? () => security.devSecurityEnforcement.getMode()
        : undefined,
      setDevMode: security.devSecurityEnforcement.isEnabled()
        ? (mode) => security.devSecurityEnforcement.setMode(mode)
        : undefined,
      getLocalCaPem:
        security.config.tlsStatus?.mode === "auto-local-ca"
          ? security.config.tlsMaterial?.getLocalCaPublicCertificatePem
          : undefined,
    });

    serverHost.registerApi({
      app,
      storageRootDirectory: config.storageRootDirectory,
      runtimeRootDirectory: config.runtimeRootDirectory,
    });
    await serverHost.waitForAssetFoundation();

    let persistenceClosed = false;
    startupSucceeded = true;
    return {
      app,
      config,
      loggingPort: serverHost.loggingPort,
      async closePersistence() {
        if (persistenceClosed) return;
        persistenceClosed = true;
        await serverHost.closeRuntimeDatabases();
        await postgresDatabase?.close();
      },
    };
  } finally {
    if (!startupSucceeded) {
      await closeRuntimeDatabasesOnFailure?.();
      await postgresDatabase?.close();
    }
  }
}

function registerOperationalHealthRoutes(
  app: express.Express,
  adapter: ServerRuntimeConfig["persistenceAdapter"],
  storageRootDirectory: string,
  postgresDatabase: OpenedPostgresDatabase | undefined,
): void {
  app.get("/health/live", (_request, response) => {
    response.status(200).json({ status: "live" });
  });
  app.get("/health/ready", async (_request, response) => {
    const [persistenceResult, artifactStorageResult] = await Promise.allSettled(
      [
        postgresDatabase?.checkHealth() ?? Promise.resolve(undefined),
        checkArtifactStorageReadiness(storageRootDirectory),
      ],
    );
    const persistenceHealth =
      persistenceResult.status === "fulfilled"
        ? persistenceResult.value
        : undefined;
    const persistenceReady =
      persistenceResult.status === "fulfilled" &&
      (persistenceHealth?.healthy ?? true);
    const artifactStorage =
      artifactStorageResult.status === "fulfilled"
        ? artifactStorageResult.value
        : undefined;
    const artifactStorageReady = artifactStorageResult.status === "fulfilled";
    const ready = persistenceReady && artifactStorageReady;
    const payload: PersistenceReadinessResponse = {
      status: ready ? "ready" : "not-ready",
      checks: {
        persistence: {
          status: persistenceReady ? "ready" : "not-ready",
          adapter,
          ...(persistenceHealth
            ? {
                schemaVersion: persistenceHealth.schemaVersion,
                expectedSchemaVersion: persistenceHealth.expectedSchemaVersion,
                queryLatencyMs: persistenceHealth.queryLatencyMs,
                pool: persistenceHealth.pool,
              }
            : {}),
        },
        artifactStorage: {
          status: artifactStorageReady ? "ready" : "not-ready",
          ...(artifactStorage ?? {}),
        },
      },
    };
    response.status(ready ? 200 : 503).json(payload);
  });
}

async function checkArtifactStorageReadiness(
  storageRootDirectory: string,
): Promise<{ availableBytes: string; totalBytes: string }> {
  await access(storageRootDirectory, fsConstants.R_OK | fsConstants.W_OK);
  const capacity = await statfs(storageRootDirectory, { bigint: true });
  return {
    availableBytes: (capacity.bavail * capacity.bsize).toString(),
    totalBytes: (capacity.blocks * capacity.bsize).toString(),
  };
}

export function createServerListener(
  createdServer: CreatedServer,
): ServerListener {
  if (createdServer.config.security.httpsEnabled) {
    return https.createServer(
      createHttpsServerOptions(createdServer.config.security.tlsMaterial),
      createdServer.app,
    );
  }

  return http.createServer(createdServer.app);
}
