import { strict as assert } from "node:assert";
import type { execFile, spawnSync } from "node:child_process";
import { test } from "node:test";

import { checkPythonRuntimeInstallation, checkPythonRuntimeInstallationAsync } from "../checkPythonRuntimeInstallation";

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

test("async installed probe uses the identical fixed script and private bounded process options", async () => {
  let syncScript = "", callback!: (...args: unknown[]) => void, observed: Record<string, unknown> = {};
  checkPythonRuntimeInstallation({command: "python", cwd: "worker"}, ((_c: unknown, args: string[]) => {
    syncScript = args[3]; return {status: 0, stdout: "ASB_WORKER_INSTALLATION_READY"};
  }) as typeof spawnSync);
  const env = {SYNTHETIC_PRIVATE: "original"};
  const pending = checkPythonRuntimeInstallationAsync({command: "python", cwd: "worker", env}, ((command, args, options, done) => {
    assert.equal(command, "python"); assert.deepEqual(args, ["-I", "-B", "-c", syncScript]);
    observed = options; callback = done; return {};
  }) as unknown as typeof execFile);
  env.SYNTHETIC_PRIVATE = "changed";
  assert.deepEqual(observed, {cwd: "worker", env: {SYNTHETIC_PRIVATE: "original"}, encoding: "utf8",
    timeout: 12000, maxBuffer: 32768, windowsHide: true});
  callback(null, "private probe detail\nASB_WORKER_INSTALLATION_READY\n", "ignored");
  assert.equal(await pending, "ready");
});

test("async probe closes OS, version, timeout, overflow and malformed responses without raw errors", async () => {
  for (const [error, stdout, expected] of [
    [{code: "ENOENT", message: "private path"}, "", "missing"],
    [{code: 11}, "", "unsupported"], [{code: 11, killed: true}, "", "incomplete"],
    [{code: "ETIMEDOUT"}, "ASB_WORKER_INSTALLATION_READY", "incomplete"],
    [{code: "ERR_CHILD_PROCESS_STDIO_MAXBUFFER"}, "ASB_WORKER_INSTALLATION_READY", "incomplete"],
    [null, "ASB_WORKER_INSTALLATION_READY\nunrecognized", "incomplete"],
    [null, null, "incomplete"],
  ]) assert.equal(await checkPythonRuntimeInstallationAsync({command: "python", cwd: "worker"},
    ((_c, _a, _o, done) => {done(error, stdout, "private error"); return {};}) as unknown as typeof execFile), expected);
  assert.equal(await checkPythonRuntimeInstallationAsync({command: "python", cwd: "worker"},
    (() => {throw new Error("private error");}) as typeof execFile), "incomplete");
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
