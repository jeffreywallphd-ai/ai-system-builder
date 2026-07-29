import type {
  SystemRunWorkflowHandlerPort,
  SystemRunWorkflowRequestContext,
} from "../../ports/system-run-workflow";
import type { SystemBuildRepositoryPort } from "../../ports/system-build";
import type {
  ActivateSystemDeploymentUseCase,
  CancelSystemDeploymentRunUseCase,
  InstallSystemDeploymentUseCase,
  ListSystemDeploymentAuditUseCase,
  ListSystemDeploymentRunsUseCase,
  ListSystemDeploymentsUseCase,
  ReadSystemDeploymentUseCase,
  ReconcileSystemDeploymentHealthUseCase,
  RevokeSystemDeploymentUseCase,
  RollbackSystemDeploymentUseCase,
  StartSystemDeploymentRunUseCase,
} from "../../use-cases/system-deployment";
import type { AssetImplementationDeploymentProfile } from "../../../contracts/asset-implementation";
import type {
  SystemDeployment,
  SystemDeploymentAuditEntry,
  SystemDeploymentCapabilityPolicy,
  SystemDeploymentRun,
} from "../../../contracts/system-deployment";
import {
  SYSTEM_RUN_WORKFLOW_SCHEMA_VERSION,
  systemRunWorkflowFailure,
  systemRunWorkflowSuccess,
  type InvokeSystemRunWorkflowCommand,
  type ListSystemRunWorkflowProfilesQuery,
  type PrepareSystemRunWorkflowQuery,
  type SystemRunWorkflowAction,
  type SystemRunWorkflowProfileSummary,
  type SystemRunWorkflowResult,
  type SystemRunWorkflowSnapshot,
} from "../../../contracts/system-run-workflow";
import {
  checkExpectedSnapshot,
  mapCapabilityFailure,
  profileSummary,
  readExactRelease,
  releaseSource,
  requiredString,
  splitLines,
  withBlocks,
} from "./system-run-workflow-handler-helpers";

export const SYSTEM_DEPLOYMENT_WORKFLOW_PROFILE_ID =
  "builtin.workflow.deployment@1.0.0";

interface SystemDeploymentWorkflowUseCases {
  readonly install: Pick<InstallSystemDeploymentUseCase, "execute">;
  readonly activate: Pick<ActivateSystemDeploymentUseCase, "execute">;
  readonly health: Pick<ReconcileSystemDeploymentHealthUseCase, "execute">;
  readonly rollback: Pick<RollbackSystemDeploymentUseCase, "execute">;
  readonly revoke: Pick<RevokeSystemDeploymentUseCase, "execute">;
  readonly read: Pick<ReadSystemDeploymentUseCase, "execute">;
  readonly list: Pick<ListSystemDeploymentsUseCase, "execute">;
  readonly startRun: Pick<StartSystemDeploymentRunUseCase, "execute">;
  readonly cancelRun: Pick<CancelSystemDeploymentRunUseCase, "execute">;
  readonly listRuns: Pick<ListSystemDeploymentRunsUseCase, "execute">;
  readonly listAudit: Pick<ListSystemDeploymentAuditUseCase, "execute">;
}

export interface CreateSystemDeploymentWorkflowHandlerOptions {
  readonly builds: SystemBuildRepositoryPort;
  readonly useCases: SystemDeploymentWorkflowUseCases;
  readonly deploymentProfiles: readonly AssetImplementationDeploymentProfile[];
  readonly hostApiVersion: string;
  readonly runtimeAbiVersion?: string;
  readonly hostCapabilities: readonly string[];
  readonly sandboxQualified: boolean;
  readonly installationPolicy: SystemDeploymentCapabilityPolicy;
  readonly generateDeploymentId: (operationId: string) => string;
  readonly generateRunId: (operationId: string) => string;
  readonly profileId?: string;
  readonly now?: () => string;
}

