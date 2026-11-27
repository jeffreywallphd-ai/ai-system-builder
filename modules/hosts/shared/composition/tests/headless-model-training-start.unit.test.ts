import assert from "node:assert/strict";
import test from "node:test";
import {TrainModelUseCase} from "../../../../application/use-cases/model/train-model.use-case";
import {OwnedTaskReconcilerService} from "../../../../application/services/runtime/owned-task-reconciler.service";
import {composeHeadlessModelTrainingStart, type HeadlessTrainingStartConfiguration} from "../composeHeadlessModelTrainingStart";

type Options = Parameters<typeof composeHeadlessModelTrainingStart>[0];
function dependencies(): Options["dependencies"] {
  const ordinary = new Proxy({}, {get() {assert.fail("No ordinary dependency operation during composition.");}});
  return {taskReconciler: new OwnedTaskReconcilerService(), runtimeTaskRegistry: ordinary, modelRegistry: ordinary,
    storageBindings: ordinary, storage: ordinary, taskPowerLifecycle: ordinary} as Options["dependencies"];
}
const configured = (): HeadlessTrainingStartConfiguration => ({approvedLocalTraining: {createSession() {assert.fail("No session during resolution.");}}});

test("deferred training owner is lazy, concurrent resolution is one original method and receives no task data", async () => {
  let calls = 0, release!: () => void; const waiting = new Promise<void>(r => release = r);
  const options: Options = {dependencies: dependencies(), async getConfiguration() {
    assert.equal(this, options); assert.equal(arguments.length, 0); calls++; await waiting; return configured();
  }};
  const resolve = composeHeadlessModelTrainingStart(options); assert.equal(calls, 0);
  options.getConfiguration = async () => {assert.fail("Original method must be captured.");};
  Object.defineProperty(options, "dependencies", {value: undefined});
  const first = resolve(), second = resolve(); assert.equal(first, second);
  await Promise.resolve(); assert.equal(calls, 1); release();
  const start = await first; assert.equal(typeof start, "function"); assert.equal(start, await resolve());
  assert.deepEqual(await start!(undefined as never, undefined as never), {kind: "unavailable"});
});

for (const [name, value] of [
  ["missing", undefined], ["missing original port", {}], ["unknown configuration key", {...configured(), unexpected: true}],
  ["proxy", new Proxy({}, {get() {assert.fail("Proxy must not run.");}})],
  ["port accessor", {approvedLocalTraining: {get createSession() {throw Error("Accessor must not run.");}}}],
  ["storage accessor", {...configured(), generatedModelStorage: {storeGeneratedModel() {}, get createReviewedSession() {throw Error("Accessor must not run.");}}}],
] as const) test("deferred training rejects " + name + " once without ordinary fallback", async () => {
  let calls = 0; const resolve = composeHeadlessModelTrainingStart({dependencies: dependencies(),
    async getConfiguration() {calls++; return value as HeadlessTrainingStartConfiguration;}});
  assert.equal(await resolve(), undefined); assert.equal(await resolve(), undefined); assert.equal(calls, 1);
});

test("a rejected original configuration remains unavailable instead of retrying uncertain setup", async () => {
  let calls = 0; const resolve = composeHeadlessModelTrainingStart({dependencies: dependencies(), async getConfiguration() {calls++; throw Error("Private failure.");}});
  assert.equal(await resolve(), undefined); assert.equal(await resolve(), undefined); assert.equal(calls, 1);
});

test("configuration accessor and unknown options are refused without executing hooks", async () => {
  let hooks = 0; const options = {dependencies: dependencies(), get getConfiguration() {hooks++; throw Error("Must not execute.");}};
  assert.equal(await composeHeadlessModelTrainingStart(options as never)(), undefined); assert.equal(hooks, 0);
  assert.equal(await composeHeadlessModelTrainingStart({dependencies: dependencies(), getConfiguration: async () => configured(), unknown: true} as never)(), undefined);
});
