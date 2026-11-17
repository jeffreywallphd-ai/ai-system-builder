import assert from "node:assert/strict";
import { test } from "node:test";
import { createPythonRuntimeStartupDiagnostics } from "../pythonRuntimeStartupDiagnostics";
import { createPreparationStageDiagnostics } from "../pythonRuntimePreparationDiagnostics";
test("startup facts belong to actual tokens and specific failure survives generic settlement", () => {
  const d = createPythonRuntimeStartupDiagnostics(), old = {}, next = {};
  assert.equal(d.read().outcome, "not-observed");
  d.event({ type: "begin", token: old });
  const stages = createPreparationStageDiagnostics("context", row => d.stage(old, row));
  const pending = stages.enter("probe-context-dependencies");
  d.preparationFailed(old, "context", "unsupported-python");
  d.event({ type: "failed", token: old });
  assert.equal(d.read().reason, "unsupported-python"); assert.equal(d.read().pythonVersion, undefined);
  const previous = d.read();
  d.event({ type: "retired", token: old }); d.event({ type: "begin", token: next });
  stages.settle(pending, "returned"); d.environment(old, { pythonVersion: "3.99.0" });
  assert.equal(d.read().stages.length, 0); assert.equal(d.read().pythonVersion, undefined);
  d.environment(next, { pythonVersion: "3.12.9", huggingfaceHubVersion: "0.31.4", transformersVersion: "4.52.0" });
  assert.equal(d.read().dependencies[1]?.comparison, "mismatch");
  d.event({ type: "ready", token: next }); assert.equal(d.read().outcome, "ready");
  assert.equal(previous.reason, "unsupported-python"); assert.ok(Object.isFrozen(previous));
});
test("composition failure is readable without an attempted start; orphan returns are not replayed", () => {
  const d = createPythonRuntimeStartupDiagnostics(); d.compositionFailed();
  assert.equal(d.read().attempt, 0); assert.equal(d.read().phase, "composition");
  const owner = {}; d.event({ type: "begin", token: owner });
  const source = createPreparationStageDiagnostics("context");
  const pending = source.enter("probe-context-dependencies");
  source.subscribe(row => d.stage(owner, row)); source.settle(pending, "returned");
  assert.deepEqual(d.read().stages, []);
});
test("bounded stage history retains the latest frontier and declares truncation", () => {
  const d = createPythonRuntimeStartupDiagnostics(), owner = {}; d.event({ type: "begin", token: owner });
  const source = createPreparationStageDiagnostics("worker", row => d.stage(owner, row));
  for (let i = 0; i < 40; i++) { const pending = source.enter("probe-worker-dependencies"); source.settle(pending, "returned"); }
  const snapshot = d.read(); assert.equal(snapshot.stages.length, 64); assert.equal(snapshot.stagesTruncated, true);
  assert.equal(snapshot.stages[63]?.sequence, 40); assert.equal(snapshot.stages[63]?.phase, "returned");
  d.preparationFailed(owner, "worker", "verification-failed"); d.event({ type: "failed", token: owner });
  assert.equal(d.read().reason, "verification-failed"); assert.equal(snapshot.reason, "none");
});
