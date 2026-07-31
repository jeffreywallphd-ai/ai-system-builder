import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { cloneJson } from "../user-library/local-user-library-record-store";
import {
  mutateDocumentRecord,
  readDocumentRecord,
  writeDocumentRecord,
  type StructuredDocumentStore,
} from "../shared";

export const EFFECTIVE_ASSET_PROJECTIONS_LOCAL_STORE_KIND =
  "effective-asset-projections-local-store" as const;
export const EFFECTIVE_ASSET_PROJECTIONS_LOCAL_SCHEMA_VERSION = 1 as const;
export type CollectionName = "projections" | "snapshots";
const files: Record<CollectionName, string> = {
  projections: "effective-asset-projections.json",
  snapshots: "effective-asset-projection-snapshots.json",
};
interface Manifest {
  schemaVersion: 1;
  storeKind: typeof EFFECTIVE_ASSET_PROJECTIONS_LOCAL_STORE_KIND;
  updatedAt: string;
}
export interface LocalEffectiveAssetProjectionRecordStoreOptions {
  readonly rootDir: string;
  readonly now?: () => string;
  readonly documents?: StructuredDocumentStore;
}

function assertSafeProjectionJson(value: unknown): void {
  const encoded = JSON.stringify(value);
  if (encoded === undefined) {
    throw new LocalEffectiveAssetProjectionRecordStoreError(
      "Effective asset projection local store record must be JSON-safe.",
    );
  }
}

export class LocalEffectiveAssetProjectionRecordStoreError extends Error {
  constructor(m: string) {
    super(m);
    this.name = "LocalEffectiveAssetProjectionRecordStoreError";
    this.stack = undefined;
  }
}
export class LocalEffectiveAssetProjectionRecordStore {
  private readonly dir: string;
  private readonly now: () => string;
  private readonly rootDir: string;
  private readonly documents?: StructuredDocumentStore;
  constructor(o: LocalEffectiveAssetProjectionRecordStoreOptions) {
    this.dir = join(o.rootDir, "effective-asset-projections");
    this.rootDir = o.rootDir;
    this.documents = o.documents;
    this.now = o.now ?? (() => new Date().toISOString());
  }
  async readCollection<T>(name: CollectionName): Promise<readonly T[]> {
    await this.ensure();
    const v = await this.readJson(files[name], [] as T[]);
    if (!Array.isArray(v))
      throw new LocalEffectiveAssetProjectionRecordStoreError(
        "Effective asset projection local store collection is invalid.",
      );
    return cloneJson(v as T[]);
  }
  async writeCollection<T>(
    name: CollectionName,
    records: readonly T[],
  ): Promise<void> {
    await this.ensure();
    assertSafeProjectionJson(records);
    await this.writeJson(files[name], cloneJson(records));
    await this.writeJson(
      "effective-asset-projection-manifest.json",
      this.manifest(),
    );
  }
  async mutateCollection<T, TResult>(
    name: CollectionName,
    mutation: (records: readonly T[]) => {
      records: readonly T[];
      result: TResult;
    },
  ): Promise<TResult> {
    await this.ensure();
    const result = await mutateDocumentRecord(
      { rootDirectory: this.rootDir, documents: this.documents },
      `effective-asset-projections/${files[name]}`,
      [] as T[],
      (current) => {
        if (!Array.isArray(current)) {
          throw new LocalEffectiveAssetProjectionRecordStoreError(
            "Effective asset projection local store collection is invalid.",
          );
        }
        const next = mutation(cloneJson(current));
        assertSafeProjectionJson(next.records);
        return { value: cloneJson([...next.records]), result: next.result };
      },
    );
    await this.writeJson(
      "effective-asset-projection-manifest.json",
      this.manifest(),
    );
    return result;
  }
  private async ensure() {
    if (!this.documents) await mkdir(this.dir, { recursive: true });
    const m = await this.readJson(
      "effective-asset-projection-manifest.json",
      this.manifest(),
    );
    if (!m || typeof m !== "object")
      throw new LocalEffectiveAssetProjectionRecordStoreError(
        "Effective asset projection local store manifest is invalid.",
      );
    const x = m as Partial<Manifest>;
    if (x.schemaVersion !== 1)
      throw new LocalEffectiveAssetProjectionRecordStoreError(
        "Effective asset projection local store manifest schema version is unsupported.",
      );
    if (x.storeKind !== EFFECTIVE_ASSET_PROJECTIONS_LOCAL_STORE_KIND)
      throw new LocalEffectiveAssetProjectionRecordStoreError(
        "Effective asset projection local store manifest kind is unsupported.",
      );
  }
  private manifest(): Manifest {
    return {
      schemaVersion: 1,
      storeKind: EFFECTIVE_ASSET_PROJECTIONS_LOCAL_STORE_KIND,
      updatedAt: this.now(),
    };
  }
  private async readJson<T>(f: string, fallback: T): Promise<T> {
    if (this.documents)
      return (
        await readDocumentRecord(
          { rootDirectory: this.rootDir, documents: this.documents },
          `effective-asset-projections/${f}`,
          fallback,
        )
      ).value;
    try {
      return JSON.parse(await readFile(join(this.dir, f), "utf8")) as T;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT")
        return cloneJson(fallback);
      if (e instanceof SyntaxError)
        throw new LocalEffectiveAssetProjectionRecordStoreError(
          "Effective asset projection local store contains malformed JSON.",
        );
      throw e;
    }
  }
  private async writeJson(f: string, v: unknown) {
    if (this.documents) {
      await writeDocumentRecord(
        { rootDirectory: this.rootDir, documents: this.documents },
        `effective-asset-projections/${f}`,
        v,
      );
      return;
    }
    const p = join(this.dir, f);
    const t = `${p}.${process.pid}.${randomUUID()}.tmp`;
    await writeFile(t, `${JSON.stringify(v, null, 2)}\n`, "utf8");
    await rename(t, p).catch(async (e) => {
      await unlink(t).catch(() => undefined);
      throw e;
    });
  }
}
