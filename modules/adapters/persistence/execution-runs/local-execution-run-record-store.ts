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
export const EXECUTION_RUNS_LOCAL_STORE_KIND =
  "execution-runs-local-store" as const;
type Manifest = {
  schemaVersion: 1;
  storeKind: typeof EXECUTION_RUNS_LOCAL_STORE_KIND;
  updatedAt: string;
};
export class LocalExecutionRunRecordStoreError extends Error {
  constructor(m: string) {
    super(m);
    this.name = "LocalExecutionRunRecordStoreError";
    this.stack = undefined;
  }
}
export class LocalExecutionRunRecordStore {
  constructor(
    private readonly o: {
      rootDir: string;
      now?: () => string;
      documents?: StructuredDocumentStore;
    },
  ) {}
  private get dir() {
    return join(this.o.rootDir, "execution-runs");
  }
  private now() {
    return this.o.now?.() ?? new Date().toISOString();
  }
  private manifest(): Manifest {
    return {
      schemaVersion: 1,
      storeKind: EXECUTION_RUNS_LOCAL_STORE_KIND,
      updatedAt: this.now(),
    };
  }
  private async ensure() {
    if (!this.o.documents) await mkdir(this.dir, { recursive: true });
    const m = (await this.readJson(
      "execution-runs-manifest.json",
      this.manifest(),
    )) as Partial<Manifest>;
    if (m.schemaVersion !== 1)
      throw new LocalExecutionRunRecordStoreError(
        "Execution-runs local store manifest schema version is unsupported.",
      );
    if (m.storeKind !== EXECUTION_RUNS_LOCAL_STORE_KIND)
      throw new LocalExecutionRunRecordStoreError(
        "Execution-runs local store manifest kind is unsupported.",
      );
  }
  async readCollection<T>(file: string) {
    await this.ensure();
    const x = await this.readJson(file, [] as T[]);
    if (!Array.isArray(x))
      throw new LocalExecutionRunRecordStoreError(
        "Execution-runs collection is invalid.",
      );
    return cloneJson(x as T[]);
  }
  async writeCollection<T>(file: string, records: readonly T[]) {
    await this.writeJson(file, cloneJson(records));
    await this.writeJson("execution-runs-manifest.json", this.manifest());
  }
  async mutateCollection<T, TResult>(
    file: string,
    mutation: (records: readonly T[]) => {
      records: readonly T[];
      result: TResult;
    },
  ): Promise<TResult> {
    await this.ensure();
    const result = await mutateDocumentRecord(
      { rootDirectory: this.o.rootDir, documents: this.o.documents },
      `execution-runs/${file}`,
      [] as T[],
      (current) => {
        if (!Array.isArray(current)) {
          throw new LocalExecutionRunRecordStoreError(
            "Execution-runs collection is invalid.",
          );
        }
        const next = mutation(cloneJson(current));
        return { value: cloneJson([...next.records]), result: next.result };
      },
    );
    await this.writeJson("execution-runs-manifest.json", this.manifest());
    return result;
  }
  private async readJson<T>(f: string, fb: T): Promise<T> {
    if (this.o.documents)
      return (
        await readDocumentRecord(
          { rootDirectory: this.o.rootDir, documents: this.o.documents },
          `execution-runs/${f}`,
          fb,
        )
      ).value;
    try {
      return JSON.parse(await readFile(join(this.dir, f), "utf8")) as T;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return cloneJson(fb);
      if (e instanceof SyntaxError)
        throw new LocalExecutionRunRecordStoreError(
          "Execution-runs local store contains malformed JSON.",
        );
      throw e;
    }
  }
  private async writeJson(f: string, v: unknown) {
    if (this.o.documents) {
      await writeDocumentRecord(
        { rootDirectory: this.o.rootDir, documents: this.o.documents },
        `execution-runs/${f}`,
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
