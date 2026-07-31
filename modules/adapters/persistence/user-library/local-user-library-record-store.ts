import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Stream } from "node:stream";

import type {
  UserLibraryAssetRecord,
  WorkspaceUserLibraryLinkRecord,
} from "../../../contracts/user-library";
import {
  mutateDocumentRecord,
  readDocumentRecord,
  writeDocumentRecord,
  type StructuredDocumentStore,
} from "../shared";

export const USER_LIBRARY_LOCAL_STORE_KIND =
  "user-library-local-store" as const;
export const USER_LIBRARY_LOCAL_SCHEMA_VERSION = 1 as const;

export interface LocalUserLibraryManifest {
  readonly schemaVersion: typeof USER_LIBRARY_LOCAL_SCHEMA_VERSION;
  readonly storeKind: typeof USER_LIBRARY_LOCAL_STORE_KIND;
  readonly updatedAt: string;
}

export interface LocalUserLibraryRecordStoreOptions {
  readonly rootDir: string;
  readonly now?: () => string;
  readonly documents?: StructuredDocumentStore;
}

export class LocalUserLibraryRecordStoreError extends Error {
  public constructor(message: string, options?: { cause?: unknown }) {
    super(message);
    this.name = "LocalUserLibraryRecordStoreError";
    if (options && "cause" in options) {
      (this as Error & { cause?: unknown }).cause = options.cause;
    }
    this.stack = undefined;
  }
}

type UserLibraryCollectionName = "assets" | "workspaceLinks";

interface UserLibraryCollectionMap {
  assets: UserLibraryAssetRecord;
  workspaceLinks: WorkspaceUserLibraryLinkRecord;
}

const COLLECTION_FILES = {
  assets: "user-library-assets.json",
  workspaceLinks: "workspace-user-library-links.json",
} as const satisfies Record<UserLibraryCollectionName, string>;

export class LocalUserLibraryRecordStore {
  private readonly storeDir: string;
  private readonly now: () => string;
  private readonly rootDir: string;
  private readonly documents?: StructuredDocumentStore;
  private writeQueue: Promise<void> = Promise.resolve();

  public constructor(options: LocalUserLibraryRecordStoreOptions) {
    this.storeDir = join(options.rootDir, "user-library");
    this.rootDir = options.rootDir;
    this.documents = options.documents;
    this.now = options.now ?? (() => new Date().toISOString());
  }

  public async initialize(): Promise<void> {
    await this.ensureStoreFiles();
  }

  public async readManifest(): Promise<LocalUserLibraryManifest> {
    await this.ensureStoreDirectory();
    return validateManifest(
      await this.readJsonFile<unknown>(
        "user-library-manifest.json",
        this.createManifest(),
      ),
    );
  }

  public async readCollection<Name extends UserLibraryCollectionName>(
    name: Name,
  ): Promise<readonly UserLibraryCollectionMap[Name][]> {
    await this.readManifest();
    await this.ensureStoreDirectory();
    const value = await this.readJsonFile<unknown>(COLLECTION_FILES[name], []);
    if (!Array.isArray(value)) {
      throw new LocalUserLibraryRecordStoreError(
        "User Library local store collection is invalid.",
      );
    }
    return cloneJson(value as readonly UserLibraryCollectionMap[Name][]);
  }

  public async writeCollection<Name extends UserLibraryCollectionName>(
    name: Name,
    records: readonly UserLibraryCollectionMap[Name][],
  ): Promise<void> {
    await this.readManifest();
    const writeOperation = this.writeQueue.then(
      () => this.writeCollectionNow(name, records),
      () => this.writeCollectionNow(name, records),
    );
    this.writeQueue = writeOperation.catch(() => undefined);
    await writeOperation;
  }

