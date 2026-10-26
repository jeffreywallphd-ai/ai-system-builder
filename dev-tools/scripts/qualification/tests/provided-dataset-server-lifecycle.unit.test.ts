import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createProvidedDatasetServerLifecycle, requireProvidedDatasetRoot } from "../visual-composer/provided-dataset-server-lifecycle";
import { openLocalSqliteDatabase, resolveLocalSqliteDatabasePolicy } from "../../../../modules/adapters/persistence/sqlite";
import { createOrganizationId } from "../../../../modules/contracts/organization";

test("real SQLite records survive complete owner close/reopen and stay organization scoped", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "provided-restart-"));
  const events: string[] = []; let count = 0;
  const organization = createOrganizationId("qualification.local");
  const lifecycle = createProvidedDatasetServerLifecycle(async () => {
    const database = await openLocalSqliteDatabase({ policy: resolveLocalSqliteDatabasePolicy({ dataRootDirectory: root }) });
    const documents = database.documents.forOrganization(organization);
    count++; events.push(`open${count}`);
    if (count === 1) await documents.writeDocument("qualification", "version", { digest: "a".repeat(64), rows: 8 }, { expectedRevision: 0 });
    else assert.deepEqual((await documents.readDocument("qualification", "version"))?.value, { digest: "a".repeat(64), rows: 8 });
    assert.equal(await database.documents.forOrganization(createOrganizationId("other.local")).readDocument("qualification", "version"), undefined);
    return { listener: { close(callback) { events.push("listener"); callback(); } },
      async shutdownBackgroundTasks() { events.push("workers"); },
      async closePersistence() { events.push("persistence"); database.close(); } };
  });
  try {
    await lifecycle.start(); lifecycle.restart(); await lifecycle.settled(); await lifecycle.stop();
    assert.deepEqual(events, ["open1", "workers", "listener", "persistence", "open2", "workers", "listener", "persistence"]);
  } finally { await rm(root, { recursive: true, force: true }); }
});

for (const failure of ["workers", "listener", "persistence"] as const) {
  test(`no second owner is opened after uncertain ${failure} retirement`, async () => {
    let opens = 0, persistence = 0;
    const lifecycle = createProvidedDatasetServerLifecycle(async () => {
      opens++;
      return { listener: { close(callback) { callback(failure === "listener" ? new Error("private detail") : undefined); } },
        async shutdownBackgroundTasks() { if (failure === "workers") throw new Error("private detail"); },
        async closePersistence() { persistence++; if (failure === "persistence") throw new Error("private detail"); } };
    });
    await lifecycle.start(); lifecycle.restart();
    await assert.rejects(lifecycle.settled(), { message: "Qualification server transition remains pending." });
    assert.equal(opens, 1); assert.equal(persistence, failure === "persistence" ? 1 : 0);
    await assert.rejects(lifecycle.stop());
  });
}
test("stop fences queued restart and closes the current owner exactly once", async () => {
  let opens = 0, closes = 0;
  const lifecycle = createProvidedDatasetServerLifecycle(async () => {
    opens++;
    return { listener: { close(callback) { closes++; callback(); } }, async shutdownBackgroundTasks() {}, async closePersistence() {} };
  });
  await lifecycle.start(); await lifecycle.stop(); lifecycle.restart(); await lifecycle.settled();
  assert.equal(opens, 1); assert.equal(closes, 1);
  await assert.rejects(lifecycle.start());
});
test("only the exact regular isolated runtime leaf is admitted", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "provided-root-"));
  const parent = path.join(root, "artifacts/qualification/visual-composer/d", "a".repeat(16));
  await mkdir(parent, { recursive: true });
  try {
    await requireProvidedDatasetRoot(root, path.join(parent, "thin-runtime"));
    for (const candidate of [root, "relative", path.join(parent, "other"), path.join(parent, "thin-runtime", "child"), path.join(root, "artifacts/qualification/visual-composer/d/not-a-run/thin-runtime")]) {
      await assert.rejects(requireProvidedDatasetRoot(root, candidate));
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});
