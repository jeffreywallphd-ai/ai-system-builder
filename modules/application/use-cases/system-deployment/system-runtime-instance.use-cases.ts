import type {
  AllocateSystemRuntimeInstanceRequest,
  SystemRuntimeDatabaseLifecyclePort,
  SystemRuntimeInstanceLifecyclePort,
  SystemRuntimeInstanceRepositoryPort,
} from "../../ports/system-deployment";
import {
  normalizeSystemRuntimeDeploymentBindings,
  type SystemRuntimeDeploymentBinding,
  type SystemRuntimeDatabaseBackup,
  type SystemRuntimeInstance,
  type SystemRuntimeInstanceDeletionConfirmation,
} from "../../../contracts/system-deployment";

export interface SystemRuntimeInstanceUseCaseDependencies {
  readonly repository: SystemRuntimeInstanceRepositoryPort;
  readonly databases: SystemRuntimeDatabaseLifecyclePort;
  readonly now?: () => string;
}

export class SystemRuntimeInstanceLifecycleService
  implements SystemRuntimeInstanceLifecyclePort
{
  private readonly now: () => string;

  public constructor(private readonly d: SystemRuntimeInstanceUseCaseDependencies) {
    this.now = d.now ?? (() => new Date().toISOString());
  }

  async allocate(
    request: AllocateSystemRuntimeInstanceRequest,
  ): Promise<SystemRuntimeInstance> {
    const existing = await this.d.repository.readRuntimeInstanceByDeployment(
      request.organizationId,
      request.workspaceId,
      request.deploymentId,
    );
    if (existing) {
      if (
        existing.runtimeInstanceId !== request.runtimeInstanceId ||
        existing.releaseId !== request.releaseId ||
        existing.status === "deleted"
      ) {
        throw safeError(
          "runtime-instance.allocation-conflict",
          "The deployment already has a different runtime data allocation.",
        );
      }
      return existing;
    }

    const createdAt = this.now();
    let provisioned;
    try {
      provisioned = await this.d.databases.provision(request);
    } catch {
      throw safeError(
        "runtime-instance.provision-failed",
        "The runtime database could not be provisioned safely.",
      );
    }
    const instance: SystemRuntimeInstance = {
      ...request,
      dataBindingId: provisioned.dataBindingId,
      databaseEngine: provisioned.databaseEngine,
      status: "allocated",
      revision: 0,
      createdAt,
      updatedAt: createdAt,
      deploymentBindings: [
        {
          deploymentId: request.deploymentId,
          releaseId: request.releaseId,
          boundAt: createdAt,
        },
      ],
    };
    try {
      return await this.d.repository.createRuntimeInstance(instance);
    } catch {
      // The physical database remains isolated for explicit reconciliation.
      throw safeError(
        "runtime-instance.control-plane-failed",
        "The runtime database allocation could not be recorded safely.",
      );
    }
  }

  async activate(instance: SystemRuntimeInstance): Promise<SystemRuntimeInstance> {
    assertMutable(instance);
    let health;
    try {
      health = await this.d.databases.open(instance);
    } catch {
      throw safeError(
        "runtime-instance.open-failed",
        "The runtime database could not be opened safely.",
      );
    }
    if (!health.healthy) {
      throw safeError(
        health.diagnosticCode ?? "runtime-instance.not-ready",
        "The runtime database is not ready.",
      );
    }
    return this.transition(instance, {
      status: "active",
      activatedAt: this.now(),
    });
  }

  async migrate(
    instance: SystemRuntimeInstance,
    binding: Omit<SystemRuntimeDeploymentBinding, "boundAt">,
  ): Promise<SystemRuntimeInstance> {
    assertMutable(instance);
    if (instance.status !== "stopped") {
      throw safeError(
        "runtime-instance.migration-conflict",
        "Stop the runtime before migrating its deployment binding.",
      );
    }
    const bindings = normalizeSystemRuntimeDeploymentBindings(instance);
    const existing = bindings.find(
      (candidate) => candidate.deploymentId === binding.deploymentId,
    );
    if (existing) {
      if (existing.releaseId !== binding.releaseId) {
        throw safeError(
          "runtime-instance.migration-binding-conflict",
          "The deployment already has a different runtime release binding.",
        );
      }
      return instance;
    }
    let health;
    try {
      health = await this.d.databases.migrate(instance);
    } catch {
      throw safeError(
        "runtime-instance.migration-failed",
        "The runtime database migration failed safely.",
      );
    }
    if (!health.healthy) {
      throw safeError(
        health.diagnosticCode ?? "runtime-instance.migration-invalid",
        "The migrated runtime database is not ready.",
      );
    }
    return this.d.repository.bindRuntimeInstanceDeployment(
      instance,
      { ...binding, boundAt: this.now() },
      instance.revision,
    );
  }

  async stop(instance: SystemRuntimeInstance): Promise<SystemRuntimeInstance> {
    assertMutable(instance);
    try {
      await this.d.databases.close(instance);
    } catch {
      throw safeError(
        "runtime-instance.close-failed",
        "The runtime database could not be closed safely.",
      );
    }
    return this.transition(instance, {
      status: "stopped",
      stoppedAt: this.now(),
    });
  }

  async retain(instance: SystemRuntimeInstance): Promise<SystemRuntimeInstance> {
    assertMutable(instance);
    try {
      await this.d.databases.close(instance);
      await this.d.databases.retain(instance);
    } catch {
      throw safeError(
        "runtime-instance.retain-failed",
        "The runtime database could not be retained safely.",
      );
    }
    return this.transition(instance, {
      status: "retained",
      retainedAt: this.now(),
    });
  }

  async backup(instance: SystemRuntimeInstance): Promise<SystemRuntimeDatabaseBackup> {
    assertMutable(instance);
    try {
      return await this.d.databases.createBackup(instance);
    } catch {
      throw safeError(
        "runtime-instance.backup-failed",
        "The runtime database backup could not be created safely.",
      );
    }
  }

  async restore(
    instance: SystemRuntimeInstance,
    backupId: string,
  ): Promise<SystemRuntimeInstance> {
    assertMutable(instance);
    if (instance.status === "active") {
      throw safeError(
        "runtime-instance.restore-active",
        "Stop the runtime before restoring its database.",
      );
    }
    let health;
    try {
      health = await this.d.databases.restoreBackup(instance, backupId);
    } catch {
      throw safeError(
        "runtime-instance.restore-failed",
        "The runtime database backup could not be restored safely.",
      );
    }
    if (!health.healthy) {
      throw safeError(
        health.diagnosticCode ?? "runtime-instance.restore-invalid",
        "The restored runtime database is not ready.",
      );
    }
    return this.transition(instance, { status: "stopped" });
  }

  async deleteRetained(
    instance: SystemRuntimeInstance,
    confirmation: SystemRuntimeInstanceDeletionConfirmation,
  ): Promise<SystemRuntimeInstance> {
    if (instance.status !== "retained") {
      throw safeError(
        "runtime-instance.delete-conflict",
        "Only retained runtime data can be deleted.",
      );
    }
    if (
      confirmation.runtimeInstanceId !== instance.runtimeInstanceId ||
      confirmation.confirmation !== "delete-retained-runtime-data"
    ) {
      throw safeError(
        "runtime-instance.delete-confirmation",
        "Exact runtime data deletion confirmation is required.",
      );
    }
    const deleting = await this.transition(instance, { status: "deleting" });
    try {
      await this.d.databases.deleteRetained(deleting, confirmation);
    } catch {
      await this.transition(deleting, {
        status: "failed",
        failureCode: "runtime-instance.delete-failed",
      }).catch(() => undefined);
      throw safeError(
        "runtime-instance.delete-failed",
        "The retained runtime database was not deleted.",
      );
    }
    return this.transition(deleting, {
      status: "deleted",
      deletedAt: this.now(),
    });
  }

  private transition(
    instance: SystemRuntimeInstance,
    change: Partial<SystemRuntimeInstance>,
  ): Promise<SystemRuntimeInstance> {
    return this.d.repository.updateRuntimeInstance(
      {
        ...instance,
        ...change,
        runtimeInstanceId: instance.runtimeInstanceId,
        dataBindingId: instance.dataBindingId,
        databaseEngine: instance.databaseEngine,
        organizationId: instance.organizationId,
        workspaceId: instance.workspaceId,
        deploymentId: instance.deploymentId,
        releaseId: instance.releaseId,
        revision: instance.revision + 1,
        updatedAt: this.now(),
      },
      instance.revision,
    );
  }
}

function assertMutable(instance: SystemRuntimeInstance): void {
  if (instance.status === "deleted" || instance.status === "deleting") {
    throw safeError(
      "runtime-instance.lifecycle-conflict",
      "The runtime data lifecycle cannot continue from its current state.",
    );
  }
}

function safeError(code: string, message: string): Error & { code: string } {
  const error = new Error(message) as Error & { code: string };
  error.name = "SystemRuntimeInstanceError";
  error.code = code;
  error.stack = undefined;
  return error;
}
