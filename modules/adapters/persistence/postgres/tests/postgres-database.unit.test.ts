import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import type { QueryResult } from "pg";

import { createOrganizationId } from "../../../../contracts/organization";
import type { StructuredDocumentStore } from "../../shared";
import {
  resolvePostgresPoolConfig,
  type PostgresPoolLike,
  type PostgresQueryable,
} from "../client/createPostgresPool";
import {
  migratePostgresDatabase,
  openPostgresDatabase,
  POSTGRES_MIGRATION_0001,
  POSTGRES_MIGRATION_0002,
  POSTGRES_MIGRATION_LOCK_KEY,
  createPostgresStructuredDocumentStore,
} from "../postgres-database";

test("PostgreSQL config is fail-closed and TLS-verifying by default", () => {
  assert.throws(() => resolvePostgresPoolConfig({}), /DATABASE_URL is required/);
  const config = resolvePostgresPoolConfig({ DATABASE_URL: "postgresql://user:secret@db.example/app" });
  assert.equal(config.sslMode, "verify-full");
  assert.equal(config.maxConnections, 10);
  assert.equal(JSON.stringify({ sslMode: config.sslMode, max: config.maxConnections }).includes("secret"), false);
});

test("PostgreSQL config validates bounded pool and TLS inputs", () => {
  assert.throws(
    () => resolvePostgresPoolConfig({ DATABASE_URL: "postgresql://db/app", POSTGRES_POOL_MAX: "0" }),
    /POSTGRES_POOL_MAX/,
  );
  assert.throws(
    () => resolvePostgresPoolConfig({ DATABASE_URL: "postgresql://db/app", POSTGRES_SSL_MODE: "prefer" }),
    /POSTGRES_SSL_MODE/,
  );
  assert.equal(resolvePostgresPoolConfig({ DATABASE_URL: "postgresql://db/app", POSTGRES_SSL_MODE: "disable" }).sslMode, "disable");
});

test("migration uses one transaction and an advisory transaction lock", async () => {
  const queries: { text: string; values?: readonly unknown[] }[] = [];
  const client: PostgresQueryable = {
    async query(text, values) {
      queries.push({ text, values });
      const rows = text.includes("MAX(version)") ? [{ version: 0 }] : [];
      return queryResult(rows);
    },
  };
  await migratePostgresDatabase(client, () => "2026-07-16T12:00:00.000Z");
  assert.equal(queries[0]?.text, "BEGIN");
  assert.deepEqual(queries[1]?.values, [POSTGRES_MIGRATION_LOCK_KEY]);
  assert.ok(queries.some((query) => query.text.includes("CREATE TABLE IF NOT EXISTS structured_documents")));
  assert.ok(queries.some((query) => query.text.includes("FORCE ROW LEVEL SECURITY")));
  assert.equal(queries[queries.length - 1]?.text, "COMMIT");
});

test("checked-in PostgreSQL migration matches the runtime migration", async () => {
  const checkedIn = await readFile(path.resolve("migrations", "postgres", "0001-create-structured-document-store.sql"), "utf8");
  assert.equal(normalizeSql(checkedIn), normalizeSql(POSTGRES_MIGRATION_0001));
});

test("checked-in organization PostgreSQL migration matches forced-RLS runtime migration", async () => {
  const checkedIn = await readFile(path.resolve("migrations", "postgres", "0002-create-organization-document-store-with-rls.sql"), "utf8");
  assert.equal(normalizeSql(checkedIn), normalizeSql(POSTGRES_MIGRATION_0002));
  assert.match(POSTGRES_MIGRATION_0002, /current_setting\('app\.organization_id', true\)/);
});

test("startup failure releases the checked-out client before draining the pool", async () => {
  const lifecycle: string[] = [];
  const client = {
    async query(text: string) {
      if (text.includes("MAX(version)")) return queryResult([{ version: 1 }]);
      if (text.includes("SELECT 1 AS healthy")) throw new Error("connection lost: postgresql://secret");
      return queryResult([]);
    },
    release() { lifecycle.push("release"); },
  };
  const pool = {
    totalCount: 1,
    idleCount: 0,
    waitingCount: 0,
    async connect() { return client; },
    async query() { return queryResult([]); },
    async end() { lifecycle.push("end"); },
  } as unknown as PostgresPoolLike;

  await assert.rejects(
    () => openPostgresDatabase({
      config: resolvePostgresPoolConfig({ DATABASE_URL: "postgresql://user:secret@db.example/app" }),
      pool,
    }),
    (error: unknown) => error instanceof Error && error.message === "PostgreSQL startup validation failed.",
  );
  assert.deepEqual(lifecycle, ["release", "end"]);
});

