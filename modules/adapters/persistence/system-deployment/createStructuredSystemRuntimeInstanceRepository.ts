import type { SystemRuntimeInstanceRepositoryPort } from "../../../application/ports/system-deployment";
import {
  normalizeSystemRuntimeDataBindingId,
  normalizeSystemRuntimeDeploymentBindings,
  normalizeSystemRuntimeInstanceId,
  type SystemRuntimeDeploymentBinding,
  type SystemRuntimeInstance,
} from "../../../contracts/system-deployment";
import {
  StructuredDocumentConflictError,
  cloneStructuredJson,
  type StructuredDocumentStore,
} from "../shared";

const INSTANCES = "system-runtime-instance/instances";
const BY_DEPLOYMENT = "system-runtime-instance/by-deployment";

export function createStructuredSystemRuntimeInstanceRepository(
  documents: StructuredDocumentStore,
): SystemRuntimeInstanceRepositoryPort {
  return {
    async createRuntimeInstance(instance) {
      const normalized = normalizeInstance(instance);
      const key = instanceKey(normalized);
      const pointerKey = deploymentKey(normalized);
      return documents.runInTransaction(async (transaction) => {
        if (
          (await transaction.readDocument(INSTANCES, key)) ||
          (await transaction.readDocument(BY_DEPLOYMENT, pointerKey))
        ) {
          throw new StructuredDocumentConflictError(BY_DEPLOYMENT, pointerKey, 0);
        }
        await transaction.writeDocument(INSTANCES, key, cloneStructuredJson(normalized), {
          expectedRevision: 0,
        });
        await transaction.writeDocument(
          BY_DEPLOYMENT,
          pointerKey,
          {
            organizationId: normalized.organizationId,
            workspaceId: normalized.workspaceId,
            deploymentId: normalized.deploymentId,
            runtimeInstanceId: normalized.runtimeInstanceId,
          },
          { expectedRevision: 0 },
        );
        return cloneStructuredJson(normalized);
      });
    },
    async readRuntimeInstance(organizationId, workspaceId, runtimeInstanceId) {
      const value = (
        await documents.readDocument<SystemRuntimeInstance>(
          INSTANCES,
          `${organizationId}/${workspaceId}/${runtimeInstanceId}`,
        )
      )?.value;
      return value?.organizationId === organizationId && value.workspaceId === workspaceId
        ? cloneStructuredJson(normalizeInstance(value))
        : undefined;
    },
    async readRuntimeInstanceByDeployment(organizationId, workspaceId, deploymentId) {
      const pointer = (
        await documents.readDocument<{
          organizationId: string;
          workspaceId: string;
          deploymentId: string;
          runtimeInstanceId: string;
        }>(BY_DEPLOYMENT, `${organizationId}/${workspaceId}/${deploymentId}`)
      )?.value;
      if (
        !pointer ||
        pointer.organizationId !== organizationId ||
        pointer.workspaceId !== workspaceId ||
        pointer.deploymentId !== deploymentId
      ) {
        return undefined;
      }
      return this.readRuntimeInstance(
        organizationId,
        workspaceId,
        normalizeSystemRuntimeInstanceId(pointer.runtimeInstanceId),
      );
    },
    async listRuntimeInstances(organizationId, workspaceId) {
      return (await documents.listDocuments<SystemRuntimeInstance>(INSTANCES))
        .map((item) => normalizeInstance(item.value))
        .filter(
          (item) => item.organizationId === organizationId && item.workspaceId === workspaceId,
        )
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
        .map(cloneStructuredJson);
    },
    async updateRuntimeInstance(instance, expectedRevision) {
      const normalized = normalizeInstance(instance);
      const key = instanceKey(normalized);
      return documents.runInTransaction(async (transaction) => {
        const current = await transaction.readDocument<SystemRuntimeInstance>(INSTANCES, key);
        if (
          !current ||
          current.value.revision !== expectedRevision ||
          normalized.revision !== expectedRevision + 1
        ) {
          throw new StructuredDocumentConflictError(INSTANCES, key, expectedRevision);
        }
        await transaction.writeDocument(INSTANCES, key, cloneStructuredJson(normalized), {
          expectedRevision: current.revision,
        });
        return cloneStructuredJson(normalized);
      });
    },
    async bindRuntimeInstanceDeployment(instance, binding, expectedRevision) {
      const normalized = normalizeInstance(instance);
      const normalizedBinding = normalizeBinding(binding);
      const key = instanceKey(normalized);
      const pointerKey = `${normalized.organizationId}/${normalized.workspaceId}/${normalizedBinding.deploymentId}`;
      return documents.runInTransaction(async (transaction) => {
        const current = await transaction.readDocument<SystemRuntimeInstance>(
          INSTANCES,
          key,
        );
        const pointer = await transaction.readDocument<{
          runtimeInstanceId: string;
        }>(BY_DEPLOYMENT, pointerKey);
        if (
          !current ||
          current.value.revision !== expectedRevision ||
          (pointer && pointer.value.runtimeInstanceId !== normalized.runtimeInstanceId)
        ) {
          throw new StructuredDocumentConflictError(
            BY_DEPLOYMENT,
            pointerKey,
            expectedRevision,
          );
        }
        const next = normalizeInstance({
          ...normalized,
          deploymentBindings: [
            ...normalizeSystemRuntimeDeploymentBindings(normalized),
            normalizedBinding,
          ],
          revision: expectedRevision + 1,
          updatedAt: normalizedBinding.boundAt,
        });
        await transaction.writeDocument(
          INSTANCES,
          key,
          cloneStructuredJson(next),
          { expectedRevision: current.revision },
        );
        if (!pointer) {
          await transaction.writeDocument(
            BY_DEPLOYMENT,
            pointerKey,
            {
              organizationId: normalized.organizationId,
              workspaceId: normalized.workspaceId,
              deploymentId: normalizedBinding.deploymentId,
              runtimeInstanceId: normalized.runtimeInstanceId,
            },
            { expectedRevision: 0 },
          );
        }
        return cloneStructuredJson(next);
      });
    },
  };
}

function normalizeInstance(instance: SystemRuntimeInstance): SystemRuntimeInstance {
  return {
    ...instance,
    runtimeInstanceId: normalizeSystemRuntimeInstanceId(instance.runtimeInstanceId),
    dataBindingId: normalizeSystemRuntimeDataBindingId(instance.dataBindingId),
    deploymentBindings: normalizeSystemRuntimeDeploymentBindings(instance),
  };
}

function normalizeBinding(
  binding: SystemRuntimeDeploymentBinding,
): SystemRuntimeDeploymentBinding {
  return normalizeSystemRuntimeDeploymentBindings({
    deploymentId: binding.deploymentId,
    releaseId: binding.releaseId,
    createdAt: binding.boundAt,
    deploymentBindings: [binding],
  })[0]!;
}

const instanceKey = (instance: SystemRuntimeInstance) =>
  `${instance.organizationId}/${instance.workspaceId}/${instance.runtimeInstanceId}`;

const deploymentKey = (instance: SystemRuntimeInstance) =>
  `${instance.organizationId}/${instance.workspaceId}/${instance.deploymentId}`;
