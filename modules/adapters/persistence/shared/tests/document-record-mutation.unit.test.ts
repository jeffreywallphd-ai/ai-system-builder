import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  mutateDocumentRecord,
  readDocumentRecord,
} from "../document-record-persistence";
import { createInMemoryStructuredDocumentStore } from "../in-memory-structured-document-store";

test("missing document reads preserve an undefined fallback", async () => {
  const documents = createInMemoryStructuredDocumentStore();
  const structuredResult = await readDocumentRecord(
    { rootDirectory: ".", documents },
    "workspaces/missing/workspace.json",
    undefined,
  );
  assert.deepEqual(structuredResult, { found: false, value: undefined });

  const rootDirectory = await mkdtemp(join(tmpdir(), "document-missing-"));
  try {
    const fileResult = await readDocumentRecord(
      { rootDirectory },
      "workspaces/missing/workspace.json",
      undefined,
    );
    assert.deepEqual(fileResult, { found: false, value: undefined });
  } finally {
    await rm(rootDirectory, { recursive: true, force: true });
  }
});

test("atomic document mutation retries concurrent whole-document updates without loss", async () => {
  const documents = createInMemoryStructuredDocumentStore(
    () => "2026-07-16T00:00:00.000Z",
  );
  const persistence = { rootDirectory: ".", documents };

  await Promise.all(
    Array.from({ length: 50 }, (_, index) =>
      mutateDocumentRecord(
        persistence,
        "concurrency/counter.json",
        { count: 0, writers: [] as number[] },
        (current) => ({
          value: {
            count: current.count + 1,
            writers: [...current.writers, index],
          },
          result: undefined,
        }),
        { maximumAttempts: 100 },
      ),
    ),
  );

  const stored = await documents.readDocument<{
    count: number;
    writers: number[];
  }>("concurrency", "counter.json");
  assert.equal(stored?.value.count, 50);
  assert.equal(new Set(stored?.value.writers).size, 50);
  assert.equal(stored?.revision, 50);
});

test("expected revision zero provides insert-if-absent semantics", async () => {
  const documents = createInMemoryStructuredDocumentStore();
  await documents.writeDocument(
    "test",
    "record",
    { value: 1 },
    { expectedRevision: 0 },
  );
  await assert.rejects(
    () =>
      documents.writeDocument(
        "test",
        "record",
        { value: 2 },
        { expectedRevision: 0 },
      ),
    /revision conflict/,
  );
});

test("JSON compatibility mutations serialize concurrent writes within one process", async () => {
  const rootDirectory = await mkdtemp(join(tmpdir(), "document-mutation-"));
  await mkdir(join(rootDirectory, "concurrency"));

  await Promise.all(
    Array.from({ length: 24 }, (_, index) =>
      mutateDocumentRecord(
        { rootDirectory },
        "concurrency/counter.json",
        { count: 0, writers: [] as number[] },
        (current) => ({
          value: {
            count: current.count + 1,
            writers: [...current.writers, index],
          },
          result: undefined,
        }),
      ),
    ),
  );

  const result = await readDocumentRecord(
    { rootDirectory },
    "concurrency/counter.json",
    { count: 0, writers: [] as number[] },
  );
  assert.equal(result.value.count, 24);
  assert.equal(new Set(result.value.writers).size, 24);
});