test("idle pool errors are consumed and surfaced only as sanitized health counters", async () => {
  let idleErrorListener: ((error: Error) => void) | undefined;
  const client = {
    async query(text: string) {
      if (text.includes("MAX(version)")) return queryResult([{ version: 1 }]);
      return queryResult([]);
    },
    release() {},
  };
  const pool = {
    totalCount: 2,
    idleCount: 2,
    waitingCount: 0,
    on(event: string, listener: (error: Error) => void) {
      if (event === "error") idleErrorListener = listener;
    },
    async connect() { return client; },
    async query() { return queryResult([{ schema_version: 1 }]); },
    async end() {},
  } as unknown as PostgresPoolLike;
  const database = await openPostgresDatabase({
    config: resolvePostgresPoolConfig({ DATABASE_URL: "postgresql://db.example/app" }),
    pool,
    now: () => "2026-07-16T14:00:00.000Z",
  });
  idleErrorListener?.(new Error("postgresql://user:secret@db.example/app"));
  const health = await database.checkHealth();
  assert.equal(health.pool.idleClientErrorCount, 1);
  assert.equal(health.pool.lastIdleClientErrorAt, "2026-07-16T14:00:00.000Z");
  assert.equal(JSON.stringify(health).includes("secret"), false);
  await database.close();
});

test("serializable transactions retry the complete callback after serialization failure", async () => {
  let attempts = 0;
  const lifecycle: string[] = [];
  const client = {
    async query(text: string) {
      lifecycle.push(text);
      return queryResult([], text);
    },
    release() { lifecycle.push("release"); },
  };
  const pool = {
    totalCount: 1,
    idleCount: 1,
    waitingCount: 0,
    async connect() { return client; },
    async query() { return queryResult([]); },
    async end() {},
  } as unknown as PostgresPoolLike;

  const store = createPostgresStructuredDocumentStore(pool);
  const value = await store.runInTransaction(async () => {
    attempts += 1;
    if (attempts === 1) throw Object.assign(new Error("retry"), { code: "40001" });
    return "committed";
  });

  assert.equal(value, "committed");
  assert.equal(attempts, 2);
  assert.equal(lifecycle.filter((entry) => entry === "BEGIN ISOLATION LEVEL SERIALIZABLE").length, 2);
  assert.equal(lifecycle.filter((entry) => entry === "ROLLBACK").length, 1);
  assert.equal(lifecycle.filter((entry) => entry === "COMMIT").length, 1);
  assert.equal(lifecycle.filter((entry) => entry === "release").length, 2);
});

