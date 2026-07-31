import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import type { ModelInventoryRecord } from "../../../../contracts/model";
import type { ArtifactStorageBinding } from "../../../../contracts/storage";
import type { ModelRegistryPort } from "../../../ports/model";
import {
  AssetExternalRepositoryResourceBackedViewProvider,
  type SafeArtifactRepoObjectDescriptorSource,
  type SafeExternalRepositoryObjectDescriptor,
  type SafeExternalRepositoryObjectDescriptorSource,
} from "../asset-external-repository-resource-backed-view-provider.service";

class FakeExternalDescriptorSource implements SafeExternalRepositoryObjectDescriptorSource {
  public listCalls = 0;
  public readCalls = 0;
  public huggingFaceListFilesCalls = 0;
  public huggingFaceRepoInfoCalls = 0;
  public huggingFaceDownloadCalls = 0;
  public tokenReadCalls = 0;
  public providerBrowseCalls = 0;
  public providerRetrieveCalls = 0;
  public providerStoreCalls = 0;
  public providerPublishCalls = 0;
  public providerLocalizeCalls = 0;
  public createAssetInstanceCalls = 0;
  public persistMappingCalls = 0;
  public byteReadCalls = 0;
  public throws = false;
  public lastListQuery?: Parameters<SafeExternalRepositoryObjectDescriptorSource["listExternalRepositoryObjectDescriptors"]>[0];

  public constructor(private readonly items: readonly SafeExternalRepositoryObjectDescriptor[], private readonly nextCursor?: string) {}

  public async listExternalRepositoryObjectDescriptors(query?: Parameters<SafeExternalRepositoryObjectDescriptorSource["listExternalRepositoryObjectDescriptors"]>[0]) {
    this.listCalls += 1;
    this.lastListQuery = query;
    if (this.throws) throw new Error("C:\\Users\\name\\.cache\\huggingface token secret signedUrl stack command raw provider payload bytes blob base64");
    return { items: [...this.items].slice(0, query?.limit), ...(this.nextCursor ? { nextCursor: this.nextCursor } : {}) };
  }

  public async readExternalRepositoryObjectDescriptor(descriptorId: string) {
    this.readCalls += 1;
    return this.items.find((item) => item.descriptorId === descriptorId);
  }
}

class FakeArtifactRepoDescriptorSource implements SafeArtifactRepoObjectDescriptorSource {
  public listCalls = 0;
  public readCalls = 0;
  public hasCalls = 0;
  public retrieveCalls = 0;
  public storeCalls = 0;
  public publishCalls = 0;
  public localizeCalls = 0;
  public throws = false;

  public constructor(private readonly nextCursor?: string) {}

  public async listArtifactRepoObjectDescriptors(query?: Parameters<SafeArtifactRepoObjectDescriptorSource["listArtifactRepoObjectDescriptors"]>[0]) {
    this.listCalls += 1;
    if (this.throws) throw new Error("/tmp/provider token secret raw provider payload stack command bytes blob base64");
    return {
      items: [
        {
          descriptorId: "artifact-repo-one",
          displayName: "Repo Artifact",
          descriptor: {
            target: {
              provider: "huggingface",
              repository: "org/artifacts",
              revision: "main",
              path: "reports/summary.json",
            },
            mediaType: "application/json",
            sizeBytes: 123,
            checksum: { algorithm: "sha256", value: "abc123" },
          },
        },
      ].slice(0, query?.limit),
      ...(this.nextCursor ? { nextCursor: this.nextCursor } : {}),
    };
  }

  public async readArtifactRepoObjectDescriptor(descriptorId: string) {
    this.readCalls += 1;
    const result = await this.listArtifactRepoObjectDescriptors();
    return result.items.find((item) => item.descriptorId === descriptorId);
  }
}

class FakeModelRegistry implements Pick<ModelRegistryPort, "listModels" | "getModelRecord"> {
  public discoveryCalls = 0;
  public publishingCalls = 0;
  public validationCalls = 0;
  public runtimeCalls = 0;
  public tokenReadCalls = 0;

