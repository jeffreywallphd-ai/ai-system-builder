import { describe, expect, it } from "../../../../testing/node-test";
import assert from "node:assert/strict";
import { DatasetVersionCommitUnconfirmedError, type DatasetVersionCommitAdmission } from "../../../ports/dataset-version";
import { createStructuredDatasetVersionRepository } from "../../../../adapters/persistence/dataset-version";
import { createInMemoryStructuredDocumentStore } from "../../../../adapters/persistence/shared";
import { createSha256DatasetVersionHasher } from "../../../../adapters/storage/dataset-version";
import type { ArtifactObjectStoragePort } from "../../../ports/storage";
import {
  createDeleteArtifactSuccessResult,
  createHasArtifactSuccessResult,
  createRetrieveArtifactFailureResult,
  createRetrieveArtifactSuccessResult,
  createStoreArtifactFailureResult,
  createStoreArtifactSuccessResult,
} from "../../../../contracts/storage";
import { createContractError } from "../../../../contracts/shared";
import { createWorkspaceId } from "../../../../contracts/workspace";
import { DatasetVersionFinalizationService } from "../dataset-version-finalization.service";

const hasher = createSha256DatasetVersionHasher();

function createMemoryArtifacts(events: string[]) {
  const values = new Map<string, Uint8Array>();
  const descriptors = new Map<string, any>();
  const port: ArtifactObjectStoragePort = {
    async storeArtifact(request, context) {
      const key = String(request.descriptor.key);
      if (values.has(key) && !request.overwrite) {
        return createStoreArtifactFailureResult(createContractError("conflict", "Artifact exists."), context);
      }
      const bytes = request.content instanceof Uint8Array
        ? request.content
        : new TextEncoder().encode(String(request.content));
      const descriptor = {
        ...request.descriptor,
        key,
        sizeBytes: bytes.byteLength,
        checksum: { algorithm: "sha256", value: hasher.digest(bytes).slice("sha256:".length) },
      };
      events.push(`store:${key}`);
      values.set(key, bytes);
      descriptors.set(key, descriptor);
      return createStoreArtifactSuccessResult(descriptor, context);
    },
    retrieveArtifact: (async (request: any, context?: any) => {
      const bytes = values.get(request.key);
      return bytes
        ? createRetrieveArtifactSuccessResult(descriptors.get(request.key), bytes, context)
        : createRetrieveArtifactFailureResult(createContractError("not-found", "Artifact missing."), context);
    }) as ArtifactObjectStoragePort["retrieveArtifact"],
    async hasArtifact(request) {
      return createHasArtifactSuccessResult(values.has(request.key), {
        descriptor: descriptors.get(request.key),
      });
    },
    async deleteArtifact(request, context) {
      events.push(`delete:${request.key}`);
      descriptors.delete(request.key);
      return createDeleteArtifactSuccessResult(values.delete(request.key), context);
    },
  };
  return { values, descriptors, port };
}

function input(datasetChecksum: string) {
  return {
    workspaceId: "workspace-a",
    createdBy: "person-1",
    datasetName: "Support Answers",
    recipeSnapshot: { task: "llm-instruction", split: { seed: 42 } },
    recipeImplementation: { id: "builtin.dataset-preparation", version: "1.0.0" },
    sources: [
      {
        artifactKey: "sources/support.csv",
        digest: hasher.digest("source"),
        mediaType: "text/csv",
      },
    ],
    artifacts: [
      {
        role: "dataset" as const,
        artifactKey: "prepared/support.jsonl",
        mediaType: "application/jsonl",
        sizeBytes: 8,
        checksum: { algorithm: "sha256", value: datasetChecksum },
        rowCount: 1,
      },
    ],
    split: { strategy: "source-group", seed: 42 },
    quality: {
      policyId: "recommended",
      policyVersion: "1",
      policyFingerprint: hasher.digest("policy"),
      reportFingerprint: hasher.digest("report"),
    },
    documentation: {
      name: "Support Answers",
      summary: "Prepared support examples.",
      intendedUses: ["Train a support assistant."],
      limitations: ["Synthetic fixture only."],
    },
    totalRows: 1,
    createdAt: "2026-07-29T14:00:00.000Z",
  };
}

