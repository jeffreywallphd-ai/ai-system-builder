import assert from "node:assert/strict";
import {test} from "node:test";
import {readModelTrainingExecutionHistory} from "..";

const fixture = () => ({schema: "model-training-execution-v1", runId: "train-20261127060000",
  startedAt: "2026-11-27T06:00:00.000Z", completedAt: "2026-11-27T06:00:04.000Z", durationMs: 3999,
  hardware: {devices: ["cpu", "cuda"], precisions: ["bfloat16", "float32"], logicalCpuCount: 8,
    pythonVersion: "3.12.8", pytorchVersion: "2.9.0+cu128", transformersVersion: "4.57.1"},
  interpretation: "reported-runtime-facts"});

test("training execution history owns immutable bounded runtime facts and separates clocks from qualification", () => {
  const raw = fixture(), result = readModelTrainingExecutionHistory(raw, raw.runId); assert.ok(result);
  assert.deepEqual(result, raw); assert.equal(result.durationMs, 3999, "Monotonic duration need not equal wall-clock difference.");
  raw.hardware.devices[0] = "private-mutation"; raw.hardware.logicalCpuCount = 4096;
  assert.deepEqual(result.hardware.devices, ["cpu", "cuda"]); assert.equal(result.hardware.logicalCpuCount, 8);
  assert.ok(Object.isFrozen(result) && Object.isFrozen(result.hardware) && Object.isFrozen(result.hardware.devices));
  assert.equal(result.interpretation, "reported-runtime-facts");
  assert.doesNotMatch(JSON.stringify(result), /qualified|readiness|modelQuality|authorization|permission|resourceAdmission/);
});

test("training execution history permits explicitly unrecorded optional facts without fabricating them", () => {
  const raw: any = fixture(); raw.hardware = {...raw.hardware, devices: ["cpu"], precisions: ["float32"],
    logicalCpuCount: null, pytorchVersion: null, transformersVersion: null};
  const result = readModelTrainingExecutionHistory(raw); assert.ok(result);
  assert.equal(result.hardware.logicalCpuCount, null); assert.equal(result.hardware.pytorchVersion, null);
  assert.equal(result.hardware.transformersVersion, null);
});

const invalid: [string, (raw: any) => void][] = [
  ["schema", raw => {raw.schema = "unqualified-v2";}],
  ["run path", raw => {raw.runId = "C:/private/model";}],
  ["run secret", raw => {raw.runId = "hf_" + "a".repeat(30);}],
  ["extra", raw => {raw.localPath = "C:/private";}],
  ["hardware extra", raw => {raw.hardware.hostname = "private-machine";}],
  ["quality promotion", raw => {raw.interpretation = "passed";}],
  ["invalid date", raw => {raw.startedAt = "2026-02-30T06:00:00.000Z";}],
  ["offset time", raw => {raw.startedAt = "2026-11-27T01:00:00.000-05:00";}],
  ["noncanonical time", raw => {raw.startedAt = "2026-11-27T06:00:00Z";}],
  ["reversed time", raw => {raw.completedAt = "2026-11-27T05:00:00.000Z";}],
  ["unbounded interval", raw => {raw.completedAt = "2026-12-27T06:00:00.000Z";}],
  ["negative duration", raw => {raw.durationMs = -1;}],
  ["fractional duration", raw => {raw.durationMs = 0.5;}],
  ["unbounded duration", raw => {raw.durationMs = 604800001;}],
  ["nonfinite duration", raw => {raw.durationMs = Infinity;}],
  ["empty device list", raw => {raw.hardware.devices = [];}],
  ["unknown device", raw => {raw.hardware.devices = ["private-device"]; }],
  ["duplicate device", raw => {raw.hardware.devices = ["cpu", "cpu"]; }],
  ["noncanonical devices", raw => {raw.hardware.devices.reverse();}],
  ["empty precision list", raw => {raw.hardware.precisions = [];}],
  ["unknown precision", raw => {raw.hardware.precisions = ["pickle"]; }],
  ["unbounded CPU count", raw => {raw.hardware.logicalCpuCount = 4097;}],
  ["fractional CPU count", raw => {raw.hardware.logicalCpuCount = 1.5;}],
  ["zero CPU count", raw => {raw.hardware.logicalCpuCount = 0;}],
  ["version path", raw => {raw.hardware.pythonVersion = "/private/python";}],
  ["unbounded version", raw => {raw.hardware.pytorchVersion = "2".repeat(65);} ],
  ["active version", raw => {raw.hardware.transformersVersion = () => "4.57.1";}],
  ["missing field", raw => {delete raw.durationMs;}],
];
for (const [name, mutate] of invalid) test(`training execution history refuses ${name}`, () => {
  const raw = fixture(); mutate(raw); assert.equal(readModelTrainingExecutionHistory(raw), undefined);
});
test("training execution history refuses a different original run and accessors without invoking getters", () => {
  assert.equal(readModelTrainingExecutionHistory(fixture(), "train-other"), undefined);
  let calls = 0; const raw = fixture();
  Object.defineProperty(raw.hardware, "pythonVersion", {enumerable: true, get() {calls++; throw Error("PRIVATE");}});
  assert.equal(readModelTrainingExecutionHistory(raw), undefined); assert.equal(calls, 0);
});
