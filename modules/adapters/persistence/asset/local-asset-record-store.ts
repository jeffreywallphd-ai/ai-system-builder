import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { Stream } from "node:stream";
import { join } from "node:path";

import type {
  AssetBinding,
  AssetComposition,
  AssetDefinition,
  AssetInstance,
} from "../../../contracts/asset";
import {
  mutateDocumentRecord,
  readDocumentRecord,
  writeDocumentRecord,
  type StructuredDocumentStore,
} from "../shared";

export const ASSET_KERNEL_LOCAL_STORE_KIND =
  "asset-kernel-local-store" as const;
export const ASSET_KERNEL_LOCAL_SCHEMA_VERSION = 1 as const;

export interface LocalAssetKernelManifest {
  readonly schemaVersion: typeof ASSET_KERNEL_LOCAL_SCHEMA_VERSION;
  readonly storeKind: typeof ASSET_KERNEL_LOCAL_STORE_KIND;
  readonly updatedAt: string;
}

export interface LocalAssetKernelStoreSnapshot {
  readonly manifest: LocalAssetKernelManifest;
  readonly definitions: readonly AssetDefinition[];
  readonly instances: readonly AssetInstance[];
  readonly compositions: readonly AssetComposition[];
  readonly bindings: readonly AssetBinding[];
}

export interface LocalAssetRecordStoreOptions {
  readonly rootDir: string;
  readonly now?: () => string;
  readonly documents?: StructuredDocumentStore;
}

export class LocalAssetRecordStoreError extends Error {
  public constructor(message: string, options?: { cause?: unknown }) {
    super(message);
    this.name = "LocalAssetRecordStoreError";
    if (options && "cause" in options) {
      (this as Error & { cause?: unknown }).cause = options.cause;
    }
    this.stack = undefined;
  }
}

type AssetKernelCollectionName =
  "definitions" | "instances" | "compositions" | "bindings";

interface AssetKernelCollectionMap {
  definitions: AssetDefinition;
  instances: AssetInstance;
  compositions: AssetComposition;
  bindings: AssetBinding;
}

const COLLECTION_FILES = {
  definitions: "definitions.json",
  instances: "instances.json",
  compositions: "compositions.json",
  bindings: "bindings.json",
} as const satisfies Record<AssetKernelCollectionName, string>;

export class LocalAssetRecordStore {
  private readonly storeDir: string;
  private readonly now: () => string;
  private readonly rootDir: string;
  private readonly documents?: StructuredDocumentStore;
  private writeQueue: Promise<void> = Promise.resolve();

  public constructor(options: LocalAssetRecordStoreOptions) {
    this.storeDir = join(options.rootDir, "asset-kernel");
    this.rootDir = options.rootDir;
    this.documents = options.documents;
    this.now = options.now ?? (() => new Date().toISOString());
  }

  public async initialize(): Promise<void> {
    await this.ensureStoreFiles();
  }

  public initializeSync(): void {
    if (this.documents) return;
    this.ensureStoreFilesSync();
  }

  public async readManifest(): Promise<LocalAssetKernelManifest> {
    await this.ensureStoreDirectory();
    return validateManifest(
      await this.readJsonFile<unknown>("manifest.json", this.createManifest()),
    );
  }

  public async readSnapshot(): Promise<LocalAssetKernelStoreSnapshot> {
    await this.ensureStoreFiles();
    const [manifest, definitions, instances, compositions, bindings] =
      await Promise.all([
        this.readManifest(),
        this.readCollection("definitions"),
        this.readCollection("instances"),
        this.readCollection("compositions"),
        this.readCollection("bindings"),
      ]);
    return { manifest, definitions, instances, compositions, bindings };
  }

  public async readCollection<Name extends AssetKernelCollectionName>(
    name: Name,
  ): Promise<readonly AssetKernelCollectionMap[Name][]> {
    await this.ensureStoreDirectory();
    return this.readJsonFile<readonly AssetKernelCollectionMap[Name][]>(
      COLLECTION_FILES[name],
      [],
    );
  }

  public async writeCollection<Name extends AssetKernelCollectionName>(
    name: Name,
    records: readonly AssetKernelCollectionMap[Name][],
  ): Promise<void> {
    const writeOperation = this.writeQueue.then(
      () => this.writeCollectionNow(name, records),
      () => this.writeCollectionNow(name, records),
    );
    this.writeQueue = writeOperation.catch(() => undefined);
    await writeOperation;
  }

