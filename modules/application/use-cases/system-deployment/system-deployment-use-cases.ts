import type {
  SystemDeploymentRepositoryPort,
  SystemDeploymentRevocationPort,
  SystemDeploymentRuntimePort,
  SystemRuntimeInstanceLifecyclePort,
  SystemRuntimeInstanceRepositoryPort,
} from "../../ports/system-deployment";
import type {
  SystemBuildArtifactPort,
  SystemBuildRepositoryPort,
} from "../../ports/system-build";
import type { SystemRelease } from "../../../contracts/system-build";
import { normalizeAssetImplementationReleaseId } from "../../../contracts/asset-implementation";
import {
  SystemDeploymentCompatibilityService,
  SystemDeploymentPolicyService,
} from "../../services/system-deployment";
import {
  systemDeploymentFailure,
  systemDeploymentSuccess,
  type ActivateSystemDeploymentCommand,
  type CancelSystemDeploymentRunCommand,
  type DeactivateSystemDeploymentCommand,
  type InstallSystemDeploymentCommand,
  type ListSystemDeploymentAuditQuery,
  type ListSystemDeploymentRunsQuery,
  type ListSystemDeploymentsQuery,
  type ReadSystemDeploymentQuery,
  type ReconcileSystemDeploymentHealthCommand,
  type RevokeSystemDeploymentCommand,
  type RollbackSystemDeploymentCommand,
  type StartSystemDeploymentRunCommand,
  type SystemDeployment,
  type SystemDeploymentAuditEntry,
  type SystemDeploymentDiagnostic,
  type SystemDeploymentResult,
  type SystemDeploymentRun,
  type SystemRuntimeInstance,
  isSystemRuntimeInstanceBoundToDeployment,
  type SystemReferenceRuntimeKind,
  type SystemRuntimeInstanceId,
  type SystemRuntimeProfileId,
  type UninstallSystemDeploymentCommand,
  mapLegacySystemReferenceRuntimeKind,
} from "../../../contracts/system-deployment";

const MAX_MANIFEST_BYTES = 8 * 1024 * 1024;
const REFERENCE_KINDS = new Set<SystemReferenceRuntimeKind>([
  "secured-data-entry",
  "controlled-chatbot",
  "secured-data-review",
]);

export interface SystemDeploymentUseCaseDependencies {
  readonly repository: SystemDeploymentRepositoryPort;
  readonly builds: SystemBuildRepositoryPort;
  readonly artifacts: SystemBuildArtifactPort;
  readonly runtime: SystemDeploymentRuntimePort;
  readonly runtimeInstances: SystemRuntimeInstanceLifecyclePort;
  readonly runtimeInstanceRepository: SystemRuntimeInstanceRepositoryPort;
  readonly revocations: SystemDeploymentRevocationPort;
  readonly compatibility: SystemDeploymentCompatibilityService;
  readonly policy: SystemDeploymentPolicyService;
  readonly platformPolicy: SystemDeployment["policy"];
  readonly generateAuditId: () => string;
  readonly generateRuntimeInstanceId: () => SystemRuntimeInstanceId;
  readonly now?: () => string;
}

export class InstallSystemDeploymentUseCase {
  private readonly now: () => string;
  public constructor(private readonly d: SystemDeploymentUseCaseDependencies) {
    this.now = d.now ?? (() => new Date().toISOString());
  }

