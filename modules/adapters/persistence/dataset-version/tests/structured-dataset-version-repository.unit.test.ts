import { describe, expect, it } from "../../../../testing/node-test";
import {
  createOrganizationId,
} from "../../../../contracts/organization";
import type {
  DatasetVersionPublicationRecord,
  DatasetVersionRecord,
} from "../../../../contracts/dataset";
import { createWorkspaceId } from "../../../../contracts/workspace";
import { createInMemoryStructuredDocumentStore } from "../../shared";
import {
  DATASET_VERSION_NAMESPACE,
  createStructuredDatasetVersionRepository,
} from "../createStructuredDatasetVersionRepository";

const digest = (character: string) =>
  `sha256:${character.repeat(64)}` as const;

function version(
  workspace = "workspace-a",
  versionId = "orders-v1",
  organizationId?: string,
): DatasetVersionRecord {
  return {
    schemaVersion: "1.0",
    versionId: versionId as DatasetVersionRecord["versionId"],
    datasetId: "orders" as DatasetVersionRecord["datasetId"],
    ...(organizationId
      ? { organizationId: createOrganizationId(organizationId) }
      : {}),
    workspaceId: createWorkspaceId(workspace),
    versionDigest: digest("a"),
    artifacts: [
      {
        role: "dataset",
        artifactKey: "datasets/orders/data.jsonl",
        digest: digest("b"),
        mediaType: "application/jsonl",
        sizeBytes: 512,
        rowCount: 10,
      },
      {
        role: "recipe",
        artifactKey: "datasets/orders/recipe.json",
        digest: digest("c"),
        mediaType: "application/json",
        sizeBytes: 64,
      },
    ],
    lineage: {
      sources: [
        {
          artifactKey: "sources/orders.csv",
          digest: digest("d"),
          mediaType: "text/csv",
        },
      ],
      recipe: {
        artifactKey: "datasets/orders/recipe.json",
        digest: digest("c"),
        implementationId: "builtin.dataset-preparation",
        implementationVersion: "1.0.0",
      },
      split: { strategy: "random", seed: 42 },
      quality: {
        policyId: "recommended",
        policyVersion: "1.0.0",
        policyFingerprint: digest("e"),
        reportFingerprint: digest("f"),
      },
    },
    documentation: {
      name: "Orders",
      summary: "Curated orders for training.",
      intendedUses: ["Train order classification models."],
      limitations: ["Does not include refunded orders."],
      license: "apache-2.0",
      languages: ["en"],
    },
    totalRows: 10,
    createdAt: "2026-07-29T12:00:00.000Z",
    createdBy: "person-1",
  };
}

function publication(
  organizationId?: string,
): DatasetVersionPublicationRecord {
  return {
    schemaVersion: "1.0",
    publicationId:
      "orders-v1-hf" as DatasetVersionPublicationRecord["publicationId"],
    versionId: "orders-v1" as DatasetVersionPublicationRecord["versionId"],
    ...(organizationId
      ? { organizationId: createOrganizationId(organizationId) }
      : {}),
    workspaceId: createWorkspaceId("workspace-a"),
    provider: "hugging-face",
    repositoryId: "example/orders",
    revision: "0123456789abcdef",
    visibility: "private",
    publishedAt: "2026-07-29T13:00:00.000Z",
    publishedBy: "person-1",
  };
}

describe("structured dataset version repository", () => {
  it("keeps complete versions immutable and permits identical retries", async () => {
    const repository = createStructuredDatasetVersionRepository(
      createInMemoryStructuredDocumentStore(),
    );
    const first = version();
    await expect(repository.createVersion(first)).resolves.toEqual(first);
    await expect(repository.createVersion(first)).resolves.toEqual(first);
    await expect(
      repository.createVersion({ ...first, totalRows: 11 }),
    ).rejects.toThrow("revision conflict");
  });

  it("isolates workspaces and organization-scoped repositories", async () => {
    const documents = createInMemoryStructuredDocumentStore();
    const organizationA = documents.forOrganization(
      createOrganizationId("organization-a"),
    );
    const repository = createStructuredDatasetVersionRepository(organizationA);
    await repository.createVersion(
      version("workspace-a", "orders-v1", "organization-a"),
    );
    expect(
      await repository.readVersion(
        createWorkspaceId("workspace-b"),
        "orders-v1" as DatasetVersionRecord["versionId"],
      ),
    ).toBeUndefined();
    expect(await repository.listVersions(createWorkspaceId("workspace-b"))).toEqual(
      [],
    );
    await expect(
      repository.createVersion(
        version("workspace-a", "orders-v2", "organization-b"),
      ),
    ).rejects.toThrow("organization scope");
    expect(
      await createStructuredDatasetVersionRepository(
        documents.forOrganization(createOrganizationId("organization-b")),
      ).listVersions(createWorkspaceId("workspace-a")),
    ).toEqual([]);
  });

  it("records publication only for an existing version and never mutates it", async () => {
    const repository = createStructuredDatasetVersionRepository(
      createInMemoryStructuredDocumentStore(),
    );
    await expect(repository.recordPublication(publication())).rejects.toThrow(
      "existing dataset version",
    );
    await repository.createVersion(version());
    await expect(repository.recordPublication(publication())).resolves.toEqual(
      publication(),
    );
    await expect(repository.recordPublication(publication())).resolves.toEqual(
      publication(),
    );
    await expect(
      repository.recordPublication({ ...publication(), revision: "different" }),
    ).rejects.toThrow("revision conflict");
    expect(
      await repository.listPublications(createWorkspaceId("workspace-a")),
    ).toEqual([publication()]);
    expect(
      await repository.readVersion(
        createWorkspaceId("workspace-a"),
        "orders-v1" as DatasetVersionRecord["versionId"],
      ),
    ).toEqual(version());
  });

  it("fails closed for malformed persisted version records", async () => {
    const documents = createInMemoryStructuredDocumentStore();
    await documents.writeDocument(
      DATASET_VERSION_NAMESPACE,
      "workspace-a/orders-v1",
      { ...version(), versionDigest: "not-a-digest" },
      { expectedRevision: 0 },
    );
    const repository = createStructuredDatasetVersionRepository(documents);
    await expect(
      repository.readVersion(
        createWorkspaceId("workspace-a"),
        "orders-v1" as DatasetVersionRecord["versionId"],
      ),
    ).rejects.toThrow("SHA-256");
  });

  it("serializes concurrent creates without allowing replacement", async () => {
    const repository = createStructuredDatasetVersionRepository(
      createInMemoryStructuredDocumentStore(),
    );
    const results = await Promise.allSettled([
      repository.createVersion(version()),
      repository.createVersion({ ...version(), totalRows: 11 }),
    ]);
    expect(results.filter((item) => item.status === "fulfilled").length).toBe(1);
    expect(results.filter((item) => item.status === "rejected").length).toBe(1);
  });
});
