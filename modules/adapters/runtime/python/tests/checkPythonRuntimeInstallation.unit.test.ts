import { strict as assert } from "node:assert";
import type { spawnSync } from "node:child_process";
import { test } from "node:test";

import { checkPythonRuntimeInstallation } from "../checkPythonRuntimeInstallation";

test("uses a bounded, isolated Python dependency probe with a fixed success marker", () => {
  const run = ((command: string, args: readonly string[], options: Record<string, unknown>) => {
    assert.equal(command, "python");
    assert.deepEqual(args.slice(0, 3), ["-I", "-B", "-c"]);
    assert.match(args[3], /lancedb/);
    assert.match(args[3], /pyarrow/);
    assert.match(args[3], /torch/);
    assert.match(args[3], /^import pip$/mu);
    assert.match(args[3], /^import fastapi$/mu);
    assert.match(args[3], /^import uvicorn$/mu);
    assert.equal(options.timeout, 12_000);
    assert.equal(options.maxBuffer, 32_768);
    return { status: 0, stdout: "ASB_CONTEXT_DEPENDENCY_READY\nASB_WORKER_INSTALLATION_READY\n" };
  }) as typeof spawnSync;
  assert.equal(checkPythonRuntimeInstallation({ command: "python", cwd: "worker" }, run), "ready");
});

test("refuses missing, unsupported, unsuccessful and ambiguous runtime probes", () => {
  const cases = [
    [{ status: null, error: { code: "ENOENT" } }, "missing"],
    [{ status: 11, stdout: "ASB_CONTEXT_DEPENDENCY_UNSUPPORTED_PYTHON" }, "unsupported"],
    [{ status: 11, error: { code: "ETIMEDOUT" } }, "incomplete"],
    [{ status: 0, stdout: "unrecognized" }, "incomplete"],
    [{ status: 1, stdout: "ASB_WORKER_INSTALLATION_READY" }, "incomplete"],
    [{ status: null, error: { code: "ETIMEDOUT" } }, "incomplete"],
  ] as const;
  for (const [result, expected] of cases) {
    assert.equal(checkPythonRuntimeInstallation({ command: "python", cwd: "worker" }, (() => result) as unknown as typeof spawnSync), expected);
  }
});
