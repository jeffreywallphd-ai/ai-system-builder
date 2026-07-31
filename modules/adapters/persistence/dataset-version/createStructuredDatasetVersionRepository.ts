import type { DatasetVersionRepositoryPort } from "../../../application/ports/dataset-version";
import {
  normalizeDatasetId,
  normalizeDatasetVersionPublicationRecord,
  normalizeDatasetVersionRecord,
  type DatasetVersionId,
  type DatasetVersionPublicationId,
  type DatasetVersionPublicationRecord,
  type DatasetVersionRecord,
} from "../../../contracts/dataset";
import type { WorkspaceId } from "../../../contracts/workspace";
import {
  StructuredDocumentConflictError,
  cloneStructuredJson,
  type StructuredDocumentStore,
} from "../shared";

export const DATASET_VERSION_NAMESPACE = "dataset-version/versions";
export const DATASET_VERSION_PUBLICATION_NAMESPACE =
  "dataset-version/publications";

export function createStructuredDatasetVersionRepository(
  documents: StructuredDocumentStore,
): DatasetVersionRepositoryPort {
  return {
    async createVersion(input) {
      const version = normalizeDatasetVersionRecord(input);
      assertOrganizationScope(documents, version.organizationId);
      const key = versionKey(version.workspaceId, version.versionId);
      return documents.runInTransaction(async (transaction) => {
        const current = await transaction.readDocument<DatasetVersionRecord>(
          DATASET_VERSION_NAMESPACE,
          key,
        );
        if (current) {
          const existing = normalizeDatasetVersionRecord(current.value);
          if (stableStructuredJson(existing) === stableStructuredJson(version)) {
            return cloneStructuredJson(existing);
          }
          throw new StructuredDocumentConflictError(
            DATASET_VERSION_NAMESPACE,
            key,
            0,
          );
        }
        await transaction.writeDocument(
          DATASET_VERSION_NAMESPACE,
          key,
          cloneStructuredJson(version),
          { expectedRevision: 0 },
        );
        return cloneStructuredJson(version);
      });
    },

    async readVersion(workspaceId, versionId) {
      const value = (
        await documents.readDocument<DatasetVersionRecord>(
          DATASET_VERSION_NAMESPACE,
          versionKey(workspaceId, versionId),
        )
      )?.value;
      if (!value) return undefined;
      const version = normalizeDatasetVersionRecord(value);
      assertOrganizationScope(documents, version.organizationId);
      return version.workspaceId === workspaceId
        ? cloneStructuredJson(version)
        : undefined;
    },

    async listVersions(workspaceId, datasetId) {
      const normalizedDatasetId = datasetId
        ? normalizeDatasetId(datasetId)
        : undefined;
      const versions = (
        await documents.listDocuments<DatasetVersionRecord>(
          DATASET_VERSION_NAMESPACE,
        )
      ).map((item) => normalizeDatasetVersionRecord(item.value));
      versions.forEach((version) =>
        assertOrganizationScope(documents, version.organizationId),
      );
      return versions
        .filter(
          (version) =>
            version.workspaceId === workspaceId &&
            (!normalizedDatasetId || version.datasetId === normalizedDatasetId),
        )
        .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
        .map(cloneStructuredJson);
    },

    async recordPublication(input) {
      const publication = normalizeDatasetVersionPublicationRecord(input);
      assertOrganizationScope(documents, publication.organizationId);
      const key = publicationKey(
        publication.workspaceId,
        publication.publicationId,
      );
      return documents.runInTransaction(async (transaction) => {
        const version = await transaction.readDocument<DatasetVersionRecord>(
          DATASET_VERSION_NAMESPACE,
          versionKey(publication.workspaceId, publication.versionId),
        );
        if (!version) {
          throw new Error("Dataset publication requires an existing dataset version.");
        }
        normalizeDatasetVersionRecord(version.value);
        const current =
          await transaction.readDocument<DatasetVersionPublicationRecord>(
            DATASET_VERSION_PUBLICATION_NAMESPACE,
            key,
          );
        if (current) {
          const existing = normalizeDatasetVersionPublicationRecord(current.value);
          if (stableStructuredJson(existing) === stableStructuredJson(publication)) {
            return cloneStructuredJson(existing);
          }
          throw new StructuredDocumentConflictError(
            DATASET_VERSION_PUBLICATION_NAMESPACE,
            key,
            0,
          );
        }
        await transaction.writeDocument(
          DATASET_VERSION_PUBLICATION_NAMESPACE,
          key,
          cloneStructuredJson(publication),
          { expectedRevision: 0 },
        );
        return cloneStructuredJson(publication);
      });
    },

    async readPublication(workspaceId, publicationId) {
      const value = (
        await documents.readDocument<DatasetVersionPublicationRecord>(
          DATASET_VERSION_PUBLICATION_NAMESPACE,
          publicationKey(workspaceId, publicationId),
        )
      )?.value;
      if (!value) return undefined;
      const publication = normalizeDatasetVersionPublicationRecord(value);
      assertOrganizationScope(documents, publication.organizationId);
      return publication.workspaceId === workspaceId
        ? cloneStructuredJson(publication)
        : undefined;
    },

    async listPublications(workspaceId, versionId) {
      const publications = (
        await documents.listDocuments<DatasetVersionPublicationRecord>(
          DATASET_VERSION_PUBLICATION_NAMESPACE,
        )
      ).map((item) => normalizeDatasetVersionPublicationRecord(item.value));
      publications.forEach((publication) =>
        assertOrganizationScope(documents, publication.organizationId),
      );
      return publications
        .filter(
          (publication) =>
            publication.workspaceId === workspaceId &&
            (!versionId || publication.versionId === versionId),
        )
        .sort((left, right) =>
          right.publishedAt.localeCompare(left.publishedAt),
        )
        .map(cloneStructuredJson);
    },
  };
}

const versionKey = (workspaceId: WorkspaceId, versionId: DatasetVersionId) =>
  `${workspaceId}/${versionId}`;
const publicationKey = (
  workspaceId: WorkspaceId,
  publicationId: DatasetVersionPublicationId,
) => `${workspaceId}/${publicationId}`;

function assertOrganizationScope(
  documents: StructuredDocumentStore,
  organizationId: DatasetVersionRecord["organizationId"],
): void {
  if (documents.organizationId !== organizationId) {
    throw new Error(
      "Dataset version organization must match the repository organization scope.",
    );
  }
}

function stableStructuredJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map(stableStructuredJson).join(",")}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, entry]) => entry !== undefined)
    .sort(([left], [right]) => left.localeCompare(right));
  return `{${entries
    .map(
      ([key, entry]) =>
        `${JSON.stringify(key)}:${stableStructuredJson(entry)}`,
    )
    .join(",")}}`;
}
