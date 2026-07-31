import { readFile, rename, unlink, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import * as path from "node:path";

import {
  StructuredDocumentConflictError,
  cloneStructuredJson,
  type StructuredDocumentStore,
} from "./structured-document-store";

export interface DocumentRecordPersistenceOptions {
  readonly rootDirectory: string;
  readonly documents?: StructuredDocumentStore;
}

export interface ReadDocumentRecordResult<T> {
  readonly found: boolean;
  readonly value: T;
}

export interface DocumentRecordMutation<T, TResult> {
  readonly value: T;
  readonly result: TResult;
}

export interface MutateDocumentRecordOptions {
  readonly maximumAttempts?: number;
}

const fileMutationQueues = new Map<string, Promise<void>>();

export async function readDocumentRecord<T>(
  options: DocumentRecordPersistenceOptions,
  relativeFilePath: string,
  fallback: T,
): Promise<ReadDocumentRecordResult<T>> {
  const identity = resolveDocumentIdentity(relativeFilePath);
  if (options.documents) {
    const document = await options.documents.readDocument<T>(
      identity.namespace,
      identity.key,
    );
    return document
      ? { found: true, value: cloneStructuredJson(document.value) }
      : { found: false, value: cloneDocumentFallback(fallback) };
  }

  try {
    const source = await readFile(
      path.join(options.rootDirectory, relativeFilePath),
      "utf8",
    );
    return { found: true, value: JSON.parse(source) as T };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { found: false, value: cloneDocumentFallback(fallback) };
    }
    throw error;
  }
}

function cloneDocumentFallback<T>(fallback: T): T {
  return fallback === undefined ? fallback : cloneStructuredJson(fallback);
}

export async function writeDocumentRecord<T>(
  options: DocumentRecordPersistenceOptions,
  relativeFilePath: string,
  value: T,
): Promise<void> {
  const safeValue = cloneStructuredJson(value);
  const identity = resolveDocumentIdentity(relativeFilePath);
  if (options.documents) {
    await options.documents.writeDocument(
      identity.namespace,
      identity.key,
      safeValue,
    );
    return;
  }

  const target = path.join(options.rootDirectory, relativeFilePath);
  const temporaryPath = `${target}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeFile(
      temporaryPath,
      `${JSON.stringify(safeValue, null, 2)}\n`,
      "utf8",
    );
    await rename(temporaryPath, target);
  } catch (error) {
    await unlink(temporaryPath).catch(() => undefined);
    throw error;
  }
}

/**
 * Recomputes a pure whole-document mutation after optimistic conflicts. The
 * callback must not perform I/O or other side effects because it may run more
 * than once. JSON compatibility mode serializes mutations within one process;
 * managed and SQLite database stores use revision compare-and-swap.
 */
export async function mutateDocumentRecord<T, TResult>(
  options: DocumentRecordPersistenceOptions,
  relativeFilePath: string,
  fallback: T,
  mutation: (current: T) => DocumentRecordMutation<T, TResult>,
  mutateOptions: MutateDocumentRecordOptions = {},
): Promise<TResult> {
  const maximumAttempts = mutateOptions.maximumAttempts ?? 64;
  if (
    !Number.isInteger(maximumAttempts) ||
    maximumAttempts < 1 ||
    maximumAttempts > 100
  ) {
    throw new RangeError(
      "maximumAttempts must be an integer from 1 through 100.",
    );
  }

  if (!options.documents) {
    const target = path.resolve(options.rootDirectory, relativeFilePath);
    const previous = fileMutationQueues.get(target) ?? Promise.resolve();
    let result!: TResult;
    const operation = previous.then(async () => {
      const current = await readDocumentRecord(
        options,
        relativeFilePath,
        fallback,
      );
      const next = mutation(cloneStructuredJson(current.value));
      result = next.result;
      await writeDocumentRecord(options, relativeFilePath, next.value);
    });
    const settled = operation.then(
      () => undefined,
      () => undefined,
    );
    fileMutationQueues.set(target, settled);
    try {
      await operation;
      return result;
    } finally {
      if (fileMutationQueues.get(target) === settled) {
        fileMutationQueues.delete(target);
      }
    }
  }

  const identity = resolveDocumentIdentity(relativeFilePath);
  let lastConflict: StructuredDocumentConflictError | undefined;
  for (let attempt = 1; attempt <= maximumAttempts; attempt += 1) {
    const current = await options.documents.readDocument<T>(
      identity.namespace,
      identity.key,
    );
    const next = mutation(cloneStructuredJson(current?.value ?? fallback));
    try {
      await options.documents.writeDocument(
        identity.namespace,
        identity.key,
        next.value,
        {
          expectedRevision: current?.revision ?? 0,
        },
      );
      return next.result;
    } catch (error) {
      if (!(error instanceof StructuredDocumentConflictError)) throw error;
      lastConflict = error;
    }
  }
  throw (
    lastConflict ??
    new StructuredDocumentConflictError(identity.namespace, identity.key, 0)
  );
}

export function resolveDocumentIdentity(relativeFilePath: string): {
  namespace: string;
  key: string;
} {
  const normalized = relativeFilePath.replace(/\\/g, "/").replace(/^\/+/, "");
  if (!normalized || normalized.includes("../") || normalized === "..") {
    throw new Error(
      `Structured document path is invalid: ${relativeFilePath}.`,
    );
  }
  const separator = normalized.lastIndexOf("/");
  return separator < 0
    ? { namespace: "root", key: normalized }
    : {
        namespace: normalized.slice(0, separator),
        key: normalized.slice(separator + 1),
      };
}
