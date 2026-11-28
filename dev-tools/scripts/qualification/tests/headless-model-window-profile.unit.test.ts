import assert from "node:assert/strict";
import {randomBytes} from "node:crypto";
import {existsSync, ftruncateSync, linkSync, mkdirSync, openSync, closeSync, realpathSync, renameSync, rmSync, writeFileSync} from "node:fs";
import path from "node:path";
import test from "node:test";
import {EventEmitter} from "node:events";
import {allocateModelWindowProfile, modelWindowRuntimeEnvironment, MODEL_WINDOW_JOURNEY_ARGUMENTS, MODEL_WINDOW_JOURNEY_TITLE} from "../visual-composer/headless-model-window-profile";

test("the fixed UI command selects one Desktop case with no retries or unrelated projects", () => {
  assert.deepEqual(MODEL_WINDOW_JOURNEY_ARGUMENTS, ["node_modules/@playwright/test/cli.js", "test",
    "--config=dev-tools/config/playwright.visual-composer.config.ts", "--project=packaged-desktop", "--workers=1", "--retries=0",
    "--forbid-only", `--grep=${MODEL_WINDOW_JOURNEY_TITLE}$`, "packaged-desktop-headless.e2e.spec.ts"]);
  assert.ok(Object.isFrozen(MODEL_WINDOW_JOURNEY_ARGUMENTS));
  const selection = new RegExp(MODEL_WINDOW_JOURNEY_ARGUMENTS.find(argument => argument.startsWith("--grep="))!.slice(7));
  assert.ok(selection.test(`packaged-desktop packaged-desktop-headless.e2e.spec.ts ${MODEL_WINDOW_JOURNEY_TITLE}`));
  assert.equal(selection.test(`${MODEL_WINDOW_JOURNEY_TITLE} another case`), false);
  assert.equal(selection.test("packaged Desktop pairs a real MCP client"), false);
});

test("metadata-only Model fixture keeps the existing explicit Node worker prerequisite without executing it", () => {
  const root = realpathSync(process.cwd()), node = process.execPath;
  assert.deepEqual(modelWindowRuntimeEnvironment(root, node), {
    PYTHON_RUNTIME_BASE_URL: "http://127.0.0.1:43172", PYTHON_RUNTIME_HOST: "127.0.0.1", PYTHON_RUNTIME_PORT: "43172",
    PYTHON_RUNTIME_COMMAND: node,
    PYTHON_RUNTIME_ARGS: "dev-tools/scripts/qualification/visual-composer/controlled-conversation-runtime-worker.mjs",
    PYTHON_RUNTIME_WORKER_DIR: root, PYTHON_RUNTIME_STARTUP_TIMEOUT_MS: "15000",
  });
  assert.ok(Object.isFrozen(modelWindowRuntimeEnvironment(root, node)));
  assert.throws(() => modelWindowRuntimeEnvironment(root, "node"));
  assert.throws(() => modelWindowRuntimeEnvironment(root, path.join(root, "out", "ai-system-builder.exe")));
});

function fixture() {
  const prefix = path.join(realpathSync(process.cwd()), "artifacts", "qualification", "visual-composer", "d");
  mkdirSync(prefix, {recursive: true});
  const folder = path.join(prefix, randomBytes(8).toString("hex")); mkdirSync(folder);
  const base = path.join(folder, "desktop"); mkdirSync(base);
  const observation = {admissions: 0, closed: 0, failAdmission: false, failClose: false, exitCode: 0};
  const profile = allocateModelWindowProfile(base, async (pid, options) => {
    observation.admissions++;
    if (observation.failAdmission) throw new Error("Synthetic observer admission failure.");
    return {admission: {pid, rootPid: options?.rootPid, parentPid: 10001, chain: [pid, 10001]},
      outcome: Promise.resolve({phase: "exited" as const, pid, rootPid: options?.rootPid, exitCode: observation.exitCode,
        retired: [{pid, exitCode: observation.exitCode}]}),
      async close() {observation.closed++; if (observation.failClose) throw new Error("Synthetic observer close failure.");}};
  });
  const identity = {pid: 10002, parentPid: 10001, dataRoot: profile.dataRoot};
  const processOwner = Object.assign(new EventEmitter(), {pid: 10001, exitCode: null as number | null, signalCode: null as string | null,
    spawnargs: ["controlled-unit-app", `--user-data-dir=${profile.dataRoot}`]});
  const app = {process: () => processOwner, async evaluate<R>(_callback: unknown): Promise<R> {return {...identity} as unknown as R;},
    async close() {processOwner.exitCode = 0; processOwner.emit("exit");}};
  return {prefix, folder, base, profile, processOwner, identity, observation, app, teardown() {
    assert.equal(path.dirname(folder), prefix); assert.equal(realpathSync(folder), folder);
    assert.match(path.basename(folder), /^[a-f0-9]{16}$/);
    rmSync(folder, {recursive: true});
  }};
}