  async execute(
    command: InstallSystemDeploymentCommand,
  ): Promise<SystemDeploymentResult<SystemDeployment>> {
    const policyDiagnostics = [
      ...this.d.policy.validate(command.policy),
      ...this.d.policy.validateNarrowing(command.policy, this.d.platformPolicy),
    ];
    if (hasErrors(policyDiagnostics))
      return systemDeploymentFailure(
        policyDiagnostics[0].code,
        policyDiagnostics[0].message,
        "policy",
      );
    const release = await this.d.builds.readRelease(
      command.workspaceId,
      command.releaseId,
    );
    if (!release)
      return systemDeploymentFailure(
        "deployment.release.not-found",
        "The approved release was not found in this workspace.",
      );
    const revocationStatus = await releaseRevocationStatus(this.d, release);
    if (revocationStatus !== "clear")
      return systemDeploymentFailure(
        revocationStatus === "revoked"
          ? "deployment.release.revoked"
          : "deployment.revocation.unavailable",
        revocationStatus === "revoked"
          ? "The approved release contains a revoked implementation."
          : "Revocation status could not be verified safely.",
      );
    let runtimeProfileId: SystemRuntimeProfileId;
    try {
      runtimeProfileId = await verifyAndResolveRuntimeProfile(
        this.d.artifacts,
        release,
      );
    } catch {
      return systemDeploymentFailure(
        "deployment.release.integrity",
        "Release integrity or manifest verification failed.",
      );
    }
    const installedAt = this.now();
    const compatibility = await this.d.compatibility.evaluate(
      command,
      release,
      runtimeProfileId,
      installedAt,
    );
    if (!compatibility.compatible) {
      const first = compatibility.diagnostics.find(
        (item) => item.severity === "error",
      );
      return systemDeploymentFailure(
        first?.code ?? "deployment.incompatible",
        first?.message ?? "The release is incompatible with this host.",
      );
    }
    let runtimeInstance: SystemRuntimeInstance;
    try {
      runtimeInstance = await this.d.runtimeInstances.allocate({
        runtimeInstanceId: this.d.generateRuntimeInstanceId(),
        organizationId: command.organizationId,
        workspaceId: command.workspaceId,
        deploymentId: command.deploymentId,
        releaseId: release.releaseId,
      });
    } catch {
      return systemDeploymentFailure(
        "deployment.runtime-data.unavailable",
        "The isolated runtime data plane could not be allocated safely.",
      );
    }
    const previous = (
      await this.d.repository.listDeployments(
        command.organizationId,
        command.workspaceId,
      )
    ).find(
      (item) =>
        item.deploymentProfile === command.deploymentProfile &&
        item.status === "active",
    );
    const deployment: SystemDeployment = {
      deploymentId: command.deploymentId,
      organizationId: command.organizationId,
      workspaceId: command.workspaceId,
      releaseId: release.releaseId,
      releaseDigest: release.releaseDigest,
      runtimeInstanceId: runtimeInstance.runtimeInstanceId,
      runtimeProfileId,
      deploymentProfile: command.deploymentProfile,
      ...(command.hostTargetId ? { hostTargetId: command.hostTargetId } : {}),
      status: "installed",
      revision: 0,
      ...(previous ? { previousDeploymentId: previous.deploymentId } : {}),
      compatibility,
      policy: command.policy,
      health: {
        status: "unknown",
        checkedAt: installedAt,
        diagnostics: [],
      },
      installedAt,
      installedBy: safeActor(command.actorId),
      updatedAt: installedAt,
    };
    let saved: SystemDeployment | undefined;
    try {
      saved = command.hostTargetId
        ? await this.d.repository.createCurrentDeployment(deployment)
        : await this.d.repository.createDeployment(deployment);
      await this.audit(
        saved,
        "install",
        "allowed",
        command.actorId,
        "deployment.installed",
      );
      return systemDeploymentSuccess(saved);
    } catch {
      if (saved) {
        try {
          await this.d.repository.updateDeployment(
            {
              ...saved,
              status: "failed",
              revision: saved.revision + 1,
              health: {
                status: "unhealthy",
                checkedAt: this.now(),
                diagnostics: [
                  {
                    code: "deployment.audit.unavailable",
                    message:
                      "The required installation audit record could not be persisted.",
                    severity: "error",
                  },
                ],
              },
              updatedAt: this.now(),
            },
            saved.revision,
          );
        } catch {
          // The caller still receives a fail-closed result. Repository recovery
          // tooling can identify the revision-zero interrupted installation.
        }
      }
      return systemDeploymentFailure(
        "deployment.install.failed",
        "The deployment could not be installed safely.",
      );
    }
  }

  private audit(
    deployment: SystemDeployment,
    action: SystemDeploymentAuditEntry["action"],
    outcome: SystemDeploymentAuditEntry["outcome"],
    actorId: string,
    reasonCode: string,
  ) {
    return this.d.repository.appendAudit(
      auditEntry(this.d, deployment, action, outcome, actorId, reasonCode),
    );
  }
}

export class ActivateSystemDeploymentUseCase {
  private readonly now: () => string;
  public constructor(private readonly d: SystemDeploymentUseCaseDependencies) {
    this.now = d.now ?? (() => new Date().toISOString());
  }