export const createSystemDeploymentWorkflowHandler = (
  options: CreateSystemDeploymentWorkflowHandlerOptions,
): SystemRunWorkflowHandlerPort => {
  const profileId =
    options.profileId ?? SYSTEM_DEPLOYMENT_WORKFLOW_PROFILE_ID;
  const now = options.now ?? (() => new Date().toISOString());

  const discover = async (
    query: ListSystemRunWorkflowProfilesQuery,
    context: SystemRunWorkflowRequestContext,
  ): Promise<
    SystemRunWorkflowResult<readonly SystemRunWorkflowProfileSummary[]>
  > => {
    if (query.sourceKind && query.sourceKind !== "approved-release")
      return systemRunWorkflowSuccess([]);
    const releases = query.sourceId
      ? [
          await options.builds.readRelease(
            query.workspaceId as never,
            query.sourceId as never,
          ),
        ].filter((release): release is NonNullable<typeof release> => !!release)
      : await options.builds.listReleases(query.workspaceId as never);
    return systemRunWorkflowSuccess(
      releases
        .filter(
          (release) =>
            String(release.targetWorkspaceId) === query.workspaceId,
        )
        .map((release) =>
          profileSummary({
            profileId,
            source: releaseSource(release),
            title: "Deploy and run",
            description:
              "Install an approved release, manage its runtime lifecycle, and run it under host policy.",
            category: "deployment",
            available:
              context.authenticated &&
              !!context.organizationId &&
              options.deploymentProfiles.length > 0,
            blockerCode: "workflow.deployment.unavailable",
            blockerMessage:
              "Deployment requires an authenticated organization context and a qualified host profile.",
          }),
        ),
    );
  };

  const prepare = async (
    query: PrepareSystemRunWorkflowQuery,
    context: SystemRunWorkflowRequestContext,
  ): Promise<SystemRunWorkflowResult<SystemRunWorkflowSnapshot>> => {
    if (!context.authenticated || !context.organizationId)
      return systemRunWorkflowFailure(
        "workflow.unauthorized",
        "Deployment requires an authenticated organization context.",
      );
    const release = await readExactRelease(options.builds, query);
    if (!release.ok) return release;
    const deployments = await options.useCases.list.execute({
      organizationId: context.organizationId as never,
      workspaceId: query.workspaceId as never,
      actorId: context.actorId,
      releaseId: release.value.releaseId,
    });
    return systemRunWorkflowSuccess(
      snapshot(
        query,
        deployments,
        options.deploymentProfiles,
        now(),
        profileId,
      ),
    );
  };

  const deploymentDetails = async (
    command: InvokeSystemRunWorkflowCommand,
    context: SystemRunWorkflowRequestContext,
    deploymentId: string,
  ): Promise<SystemRunWorkflowResult<SystemRunWorkflowSnapshot["blocks"]>> => {
    if (!context.organizationId)
      return systemRunWorkflowFailure(
        "workflow.unauthorized",
        "Deployment requires an organization context.",
      );
    const base = {
      organizationId: context.organizationId as never,
      workspaceId: command.workspaceId as never,
      actorId: context.actorId,
    };
    const read = await options.useCases.read.execute({
      ...base,
      deploymentId: deploymentId as never,
    });
    if (!read.ok)
      return mapCapabilityFailure(
        read.error.code,
        read.error.message,
        read.error.field,
      );
    if (
      String(read.value.releaseId) !== command.source.sourceId ||
      String(read.value.releaseDigest) !== command.source.sourceDigest
    )
      return systemRunWorkflowFailure(
        "workflow.source-stale",
        "The selected deployment does not belong to this exact release.",
      );
    const [runs, audit] = await Promise.all([
      options.useCases.listRuns.execute({
        ...base,
        deploymentId: deploymentId as never,
        limit: 50,
      }),
      options.useCases.listAudit.execute({
        ...base,
        deploymentId: deploymentId as never,
        limit: 100,
      }),
    ]);
    return systemRunWorkflowSuccess([
      deploymentStatusBlock(read.value),
      runsBlock(runs),
      auditBlock(audit),
    ]);
  };

  const invoke = async (
    command: InvokeSystemRunWorkflowCommand,
    context: SystemRunWorkflowRequestContext,
  ): Promise<SystemRunWorkflowResult<SystemRunWorkflowSnapshot>> => {
    const current = await prepare(command, context);
    if (!current.ok) return current;
    const expected = checkExpectedSnapshot(
      command.expectedSnapshotRevision,
      current.value,
    );
    if (!expected.ok) return expected;
    if (command.actionId === "refresh") return current;
    if (!context.organizationId)
      return systemRunWorkflowFailure(
        "workflow.unauthorized",
        "Deployment requires an organization context.",
      );
    try {
      if (command.actionId === "open-deployment") {
        const blocks = await deploymentDetails(
          command,
          context,
          requiredString(command.values, "deploymentId"),
        );
        return blocks.ok
          ? systemRunWorkflowSuccess(withBlocks(current.value, blocks.value))
          : blocks;
      }
      const base = {
        organizationId: context.organizationId as never,
        workspaceId: command.workspaceId as never,
        actorId: context.actorId,
      };
      let result:
        | Awaited<ReturnType<SystemDeploymentWorkflowUseCases["install"]["execute"]>>
        | Awaited<ReturnType<SystemDeploymentWorkflowUseCases["activate"]["execute"]>>
        | Awaited<ReturnType<SystemDeploymentWorkflowUseCases["startRun"]["execute"]>>;
      let deploymentId = "";
      switch (command.actionId) {
        case "install": {
          const selectedProfile = requiredString(
            command.values,
            "deploymentProfile",
          ) as AssetImplementationDeploymentProfile;
          if (!options.deploymentProfiles.includes(selectedProfile))
            return systemRunWorkflowFailure(
              "workflow.blocked",
              "The selected deployment profile is unavailable on this host.",
              "deploymentProfile",
            );
          deploymentId = options.generateDeploymentId(command.operationId);
          result = await options.useCases.install.execute({
            ...base,
            deploymentId: deploymentId as never,
            releaseId: command.source.sourceId as never,
            deploymentProfile: selectedProfile,
            hostApiVersion: options.hostApiVersion,
            ...(options.runtimeAbiVersion
              ? { runtimeAbiVersion: options.runtimeAbiVersion }
              : {}),
            hostCapabilities: options.hostCapabilities,
            sandboxQualified: options.sandboxQualified,
            policy: options.installationPolicy,
          });
          break;
        }
        case "activate":
        case "health":
        case "rollback":
        case "revoke": {
          deploymentId = requiredString(command.values, "deploymentId");
          result = await options.useCases[command.actionId].execute({
            ...base,
            deploymentId: deploymentId as never,
          });
          break;
        }
        case "start-run": {
          deploymentId = requiredString(command.values, "deploymentId");
          result = await options.useCases.startRun.execute({
            ...base,
            deploymentId: deploymentId as never,
            runId: options.generateRunId(command.operationId) as never,
            requestedCapabilities: splitLines(
              command.values,
              "capabilities",
              64,
            ),
            requestedSecretReferences: splitLines(
              command.values,
              "secretReferences",
              32,
            ),
            requestedEgressOrigins: splitLines(
              command.values,
              "egressOrigins",
              32,
            ),
          });
          break;
        }
        case "cancel-run":
          result = await options.useCases.cancelRun.execute({
            ...base,
            runId: requiredString(command.values, "runId") as never,
          });
          break;
        default:
          return systemRunWorkflowFailure(
            "workflow.unsupported",
            "The workflow action is not supported.",
            "actionId",
          );
      }
      if (!result.ok)
        return mapCapabilityFailure(
          result.error.code,
          result.error.message,
          result.error.field,
        );
      const refreshed = await prepare(command, context);
      if (!refreshed.ok || !deploymentId) return refreshed;
      const blocks = await deploymentDetails(
        command,
        context,
        deploymentId,
      );
      return blocks.ok
        ? systemRunWorkflowSuccess(withBlocks(refreshed.value, blocks.value))
        : refreshed;
    } catch (cause) {
      return systemRunWorkflowFailure(
        "workflow.validation",
        cause instanceof Error
          ? cause.message
          : "Deployment workflow values are invalid.",
      );
    }
  };

  return { profileId, discover, prepare, invoke };
};

