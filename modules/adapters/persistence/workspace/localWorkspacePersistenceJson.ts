import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, relative } from "node:path";
import { randomUUID } from "node:crypto";

import { LocalWorkspacePersistenceError, type LocalWorkspacePersistenceErrorCode } from "./localWorkspacePersistenceErrors";
import { mutateDocumentRecord, readDocumentRecord, writeDocumentRecord, type StructuredDocumentStore } from "../shared";

export interface WorkspaceDocumentPersistenceOptions {
  readonly rootDirectory: string;
  readonly documents?: StructuredDocumentStore;
}

export async function readJsonDocument<T>(filePath: string, fallback: T, readErrorCode: LocalWorkspacePersistenceErrorCode, persistence?: WorkspaceDocumentPersistenceOptions): Promise<T> {
  if (persistence?.documents) {
    return (await readDocumentRecord(persistence, relative(persistence.rootDirectory, filePath), fallback)).value;
  }
  try {
    return cloneJson(JSON.parse(await readFile(filePath, "utf8")) as T);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return fallback === undefined ? fallback : cloneJson(fallback);
    }

    throw new LocalWorkspacePersistenceError(readErrorCode, { cause: error });
  }
}

export async function writeJsonDocument(filePath: string, value: unknown, writeErrorCode: LocalWorkspacePersistenceErrorCode, persistence?: WorkspaceDocumentPersistenceOptions): Promise<void> {
  if (persistence?.documents) {
    await writeDocumentRecord(persistence, relative(persistence.rootDirectory, filePath), value);
    return;
  }
  const temporaryPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(temporaryPath, `${JSON.stringify(cloneJson(value), null, 2)}\n`, "utf8");
    await rename(temporaryPath, filePath);
  } catch (error) {
    await unlink(temporaryPath).catch(() => undefined);
    throw new LocalWorkspacePersistenceError(writeErrorCode, { cause: error });
  }
}

export async function mutateJsonDocument<T, TResult>(
  filePath: string,
  fallback: T,
  writeErrorCode: LocalWorkspacePersistenceErrorCode,
  mutation: (current: T) => { value: T; result: TResult },
  persistence?: WorkspaceDocumentPersistenceOptions,
): Promise<TResult> {
  try {
    if (persistence?.documents) {
      return await mutateDocumentRecord(
        persistence,
        relative(persistence.rootDirectory, filePath),
        fallback,
        mutation,
      );
    }
    const current = await readJsonDocument(filePath, fallback, writeErrorCode, persistence);
    const next = mutation(current);
    await writeJsonDocument(filePath, next.value, writeErrorCode, persistence);
    return next.result;
  } catch (error) {
    if (error instanceof LocalWorkspacePersistenceError) throw error;
    throw new LocalWorkspacePersistenceError(writeErrorCode, { cause: error });
  }
}

export function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
