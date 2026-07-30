import assert from "node:assert/strict";
import test from "node:test";

import { shutdownDesktopRuntimeResources } from "../shutdownDesktopRuntimeResources";

test("desktop shutdown closes windows, sidecar, runtime databases, and platform database in order", async () => {
  const calls: string[] = [];
  await shutdownDesktopRuntimeResources({
    async closeRuntimeWindows() {
      calls.push("windows");
    },
    async stopPythonRuntime() {
      calls.push("sidecar");
    },
    async closeRuntimeDatabases() {
      calls.push("runtime-databases");
    },
    closePlatformDatabase() {
      calls.push("platform-database");
    },
  });
  assert.deepEqual(calls, [
    "windows",
    "sidecar",
    "runtime-databases",
    "platform-database",
  ]);
});

test("desktop shutdown continues after owned resource failures", async () => {
  const calls: string[] = [];
  await shutdownDesktopRuntimeResources({
    async closeRuntimeWindows() {
      calls.push("windows");
      throw new Error("private window failure");
    },
    async stopPythonRuntime() {
      calls.push("sidecar");
      throw new Error("private sidecar failure");
    },
    async closeRuntimeDatabases() {
      calls.push("runtime-databases");
      throw new Error("private database failure");
    },
    closePlatformDatabase() {
      calls.push("platform-database");
    },
  });
  assert.deepEqual(calls, [
    "windows",
    "sidecar",
    "runtime-databases",
    "platform-database",
  ]);
});
