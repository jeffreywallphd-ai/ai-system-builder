import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import type { AssetResourceBackedView } from "../../../../contracts/asset";
import type { ArtifactBrowseItem, ArtifactBrowseSuccessValue } from "../../../../contracts/artifact-browser";
import type { DatasetDescriptor } from "../../../../contracts/dataset";
import type { ModelInventoryRecord } from "../../../../contracts/model";
import { createSuccessResult, type ContractResult } from "../../../../contracts/shared";
import type { ArtifactBrowserMetadataReadPort } from "../../../ports/artifact-browser";
import type { AssetResourceBackedViewListQuery, AssetResourceBackedViewListResult, AssetResourceBackedViewProvider } from "../../../ports/asset";
import { createUnsupportedAssetResourceBackedViewProvider } from "../../../ports/asset";
import type { ModelRegistryPort } from "../../../ports/model";
import { ArtifactResourceBackedViewProvider } from "../asset-artifact-resource-backed-view-provider.service";
import { AssetDatasetModelResourceBackedViewProvider, type SafeDatasetDescriptorSource } from "../asset-dataset-model-resource-backed-view-provider.service";
import { AssetExternalRepositoryResourceBackedViewProvider, type SafeExternalRepositoryObjectDescriptorSource } from "../asset-external-repository-resource-backed-view-provider.service";
import { AssetImageResourceBackedViewProvider, type GeneratedImageOutputDescriptorSource } from "../asset-image-resource-backed-view-provider.service";
import { AssetResourceBackedViewAggregateProvider } from "../asset-resource-backed-view-aggregate-provider.service";

function view(viewId: string, displayName: string): AssetResourceBackedView {
  return {
    viewId,
    viewKind: "artifact",
    assetType: "data-source",
    assetFamily: "resource-backed",
    displayName,
    lifecycleStatus: "draft",
  };
}

class TestProvider implements AssetResourceBackedViewProvider {
  public readonly queries: AssetResourceBackedViewListQuery[] = [];
  public listCalls = 0;
  public readCalls = 0;

  public constructor(public readonly providerId: string, private readonly views: readonly AssetResourceBackedView[], private readonly nextCursor?: string) {}

  public async listResourceBackedViews(query: AssetResourceBackedViewListQuery = {}) {
    this.listCalls += 1;
    this.queries.push(query);
    return {
      items: this.views,
      ...(this.nextCursor ? { nextCursor: this.nextCursor } : {}),
      diagnostics: [{ severity: "info" as const, code: "provider-safe", message: "Safe diagnostic.", providerId: this.providerId, metadata: { safe: true } }],
    };
  }

  public async readResourceBackedView(viewId: string) {
    this.readCalls += 1;
    return this.views.find((item) => item.viewId === viewId);
  }
}

class ThrowingProvider implements AssetResourceBackedViewProvider {
  public readonly providerId = "throwing-provider";
  public async listResourceBackedViews(): Promise<AssetResourceBackedViewListResult> {
    throw new Error("C:\\Users\\jdwall\\secret token stack raw provider payload command bytes blob base64");
  }
  public async readResourceBackedView(): Promise<AssetResourceBackedView | undefined> {
    throw new Error("C:\\Users\\jdwall\\secret token stack raw provider payload command bytes blob base64");
  }
}

class FakeArtifactBrowserMetadataRead implements Pick<ArtifactBrowserMetadataReadPort, "browseArtifacts"> {
  public constructor(private readonly items: readonly ArtifactBrowseItem[]) {}

  public async browseArtifacts(): Promise<ContractResult<ArtifactBrowseSuccessValue>> {
    return createSuccessResult({ items: [...this.items] });
  }

  public async readArtifactDetail(request: Parameters<ArtifactBrowserMetadataReadPort["readArtifactDetail"]>[0]) {
    const item = this.items.find((candidate) => candidate.storageKey === request.locator.storageKey) ?? this.items[0]!;
    return createSuccessResult({
      artifact: {
        locator: request.locator,
        artifactFamily: item.artifactFamily,
        mediaType: item.mediaType,
        sourceKind: item.sourceKind,
        originalName: item.originalName,
      },
    });
  }
}

class FakeGeneratedOutputDescriptorSource implements GeneratedImageOutputDescriptorSource {
  public constructor(private readonly outputId: string) {}

