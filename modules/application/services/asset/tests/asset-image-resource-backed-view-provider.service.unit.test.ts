import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import type { ImageAsset } from "../../../../contracts/image";
import type { ImageGenerationOutput } from "../../../../contracts/image-generation";
import type { ImageAssetDescriptorReadPort } from "../../../ports/image";
import {
  AssetImageResourceBackedViewProvider,
  type GeneratedImageOutputDescriptor,
  type GeneratedImageOutputDescriptorSource,
} from "../asset-image-resource-backed-view-provider.service";

class FakeImageAssetDescriptorRead implements ImageAssetDescriptorReadPort {
  public listCalls = 0;
  public readCalls = 0;
  public byteReadCalls = 0;
  public storageScanCalls = 0;
  public createAssetInstanceCalls = 0;
  public persistMappingCalls = 0;
  public registerImageAssetCalls = 0;
  public finalizeCalls = 0;
  public throws = false;
  public lastListQuery: Parameters<ImageAssetDescriptorReadPort["listImageAssetDescriptors"]>[0];

  public constructor(private readonly items: readonly ImageAsset[]) {}

  public async listImageAssetDescriptors(query?: Parameters<ImageAssetDescriptorReadPort["listImageAssetDescriptors"]>[0]) {
    this.listCalls += 1;
    this.lastListQuery = query;
    if (this.throws) throw new Error("C:\\Users\\name\\secret token stack raw provider payload command bytes blob base64 prompt");
    return { items: [...this.items].slice(0, query?.limit), nextCursor: query?.cursor ? "next-image" : undefined };
  }

  public async readImageAssetDescriptor(_workspaceId: string, assetId: string) {
    this.readCalls += 1;
    return this.items.find((item) => item.assetId === assetId);
  }
}

class FakeGeneratedOutputDescriptorSource implements GeneratedImageOutputDescriptorSource {
  public listCalls = 0;
  public readCalls = 0;
  public byteReadCalls = 0;
  public runtimeStatusCalls = 0;
  public imageGenerationCalls = 0;
  public comfyUiCalls = 0;
  public storageScanCalls = 0;
  public createAssetInstanceCalls = 0;
  public persistMappingCalls = 0;
  public finalizeCalls = 0;
  public throws = false;
  public lastListQuery: Parameters<GeneratedImageOutputDescriptorSource["listGeneratedImageOutputDescriptors"]>[0];

  public constructor(private readonly items: readonly GeneratedImageOutputDescriptor[]) {}

  public async listGeneratedImageOutputDescriptors(query?: Parameters<GeneratedImageOutputDescriptorSource["listGeneratedImageOutputDescriptors"]>[0]) {
    this.listCalls += 1;
    this.lastListQuery = query;
    if (this.throws) throw new Error("/tmp/secret token stack raw provider payload command bytes blob base64 prompt");
    return { items: [...this.items].slice(0, query?.limit), nextCursor: query?.cursor ? "next-generated" : undefined };
  }

  public async readGeneratedImageOutputDescriptor(_workspaceId: string, outputId: string) {
    this.readCalls += 1;
    return this.items.find((item) => item.outputId === outputId);
  }
}

function imageAsset(overrides: Partial<ImageAsset> = {}): ImageAsset {
  return {
    assetId: "image-1",
    artifactId: "artifact-1",
    source: "generated",
    metadata: {
      originalFileName: "Final image.png",
      prompt: "a hidden prompt",
      negativePrompt: "hidden negative prompt",
      seed: 42,
      model: "sdxl-base",
      engine: "comfyui",
      workflowTemplateId: "template-1",
      width: 512,
      height: 768,
      createdAt: "2026-01-01T00:00:00.000Z",
      requestId: "request-hidden",
    },
    ...overrides,
  };
}

function output(overrides: Partial<ImageGenerationOutput> = {}): ImageGenerationOutput {
  return {
    type: "image",
    engine: "comfyui",
    fileName: "draft.png",
    subfolder: "C:\\Users\\name\\ComfyUI\\output",
    contentBase64: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ=",
    mediaType: "image/png",
    promptId: "prompt-hidden",
    width: 640,
    height: 640,
    ...overrides,
  };
}

function serialized(value: unknown): string {
  return JSON.stringify(value).toLowerCase();
}

function assertSafe(value: unknown): void {
  const outputText = serialized(value);
  for (const unsafe of [
    "c:\\users",
    "/tmp",
    "secret",
    "token",
    "password",
    "authorization",
    "api_key",
    "commandline",
    "stacktrace",
    "rawpayload",
    "raw provider payload",
    "blobbytes",
    "contentbase64",
    "base64",
    "data:image",
    "a hidden prompt",
    "hidden negative prompt",
    "prompt-hidden",
    "request-hidden",
    "task-hidden",
    "workflow",
  ]) {
    assert.equal(outputText.includes(unsafe), false, `serialized output included ${unsafe}: ${outputText}`);
  }
}

