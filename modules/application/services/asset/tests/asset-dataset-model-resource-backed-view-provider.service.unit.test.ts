import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import type { DatasetDescriptor } from "../../../../contracts/dataset";
import type { ModelInventoryRecord } from "../../../../contracts/model";
import type { ModelRegistryPort } from "../../../ports/model";
import {
  AssetDatasetModelResourceBackedViewProvider,
  type SafeDatasetDescriptorSource,
} from "../asset-dataset-model-resource-backed-view-provider.service";

class FakeDatasetDescriptorSource implements SafeDatasetDescriptorSource {
  public listCalls = 0;
  public readCalls = 0;
  public prepareCalls = 0;
  public fileReadCalls = 0;
  public storageScanCalls = 0;
  public createDescriptorCalls = 0;
  public throws = false;
  public lastListQuery?: Parameters<SafeDatasetDescriptorSource["listDatasetDescriptors"]>[0];
  private readonly items: readonly DatasetDescriptor[];
  private readonly nextCursor?: string;

  public constructor(items: readonly DatasetDescriptor[], nextCursor?: string) {
    this.items = items;
    this.nextCursor = nextCursor;
  }

  public async listDatasetDescriptors(query?: Parameters<SafeDatasetDescriptorSource["listDatasetDescriptors"]>[0]) {
    this.listCalls += 1;
    this.lastListQuery = query;
    if (this.throws) throw new Error("/tmp/dataset secret token stack raw provider payload command bytes blob base64");
    return { items: [...this.items].slice(0, query?.limit), ...(this.nextCursor ? { nextCursor: this.nextCursor } : {}) };
  }

  public async readDatasetDescriptor(_workspaceId: string, datasetId: string) {
    this.readCalls += 1;
    return this.items.find((item) => item.id === datasetId);
  }
}

class FakeModelRegistry implements Pick<ModelRegistryPort, "listModels" | "getModelRecord"> {
  public listCalls = 0;
  public readCalls = 0;
  public discoveryCalls = 0;
  public validationCalls = 0;
  public trainingCalls = 0;
  public publishingCalls = 0;
  public localModelScanCalls = 0;
  public huggingFaceCacheScanCalls = 0;
  public createAssetInstanceCalls = 0;
  public persistMappingCalls = 0;
  public throws = false;
  public lastListRequest?: Parameters<ModelRegistryPort["listModels"]>[0];
  private readonly records: readonly ModelInventoryRecord[];
  private readonly nextCursor?: string;

  public constructor(records: readonly ModelInventoryRecord[], nextCursor?: string) {
    this.records = records;
    this.nextCursor = nextCursor;
  }

  public async listModels(request: Parameters<ModelRegistryPort["listModels"]>[0]) {
    this.listCalls += 1;
    this.lastListRequest = request;
    if (request.includeDiscovered !== false) this.discoveryCalls += 1;
    if (this.throws) throw new Error("C:\\Users\\name\\.cache\\huggingface secret token stack raw provider payload command bytes blob base64");
    return { models: [...this.records].slice(0, request.limit), ...(this.nextCursor ? { nextCursor: this.nextCursor } : {}) };
  }

  public async getModelRecord(_workspaceId: string, modelRecordId: string) {
    this.readCalls += 1;
    return this.records.find((record) => record.modelRecordId === modelRecordId);
  }
}