  public async mutateCollection<
    Name extends UserLibraryCollectionName,
    TResult,
  >(
    name: Name,
    mutation: (records: readonly UserLibraryCollectionMap[Name][]) => {
      records: readonly UserLibraryCollectionMap[Name][];
      result: TResult;
    },
  ): Promise<TResult> {
    await this.readManifest();
    const result = await mutateDocumentRecord(
      { rootDirectory: this.rootDir, documents: this.documents },
      `user-library/${COLLECTION_FILES[name]}`,
      [] as UserLibraryCollectionMap[Name][],
      (current) => {
        if (!Array.isArray(current))
          throw new LocalUserLibraryRecordStoreError(
            "User Library local store collection is invalid.",
          );
        const next = mutation(cloneJson(current));
        assertSafeUserLibraryRecord(next.records);
        return { value: cloneJson([...next.records]), result: next.result };
      },
    );
    await this.writeJsonFile(
      "user-library-manifest.json",
      this.createManifest(),
    );
    return result;
  }

  private async writeCollectionNow<Name extends UserLibraryCollectionName>(
    name: Name,
    records: readonly UserLibraryCollectionMap[Name][],
  ): Promise<void> {
    await this.ensureStoreDirectory();
    const jsonRecords = cloneJson(records);
    assertSafeUserLibraryRecord(jsonRecords);
    await this.writeJsonFile(COLLECTION_FILES[name], jsonRecords);
    await this.writeJsonFile(
      "user-library-manifest.json",
      this.createManifest(),
    );
  }

  private async ensureStoreFiles(): Promise<void> {
    await this.ensureStoreDirectory();
    await this.ensureJsonFile(
      "user-library-manifest.json",
      this.createManifest(),
    );
    await Promise.all(
      (Object.keys(COLLECTION_FILES) as UserLibraryCollectionName[]).map(
        (name) => this.ensureJsonFile(COLLECTION_FILES[name], []),
      ),
    );
  }

  private async ensureStoreDirectory(): Promise<void> {
    if (this.documents) return;
    await mkdir(this.storeDir, { recursive: true });
  }

