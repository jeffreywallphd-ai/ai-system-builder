import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { ExecutionPlanRecord } from "../../../contracts/execution-plans";
import {
  mutateDocumentRecord,
  readDocumentRecord,
  writeDocumentRecord,
  type StructuredDocumentStore,
} from "../shared";

export const EXECUTION_PLAN_LOCAL_STORE_KIND =
  "execution-plan-local-store" as const;
export const EXECUTION_PLAN_LOCAL_SCHEMA_VERSION = 1 as const;

export interface LocalExecutionPlanManifest {
  readonly schemaVersion: typeof EXECUTION_PLAN_LOCAL_SCHEMA_VERSION;
  readonly storeKind: typeof EXECUTION_PLAN_LOCAL_STORE_KIND;
  readonly updatedAt: string;
}

export interface LocalExecutionPlanRecordStoreOptions {
  readonly rootDir: string;
  readonly now?: () => string;
  readonly documents?: StructuredDocumentStore;
}

export class LocalExecutionPlanRecordStoreError extends Error {
  public constructor(message: string, options?: { cause?: unknown }) {
    super(message);
    this.name = "LocalExecutionPlanRecordStoreError";
    if (options && "cause" in options) {
      (this as Error & { cause?: unknown }).cause = options.cause;
    }
    this.stack = undefined;
  }
}

export class LocalExecutionPlanRecordStore {
  private readonly storeDir: string;
  private readonly now: () => string;
  private readonly rootDir: string;
  private readonly documents?: StructuredDocumentStore;
  private writeQueue: Promise<void> = Promise.resolve();

  public constructor(options: LocalExecutionPlanRecordStoreOptions) {
    this.storeDir = join(options.rootDir, "execution-plans");
    this.rootDir = options.rootDir;
    this.documents = options.documents;
    this.now = options.now ?? (() => new Date().toISOString());
  }

  public async readManifest(): Promise<LocalExecutionPlanManifest> {
    await this.ensureStoreFiles();
    return validateManifest(
      await this.readJsonFile("manifest.json", this.createManifest()),
    );
  }

  public async readPlans(): Promise<readonly ExecutionPlanRecord[]> {
    await this.ensureStoreFiles();
    return this.readJsonFile("execution-plans.json", []);
  }

  public async writePlans(
    records: readonly ExecutionPlanRecord[],
  ): Promise<void> {
    const operation = this.writeQueue.then(
      () => this.writePlansNow(records),
      () => this.writePlansNow(records),
    );
    this.writeQueue = operation.catch(() => undefined);
    await operation;
  }

  public async mutatePlans<TResult>(
    mutation: (records: readonly ExecutionPlanRecord[]) => {
      records: readonly ExecutionPlanRecord[];
      result: TResult;
    },
  ): Promise<TResult> {
    await this.ensureStoreFiles();
    const result = await mutateDocumentRecord(
      { rootDirectory: this.rootDir, documents: this.documents },
      "execution-plans/execution-plans.json",
      [] as ExecutionPlanRecord[],
      (current) => {
        if (!Array.isArray(current)) {
          throw new LocalExecutionPlanRecordStoreError(
            "Execution plan local store collection is invalid.",
          );
        }
        const next = mutation(cloneJson(current));
        assertJsonCompatible(next.records);
        return { value: cloneJson([...next.records]), result: next.result };
      },
    );
    await this.writeJsonFile("manifest.json", this.createManifest());
    return result;
  }

  private async writePlansNow(
    records: readonly ExecutionPlanRecord[],
  ): Promise<void> {
    await this.ensureStoreFiles();
    assertJsonCompatible(records);
    await this.writeJsonFile("execution-plans.json", cloneJson(records));
    await this.writeJsonFile("manifest.json", this.createManifest());
  }

  private async ensureStoreFiles(): Promise<void> {
    if (!this.documents) await mkdir(this.storeDir, { recursive: true });
    await this.ensureJsonFile("manifest.json", this.createManifest());
    await this.ensureJsonFile("execution-plans.json", []);
  }

