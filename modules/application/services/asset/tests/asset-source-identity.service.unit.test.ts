import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { AssetReference, AssetResourceBackedView } from "../../../../contracts/asset";
import { AssetSourceIdentityService } from "../asset-source-identity.service";

function view(overrides: Partial<AssetResourceBackedView> = {}): AssetResourceBackedView {
  return {
    viewId: "view.safe",
    viewKind: "artifact",
    assetType: "data-source",
    assetFamily: "resource-backed",
    sourceRef: { kind: "artifact", id: "artifact-ref.safe" as AssetReference["id"] },
    resourceBacking: {
      backingId: "artifact.safe",
      resourceKind: "artifact",
      ref: { kind: "artifact", id: "artifact-ref.safe" as AssetReference["id"] },
      role: "primary",
    },
    ...overrides,
  };
}

describe("asset source identity service", () => {
  it("derives deterministic safe source identity from resource-backed views", () => {
    const service = new AssetSourceIdentityService();
    const first = service.deriveFromResourceBackedView(view());
    const second = service.deriveFromResourceBackedView(view());
    assert.equal(first.ok, true);
    assert.equal(first.sourceIdentity?.deduplicationKey, second.sourceIdentity?.deduplicationKey);
    assert.equal(first.sourceIdentity?.sourceSystem, "artifact");
  });

  it("does not expose path-like or secret source values in source identity", () => {
    const result = new AssetSourceIdentityService().deriveFromResourceBackedView(view({
      viewId: "C:\\Users\\secret\\view",
      resourceBacking: {
        backingId: "C:\\Users\\secret\\artifact",
        resourceKind: "artifact",
        ref: { kind: "artifact", id: "artifact-ref.safe" as AssetReference["id"] },
      },
    }));
    assert.equal(result.ok, true);
    assert.doesNotMatch(JSON.stringify(result.sourceIdentity), /C:\\|Users|secret|token|base64|bytes|blob/i);
  });

  it("hashes safe-looking sensitive source IDs instead of exposing them", () => {
    const sensitiveSeeds = [
      "C:\\Users\\name\\image.png",
      "/tmp/generated.png",
      "https://host/file?token=abc",
      "hf://private/repo/model.safetensors?token=abc",
      "data:image/png;base64,AAAA",
      "prompt-a-beautiful-landscape",
      "workflowJson",
      "Bearer abc",
    ];

    for (const seed of sensitiveSeeds) {
      const result = new AssetSourceIdentityService().deriveFromResourceBackedView(view({
        viewId: seed,
        resourceBacking: {
          backingId: seed,
          resourceKind: "artifact",
          ref: { kind: "artifact", id: seed as AssetReference["id"] },
          role: "primary",
          metadata: {
            storageRootDirectory: "C:\\storage",
            runtimeRootDirectory: "/tmp/runtime",
            prompt: "prompt-a-beautiful-landscape",
            negativePrompt: "negative prompt text",
            workflowJson: { raw: true },
            token: "abc",
            authHeader: "Bearer abc",
            dataUrl: "data:image/png;base64,AAAA",
            rawProviderPayload: { value: seed },
            stack: "Error stack",
            commandLine: "python script.py",
            env: "TOKEN=abc",
          },
        },
        metadata: {
          localPath: "C:\\Users\\name\\image.png",
          cachePath: "/tmp/generated.png",
          prompt: "prompt-a-beautiful-landscape",
          workflowJson: { raw: true },
          token: "abc",
          rawProviderPayload: { value: seed },
        },
      }));

      assert.equal(result.ok, true, seed);
      const serialized = JSON.stringify(result.sourceIdentity);
      assert.match(result.sourceIdentity?.sourceId ?? "", /^(?:artifact|view)\.[a-z0-9]+$/i);
      assert.match(result.sourceIdentity?.deduplicationKey ?? "", /^asset-source\.artifact\.[a-z0-9]+$/i);
      assert.doesNotMatch(serialized, /C:\\|\/tmp|storage|runtime|hf:\/\/|https:\/\/host|token|Bearer|prompt-a-beautiful|negative prompt|workflowJson|data:image|base64|rawProvider|stack|python script|TOKEN=abc/i, seed);
    }
  });

  it("rejects views without reliable backing or source identity", () => {
    const result = new AssetSourceIdentityService().deriveFromResourceBackedView({
      viewId: "view.only",
      viewKind: "artifact",
    });
    assert.equal(result.ok, false);
    assert.equal(result.validationIssues?.[0]?.category, "identity");
  });

  it("derives distinct safe identities for artifact, image, generated output, model, dataset, and external object views", () => {
    const service = new AssetSourceIdentityService();
    const cases: Array<Partial<AssetResourceBackedView>> = [
      { viewKind: "artifact", assetType: "data-source", resourceBacking: { backingId: "artifact.one", resourceKind: "artifact", ref: { kind: "artifact", id: "artifact.one" as AssetReference["id"] } } },
      { viewKind: "image-asset", assetType: "image", resourceBacking: { backingId: "image.one", resourceKind: "image", ref: { kind: "artifact", id: "artifact.image" as AssetReference["id"] } } },
      { viewKind: "generated-output", assetType: "image", generatedOutput: { outputId: "generated.one", producedAssetType: "image" }, resourceBacking: { backingId: "generated.one", resourceKind: "generated-output", ref: { outputId: "generated.one" } } },
      { viewKind: "model", assetType: "model", resourceBacking: { backingId: "model.one", resourceKind: "model", ref: { kind: "resource", id: "model.one" as AssetReference["id"] } } },
      { viewKind: "dataset", assetType: "dataset", resourceBacking: { backingId: "dataset.one", resourceKind: "dataset", ref: { kind: "resource", id: "dataset.one" as AssetReference["id"] } } },
      { viewKind: "external-repository-object", assetType: "model", resourceBacking: { backingId: "external.one", resourceKind: "external-repository-object", ref: { provider: "huggingface", repositoryId: "owner/repo", objectPath: "model.bin" } } },
    ];

    const identities = cases.map((overrides, index) => service.deriveFromResourceBackedView(view({
      viewId: `view.${index}`,
      ...overrides,
    })).sourceIdentity!);

    assert.deepEqual(identities.map((identity) => identity.sourceSystem), [
      "artifact",
      "image-asset",
      "generated-output",
      "model",
      "dataset",
      "external-repository-object",
    ]);
    assert.equal(new Set(identities.map((identity) => identity.deduplicationKey)).size, identities.length);
    assert.doesNotMatch(JSON.stringify(identities), /model\.bin|token|https?:|C:\\|base64|prompt/i);
  });

  it("derives distinct finalized and imported/localized internal backing identities", () => {
    const service = new AssetSourceIdentityService();
    const generated = service.deriveFromResourceBackedView(view({
      viewKind: "generated-output",
      assetType: "image",
      generatedOutput: { outputId: "generated.one", producedAssetType: "image" },
      resourceBacking: { backingId: "generated.one", resourceKind: "generated-output", ref: { outputId: "generated.one" } },
    })).sourceIdentity!;
    const finalized = service.deriveFromFinalizedGeneratedImage({
      imageAssetId: "image.one",
      backingArtifactId: "artifact.one",
      displayName: "Safe image",
    }, generated);
    const external = service.deriveFromResourceBackedView(view({
      viewKind: "external-repository-object",
      assetType: "dataset",
      resourceBacking: { backingId: "external.dataset", resourceKind: "external-repository-object", ref: { provider: "huggingface", repositoryId: "owner/repo", objectPath: "data.csv" } },
    })).sourceIdentity!;
    const imported = service.deriveFromImportedOrLocalizedExternalObject({
      operation: "import",
      sourceIdentity: external,
      resourceRefs: [{ kind: "artifact", id: "artifact.imported" as AssetReference["id"] }],
      backings: [{ backingId: "artifact.imported", resourceKind: "artifact", ref: { kind: "artifact", id: "artifact.imported" as AssetReference["id"] } }],
    });
    const localized = service.deriveFromImportedOrLocalizedExternalObject({
      operation: "localize",
      sourceIdentity: external,
      resourceRefs: [{ kind: "artifact", id: "artifact.imported" as AssetReference["id"] }],
      backings: [{ backingId: "artifact.imported", resourceKind: "artifact", ref: { kind: "artifact", id: "artifact.imported" as AssetReference["id"] } }],
    });

    assert.equal(finalized.sourceSystem, "image-asset");
    assert.equal(imported.sourceKind, "dataset");
    assert.notEqual(generated.deduplicationKey, finalized.deduplicationKey);
    assert.notEqual(external.deduplicationKey, imported.deduplicationKey);
    assert.notEqual(imported.deduplicationKey, localized.deduplicationKey);
    assert.doesNotMatch(JSON.stringify({ finalized, imported, localized }), /data.csv|C:\\|token|base64|prompt/i);
  });

  it("hashes imported/localized source ids when internal refs contain local or object paths", () => {
    const service = new AssetSourceIdentityService();
    const external = service.deriveFromResourceBackedView(view({
      viewKind: "external-repository-object",
      assetType: "model",
      resourceBacking: {
        backingId: "https://host/private/model.bin?token=hidden",
        resourceKind: "external-repository-object",
        ref: { provider: "huggingface", repositoryId: "owner/repo", objectPath: "private/model.bin" },
      },
    })).sourceIdentity!;
    const localized = service.deriveFromImportedOrLocalizedExternalObject({
      operation: "localize",
      sourceIdentity: external,
      resourceRefs: [{ kind: "artifact", id: "C:\\Users\\name\\.cache\\huggingface\\hub\\model.bin" as AssetReference["id"] }],
      backings: [{
        backingId: "private/model.bin",
        resourceKind: "artifact",
        ref: { kind: "artifact", id: "/tmp/cache/private/model.bin" as AssetReference["id"] },
        metadata: { localPath: "C:\\Users\\name\\model.bin", objectPath: "private/model.bin", token: "hidden" },
      }],
    });

    assert.match(localized.sourceId, /^localize\.[a-z0-9]+$/);
    assert.match(localized.deduplicationKey, /^asset-source\.model\.[a-z0-9]+$/);
    assert.doesNotMatch(JSON.stringify(localized), /C:\\|\/tmp|\.cache|huggingface|private\/model\.bin|token|https:\/\/host/i);
  });
});