test("fresh Model fixture cleanup binds original app methods, confirms shutdown and removes only its new bounded tree", async () => {
  const f = fixture();
  try {
    writeFileSync(path.join(f.profile.dataRoot, "synthetic.json"), "{}");
    const cleanup = await f.profile.bindOriginalApp(f.app);
    f.app.close = async () => {throw new Error("Do not call the replacement method.");};
    f.app.process = () => {throw new Error("Do not look up a replacement process.");};
    f.app.evaluate = async () => {throw new Error("Do not call the replacement evaluator.");};
    const result = await cleanup();
    assert.deepEqual(result, {originalAppClosed: true, originalNativeExitConfirmed: true, nativeObserverClosed: true,
      freshProfileRemoved: true, files: 1, bytes: 2});
    assert.equal(f.observation.admissions, 1); assert.equal(f.observation.closed, 1);
    assert.ok(existsSync(f.base)); assert.equal(existsSync(f.profile.dataRoot), false);
    await assert.rejects(cleanup());
  } finally {f.teardown();}
});

test("existing profile, wrong base and unrelated process cannot acquire cleanup ownership", async () => {
  const f = fixture();
  try {
    assert.throws(() => allocateModelWindowProfile(f.base));
    assert.throws(() => allocateModelWindowProfile(f.folder));
    f.identity.parentPid = 90001;
    await assert.rejects(f.profile.bindOriginalApp(f.app));
    assert.ok(existsSync(f.profile.dataRoot));
  } finally {f.teardown();}
});

test("uncertain original app shutdown retains the fixture and cannot be retried", async () => {
  const f = fixture();
  try {
    f.app.close = async () => {throw new Error("Synthetic uncertain shutdown.");};
    const cleanup = await f.profile.bindOriginalApp(f.app);
    await assert.rejects(cleanup()); assert.ok(existsSync(f.profile.dataRoot));
    f.processOwner.exitCode = 0;
    await assert.rejects(cleanup()); assert.ok(existsSync(f.profile.dataRoot));
  } finally {f.teardown();}
});

test("cleanup awaits the original exit event after app close returns", async () => {
  const f = fixture();
  try {
    f.app.close = async () => {setImmediate(() => {f.processOwner.exitCode = 0; f.processOwner.emit("exit");});};
    const result = await (await f.profile.bindOriginalApp(f.app))();
    assert.equal(result.freshProfileRemoved, true); assert.equal(f.processOwner.listenerCount("exit"), 0);
  } finally {f.teardown();}
});

test("replacement profile identity and hard-linked files retain all data", async () => {
  for (const kind of ["replacement", "hard-link"] as const) {
    const f = fixture();
    try {
      const cleanup = await f.profile.bindOriginalApp(f.app);
      if (kind === "replacement") {
        const retained = path.join(f.base, "original-retained");
        assert.equal(path.dirname(retained), f.base);
        renameSync(f.profile.dataRoot, retained); mkdirSync(f.profile.dataRoot);
      } else {
        const original = path.join(f.base, "synthetic-shared.json"); writeFileSync(original, "{}");
        linkSync(original, path.join(f.profile.dataRoot, "alias.json"));
      }
      await assert.rejects(cleanup()); assert.ok(existsSync(f.profile.dataRoot));
    } finally {f.teardown();}
  }
});

test("oversized new file is not deleted by the bounded cleanup", async () => {
  const f = fixture();
  try {
    const file = path.join(f.profile.dataRoot, "synthetic-large.bin"), handle = openSync(file, "wx");
    try {ftruncateSync(handle, 32 * 1024 ** 2 + 1);} finally {closeSync(handle);}
    await assert.rejects((await f.profile.bindOriginalApp(f.app))()); assert.ok(existsSync(file));
  } finally {f.teardown();}
});

test("the original native observer and app root must qualify before new profile removal", async () => {
  for (const failure of ["native-admission", "native-exit", "observer-close", "changed-root"] as const) {
    const f = fixture();
    try {
      const cleanup = await f.profile.bindOriginalApp(f.app);
      if (failure === "native-admission") f.observation.failAdmission = true;
      if (failure === "native-exit") f.observation.exitCode = 7;
      if (failure === "observer-close") f.observation.failClose = true;
      if (failure === "changed-root") f.identity.dataRoot = f.base;
      await assert.rejects(cleanup());
      assert.equal(f.processOwner.exitCode, 0); // The original close is still attempted.
      assert.ok(existsSync(f.profile.dataRoot));
      assert.equal(f.observation.closed, failure === "native-exit" || failure === "observer-close" ? 1 : 0);
    } finally {f.teardown();}
  }
});

test("a direct launch argument cannot replace the original app user-data binding", async () => {
  const f = fixture();
  try {
    f.identity.dataRoot = f.base;
    await assert.rejects(f.profile.bindOriginalApp(f.app));
    assert.equal(f.observation.admissions, 0); assert.ok(existsSync(f.profile.dataRoot));
  } finally {f.teardown();}
});

test("falsy rejection from required shutdown or observer closure retains the fresh profile", async () => {
  for (const value of [undefined, null, false, 0, ""]) {
    for (const failure of ["app-close", "observer-close"] as const) {
      const f = fixture();
      try {
        if (failure === "app-close") {
          const originalClose = f.app.close;
          f.app.close = async () => {await originalClose(); throw value;};
        } else {
          // Reject inside the controlled observer's close method; no OS helper is started.
          f.observation.failClose = true;
          Object.defineProperty(f.observation, "failClose", {get() {throw value;}});
        }
        const cleanup = await f.profile.bindOriginalApp(f.app);
        await assert.rejects(cleanup(), {message: "Original Model fixture cleanup was not qualified."});
        assert.ok(existsSync(f.profile.dataRoot)); assert.equal(f.observation.closed, 1);
      } finally {f.teardown();}
    }
  }
});
