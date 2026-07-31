import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, it } from "node:test";

import type { ArtifactBrowseItem } from "../../../../contracts/artifact-browser";
import type { ImageAsset } from "../../../../contracts/image";
import type { ModelInventoryRecord } from "../../../../contracts/model";
import { createSuccessResult } from "../../../../contracts/shared";
import type { ArtifactBrowserMetadataReadPort } from "../../../../application/ports/artifact-browser";
import type { ImageAssetDescriptorReadPort } from "../../../../application/ports/image";
import type { ModelRegistryPort } from "../../../../application/ports/model";
import { composeResourceBackedViewProviders } from "../composeResourceBackedViewProviders";

class FakeArtifactMetadataRead implements Pick<ArtifactBrowserMetadataReadPort, "browseArtifacts"> {
  public listCalls = 0;
  public filesystemScanCalls = 0;
  public contentReadCalls = 0;
  public byteReadCalls = 0;

  public constructor(private readonly items: readonly ArtifactBrowseItem[]) {}

  public async browseArtifacts() {
    this.listCalls += 1;
    return createSuccessResult({ items: [...this.items] });
  }

  public async scanFilesystem() {
    this.filesystemScanCalls += 1;
  }

  public async readArtifactContent() {
    this.contentReadCalls += 1;
  }

  public async readArtifactBytes() {
    this.byteReadCalls += 1;
  }
}

class FakeImageDescriptorRead implements ImageAssetDescriptorReadPort {
  public listCalls = 0;
  public readCalls = 0;
  public fileReadCalls = 0;
  public blobReadCalls = 0;
  public base64ReadCalls = 0;
  public generationCalls = 0;
  public finalizationCalls = 0;

  public constructor(private readonly items: readonly ImageAsset[]) {}

  public async listImageAssetDescriptors(query: { readonly limit?: number } = {}) {
    this.listCalls += 1;
    return { items: [...this.items].slice(0, query.limit) };
  }

  public async readImageAssetDescriptor(assetId: string) {
    this.readCalls += 1;
    return this.items.find((item) => item.assetId === assetId);
  }

  public async readImageFile() {
    this.fileReadCalls += 1;
  }

  public async readImageBlob() {
    this.blobReadCalls += 1;
  }

  public async readImageBase64() {
    this.base64ReadCalls += 1;
  }

  public async generateImage() {
    this.generationCalls += 1;
  }

  public async finalizeImage() {
    this.finalizationCalls += 1;
  }
}

class FakeModelRegistry implements Pick<ModelRegistryPort, "listModels" | "getModelRecord"> {
  public listCalls = 0;
  public readCalls = 0;
  public discoveryCalls = 0;
  public validationCalls = 0;
  public trainingCalls = 0;
  public publishingCalls = 0;
  public runtimeCalls = 0;
  public tokenReadCalls = 0;
  public providerBrowseCalls = 0;
  public providerListCalls = 0;
  public providerRetrieveCalls = 0;
  public providerDownloadCalls = 0;
  public providerUploadCalls = 0;
  public externalImportCalls = 0;
  public externalLocalizeCalls = 0;
  public externalPublishCalls = 0;
  public listRequests: Parameters<ModelRegistryPort["listModels"]>[0][] = [];

  public constructor(private readonly records: readonly ModelInventoryRecord[]) {}

  public async listModels(request: Parameters<ModelRegistryPort["listModels"]>[0]) {
    this.listCalls += 1;
    this.listRequests.push(request);
    if (request.includeDiscovered !== false) this.discoveryCalls += 1;
    return { models: [...this.records].slice(0, request.limit) };
  }

  public async getModelRecord(_workspaceId: string, modelRecordId: string) {
    this.readCalls += 1;
    return this.records.find((record) => record.modelRecordId === modelRecordId);
  }

  public async discoverModels() {
    this.discoveryCalls += 1;
  }

  public async validateModel() {
    this.validationCalls += 1;
  }

  public async trainModel() {
    this.trainingCalls += 1;
  }

  public async publishModel() {
    this.publishingCalls += 1;
  }

  public async readRuntimeTask() {
    this.runtimeCalls += 1;
  }

  public async readToken() {
    this.tokenReadCalls += 1;
  }

  public async browseProvider() {
    this.providerBrowseCalls += 1;
  }

  public async listProviderObjects() {
    this.providerListCalls += 1;
  }

  public async retrieveProviderObject() {
    this.providerRetrieveCalls += 1;
  }