  private readonly records: readonly ModelInventoryRecord[] = [
    {
      modelRecordId: "model-published",
      displayName: "Published Model",
      source: "generated",
      provider: "huggingface",
      lifecycleStatus: "validated",
      artifactForm: "full-model",
      createdAt: "2026-01-01T00:00:00.000Z",
      published: {
        provider: "huggingface",
        repository: "org/model",
        revision: "main",
        url: "https://huggingface.co/org/model?token=hidden",
        publishedAt: "2026-01-02T00:00:00.000Z",
      },
      localPath: "C:\\Users\\name\\.cache\\huggingface\\model",
      metadata: unsafeMetadata(),
    },
  ];

  public async listModels(request: Parameters<ModelRegistryPort["listModels"]>[0]) {
    if (request.includeDiscovered !== false) this.discoveryCalls += 1;
    return { models: this.records.slice(0, request.limit) };
  }

  public async getModelRecord(modelRecordId: string) {
    return this.records.find((record) => record.modelRecordId === modelRecordId);
  }
}

function safeDescriptor(overrides: Partial<SafeExternalRepositoryObjectDescriptor> = {}): SafeExternalRepositoryObjectDescriptor {
  return {
    descriptorId: "external-one",
    provider: "huggingface",
    repositoryId: "org/demo",
    revision: "main",
    objectPath: "models/model.safetensors",
    objectKind: "model",
    contentType: "application/octet-stream",
    sizeBytes: 456,
    checksum: { algorithm: "sha256", value: "def456" },
    registered: false,
    metadata: {
      safeLabel: "visible",
      signedUrl: "https://example.invalid/download?X-Amz-Signature=secret",
      authorization: "Bearer hidden",
      localPath: "C:\\Users\\name\\.cache\\huggingface\\file",
      rawProviderPayload: { token: "hidden" },
      bytes: "AAAA",
    },
    ...overrides,
  };
}

function storageBinding(): ArtifactStorageBinding {
  return {
    artifactId: "artifact-one",
    role: "published",
    createdAt: "2026-01-01T00:00:00.000Z",
    backing: {
      kind: "artifact-repo",
      provider: "huggingface",
      locator: "org/artifacts/reports/summary.json",
      target: {
        provider: "huggingface",
        repository: "org/artifacts",
        revision: "main",
        path: "reports/summary.json",
      },
      verification: {
        exists: true,
        verifiedAt: "2026-01-02T00:00:00.000Z",
      },
    },
  };
}

function unsafeMetadata() {
  return {
    safe: "visible",
    signedUrl: "https://example.invalid/file?token=hidden",
    token: "bearer hidden",
    apiKey: "api_key=hidden",
    password: "password=hidden",
    authHeader: "authorization: bearer hidden",
    localPath: "/tmp/private/file",
    cachePath: "/home/name/.cache/huggingface",
    storageRoot: "/data/storage",
    runtimeRoot: "/opt/runtime",
    commandLine: "curl --token hidden",
    stackTrace: "Error: stack",
    rawProviderPayload: { hidden: true },
    objectContent: "contents",
    bytes: "AAAA",
    blob: "BBBB",
    contentBase64: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ=",
    env: { HF_TOKEN: "hidden" },
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
    "/data/storage",
    "/opt/runtime",
    ".cache",
    "signedurl",
    "x-amz-signature",
    "?token",
    "authorization",
    "bearer",
    "api_key",
    "apikey",
    "password",
    "secret",
    "authheader",
    "commandline",
    "stacktrace",
    "rawproviderpayload",
    "objectcontent",
    "contentbase64",
    "hf_token",
    "bytes",
    "blob",
    "hidden",
  ]) {
    assert.equal(output.includes(unsafe), false, `serialized output included ${unsafe}: ${output}`);
  }
}