describe("dataset version finalization service", () => {
  function prepared() {
    const events: string[] = [];
    const storage = createMemoryArtifacts(events);
    const bytes = new TextEncoder().encode('{"x":1}\n');
    storage.values.set("prepared/support.jsonl", bytes);
    storage.descriptors.set("prepared/support.jsonl", {key: "prepared/support.jsonl", sizeBytes: bytes.length});
    const repository = createStructuredDatasetVersionRepository(createInMemoryStructuredDocumentStore());
    const request = input(hasher.digest(bytes).slice("sha256:".length));
    const context = {workspaceId: "workspace-a", principalId: "person-1"};
    const scope = {workspaceId: createWorkspaceId(context.workspaceId), organizationId: undefined, principalId: context.principalId};
    return {events, storage, repository, request, context, scope};
  }

  it("passes complete verified metadata to the admitted commit after artifact IO, without an ordinary repository save", async () => {
    const f = prepared();
    let commits = 0;
    const service = new DatasetVersionFinalizationService({hasher, artifacts: f.storage.port, repository: {
      ...f.repository,
      async readVersion() {throw new Error("An ordinary read cannot establish an admitted save.");},
      async createVersion() {throw new Error("The admission owns version publication.");},
    }});
    const admission: DatasetVersionCommitAdmission = {...f.scope, async commit(version) {
      commits++;
      expect(version.artifacts.some(artifact => artifact.role === "recipe")).toBe(true);
      expect(version.artifacts.some(artifact => artifact.role === "dataset-card")).toBe(true);
      for (const artifact of version.artifacts) expect(f.storage.values.has(artifact.artifactKey)).toBe(true);
      return {version: await f.repository.createVersion(version), created: true};
    }};
    const result = await service.finalize(f.request, f.context, admission);
    expect(commits).toBe(1);
    expect(result.created).toBe(true);
    expect(await f.repository.listVersions(f.scope.workspaceId)).toEqual([result.version]);
    expect(f.events.some(event => event.startsWith("delete:"))).toBe(false);
  });

  it("denies a mismatched actor, workspace or organization admission before artifact IO", async () => {
    const f = prepared();
    const service = new DatasetVersionFinalizationService({repository: f.repository, artifacts: f.storage.port, hasher});
    let commits = 0;
    const admission: DatasetVersionCommitAdmission = {...f.scope, async commit() {commits++; throw new Error("Must not commit.");}};
    for (const narrowed of [{...admission, principalId: "another-person"},
      {...admission, workspaceId: createWorkspaceId("workspace-b")}, {...admission, organizationId: "another-organization" as never}])
      await expect(service.finalize(f.request, f.context, narrowed)).rejects.toThrow("exact actor and workspace");
    expect(commits).toBe(0);
    expect(f.events).toEqual([]);
  });

  it("preserves all prepared artifacts when an admitted commit acknowledgement is lost", async () => {
    const f = prepared();
    const service = new DatasetVersionFinalizationService({repository: f.repository, artifacts: f.storage.port, hasher});
    const admission: DatasetVersionCommitAdmission = {...f.scope, async commit(version) {
      await f.repository.createVersion(version);
      throw new Error("Synthetic private database diagnostic.");
    }};
    await assert.rejects(service.finalize(f.request, f.context, admission), error =>
      error instanceof DatasetVersionCommitUnconfirmedError && error.message === "The approved dataset save could not be confirmed.");
    const versions = await f.repository.listVersions(f.scope.workspaceId);
    expect(versions.length).toBe(1);
    for (const artifact of versions[0]!.artifacts) expect(f.storage.values.has(artifact.artifactKey)).toBe(true);
    expect(f.events.some(event => event.startsWith("delete:"))).toBe(false);
  });

  it("rejects a mutated admitted result and never treats an ordinary existing version as a causal receipt", async () => {
    const f = prepared();
    const service = new DatasetVersionFinalizationService({repository: f.repository, artifacts: f.storage.port, hasher});
    const ordinary = await service.finalize(f.request, f.context);
    let commits = 0;
    const admission: DatasetVersionCommitAdmission = {...f.scope, async commit(version) {
      commits++;
      (version.documentation as {name: string}).name = "Changed by the adapter";
      return {version, created: false};
    }};
    await assert.rejects(service.finalize(f.request, f.context, admission), DatasetVersionCommitUnconfirmedError);
    expect(commits).toBe(1);
    expect(await f.repository.listVersions(f.scope.workspaceId)).toEqual([ordinary.version]);
    expect(f.events.some(event => event.startsWith("delete:"))).toBe(false);
  });

  it("writes artifacts first, inserts one immutable record last, and retries idempotently", async () => {
    const events: string[] = [];
    const storage = createMemoryArtifacts(events);
    const dataset = new TextEncoder().encode('{"x":1}\n');
    storage.values.set("prepared/support.jsonl", dataset);
    storage.descriptors.set("prepared/support.jsonl", {
      key: "prepared/support.jsonl",
      mediaType: "application/jsonl",
      sizeBytes: dataset.byteLength,
    });
    const baseRepository = createStructuredDatasetVersionRepository(createInMemoryStructuredDocumentStore());
    const repository = {
      ...baseRepository,
      async createVersion(version: any) {
        events.push("create-version");
        return baseRepository.createVersion(version);
      },
    };
    const service = new DatasetVersionFinalizationService({ repository, artifacts: storage.port, hasher });
    const context = { workspaceId: "workspace-a" };
    const request = input(hasher.digest(dataset).slice("sha256:".length));
    const first = await service.finalize(request, context);
    const second = await service.finalize(request, context);

    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.version).toEqual(first.version);
    expect(first.version.artifacts.map((item) => item.role)).toContain("recipe");
    expect(events.indexOf("create-version") > events.findIndex((item) => item.startsWith("store:dataset-versions/recipes/"))).toBe(true);
    expect(await baseRepository.listVersions(createWorkspaceId("workspace-a"))).toEqual([first.version]);
  });

  it("fails closed on digest substitution and compensates the recipe artifact", async () => {
    const events: string[] = [];
    const storage = createMemoryArtifacts(events);
    const dataset = new TextEncoder().encode('{"x":1}\n');
    storage.values.set("prepared/support.jsonl", dataset);
    storage.descriptors.set("prepared/support.jsonl", { key: "prepared/support.jsonl" });
    const repository = createStructuredDatasetVersionRepository(createInMemoryStructuredDocumentStore());
    const service = new DatasetVersionFinalizationService({ repository, artifacts: storage.port, hasher });

    await expect(service.finalize(input(hasher.digest("different").slice("sha256:".length)), { workspaceId: "workspace-a" })).rejects.toThrow("digest verification");
    expect(events.some((item) => item.startsWith("delete:dataset-versions/recipes/"))).toBe(true);
    expect(await repository.listVersions(createWorkspaceId("workspace-a"))).toEqual([]);
  });

  it("denies wrong workspace scope before creating artifacts", async () => {
    const events: string[] = [];
    const storage = createMemoryArtifacts(events);
    const service = new DatasetVersionFinalizationService({
      repository: createStructuredDatasetVersionRepository(createInMemoryStructuredDocumentStore()),
      artifacts: storage.port,
      hasher,
    });
    await expect(service.finalize(input(hasher.digest("dataset").slice("sha256:".length)), { workspaceId: "workspace-b" })).rejects.toThrow("exact workspace");
    expect(events).toEqual([]);
  });
});