  async execute(
    command: ActivateSystemDeploymentCommand,
  ): Promise<SystemDeploymentResult<SystemDeployment>> {
    const deployment = await readDeployment(this.d.repository, command);
    if (!deployment)
      return systemDeploymentFailure(
        "deployment.not-found",
        "Deployment was not found.",
      );
    const revocationStatus = await enforceDeploymentRevocation(
      this.d,
      deployment,
      command.actorId,
    );
    if (revocationStatus !== "clear")
      return revocationFailure<SystemDeployment>(
        revocationStatus,
        "The deployment cannot be activated.",
      );
    if (
      !["installed", "inactive", "failed", "degraded"].includes(
        deployment.status,
      )
    )
      return systemDeploymentFailure(
        "deployment.activation.conflict",
        "This deployment cannot be activated from its current state.",
      );
    let activating: SystemDeployment | undefined;
    let runtimeInstance: SystemRuntimeInstance | undefined;
    try {
      await this.d.repository.appendAudit(
        auditEntry(
          this.d,
          deployment,
          "activate",
          "allowed",
          command.actorId,
          "deployment.activation.authorized",
        ),
      );
      activating = await this.d.repository.updateDeployment(
        {
          ...deployment,
          status: "activating",
          revision: deployment.revision + 1,
          updatedAt: this.now(),
          health: {
            status: "starting",
            checkedAt: this.now(),
            diagnostics: [],
          },
        },
        deployment.revision,
      );
      runtimeInstance = await readRuntimeInstance(this.d, activating);
      runtimeInstance = await this.d.runtimeInstances.activate(runtimeInstance);
      const health = await this.d.runtime.activate(activating);
      if (health.status !== "ready") {
        await this.d.runtimeInstances.stop(runtimeInstance);
        const failed = await this.d.repository.updateDeployment(
          {
            ...activating,
            status: "failed",
            revision: activating.revision + 1,
            updatedAt: this.now(),
            health,
          },
          activating.revision,
        );
        await this.d.repository.appendAudit(
          auditEntry(
            this.d,
            failed,
            "activate",
            "failed",
            command.actorId,
            "deployment.activation.not-ready",
          ),
        );
        return systemDeploymentFailure(
          "deployment.not-ready",
          "The deployment did not become ready.",
        );
      }
      if (activating.previousDeploymentId) {
        const previous = await this.d.repository.readDeployment(
          command.organizationId,
          command.workspaceId,
          activating.previousDeploymentId,
        );
        if (previous?.status === "active") {
          await this.d.runtime.deactivate(previous);
          await this.d.runtimeInstances.stop(
            await readRuntimeInstance(this.d, previous),
          );
          await this.d.repository.updateDeployment(
            {
              ...previous,
              status: "inactive",
              revision: previous.revision + 1,
              updatedAt: this.now(),
              health: {
                ...previous.health,
                status: "stopped",
                checkedAt: this.now(),
              },
            },
            previous.revision,
          );
        }
      }
      const active = await this.d.repository.updateDeployment(
        {
          ...activating,
          status: "active",
          revision: activating.revision + 1,
          updatedAt: this.now(),
          activatedAt: this.now(),
          activatedBy: safeActor(command.actorId),
          health,
        },
        activating.revision,
      );
      return systemDeploymentSuccess(active);
    } catch {
      if (activating) {
        try {
          await this.d.runtime.deactivate(activating);
        } catch {
          // Continue fail-safe data-plane cleanup without exposing adapter detail.
        }
      }
      if (runtimeInstance) {
        try {
          await this.d.runtimeInstances.stop(runtimeInstance);
        } catch {
          // Reconciliation can recover a retained open data plane.
        }
      }
      if (activating) {
        try {
          await this.d.repository.updateDeployment(
            {
              ...activating,
              status: "failed",
              revision: activating.revision + 1,
              updatedAt: this.now(),
              health: {
                status: "unhealthy",
                checkedAt: this.now(),
                diagnostics: [
                  {
                    severity: "error",
                    code: "deployment.activation.interrupted",
                    message: "Deployment activation was interrupted.",
                  },
                ],
              },
            },
            activating.revision,
          );
        } catch {
          // The optimistic state transition is best-effort; the retained prior
          // deployment remains authoritative even when persistence is degraded.
        }
      }
      return systemDeploymentFailure(
        "deployment.activation.failed",
        "Deployment activation failed safely; the previous active deployment was retained.",
      );
    }
  }
}

export class DeactivateSystemDeploymentUseCase {
  private readonly now: () => string;
  public constructor(private readonly d: SystemDeploymentUseCaseDependencies) {
    this.now = d.now ?? (() => new Date().toISOString());
  }

  async execute(
    command: DeactivateSystemDeploymentCommand,
  ): Promise<SystemDeploymentResult<SystemDeployment>> {
    const deployment = await readDeployment(this.d.repository, command);
    if (!deployment)
      return systemDeploymentFailure(
        "deployment.not-found",
        "Deployment was not found.",
      );
    if (deployment.status === "inactive")
      return systemDeploymentSuccess(deployment);
    if (!["active", "degraded"].includes(deployment.status))
      return systemDeploymentFailure(
        "deployment.deactivation.conflict",
        "This deployment cannot be deactivated from its current state.",
      );
    const runs = await this.d.repository.listRuns(
      command.organizationId,
      command.workspaceId,
      deployment.deploymentId,
    );
    if (
      runs.some((run) => ["queued", "running", "stopping"].includes(run.status))
    )
      return systemDeploymentFailure(
        "deployment.deactivation.running",
        "Stop the running system before deactivating it.",
      );
    try {
      await this.d.repository.appendAudit(
        auditEntry(
          this.d,
          deployment,
          "deactivate",
          "allowed",
          command.actorId,
          "deployment.deactivation.authorized",
        ),
      );
      await this.d.runtime.deactivate(deployment);
      const runtimeInstance = await readOptionalRuntimeInstance(
        this.d,
        deployment,
      );
      if (runtimeInstance) await this.d.runtimeInstances.stop(runtimeInstance);
      return systemDeploymentSuccess(
        await this.d.repository.updateDeployment(
          {
            ...deployment,
            status: "inactive",
            revision: deployment.revision + 1,
            updatedAt: this.now(),
            health: {
              status: "stopped",
              checkedAt: this.now(),
              diagnostics: [],
            },
          },
          deployment.revision,
        ),
      );
    } catch {
      return systemDeploymentFailure(
        "deployment.deactivation.failed",
        "Deployment deactivation failed safely.",
      );
    }
  }
}

