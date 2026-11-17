import {createInMemoryStructuredDocumentStore} from "../../../../adapters/persistence/shared";
import {createStructuredDatasetVersionRepository} from "../../../../adapters/persistence/dataset-version";
import {normalizeDatasetVersionRecord} from "../../../../contracts/dataset";
import {createOrganizationId} from "../../../../contracts/organization";
import {createWorkspaceId} from "../../../../contracts/workspace";
import {ReadDatasetVersionUseCase, CompareDatasetVersionsUseCase} from "../dataset-version-read.use-cases";
import {ReadHeadlessDatasetMetadataUseCase} from "../headless-dataset-metadata.use-case";

export const organizationId = createOrganizationId("metadata-fixture-org");
export const workspaceId = createWorkspaceId("metadata-fixture-workspace");
export const principalId = "metadata-fixture-principal";
export const createdAt = "2026-11-17T00:00:00.000Z";
const digest = (number: number) => `sha256:${number.toString(16).padStart(64, "0")}` as const;
export function version(number: number) {
  return normalizeDatasetVersionRecord({schemaVersion: "1.0", organizationId, workspaceId,
    versionId: `version.${String(number).padStart(3, "0")}` as never, datasetId: "dataset.synthetic" as never,
    versionDigest: digest(number), totalRows: 10, createdAt, createdBy: principalId,
    artifacts: (["dataset", "train", "validation", "test"] as const).map((role, index) => ({role,
      artifactKey: `private/synthetic/${number}.${role}.jsonl` as never, digest: digest(number + index + 1),
      mediaType: "application/jsonl", sizeBytes: 100, rowCount: [10, 6, 2, 2][index]})),
    lineage: {sources: [{sourceArtifactId: "synthetic-private-source", artifactKey: "private/synthetic/source.csv" as never,
      digest: digest(200), mediaType: "text/csv"}],
      recipe: {artifactKey: "private/synthetic/recipe.json" as never, digest: digest(300), implementationId: "prepare", implementationVersion: "1"},
      split: {strategy: "random", seed: 42, groupField: "synthetic-private-group"},
      quality: {policyId: "recommended", policyVersion: "1", policyFingerprint: digest(400), reportFingerprint: digest(500)}},
    documentation: {name: "Synthetic private name", summary: "Synthetic private summary", intendedUses: ["Fixture"], limitations: ["Fixture"]},
  });
}

export async function fixture(count = 20) {
  const root = createInMemoryStructuredDocumentStore();
  const repository = createStructuredDatasetVersionRepository(root.forOrganization(organizationId));
  for (let index = count; index > 0; index--) await repository.createVersion(version(index));
  let allowed = true;
  let pointReads = 0;
  const boundedRepository = {...repository,
    async readVersion(...args: Parameters<typeof repository.readVersion>) {pointReads++; return repository.readVersion(...args);},
    async listVersions() {throw new Error("Headless metadata must not scan history.");},
  };
  const dependencies = {repository: boundedRepository,
    workspaceRepository: {async readWorkspace(id: string) {return id === workspaceId
      ? {workspaceId, organizationId, displayName: "Fixture", status: "active" as const, createdAt, updatedAt: createdAt} : undefined;}},
    workspaceAuthorization: {async authorizeWorkspaceOperation() {if (!allowed) throw new Error("Synthetic private policy detail");}},
  };
  const versions = new ReadDatasetVersionUseCase(dependencies), comparisons = new CompareDatasetVersionsUseCase(dependencies);
  const queries = new ReadHeadlessDatasetMetadataUseCase({versions, comparisons});
  return {root, repository, queries, versions, comparisons, readCount: () => pointReads, retire: () => {allowed = false;}};
}
