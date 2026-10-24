import assert from "node:assert/strict";
import test from "node:test";
import { createOrganizationId } from "../../../../contracts/organization";
import type { StructuredDocumentStore } from "../structured-document-store";

type Fixture = { documents: StructuredDocumentStore; alias: StructuredDocumentStore; close(): void | Promise<void> };
const orgA = createOrganizationId("transaction.a");
const orgB = createOrganizationId("transaction.b");
const signal = () => {
  let resolve!: () => void;
  return { promise: new Promise<void>(done => {resolve = done;}), resolve: () => resolve() };
};

export function structuredTransactionConformance(label: string, create: () => Fixture): void {
  for (const rollback of [false, true]) test(`${label}: unrelated reads and acknowledged writes are isolated across ${rollback ? "rollback" : "commit"}`, {timeout: 5000}, async () => {
    const fixture = create();
    const {documents, alias} = fixture;
    const entered = signal(), resume = signal();
    const owner = documents.forOrganization(orgA);
    let outsideWrite = false, outsideRead = false;
    let transaction: Promise<unknown> | undefined;
    try {
      transaction = owner.runInTransaction(async tx => {
        await tx.writeDocument("tests", "private", {value: "uncommitted"});
        entered.resolve(); await resume.promise;
        if (rollback) throw new Error("synthetic rollback");
      }).catch(error => {assert.equal(error.message, "synthetic rollback");});
      await entered.promise;
      const read = alias.forOrganization(orgA).readDocument("tests", "private").then(value => {outsideRead = true; return value;});
      const admittedAt = "2026-01-01T00:00:00.000Z";
      const value = {owner: "original", nested: {count: 1}}, options = {expectedRevision: 0, updatedAt: admittedAt};
      const write = alias.forOrganization(orgB).writeDocument("tests", "independent", value, options).then(result => {outsideWrite = true; return result;});
      value.owner = "changed after enqueue"; value.nested.count = 99;
      options.expectedRevision = 999; options.updatedAt = "2026-02-01T00:00:00.000Z";
      await new Promise(done => setImmediate(done));
      assert.equal(outsideWrite, false, "A successful outside write must not join another transaction");
      assert.equal(outsideRead, false, "An outside read must wait for commit or rollback");
      resume.resolve(); await transaction;
      const [observed, written] = await Promise.all([read, write]);
      assert.equal(Boolean(observed), !rollback);
      assert.deepEqual(written.value, {owner: "original", nested: {count: 1}});
      assert.equal(written.updatedAt, admittedAt, "A queued write must keep its admitted timestamp");
      written.value.nested.count = 77;
      const persisted = await alias.forOrganization(orgB).readDocument("tests", "independent");
      assert.deepEqual(persisted?.value, {owner: "original", nested: {count: 1}});
      assert.equal(persisted?.updatedAt, admittedAt);
      assert.equal(await documents.readDocument("tests", "independent"), undefined);
    } finally {resume.resolve(); await transaction; await fixture.close();}
  });

  test(`${label}: competing transactions and ordinary CAS writes share FIFO ownership`, {timeout: 5000}, async () => {
    const fixture = create(); const {documents, alias} = fixture;
    const entered = signal(), resume = signal();
    const order: number[] = [];
    let first: Promise<unknown> | undefined;
    try {
      first = documents.runInTransaction(async tx => {order.push(1); entered.resolve(); await resume.promise; await tx.writeDocument("tests", "cas", {winner: 1}, {expectedRevision: 0});});
      await entered.promise;
      const second = alias.runInTransaction(async tx => {order.push(2); await tx.writeDocument("tests", "second", {owner: 2}, {expectedRevision: 0});});
      const collision = documents.writeDocument("tests", "cas", {winner: 9}, {expectedRevision: 0}).then(() => "unexpected", error => error.name);
      const third = documents.forOrganization(orgB).runInTransaction(async tx => {order.push(3); await tx.writeDocument("tests", "third", {owner: 3});});
      await new Promise(done => setImmediate(done));
      assert.deepEqual(order, [1]); resume.resolve();
      await Promise.all([first, second, third]);
      assert.equal(await collision, "StructuredDocumentConflictError");
      assert.deepEqual(order, [1, 2, 3]);
      assert.deepEqual((await alias.readDocument("tests", "cas"))?.value, {winner: 1});
      assert.equal(await documents.deleteDocument("tests", "cas", 1), true);
      assert.equal(await alias.readDocument("tests", "cas"), undefined);
    } finally {resume.resolve(); await first; await fixture.close();}
  });

  test(`${label}: nested scoped work rolls back together and expired transaction stores deny`, {timeout: 5000}, async () => {
    const fixture = create(); const {documents} = fixture;
    let retained!: StructuredDocumentStore;
    let scoped!: StructuredDocumentStore;
    try {
      await assert.rejects(documents.runInTransaction(async tx => {
        retained = tx; scoped = tx.forOrganization(orgA);
        await scoped.runInTransaction(async nested => {await nested.writeDocument("tests", "nested", {value: 1});});
        await tx.writeDocument("tests", "platform", {value: 2});
        throw new Error("synthetic rollback");
      }), /synthetic rollback/);
      assert.equal(await documents.readDocument("tests", "platform"), undefined);
      assert.equal(await documents.forOrganization(orgA).readDocument("tests", "nested"), undefined);
      for (const expired of [retained, scoped]) {
        await assert.rejects(expired.readDocument("tests", "nested"), /transaction.*owner|transaction.*active/i);
        await assert.rejects(expired.writeDocument("tests", "late", {value: 9}), /transaction.*owner|transaction.*active/i);
        await assert.rejects(expired.listDocuments("tests"), /transaction.*owner|transaction.*active/i);
        await assert.rejects(expired.listNamespaces(), /transaction.*owner|transaction.*active/i);
        await assert.rejects(expired.deleteDocument("tests", "late"), /transaction.*owner|transaction.*active/i);
        await assert.rejects(expired.runInTransaction(async () => undefined), /transaction.*owner|transaction.*active/i);
        assert.throws(() => expired.forOrganization(orgA), /transaction.*owner|transaction.*active/i);
      }
      assert.equal(await documents.readDocument("tests", "late"), undefined);
      await documents.writeDocument("tests", "after-failure", {value: true});
      assert.ok(await documents.readDocument("tests", "after-failure"));
    } finally {await fixture.close();}
  });

  test(`${label}: active transaction handles reject foreign contexts and root reentry fails instead of deadlocking`, {timeout: 5000}, async () => {
    const fixture = create(); const {documents} = fixture;
    const entered = signal(), resume = signal();
    let retained!: StructuredDocumentStore;
    let operation: Promise<unknown> | undefined;
    try {
      operation = documents.runInTransaction(async tx => {
        retained = tx;
        await assert.rejects(documents.writeDocument("tests", "wrong-store", {value: 1}), /supplied transaction store/i);
        entered.resolve(); await resume.promise;
        await tx.writeDocument("tests", "owned", {value: 2});
      });
      await entered.promise;
      await assert.rejects(retained.readDocument("tests", "owned"), /transaction.*owner|transaction.*active/i);
      assert.throws(() => retained.forOrganization(orgA), /transaction.*owner|transaction.*active/i);
      resume.resolve(); await operation;
      assert.equal(await documents.readDocument("tests", "wrong-store"), undefined);
      assert.ok(await documents.readDocument("tests", "owned"));
    } finally {resume.resolve(); await operation; await fixture.close();}
  });
}