export class UninstallSystemDeploymentUseCase {
  private readonly now: () => string;
  public constructor(private readonly d: SystemDeploymentUseCaseDependencies) {
    this.now = d.now ?? (() => new Date().toISOString());
  }

  async execute(
    command: UninstallSystemDeploymentCommand,
  ): Promise<SystemDeploymentResult<SystemDeployment>> {
    const deployment = await readDeployment(this.d.repository, command);
    if (!deployment)
      return systemDeploymentFailure(
        "deployment.not-found",
        "Deployment was not found.",
      );
    if (deployment.status === "uninstalled")
      return systemDeploymentSuccess(deployment);
    if (
      ![
        "installed",
        "active",
        "inactive",
        "failed",
        "degraded",
        "uninstalling",
      ].includes(deployment.status)
    )
      return systemDeploymentFailure(
        "deployment.uninstall.conflict",
        "This deployment cannot be uninstalled from its current state.",
      );
    const runs = await this.d.repository.listRuns(
      command.organizationId,
      command.workspaceId,
      deployment.deploymentId,
    );
    if (
      runs.some((run) => ["queued", "running", "stopping"].includes(run.status))
    )
      return systemDeploymentFailure(
        "deployment.uninstall.running",
        "Stop the running system before uninstalling it.",
      );
    let uninstalling = deployment;
    try {
      await this.d.repository.appendAudit(
        auditEntry(
          this.d,
          deployment,
          "uninstall",
          "allowed",
          command.actorId,
          "deployment.uninstall.authorized",
        ),
      );
      if (deployment.status !== "uninstalling")
        uninstalling = await this.d.repository.updateDeployment(
          {
            ...deployment,
            status: "uninstalling",
            revision: deployment.revision + 1,
            updatedAt: this.now(),
          },
          deployment.revision,
        );
      await this.d.runtime.deactivate(uninstalling);
      const runtimeInstance = await readOptionalRuntimeInstance(
        this.d,
        uninstalling,
      );
      if (runtimeInstance)
        await this.d.runtimeInstances.retain(runtimeInstance);
      const completedAt = this.now();
      return systemDeploymentSuccess(
        await this.d.repository.retireCurrentDeployment(
          {
            ...uninstalling,
            status: "uninstalled",
            revision: uninstalling.revision + 1,
            updatedAt: completedAt,
            uninstalledAt: completedAt,
            uninstalledBy: safeActor(command.actorId),
            health: {
              status: "stopped",
              checkedAt: completedAt,
              diagnostics: [],
            },
          },
          uninstalling.revision,
        ),
      );
    } catch {
      return systemDeploymentFailure(
        "deployment.uninstall.failed",
        "Deployment uninstall did not complete; retained state is available for recovery.",
      );
    }
  }
}

export class ReconcileSystemDeploymentHealthUseCase {
  private readonly now: () => string;
  public constructor(private readonly d: SystemDeploymentUseCaseDependencies) {
    this.now = d.now ?? (() => new Date().toISOString());
  }
  async execute(command: ReconcileSystemDeploymentHealthCommand) {
    const deployment = await readDeployment(this.d.repository, command);
    if (!deployment)
      return systemDeploymentFailure(
        "deployment.not-found",
        "Deployment was not found.",
      );
    const revocationStatus = await enforceDeploymentRevocation(
      this.d,
      deployment,
      command.actorId,
    );
    if (revocationStatus !== "clear")
      return revocationFailure<SystemDeployment>(
        revocationStatus,
        "Deployment health is unavailable.",
      );
    if (!["active", "degraded"].includes(deployment.status))
      return systemDeploymentFailure(
        "deployment.health.conflict",
        "Only an active deployment has runtime health.",
      );
    try {
      const health = await this.d.runtime.health(deployment);
      const updated = await this.d.repository.updateDeployment(
        {
          ...deployment,
          status: health.status === "ready" ? "active" : "degraded",
          revision: deployment.revision + 1,
          updatedAt: this.now(),
          health,
        },
        deployment.revision,
      );
      await this.d.repository.appendAudit(
        auditEntry(
          this.d,
          updated,
          "health",
          health.status === "ready" ? "allowed" : "failed",
          command.actorId,
          `deployment.health.${health.status}`,
        ),
      );
      return systemDeploymentSuccess(updated);
    } catch {
      return systemDeploymentFailure(
        "deployment.health.failed",
        "Deployment health could not be reconciled.",
      );
    }
  }
}