test("organization-scoped PostgreSQL operations bind transaction-local context and explicit predicates", async () => {
  const queries: { text: string; values?: readonly unknown[] }[] = [];
  const client = {
    async query(text: string, values?: readonly unknown[]) {
      queries.push({ text, values });
      if (text.includes("RETURNING namespace")) {
        return queryResult([{
          namespace: "settings",
          document_key: "shared",
          payload_json: { owner: "a" },
          revision: "1",
          updated_at: "2026-07-16T12:00:00.000Z",
        }]);
      }
      return queryResult([]);
    },
    release() {},
  };
  const pool = {
    totalCount: 1,
    idleCount: 1,
    waitingCount: 0,
    async connect() { return client; },
    async query() { throw new Error("scoped operations must use a checked-out transaction client"); },
    async end() {},
  } as unknown as PostgresPoolLike;
  const orgAId = createOrganizationId("org-a");
  const store = createPostgresStructuredDocumentStore(pool, () => "2026-07-16T12:00:00.000Z")
    .forOrganization(orgAId);

  const written = await store.writeDocument("settings", "shared", { owner: "a" });
  await store.readDocument("settings", "shared");
  assert.equal(written.value.owner, "a");
  assert.deepEqual(queries[0], { text: "BEGIN", values: undefined });
  assert.deepEqual(queries[1], {
    text: "SELECT set_config('app.organization_id', $1, true)",
    values: [orgAId],
  });
  assert.match(queries[2]?.text ?? "", /INSERT INTO organization_documents \(organization_id,/);
  assert.deepEqual(queries[2]?.values?.slice(0, 3), [orgAId, "settings", "shared"]);
  const scopedRead = queries.find((query) => query.text.includes("WHERE organization_id = $1"));
  assert.ok(scopedRead);
  assert.deepEqual(scopedRead.values, [orgAId, "settings", "shared"]);
  assert.equal(queries[queries.length - 1]?.text, "COMMIT");
  assert.throws(
    () => store.forOrganization(createOrganizationId("org-b")),
    /cannot change organization scope/,
  );
});

test("an owned PostgreSQL transaction fences its views and pairs each organization binding with its query", async () => {
  const a = createOrganizationId("owned-a");
  const b = createOrganizationId("owned-b");
  let bound: string | undefined;
  const { store, statements, releases } = trackedTransactions((sql, values) => {
    if (sql.startsWith("SELECT set_config")) bound = String(values?.[0]);
    if (sql.includes("FROM organization_documents")) assert.equal(bound, values?.[0]);
  });
  let retained: StructuredDocumentStore | undefined;
  let returnFromOutside = () => {};
  const outside = new Promise<void>((resolve) => { returnFromOutside = resolve; });
  let entered = () => {};
  const ready = new Promise<void>((resolve) => { entered = resolve; });
  const run = store.runInOwnedTransaction!(async (transaction) => {
    assert.equal(transaction.runInOwnedTransaction, undefined);
    const scoped = transaction.forOrganization(a);
    retained = scoped;
    entered();
    await outside;
    assert.throws(() => scoped.forOrganization(b), /cannot change organization scope/);
    await assert.rejects(store.readDocument("scope", "root"), /Use the supplied/);
    await assert.rejects(store.runInOwnedTransaction!(async () => undefined, () => {}), /Use the supplied/);
    await Promise.all([
      scoped.runInTransaction((nested) => nested.readDocument("scope", "a")),
      transaction.forOrganization(b).readDocument("scope", "b"),
    ]);
    return "saved";
  }, () => {
    statements.push("policy");
    assert.throws(() => retained!.forOrganization(a), /owner is not active/);
  });
  await ready;
  try {
    await assert.rejects(retained!.readDocument("scope", "outside"), /owner is not active/);
  } finally {
    returnFromOutside();
  }
  assert.equal(await run, "saved");
  await assert.rejects(retained!.runInTransaction(async () => undefined), /owner is not active/);
  assert.deepEqual(statements.slice(-2), ["policy", "COMMIT"]);
  assert.deepEqual(releases, [false]);
});

test("explicit commit conflicts rerun the callback and commit check with a fresh owner", async () => {
  let commits = 0;
  const { store, releases } = trackedTransactions((sql) => {
    if (sql === "COMMIT" && ++commits === 1) throw Object.assign(new Error("retry"), { code: "40001" });
  });
  let first: StructuredDocumentStore | undefined;
  let checks = 0;
  assert.equal(await store.runInOwnedTransaction!(async (transaction) => {
    if (!first) first = transaction;
    else await assert.rejects(first.listNamespaces(), /owner is not active/);
    await transaction.listNamespaces();
    return "saved";
  }, () => { checks += 1; }), "saved");
  assert.equal(checks, 2);
  assert.equal(commits, 2);
  assert.deepEqual(releases, [false, false]);
});

test("owned PostgreSQL work distinguishes a rejected policy, uncertain outcome and server rollback", async () => {
  const policyDenied = new Error("policy denied");
  const denied = trackedTransactions();
  await assert.rejects(denied.store.runInOwnedTransaction!(async () => "saved", () => { throw policyDenied; }), policyDenied);
  assert.deepEqual(denied.statements, ["BEGIN ISOLATION LEVEL SERIALIZABLE", "ROLLBACK"]);
  assert.deepEqual(denied.releases, [false]);

  const unknown = trackedTransactions((sql) => {
    if (sql === "COMMIT") throw new Error("private driver failure");
  });
  await assert.rejects(unknown.store.runInOwnedTransaction!(async () => "saved", () => {}), {
    message: "The PostgreSQL transaction commit could not be confirmed.",
  });
  assert.deepEqual(unknown.releases, [true]);
  assert.equal(unknown.statements.filter((sql) => sql === "COMMIT").length, 1);

  const unconfirmed = trackedTransactions((sql) => {
    if (sql === "ROLLBACK") throw new Error("private driver failure");
  });
  await assert.rejects(unconfirmed.store.runInOwnedTransaction!(async () => "saved", () => { throw policyDenied; }), {
    message: "The owned PostgreSQL transaction rollback could not be confirmed.",
  });
  assert.deepEqual(unconfirmed.releases, [true]);

  const rolledBack = trackedTransactions((sql) => sql === "COMMIT" ? "ROLLBACK" : undefined);
  await assert.rejects(rolledBack.store.runInOwnedTransaction!(async () => "saved", () => {}), /did not commit/);
  assert.deepEqual(rolledBack.releases, [false]);
});

test("owned PostgreSQL work rolls back with a detached query or an asynchronous commit check", async () => {
  const detached = trackedTransactions();
  let pending: Promise<unknown> | undefined;
  await assert.rejects(detached.store.runInOwnedTransaction!(async (transaction) => {
    pending = transaction.listNamespaces().catch(() => undefined);
  }, () => assert.fail("pending operations must deny commit")), /Unfinished PostgreSQL transaction operations/);
  await pending;
  assert.ok(detached.statements.includes("ROLLBACK"));
  assert.ok(!detached.statements.includes("COMMIT"));

  const asyncCheck = trackedTransactions();
  await assert.rejects(asyncCheck.store.runInOwnedTransaction!(async () => "saved", async () => {}), /must be synchronous/);
  assert.deepEqual(asyncCheck.statements, ["BEGIN ISOLATION LEVEL SERIALIZABLE", "ROLLBACK"]);
});

test("a detached nested callback with only its first write done cannot commit partial work", async () => {
  const nested = trackedTransactions();
  let signalFirstWrite = () => {};
  const firstWrite = new Promise<void>((resolve) => { signalFirstWrite = resolve; });
  let continueNested = () => {};
  const continuation = new Promise<void>((resolve) => { continueNested = resolve; });
  let late: Promise<unknown> | undefined;
  try {
    await assert.rejects(nested.store.runInOwnedTransaction!(async (transaction) => {
      late = transaction.forOrganization(createOrganizationId("nested-fixture")).runInTransaction(async (scoped) => {
        await scoped.deleteDocument("scope", "first");
        signalFirstWrite();
        await continuation;
        await scoped.deleteDocument("scope", "second");
      }).catch((error: unknown) => error);
      await Promise.race([firstWrite, late.then(() => assert.fail("the nested callback must stop after its first write"))]);
    }, () => assert.fail("unfinished nested work must deny commit")), /Unfinished PostgreSQL transaction operations/);
    assert.equal(nested.statements.filter((sql) => sql.startsWith("DELETE FROM")).length, 1);
    assert.equal(nested.statements.at(-1), "ROLLBACK");
    assert.ok(!nested.statements.includes("COMMIT"));
  } finally {
    continueNested();
    const error = await late;
    assert.ok(error instanceof Error);
    assert.match(error.message, /owner is not active/);
  }
});

function trackedTransactions(onQuery?: (sql: string, values?: readonly unknown[]) => string | void) {
  const statements: string[] = [];
  const releases: boolean[] = [];
  const pool = {
    async connect() {
      return {
        async query(text: string, values?: readonly unknown[]) {
          statements.push(text);
          return queryResult([], onQuery?.(text, values) || text);
        },
        release(discard: boolean) { releases.push(discard); },
      };
    },
    async query() { throw new Error("Scoped work must use the pinned client."); },
  } as unknown as PostgresPoolLike;
  return { store: createPostgresStructuredDocumentStore(pool), statements, releases };
}

function queryResult<T extends Record<string, unknown>>(rows: T[], command = "TEST"): QueryResult<T> {
  return { command, rowCount: rows.length, oid: 0, fields: [], rows };
}

function normalizeSql(sql: string): string {
  return sql.replace(/\s+/g, " ").trim();
}
