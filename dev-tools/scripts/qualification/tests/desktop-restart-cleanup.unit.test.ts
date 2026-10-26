import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { closeDesktopAndQualifyOwnedWorkers, ownedDesktopCleanupIdentity } from "../visual-composer/e2e/desktop-task-cleanup";

test("ordinary cleanup retains its previous exclusive acknowledgment and report identity", () => {
  const actual = ownedDesktopCleanupIdentity("desktop", "test");
  assert.equal(actual.acknowledgment, "qualification-will-quit.json");
  assert.equal(actual.key, createHash("sha256").update("desktop\0test").digest("hex").slice(0,16));
});
test("each closed restart phase has distinct acknowledgment and exclusive report identity", () => {
  const values = [undefined, "before-restart", "after-restart"].map(phase => ownedDesktopCleanupIdentity("desktop", "test", phase as any));
  assert.equal(new Set(values.map(value => value.key)).size, 3);
  assert.equal(new Set(values.map(value => value.acknowledgment)).size, 3);
  assert.deepEqual(values[1], ownedDesktopCleanupIdentity("desktop", "test", "before-restart"));
});
test("unknown restart phases are refused before touching a process, cache or report", async () => {
  const app = new Proxy({}, { get() { throw new Error("Process inspection must not occur."); } });
  for (const phase of ["", "../outside", "before-restart\n", null, 1]) {
    assert.throws(() => ownedDesktopCleanupIdentity("desktop", "test", phase as any), /Unknown owned restart phase/);
    await assert.rejects(closeDesktopAndQualifyOwnedWorkers(app as any, "unowned", { project: { name: "desktop" }, title: "test" } as any, phase as any), /Unknown owned restart phase/);
  }
});