export class RollbackSystemDeploymentUseCase {
  private readonly now: () => string;
  public constructor(private readonly d: SystemDeploymentUseCaseDependencies) {
    this.now = d.now ?? (() => new Date().toISOString());
  }
  async execute(command: RollbackSystemDeploymentCommand) {
    const current = await readDeployment(this.d.repository, command);
    if (!current)
      return systemDeploymentFailure(
        "deployment.not-found",
        "Deployment was not found.",
      );
    if (current.status !== "active" || !current.previousDeploymentId)
      return systemDeploymentFailure(
        "deployment.rollback.unavailable",
        "No previous deployment is available for rollback.",
      );
    const previous = await this.d.repository.readDeployment(
      command.organizationId,
      command.workspaceId,
      current.previousDeploymentId,
    );
    if (!previous || previous.status === "revoked")
      return systemDeploymentFailure(
        "deployment.rollback.unavailable",
        "The previous deployment is unavailable.",
      );
    const revocationStatus = await enforceDeploymentRevocation(
      this.d,
      previous,
      command.actorId,
    );
    if (revocationStatus !== "clear")
      return revocationFailure<SystemDeployment>(
        revocationStatus,
        "The previous deployment cannot be restored.",
      );
    try {
      await this.d.repository.appendAudit(
        auditEntry(
          this.d,
          current,
          "rollback",
          "allowed",
          command.actorId,
          "deployment.rollback.authorized",
        ),
      );
      const rolling = await this.d.repository.updateDeployment(
        {
          ...current,
          status: "rolling-back",
          revision: current.revision + 1,
          updatedAt: this.now(),
        },
        current.revision,
      );
      const previousRuntimeInstance = await readRuntimeInstance(
        this.d,
        previous,
      );
      const activePreviousRuntimeInstance =
        await this.d.runtimeInstances.activate(previousRuntimeInstance);
      const health = await this.d.runtime.activate(previous);
      if (health.status !== "ready") {
        await this.d.runtimeInstances.stop(activePreviousRuntimeInstance);
        await this.d.repository.updateDeployment(
          {
            ...rolling,
            status: "active",
            revision: rolling.revision + 1,
            updatedAt: this.now(),
          },
          rolling.revision,
        );
        return systemDeploymentFailure(
          "deployment.rollback.not-ready",
          "The previous deployment did not become ready; the current runtime was retained.",
        );
      }
      const restored = await this.d.repository.updateDeployment(
        {
          ...previous,
          status: "active",
          revision: previous.revision + 1,
          updatedAt: this.now(),
          activatedAt: this.now(),
          activatedBy: safeActor(command.actorId),
          health,
        },
        previous.revision,
      );
      await this.d.runtime.deactivate(rolling);
      await this.d.runtimeInstances.stop(
        await readRuntimeInstance(this.d, rolling),
      );
      await this.d.repository.updateDeployment(
        {
          ...rolling,
          status: "inactive",
          revision: rolling.revision + 1,
          updatedAt: this.now(),
          health: {
            ...rolling.health,
            status: "stopped",
            checkedAt: this.now(),
          },
        },
        rolling.revision,
      );
      return systemDeploymentSuccess(restored);
    } catch {
      return systemDeploymentFailure(
        "deployment.rollback.failed",
        "Deployment rollback failed safely.",
      );
    }
  }
}

export class RevokeSystemDeploymentUseCase {
  private readonly now: () => string;
  public constructor(private readonly d: SystemDeploymentUseCaseDependencies) {
    this.now = d.now ?? (() => new Date().toISOString());
  }
  async execute(command: RevokeSystemDeploymentCommand) {
    const deployment = await readDeployment(this.d.repository, command);
    if (!deployment)
      return systemDeploymentFailure(
        "deployment.not-found",
        "Deployment was not found.",
      );
    if (deployment.status === "revoked")
      return systemDeploymentSuccess(deployment);
    try {
      await this.d.repository.appendAudit(
        auditEntry(
          this.d,
          deployment,
          "revoke",
          "allowed",
          command.actorId,
          "deployment.revocation.authorized",
        ),
      );
      if (["active", "degraded", "activating"].includes(deployment.status)) {
        await this.d.runtime.deactivate(deployment);
        await this.d.runtimeInstances.stop(
          await readRuntimeInstance(this.d, deployment),
        );
      }
      return systemDeploymentSuccess(
        await this.d.repository.updateDeployment(
          {
            ...deployment,
            status: "revoked",
            revision: deployment.revision + 1,
            updatedAt: this.now(),
            revokedAt: this.now(),
            revokedBy: safeActor(command.actorId),
            health: {
              ...deployment.health,
              status: "stopped",
              checkedAt: this.now(),
            },
          },
          deployment.revision,
        ),
      );
    } catch {
      return systemDeploymentFailure(
        "deployment.revocation.failed",
        "Deployment revocation failed safely.",
      );
    }
  }
}