describe("AssetExternalRepositoryResourceBackedViewProvider", () => {
  it("maps a safe external repository descriptor to a metadata-only external object view", async () => {
    const source = new FakeExternalDescriptorSource([safeDescriptor()]);
    const result = await new AssetExternalRepositoryResourceBackedViewProvider({
      externalRepositoryObjectDescriptorSource: source,
    }).listResourceBackedViews({ limit: 10 });
    const view = result.items[0]!;

    assert.equal(view.viewKind, "external-repository-object");
    assert.equal(view.assetType, "model");
    assert.equal(view.assetFamily, "resource-backed");
    assert.equal(view.assetDefinitionRef, undefined);
    assert.equal(view.assetInstanceRef, undefined);
    assert.equal(view.resourceBackedAsset, undefined);
    assert.equal(view.resourceBacking?.resourceKind, "external-repository-object");
    assert.equal(view.displayName, "model.safetensors");
    assert.equal(view.summary?.includes("not imported"), true);
    assert.equal(view.metadata?.provider, "huggingface");
    assert.equal(view.metadata?.repositoryId, "org/demo");
    assert.equal(view.metadata?.registered, false);
    assert.equal(serialized(view).includes("models/model.safetensors"), false);
    assert.equal(serialized(view).includes("assetid"), false);
    assertSafe(result);
  });

  it("maps Hugging Face-style metadata from injected descriptors without calling Hugging Face, tokens, or bytes", async () => {
    const source = new FakeExternalDescriptorSource([safeDescriptor({ descriptorId: "hf-file", objectKind: "file", objectPath: "README.md" })]);
    const provider = new AssetExternalRepositoryResourceBackedViewProvider({ externalRepositoryObjectDescriptorSource: source });
    const view = (await provider.listResourceBackedViews({ searchText: "readme", limit: 5 })).items[0]!;

    assert.equal(view.assetType, "data-source");
    assert.equal(view.displayName, "README.md");
    assert.equal(source.huggingFaceListFilesCalls + source.huggingFaceRepoInfoCalls + source.huggingFaceDownloadCalls, 0);
    assert.equal(source.tokenReadCalls + source.byteReadCalls, 0);
    assertSafe(view);
  });

  it("treats local, http, and custom provider labels as descriptor metadata only", async () => {
    const source = new FakeExternalDescriptorSource([
      safeDescriptor({
        descriptorId: "local-object",
        provider: "local",
        repositoryId: "org/local-metadata",
        objectName: "Local Metadata Object",
        objectPath: "safe/repo-relative.bin",
        objectKind: "file",
        metadata: {
          localPath: "C:\\Users\\name\\private\\safe\\repo-relative.bin",
          cachePath: "/home/name/.cache/huggingface/file",
        },
      }),
      safeDescriptor({
        descriptorId: "http-object",
        provider: "http",
        repositoryId: "org/http-metadata",
        objectName: "HTTP Metadata Object",
        objectPath: "safe/http-object.json",
        objectKind: "file",
        metadata: {
          downloadUrl: "https://example.invalid/object.json?token=hidden",
          signedUrl: "https://example.invalid/object.json?X-Amz-Signature=hidden",
        },
      }),
      safeDescriptor({
        descriptorId: "custom-object",
        provider: "artifact-repo",
        repositoryId: "org/custom-metadata",
        objectName: "Custom Metadata Object",
        objectPath: "safe/custom-object.json",
        objectKind: "artifact",
      }),
    ]);

    const result = await new AssetExternalRepositoryResourceBackedViewProvider({
      externalRepositoryObjectDescriptorSource: source,
    }).listResourceBackedViews({ limit: 10 });

    assert.deepEqual(result.items.map((item) => item.metadata?.provider), ["local", "http", "custom"]);
    assert.deepEqual(result.items.map((item) => item.displayName), ["Local Metadata Object", "HTTP Metadata Object", "Custom Metadata Object"]);
    assert.equal(result.items.every((item) => item.viewKind === "external-repository-object"), true);
    assert.equal(result.items.every((item) => item.assetInstanceRef === undefined && item.resourceBackedAsset === undefined), true);
    assert.equal(result.items.every((item) => item.summary?.includes("not imported")), true);
    assert.equal(
      source.providerBrowseCalls + source.providerRetrieveCalls + source.providerStoreCalls + source.providerPublishCalls +
        source.providerLocalizeCalls + source.tokenReadCalls + source.byteReadCalls,
      0,
    );
    assertSafe(result);
    assert.equal(serialized(result).includes("safe/repo-relative.bin"), false);
    assert.equal(serialized(result).includes("safe/http-object.json"), false);
    assert.equal(serialized(result).includes("safe/custom-object.json"), false);
  });

  it("omits repository object paths by default and diagnoses unsafe object paths", async () => {
    const source = new FakeExternalDescriptorSource([
      safeDescriptor({
        descriptorId: "safe-object-path",
        provider: "huggingface",
        repositoryId: "org/path-policy",
        objectName: "Safe Path Object",
        objectPath: "repo/relative/model.safetensors",
      }),
      safeDescriptor({
        descriptorId: "unsafe-object-path",
        provider: "huggingface",
        repositoryId: "org/path-policy",
        objectPath: "../private/model.safetensors",
        objectKind: "file",
      }),
    ]);

    const result = await new AssetExternalRepositoryResourceBackedViewProvider({
      externalRepositoryObjectDescriptorSource: source,
    }).listResourceBackedViews({ limit: 10 });

    assert.deepEqual(result.items.map((item) => item.viewId), ["asset-view.external-repository-object.internal.safe-object-path"]);
    assert.equal(serialized(result).includes("repo/relative/model.safetensors"), false);
    assert.equal(serialized(result).includes("../private"), false);
    assert.equal(result.diagnostics?.some((diagnostic) => diagnostic.code === "external-repository-resource-backed-view-object-path-omitted"), true);
    assert.equal(result.diagnostics?.some((diagnostic) => diagnostic.code === "external-repository-resource-backed-view-skipped-invalid-descriptor"), true);
    assertSafe(result);
  });

  it("maps artifact-repo descriptors and storage binding metadata without provider client calls", async () => {
    const artifactRepoSource = new FakeArtifactRepoDescriptorSource();
    const provider = new AssetExternalRepositoryResourceBackedViewProvider({
      artifactRepoObjectDescriptorSource: artifactRepoSource,
      artifactStorageBindingSource: {
        async listArtifactStorageBindings() {
          return { bindings: [storageBinding()] };
        },
      },
    });
    const result = await provider.listResourceBackedViews({ limit: 10 });

    assert.deepEqual(result.items.map((item) => item.viewKind), ["external-repository-object", "external-repository-object"]);
    assert.equal(result.items[0]?.metadata?.sourceDescriptorKind, "artifact-repo-object");
    assert.equal(result.items[1]?.metadata?.sourceDescriptorKind, "artifact-storage-binding");
    assert.equal(artifactRepoSource.hasCalls + artifactRepoSource.retrieveCalls + artifactRepoSource.storeCalls + artifactRepoSource.publishCalls + artifactRepoSource.localizeCalls, 0);
    assertSafe(result);
  });

  it("maps persisted published model metadata without discovery, publish, validation, runtime, or token calls", async () => {
    const registry = new FakeModelRegistry();
    const result = await new AssetExternalRepositoryResourceBackedViewProvider({
      publishedModelRegistry: registry,
    }).listResourceBackedViews({ limit: 10 });
    const view = result.items[0]!;

    assert.equal(view.viewKind, "external-repository-object");
    assert.equal(view.assetType, "model");
    assert.equal(view.metadata?.sourceDescriptorKind, "published-model-metadata");
    assert.equal(view.metadata?.published, true);
    assert.equal(view.metadata?.registered, false);
    assert.equal(registry.discoveryCalls + registry.publishingCalls + registry.validationCalls + registry.runtimeCalls + registry.tokenReadCalls, 0);
    assertSafe(result);
  });

  it("returns unsupported diagnostics when no safe descriptor source is wired", async () => {
    const result = await new AssetExternalRepositoryResourceBackedViewProvider().listResourceBackedViews({ limit: 10 });

    assert.deepEqual(result.items, []);
    assert.equal(result.diagnostics?.some((diagnostic) => diagnostic.code === "external-repository-resource-backed-view-source-unavailable"), true);
    assertSafe(result);
  });

  it("supports safe limit, search, filters, direct reads, and single-source cursor pass-through", async () => {
    const source = new FakeExternalDescriptorSource([
      safeDescriptor({ descriptorId: "alpha", repositoryId: "org/alpha", objectPath: "weights/alpha.safetensors", objectKind: "model" }),
      safeDescriptor({ descriptorId: "beta", repositoryId: "org/beta", objectPath: "data/train.parquet", objectKind: "dataset", contentType: "application/octet-stream" }),
    ], "next-external");
    const provider = new AssetExternalRepositoryResourceBackedViewProvider({
      externalRepositoryObjectDescriptorSource: source,
      maxListLimit: 2,
    });

    const limited = await provider.listResourceBackedViews({ limit: 99 });
    assert.equal(limited.items.length, 2);
    assert.equal(limited.diagnostics?.some((diagnostic) => diagnostic.code === "external-repository-resource-backed-view-limit-clamped"), true);

    const searched = await provider.listResourceBackedViews({ searchText: "beta", limit: 10 });
    assert.deepEqual(searched.items.map((item) => item.assetType), ["dataset"]);

    const filtered = await provider.listResourceBackedViews({ assetTypes: ["model"], assetFamilies: ["resource-backed"], viewKinds: ["external-repository-object"], limit: 10 });
    assert.deepEqual(filtered.items.map((item) => item.displayName), ["alpha.safetensors"]);

    const cursor = await provider.listResourceBackedViews({ cursor: "cursor-one", limit: 10 });
    assert.equal(source.lastListQuery?.cursor, "cursor-one");
    assert.equal(cursor.nextCursor, "next-external");

    const detail = await provider.readResourceBackedView("asset-view.external-repository-object.internal.alpha");
    assert.equal(detail?.displayName, "alpha.safetensors");
    assert.equal(source.readCalls, 1);
    assert.equal(await provider.readResourceBackedView("missing"), undefined);
    assertSafe([limited, searched, filtered, cursor, detail]);
  });

  it("diagnoses combined cursor omission and sanitizes source failures", async () => {
    const source = new FakeExternalDescriptorSource([safeDescriptor()], "next-external");
    const artifactSource = new FakeArtifactRepoDescriptorSource("next-artifact");
    const provider = new AssetExternalRepositoryResourceBackedViewProvider({
      externalRepositoryObjectDescriptorSource: source,
      artifactRepoObjectDescriptorSource: artifactSource,
    });

    const combined = await provider.listResourceBackedViews({ cursor: "combined", limit: 10 });
    assert.equal(source.lastListQuery?.cursor, undefined);
    assert.equal(combined.nextCursor, undefined);
    assert.equal(combined.diagnostics?.some((diagnostic) => diagnostic.code === "external-repository-resource-backed-view-combined-cursor-unsupported"), true);
    assert.equal(combined.diagnostics?.some((diagnostic) => diagnostic.code === "external-repository-resource-backed-view-next-cursor-omitted"), true);

    source.throws = true;
    artifactSource.throws = true;
    const failed = await provider.listResourceBackedViews({ limit: 10 });
    assert.equal(failed.diagnostics?.some((diagnostic) => diagnostic.code === "external-repository-resource-backed-view-source-failed"), true);
    assert.equal(failed.diagnostics?.some((diagnostic) => diagnostic.code === "external-repository-resource-backed-view-artifact-repo-source-failed"), true);
    assertSafe([combined, failed]);
  });

  it("skips unsafe descriptors and never creates assets or persisted mappings", async () => {
    const source = new FakeExternalDescriptorSource([
      safeDescriptor({
        descriptorId: "unsafe-url",
        repositoryId: "https://huggingface.co/org/repo?token=hidden",
        objectPath: "/tmp/cache/model.safetensors",
      }),
      safeDescriptor({ descriptorId: "safe" }),
    ]);
    const result = await new AssetExternalRepositoryResourceBackedViewProvider({
      externalRepositoryObjectDescriptorSource: source,
    }).listResourceBackedViews({ limit: 10 });

    assert.deepEqual(result.items.map((item) => item.viewId), ["asset-view.external-repository-object.internal.safe"]);
    assert.equal(result.diagnostics?.some((diagnostic) => diagnostic.code === "external-repository-resource-backed-view-skipped-invalid-descriptor"), true);
    assert.equal(source.createAssetInstanceCalls + source.persistMappingCalls, 0);
    assertSafe(result);
  });

  it("imports no forbidden outer layers, provider clients, token stores, runtime, byte-read, import, localize, publish, or mutation seams", () => {
    const source = readFileSync("modules/application/services/asset/asset-external-repository-resource-backed-view-provider.service.ts", "utf8");
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
      "node:http",
      "node:https",
      "fetch(",
      "HuggingFaceRepoBrowserPort",
      "ArtifactRepoStoragePort",
      "CredentialStore",
      "TokenStore",
      "HF_TOKEN",
      "listFiles",
      "repoInfo",
      "download(",
      "upload(",
      "commit(",
      "createRepo",
      "whoami",
      "retrieveArtifactFromRepo",
      "storeArtifactInRepo",
      "hasArtifactInRepo",
      "PublishModelUseCase",
      "PublishArtifact",
      "LocalizeArtifact",
      "RegisterArtifact",
      "RuntimeTaskRegistryPort",
      "runtime-readiness",
      "readBytes",
      "readResourceBytes",
      "createAssetInstance(",
      "persistMapping(",
    ]) {
      assert.equal(source.includes(forbidden), false, `unexpected forbidden boundary: ${forbidden}`);
    }
  });
});