  public async listGeneratedImageOutputDescriptors() {
    return {
      items: [
        {
          outputId: this.outputId,
          output: {
            type: "image" as const,
            engine: "comfyui",
            fileName: "Generated.png",
            mediaType: "image/png",
          },
        },
      ],
    };
  }
}

class FakeDatasetDescriptorSource implements SafeDatasetDescriptorSource {
  public prepareCalls = 0;
  public fileReadCalls = 0;
  public storageScanCalls = 0;
  public createDescriptorCalls = 0;

  public async listDatasetDescriptors() {
    return {
      items: [
        {
          id: "dataset-aggregate",
          name: "Aggregate Dataset",
          schema: { fieldCount: 1, fields: [{ name: "text", type: "string" }] },
          sourceArtifacts: [{ key: "artifact-dataset" }],
          materializations: [{ artifactKey: "datasets/private/train.parquet", format: "parquet", rowCount: 1 }],
          metadata: { localPath: "/tmp/dataset", token: "hidden" },
        } satisfies DatasetDescriptor,
      ],
    };
  }
}

class FakeExternalRepositoryObjectDescriptorSource implements SafeExternalRepositoryObjectDescriptorSource {
  public providerNetworkCalls = 0;
  public tokenReadCalls = 0;
  public byteReadCalls = 0;
  public importCalls = 0;
  public localizeCalls = 0;
  public publishCalls = 0;

  public async listExternalRepositoryObjectDescriptors() {
    return {
      items: [
        {
          descriptorId: "external-aggregate",
          provider: "huggingface",
          repositoryId: "org/external",
          revision: "main",
          objectPath: "objects/external.bin",
          objectKind: "file",
          metadata: { localPath: "/tmp/private", token: "hidden" },
        },
      ],
    };
  }
}

class FakeModelRegistry {
  public listCalls = 0;
  public discoveryCalls = 0;

  public constructor(private readonly records: readonly ModelInventoryRecord[]) {}

  public async listModels(request: Parameters<ModelRegistryPort["listModels"]>[0]) {
    this.listCalls += 1;
    if (request.includeDiscovered !== false) this.discoveryCalls += 1;
    return { models: [...this.records].slice(0, request.limit) };
  }

  public async getModelRecord(modelRecordId: string) {
    return this.records.find((record) => record.modelRecordId === modelRecordId);
  }
}

function artifactItem(artifactId: string, originalName: string, mediaType: string): ArtifactBrowseItem {
  return {
    artifactId,
    storageKey: `uploads/private/${originalName}`,
    artifactFamily: mediaType === "application/pdf" ? "document" : "binary",
    mediaType,
    originalName,
    sourceKind: "upload",
  };
}

function modelRecord(): ModelInventoryRecord {
  return {
    modelRecordId: "model-aggregate",
    displayName: "Aggregate Model",
    source: "generated",
    lifecycleStatus: "validated",
    artifactForm: "adapter",
    provider: "unknown",
    createdAt: "2026-01-01T00:00:00.000Z",
    validationStatus: "valid",
    localPath: "C:\\Users\\name\\.cache\\huggingface\\model",
  };
}

function assertSafe(value: unknown) {
  const output = JSON.stringify(value).toLowerCase();
  for (const unsafe of ["c:\\users", "/tmp", "secret", "token", "stack", "raw provider payload", "command", "bytes", "blob", "base64"]) {
    assert.equal(output.includes(unsafe), false, `serialized output included ${unsafe}: ${output}`);
  }
}

