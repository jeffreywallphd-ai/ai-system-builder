import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import type { ImageAsset } from "../../../contracts/image";
import { isWorkspaceId } from "../../../contracts/workspace";
import type { WorkspaceId } from "../../../contracts/workspace";
import type {
  ImageAssetDescriptorListQuery,
  ImageAssetDescriptorListResult,
  ImageAssetDescriptorReadPort,
  ImageAssetRegistryPort,
  RegisterImageAssetInput,
} from "../../../application/ports/image";
import { mutateDocumentRecord, readDocumentRecord, writeDocumentRecord, type StructuredDocumentStore } from "../shared";

interface ImageAssetRegistryDocument {
  assets?: Record<string, ImageAsset>;
}

export interface LocalImageAssetRegistryAdapterOptions {
  filePath: string;
  rootDirectory?: string;
  documents?: StructuredDocumentStore;
  now?: () => string;
  createAssetId?: () => string;
}

export type LocalImageAssetRegistryAdapter = ImageAssetRegistryPort & ImageAssetDescriptorReadPort;

async function readDocument(filePath: string, documents?: StructuredDocumentStore, rootDirectory?: string): Promise<ImageAssetRegistryDocument> {
  if (documents) return (await readDocumentRecord({ rootDirectory: rootDirectory ?? dirname(filePath), documents }, ".catalog/image-assets.json", { assets: {} })).value;
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

async function writeDocument(filePath: string, document: ImageAssetRegistryDocument, documents?: StructuredDocumentStore, rootDirectory?: string): Promise<void> {
  if (documents) {
    await writeDocumentRecord({ rootDirectory: rootDirectory ?? dirname(filePath), documents }, ".catalog/image-assets.json", document);
    return;
  }
  await mkdir(dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.tmp`;
  await writeFile(temporaryPath, JSON.stringify(document, null, 2), "utf8");
  await rename(temporaryPath, filePath);
}

export function createLocalImageAssetRegistryAdapter(
  options: LocalImageAssetRegistryAdapterOptions,
): LocalImageAssetRegistryAdapter {
  const now = options.now ?? (() => new Date().toISOString());
  const createAssetId = options.createAssetId ?? (() => randomUUID());

  function assertWorkspaceId(workspaceId: WorkspaceId | string | undefined): asserts workspaceId is WorkspaceId {
    if (!isWorkspaceId(workspaceId)) {
      throw new Error("Workspace id is required for image asset registry operations.");
    }
  }

  function toImageAsset(input: RegisterImageAssetInput): ImageAsset {
    assertWorkspaceId(input.workspaceId);
    return {
      workspaceId: input.workspaceId,
      assetId: input.assetId ?? createAssetId(),
      artifactId: input.artifactId,
      source: input.source,
      metadata: {
        createdAt: input.metadata?.createdAt ?? now(),
        requestId: input.metadata?.requestId,
        originalFileName: input.metadata?.originalFileName,
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
      assertWorkspaceId(input.workspaceId);
      const asset = toImageAsset(input);
      if (options.documents) {
        await mutateDocumentRecord(
          { rootDirectory: options.rootDirectory ?? dirname(options.filePath), documents: options.documents },
          ".catalog/image-assets.json",
          { assets: {} } as ImageAssetRegistryDocument,
          (document) => ({
            value: { ...document, assets: { ...(document.assets ?? {}), [asset.assetId]: asset } },
            result: undefined,
          }),
        );
      } else {
        const document = await readDocument(options.filePath);
        await writeDocument(options.filePath, {
          ...document,
          assets: { ...(document.assets ?? {}), [asset.assetId]: asset },
        });
      }
      return { assetId: asset.assetId };
    },
    async getImageAsset(workspaceId, assetId) {
      assertWorkspaceId(workspaceId);
      const document = await readDocument(options.filePath, options.documents, options.rootDirectory);
      const asset = document.assets?.[assetId] ?? null;
      return asset?.workspaceId === workspaceId ? asset : null;
    },
    async listImageAssetDescriptors(query: ImageAssetDescriptorListQuery): Promise<ImageAssetDescriptorListResult> {
      assertWorkspaceId(query?.workspaceId);
      const document = await readDocument(options.filePath, options.documents, options.rootDirectory);
      const limit = typeof query.limit === "number" && Number.isFinite(query.limit) && query.limit > 0
        ? Math.floor(query.limit)
        : 50;
      const searchText = query.searchText?.trim().toLowerCase();
      const sorted = Object.values(document.assets ?? {})
        .filter((asset) => asset.workspaceId === query.workspaceId)
        .sort((left, right) => left.assetId.localeCompare(right.assetId))
        .filter((asset) => {
          if (!searchText) return true;
          const haystack = [
            asset.assetId,
            asset.artifactId,
            asset.source,
            asset.metadata.originalFileName,
            asset.metadata.engine,
            asset.metadata.model,
          ].filter(Boolean).join(" ").toLowerCase();
          return haystack.includes(searchText);
        });
      const startIndex = query.cursor
        ? Math.max(0, sorted.findIndex((asset) => asset.assetId === query.cursor) + 1)
        : 0;
      const items = sorted.slice(startIndex, startIndex + limit);
      const next = sorted[startIndex + limit];
      return {
        items,
        ...(next ? { nextCursor: next.assetId } : {}),
      };
    },
    async readImageAssetDescriptor(workspaceId, assetId) {
      assertWorkspaceId(workspaceId);
      const document = await readDocument(options.filePath, options.documents, options.rootDirectory);
      const asset = document.assets?.[assetId] ?? null;
      return asset?.workspaceId === workspaceId ? asset : null;
    },
  };
}