  public async mutateCollection<
    Name extends AssetKernelCollectionName,
    TResult,
  >(
    name: Name,
    mutation: (records: readonly AssetKernelCollectionMap[Name][]) => {
      records: readonly AssetKernelCollectionMap[Name][];
      result: TResult;
    },
  ): Promise<TResult> {
    await this.ensureStoreDirectory();
    const result = await mutateDocumentRecord(
      { rootDirectory: this.rootDir, documents: this.documents },
      `asset-kernel/${COLLECTION_FILES[name]}`,
      [] as AssetKernelCollectionMap[Name][],
      (current) => {
        if (!Array.isArray(current)) {
          throw new LocalAssetRecordStoreError(
            "Asset Kernel local store collection is invalid.",
          );
        }
        const next = mutation(cloneJson(current));
        assertJsonCompatibleAssetRecord(next.records);
        return { value: cloneJson([...next.records]), result: next.result };
      },
    );
    await this.writeJsonFile("manifest.json", this.createManifest());
    return result;
  }

  private async writeCollectionNow<Name extends AssetKernelCollectionName>(
    name: Name,
    records: readonly AssetKernelCollectionMap[Name][],
  ): Promise<void> {
    await this.ensureStoreDirectory();
    assertJsonCompatibleAssetRecord(records);
    await this.writeJsonFile(COLLECTION_FILES[name], cloneJson(records));
    await this.writeJsonFile("manifest.json", this.createManifest());
  }

  private async ensureStoreFiles(): Promise<void> {
    await this.ensureStoreDirectory();
    await this.ensureJsonFile("manifest.json", this.createManifest());
    await Promise.all(
      (Object.keys(COLLECTION_FILES) as AssetKernelCollectionName[]).map(
        (name) => this.ensureJsonFile(COLLECTION_FILES[name], []),
      ),
    );
  }

  private ensureStoreFilesSync(): void {
    this.ensureStoreDirectorySync();
    this.ensureJsonFileSync("manifest.json", this.createManifest());
    for (const name of Object.keys(
      COLLECTION_FILES,
    ) as AssetKernelCollectionName[]) {
      this.ensureJsonFileSync(COLLECTION_FILES[name], []);
    }
  }

  private async ensureStoreDirectory(): Promise<void> {
    if (this.documents) return;
    await mkdir(this.storeDir, { recursive: true });
  }

  private ensureStoreDirectorySync(): void {
    mkdirSync(this.storeDir, { recursive: true });
  }

  private async ensureJsonFile(
    fileName: string,
    fallback: unknown,
  ): Promise<void> {
    if (this.documents) {
      const result = await readDocumentRecord(
        { rootDirectory: this.rootDir, documents: this.documents },
        `asset-kernel/${fileName}`,
        fallback,
      );
      this.validateInitializedFile(fileName, result.value);
      if (!result.found) await this.writeJsonFile(fileName, fallback);
      return;
    }
    try {
      this.validateInitializedFile(
        fileName,
        await this.readJsonFile(fileName, fallback),
      );
    } catch (error) {
      if (error instanceof LocalAssetRecordStoreError) throw error;
      throw error;
    }

    try {
      await readFile(this.filePath(fileName), "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      await this.writeJsonFile(fileName, fallback);
    }
  }

  private ensureJsonFileSync(fileName: string, fallback: unknown): void {
    try {
      this.validateInitializedFile(
        fileName,
        this.readJsonFileSync(fileName, fallback),
      );
    } catch (error) {
      if (error instanceof LocalAssetRecordStoreError) throw error;
      throw error;
    }

    try {
      readFileSync(this.filePath(fileName), "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw new LocalAssetRecordStoreError(
          "Asset Kernel local store could not be read.",
          { cause: error },
        );
      }
      this.writeJsonFileSync(fileName, fallback);
    }
  }

  private async readJsonFile<T>(fileName: string, fallback: T): Promise<T> {
    if (this.documents) {
      const result = await readDocumentRecord(
        { rootDirectory: this.rootDir, documents: this.documents },
        `asset-kernel/${fileName}`,
        fallback,
      );
      return cloneJson(result.value);
    }
    try {
      const source = await readFile(this.filePath(fileName), "utf8");
      const parsed = JSON.parse(source) as unknown;
      return cloneJson(parsed) as T;
    } catch (error) {
      return this.handleJsonReadError(error, fallback);
    }
  }

  private readJsonFileSync<T>(fileName: string, fallback: T): T {
    try {
      const source = readFileSync(this.filePath(fileName), "utf8");
      const parsed = JSON.parse(source) as unknown;
      return cloneJson(parsed) as T;
    } catch (error) {
      return this.handleJsonReadError(error, fallback);
    }
  }

  private validateInitializedFile(fileName: string, value: unknown): void {
    if (fileName === "manifest.json") {
      validateManifest(value);
      return;
    }

    if (!Array.isArray(value)) {
      throw new LocalAssetRecordStoreError(
        "Asset Kernel local store collection is invalid.",
      );
    }
  }