export class StartSystemDeploymentRunUseCase {
  private readonly now: () => string;
  public constructor(private readonly d: SystemDeploymentUseCaseDependencies) {
    this.now = d.now ?? (() => new Date().toISOString());
  }
  async execute(command: StartSystemDeploymentRunCommand) {
    const deployment = await readDeployment(this.d.repository, command);
    if (
      !deployment ||
      deployment.status !== "active" ||
      deployment.health.status !== "ready"
    )
      return systemDeploymentFailure(
        "deployment.run.not-ready",
        "An active ready deployment is required.",
      );
    const revocationStatus = await enforceDeploymentRevocation(
      this.d,
      deployment,
      command.actorId,
    );
    if (revocationStatus !== "clear")
      return revocationFailure<SystemDeploymentRun>(
        revocationStatus,
        "The deployment cannot start a run.",
      );
    const runs = await this.d.repository.listRuns(
      command.organizationId,
      command.workspaceId,
      command.deploymentId,
    );
    const draft: SystemDeploymentRun = {
      runId: command.runId,
      deploymentId: deployment.deploymentId,
      organizationId: command.organizationId,
      workspaceId: command.workspaceId,
      releaseId: deployment.releaseId,
      status: "queued",
      revision: 0,
      cancellationRequested: false,
      requestedCapabilities: command.requestedCapabilities,
      requestedSecretReferences: command.requestedSecretReferences,
      requestedEgressOrigins: command.requestedEgressOrigins,
      diagnostics: [],
      createdAt: this.now(),
      requestedBy: safeActor(command.actorId),
    };
    const denials = this.d.policy.authorizeRun(
      deployment.policy,
      draft,
      runs.filter((item) => ["queued", "running"].includes(item.status)).length,
    );
    if (hasErrors(denials)) {
      await this.d.repository.appendAudit({
        ...auditEntry(
          this.d,
          deployment,
          "capability",
          "denied",
          command.actorId,
          denials[0].code,
        ),
        runId: command.runId,
      });
      return systemDeploymentFailure(denials[0].code, denials[0].message);
    }
    let running: SystemDeploymentRun | undefined;
    try {
      await this.d.runtimeInstances.activate(
        await readRuntimeInstance(this.d, deployment),
      );
      const queued = await this.d.repository.createRun(draft);
      running = await this.d.repository.updateRun(
        { ...queued, status: "running", revision: 1, startedAt: this.now() },
        0,
      );
      await this.d.repository.appendAudit({
        ...auditEntry(
          this.d,
          deployment,
          "run-start",
          "allowed",
          command.actorId,
          "deployment.run.authorized",
        ),
        runId: command.runId,
      });
      const result = await this.d.runtime.start(deployment, running);
      if (result.status === "running")
        return systemDeploymentSuccess(
          await this.d.repository.updateRun(
            {
              ...running,
              revision: running.revision + 1,
              diagnostics: result.diagnostics,
              ...(result.runtimeKind
                ? { runtimeKind: result.runtimeKind }
                : {}),
              ...(result.launchDescriptor
                ? { launchDescriptor: result.launchDescriptor }
                : {}),
            },
            running.revision,
          ),
        );
      const completed = await this.d.repository.updateRun(
        {
          ...running,
          status: result.status,
          revision: running.revision + 1,
          diagnostics: result.diagnostics,
          completedAt: this.now(),
          usage: {
            durationMilliseconds: Math.max(0, result.durationMilliseconds ?? 0),
            outputBytes: Math.max(0, result.outputBytes ?? 0),
          },
        },
        running.revision,
      );
      return systemDeploymentSuccess(completed);
    } catch {
      if (running) {
        try {
          await this.d.repository.updateRun(
            {
              ...running,
              status: "failed",
              revision: running.revision + 1,
              completedAt: this.now(),
              diagnostics: [
                {
                  severity: "error",
                  code: "deployment.run.interrupted",
                  message: "The deployment run was interrupted.",
                },
              ],
              usage: { durationMilliseconds: 0, outputBytes: 0 },
            },
            running.revision,
          );
        } catch {
          // Preserve the original safe failure when the repository is also
          // unavailable; reconciliation can detect the retained running state.
        }
      }
      return systemDeploymentFailure(
        "deployment.run.failed",
        "The deployment run failed safely.",
      );
    }
  }
}

export class CancelSystemDeploymentRunUseCase {
  private readonly now: () => string;
  public constructor(private readonly d: SystemDeploymentUseCaseDependencies) {
    this.now = d.now ?? (() => new Date().toISOString());
  }
  async execute(command: CancelSystemDeploymentRunCommand) {
    const run = await this.d.repository.readRun(
      command.organizationId,
      command.workspaceId,
      command.runId,
    );
    if (!run)
      return systemDeploymentFailure(
        "deployment.run.not-found",
        "Deployment run was not found.",
      );
    if (!["queued", "running", "stopping"].includes(run.status))
      return systemDeploymentFailure(
        "deployment.run.cancel-conflict",
        "Only queued or running deployments can be cancelled.",
      );
    const deployment = await this.d.repository.readDeployment(
      command.organizationId,
      command.workspaceId,
      run.deploymentId,
    );
    if (!deployment)
      return systemDeploymentFailure(
        "deployment.not-found",
        "Deployment was not found.",
      );
    try {
      const stopping =
        run.status === "stopping"
          ? run
          : await this.d.repository.updateRun(
              {
                ...run,
                status: "stopping",
                revision: run.revision + 1,
                cancellationRequested: true,
              },
              run.revision,
            );
      await this.d.runtime.cancel(deployment, stopping);
      const cancelled = await this.d.repository.updateRun(
        {
          ...stopping,
          status: "cancelled",
          revision: stopping.revision + 1,
          cancellationRequested: true,
          completedAt: this.now(),
        },
        stopping.revision,
      );
      await this.d.repository.appendAudit({
        ...auditEntry(
          this.d,
          deployment,
          "run-cancel",
          "allowed",
          command.actorId,
          "deployment.run.cancelled",
        ),
        runId: run.runId,
      });
      return systemDeploymentSuccess(cancelled);
    } catch {
      return systemDeploymentFailure(
        "deployment.run.cancel-failed",
        "Run cancellation failed safely.",
      );
    }
  }
}