const snapshot = (
  query: PrepareSystemRunWorkflowQuery,
  deployments: readonly SystemDeployment[],
  profiles: readonly AssetImplementationDeploymentProfile[],
  refreshedAt: string,
  profileId: string,
): SystemRunWorkflowSnapshot => ({
  schemaVersion: SYSTEM_RUN_WORKFLOW_SCHEMA_VERSION,
  profile: {
    schemaVersion: SYSTEM_RUN_WORKFLOW_SCHEMA_VERSION,
    profileId,
    source: query.source,
    title: "Deploy and run",
    description:
      "Install an approved release, manage its lifecycle, and run it under host policy.",
    category: "deployment",
    availability: "available",
    blockers: [],
  },
  snapshotRevision: deploymentRevision(deployments),
  refreshedAt,
  blocks: [
    {
      blockId: "deployments",
      kind: "table",
      title: "Deployments",
      columns: [
        { columnId: "deploymentId", label: "Deployment" },
        { columnId: "profile", label: "Profile" },
        { columnId: "status", label: "Status" },
        { columnId: "health", label: "Health" },
      ],
      rows: deployments.map((deployment) => ({
        rowId: String(deployment.deploymentId),
        values: {
          deploymentId: String(deployment.deploymentId),
          profile: deployment.deploymentProfile,
          status: deployment.status,
          health: deployment.health.status,
        },
      })),
      emptyMessage: "This release has not been deployed.",
    },
  ],
  actions: deploymentActions(profiles),
});

