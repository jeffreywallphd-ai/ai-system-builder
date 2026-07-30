import type {
  SystemDeploymentRevocationPort,
  SystemRuntimeDatabaseLifecyclePort,
  SystemDeploymentRuntimePort,
} from "../../../application/ports/system-deployment";
import type {
  SystemDeployment,
  SystemDeploymentCapabilityPolicy,
} from "../../../contracts/system-deployment";
import type {
  SystemBuildArtifactPort,
  SystemBuildRepositoryPort,
} from "../../../application/ports/system-build";
import type { SystemBuilderRepositoryPort } from "../../../application/ports/system-builder";
import type { AssetImplementationDeploymentProfile } from "../../../contracts/asset-implementation";
import {
  SystemDeploymentCompatibilityService,
  SystemDeploymentPolicyService,
  SystemPublishedConversationRuntimeAuthorityService,
  type SystemDeploymentReleaseBindingResolution,
} from "../../../application/services/system-deployment";
import {
  ActivateSystemDeploymentUseCase,
  CancelSystemDeploymentRunUseCase,
  DeactivateSystemDeploymentUseCase,
  InstallSystemDeploymentUseCase,
  ListSystemDeploymentAuditUseCase,
  ListSystemDeploymentRunsUseCase,
  ListSystemDeploymentsUseCase,
  ReadSystemDeploymentUseCase,
  ReconcileSystemDeploymentHealthUseCase,
  RevokeSystemDeploymentUseCase,
  RollbackSystemDeploymentUseCase,
  StartSystemDeploymentRunUseCase,
  UninstallSystemDeploymentUseCase,
  InvokeSystemPublishedLifecycleUseCase,
  ReadSystemPublishedLifecycleUseCase,
  SystemRuntimeInstanceLifecycleService,
} from "../../../application/use-cases/system-deployment";
import {
  createStructuredSystemDeploymentRepository,
  createStructuredSystemRuntimeInstanceRepository,
} from "../../../adapters/persistence/system-deployment";
import {
  createSystemRuntimeRepositorySessionFactory,
  type SystemRuntimeStructuredDataSessionProvider,
} from "../../../adapters/persistence/system-runtime";
import type { StructuredDocumentStore } from "../../../adapters/persistence/shared";
import type { SystemRuntimeInstanceId } from "../../../contracts/system-deployment";

export interface ComposeSystemDeploymentOptions {
  readonly documents: StructuredDocumentStore;
  readonly builds: SystemBuildRepositoryPort;
  readonly artifacts: SystemBuildArtifactPort;
  readonly runtime: SystemDeploymentRuntimePort;
  readonly runtimeDatabases: SystemRuntimeDatabaseLifecyclePort &
    SystemRuntimeStructuredDataSessionProvider;
  readonly revocations?: SystemDeploymentRevocationPort;
  readonly platformPolicy: SystemDeploymentCapabilityPolicy;
  readonly generateAuditId: () => string;
  readonly generateRuntimeInstanceId: () => SystemRuntimeInstanceId;
  readonly publishedLifecycle?: {
    readonly systems: SystemBuilderRepositoryPort;
    readonly hostTargetId: string;
    readonly deploymentProfile: AssetImplementationDeploymentProfile;
    readonly hostApiVersion: string;
    readonly runtimeAbiVersion?: string;
    readonly hostCapabilities: readonly string[];
    readonly sandboxQualified: boolean;
    readonly generateDeploymentId: () => string;
    readonly generateRunId: () => string;
    readonly resolveReleaseBindings?: (
      deployment: SystemDeployment,
    ) => Promise<SystemDeploymentReleaseBindingResolution>;
  };
  readonly now?: () => string;
}

export function createDefaultSystemDeploymentPolicy(): SystemDeploymentCapabilityPolicy {
  return {
    allowedCapabilities: [],
    allowedSecretReferences: [],
    egress: { mode: "deny-all", allowedOrigins: [] },
    quotas: {
      maximumRunSeconds: 300,
      maximumMemoryMiB: 512,
      maximumOutputBytes: 1024 * 1024,
      maximumConcurrentRuns: 4,
    },
  };
}

