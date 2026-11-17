import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { normalizePythonRuntimeStartupDiagnostics as read, serializePythonRuntimeStartupDiagnostics as serialize } from "./python-runtime-startup-diagnostics";
const report = () => ({ schemaVersion: "1", attempt: 1, outcome: "failed", phase: "context", reason: "unsupported-python", dependencies: [], stages: [] });
test("startup report is a closed immutable projection with observational version comparisons", () => {
  const value = read({ ...report(), pythonVersion: "3.12.9", dependencies: [{ name: "huggingface_hub", version: "0.31.4" }, { name: "transformers", version: null }] })!;
  assert.deepEqual(value.dependencies.map(d => d.comparison), ["match", "missing"]);
  assert.ok(Object.isFrozen(value) && Object.isFrozen(value.dependencies));
  assert.equal(JSON.parse(serialize(value)!).reason, "unsupported-python");
  const requirements = readFileSync(new URL("../../adapters/runtime/python/worker/requirements.txt", import.meta.url), "utf8");
  for (const dependency of value.dependencies) assert.ok(requirements.split(/\r?\n/).some(line => line.startsWith(dependency.name) && line.endsWith(`==${dependency.expectedVersion}`)));
  for (const patch of [{ secret: "private" }, { attempt: -1 }, { outcome: "passed" }, { pythonVersion: "token=private" }, { dependencies: [{ name: "torch" }] }, { stages: new Array(65).fill({}) }]) assert.equal(read({ ...report(), ...patch }), undefined);
});
test("startup report refuses ordinary object and array getters without invoking them", () => {
  let calls = 0;
  const value = Object.defineProperty(report(), "pythonVersion", { get() { calls++; return "3.12.0"; } });
  assert.equal(read(value), undefined);
  const rows = [{}]; Object.defineProperty(rows, "0", { get() { calls++; return {}; } });
  assert.equal(read({ ...report(), stages: rows }), undefined);
  assert.equal(calls, 0);
  assert.equal(serialize({ ...report(), logs: [{ message: "C:\\private token=secret" }] }), undefined);
});