export class ReadSystemDeploymentUseCase {
  public constructor(
    private readonly repository: SystemDeploymentRepositoryPort,
  ) {}
  async execute(query: ReadSystemDeploymentQuery) {
    const value = await readDeployment(this.repository, query);
    return value
      ? systemDeploymentSuccess(value)
      : systemDeploymentFailure(
          "deployment.not-found",
          "Deployment was not found.",
        );
  }
}
export class ListSystemDeploymentsUseCase {
  public constructor(
    private readonly repository: SystemDeploymentRepositoryPort,
  ) {}
  execute(query: ListSystemDeploymentsQuery) {
    return this.repository.listDeployments(
      query.organizationId,
      query.workspaceId,
      query.releaseId,
    );
  }
}
export class ListSystemDeploymentRunsUseCase {
  public constructor(
    private readonly repository: SystemDeploymentRepositoryPort,
  ) {}
  async execute(query: ListSystemDeploymentRunsQuery) {
    const limit = Math.max(1, Math.min(200, query.limit ?? 50));
    return (
      await this.repository.listRuns(
        query.organizationId,
        query.workspaceId,
        query.deploymentId,
      )
    ).slice(0, limit);
  }
}
export class ListSystemDeploymentAuditUseCase {
  public constructor(
    private readonly repository: SystemDeploymentRepositoryPort,
  ) {}
  execute(query: ListSystemDeploymentAuditQuery) {
    return this.repository.listAudit(
      query.organizationId,
      query.workspaceId,
      query.deploymentId,
      query.limit ?? 100,
    );
  }
}

async function verifyAndResolveRuntimeProfile(
  artifacts: SystemBuildArtifactPort,
  release: SystemRelease,
): Promise<SystemRuntimeProfileId> {
  let manifest: unknown;
  for (const descriptor of release.artifacts) {
    if (
      descriptor.sizeBytes > MAX_MANIFEST_BYTES &&
      descriptor.kind === "manifest"
    )
      throw new Error("Manifest is oversized.");
    const bytes = await artifacts.readVerified<Uint8Array>(
      release.targetWorkspaceId,
      descriptor,
    );
    if (descriptor.kind === "manifest") {
      manifest = JSON.parse(new TextDecoder().decode(bytes));
    }
  }
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest))
    throw new Error("Manifest is missing.");
  const instances = (manifest as { instances?: unknown }).instances;
  if (!Array.isArray(instances) || instances.length > 5000)
    throw new Error("Manifest instances are invalid.");
  const kinds = new Set<SystemReferenceRuntimeKind>();
  for (const instance of instances) {
    if (!instance || typeof instance !== "object" || Array.isArray(instance))
      continue;
    const metadata = (instance as { metadata?: unknown }).metadata;
    if (!metadata || typeof metadata !== "object" || Array.isArray(metadata))
      continue;
    const candidate = (metadata as { referenceSystemKind?: unknown })
      .referenceSystemKind;
    if (
      typeof candidate === "string" &&
      REFERENCE_KINDS.has(candidate as SystemReferenceRuntimeKind)
    )
      kinds.add(candidate as SystemReferenceRuntimeKind);
  }
  if (kinds.size > 1) throw new Error("Reference runtime kinds conflict.");
  return mapLegacySystemReferenceRuntimeKind([...kinds][0] ?? "custom");
}

type DeploymentRevocationStatus = "clear" | "revoked" | "unavailable";

async function releaseRevocationStatus(
  d: SystemDeploymentUseCaseDependencies,
  release: SystemRelease,
): Promise<DeploymentRevocationStatus> {
  try {
    const releaseIds = release.lock.resolvedImplementations.map((item) =>
      normalizeAssetImplementationReleaseId(item.releaseId),
    );
    const revoked = await d.revocations.listRevokedImplementationReleaseIds(
      release.targetWorkspaceId,
      releaseIds,
    );
    return revoked.length > 0 ? "revoked" : "clear";
  } catch {
    return "unavailable";
  }
}

