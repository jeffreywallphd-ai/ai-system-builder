import type { SystemBuildRepositoryPort } from "../../../application/ports/system-build";
import type { SystemBuildId, SystemBuildRecord, SystemRelease, SystemReleaseId } from "../../../contracts/system-build";
import type { WorkspaceId } from "../../../contracts/workspace";
import { StructuredDocumentConflictError, cloneStructuredJson, type StructuredDocumentStore } from "../shared";

const BUILD_NAMESPACE = "system-build/builds";
const RELEASE_NAMESPACE = "system-build/releases";

export function createStructuredSystemBuildRepository(documents: StructuredDocumentStore): SystemBuildRepositoryPort {
  return {
    async createBuild(build) {
      const key = buildKey(build.targetWorkspaceId, build.buildId);
      if (await documents.readDocument(BUILD_NAMESPACE, key)) throw new StructuredDocumentConflictError(BUILD_NAMESPACE, key, 0);
      await documents.writeDocument(BUILD_NAMESPACE, key, cloneStructuredJson(build), { expectedRevision: 0 });
      return cloneStructuredJson(build);
    },
    async readBuild(workspaceId, buildId) {
      const value = (await documents.readDocument<SystemBuildRecord>(BUILD_NAMESPACE, buildKey(workspaceId, buildId)))?.value;
      return value?.targetWorkspaceId === workspaceId ? cloneStructuredJson(value) : undefined;
    },
    async listBuilds(workspaceId, systemId) {
      return (await documents.listDocuments<SystemBuildRecord>(BUILD_NAMESPACE)).map((item) => item.value)
        .filter((item) => item.targetWorkspaceId === workspaceId && (!systemId || item.systemId === systemId))
        .sort((left, right) => right.createdAt.localeCompare(left.createdAt)).map(cloneStructuredJson);
    },
    async updateBuild(build, expectedRevision) {
      const key = buildKey(build.targetWorkspaceId, build.buildId);
      return documents.runInTransaction(async (transaction) => {
        const current = await transaction.readDocument<SystemBuildRecord>(BUILD_NAMESPACE, key);
        if (!current || current.value.revision !== expectedRevision || build.revision !== expectedRevision + 1) throw new StructuredDocumentConflictError(BUILD_NAMESPACE, key, expectedRevision);
        await transaction.writeDocument(BUILD_NAMESPACE, key, cloneStructuredJson(build), { expectedRevision: current.revision });
        return cloneStructuredJson(build);
      });
    },
    async saveRelease(release) {
      const key = releaseKey(release.targetWorkspaceId, release.releaseId);
      const current = await documents.readDocument<SystemRelease>(RELEASE_NAMESPACE, key);
      if (current) {
        if (stableStructuredJson(current.value) === stableStructuredJson(release)) return cloneStructuredJson(release);
        throw new StructuredDocumentConflictError(RELEASE_NAMESPACE, key, 0);
      }
      await documents.writeDocument(RELEASE_NAMESPACE, key, cloneStructuredJson(release), { expectedRevision: 0 });
      return cloneStructuredJson(release);
    },
    async readRelease(workspaceId, releaseId) {
      const value = (await documents.readDocument<SystemRelease>(RELEASE_NAMESPACE, releaseKey(workspaceId, releaseId)))?.value;
      return value?.targetWorkspaceId === workspaceId ? cloneStructuredJson(value) : undefined;
    },
    async listReleases(workspaceId, systemId) {
      return (await documents.listDocuments<SystemRelease>(RELEASE_NAMESPACE)).map((item) => item.value)
        .filter((item) => item.targetWorkspaceId === workspaceId && (!systemId || item.systemId === systemId))
        .sort((left, right) => right.createdAt.localeCompare(left.createdAt)).map(cloneStructuredJson);
    },
  };
}

const buildKey = (workspaceId: WorkspaceId, buildId: SystemBuildId) => `${workspaceId}/${buildId}`;
const releaseKey = (workspaceId: WorkspaceId, releaseId: SystemReleaseId) => `${workspaceId}/${releaseId}`;

function stableStructuredJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStructuredJson).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, entry]) => entry !== undefined)
    .sort(([left], [right]) => left.localeCompare(right));
  return `{${entries
    .map(([key, entry]) => `${JSON.stringify(key)}:${stableStructuredJson(entry)}`)
    .join(",")}}`;
}
