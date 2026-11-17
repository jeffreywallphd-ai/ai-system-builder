import assert from "node:assert/strict";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";
import { createOrganizationId } from "../../../../contracts/organization";
import { createSqliteStructuredDocumentStore, migrateLocalSqliteDatabase } from "../sqlite-database";
import { structuredTransactionConformance } from "../../shared/tests/structured-transaction-conformance";

structuredTransactionConformance("native SQLite", () => {
  const database = new DatabaseSync(":memory:");
  migrateLocalSqliteDatabase(database);
  return {documents: createSqliteStructuredDocumentStore(database), alias: createSqliteStructuredDocumentStore(database), close() {database.close();}};
});

test("native SQLite: unconfirmed rollback fences queued and subsequent connection operations", {timeout: 5000}, async () => {
  const database = new DatabaseSync(":memory:");
  migrateLocalSqliteDatabase(database);
  const connection = {
    prepare: (sql: string) => database.prepare(sql),
    exec(sql: string) {
      if (sql === "ROLLBACK;") throw new Error("synthetic rollback transport failure");
      database.exec(sql);
    },
    close: () => database.close(),
  };
  const documents = createSqliteStructuredDocumentStore(connection);
  const alias = createSqliteStructuredDocumentStore(connection);
  const organization = alias.forOrganization(createOrganizationId("transaction.failed"));
  const failure = new Error("synthetic original callback failure");
  let resume!: () => void;
  let entered!: () => void;
  const held = new Promise<void>(resolve => {resume = resolve;});
  const started = new Promise<void>(resolve => {entered = resolve;});
  let transaction: Promise<void> | undefined;
  try {
    transaction = documents.runInTransaction(async tx => {
      await tx.writeDocument("tests", "private", {value: "uncommitted"});
      entered();
      await held;
      throw failure;
    }).then(() => assert.fail("The callback must fail"), error => {assert.equal(error, failure);});
    await started;
    const queued = Promise.allSettled([
      alias.readDocument("tests", "private"),
      organization.writeDocument("tests", "outside", {value: "must not be acknowledged"}),
    ]);
    resume();
    await transaction;
    const results = await queued;
    assert.ok(results.every(result => result.status === "rejected" && /rollback.*confirmed/i.test(result.reason.message)),
      "Operations already waiting must be refused when rollback cannot be confirmed");
    const fresh = createSqliteStructuredDocumentStore(connection);
    for (const store of [documents, alias, organization, fresh]) {
      await assert.rejects(store.readDocument("tests", "private"), /rollback.*confirmed/i);
      await assert.rejects(store.listDocuments("tests"), /rollback.*confirmed/i);
      await assert.rejects(store.listNamespaces(), /rollback.*confirmed/i);
      await assert.rejects(store.writeDocument("tests", "outside", {}), /rollback.*confirmed/i);
      await assert.rejects(store.deleteDocument("tests", "private"), /rollback.*confirmed/i);
      await assert.rejects(store.runInTransaction(async () => undefined), /rollback.*confirmed/i);
      assert.throws(() => store.forOrganization(createOrganizationId("transaction.failed")), /rollback.*confirmed/i);
    }
    assert.ok(database.prepare("SELECT 1 FROM structured_documents WHERE document_key = 'private'").get(),
      "The fixture must retain a real unfinished native transaction until its own cleanup");
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM organization_documents").get()?.count, 0);
  } finally {
    resume();
    await transaction;
    database.exec("ROLLBACK;"); // Only this disposable fixture owns the native cleanup.
    database.close();
  }
});

test("native SQLite: a paused transaction does not block another database connection", {timeout: 5000}, async () => {
  const first = new DatabaseSync(":memory:");
  const second = new DatabaseSync(":memory:");
  let resume!: () => void;
  let entered!: () => void;
  const held = new Promise<void>(resolve => {resume = resolve;});
  const started = new Promise<void>(resolve => {entered = resolve;});
  let transaction: Promise<void> | undefined;
  let deadline: ReturnType<typeof setTimeout> | undefined;
  try {
    migrateLocalSqliteDatabase(first);
    migrateLocalSqliteDatabase(second);
    const documents = createSqliteStructuredDocumentStore(first);
    const independent = createSqliteStructuredDocumentStore(second);
    transaction = documents.runInTransaction(async tx => {
      await tx.writeDocument("tests", "first", {owner: "held"});
      entered();
      await held;
    });
    await started;
    const operation = independent.writeDocument("tests", "second", {owner: "independent"});
    const written = await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        deadline = setTimeout(() => reject(new Error("A different connection must progress before the paused transaction resumes.")), 2000);
      }),
    ]);
    assert.deepEqual(written.value, {owner: "independent"});
    assert.deepEqual((await independent.readDocument("tests", "second"))?.value, written.value);
    assert.equal(await independent.readDocument("tests", "first"), undefined);
    resume();
    await transaction;
    assert.deepEqual((await documents.readDocument("tests", "first"))?.value, {owner: "held"});
    assert.equal(await documents.readDocument("tests", "second"), undefined);
  } finally {
    if (deadline) clearTimeout(deadline);
    resume();
    await transaction;
    first.close();
    second.close();
  }
});