export function composeSystemDeployment(
  options: ComposeSystemDeploymentOptions,
) {
  const repository = createStructuredSystemDeploymentRepository(
    options.documents,
  );
  const runtimeInstanceRepository =
    createStructuredSystemRuntimeInstanceRepository(options.documents);
  const runtimeInstances = new SystemRuntimeInstanceLifecycleService({
    repository: runtimeInstanceRepository,
    databases: options.runtimeDatabases,
    now: options.now,
  });
  const runtimeRepositorySessions = createSystemRuntimeRepositorySessionFactory(
    options.runtimeDatabases,
  );
  const policy = new SystemDeploymentPolicyService();
  const compatibility = new SystemDeploymentCompatibilityService(
    options.runtime,
  );
  const revocations: SystemDeploymentRevocationPort = options.revocations ?? {
    async listRevokedImplementationReleaseIds() {
      return [];
    },
  };
  const dependencies = {
    repository,
    builds: options.builds,
    artifacts: options.artifacts,
    runtime: options.runtime,
    runtimeInstances,
    runtimeInstanceRepository,
    revocations,
    compatibility,
    policy,
    platformPolicy: options.platformPolicy,
    generateAuditId: options.generateAuditId,
    generateRuntimeInstanceId: options.generateRuntimeInstanceId,
    now: options.now,
  };
  const useCases = {
    install: new InstallSystemDeploymentUseCase(dependencies),
    activate: new ActivateSystemDeploymentUseCase(dependencies),
    deactivate: new DeactivateSystemDeploymentUseCase(dependencies),
    health: new ReconcileSystemDeploymentHealthUseCase(dependencies),
    rollback: new RollbackSystemDeploymentUseCase(dependencies),
    revoke: new RevokeSystemDeploymentUseCase(dependencies),
    uninstall: new UninstallSystemDeploymentUseCase(dependencies),
    read: new ReadSystemDeploymentUseCase(repository),
    list: new ListSystemDeploymentsUseCase(repository),
    startRun: new StartSystemDeploymentRunUseCase(dependencies),
    cancelRun: new CancelSystemDeploymentRunUseCase(dependencies),
    listRuns: new ListSystemDeploymentRunsUseCase(repository),
    listAudit: new ListSystemDeploymentAuditUseCase(repository),
  };
  const publishedLifecycle = options.publishedLifecycle
    ? (() => {
        const lifecycleDependencies = {
          repository,
          runtimeInstances: runtimeInstanceRepository,
          builds: options.builds,
          systems: options.publishedLifecycle.systems,
          host: {
            hostTargetId: options.publishedLifecycle.hostTargetId,
            deploymentProfile: options.publishedLifecycle.deploymentProfile,
            hostApiVersion: options.publishedLifecycle.hostApiVersion,
            ...(options.publishedLifecycle.runtimeAbiVersion
              ? {
                  runtimeAbiVersion:
                    options.publishedLifecycle.runtimeAbiVersion,
                }
              : {}),
            hostCapabilities: options.publishedLifecycle.hostCapabilities,
            sandboxQualified: options.publishedLifecycle.sandboxQualified,
            installationPolicy: options.platformPolicy,
          },
          install: useCases.install,
          activate: useCases.activate,
          deactivate: useCases.deactivate,
          uninstall: useCases.uninstall,
          start: useCases.startRun,
          stop: useCases.cancelRun,
          ...(options.publishedLifecycle.resolveReleaseBindings
            ? {
                resolveReleaseBindings:
                  options.publishedLifecycle.resolveReleaseBindings,
              }
            : {}),
          generateDeploymentId: options.publishedLifecycle.generateDeploymentId,
          generateRunId: options.publishedLifecycle.generateRunId,
        };
        return {
          read: new ReadSystemPublishedLifecycleUseCase(lifecycleDependencies),
          invoke: new InvokeSystemPublishedLifecycleUseCase(
            lifecycleDependencies,
          ),
        };
      })()
    : undefined;
  const publishedConversationAuthority = options.publishedLifecycle
    ?.resolveReleaseBindings
    ? new SystemPublishedConversationRuntimeAuthorityService({
        deployments: repository,
        runtimeInstances: runtimeInstanceRepository,
        builds: options.builds,
        systems: options.publishedLifecycle.systems,
        hostTargetId: options.publishedLifecycle.hostTargetId,
        resolveReleaseBindings:
          options.publishedLifecycle.resolveReleaseBindings,
      })
    : undefined;
  return {
    repository,
    runtimeInstanceRepository,
    runtimeInstances,
    runtimeRepositorySessions,
    runtime: options.runtime,
    policy,
    compatibility,
    useCases,
    publishedLifecycle,
    publishedConversationAuthority,
  };
}

export type SystemDeploymentCompositionRoot = ReturnType<
  typeof composeSystemDeployment
>;
