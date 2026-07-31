import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AssetReference, AssetResourceBackedView, AssetSourceIdentity, FinalizeGeneratedOutputCommand, ImportExternalRepositoryObjectCommand, RegisterResourceBackedViewCommand } from "../../../../contracts/asset";
import { AssetMutationProvenanceService } from "../asset-mutation-provenance.service";

const sourceIdentity: AssetSourceIdentity = {
  sourceKind: "artifact",
  sourceViewId: "view.safe",
  sourceViewKind: "artifact",
  sourceSystem: "artifact",
  sourceId: "artifact.safe",
  deduplicationKey: "asset-source.artifact.safe",
};

const command: RegisterResourceBackedViewCommand = {
  operation: "asset.register-resource-backed-view",
  viewId: "view.safe",
  approval: { userConfirmed: true, confirmationKind: "register-resource-backed-view", confirmationTextVersion: "1" },
  actor: { initiatedBy: "ai-assisted", actorRef: "assistant.1", actorDisplayName: "Assistant" },
  context: { idempotencyKey: "idem.safe" },
};

const view: AssetResourceBackedView = {
  viewId: "view.safe",
  viewKind: "artifact",
  assetType: "data-source",
  assetFamily: "resource-backed",
  displayName: "Safe",
  sourceRef: { kind: "artifact", id: "artifact-ref.safe" as AssetReference["id"] },
  resourceBacking: {
    backingId: "artifact.safe",
    resourceKind: "artifact",
    ref: { kind: "artifact", id: "artifact-ref.safe" as AssetReference["id"] },
    metadata: { token: "secret", ok: "safe" },
  },
  metadata: { prompt: "raw prompt", ok: "safe" },
};

const generatedIdentity: AssetSourceIdentity = {
  sourceKind: "generated-output",
  sourceViewId: "view.generated",
  sourceViewKind: "generated-output",
  sourceSystem: "generated-output",
  sourceId: "generated.safe",
  deduplicationKey: "asset-source.generated-output.safe",
};

const finalizeCommand: FinalizeGeneratedOutputCommand = {
  operation: "asset.finalize-generated-output",
  viewId: "view.generated",
  approval: { userConfirmed: true, confirmationKind: "finalize-generated-output", allowFilesystemWrite: true, allowPartialCompletion: true, confirmationTextVersion: "1" },
  actor: { initiatedBy: "human", actorRef: "user.1", actorDisplayName: "User One" },
  context: { idempotencyKey: "idem.safe" },
};

const generatedView: AssetResourceBackedView = {
  viewId: "view.generated",
  viewKind: "generated-output",
  displayName: "Generated",
  generatedOutput: {
    outputId: "generated.safe",
    runtimeCapabilityId: "image-generation",
    producedAssetType: "image",
    metadata: { prompt: "raw prompt" },
  },
  resourceBacking: {
    backingId: "generated.safe",
    resourceKind: "generated-output",
    ref: { outputId: "generated.safe", producedAssetType: "image" },
    metadata: { workflow: "raw workflow", ok: "safe" },
  },
  metadata: { prompt: "raw prompt", workflow: "raw workflow", ok: "safe" },
};

const importCommand: ImportExternalRepositoryObjectCommand = {
  operation: "asset.import-external-repository-object",
  viewId: "view.external",
  approval: { userConfirmed: true, confirmationKind: "import-external-object", allowNetworkAccess: true, allowCredentialUse: true, allowFilesystemWrite: true, allowPartialCompletion: true },
  actor: { initiatedBy: "human", actorRef: "user.1", actorDisplayName: "User One" },
  context: { idempotencyKey: "idem.safe" },
};

const externalIdentity: AssetSourceIdentity = {
  sourceKind: "external-repository-object",
  sourceViewId: "view.external",
  sourceViewKind: "external-repository-object",
  sourceSystem: "external-repository-object",
  sourceId: "external.safe",
  deduplicationKey: "asset-source.external.safe",
};