async function enforceDeploymentRevocation(
  d: SystemDeploymentUseCaseDependencies,
  deployment: SystemDeployment,
  actorId: string,
): Promise<DeploymentRevocationStatus> {
  const release = await d.builds.readRelease(
    deployment.workspaceId,
    deployment.releaseId,
  );
  if (!release || release.releaseDigest !== deployment.releaseDigest)
    return "unavailable";
  const status = await releaseRevocationStatus(d, release);
  if (status !== "revoked") return status;
  if (["active", "activating", "degraded"].includes(deployment.status)) {
    try {
      await d.runtime.deactivate(deployment);
    } catch {
      // New starts remain denied even when runtime cleanup requires operator
      // follow-up. Do not expose adapter diagnostics through this boundary.
    }
    try {
      await d.runtimeInstances.stop(await readRuntimeInstance(d, deployment));
    } catch {
      // Revocation remains fail-closed even when data-plane cleanup needs
      // operator reconciliation.
    }
  }
  const occurredAt = d.now?.() ?? new Date().toISOString();
  try {
    const revoked =
      deployment.status === "revoked"
        ? deployment
        : await d.repository.updateDeployment(
            {
              ...deployment,
              status: "revoked",
              revision: deployment.revision + 1,
              health: {
                status: "stopped",
                checkedAt: occurredAt,
                diagnostics: [
                  {
                    severity: "error",
                    code: "deployment.release.revoked",
                    message:
                      "A frozen implementation release was revoked after deployment.",
                  },
                ],
              },
              revokedAt: occurredAt,
              revokedBy: safeActor(actorId),
              updatedAt: occurredAt,
            },
            deployment.revision,
          );
    await d.repository.appendAudit(
      auditEntry(
        d,
        revoked,
        "revoke",
        "allowed",
        actorId,
        "deployment.release.revoked",
      ),
    );
  } catch {
    // Revocation truth still denies execution. Persistence/audit recovery is an
    // explicit operator incident rather than permission to start the runtime.
  }
  return "revoked";
}

function revocationFailure<T>(
  status: Exclude<DeploymentRevocationStatus, "clear">,
  context: string,
): SystemDeploymentResult<T> {
  return systemDeploymentFailure(
    status === "revoked"
      ? "deployment.release.revoked"
      : "deployment.revocation.unavailable",
    status === "revoked"
      ? `${context} A frozen implementation is revoked.`
      : `${context} Revocation status could not be verified safely.`,
  );
}

async function readRuntimeInstance(
  d: Pick<SystemDeploymentUseCaseDependencies, "runtimeInstanceRepository">,
  deployment: SystemDeployment,
): Promise<SystemRuntimeInstance> {
  if (!deployment.runtimeInstanceId) {
    throw new Error(
      "The deployment does not have an isolated runtime data allocation.",
    );
  }
  const instance =
    await d.runtimeInstanceRepository.readRuntimeInstanceByDeployment(
      deployment.organizationId,
      deployment.workspaceId,
      deployment.deploymentId,
    );
  if (
    !instance ||
    instance.runtimeInstanceId !== deployment.runtimeInstanceId ||
    !isSystemRuntimeInstanceBoundToDeployment(
      instance,
      deployment.deploymentId,
      deployment.releaseId,
    ) ||
    instance.status === "deleted"
  ) {
    throw new Error("The deployment runtime data allocation is unavailable.");
  }
  return instance;
}

async function readOptionalRuntimeInstance(
  d: Pick<SystemDeploymentUseCaseDependencies, "runtimeInstanceRepository">,
  deployment: SystemDeployment,
): Promise<SystemRuntimeInstance | undefined> {
  if (deployment.runtimeInstanceId) return readRuntimeInstance(d, deployment);
  const instance =
    await d.runtimeInstanceRepository.readRuntimeInstanceByDeployment(
      deployment.organizationId,
      deployment.workspaceId,
      deployment.deploymentId,
    );
  if (!instance) return undefined;
  if (
    !isSystemRuntimeInstanceBoundToDeployment(
      instance,
      deployment.deploymentId,
      deployment.releaseId,
    ) ||
    instance.status === "deleted"
  )
    throw new Error("The deployment runtime data allocation is unavailable.");
  return instance;
}

function readDeployment(
  repository: SystemDeploymentRepositoryPort,
  context: Pick<
    ReadSystemDeploymentQuery,
    "organizationId" | "workspaceId" | "deploymentId"
  >,
) {
  return repository.readDeployment(
    context.organizationId,
    context.workspaceId,
    context.deploymentId,
  );
}

function auditEntry(
  d: SystemDeploymentUseCaseDependencies,
  deployment: SystemDeployment,
  action: SystemDeploymentAuditEntry["action"],
  outcome: SystemDeploymentAuditEntry["outcome"],
  actorId: string,
  reasonCode: string,
): SystemDeploymentAuditEntry {
  return {
    auditId: d.generateAuditId() as SystemDeploymentAuditEntry["auditId"],
    organizationId: deployment.organizationId,
    workspaceId: deployment.workspaceId,
    deploymentId: deployment.deploymentId,
    action,
    outcome,
    actorId: safeActor(actorId),
    reasonCode,
    occurredAt: d.now?.() ?? new Date().toISOString(),
  };
}

const safeActor = (value: string) => value.trim().slice(0, 160) || "unknown";
const hasErrors = (diagnostics: readonly SystemDeploymentDiagnostic[]) =>
  diagnostics.some((item) => item.severity === "error");