const deploymentActions = (
  profiles: readonly AssetImplementationDeploymentProfile[],
): readonly SystemRunWorkflowAction[] => [
  {
    actionId: "refresh",
    label: "Refresh",
    description: "Read the latest deployment state.",
    intent: "read",
    emphasis: "normal",
    requiresConfirmation: false,
    enabled: true,
    fields: [],
  },
  {
    actionId: "install",
    label: "Install release",
    description: "Install this exact approved release under host policy.",
    intent: "mutate",
    emphasis: "caution",
    requiresConfirmation: true,
    enabled: profiles.length > 0,
    ...(profiles.length === 0
      ? { disabledReason: "No deployment profile is available." }
      : {}),
    fields: [
      {
        fieldId: "deploymentProfile",
        label: "Deployment profile",
        kind: "select",
        required: true,
        options: profiles.map((profile) => ({
          value: profile,
          label: profile.replaceAll("-", " "),
        })),
      },
    ],
  },
  readAction("open-deployment", "Open deployment"),
  deploymentAction("activate", "Activate deployment", "mutate", "caution"),
  deploymentAction("health", "Check health", "read", "normal"),
  deploymentAction("rollback", "Roll back deployment", "mutate", "caution"),
  deploymentAction("revoke", "Revoke deployment", "mutate", "danger"),
  {
    ...deploymentAction("start-run", "Start a run", "execute", "caution"),
    fields: [
      deploymentIdField(),
      listField("capabilities", "Requested capabilities"),
      listField("secretReferences", "Secret references", true),
      listField("egressOrigins", "Egress origins"),
    ],
  },
  {
    actionId: "cancel-run",
    label: "Cancel a run",
    description: "Request cancellation for a deployment run.",
    intent: "mutate",
    emphasis: "caution",
    requiresConfirmation: true,
    enabled: true,
    fields: [
      {
        fieldId: "runId",
        label: "Run identifier",
        kind: "text",
        required: true,
        maximumLength: 200,
      },
    ],
  },
];

const readAction = (
  actionId: string,
  label: string,
): SystemRunWorkflowAction => ({
  actionId,
  label,
  description: "Read bounded deployment, run, and audit details.",
  intent: "read",
  emphasis: "normal",
  requiresConfirmation: false,
  enabled: true,
  fields: [deploymentIdField()],
});

const deploymentAction = (
  actionId: string,
  label: string,
  intent: "read" | "mutate" | "execute",
  emphasis: "normal" | "caution" | "danger",
): SystemRunWorkflowAction => ({
  actionId,
  label,
  description: `${label} for the selected release-bound deployment.`,
  intent,
  emphasis,
  requiresConfirmation: intent !== "read",
  enabled: true,
  fields: [deploymentIdField()],
});

const deploymentIdField = () =>
  ({
    fieldId: "deploymentId",
    label: "Deployment identifier",
    kind: "text",
    required: true,
    maximumLength: 200,
  }) as const;

const listField = (
  fieldId: string,
  label: string,
  sensitive = false,
) =>
  ({
    fieldId,
    label,
    description: "Enter one value per line.",
    kind: sensitive ? "secret-reference" : "multiline",
    required: false,
    sensitive,
    maximumLength: 4_000,
  }) as const;

const deploymentRevision = (
  deployments: readonly SystemDeployment[],
): string => {
  const latest = deployments
    .map((deployment) => deployment.updatedAt)
    .sort();
  return `deployment:${deployments.length}:${latest[latest.length - 1] ?? "empty"}`;
};

const deploymentStatusBlock = (deployment: SystemDeployment) =>
  ({
    blockId: "deployment-status",
    kind: "key-value",
    title: "Deployment status",
    entries: [
      {
        key: "deploymentId",
        label: "Deployment",
        value: String(deployment.deploymentId),
      },
      { key: "status", label: "Status", value: deployment.status },
      { key: "health", label: "Health", value: deployment.health.status },
      {
        key: "runtimeProfileId",
        label: "Runtime profile",
        value: deployment.runtimeProfileId ?? "legacy",
      },
      { key: "revision", label: "Revision", value: deployment.revision },
    ],
  }) as const;

const runsBlock = (runs: readonly SystemDeploymentRun[]) =>
  ({
    blockId: "deployment-runs",
    kind: "table",
    title: "Runs",
    columns: [
      { columnId: "runId", label: "Run" },
      { columnId: "status", label: "Status" },
      { columnId: "createdAt", label: "Created" },
    ],
    rows: runs.map((run) => ({
      rowId: String(run.runId),
      values: {
        runId: String(run.runId),
        status: run.status,
        createdAt: run.createdAt,
      },
    })),
    emptyMessage: "No deployment runs have been started.",
  }) as const;

const auditBlock = (entries: readonly SystemDeploymentAuditEntry[]) =>
  ({
    blockId: "deployment-audit",
    kind: "audit",
    title: "Deployment audit",
    items: entries.map((entry) => ({
      entryId: String(entry.auditId),
      action: entry.action,
      outcome: entry.outcome,
      occurredAt: entry.occurredAt,
      summary: entry.reasonCode,
    })),
  }) as const;
