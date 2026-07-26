import { createHash } from "node:crypto";
import { cp, mkdir, readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

import { resolveDocumentIdentity, type StructuredDocumentStore } from "../shared";

export const JSON_IMPORT_MARKER_NAMESPACE = "persistence-migration";
export const JSON_IMPORT_MARKER_KEY = "json-import-v1";

const ELIGIBLE_ROOTS = [
  "application-settings",
  "asset-authoring",
  "asset-composition",
  "asset-kernel",
  "conversations",
  "effective-asset-projections",
  "execution-plans",
  "execution-runs",
  "model-registry",
  "runtime-readiness",
  "system-builder",
  "user-library",
  "workspaces",
] as const;

const ELIGIBLE_CATALOG_FILES = ["image-assets.json", "models.json"] as const;
const ELIGIBLE_CATALOG_NDJSON_FILES = ["artifact-catalog.ndjson", "artifact-storage-bindings.ndjson"] as const;

export interface JsonImportInventoryEntry {
  readonly relativePath: string;
  readonly namespace: string;
  readonly key: string;
  readonly recordCount: number;
  readonly sha256: string;
  readonly value: unknown;
}

export interface JsonImportInventory {
  readonly files: readonly JsonImportInventoryEntry[];
  readonly totalRecords: number;
  readonly sourceDigest: string;
}

export interface JsonImportMarker {
  readonly version: 1;
  readonly sourceDigest: string;
  readonly fileCount: number;
  readonly totalRecords: number;
  readonly rollbackDirectory: string | null;
  readonly importedAt: string;
}

export interface ImportJsonStructuredDataOptions {
  readonly sourceRootDirectory: string;
  readonly documents: StructuredDocumentStore;
  readonly rollbackRootDirectory: string;
  readonly now?: () => string;
}

export interface JsonImportResult {
  readonly status: "empty" | "imported" | "already-imported";
  readonly inventory: JsonImportInventory;
  readonly marker?: JsonImportMarker;
}

export async function inventoryJsonStructuredData(sourceRootDirectory: string): Promise<JsonImportInventory> {
  const sourceRoot = path.resolve(sourceRootDirectory);
  const candidates: string[] = [];
  for (const root of ELIGIBLE_ROOTS) {
    await collectJsonFiles(path.join(sourceRoot, root), sourceRoot, candidates);
  }
  for (const file of ELIGIBLE_CATALOG_FILES) {
    const relativePath = `.catalog/${file}`;
    if (await isFile(path.join(sourceRoot, relativePath))) candidates.push(relativePath);
  }
  for (const file of ELIGIBLE_CATALOG_NDJSON_FILES) {
    const relativePath = `.catalog/${file}`;
    if (await isFile(path.join(sourceRoot, relativePath))) candidates.push(relativePath);
  }
  candidates.sort((left, right) => left.localeCompare(right));

  const files: JsonImportInventoryEntry[] = [];
  for (const relativePath of candidates) {
    const source = await readFile(path.join(sourceRoot, relativePath), "utf8");
    let value: unknown;
    try {
      value = relativePath.endsWith(".ndjson")
        ? source.split(/\r?\n/).filter((line) => line.trim().length > 0).map((line) => JSON.parse(line) as unknown)
        : JSON.parse(source) as unknown;
    } catch (error) {
      throw errorWithCause(`Structured JSON inventory contains malformed JSON at ${relativePath}.`, error);
    }
    const canonical = JSON.stringify(value);
    if (canonical === undefined) throw new Error(`Structured JSON inventory is not JSON-compatible at ${relativePath}.`);
    const identity = resolveDocumentIdentity(relativePath);
    files.push({
      relativePath,
      ...identity,
      recordCount: Array.isArray(value) ? value.length : 1,
      sha256: sha256(canonical),
      value,
    });
  }
  const totalRecords = files.reduce((total, file) => total + file.recordCount, 0);
  const sourceDigest = sha256(files.map((file) => `${file.relativePath}:${file.sha256}:${file.recordCount}`).join("\n"));
  return { files, totalRecords, sourceDigest };
}

export async function importJsonStructuredData(options: ImportJsonStructuredDataOptions): Promise<JsonImportResult> {
  const now = options.now ?? (() => new Date().toISOString());
  const inventory = await inventoryJsonStructuredData(options.sourceRootDirectory);
  const existing = await options.documents.readDocument<JsonImportMarker>(JSON_IMPORT_MARKER_NAMESPACE, JSON_IMPORT_MARKER_KEY);
  if (existing) {
    if (existing.value.sourceDigest !== inventory.sourceDigest) {
      throw new Error("Structured JSON source changed after database import; refusing an implicit re-import or dual-write cutover.");
    }
    return { status: "already-imported", inventory, marker: existing.value };
  }
  const timestamp = now().replace(/[^0-9]/g, "").slice(0, 17);
  const rollbackDirectory = inventory.files.length > 0
    ? path.join(path.resolve(options.rollbackRootDirectory), `json-before-sqlite-${timestamp}`)
    : null;
  if (rollbackDirectory) {
    await createRollbackCopy(options.sourceRootDirectory, rollbackDirectory, inventory.files);
  }
  const marker: JsonImportMarker = {
    version: 1,
    sourceDigest: inventory.sourceDigest,
    fileCount: inventory.files.length,
    totalRecords: inventory.totalRecords,
    rollbackDirectory,
    importedAt: now(),
  };

  await options.documents.runInTransaction(async (transaction) => {
    for (const file of inventory.files) {
      await transaction.writeDocument(file.namespace, file.key, file.value);
    }
    await transaction.writeDocument(JSON_IMPORT_MARKER_NAMESPACE, JSON_IMPORT_MARKER_KEY, marker);
  });

  for (const source of inventory.files) {
    const target = await options.documents.readDocument<unknown>(source.namespace, source.key);
    if (!target || sha256(JSON.stringify(target.value)) !== source.sha256) {
      throw new Error(`Structured JSON reconciliation failed for ${source.relativePath}.`);
    }
  }
  return { status: inventory.files.length === 0 ? "empty" : "imported", inventory, marker };
}

async function collectJsonFiles(directory: string, sourceRoot: string, output: string[]): Promise<void> {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  for (const entry of entries) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) await collectJsonFiles(absolute, sourceRoot, output);
    else if (entry.isFile() && entry.name.toLowerCase().endsWith(".json")) {
      output.push(path.relative(sourceRoot, absolute).replace(/\\/g, "/"));
    }
  }
}

async function createRollbackCopy(
  sourceRoot: string,
  rollbackDirectory: string,
  files: readonly JsonImportInventoryEntry[],
): Promise<void> {
  for (const file of files) {
    const destination = path.join(rollbackDirectory, file.relativePath);
    await mkdir(path.dirname(destination), { recursive: true });
    await cp(path.join(sourceRoot, file.relativePath), destination, { errorOnExist: true, force: false });
  }
}

async function isFile(filePath: string): Promise<boolean> {
  try {
    return (await stat(filePath)).isFile();
  } catch {
    return false;
  }
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function errorWithCause(message: string, cause: unknown): Error {
  const error = new Error(message) as Error & { cause?: unknown };
  error.cause = cause;
  return error;
}
