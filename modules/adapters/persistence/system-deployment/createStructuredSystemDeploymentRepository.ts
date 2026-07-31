import type { SystemDeploymentRepositoryPort } from "../../../application/ports/system-deployment";
import {
  normalizeSystemDeploymentRuntimeIdentity,
  resolveSystemDeploymentHostTargetId,
  type SystemDeployment,
  type SystemDeploymentId,
  type SystemDeploymentRun,
} from "../../../contracts/system-deployment";
import {
  StructuredDocumentConflictError,
  cloneStructuredJson,
  type StructuredDocumentStore,
} from "../shared";

const DEPLOYMENTS = "system-deployment/deployments";
const CURRENT_DEPLOYMENTS = "system-deployment/current-deployments";
const RUNS = "system-deployment/runs";
const AUDIT = "system-deployment/audit";

export function createStructuredSystemDeploymentRepository(
  documents: StructuredDocumentStore,
): SystemDeploymentRepositoryPort {
  return {
    async createDeployment(deployment) {
      const normalized = normalizeSystemDeploymentRuntimeIdentity(deployment);
      const key = deploymentKey(normalized);
      if (await documents.readDocument(DEPLOYMENTS, key))
        throw new StructuredDocumentConflictError(DEPLOYMENTS, key, 0);
      await documents.writeDocument(
        DEPLOYMENTS,
        key,
        cloneStructuredJson(normalized),
        { expectedRevision: 0 },
      );
      return cloneStructuredJson(normalized);
    },
    async readDeployment(organizationId, workspaceId, deploymentId) {
      const value = (
        await documents.readDocument<SystemDeployment>(
          DEPLOYMENTS,
          `${organizationId}/${workspaceId}/${deploymentId}`,
        )
      )?.value;
      return value?.organizationId === organizationId &&
        value.workspaceId === workspaceId
        ? cloneStructuredJson(normalizeSystemDeploymentRuntimeIdentity(value))
        : undefined;
    },
    async listDeployments(organizationId, workspaceId, releaseId) {
      return (await documents.listDocuments<SystemDeployment>(DEPLOYMENTS))
        .map((entry) => normalizeSystemDeploymentRuntimeIdentity(entry.value))
        .filter(
          (entry) =>
            entry.organizationId === organizationId &&
            entry.workspaceId === workspaceId &&
            (!releaseId || entry.releaseId === releaseId),
        )
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
        .map(cloneStructuredJson);
    },
    async readCurrentDeployment(
      organizationId,
      workspaceId,
      releaseId,
      hostTargetId,
    ) {
      const key = currentDeploymentKey(
        organizationId,
        workspaceId,
        String(releaseId),
        hostTargetId,
      );
      const pointer = (
        await documents.readDocument<CurrentDeploymentPointer>(
          CURRENT_DEPLOYMENTS,
          key,
        )
      )?.value;
      if (pointer) {
        const current = await this.readDeployment(
          organizationId,
          workspaceId,
          pointer.deploymentId,
        );
        if (
          current &&
          current.releaseId === releaseId &&
          resolveSystemDeploymentHostTargetId(current) === hostTargetId &&
          !["uninstalled", "revoked"].includes(current.status)
        )
          return current;
      }
      const compatible = (
        await this.listDeployments(organizationId, workspaceId, releaseId)
      ).find(
        (entry) =>
          resolveSystemDeploymentHostTargetId(entry) === hostTargetId &&
          !["uninstalled", "revoked"].includes(entry.status),
      );
      return compatible ? cloneStructuredJson(compatible) : undefined;
    },
    async createCurrentDeployment(deployment) {
      const normalized = normalizeSystemDeploymentRuntimeIdentity(deployment);
      const target = resolveSystemDeploymentHostTargetId(normalized);
      const deploymentDocumentKey = deploymentKey(normalized);
      const pointerKey = currentDeploymentKey(
        normalized.organizationId,
        normalized.workspaceId,
        String(normalized.releaseId),
        target,
      );
      return documents.runInTransaction(async (transaction) => {
        if (
          (await transaction.readDocument(DEPLOYMENTS, deploymentDocumentKey)) ||
          (await transaction.readDocument(CURRENT_DEPLOYMENTS, pointerKey))
        )
          throw new StructuredDocumentConflictError(
            CURRENT_DEPLOYMENTS,
            pointerKey,
            0,
          );
        await transaction.writeDocument(
          DEPLOYMENTS,
          deploymentDocumentKey,
          cloneStructuredJson(normalized),
          { expectedRevision: 0 },
        );
        await transaction.writeDocument<CurrentDeploymentPointer>(
          CURRENT_DEPLOYMENTS,
          pointerKey,
          {
            organizationId: normalized.organizationId,
            workspaceId: normalized.workspaceId,
            releaseId: normalized.releaseId,
            hostTargetId: target,
            deploymentId: normalized.deploymentId,
          },
          { expectedRevision: 0 },
        );
        return cloneStructuredJson(normalized);
      });
    },
    async updateDeployment(deployment, expectedRevision) {
      const normalized = normalizeSystemDeploymentRuntimeIdentity(deployment);
      const key = deploymentKey(normalized);
      return documents.runInTransaction(async (transaction) => {
        const current = await transaction.readDocument<SystemDeployment>(
          DEPLOYMENTS,
          key,
        );
        if (
          !current ||
          current.value.revision !== expectedRevision ||
          normalized.revision !== expectedRevision + 1
        )
          throw new StructuredDocumentConflictError(
            DEPLOYMENTS,
            key,
            expectedRevision,
          );
        await transaction.writeDocument(
          DEPLOYMENTS,
          key,
          cloneStructuredJson(normalized),
          { expectedRevision: current.revision },
        );
        return cloneStructuredJson(normalized);
      });
    },
    async retireCurrentDeployment(deployment, expectedRevision) {
      const normalized = normalizeSystemDeploymentRuntimeIdentity(deployment);
      const key = deploymentKey(normalized);
      const pointerKey = currentDeploymentKey(
        normalized.organizationId,
        normalized.workspaceId,
        String(normalized.releaseId),
        resolveSystemDeploymentHostTargetId(normalized),
      );
      return documents.runInTransaction(async (transaction) => {
        const current = await transaction.readDocument<SystemDeployment>(
          DEPLOYMENTS,
          key,
        );
        if (
          !current ||
          current.value.revision !== expectedRevision ||
          normalized.revision !== expectedRevision + 1
        )
          throw new StructuredDocumentConflictError(
            DEPLOYMENTS,
            key,
            expectedRevision,
          );
        await transaction.writeDocument(
          DEPLOYMENTS,
          key,
          cloneStructuredJson(normalized),
          { expectedRevision: current.revision },
        );
        const pointer = await transaction.readDocument<CurrentDeploymentPointer>(
          CURRENT_DEPLOYMENTS,
          pointerKey,
        );
        if (pointer?.value.deploymentId === normalized.deploymentId)
          await transaction.deleteDocument(
            CURRENT_DEPLOYMENTS,
            pointerKey,
            pointer.revision,
          );
        return cloneStructuredJson(normalized);
      });
    },
    async createRun(run) {
      const key = runKey(run);
      if (await documents.readDocument(RUNS, key))
        throw new StructuredDocumentConflictError(RUNS, key, 0);
      await documents.writeDocument(RUNS, key, cloneStructuredJson(run), {
        expectedRevision: 0,
      });
      return cloneStructuredJson(run);
    },
    async readRun(organizationId, workspaceId, runId) {
      const value = (
        await documents.readDocument<SystemDeploymentRun>(
          RUNS,
          `${organizationId}/${workspaceId}/${runId}`,
        )
      )?.value;
      return value?.organizationId === organizationId &&
        value.workspaceId === workspaceId
        ? cloneStructuredJson(value)
        : undefined;
    },
    async listRuns(organizationId, workspaceId, deploymentId) {
      return (await documents.listDocuments<SystemDeploymentRun>(RUNS))
        .map((entry) => entry.value)
        .filter(
          (entry) =>
            entry.organizationId === organizationId &&
            entry.workspaceId === workspaceId &&
            (!deploymentId || entry.deploymentId === deploymentId),
        )
        .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
        .map(cloneStructuredJson);
    },
    async updateRun(run, expectedRevision) {
      const key = runKey(run);
      return documents.runInTransaction(async (transaction) => {
        const current = await transaction.readDocument<SystemDeploymentRun>(
          RUNS,
          key,
        );
        if (
          !current ||
          current.value.revision !== expectedRevision ||
          run.revision !== expectedRevision + 1
        )
          throw new StructuredDocumentConflictError(
            RUNS,
            key,
            expectedRevision,
          );
        await transaction.writeDocument(RUNS, key, cloneStructuredJson(run), {
          expectedRevision: current.revision,
        });
        return cloneStructuredJson(run);
      });
    },
    async appendAudit(entry) {
      const key = `${entry.organizationId}/${entry.workspaceId}/${entry.deploymentId}/${entry.occurredAt}/${entry.auditId}`;
      await documents.writeDocument(AUDIT, key, cloneStructuredJson(entry), {
        expectedRevision: 0,
      });
    },
    async listAudit(organizationId, workspaceId, deploymentId, limit) {
      return (await documents.listDocuments(AUDIT))
        .map((entry) => entry.value as any)
        .filter(
          (entry) =>
            entry.organizationId === organizationId &&
            entry.workspaceId === workspaceId &&
            entry.deploymentId === deploymentId,
        )
        .sort((left, right) => right.occurredAt.localeCompare(left.occurredAt))
        .slice(0, Math.max(1, Math.min(200, limit)))
        .map(cloneStructuredJson);
    },
  };
}

interface CurrentDeploymentPointer {
  readonly organizationId: SystemDeployment["organizationId"];
  readonly workspaceId: SystemDeployment["workspaceId"];
  readonly releaseId: SystemDeployment["releaseId"];
  readonly hostTargetId: string;
  readonly deploymentId: SystemDeploymentId;
}

const deploymentKey = (deployment: SystemDeployment) =>
  `${deployment.organizationId}/${deployment.workspaceId}/${deployment.deploymentId}`;
const runKey = (run: SystemDeploymentRun) =>
  `${run.organizationId}/${run.workspaceId}/${run.runId}`;
const currentDeploymentKey = (
  organizationId: string,
  workspaceId: string,
  releaseId: string,
  hostTargetId: string,
) => `${organizationId}/${workspaceId}/${releaseId}/${hostTargetId}`;