  public async downloadProviderObject() {
    this.providerDownloadCalls += 1;
  }

  public async uploadProviderObject() {
    this.providerUploadCalls += 1;
  }

  public async importExternalObject() {
    this.externalImportCalls += 1;
  }

  public async localizeExternalObject() {
    this.externalLocalizeCalls += 1;
  }

  public async publishExternalObject() {
    this.externalPublishCalls += 1;
  }
}

function artifact(): ArtifactBrowseItem {
  return {
    artifactId: "artifact-1",
    storageKey: "catalog/artifact-1",
    artifactFamily: "document",
    mediaType: "text/plain",
    originalName: "Notes.txt",
    createdAt: "2026-05-08T00:00:00.000Z",
    metadata: { label: "safe", localPath: "/tmp/hidden", token: "secret" },
  };
}

function image(): ImageAsset {
  return {
    assetId: "image-1",
    artifactId: "artifact-image-1",
    source: "generated",
    metadata: {
      originalFileName: "Final image.png",
      engine: "comfyui",
      width: 512,
      height: 512,
      prompt: "hidden prompt",
      createdAt: "2026-05-08T00:00:00.000Z",
    },
  };
}

function model(overrides: Partial<ModelInventoryRecord> = {}): ModelInventoryRecord {
  return {
    modelRecordId: "model-1",
    displayName: "Demo Model",
    source: "huggingface",
    lifecycleStatus: "validated",
    artifactForm: "full-model",
    provider: "huggingface",
    modelId: "org/demo-model",
    localPath: "C:\\Users\\name\\.cache\\huggingface\\hub\\models--org--demo",
    createdAt: "2026-05-08T00:00:00.000Z",
    validationStatus: "valid",
    published: { provider: "huggingface", repository: "org/demo-model", revision: "main", publishedAt: "2026-05-08T00:00:00.000Z" },
    metadata: { safeLabel: "visible", cacheDirectory: "/home/name/.cache/huggingface", token: "hidden" },
    ...overrides,
  };
}

function assertSafe(value: unknown): void {
  const output = JSON.stringify(value).toLowerCase();
  for (const forbidden of ["c:\\", "/tmp/", "/home/name", "secret", "token", "cache", "raw", "base64", "bytes", "stack"]) {
    assert.equal(output.includes(forbidden), false, `serialized output included ${forbidden}: ${output}`);
  }
}

function assertNoForbiddenSourceSideEffects(
  artifacts: FakeArtifactMetadataRead,
  images: FakeImageDescriptorRead,
  models: FakeModelRegistry,
): void {
  assert.equal(artifacts.filesystemScanCalls, 0);
  assert.equal(artifacts.contentReadCalls, 0);
  assert.equal(artifacts.byteReadCalls, 0);
  assert.equal(images.fileReadCalls, 0);
  assert.equal(images.blobReadCalls, 0);
  assert.equal(images.base64ReadCalls, 0);
  assert.equal(images.generationCalls, 0);
  assert.equal(images.finalizationCalls, 0);
  assert.equal(models.discoveryCalls, 0);
  assert.equal(models.validationCalls, 0);
  assert.equal(models.trainingCalls, 0);
  assert.equal(models.publishingCalls, 0);
  assert.equal(models.runtimeCalls, 0);
  assert.equal(models.tokenReadCalls, 0);
  assert.equal(models.providerBrowseCalls, 0);
  assert.equal(models.providerListCalls, 0);
  assert.equal(models.providerRetrieveCalls, 0);
  assert.equal(models.providerDownloadCalls, 0);
  assert.equal(models.providerUploadCalls, 0);
  assert.equal(models.externalImportCalls, 0);
  assert.equal(models.externalLocalizeCalls, 0);
  assert.equal(models.externalPublishCalls, 0);
}