function dataset(overrides: Partial<DatasetDescriptor> = {}): DatasetDescriptor {
  return {
    id: "dataset-1",
    name: "Training Dataset",
    schema: { fieldCount: 2, fields: [{ name: "prompt", type: "string" }, { name: "completion", type: "string" }] },
    sourceArtifacts: [{ key: "artifact-source-1", label: "Source artifact" }],
    materializations: [{ artifactKey: "datasets/private/train.parquet", format: "parquet", rowCount: 100, materializedAt: "2026-01-01T00:00:00.000Z" }],
    transforms: [{ definitionId: "chunk-text" }],
    createdAt: "2026-01-01T00:00:00.000Z",
    metadata: { split: "train", materializationPath: "/tmp/datasets/train.parquet", token: "secret-token" },
    ...overrides,
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
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-02T00:00:00.000Z",
    taskTags: ["text-generation"],
    inferenceMode: "causal",
    serializationFormat: "safetensors",
    parameterCount: 7000000000,
    sizeBytes: 123456,
    backingArtifactIds: ["artifact-model-1"],
    primaryArtifactId: "artifact-model-1",
    baseModelId: "org/base-model",
    generatedFromRunId: "run-1",
    adapterOfModelId: "base-1",
    validationStatus: "valid",
    validationReportPath: "C:\\Users\\name\\reports\\model.json",
    published: { provider: "huggingface", repository: "org/demo-model", revision: "main", url: "https://huggingface.co/org/demo-model", publishedAt: "2026-01-03T00:00:00.000Z" },
    metadata: {
      safeLabel: "visible",
      checkpointPath: "/models/checkpoint.safetensors",
      cacheDirectory: "/home/name/.cache/huggingface",
      rawProviderPayload: { hidden: true },
      trainingLog: "raw training logs",
      commandLine: "python train.py --token hidden",
      env: { HF_TOKEN: "hidden" },
    },
    ...overrides,
  };
}

function serialized(value: unknown): string {
  return JSON.stringify(value).toLowerCase();
}

function assertSafe(value: unknown): void {
  const output = serialized(value);
  for (const unsafe of [
    "c:\\users",
    "/tmp",
    "/home/name",
    ".cache",
    "huggingface\\hub",
    "checkpointpath",
    "checkpoint.safetensors",
    "validationreportpath",
    "materializationpath",
    "datasets/private",
    "secret",
    "token",
    "authorization",
    "commandline",
    "stack",
    "rawproviderpayload",
    "raw provider payload",
    "traininglog",
    "validation report",
    "bytes",
    "blob",
    "base64",
    "hf_token",
  ]) {
    assert.equal(output.includes(unsafe), false, `serialized output included ${unsafe}: ${output}`);
  }
}

