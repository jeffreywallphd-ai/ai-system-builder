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

export const RUNTIME_READINESS_LOCAL_STORE_KIND =
  "runtime-readiness-local-store" as const;
interface Manifest {
  readonly schemaVersion: 1;
  readonly storeKind: typeof RUNTIME_READINESS_LOCAL_STORE_KIND;
  readonly updatedAt: string;
}
export interface LocalRuntimeReadinessRecordStoreOptions {
  readonly rootDir: string;
  readonly now?: () => string;
  readonly documents?: StructuredDocumentStore;
}
export class LocalRuntimeReadinessRecordStoreError extends Error {
  constructor(m: string) {
    super(m);
    this.name = "LocalRuntimeReadinessRecordStoreError";
    this.stack = undefined;
  }
}
export class LocalRuntimeReadinessRecordStore {
  private readonly dir: string;
  private readonly now: () => string;
  private readonly rootDir: string;
  private readonly documents?: StructuredDocumentStore;
  constructor(o: LocalRuntimeReadinessRecordStoreOptions) {
    this.dir = join(o.rootDir, "runtime-readiness");
    this.rootDir = o.rootDir;
    this.documents = o.documents;
    this.now = o.now ?? (() => new Date().toISOString());
  }
  async readBindings<T>(): Promise<readonly T[]> {
    await this.ensure();
    const v = await this.readJson("runtime-readiness-bindings.json", [] as T[]);
    if (!Array.isArray(v))
      throw new LocalRuntimeReadinessRecordStoreError(
        "Runtime readiness binding collection is invalid.",
      );
    return cloneJson(v as T[]);
  }
  async writeBindings<T>(records: readonly T[]): Promise<void> {
    await this.writeJson("runtime-readiness-bindings.json", cloneJson(records));
    await this.writeJson("runtime-readiness-manifest.json", this.manifest());
  }
  async readInventory<T>(): Promise<readonly T[]> {
    await this.ensure();
    const v = await this.readJson("runtime-inventory.json", [] as T[]);
    if (!Array.isArray(v))
      throw new LocalRuntimeReadinessRecordStoreError(
        "Runtime inventory collection is invalid.",
      );
    return cloneJson(v as T[]);
  }
  async writeInventory<T>(records: readonly T[]): Promise<void> {
    await this.writeJson("runtime-inventory.json", cloneJson(records));
    await this.writeJson("runtime-readiness-manifest.json", this.manifest());
  }
  async mutateBindings<T, TResult>(
    mutation: (records: readonly T[]) => {
      records: readonly T[];
      result: TResult;
    },
  ): Promise<TResult> {
    return this.mutateCollection(
      "runtime-readiness-bindings.json",
      "Runtime readiness binding collection is invalid.",
      mutation,
    );
  }
  async mutateInventory<T, TResult>(
    mutation: (records: readonly T[]) => {
      records: readonly T[];
      result: TResult;
    },
  ): Promise<TResult> {
    return this.mutateCollection(
      "runtime-inventory.json",
      "Runtime inventory collection is invalid.",
      mutation,
    );
  }
  private async mutateCollection<T, TResult>(
    file: string,
    invalidMessage: string,
    mutation: (records: readonly T[]) => {
      records: readonly T[];
      result: TResult;
    },
  ): Promise<TResult> {
    await this.ensure();
    const result = await mutateDocumentRecord(
      { rootDirectory: this.rootDir, documents: this.documents },
      `runtime-readiness/${file}`,
      [] as T[],
      (current) => {
        if (!Array.isArray(current)) {
          throw new LocalRuntimeReadinessRecordStoreError(invalidMessage);
        }
        const next = mutation(cloneJson(current));
        return { value: cloneJson([...next.records]), result: next.result };
      },
    );
    await this.writeJson("runtime-readiness-manifest.json", this.manifest());
    return result;
  }
  private manifest(): Manifest {
    return {
      schemaVersion: 1,
      storeKind: RUNTIME_READINESS_LOCAL_STORE_KIND,
      updatedAt: this.now(),
    };
  }
  private async ensure() {
    if (!this.documents) await mkdir(this.dir, { recursive: true });
    const m = await this.readJson(
      "runtime-readiness-manifest.json",
      this.manifest(),
    );
    const x = m as Partial<Manifest>;
    if (x.schemaVersion !== 1)
      throw new LocalRuntimeReadinessRecordStoreError(
        "Runtime readiness local store manifest schema version is unsupported.",
      );
    if (x.storeKind !== RUNTIME_READINESS_LOCAL_STORE_KIND)
      throw new LocalRuntimeReadinessRecordStoreError(
        "Runtime readiness local store manifest kind is unsupported.",
      );
  }
  private async readJson<T>(f: string, fallback: T): Promise<T> {
    if (this.documents)
      return (
        await readDocumentRecord(
          { rootDirectory: this.rootDir, documents: this.documents },
          `runtime-readiness/${f}`,
          fallback,
        )
      ).value;
    try {
      return JSON.parse(await readFile(join(this.dir, f), "utf8")) as T;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT")
        return cloneJson(fallback);
      if (e instanceof SyntaxError)
        throw new LocalRuntimeReadinessRecordStoreError(
          "Runtime readiness local store contains malformed JSON.",
        );
      throw e;
    }
  }
  private async writeJson(f: string, v: unknown) {
    if (this.documents) {
      await writeDocumentRecord(
        { rootDirectory: this.rootDir, documents: this.documents },
        `runtime-readiness/${f}`,
        v,
      );
      return;
    }
    const p = join(this.dir, f);
    const t = `${p}.${process.pid}.${randomUUID()}.tmp`;
    await writeFile(t, `${JSON.stringify(v, null, 2)}\n`, `utf8`);
    await rename(t, p).catch(async (e) => {
      await unlink(t).catch(() => undefined);
      throw e;
    });
  }
}
