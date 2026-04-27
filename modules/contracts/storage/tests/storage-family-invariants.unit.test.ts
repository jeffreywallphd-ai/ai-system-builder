import { describe, expect, it } from "../../../testing/node-test";

import * as storageContracts from "..";

describe("storage family invariants", () => {
  it("exports shared foundation plus specialized artifact-object and artifact-repo surfaces", () => {
    expect(Object.keys(storageContracts).sort()).toEqual([
      "ARTIFACT_STORAGE_BINDING_ROLES",
      "STORAGE_ARTIFACT_KEY_FORMAT_DESCRIPTION",
      "STORAGE_INSTANCE_KINDS",
      "STORAGE_KINDS",
      "STORAGE_ZONE_KINDS",
      "createDeleteArtifactFailureResult",
      "createDeleteArtifactRequest",
      "createDeleteArtifactSuccessResult",
      "createHasArtifactFailureResult",
      "createHasArtifactInRepoFailureResult",
      "createHasArtifactInRepoRequest",
      "createHasArtifactInRepoSuccessResult",
      "createHasArtifactRequest",
      "createHasArtifactSuccessResult",
      "createRetrieveArtifactFailureResult",
      "createRetrieveArtifactFromRepoFailureResult",
      "createRetrieveArtifactFromRepoRequest",
      "createRetrieveArtifactFromRepoSuccessResult",
      "createRetrieveArtifactRequest",
      "createRetrieveArtifactSuccessResult",
      "createStoreArtifactFailureResult",
      "createStoreArtifactInRepoFailureResult",
      "createStoreArtifactInRepoRequest",
      "createStoreArtifactInRepoSuccessResult",
      "createStoreArtifactRequest",
      "createStoreArtifactSuccessResult",
      "decodeArtifactRepoBackingLocator",
      "encodeArtifactRepoBackingLocator",
      "isArtifactStorageBindingRole",
      "isStorageArtifactKey",
      "isStorageInstanceKind",
      "isStorageKind",
      "isStorageZoneKind",
      "normalizeArtifactObjectStorageLocator",
      "normalizeArtifactRepoDescriptor",
      "normalizeArtifactRepoTarget",
      "normalizeArtifactStorageBinding",
      "normalizeStorageArtifactKey",
      "normalizeStorageBackingReference",
      "normalizeStorageInstanceKind",
      "normalizeStorageInstanceReference",
      "normalizeStorageKind",
      "normalizeStorageObjectDescriptor",
      "normalizeStorageObjectDescriptorInput",
      "normalizeStoragePlacementDescriptor",
      "normalizeStorageProviderId",
      "normalizeStorageZoneKind",
      "resolveArtifactRepoBackingTarget",
    ]);
  });

  it("keeps storage kind constrained to artifact-object and artifact-repo", () => {
    expect(storageContracts.normalizeStorageKind(" ARTIFACT-OBJECT ")).toBe("artifact-object");
    expect(storageContracts.normalizeStorageKind("artifact-repo")).toBe("artifact-repo");

    expect(() => storageContracts.normalizeStorageKind("dataset")).toThrow(
      'Storage kind must be one of artifact-object, artifact-repo. Received "dataset".',
    );
  });

  it("keeps backing references thin and generic", () => {
    const backing = storageContracts.normalizeStorageBackingReference({
      kind: "artifact-repo",
      provider: " HuggingFace ",
      locator: " openai/demo-artifacts/images/a.png ",
      revision: " main ",
    });

    expect(backing).toEqual({
      kind: "artifact-repo",
      provider: "huggingface",
      locator: "openai/demo-artifacts/images/a.png",
      revision: "main",
    });

    expect(Object.keys(backing).sort()).toEqual(["kind", "locator", "provider", "revision"]);
  });

  it("keeps artifact-object contracts key/blob oriented", () => {
    const locator = storageContracts.normalizeArtifactObjectStorageLocator({
      storageKey: " artifacts/build/output-1 ",
    });

    const request = storageContracts.createStoreArtifactRequest(new Uint8Array([1, 2]), {
      descriptor: {
        key: locator.storageKey,
      },
    });

    expect(locator).toEqual({
      storageKey: "artifacts/build/output-1",
    });
    expect(request.descriptor.key).toBe("artifacts/build/output-1");
    expect("repository" in request.descriptor).toBe(false);
  });

  it("keeps artifact-repo contracts provider/repo/revision/path oriented", () => {
    const storeRequest = storageContracts.createStoreArtifactInRepoRequest(
      new Uint8Array([1, 2, 3]),
      {
        target: {
          provider: " github ",
          repository: " openai/ai-system-builder ",
          revision: " rebuild ",
          path: " artifacts/state.json ",
        },
      },
    );

    expect(storeRequest.target).toEqual({
      provider: "github",
      repository: "openai/ai-system-builder",
      revision: "rebuild",
      path: "artifacts/state.json",
    });
    expect("key" in storeRequest.target).toBe(false);
  });

  it("prevents repo semantics leaking into object-family requests", () => {
    const objectRequest = storageContracts.createRetrieveArtifactRequest(" artifacts/report.json ");
    const repoRequest = storageContracts.createRetrieveArtifactFromRepoRequest({
      provider: "huggingface",
      repository: "openai/demo-artifacts",
      path: "report.json",
    });

    expect(objectRequest).toEqual({
      key: "artifacts/report.json",
      requestId: undefined,
      correlationId: undefined,
    });
    expect("requestId" in repoRequest).toBe(false);
    expect("correlationId" in repoRequest).toBe(false);
    expect(repoRequest.target).toEqual({
      provider: "huggingface",
      repository: "openai/demo-artifacts",
      revision: undefined,
      path: "report.json",
    });
    expect("target" in objectRequest).toBe(false);
    expect("key" in repoRequest.target).toBe(false);
  });
});