describe("AssetDatasetModelResourceBackedViewProvider", () => {
  it("maps a safe persisted model inventory record and disables discovery", async () => {
    const registry = new FakeModelRegistry([model()]);
    const provider = new AssetDatasetModelResourceBackedViewProvider({ modelRegistry: registry });

    const result = await provider.listResourceBackedViews({ workspaceId: "workspace-a" as never, viewKinds: ["model"], includeMetadata: true } as never);
    const view = result.items[0]!;

    assert.equal(view.viewKind, "model");
    assert.equal(view.assetType, "model");
    assert.equal(view.assetFamily, "resource-backed");
    assert.equal(view.assetDefinitionRef?.id, "builtin.model");
    assert.equal(view.resourceBacking?.resourceKind, "model");
    assert.equal(view.lifecycleStatus, "validated");
    assert.equal(view.validationSummary?.status, "valid");
    assert.equal(view.metadata?.provider, "huggingface");
    assert.deepEqual(view.metadata?.taskTags, ["text-generation"]);
    assert.equal(view.metadata?.artifactForm, "full-model");
    assert.equal(view.metadata?.inferenceMode, "causal");
    assert.equal(view.metadata?.parameterCount, 7000000000);
    assert.deepEqual(view.metadata?.backingArtifactIds, ["artifact-model-1"]);
    assert.equal(registry.lastListRequest?.includeDiscovered, false);
    assert.equal(registry.lastListRequest?.includeSharedStorage, true);
    assert.equal(registry.discoveryCalls, 0);
    assertSafe(result);
  });

  it("does not trigger local discovery, validation, training, publishing, asset creation, or mapping persistence", async () => {
    const registry = new FakeModelRegistry([model()]);
    await new AssetDatasetModelResourceBackedViewProvider({ modelRegistry: registry }).listResourceBackedViews({ workspaceId: "workspace-a" as never, viewKinds: ["model"] });

    assert.equal(registry.discoveryCalls, 0);
    assert.equal(registry.localModelScanCalls, 0);
    assert.equal(registry.huggingFaceCacheScanCalls, 0);
    assert.equal(registry.validationCalls, 0);
    assert.equal(registry.trainingCalls, 0);
    assert.equal(registry.publishingCalls, 0);
    assert.equal(registry.createAssetInstanceCalls, 0);
    assert.equal(registry.persistMappingCalls, 0);
  });

  it("maps a safe dataset descriptor from an injected descriptor source", async () => {
    const source = new FakeDatasetDescriptorSource([dataset()]);
    const result = await new AssetDatasetModelResourceBackedViewProvider({ datasetDescriptorSource: source }).listResourceBackedViews({ workspaceId: "workspace-a" as never,
      viewKinds: ["dataset"],
      limit: 10,
    });
    const view = result.items[0]!;

    assert.equal(view.viewKind, "dataset");
    assert.equal(view.assetType, "dataset");
    assert.equal(view.assetFamily, "resource-backed");
    assert.equal(view.assetDefinitionRef?.id, "builtin.dataset");
    assert.equal(view.resourceBacking?.resourceKind, "dataset");
    assert.equal(view.metadata?.sourceArtifactCount, 1);
    assert.equal(view.metadata?.materializationCount, 1);
    assert.equal((view.metadata?.schema as { fieldCount?: number } | undefined)?.fieldCount, 2);
    assertSafe(result);
  });

  it("returns unsupported diagnostics when dataset or model seams are missing", async () => {
    const result = await new AssetDatasetModelResourceBackedViewProvider().listResourceBackedViews({ workspaceId: "workspace-a" as never, limit: 10 });

    assert.deepEqual(result.items, []);
    assert.equal(result.diagnostics?.some((diagnostic) => diagnostic.code === "dataset-resource-backed-view-source-unavailable"), true);
    assert.equal(result.diagnostics?.some((diagnostic) => diagnostic.code === "model-resource-backed-view-source-unavailable"), true);
    assertSafe(result);
  });

  it("does not prepare datasets, read dataset files, scan storage, create descriptors, or persist mappings", async () => {
    const source = new FakeDatasetDescriptorSource([dataset()]);
    await new AssetDatasetModelResourceBackedViewProvider({ datasetDescriptorSource: source }).listResourceBackedViews({ workspaceId: "workspace-a" as never, viewKinds: ["dataset"] });

    assert.equal(source.prepareCalls, 0);
    assert.equal(source.fileReadCalls, 0);
    assert.equal(source.storageScanCalls, 0);
    assert.equal(source.createDescriptorCalls, 0);
  });

  it("supports safe limit, search, type/family/view-kind filters, and single-source cursors", async () => {
    const datasetSource = new FakeDatasetDescriptorSource([
      dataset({ id: "dataset-alpha", name: "Alpha Dataset" }),
      dataset({ id: "dataset-beta", name: "Beta Dataset" }),
    ], "next-dataset");
    const registry = new FakeModelRegistry([
      model({ modelRecordId: "model-alpha", displayName: "Alpha Model" }),
      model({ modelRecordId: "model-gamma", displayName: "Gamma Model" }),
    ], "next-model");
    const provider = new AssetDatasetModelResourceBackedViewProvider({ datasetDescriptorSource: datasetSource, modelRegistry: registry, maxListLimit: 2 });

    const limited = await provider.listResourceBackedViews({ workspaceId: "workspace-a" as never, limit: 99 });
    assert.equal(limited.items.length, 2);
    assert.equal(limited.diagnostics?.some((diagnostic) => diagnostic.code === "dataset-model-resource-backed-view-limit-clamped"), true);

    assert.deepEqual((await provider.listResourceBackedViews({ workspaceId: "workspace-a" as never, searchText: "gamma", limit: 10 })).items.map((item) => item.viewKind), ["model"]);
    assert.deepEqual((await provider.listResourceBackedViews({ workspaceId: "workspace-a" as never, assetTypes: ["dataset"], limit: 10 })).items.map((item) => item.viewKind), ["dataset", "dataset"]);
    assert.deepEqual((await provider.listResourceBackedViews({ workspaceId: "workspace-a" as never, assetFamilies: ["resource-backed"], viewKinds: ["model"], limit: 10 })).items.map((item) => item.displayName), ["Alpha Model", "Gamma Model"]);

    const datasetCursor = await provider.listResourceBackedViews({ workspaceId: "workspace-a" as never, viewKinds: ["dataset"], cursor: "cursor-dataset", limit: 10 });
    assert.equal(datasetSource.lastListQuery?.cursor, "cursor-dataset");
    assert.equal(datasetCursor.nextCursor, "next-dataset");

    const modelCursor = await provider.listResourceBackedViews({ workspaceId: "workspace-a" as never, viewKinds: ["model"], cursor: "cursor-model", limit: 10 });
    assert.equal(registry.lastListRequest?.cursor, "cursor-model");
    assert.equal(modelCursor.nextCursor, "next-model");
  });

  it("diagnoses combined cursor omission and sanitizes source failures", async () => {
    const datasetSource = new FakeDatasetDescriptorSource([dataset()], "next-dataset");
    const registry = new FakeModelRegistry([model()], "next-model");
    const provider = new AssetDatasetModelResourceBackedViewProvider({ datasetDescriptorSource: datasetSource, modelRegistry: registry });
    const combined = await provider.listResourceBackedViews({ workspaceId: "workspace-a" as never, cursor: "combined", limit: 10 });

    assert.equal(datasetSource.lastListQuery?.cursor, undefined);
    assert.equal(registry.lastListRequest?.cursor, undefined);
    assert.equal(combined.nextCursor, undefined);
    assert.equal(combined.diagnostics?.some((diagnostic) => diagnostic.code === "dataset-model-resource-backed-view-combined-cursor-unsupported"), true);

    datasetSource.throws = true;
    registry.throws = true;
    const failed = await provider.listResourceBackedViews({ workspaceId: "workspace-a" as never, limit: 10 });
    assert.equal(failed.diagnostics?.some((diagnostic) => diagnostic.code === "dataset-resource-backed-view-source-failed"), true);
    assert.equal(failed.diagnostics?.some((diagnostic) => diagnostic.code === "model-resource-backed-view-source-failed"), true);
    assertSafe([combined, failed]);
  });

  it("uses safe direct read seams and bounded fallback for details", async () => {
    const datasetSource = new FakeDatasetDescriptorSource([dataset({ id: "dataset-read" })]);
    const registry = new FakeModelRegistry([model({ modelRecordId: "model-read" })]);
    const provider = new AssetDatasetModelResourceBackedViewProvider({
      datasetDescriptorSource: datasetSource,
      modelRegistry: registry,
      maxListLimit: 1,
    });

    assert.equal((await provider.readResourceBackedView("asset-view.dataset.internal.dataset-read", { workspaceId: "workspace-a" as never }))?.viewKind, "dataset");
    assert.equal((await provider.readResourceBackedView("asset-view.model.internal.model-read", { workspaceId: "workspace-a" as never }))?.viewKind, "model");
    assert.equal(datasetSource.readCalls, 1);
    assert.equal(registry.readCalls, 1);
    assert.equal(await provider.readResourceBackedView("missing", { workspaceId: "workspace-a" as never }), undefined);

    const fallbackProvider = new AssetDatasetModelResourceBackedViewProvider({
      datasetDescriptorSource: { async listDatasetDescriptors() { return { items: [dataset({ id: "dataset-list-only" })] }; } },
      maxListLimit: 1,
    });
    const fallback = await fallbackProvider.readResourceBackedView("asset-view.dataset.internal.dataset-list-only", { workspaceId: "workspace-a" as never });
    assert.equal(fallback?.diagnostics?.some((diagnostic) => diagnostic.code === "dataset-model-resource-backed-view-detail-list-fallback-limited"), true);
  });

  it("imports no forbidden outer layers, storage adapters, discovery, runtime, validation, training, publishing, or byte-read seams", () => {
    const source = readFileSync("modules/application/services/asset/asset-dataset-model-resource-backed-view-provider.service.ts", "utf8");
    for (const forbidden of [
      "modules/adapters",
      "../../../adapters",
      "modules/hosts",
      "../../../hosts",
      "contracts/api",
      "contracts/ipc",
      "electron",
      "express",
      "preload",
      "renderer",
      "thin-client",
      "node:fs",
      "node:path",
      "fetch(",
      "DatasetPreparation",
      "PrepareTrainingDataset",
      "ModelTraining",
      "ModelValidationPort",
      "ModelPublisher",
      "PublishModel",
      "RuntimeTaskRegistryPort",
      "runtime-readiness",
      "readBytes",
      "readResourceBytes",
      "discoverModels(",
      "scanModels(",
      "scanDatasets(",
      "createAssetInstance(",
      "persistMapping(",
    ]) {
      assert.equal(source.includes(forbidden), false, `unexpected forbidden boundary: ${forbidden}`);
    }
  });
});