  private async ensureJsonFile(
    fileName: string,
    fallback: unknown,
  ): Promise<void> {
    if (this.documents) {
      const result = await readDocumentRecord(
        { rootDirectory: this.rootDir, documents: this.documents },
        `user-library/${fileName}`,
        fallback,
      );
      this.validateInitializedFile(fileName, result.value);
      if (!result.found) await this.writeJsonFile(fileName, fallback);
      return;
    }
    this.validateInitializedFile(
      fileName,
      await this.readJsonFile(fileName, fallback),
    );
    try {
      await readFile(this.filePath(fileName), "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      await this.writeJsonFile(fileName, fallback);
    }
  }

  private async readJsonFile<T>(fileName: string, fallback: T): Promise<T> {
    if (this.documents) {
      const result = await readDocumentRecord(
        { rootDirectory: this.rootDir, documents: this.documents },
        `user-library/${fileName}`,
        fallback,
      );
      return cloneJson(result.value);
    }
    try {
      return cloneJson(
        JSON.parse(await readFile(this.filePath(fileName), "utf8")) as T,
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT")
        return cloneJson(fallback);
      if (error instanceof SyntaxError) {
        throw new LocalUserLibraryRecordStoreError(
          "User Library local store contains malformed JSON.",
          { cause: error },
        );
      }
      throw new LocalUserLibraryRecordStoreError(
        "User Library local store could not be read.",
        { cause: error },
      );
    }
  }

  private validateInitializedFile(fileName: string, value: unknown): void {
    if (fileName === "user-library-manifest.json") {
      validateManifest(value);
      return;
    }
    if (!Array.isArray(value)) {
      throw new LocalUserLibraryRecordStoreError(
        "User Library local store collection is invalid.",
      );
    }
  }

  private async writeJsonFile(fileName: string, value: unknown): Promise<void> {
    if (this.documents) {
      await writeDocumentRecord(
        { rootDirectory: this.rootDir, documents: this.documents },
        `user-library/${fileName}`,
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
      throw new LocalUserLibraryRecordStoreError(
        "User Library local store could not be written.",
        { cause: error },
      );
    }
  }

  private createManifest(): LocalUserLibraryManifest {
    return {
      schemaVersion: USER_LIBRARY_LOCAL_SCHEMA_VERSION,
      storeKind: USER_LIBRARY_LOCAL_STORE_KIND,
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

export function assertSafeUserLibraryRecord(value: unknown): void {
  try {
    assertJsonCompatibleValue(value, new Set());
    assertNoUnsafeUserLibraryPayload(value);
  } catch (error) {
    if (error instanceof LocalUserLibraryRecordStoreError) throw error;
    throw new LocalUserLibraryRecordStoreError(
      "User Library local store record must be safe JSON metadata.",
    );
  }
}

function validateManifest(value: unknown): LocalUserLibraryManifest {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new LocalUserLibraryRecordStoreError(
      "User Library local store manifest is invalid.",
    );
  }
  const manifest = value as Partial<LocalUserLibraryManifest>;
  if (manifest.schemaVersion !== USER_LIBRARY_LOCAL_SCHEMA_VERSION) {
    throw new LocalUserLibraryRecordStoreError(
      "User Library local store manifest schema version is unsupported.",
    );
  }
  if (manifest.storeKind !== USER_LIBRARY_LOCAL_STORE_KIND) {
    throw new LocalUserLibraryRecordStoreError(
      "User Library local store manifest kind is unsupported.",
    );
  }
  if (typeof manifest.updatedAt !== "string") {
    throw new LocalUserLibraryRecordStoreError(
      "User Library local store manifest is invalid.",
    );
  }
  return cloneJson(manifest as LocalUserLibraryManifest);
}

function assertJsonCompatibleValue(
  value: unknown,
  seen: Set<object>,
  path = "$root",
): void {
  if (value === null || typeof value === "string" || typeof value === "boolean")
    return;
  if (typeof value === "number") {
    if (!Number.isFinite(value))
      throw new LocalUserLibraryRecordStoreError(
        `User Library local store record must be JSON-compatible at ${path}.`,
      );
    return;
  }
  if (
    typeof value === "undefined" ||
    typeof value === "function" ||
    typeof value === "symbol" ||
    typeof value === "bigint"
  ) {
    throw new LocalUserLibraryRecordStoreError(
      `User Library local store record must be JSON-compatible at ${path}: ${typeof value}.`,
    );
  }
  if (typeof value !== "object") return;
  if (
    value instanceof Date ||
    Buffer.isBuffer(value) ||
    value instanceof Stream
  ) {
    throw new LocalUserLibraryRecordStoreError(
      `User Library local store record must be JSON-compatible at ${path}: object.`,
    );
  }
  if (seen.has(value))
    throw new LocalUserLibraryRecordStoreError(
      `User Library local store record must be JSON-compatible at ${path}: circular.`,
    );
  seen.add(value);
  if (Array.isArray(value)) {
    for (const [index, entry] of value.entries())
      assertJsonCompatibleValue(entry, seen, `${path}[${index}]`);
  } else {
    for (const [entryKey, entry] of Object.entries(
      value as Record<string, unknown>,
    ))
      assertJsonCompatibleValue(entry, seen, `${path}.${entryKey}`);
  }
  seen.delete(value);
}

const UNSAFE_KEY_PATTERN =
  /(?:raw)?path|storageRoot|storage-root|bytes?|blob|base64|providerPayload|provider-payload|prompt|workflow|token|secret|stackTrace|stack-trace|commandLine|command-line|environment|\benv\b/i;
const UNSAFE_STRING_PATTERN =
  /(?:^\/|^[a-z]:\\|https?:\/\/|-----BEGIN |sk-[a-zA-Z0-9]|github_pat_|gh[pousr]_|xox[baprs]-)/i;

function assertNoUnsafeUserLibraryPayload(value: unknown, key = ""): void {
  if (typeof value === "string") {
    if (UNSAFE_STRING_PATTERN.test(value)) {
      throw new LocalUserLibraryRecordStoreError(
        "User Library local store record contains unsafe metadata.",
      );
    }
    return;
  }
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (const entry of value) assertNoUnsafeUserLibraryPayload(entry, key);
    return;
  }
  for (const [entryKey, entryValue] of Object.entries(
    value as Record<string, unknown>,
  )) {
    if (UNSAFE_KEY_PATTERN.test(entryKey)) {
      throw new LocalUserLibraryRecordStoreError(
        "User Library local store record contains unsafe metadata.",
      );
    }
    assertNoUnsafeUserLibraryPayload(entryValue, entryKey);
  }
}
