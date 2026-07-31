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

export const ASSET_COMPOSITION_LOCAL_STORE_KIND =
  "asset-composition-local-store" as const;
export const ASSET_COMPOSITION_LOCAL_SCHEMA_VERSION = 1 as const;
interface Manifest {
  readonly schemaVersion: 1;
  readonly storeKind: typeof ASSET_COMPOSITION_LOCAL_STORE_KIND;
  readonly updatedAt: string;
}

export class LocalAssetCompositionPlanRecordStoreError extends Error {
  constructor(m: string) {
    super(m);
    this.name = "LocalAssetCompositionPlanRecordStoreError";
    this.stack = undefined;
  }
}
export class LocalAssetCompositionPlanRecordStore {
  private readonly dir: string;
  private readonly now: () => string;
  private readonly rootDir: string;
  private readonly documents?: StructuredDocumentStore;
  constructor(o: {
    rootDir: string;
    now?: () => string;
    documents?: StructuredDocumentStore;
  }) {
    this.dir = join(o.rootDir, "asset-composition");
    this.rootDir = o.rootDir;
    this.documents = o.documents;
    this.now = o.now ?? (() => new Date().toISOString());
  }
  async readPlans<T>(): Promise<readonly T[]> {
    await this.ensure();
    const v = await this.readJson("asset-composition-plans.json", [] as T[]);
    if (!Array.isArray(v))
      throw new LocalAssetCompositionPlanRecordStoreError(
        "Asset composition local store plan collection is invalid.",
      );
    return cloneJson(v as T[]);
  }
  async writePlans<T>(records: readonly T[]): Promise<void> {
    await this.ensure();
    if (JSON.stringify(records) === undefined)
      throw new LocalAssetCompositionPlanRecordStoreError(
        "Asset composition local store records must be JSON-safe.",
      );
    await this.writeJson("asset-composition-plans.json", cloneJson(records));
    await this.writeJson("asset-composition-manifest.json", this.manifest());
  }
  async mutatePlans<T, TResult>(
    mutation: (records: readonly T[]) => {
      records: readonly T[];
      result: TResult;
    },
  ): Promise<TResult> {
    await this.ensure();
    const result = await mutateDocumentRecord(
      { rootDirectory: this.rootDir, documents: this.documents },
      "asset-composition/asset-composition-plans.json",
      [] as T[],
      (current) => {
        if (!Array.isArray(current)) {
          throw new LocalAssetCompositionPlanRecordStoreError(
            "Asset composition local store plan collection is invalid.",
          );
        }
        const next = mutation(cloneJson(current));
        if (JSON.stringify(next.records) === undefined) {
          throw new LocalAssetCompositionPlanRecordStoreError(
            "Asset composition local store records must be JSON-safe.",
          );
        }
        return { value: cloneJson([...next.records]), result: next.result };
      },
    );
    await this.writeJson("asset-composition-manifest.json", this.manifest());
    return result;
  }
  private manifest(): Manifest {
    return {
      schemaVersion: 1,
      storeKind: ASSET_COMPOSITION_LOCAL_STORE_KIND,
      updatedAt: this.now(),
    };
  }
  private async ensure() {
    if (!this.documents) await mkdir(this.dir, { recursive: true });
    const m = await this.readJson(
      "asset-composition-manifest.json",
      this.manifest(),
    );
    if (!m || typeof m !== "object")
      throw new LocalAssetCompositionPlanRecordStoreError(
        "Asset composition local store manifest is invalid.",
      );
    const x = m as Partial<Manifest>;
    if (x.schemaVersion !== 1)
      throw new LocalAssetCompositionPlanRecordStoreError(
        "Asset composition local store manifest schema version is unsupported.",
      );
    if (x.storeKind !== ASSET_COMPOSITION_LOCAL_STORE_KIND)
      throw new LocalAssetCompositionPlanRecordStoreError(
        "Asset composition local store manifest kind is unsupported.",
      );
  }
  private async readJson<T>(f: string, fallback: T): Promise<T> {
    if (this.documents)
      return (
        await readDocumentRecord(
          { rootDirectory: this.rootDir, documents: this.documents },
          `asset-composition/${f}`,
          fallback,
        )
      ).value;
    try {
      return JSON.parse(await readFile(join(this.dir, f), "utf8")) as T;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT")
        return cloneJson(fallback);
      if (e instanceof SyntaxError)
        throw new LocalAssetCompositionPlanRecordStoreError(
          "Asset composition local store contains malformed JSON.",
        );
      throw e;
    }
  }
  private async writeJson(f: string, v: unknown) {
    if (this.documents) {
      await writeDocumentRecord(
        { rootDirectory: this.rootDir, documents: this.documents },
        `asset-composition/${f}`,
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
