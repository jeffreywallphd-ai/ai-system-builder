import { appendFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";

import type {
  ArtifactCatalogAppendPort,
  ArtifactCatalogDeletePort,
  ArtifactCatalogReadPort,
  ArtifactCatalogRecord,
} from "../../../../application/ports/artifact-catalog";
import {
  createContractError,
  createFailureResult,
  createSuccessResult,
} from "../../../../contracts/shared";
import { normalizeStorageArtifactKey } from "../../../../contracts/storage";
import { normalizeArtifactFamily } from "../../../../domain/artifact";

const DEFAULT_CATALOG_FILE = ".catalog/artifact-catalog.ndjson";

type ArtifactCatalogRecordLine = ArtifactCatalogRecord | { storageKey: string; deletedAt: string };

export interface CreateLocalArtifactCatalogPersistenceAdapterOptions {
  rootDirectory: string;
  catalogFile?: string;
}

export interface LocalArtifactCatalogPersistenceAdapter
  extends ArtifactCatalogAppendPort, ArtifactCatalogReadPort, ArtifactCatalogDeletePort {}

function normalizeRecord(record: ArtifactCatalogRecord): ArtifactCatalogRecord {
  return {
    ...record,
    storageKey: normalizeStorageArtifactKey(record.storageKey),
    artifactFamily: normalizeArtifactFamily(record.artifactFamily),
  };
}

function parseRecordLine(line: string): ArtifactCatalogRecordLine | undefined {
  try {
    const parsed = JSON.parse(line) as Partial<ArtifactCatalogRecord> & { deletedAt?: unknown };
    if (typeof parsed.storageKey !== "string") {
      return undefined;
    }

    if (typeof parsed.deletedAt === "string" && parsed.deletedAt.trim().length > 0) {
      return { storageKey: normalizeStorageArtifactKey(parsed.storageKey), deletedAt: parsed.deletedAt };
    }

    if (typeof parsed.artifactFamily !== "string" || parsed.artifactFamily.trim().length === 0) {
      return undefined;
    }

    return normalizeRecord({
      storageKey: parsed.storageKey,
      artifactFamily: normalizeArtifactFamily(parsed.artifactFamily),
      mediaType: typeof parsed.mediaType === "string" ? parsed.mediaType : undefined,
      sizeBytes: typeof parsed.sizeBytes === "number" ? parsed.sizeBytes : undefined,
      sourceKind: parsed.sourceKind === "upload" || parsed.sourceKind === "generated" ? parsed.sourceKind : undefined,
      originalName: typeof parsed.originalName === "string" ? parsed.originalName : undefined,
      createdAt: typeof parsed.createdAt === "string" ? parsed.createdAt : undefined,
      checksum:
        parsed.checksum
        && typeof parsed.checksum === "object"
        && typeof parsed.checksum.algorithm === "string"
        && typeof parsed.checksum.value === "string"
          ? {
            algorithm: parsed.checksum.algorithm,
            value: parsed.checksum.value,
          }
          : undefined,
    });
  } catch {
    return undefined;
  }
}

export function createLocalArtifactCatalogPersistenceAdapter(
  options: CreateLocalArtifactCatalogPersistenceAdapterOptions,
): LocalArtifactCatalogPersistenceAdapter {
  const rootDirectory = path.resolve(options.rootDirectory);
  const catalogFile = options.catalogFile ?? DEFAULT_CATALOG_FILE;
  const catalogPath = path.join(rootDirectory, catalogFile);

  async function readCatalogRecords(): Promise<ArtifactCatalogRecord[]> {
    const content = await readFile(catalogPath, "utf8").catch(() => "");
    if (!content.trim()) {
      return [];
    }

    const latestByStorageKey = new Map<string, ArtifactCatalogRecord>();
    for (const rawLine of content.split("\n")) {
      const line = rawLine.trim();
      if (!line) {
        continue;
      }

      const record = parseRecordLine(line);
      if (!record) {
        continue;
      }

      if ("deletedAt" in record) {
        latestByStorageKey.delete(record.storageKey);
        continue;
      }

      latestByStorageKey.set(record.storageKey, record);
    }

    return Array.from(latestByStorageKey.values());
  }

  return {
    async appendArtifactCatalogRecord(request, context = {}) {
      try {
        const record = normalizeRecord(request.record);
        await mkdir(path.dirname(catalogPath), { recursive: true });
        await appendFile(catalogPath, `${JSON.stringify(record)}\n`, "utf8");
        return createSuccessResult({ storageKey: record.storageKey }, context);
      } catch (error) {
        return createFailureResult(
          createContractError("unavailable", "Failed to append artifact catalog record.", {
            details: {
              reason: error instanceof Error ? error.message : String(error),
            },
          }),
          context,
        );
      }
    },

    async browseArtifactCatalogRecords(request, context = {}) {
      const records = await readCatalogRecords();
      return createSuccessResult({
        records: request.artifactFamily
          ? records.filter((record) => record.artifactFamily === request.artifactFamily)
          : records,
      }, context);
    },

    async readArtifactCatalogRecord(request, context = {}) {
      const storageKey = normalizeStorageArtifactKey(request.storageKey);
      const record = (await readCatalogRecords()).find((entry) => entry.storageKey === storageKey);
      if (!record) {
        return createFailureResult(
          createContractError("not-found", `Artifact not found for storage key \"${storageKey}\".`),
          context,
        );
      }

      return createSuccessResult({ record }, context);
    },

    async deleteArtifactCatalogRecord(request, context = {}) {
      const storageKey = normalizeStorageArtifactKey(request.storageKey);
      const records = await readCatalogRecords();
      const exists = records.some((entry) => entry.storageKey === storageKey);
      if (!exists) {
        return createSuccessResult({ deleted: false }, context);
      }

      await mkdir(path.dirname(catalogPath), { recursive: true });
      await appendFile(catalogPath, `${JSON.stringify({ storageKey, deletedAt: new Date().toISOString() })}\n`, "utf8");
      return createSuccessResult({ deleted: true }, context);
    },
  };
}

export type CreateLocalArtifactCatalogAdapterOptions =
  CreateLocalArtifactCatalogPersistenceAdapterOptions;
export type LocalArtifactCatalogAdapter = LocalArtifactCatalogPersistenceAdapter;

export const createLocalArtifactCatalogAdapter = createLocalArtifactCatalogPersistenceAdapter;