describe("AssetResourceBackedViewAggregateProvider", () => {
  it("combines provider results in deterministic order and preserves item ordering within providers", async () => {
    const first = new TestProvider("first-provider", [view("view.1", "One"), view("view.2", "Two")]);
    const second = new TestProvider("second-provider", [view("view.3", "Three")]);
    const aggregate = new AssetResourceBackedViewAggregateProvider({ providers: [first, second] });

    const result = await aggregate.listResourceBackedViews({ workspaceId: "workspace-a" });

    assert.deepEqual(result.items.map((item) => item.viewId), ["view.1", "view.2", "view.3"]);
    assert.equal(first.listCalls, 1);
    assert.equal(second.listCalls, 1);
  });

  it("returns an empty list when no providers are supplied", async () => {
    const aggregate = new AssetResourceBackedViewAggregateProvider();
    assert.deepEqual(await aggregate.listResourceBackedViews({ workspaceId: "workspace-a" }), { items: [] });
  });

  it("preserves safe diagnostics and sanitizes unsafe provider diagnostics/data", async () => {
    const provider: AssetResourceBackedViewProvider = {
      providerId: "unsafe-provider",
      async listResourceBackedViews() {
        return {
          items: [{ ...view("view.unsafe", "Unsafe"), metadata: { safe: "yes", localPath: "/tmp/private", token: "secret" } }],
          diagnostics: [{ severity: "warning", code: "provider-warning", message: "/tmp raw provider payload token", providerId: "unsafe-provider", metadata: { safe: true, path: "/tmp/private" } }],
        };
      },
      async readResourceBackedView() {
        return undefined;
      },
    };

    const result = await new AssetResourceBackedViewAggregateProvider({ providers: [provider] }).listResourceBackedViews({ workspaceId: "workspace-a", limit: 10 });

    assert.equal(result.items[0]?.metadata?.safe, "yes");
    assert.equal(result.diagnostics?.some((diagnostic) => diagnostic.code === "resource-backed-view-provider-unsafe-data"), true);
    assertSafe(result);
  });

  it("converts thrown provider errors into sanitized diagnostics", async () => {
    const result = await new AssetResourceBackedViewAggregateProvider({ providers: [new ThrowingProvider()] }).listResourceBackedViews();

    assert.deepEqual(result.items, []);
    assert.equal(result.diagnostics?.[0]?.code, "resource-backed-view-provider-partial-failure");
    assertSafe(result);
  });

  it("respects and clamps limit safely", async () => {
    const first = new TestProvider("first-provider", [view("view.1", "One"), view("view.2", "Two")]);
    const second = new TestProvider("second-provider", [view("view.3", "Three")]);
    const aggregate = new AssetResourceBackedViewAggregateProvider({ providers: [first, second], maxListLimit: 2 });

    const result = await aggregate.listResourceBackedViews({ limit: 50 });

    assert.deepEqual(result.items.map((item) => item.viewId), ["view.1", "view.2"]);
    assert.equal(second.listCalls, 0);
    assert.equal(result.diagnostics?.some((diagnostic) => diagnostic.code === "resource-backed-view-provider-limit-clamped"), true);
  });

  it("passes through a single provider cursor and diagnoses multi-provider cursors as first-page aggregation", async () => {
    const singleProvider = new TestProvider("single-provider", [view("view.1", "One")], "next.single");
    const single = await new AssetResourceBackedViewAggregateProvider({ providers: [singleProvider] }).listResourceBackedViews({ cursor: "cursor.one" });
    assert.equal(singleProvider.queries[0]?.cursor, "cursor.one");
    assert.equal(single.nextCursor, "next.single");

    const first = new TestProvider("first-provider", [view("view.1", "One")]);
    const second = new TestProvider("second-provider", [view("view.2", "Two")]);
    const multi = await new AssetResourceBackedViewAggregateProvider({ providers: [first, second] }).listResourceBackedViews({ cursor: "cursor.many" });
    assert.equal(first.queries[0]?.cursor, undefined);
    assert.equal(second.queries[0]?.cursor, undefined);
    assert.equal(multi.nextCursor, undefined);
    assert.equal(multi.diagnostics?.some((diagnostic) => diagnostic.code === "resource-backed-view-aggregate-cursor-unsupported"), true);
  });

  it("handles unsupported providers as non-fatal diagnostics", async () => {
    const unsupported = createUnsupportedAssetResourceBackedViewProvider({ providerId: "dataset-provider", sourceKind: "dataset" });
    const supported = new TestProvider("supported-provider", [view("view.1", "One")]);
    const result = await new AssetResourceBackedViewAggregateProvider({ providers: [unsupported, supported] }).listResourceBackedViews();

    assert.deepEqual(result.items.map((item) => item.viewId), ["view.1"]);
    assert.equal(result.diagnostics?.some((diagnostic) => diagnostic.code === "resource-backed-view-provider-unsupported"), true);
  });

  it("combines artifact/document provider results with unsupported providers", async () => {
    const artifactProvider = new ArtifactResourceBackedViewProvider({
      artifactBrowserMetadataRead: new FakeArtifactBrowserMetadataRead([
        artifactItem("artifact-report", "Report.pdf", "application/pdf"),
        artifactItem("artifact-binary", "Unknown.bin", "application/octet-stream"),
      ]),
    });
    const unsupported = createUnsupportedAssetResourceBackedViewProvider({ providerId: "dataset-provider", sourceKind: "dataset" });

    const result = await new AssetResourceBackedViewAggregateProvider({
      providers: [unsupported, artifactProvider],
      maxListLimit: 10,
    }).listResourceBackedViews({ workspaceId: "workspace-a", limit: 10 });

    assert.deepEqual(result.items.map((item) => item.viewKind), ["document", "artifact"]);
    assert.equal(result.diagnostics?.some((diagnostic) => diagnostic.code === "resource-backed-view-provider-unsupported"), true);
    assertSafe(result);
  });

  it("combines external repository results with artifact/document, image/generated-output, dataset/model, and unsupported providers deterministically", async () => {
    const artifactProvider = new ArtifactResourceBackedViewProvider({
      artifactBrowserMetadataRead: new FakeArtifactBrowserMetadataRead([
        artifactItem("artifact-report", "Report.pdf", "application/pdf"),
      ]),
    });
    const modelRegistry = new FakeModelRegistry([modelRecord()]);
    const datasetSource = new FakeDatasetDescriptorSource();
    const datasetModelProvider = new AssetDatasetModelResourceBackedViewProvider({
      datasetDescriptorSource: datasetSource,
      modelRegistry,
    });
    const imageProvider = new AssetImageResourceBackedViewProvider({
      generatedImageOutputDescriptorSource: new FakeGeneratedOutputDescriptorSource("generated-output-1"),
    });
    const externalSource = new FakeExternalRepositoryObjectDescriptorSource();
    const externalProvider = new AssetExternalRepositoryResourceBackedViewProvider({
      externalRepositoryObjectDescriptorSource: externalSource,
    });
    const unsupported = createUnsupportedAssetResourceBackedViewProvider({ providerId: "dataset-provider", sourceKind: "dataset" });

    const result = await new AssetResourceBackedViewAggregateProvider({
      providers: [unsupported, artifactProvider, datasetModelProvider, imageProvider, externalProvider],
      maxListLimit: 10,
    }).listResourceBackedViews({ workspaceId: "workspace-a", limit: 10 });

    assert.deepEqual(result.items.map((item) => item.viewKind), ["document", "dataset", "model", "generated-output", "external-repository-object"]);
    assert.equal(result.items[1]?.assetDefinitionRef?.id, "builtin.dataset");
    assert.equal(result.items[2]?.assetDefinitionRef?.id, "builtin.model");
    assert.equal(result.items[3]?.assetDefinitionRef, undefined);
    assert.equal(result.items[4]?.assetDefinitionRef, undefined);
    assert.equal(result.items[4]?.summary?.includes("not imported"), true);
    assert.equal(result.diagnostics?.some((diagnostic) => diagnostic.code === "resource-backed-view-provider-unsupported"), true);
    assert.equal(result.diagnostics?.some((diagnostic) => diagnostic.code === "image-resource-backed-view-image-source-unavailable"), true);
    assert.equal(modelRegistry.discoveryCalls, 0);
    assert.equal(datasetSource.prepareCalls + datasetSource.fileReadCalls + datasetSource.storageScanCalls + datasetSource.createDescriptorCalls, 0);
    assert.equal(externalSource.providerNetworkCalls + externalSource.tokenReadCalls + externalSource.byteReadCalls + externalSource.importCalls + externalSource.localizeCalls + externalSource.publishCalls, 0);
    assertSafe(result);
  });

  it("applies aggregate limits consistently across family providers", async () => {
    const artifactProvider = new ArtifactResourceBackedViewProvider({
      artifactBrowserMetadataRead: new FakeArtifactBrowserMetadataRead([
        artifactItem("artifact-report", "Report.pdf", "application/pdf"),
      ]),
    });
    const datasetModelProvider = new AssetDatasetModelResourceBackedViewProvider({
      datasetDescriptorSource: new FakeDatasetDescriptorSource(),
      modelRegistry: new FakeModelRegistry([modelRecord()]),
    });
    const imageProvider = new AssetImageResourceBackedViewProvider({
      generatedImageOutputDescriptorSource: new FakeGeneratedOutputDescriptorSource("generated-output-1"),
    });

    const result = await new AssetResourceBackedViewAggregateProvider({
      providers: [artifactProvider, datasetModelProvider, imageProvider],
      maxListLimit: 3,
    }).listResourceBackedViews({ workspaceId: "workspace-a", limit: 99 });

    assert.deepEqual(result.items.map((item) => item.viewKind), ["document", "dataset", "model"]);
    assert.equal(result.diagnostics?.some((diagnostic) => diagnostic.code === "resource-backed-view-provider-limit-clamped"), true);
  });

  it("omits duplicate aggregate view ids deterministically with diagnostics", async () => {
    const first = new TestProvider("first-provider", [view("duplicate-view", "First"), view("unique-first", "Unique First")]);
    const second = new TestProvider("second-provider", [view("duplicate-view", "Second"), view("unique-second", "Unique Second")]);
    const aggregate = new AssetResourceBackedViewAggregateProvider({ providers: [first, second] });

    const result = await aggregate.listResourceBackedViews({ limit: 10 });

    assert.deepEqual(result.items.map((item) => item.viewId), ["duplicate-view", "unique-first", "unique-second"]);
    assert.equal(result.items.filter((item) => item.viewId === "duplicate-view").length, 1);
    assert.equal(result.items.find((item) => item.viewId === "duplicate-view")?.displayName, "First");
    assert.equal(result.diagnostics?.some((diagnostic) => diagnostic.code === "resource-backed-view-provider-duplicate-view-id"), true);
    assert.equal((await aggregate.readResourceBackedView("duplicate-view"))?.displayName, "First");
  });

  it("keeps generated-output views distinct from image asset views when ids could otherwise collide", async () => {
    const imageProvider = new AssetImageResourceBackedViewProvider({
      imageAssetDescriptorRead: {
        async listImageAssetDescriptors() {
          return {
            items: [
              {
                assetId: "shared",
                artifactId: "artifact-shared",
                source: "generated" as const,
                metadata: { originalFileName: "Final.png", createdAt: "2026-01-01T00:00:00.000Z" },
              },
            ],
          };
        },
      },
      generatedImageOutputDescriptorSource: new FakeGeneratedOutputDescriptorSource("shared"),
    });

    const result = await new AssetResourceBackedViewAggregateProvider({ providers: [imageProvider], maxListLimit: 10 }).listResourceBackedViews({ workspaceId: "workspace-a", limit: 10 });

    assert.deepEqual(result.items.map((item) => item.viewKind), ["image-asset", "generated-output"]);
    assert.notEqual(result.items[0]?.viewId, result.items[1]?.viewId);
  });

  it("readResourceBackedView returns the first matching safe view and honors provider-scoped ids", async () => {
    const first = new TestProvider("first-provider", [view("shared", "First")]);
    const second = new TestProvider("second-provider", [view("shared", "Second"), view("only-second", "Only Second")]);
    const aggregate = new AssetResourceBackedViewAggregateProvider({ providers: [first, second] });

    assert.equal((await aggregate.readResourceBackedView("shared"))?.displayName, "First");
    assert.equal((await aggregate.readResourceBackedView("second-provider::only-second"))?.displayName, "Only Second");
    assert.equal(first.readCalls, 1);
    assert.equal(second.readCalls, 1);
  });

  it("routes detail reads to the known owning provider after list without changing public view ids", async () => {
    const first = new TestProvider("first-provider", [view("view.1", "One")]);
    const second = new TestProvider("second-provider", [view("view.2", "Two")]);
    const aggregate = new AssetResourceBackedViewAggregateProvider({ providers: [first, second] });

    await aggregate.listResourceBackedViews({ workspaceId: "workspace-a" });
    assert.equal((await aggregate.readResourceBackedView("view.2"))?.displayName, "Two");
    assert.equal(first.readCalls, 0);
    assert.equal(second.readCalls, 1);
  });

  it("does not expose mutation, scanning, runtime, network, or byte-read behavior", async () => {
    const source = readFileSync("modules/application/services/asset/asset-resource-backed-view-aggregate-provider.service.ts", "utf8");
    assert.doesNotMatch(source, /\b(?:save|update|delete|seed|register|importAsset|finalize|execute|startRuntime|probeRuntime|installRuntime|repairRuntime)\b/i);
    assert.doesNotMatch(source, /node:fs|node:http|node:https|fetch\(|readdir|opendir|glob|scanResources|readBytes|readResourceBytes/i);
  });
});