const importedIdentity: AssetSourceIdentity = {
  sourceKind: "artifact",
  sourceViewId: "view.external",
  sourceViewKind: "external-repository-object",
  sourceSystem: "artifact",
  sourceId: "import.safe",
  deduplicationKey: "asset-source.artifact.imported.safe",
};

const externalView: AssetResourceBackedView = {
  viewId: "view.external",
  viewKind: "external-repository-object",
  assetType: "data-source",
  displayName: "External Safe",
  sourceRef: { kind: "external-repository-object", id: "external.safe" as AssetReference["id"] },
  resourceBacking: {
    backingId: "external.safe",
    resourceKind: "external-repository-object",
    ref: {
      provider: "huggingface",
      repositoryId: "owner/repo",
      objectPath: "model.bin",
      objectKind: "artifact",
      metadata: { token: "secret", ok: "safe" },
    },
    metadata: { signedUrl: "https://example.test/file?token=secret", ok: "safe" },
  },
  metadata: { rawProviderPayload: { token: "secret" }, ok: "safe" },
};

describe("asset mutation provenance service", () => {
  it("creates sanitized mutation provenance and asset provenance", () => {
    const provenance = new AssetMutationProvenanceService().createForResourceBackedRegistration({
      command,
      sourceIdentity,
      sourceView: view,
      createdAt: "2026-05-08T12:00:00.000Z",
    });
    assert.equal(provenance.operation, "asset.register-resource-backed-view");
    assert.equal(provenance.actor.initiatedBy, "ai-assisted");
    assert.equal(provenance.createdProvenance?.authorship, "mixed");
    assert.doesNotMatch(JSON.stringify(provenance), /secret|raw prompt|base64|bytes|blob|workflow|stack|C:\\/i);
  });

  it("creates sanitized generated-output finalization provenance", () => {
    const provenance = new AssetMutationProvenanceService().createForGeneratedOutputFinalization({
      command: finalizeCommand,
      sourceIdentity: generatedIdentity,
      sourceView: generatedView,
      createdAt: "2026-05-08T12:00:00.000Z",
      finalizedImage: {
        imageAssetId: "image.safe",
        backingArtifactId: "artifact.safe",
        model: "safe-model",
        engine: "comfyui",
      },
    });
    assert.equal(provenance.operation, "asset.finalize-generated-output");
    assert.equal(provenance.createdProvenance?.sourceKind, "runtime-generated");
    assert.equal(provenance.createdProvenance?.authorship, "ai-generated");
    assert.doesNotMatch(JSON.stringify(provenance), /secret|raw prompt|raw workflow|base64|bytes|blob|stack|C:\\/i);
  });

  it("creates sanitized external repository object import provenance", () => {
    const provenance = new AssetMutationProvenanceService().createForExternalRepositoryObjectImportOrLocalization({
      command: importCommand,
      sourceIdentity: {
        ...externalIdentity,
        sourceId: "external.unsafe-path-source",
      },
      importedOrLocalizedIdentity: {
        ...importedIdentity,
        sourceId: "import.opaque",
        backingRefs: [{
          backingId: "backing.opaque",
          resourceKind: "artifact",
          ref: { kind: "artifact", id: "resource.opaque" as AssetReference["id"] },
          metadata: { localPath: "C:\\Users\\name\\model.bin", token: "secret" },
        }],
      },
      sourceView: externalView,
      createdAt: "2026-05-08T12:00:00.000Z",
      result: {
        status: "imported",
        resultId: "import.safe",
        providerLabel: "Hugging Face",
        repositoryLabel: "owner/repo",
        objectLabel: "Model",
        internalResourceRefs: [{ kind: "artifact", id: "artifact.safe" as AssetReference["id"] }],
      },
    });
    assert.equal(provenance.operation, "asset.import-external-repository-object");
    assert.equal(provenance.createdProvenance?.sourceKind, "imported");
    assert.doesNotMatch(JSON.stringify(provenance), /secret|signedUrl|token|rawProviderPayload|localPath|storageRoot|runtimeRoot|cache|base64|bytes|blob|stack|command|process\.env|C:\\|https:\/\/example/i);
  });
});
