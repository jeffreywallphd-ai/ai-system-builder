import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import type { ImageAsset } from "../../../contracts/image";
import type { ImageAssetRegistryPort, RegisterImageAssetInput } from "../../../application/ports/image";

interface ImageAssetRegistryDocument {
  assets?: Record<string, ImageAsset>;
}

export interface LocalImageAssetRegistryAdapterOptions {
  filePath: string;
  now?: () => string;
  createAssetId?: () => string;
}

async function readDocument(filePath: string): Promise<ImageAssetRegistryDocument> {
  try {
    const parsed = JSON.parse(await readFile(filePath, "utf8")) as ImageAssetRegistryDocument;
    return parsed && typeof parsed === "object" ? parsed : { assets: {} };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { assets: {} };
    }
    throw error;
  }
}

async function writeDocument(filePath: string, document: ImageAssetRegistryDocument): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.tmp`;
  await writeFile(temporaryPath, JSON.stringify(document, null, 2), "utf8");
  await rename(temporaryPath, filePath);
}

export function createLocalImageAssetRegistryAdapter(
  options: LocalImageAssetRegistryAdapterOptions,
): ImageAssetRegistryPort {
  const now = options.now ?? (() => new Date().toISOString());
  const createAssetId = options.createAssetId ?? (() => randomUUID());

  function toImageAsset(input: RegisterImageAssetInput): ImageAsset {
    return {
      assetId: input.assetId ?? createAssetId(),
      artifactId: input.artifactId,
      source: input.source,
      metadata: {
        createdAt: input.metadata?.createdAt ?? now(),
        prompt: input.metadata?.prompt,
        negativePrompt: input.metadata?.negativePrompt,
        seed: input.metadata?.seed,
        model: input.metadata?.model,
        engine: input.metadata?.engine,
        workflowTemplateId: input.metadata?.workflowTemplateId,
        width: input.metadata?.width,
        height: input.metadata?.height,
      },
    };
  }

  return {
    async registerImageAsset(input) {
      const document = await readDocument(options.filePath);
      const assets = document.assets ?? {};
      const asset = toImageAsset(input);
      assets[asset.assetId] = asset;
      await writeDocument(options.filePath, { ...document, assets });
      return { assetId: asset.assetId };
    },
    async getImageAsset(assetId) {
      const document = await readDocument(options.filePath);
      return document.assets?.[assetId] ?? null;
    },
  };
}