describe("composeResourceBackedViewProviders", () => {
  it("constructs an aggregate provider without calling safe sources", async () => {
    const artifacts = new FakeArtifactMetadataRead([artifact()]);
    const images = new FakeImageDescriptorRead([image()]);
    const models = new FakeModelRegistry([model()]);

    const provider = composeResourceBackedViewProviders({
      artifactBrowserMetadataRead: artifacts,
      imageAssetDescriptorRead: images,
      modelRegistry: models,
      publishedModelRegistry: models,
    });

    assert.equal(provider.providerId, "asset-resource-backed-view-aggregate-provider");
    assert.equal(artifacts.listCalls + images.listCalls + models.listCalls, 0);
  });

  it("lists and reads from injected descriptor-only seams without forbidden side effects", async () => {
    const artifacts = new FakeArtifactMetadataRead([artifact()]);
    const images = new FakeImageDescriptorRead([image()]);
    const models = new FakeModelRegistry([model(), model({ modelRecordId: "model-2", displayName: "Second Model", published: undefined })]);
    const provider = composeResourceBackedViewProviders({
      artifactBrowserMetadataRead: artifacts,
      imageAssetDescriptorRead: images,
      modelRegistry: models,
      publishedModelRegistry: models,
    });

    const result = await provider.listResourceBackedViews({ workspaceId: "workspace-a" as never, limit: 20 });
    const viewIds = result.items.map((item) => item.viewId);

    assert.equal(artifacts.listCalls, 1);
    assert.equal(images.listCalls, 1);
    assert.equal(models.listCalls, 2);
    assert.deepEqual(models.listRequests.map((request) => request.includeDiscovered), [false, false]);
    assert.deepEqual(models.listRequests.map((request) => request.includeSharedStorage), [true, undefined]);
    assert.equal(viewIds.includes("asset-view.image.internal.image-1"), true);
    assert.equal(viewIds.includes("asset-view.model.internal.model-1"), true);
    assert.equal(new Set(viewIds).size, viewIds.length);
    assertSafe(result);

    const imageDetail = await provider.readResourceBackedView("asset-view.image.internal.image-1", { workspaceId: "workspace-a" as never });
    assert.equal(imageDetail?.viewKind, "image-asset");
    const modelDetail = await provider.readResourceBackedView("asset-view.model.internal.model-1", { workspaceId: "workspace-a" as never });
    assert.equal(modelDetail?.viewKind, "model");
    assertNoForbiddenSourceSideEffects(artifacts, images, models);
  });

  it("keeps same model and published-model registry reads deterministic and non-duplicating", async () => {
    const models = new FakeModelRegistry([model()]);
    const provider = composeResourceBackedViewProviders({
      modelRegistry: models,
      publishedModelRegistry: models,
    });

    const result = await provider.listResourceBackedViews({ workspaceId: "workspace-a" as never, limit: 20 });
    const modelViews = result.items.filter((item) => item.viewKind === "model");
    const externalViews = result.items.filter((item) => item.viewKind === "external-repository-object");

    assert.equal(models.listCalls, 2);
    assert.deepEqual(models.listRequests.map((request) => request.includeDiscovered), [false, false]);
    assert.deepEqual(models.listRequests.map((request) => request.includeSharedStorage), [true, undefined]);
    assert.deepEqual(modelViews.map((item) => item.viewId), ["asset-view.model.internal.model-1"]);
    assert.equal(externalViews.length, 1);
    assert.notEqual(externalViews[0]?.viewId, modelViews[0]?.viewId);
    assert.equal(
      result.diagnostics?.some((diagnostic) => diagnostic.code === "resource-backed-view-provider-duplicate-view-id") ?? false,
      false,
    );
    assertSafe(result);
    assertNoForbiddenSourceSideEffects(new FakeArtifactMetadataRead([]), new FakeImageDescriptorRead([]), models);
  });

  it("leaves missing families unsupported with sanitized diagnostics", async () => {
    const provider = composeResourceBackedViewProviders();
    const result = await provider.listResourceBackedViews({ limit: 10 });

    assert.deepEqual(result.items, []);
    assert.equal(result.diagnostics?.filter((diagnostic) => diagnostic.code === "resource-backed-view-provider-unsupported").length, 4);
    assertSafe(result);
  });

  it("imports no public transports, UI, runtime adapters, storage adapters, provider clients, or scan helpers", async () => {
    const source = await readFile(join(process.cwd(), "modules/hosts/shared/composition/composeResourceBackedViewProviders.ts"), "utf8");

    assert.doesNotMatch(source, /adapters\/transport|api-express|ipc-electron|electron|express|preload|renderer|thin-client|apps\//i);
    assert.doesNotMatch(source, /adapters\/runtime|adapters\/storage|adapters\/persistence|provider-client|huggingface|token/i);
    assert.doesNotMatch(source, /\b(?:readdir|readFile|opendir|glob|fetch|scan|runtimeTaskRegistry|startRuntime|readBytes|readContent)\b/i);
  });
});
