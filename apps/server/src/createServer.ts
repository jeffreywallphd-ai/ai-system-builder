import { constants as fsConstants, existsSync, readFileSync } from "node:fs";
import { access, statfs } from "node:fs/promises";
import { createHmac, randomBytes, randomUUID } from "node:crypto";
import http from "node:http";
import https from "node:https";
import path from "node:path";
import { types } from "node:util";

import express from "express";

import {
  composeServerHost,
  type ServerSystemRuntimeDatabaseAdapter,
  type ServerPythonRuntimeEnvironmentPreparer,
} from "../../../modules/hosts/server";
import {
  applySecurityHeaders,
  createExpressJsonBodyErrorMiddleware,
  createExpressOrganizationAuthorizationMiddleware,
  createHttpsServerOptions,
  registerSecurityRoutes,
} from "../../../modules/adapters/transport/api-express/security";
import { composeServerSecurity } from "../../../modules/hosts/server/security/composeServerSecurity";
import { createManagedSavedStateAuthorizationAudit } from "../../../modules/hosts/server/security/createManagedSavedStateAuthorizationAudit";
import { registerManagedSavedStateRoutes } from "../../../modules/adapters/transport/api-express/headless/registerManagedSavedStateRoutes";
import { registerManagedHeadlessAgentRoutes } from "../../../modules/adapters/transport/api-express/headless/registerManagedHeadlessAgentRoutes";
import { MANAGED_HEADLESS_AGENT_PATHS } from "../../../modules/adapters/transport/api-express/security/apiRouteSecurityPolicy";
import { createSecurityApiFailure } from "../../../modules/adapters/transport/api-express/security/createSecurityApiFailure";
import { getExpressAuthContext } from "../../../modules/adapters/transport/api-express/security/expressAuthContext";
import { registerManagedBrowserConsentRoute } from "../../../modules/adapters/transport/api-express/headless/registerManagedBrowserConsentRoute";
import { resolveManagedHeadlessClientPolicy, type ManagedPlanReviewRegistration } from "../../../modules/hosts/server/security/resolveManagedHeadlessClientPolicy";
import type { ManagedHeadlessAuthoringRegistration } from "../../../modules/hosts/server/composition/composeManagedHeadlessAuthoring";
import { resolveServerOidcBearerConfig } from "../../../modules/hosts/server/security/resolveServerOidcBearerConfig";
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

type ArtifactRepoComposition = NonNullable<NonNullable<Parameters<typeof composeServerHost>[0]>["artifactRepo"]>;
export interface ControlledHuggingFaceArtifactTransport {
  readonly fetchImplementation: NonNullable<ArtifactRepoComposition["huggingFaceFetchImplementation"]>;
  readonly hubClient: Required<NonNullable<ArtifactRepoComposition["huggingFaceHubClient"]>>;
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
  /** Explicit nonproduction composition seam; never configurable by an API or environment flag. */
  pythonRuntimeEnvironmentPreparer?: ServerPythonRuntimeEnvironmentPreparer;
  /** Trusted nonproduction transport only; never supplied by API or environment data. */
  controlledHuggingFaceArtifactTransport?: ControlledHuggingFaceArtifactTransport;
}

function resolveControlledArtifactTransport(
  value: unknown,
  env: NodeJS.ProcessEnv,
): ControlledHuggingFaceArtifactTransport | undefined {
  if (value === undefined) return undefined;
  if (env.NODE_ENV === "production" || process.env.NODE_ENV === "production") {
    throw new Error("The controlled artifact provider transport is unavailable in production.");
  }
  const invalid = () => new TypeError("Controlled artifact provider transport requires complete data-only dependencies.");
  function fields(input: unknown, names: readonly string[]) {
    if (!input || typeof input !== "object" || types.isProxy(input) || Array.isArray(input)) throw invalid();
    const prototype = Object.getPrototypeOf(input);
    if (prototype !== Object.prototype && prototype !== null) throw invalid();
    const descriptors = Object.getOwnPropertyDescriptors(input);
    const keys = Reflect.ownKeys(descriptors);
    if (keys.length !== names.length || keys.some(key => typeof key !== "string" || !names.includes(key))) throw invalid();
    if (names.some(name => !descriptors[name] || !("value" in descriptors[name]))) throw invalid();
    return descriptors;
  }
  const bundle = fields(value, ["fetchImplementation", "hubClient"]);
  const methods = ["fileExists", "uploadFile", "downloadFile", "commit", "listFiles"] as const;
  const hub = fields(bundle.hubClient.value, methods);
  for (const callback of [bundle.fetchImplementation.value, ...methods.map(name => hub[name].value)]) {
    if (typeof callback !== "function" || types.isProxy(callback)) throw invalid();
  }
  // Capture validated values once. Later caller mutation cannot introduce a fallback.
  return Object.freeze({
    fetchImplementation: bundle.fetchImplementation.value,
    hubClient: Object.freeze(Object.fromEntries(methods.map(name => [name, hub[name].value]))),
  }) as ControlledHuggingFaceArtifactTransport;
}