describe("AssetImageResourceBackedViewProvider", () => {
  it("maps a safe finalized image asset descriptor to an image resource-backed view", async () => {
    const imageSource = new FakeImageAssetDescriptorRead([imageAsset()]);
    const provider = new AssetImageResourceBackedViewProvider({ imageAssetDescriptorRead: imageSource });

    const result = await provider.listResourceBackedViews({ workspaceId: "workspace-a" as never, viewKinds: ["image-asset"] });
    const view = result.items[0]!;

    assert.equal(view.viewKind, "image-asset");
    assert.equal(view.assetType, "image");
    assert.equal(view.assetFamily, "resource-backed");
    assert.equal(view.assetDefinitionRef?.id, "builtin.resource-backed-image");
    assert.equal(view.lifecycleStatus, "published");
    assert.equal(view.summary?.includes("not a newly registered Asset Kernel instance"), true);
    assert.equal(view.resourceBacking?.resourceKind, "image");
    assert.equal((view.resourceBacking?.ref as { kind?: string } | undefined)?.kind, "artifact");
    assert.equal(view.resourceBackedAsset?.assetRef.kind, "resource-backed-asset");
    assertSafe(result);
  });

  it("returns safe unsupported diagnostics when finalized image asset listing is not wired", async () => {
    const result = await new AssetImageResourceBackedViewProvider().listResourceBackedViews({ workspaceId: "workspace-a" as never, viewKinds: ["image-asset"] });

    assert.deepEqual(result.items, []);
    assert.equal(result.diagnostics?.some((diagnostic) => diagnostic.code === "image-resource-backed-view-image-source-unavailable"), true);
    assertSafe(result);
  });

  it("maps a safe generated-output descriptor and keeps it unregistered", async () => {
    const generatedSource = new FakeGeneratedOutputDescriptorSource([
      { outputId: "output-1", output: output(), metadata: { seed: 7, model: "sdxl", prompt: "hidden" } },
    ]);

    const result = await new AssetImageResourceBackedViewProvider({ generatedImageOutputDescriptorSource: generatedSource }).listResourceBackedViews({ workspaceId: "workspace-a" as never,
      viewKinds: ["generated-output"],
    });
    const view = result.items[0]!;

    assert.equal(view.viewKind, "generated-output");
    assert.equal(view.assetType, undefined);
    assert.equal(view.assetDefinitionRef, undefined);
    assert.equal(view.resourceBackedAsset, undefined);
    assert.equal(view.generatedOutput?.producedAssetType, "image");
    assert.equal(view.summary?.includes("not finalized or registered"), true);
    assert.equal(view.diagnostics?.some((diagnostic) => diagnostic.code === "generated-output-not-finalized"), true);
    assert.equal(view.metadata?.registered, false);
    assert.equal(view.metadata?.finalized, false);
    assertSafe(result);
  });

  it("does not read image bytes, storage scans, runtime status, generation adapters, mutations, or mappings", async () => {
    const imageSource = new FakeImageAssetDescriptorRead([imageAsset()]);
    const generatedSource = new FakeGeneratedOutputDescriptorSource([{ outputId: "output-1", output: output() }]);
    await new AssetImageResourceBackedViewProvider({
      imageAssetDescriptorRead: imageSource,
      generatedImageOutputDescriptorSource: generatedSource,
    }).listResourceBackedViews({ workspaceId: "workspace-a" as never });

    assert.equal(imageSource.byteReadCalls + generatedSource.byteReadCalls, 0);
    assert.equal(imageSource.storageScanCalls + generatedSource.storageScanCalls, 0);
    assert.equal(generatedSource.runtimeStatusCalls, 0);
    assert.equal(generatedSource.imageGenerationCalls, 0);
    assert.equal(generatedSource.comfyUiCalls, 0);
    assert.equal(imageSource.createAssetInstanceCalls + generatedSource.createAssetInstanceCalls, 0);
    assert.equal(imageSource.persistMappingCalls + generatedSource.persistMappingCalls, 0);
    assert.equal(imageSource.registerImageAssetCalls, 0);
    assert.equal(imageSource.finalizeCalls + generatedSource.finalizeCalls, 0);
  });

  it("does not expose artifact storage paths, local paths, prompts, raw payloads, bytes, blobs, base64, data URLs, or secrets", async () => {
    const imageSource = new FakeImageAssetDescriptorRead([
      imageAsset({
        assetId: "C:\\Users\\name\\image.png",
        artifactId: "generated/images/artifact-1.png",
        metadata: {
          originalFileName: "C:\\Users\\name\\image.png",
          prompt: "visible prompt must be hidden",
          negativePrompt: "visible negative prompt must be hidden",
          seed: 42,
          model: "C:\\Users\\name\\model.safetensors",
          engine: "comfyui",
          workflowTemplateId: "raw-workflow",
          width: 512,
          height: 512,
          createdAt: "2026-01-01T00:00:00.000Z",
          requestId: "request-hidden",
          taskId: "task-hidden",
          safe: "kept",
        } as never,
      }),
    ]);
    const generatedSource = new FakeGeneratedOutputDescriptorSource([
      {
        outputId: "output-unsafe",
        output: output(),
        artifactId: "C:\\Users\\name\\artifact.png",
        metadata: {
          safe: "visible",
          prompt: "visible prompt must be hidden",
          negativePrompt: "visible negative prompt must be hidden",
          token: "secret-token",
          authorization: "Bearer secret",
          env: { SECRET_ENV: "hidden" },
          commandLine: "python run.py --token x",
          stackTrace: "Error: stack",
          rawPayload: { value: "raw provider payload" },
          requestId: "request-hidden",
          taskId: "task-hidden",
          blobBytes: "bytes",
          dataUrl: "data:image/png;base64,AAAA",
        },
      },
    ]);

    const result = await new AssetImageResourceBackedViewProvider({
      imageAssetDescriptorRead: imageSource,
      generatedImageOutputDescriptorSource: generatedSource,
    }).listResourceBackedViews({ workspaceId: "workspace-a" as never, limit: 10 });

    assert.equal(result.items.length, 2);
    assertSafe(result);
  });

  it("supports safe limits, search, asset filters, family filters, and view-kind filters", async () => {
    const imageSource = new FakeImageAssetDescriptorRead([
      imageAsset({ assetId: "image-alpha", metadata: { ...imageAsset().metadata, originalFileName: "Alpha.png" } }),
      imageAsset({ assetId: "image-beta", metadata: { ...imageAsset().metadata, originalFileName: "Beta.png" } }),
    ]);
    const generatedSource = new FakeGeneratedOutputDescriptorSource([
      { outputId: "output-alpha", output: output({ fileName: "Alpha draft.png" }) },
      { outputId: "output-gamma", output: output({ fileName: "Gamma draft.png" }) },
    ]);
    const provider = new AssetImageResourceBackedViewProvider({
      imageAssetDescriptorRead: imageSource,
      generatedImageOutputDescriptorSource: generatedSource,
      maxListLimit: 2,
    });

    const limited = await provider.listResourceBackedViews({ workspaceId: "workspace-a" as never, limit: 99 });
    assert.equal(limited.items.length, 2);
    assert.equal(limited.diagnostics?.some((diagnostic) => diagnostic.code === "image-resource-backed-view-limit-clamped"), true);

    assert.deepEqual((await provider.listResourceBackedViews({ workspaceId: "workspace-a" as never, searchText: "gamma", limit: 10 })).items.map((item) => item.viewKind), ["generated-output"]);
    assert.deepEqual((await provider.listResourceBackedViews({ workspaceId: "workspace-a" as never, assetTypes: ["image"], limit: 10 })).items.map((item) => item.viewKind), ["image-asset", "image-asset"]);
    assert.deepEqual((await provider.listResourceBackedViews({ workspaceId: "workspace-a" as never, assetFamilies: ["resource-backed"], viewKinds: ["image-asset"], limit: 10 })).items.map((item) => item.displayName), ["Alpha.png", "Beta.png"]);
    assert.deepEqual((await provider.listResourceBackedViews({ workspaceId: "workspace-a" as never, viewKinds: ["generated-output"], limit: 10 })).items.map((item) => item.viewKind), ["generated-output", "generated-output"]);
  });

  it("safely reports unsupported cursor behavior and sanitized source failures", async () => {
    const generatedCursorSource = new FakeGeneratedOutputDescriptorSource([{ outputId: "output-1", output: output() }]);
    const cursorResult = await new AssetImageResourceBackedViewProvider({
      generatedImageOutputDescriptorSource: generatedCursorSource,
    }).listResourceBackedViews({ workspaceId: "workspace-a" as never, cursor: "cursor-1", viewKinds: ["generated-output"] });
    assert.equal(generatedCursorSource.lastListQuery?.cursor, "cursor-1");
    assert.equal(cursorResult.nextCursor, "next-generated");

    const combinedImageSource = new FakeImageAssetDescriptorRead([imageAsset()]);
    const combinedGeneratedSource = new FakeGeneratedOutputDescriptorSource([{ outputId: "output-1", output: output() }]);
    const combinedCursorResult = await new AssetImageResourceBackedViewProvider({
      imageAssetDescriptorRead: combinedImageSource,
      generatedImageOutputDescriptorSource: combinedGeneratedSource,
    }).listResourceBackedViews({ workspaceId: "workspace-a" as never, cursor: "cursor-1", limit: 10 });
    assert.equal(combinedImageSource.lastListQuery?.cursor, undefined);
    assert.equal(combinedGeneratedSource.lastListQuery?.cursor, undefined);
    assert.equal(combinedCursorResult.nextCursor, undefined);
    assert.equal(combinedCursorResult.diagnostics?.some((diagnostic) => diagnostic.code === "image-resource-backed-view-combined-cursor-unsupported"), true);

    const imageSource = new FakeImageAssetDescriptorRead([]);
    imageSource.throws = true;
    const generatedSource = new FakeGeneratedOutputDescriptorSource([]);
    generatedSource.throws = true;
    const failed = await new AssetImageResourceBackedViewProvider({
      imageAssetDescriptorRead: imageSource,
      generatedImageOutputDescriptorSource: generatedSource,
    }).listResourceBackedViews({ workspaceId: "workspace-a" as never, limit: 10 });

    assert.equal(failed.diagnostics?.some((diagnostic) => diagnostic.code === "image-resource-backed-view-image-source-failed"), true);
    assert.equal(failed.diagnostics?.some((diagnostic) => diagnostic.code === "image-resource-backed-view-generated-output-source-failed"), true);
    assertSafe([cursorResult, combinedCursorResult, failed]);
  });

  it("uses direct image and generated-output descriptor read seams for detail reads beyond the first page", async () => {
    const imageSource = new FakeImageAssetDescriptorRead([imageAsset({ assetId: "image-first" }), imageAsset({ assetId: "image-read" })]);
    const generatedSource = new FakeGeneratedOutputDescriptorSource([
      { outputId: "output-first", output: output() },
      { outputId: "output-read", output: output() },
    ]);
    const provider = new AssetImageResourceBackedViewProvider({
      imageAssetDescriptorRead: imageSource,
      generatedImageOutputDescriptorSource: generatedSource,
      maxListLimit: 1,
    });

    assert.equal((await provider.readResourceBackedView("asset-view.image.internal.image-read", { workspaceId: "workspace-a" as never }))?.viewKind, "image-asset");
    assert.equal((await provider.readResourceBackedView("asset-view.generated-output.internal.output-read", { workspaceId: "workspace-a" as never }))?.viewKind, "generated-output");
    assert.equal(await provider.readResourceBackedView("missing", { workspaceId: "workspace-a" as never }), undefined);
    assert.equal(imageSource.readCalls, 1);
    assert.equal(generatedSource.readCalls, 1);
    assert.equal(imageSource.listCalls + generatedSource.listCalls, 1);
    assert.equal(imageSource.byteReadCalls + generatedSource.byteReadCalls, 0);
  });

  it("keeps bounded list fallback explicit when direct detail lookup is unavailable", async () => {
    const imageSource = {
      listCalls: 0,
      async listImageAssetDescriptors(query?: { readonly limit?: number }) {
        this.listCalls += 1;
        return { items: [imageAsset({ assetId: "image-list-only" })].slice(0, query?.limit) };
      },
    };
    const provider = new AssetImageResourceBackedViewProvider({ imageAssetDescriptorRead: imageSource, maxListLimit: 1 });
    const detail = await provider.readResourceBackedView("asset-view.image.internal.image-list-only", { workspaceId: "workspace-a" as never });

    assert.equal(detail?.viewKind, "image-asset");
    assert.equal(detail?.diagnostics?.some((diagnostic) => diagnostic.code === "image-resource-backed-view-detail-list-fallback-limited"), true);
    assert.equal(await provider.readResourceBackedView("asset-view.image.internal.image-beyond-first-page", { workspaceId: "workspace-a" as never }), undefined);
  });

  it("imports no forbidden outer layers, storage adapters, byte readers, filesystem, network, runtime, or execution seams", () => {
    const source = readFileSync("modules/application/services/asset/asset-image-resource-backed-view-provider.service.ts", "utf8");
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
      "ImageBinaryRetrievalPort",
      "GeneratedImagePersistencePort",
      "ImageGenerationFinalization",
      "FinalizeImageGeneration",
      "RuntimeTaskRegistryPort",
      "runtimeTaskRegistry",
      "Comfy",
      "comfyui/",
      "scan",
      "readBytes",
      "registerImageAsset(",
      "createAssetInstance",
      "persistMapping",
    ]) {
      assert.equal(source.includes(forbidden), false, `unexpected forbidden boundary: ${forbidden}`);
    }
  });
});