  private async ensureJsonFile(file: string, fallback: unknown): Promise<void> {
    if (this.documents) {
      const result = await readDocumentRecord(
        { rootDirectory: this.rootDir, documents: this.documents },
        `execution-plans/${file}`,
        fallback,
      );
      if (file === "manifest.json") validateManifest(result.value);
      else if (!Array.isArray(result.value))
        throw new LocalExecutionPlanRecordStoreError(
          "Execution plan local store collection is invalid.",
        );
      if (!result.found) await this.writeJsonFile(file, fallback);
      return;
    }
    const value = await this.readJsonFile(file, fallback);
    if (file === "manifest.json") {
      validateManifest(value);
    } else if (!Array.isArray(value)) {
      throw new LocalExecutionPlanRecordStoreError(
        "Execution plan local store collection is invalid.",
      );
    }

    try {
      await readFile(this.path(file), "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw error;
      }
      await this.writeJsonFile(file, fallback);
    }
  }

  private async readJsonFile<T>(file: string, fallback: T): Promise<T> {
    if (this.documents) {
      return (
        await readDocumentRecord(
          { rootDirectory: this.rootDir, documents: this.documents },
          `execution-plans/${file}`,
          fallback,
        )
      ).value;
    }
    try {
      return cloneJson(
        JSON.parse(await readFile(this.path(file), "utf8")) as unknown,
      ) as T;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return cloneJson(fallback);
      }
      if (error instanceof SyntaxError) {
        throw new LocalExecutionPlanRecordStoreError(
          "Execution plan local store contains malformed JSON.",
          { cause: error },
        );
      }
      throw new LocalExecutionPlanRecordStoreError(
        "Execution plan local store could not be read.",
        { cause: error },
      );
    }
  }

  private async writeJsonFile(file: string, value: unknown): Promise<void> {
    if (this.documents) {
      await writeDocumentRecord(
        { rootDirectory: this.rootDir, documents: this.documents },
        `execution-plans/${file}`,
        value,
      );
      return;
    }
    const path = this.path(file);
    const tempPath = `${path}.${process.pid}.${randomUUID()}.tmp`;
    try {
      await writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
      await rename(tempPath, path);
    } catch (error) {
      await unlink(tempPath).catch(() => undefined);
      throw new LocalExecutionPlanRecordStoreError(
        "Execution plan local store could not be written.",
        { cause: error },
      );
    }
  }

  private createManifest(): LocalExecutionPlanManifest {
    return {
      schemaVersion: EXECUTION_PLAN_LOCAL_SCHEMA_VERSION,
      storeKind: EXECUTION_PLAN_LOCAL_STORE_KIND,
      updatedAt: this.now(),
    };
  }

  private path(file: string): string {
    return join(this.storeDir, file);
  }
}

function validateManifest(value: unknown): LocalExecutionPlanManifest {
  if (!value || typeof value !== "object") {
    throw new LocalExecutionPlanRecordStoreError(
      "Execution plan local store manifest is invalid.",
    );
  }

  const manifest = value as Record<string, unknown>;
  if (
    manifest.schemaVersion !== EXECUTION_PLAN_LOCAL_SCHEMA_VERSION ||
    manifest.storeKind !== EXECUTION_PLAN_LOCAL_STORE_KIND ||
    typeof manifest.updatedAt !== "string"
  ) {
    throw new LocalExecutionPlanRecordStoreError(
      "Execution plan local store manifest is invalid.",
    );
  }

  return {
    schemaVersion: EXECUTION_PLAN_LOCAL_SCHEMA_VERSION,
    storeKind: EXECUTION_PLAN_LOCAL_STORE_KIND,
    updatedAt: manifest.updatedAt,
  };
}

export function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function assertJsonCompatible(value: unknown): void {
  try {
    const serialized = JSON.stringify(value);
    if (typeof serialized !== "string") {
      throw new Error();
    }
  } catch {
    throw new LocalExecutionPlanRecordStoreError(
      "Execution plan local store accepts JSON-compatible records only.",
    );
  }
}
