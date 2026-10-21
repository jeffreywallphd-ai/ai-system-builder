import assert from "node:assert/strict";
import { test } from "node:test";
import { shutdownServerResources } from "../shutdownServerResources";

test("server starts its task fence before a long HTTP request closes and retains persistence until both drain", async () => {
  const calls: string[] = []; let finish!: () => void;
  const closed = shutdownServerResources({ listener: { close(callback) { calls.push("listener"); finish = () => callback(); } }, shutdownBackgroundTasks: async () => { calls.push("tasks"); }, closePersistence: async () => { calls.push("database"); } });
  assert.deepEqual(calls, ["tasks", "listener"]);
  finish(); await closed; assert.deepEqual(calls, ["tasks", "listener", "database"]);
});
test("server preserves persistence on failed task shutdown and permits a subsequent drain", async () => {
  let closed = 0;
  await assert.rejects(shutdownServerResources({ shutdownBackgroundTasks: async () => { throw new Error("worker unavailable"); }, closePersistence: async () => { closed++; } }), /pending/);
  assert.equal(closed, 0);
  await shutdownServerResources({ shutdownBackgroundTasks: async () => {}, closePersistence: async () => { closed++; } });
  assert.equal(closed, 1);
});