  private handleJsonReadError<T>(error: unknown, fallback: T): T {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return cloneJson(fallback);
    }
    if (error instanceof SyntaxError) {
      throw new LocalAssetRecordStoreError(
        "Asset Kernel local store contains malformed JSON.",
        { cause: error },
      );
    }
    throw new LocalAssetRecordStoreError(
      "Asset Kernel local store could not be read.",
      { cause: error },
    );
  }

  private async writeJsonFile(fileName: string, value: unknown): Promise<void> {
    if (this.documents) {
      await writeDocumentRecord(
        { rootDirectory: this.rootDir, documents: this.documents },
        `asset-kernel/${fileName}`,
        value,
      );
      return;
    }
    const path = this.filePath(fileName);
    const temporaryPath = `${path}.${process.pid}.${randomUUID()}.tmp`;
    try {
      await writeFile(
        temporaryPath,
        `${JSON.stringify(value, null, 2)}\n`,
        "utf8",
      );
      await rename(temporaryPath, path);
    } catch (error) {
      await unlink(temporaryPath).catch(() => undefined);
      throw new LocalAssetRecordStoreError(
        "Asset Kernel local store could not be written.",
        { cause: error },
      );
    }
  }

  private writeJsonFileSync(fileName: string, value: unknown): void {
    try {
      writeFileSync(
        this.filePath(fileName),
        `${JSON.stringify(value, null, 2)}\n`,
        "utf8",
      );
    } catch (error) {
      throw new LocalAssetRecordStoreError(
        "Asset Kernel local store could not be written.",
        { cause: error },
      );
    }
  }

  private createManifest(): LocalAssetKernelManifest {
    return {
      schemaVersion: ASSET_KERNEL_LOCAL_SCHEMA_VERSION,
      storeKind: ASSET_KERNEL_LOCAL_STORE_KIND,
      updatedAt: this.now(),
    };
  }

  private filePath(fileName: string): string {
    return join(this.storeDir, fileName);
  }
}

export function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function assertJsonCompatibleAssetRecord(value: unknown): void {
  try {
    assertJsonCompatibleValue(value, new Set());
  } catch (error) {
    if (error instanceof LocalAssetRecordStoreError) throw error;
    throw new LocalAssetRecordStoreError(
      "Asset Kernel local store record must be JSON-compatible.",
    );
  }
}

function validateManifest(value: unknown): LocalAssetKernelManifest {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new LocalAssetRecordStoreError(
      "Asset Kernel local store manifest is invalid.",
    );
  }

  const manifest = value as Partial<LocalAssetKernelManifest>;
  if (manifest.schemaVersion !== ASSET_KERNEL_LOCAL_SCHEMA_VERSION) {
    throw new LocalAssetRecordStoreError(
      "Asset Kernel local store manifest schema version is unsupported.",
    );
  }

  if (manifest.storeKind !== ASSET_KERNEL_LOCAL_STORE_KIND) {
    throw new LocalAssetRecordStoreError(
      "Asset Kernel local store manifest kind is unsupported.",
    );
  }

  if (typeof manifest.updatedAt !== "string") {
    throw new LocalAssetRecordStoreError(
      "Asset Kernel local store manifest is invalid.",
    );
  }

  return cloneJson(manifest as LocalAssetKernelManifest);
}

function assertJsonCompatibleValue(value: unknown, seen: Set<object>): void {
  if (value === null || typeof value === "string" || typeof value === "boolean")
    return;

  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new LocalAssetRecordStoreError(
        "Asset Kernel local store record must be JSON-compatible.",
      );
    }
    return;
  }

  if (
    typeof value === "undefined" ||
    typeof value === "function" ||
    typeof value === "symbol" ||
    typeof value === "bigint"
  ) {
    throw new LocalAssetRecordStoreError(
      "Asset Kernel local store record must be JSON-compatible.",
    );
  }

  if (typeof value !== "object") return;

  if (
    value instanceof Date ||
    Buffer.isBuffer(value) ||
    value instanceof Stream
  ) {
    throw new LocalAssetRecordStoreError(
      "Asset Kernel local store record must be JSON-compatible.",
    );
  }

  if (seen.has(value)) {
    throw new LocalAssetRecordStoreError(
      "Asset Kernel local store record must be JSON-compatible.",
    );
  }

  const prototype = Object.getPrototypeOf(value);
  if (
    prototype !== Object.prototype &&
    prototype !== Array.prototype &&
    prototype !== null
  ) {
    throw new LocalAssetRecordStoreError(
      "Asset Kernel local store record must be JSON-compatible.",
    );
  }

  seen.add(value);
  if (Array.isArray(value)) {
    for (const entry of value) assertJsonCompatibleValue(entry, seen);
  } else {
    for (const entry of Object.values(value as Record<string, unknown>))
      assertJsonCompatibleValue(entry, seen);
  }
  seen.delete(value);
}