export interface CreatedServer {
  app: express.Express;
  config: ServerRuntimeConfig;
  loggingPort: LoggingPort;
  closePersistence(): Promise<void>;
  shutdownBackgroundTasks(): Promise<void>;
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
  const controlledArtifactTransport = resolveControlledArtifactTransport(options.controlledHuggingFaceArtifactTransport, env);
  const pythonRuntimeEnvironmentPreparer = options.pythonRuntimeEnvironmentPreparer;
  if (pythonRuntimeEnvironmentPreparer !== undefined) {
    if (env.NODE_ENV === "production" || process.env.NODE_ENV === "production") {
      throw new Error("The controlled runtime preparation seam is unavailable in production.");
    }
    if (typeof pythonRuntimeEnvironmentPreparer !== "function") {
      throw new TypeError("Controlled runtime preparation must be a function.");
    }
  }
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
  const clientPolicy = resolveManagedHeadlessClientPolicy({env, oidcIssuer: security.config.mode === "oidc-bearer"
    ? resolveServerOidcBearerConfig(env).issuer : undefined});
  if (clientPolicy && (!deploymentShape || env.AI_SYSTEM_BUILDER_MANAGED_SAVED_STATE !== "1"))
    throw new Error("Managed headless agents require a managed PostgreSQL deployment with saved-state enabled.");
  if (clientPolicy?.planReviewAvailable && !security.config.httpsRequired)
    throw new Error("Managed plan review requires HTTPS.");
  const browserOrigin = env.AI_SYSTEM_BUILDER_MANAGED_HEADLESS_BROWSER_ORIGIN;
  if (browserOrigin !== undefined && (!clientPolicy || !security.config.httpsRequired || !isExactHttpsOrigin(browserOrigin)))
    throw new Error("Managed browser consent requires verified client registrations and an exact HTTPS browser origin.");
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
    const organizationPolicy =
      postgresDatabase && security.config.mode === "oidc-bearer"
        ? createOrganizationAuthorizationPolicy({
            ...createStructuredOrganizationRepositories(postgresDatabase.documents),
            tenantPlacement: security.config.tenantPlacement,
          }) : undefined;
    const audit = createJsonlSecurityAuditLogAdapter(path.join(config.runtimeRootDirectory, "security", "authorization-audit.jsonl"));
    const auditOptions = { createEventId: () => `evt-${randomUUID()}`, now: options.now };
    const organizationAuthorizer = organizationPolicy ? new AuthorizeOperationService(organizationPolicy, { ...auditOptions, audit }) : undefined;
    const passiveSavedStateAuthorizer = organizationPolicy ? new AuthorizeOperationService(organizationPolicy, {
      ...auditOptions, audit: createManagedSavedStateAuthorizationAudit(audit),
    }) : undefined;
    const passiveBrowserObserveAuthorizer = browserOrigin && organizationPolicy ? new AuthorizeOperationService(organizationPolicy, {
      ...auditOptions, audit: createManagedSavedStateAuthorizationAudit(audit, undefined, "headless.window.observe"),
    }) : undefined;
    const listActiveSystems = postgresDatabase?.listActiveSystemSummaries;
    if (clientPolicy && (!listActiveSystems || !postgresDatabase?.documents.runInOwnedTransaction ||
        postgresDatabase.documents.organizationId !== undefined))
      throw new Error("Managed headless agents require the PostgreSQL transaction and saved-state providers.");
    const serverHost = composeServerHost({
      env: options.env,
      logging: {
        verbosity: options.env?.LOG_VERBOSITY,
        level: "info",
      },
      logSink: options.logSink,
      now: options.now,
      restartServer: options.restartServer,
      organizationContextProvider: postgresDatabase || options.structuredDocuments?.organizationId
        ? security.organizationContextScope
        : undefined,
      organizationAuthorizer,
      managedSavedState: env.AI_SYSTEM_BUILDER_MANAGED_SAVED_STATE === "1" && passiveSavedStateAuthorizer && listActiveSystems
        ? { listActiveSystems, authorize: passiveSavedStateAuthorizer } : undefined,
      managedHeadlessAgent: clientPolicy ? {placement: security.config.tenantPlacement, planReviewClientId: clientPolicy.planReviewRegisteredClientId,
        ...(clientPolicy.modelSourceReadAvailable ? {modelSourceRead: true as const} : {}),
        browserObservationAuthorizer: passiveBrowserObserveAuthorizer} : undefined,
      runtimeDatabases: options.runtimeDatabases,
      pythonRuntimeEnvironmentPreparer,
      ...(persistenceDocuments
        ? {
            persistence: {
              documents: persistenceDocuments,
              organizationDocuments,
            },
          }
        : {}),
      artifactRepo: {
        ...(controlledArtifactTransport ? {
          huggingFaceFetchImplementation: controlledArtifactTransport.fetchImplementation,
          huggingFaceHubClient: controlledArtifactTransport.hubClient,
        } : {}),
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
    if (clientPolicy?.planReviewAvailable) {
      app.use((request, response, next) => {
        if (!clientPolicy.isPlanReviewCredential(getExpressAuthContext(request))) return next();
        if (request.method === "POST" && (request.originalUrl === MANAGED_HEADLESS_AGENT_PATHS.read ||
            request.originalUrl === MANAGED_HEADLESS_AGENT_PATHS["plan-review"] ||
            request.originalUrl === MANAGED_HEADLESS_AGENT_PATHS["plan-step"] ||
            request.originalUrl === MANAGED_HEADLESS_AGENT_PATHS["local-file-preview"] ||
            request.originalUrl === MANAGED_HEADLESS_AGENT_PATHS["provider-file-preview"])) return next();
        return response.status(403).json(createSecurityApiFailure({status:403, code:"security.forbidden",
          message:"This credential is limited to managed plan review."}));
      });
    }
    if (organizationAuthorizer) {
      app.use(
        createExpressOrganizationAuthorizationMiddleware({
          authorizer: organizationAuthorizer,
          passiveSavedStateAuthorizer,
          passiveBrowserObserveAuthorizer,
        }),
      );
    }
    const retireManagedSavedState = registerManagedSavedStateRoutes(app, () => serverHost.getManagedSavedState());
    const browserPresentationKey = browserOrigin ? randomBytes(32) : undefined;
    const browserDeliveryEnabled = !!browserOrigin && env.AI_SYSTEM_BUILDER_MANAGED_HEADLESS_BROWSER_PRESENTATION === "1";
    const retireManagedHeadlessAgent = registerManagedHeadlessAgentRoutes<ManagedHeadlessAuthoringRegistration | ManagedPlanReviewRegistration>(app, () => {
      const handlers = serverHost.getManagedHeadlessAgent();
      const consent = serverHost.getManagedBrowserConsent();
      const planReview = handlers?.planReview;
      const runPlanStep = planReview?.runStep;
      const previewSelectedFile = planReview?.previewSelectedFile;
      const previewSelectedProviderFile = planReview?.previewSelectedProviderFile;
      const denied = {ok: false, code: "headless.forbidden"} as const;
      return clientPolicy && handlers ? {
        hostIncarnationId: handlers.hostIncarnationId,
        allowWorkflowReads: handlers.workflowReads === true,
        allowModelSourceRead: clientPolicy.modelSourceReadAvailable,
        read: handlers.read,
        author: async (input, agent, current) => agent.purpose === "agent" ? handlers.author(input, agent, current) : denied,
        identify: (input, kind) => identifyManagedHeadlessRouteCaller(clientPolicy, input, kind, planReview !== undefined),
        isCurrent: (admitted) => admitted.isCurrent(),
        ...(planReview ? { allowLocalFileSave: planReview.allowLocalFileSave, allowProviderFileSave: planReview.allowProviderFileSave,
          allowLocalDatasetPreparation: planReview.allowLocalDatasetPreparation,
          allowDatasetResultSave: planReview.allowDatasetResultSave,
          allowContextPackGeneration: planReview.allowContextPackGeneration,
          allowContextRagGeneration: planReview.allowContextRagGeneration,
          allowContextResultSave: planReview.allowContextResultSave,
          allowContextQuery: planReview.allowContextQuery,
          allowModelDownload: planReview.allowModelDownload,
          allowModelReferenceSave: planReview.allowModelReferenceSave,
          ...(planReview.cancelModelDownload ? {modelTaskControl: async (input, agent, current) =>
            agent.purpose === "plan-review" ? planReview.cancelModelDownload!(input, agent, current) : denied} : {}),
          planReview: async (input, agent, current) =>
            agent.purpose === "plan-review" ? planReview(input, agent, current) : denied } : {}),
        ...(runPlanStep ? { planStep: async (input, agent, current) =>
          agent.purpose === "plan-review" ? runPlanStep(input, agent, current) : { result: denied } } : {}),
        ...(previewSelectedFile ? { localFilePreview: async (input, agent, current) =>
          agent.purpose === "plan-review" ? previewSelectedFile(input, agent, current) : { result: denied } } : {}),
        ...(previewSelectedProviderFile ? { providerFilePreview: async (input, agent, current) =>
          agent.purpose === "plan-review" ? previewSelectedProviderFile(input, agent, current) : { result: denied } } : {}),
        ...(consent && browserPresentationKey ? {window: {
          deliveryEnabled: browserDeliveryEnabled,
          execute: async (input, agent, session, current) => agent.purpose === "agent"
            ? consent.execute(input, browserPresentationAgent(agent, session, browserPresentationKey), current) : denied,
          canPublish: (input, result, agent, session) => agent.purpose === "agent" &&
            consent.canPublish(input, result, browserPresentationAgent(agent, session, browserPresentationKey)),
        }} : {}),
      } : undefined;
    });
    const retireManagedBrowserConsent = registerManagedBrowserConsentRoute(app, browserOrigin, () => {
      const consent = serverHost.getManagedBrowserConsent();
      return clientPolicy && consent ? {
        ...consent,
        deliveryEnabled: browserDeliveryEnabled,
        identify(input) {
          const admitted = clientPolicy.identify({...input, purpose: "browser"});
          return admitted?.purpose === "browser" ? admitted : undefined;
        },
        isCurrent: admitted => admitted.isCurrent(),
      } : undefined;
    });
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
      shutdownBackgroundTasks: () => {
        retireManagedSavedState();
        retireManagedHeadlessAgent();
        retireManagedBrowserConsent();
        return serverHost.shutdownBackgroundTasks();
      },
      async closePersistence() {
        if (persistenceClosed) return;
        retireManagedSavedState();
        retireManagedHeadlessAgent();
        retireManagedBrowserConsent();
        await serverHost.closeRuntimeDatabases();
        await postgresDatabase?.close();
        persistenceClosed = true;
      },
    };
  } finally {
    if (!startupSucceeded) {
      await closeRuntimeDatabasesOnFailure?.();
      await postgresDatabase?.close();
    }
  }
}

function browserPresentationAgent<T extends {readonly registeredClientId: string}>(agent: T, session: string, key: Buffer) {
  // The process owns authorization. The session header distinguishes logical
  // MCP clients and is never itself returned to the interactive document.
  const hash = createHmac("sha256", key).update(JSON.stringify([agent.registeredClientId, session])).digest("hex");
  const agentSessionId = `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-8${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
  return {...agent, agentSessionId};
}

function isExactHttpsOrigin(value: string) {
  if (value.length > 256) return false;
  try {
    const origin = new URL(value);
    return origin.protocol === "https:" && origin.origin === value;
  } catch { return false; }
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

/** Keep route-to-registration admission in the production server, before dispatch.
 * A plan's approval grants no ordinary agent registration and vice versa. */
export function identifyManagedHeadlessRouteCaller(
  policy: Pick<NonNullable<ReturnType<typeof resolveManagedHeadlessClientPolicy>>, "identify">,
  input: Omit<Parameters<NonNullable<ReturnType<typeof resolveManagedHeadlessClientPolicy>>["identify"]>[0], "purpose">,
  kind: keyof typeof MANAGED_HEADLESS_AGENT_PATHS,
  planReviewAvailable: boolean,
) {
  const planOnly = kind === "plan-review" || kind === "plan-step" || kind === "model-task-control" ||
    kind === "local-file-preview" || kind === "provider-file-preview";
  if (!planOnly) {
    const agent = policy.identify({...input, purpose: "agent"});
    if (agent?.purpose === "agent") return agent;
  }
  if (planReviewAvailable && (kind === "read" || planOnly)) {
    const planner = policy.identify({...input, purpose: "plan-review"});
    if (planner?.purpose === "plan-review") return planner;
  }
  return undefined;
}
