import assert from "node:assert/strict";
import {existsSync, lstatSync, mkdirSync, readdirSync, realpathSync, rmSync} from "node:fs";
import path from "node:path";
import {spawnSync} from "node:child_process";
import {observeOwnedNativeProcessExit} from "./owned-native-process-exit.mjs";

export const MODEL_WINDOW_JOURNEY_TITLE = "packaged Desktop shows an exact saved Model with separate window consent";
export const MODEL_WINDOW_JOURNEY_ARGUMENTS = Object.freeze([
  "node_modules/@playwright/test/cli.js", "test", "--config=dev-tools/config/playwright.visual-composer.config.ts",
  // Playwright matches the complete project/file/test title, not the leaf title.
  "--project=packaged-desktop", "--workers=1", "--retries=0", "--forbid-only", `--grep=${MODEL_WINDOW_JOURNEY_TITLE}$`,
  "packaged-desktop-headless.e2e.spec.ts",
]);

type App = {
  process(): {readonly pid?: number; readonly exitCode: number | null; readonly signalCode: string | null;
    once(event: "exit", listener: () => void): unknown; removeListener(event: "exit", listener: () => void): unknown};
  evaluate<R>(callback: (electron: {app: {getPath(name: "userData"): string}}) => R): Promise<R>;
  close(): Promise<void>;
};
const validPid = (value: unknown): value is number => Number.isInteger(value) && Number(value) >= 1 && Number(value) <= 0xffffffff;

/** Fixed metadata-only fixture dependency; no model or runtime worker is started here. */
export function modelWindowRuntimeEnvironment(root: string, nodeExecutable: string) {
  assert.equal(realpathSync(root), root);
  assert.ok(path.isAbsolute(nodeExecutable) && /^node(?:\.exe)?$/i.test(path.basename(nodeExecutable)) && lstatSync(nodeExecutable).isFile());
  const worker = "dev-tools/scripts/qualification/visual-composer/controlled-conversation-runtime-worker.mjs";
  assert.ok(lstatSync(path.join(root, worker)).isFile());
  return Object.freeze({PYTHON_RUNTIME_BASE_URL: "http://127.0.0.1:43172", PYTHON_RUNTIME_HOST: "127.0.0.1",
    PYTHON_RUNTIME_PORT: "43172", PYTHON_RUNTIME_COMMAND: nodeExecutable, PYTHON_RUNTIME_ARGS: worker,
    PYTHON_RUNTIME_WORKER_DIR: root, PYTHON_RUNTIME_STARTUP_TIMEOUT_MS: "15000"});
}

/** Ordinary fresh test storage only; no protected/legacy tree or native race-proof claim. */
export function allocateModelWindowProfile(base: string, observeExit = observeOwnedNativeProcessExit) {
  const prefix = path.join(realpathSync(process.cwd()), "artifacts", "qualification", "visual-composer", "d");
  assert.ok(path.isAbsolute(base) && realpathSync(base) === base);
  const relative = path.relative(prefix, base).split(path.sep);
  assert.ok(relative.length === 2 && /^[a-f0-9]{16}$/.test(relative[0]) && relative[1] === "desktop");
  const dataRoot = path.join(base, "headless-model-reveal");
  mkdirSync(dataRoot); // Exclusive allocation: never adopt a retained test tree.
  const original = lstatSync(dataRoot, {bigint: true});
  assert.ok(original.isDirectory() && !original.isSymbolicLink() && realpathSync(dataRoot) === dataRoot);
  let bound = false;
  return {
    dataRoot,
    async bindOriginalApp(app: App) {
      assert.equal(bound, false); bound = true;
      const processOwner = app.process();
      const launcherPid = processOwner.pid;
      assert.ok(validPid(launcherPid));
      const close = app.close.bind(app);
      const evaluate = app.evaluate.bind(app);
      const once = processOwner.once.bind(processOwner), remove = processOwner.removeListener.bind(processOwner);
      const readIdentity = () => evaluate(({app}) => ({pid: process.pid, parentPid: process.ppid, dataRoot: app.getPath("userData")}));
      const identity = Object.freeze(await readIdentity());
      const validIdentity = (value: typeof identity) => {
        assert.ok(validPid(value.pid) && validPid(value.parentPid));
        assert.ok(value.pid === launcherPid || value.parentPid === launcherPid);
        assert.equal(value.dataRoot, dataRoot);
      };
      validIdentity(identity);
      let attempted = false;
      return async () => {
        assert.equal(attempted, false); attempted = true;
        let observer: Awaited<ReturnType<typeof observeExit>> | undefined;
        let failed = false;
        const remember = (_error: unknown) => {failed = true;};
        try {
          assert.deepEqual(await readIdentity(), identity);
          observer = await observeExit(identity.pid, {rootPid: launcherPid});
          assert.equal(observer.admission.pid, identity.pid);
          assert.equal(observer.admission.rootPid, launcherPid);
          assert.equal(observer.admission.parentPid, identity.parentPid);
          assert.deepEqual(await readIdentity(), identity);
        } catch (error) {remember(error);}
        let observed!: () => void;
        const exited = new Promise<void>(resolve => {observed = resolve;});
        once("exit", observed);
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
          await close();
          if (processOwner.exitCode === null && processOwner.signalCode === null)
            await Promise.race([exited, new Promise<void>(resolve => {timer = setTimeout(resolve, 10_000);})]);
        } catch (error) {remember(error);} finally {
          remove("exit", observed);
          if (timer) clearTimeout(timer);
        }
        try {
          assert.ok(observer, "Original native process observation was not admitted.");
          const result = await observer.outcome;
          assert.equal(result.pid, identity.pid); assert.equal(result.rootPid, launcherPid);
          assert.equal(result.exitCode, 0);
          assert.ok(result.retired?.length && result.retired.every(entry => entry.exitCode === 0));
        } catch (error) {remember(error);} finally {
          try {await observer?.close();} catch (error) {remember(error);}
        }
        if (failed) throw new Error("Original Model fixture cleanup was not qualified.");
        assert.equal(processOwner.exitCode, 0, "Original app shutdown was not confirmed.");
        assert.equal(processOwner.signalCode, null, "Original app did not close gracefully.");
        let files = 0, bytes = 0, entries = 0;
        const verifyRoot = () => {
          const current = lstatSync(dataRoot, {bigint: true});
          assert.ok(current.isDirectory() && !current.isSymbolicLink());
          assert.equal(realpathSync(dataRoot), dataRoot); assert.equal(path.dirname(dataRoot), base);
          assert.equal(current.dev, original.dev); assert.equal(current.ino, original.ino);
          assert.equal(realpathSync(base), base);
        };
        verifyRoot();
        const pending = [{directory: dataRoot, depth: 0}];
        while (pending.length) {
          const {directory, depth} = pending.pop()!;
          assert.ok(depth <= 24);
          for (const name of readdirSync(directory)) {
            assert.ok(++entries <= 4096);
            const target = path.join(directory, name), value = lstatSync(target);
            assert.ok(!value.isSymbolicLink() && path.relative(dataRoot, target).split(path.sep).every(part => part !== ".."));
            assert.equal(realpathSync(target), target);
            if (value.isDirectory()) pending.push({directory: target, depth: depth + 1});
            else {
              assert.ok(value.isFile() && value.nlink === 1 && Number.isSafeInteger(value.size) && value.size <= 32 * 1024 ** 2);
              files++; bytes += value.size; assert.ok(bytes <= 128 * 1024 ** 2);
            }
          }
        }
        verifyRoot();
        rmSync(dataRoot, {recursive: true});
        assert.equal(existsSync(dataRoot), false);
        return {originalAppClosed: true, originalNativeExitConfirmed: true, nativeObserverClosed: true,
          freshProfileRemoved: true, files, bytes};
      };
    },
  };
}

// Fixed developer check only. The existing setup builds the current package and
// verifies source identity. No caller-supplied command, test or app path is used.
if (require.main === module) {
  try {
    assert.equal(process.argv.length, 2);
    assert.equal(process.platform, "win32");
    const candidates = [process.env.npm_execpath,
      path.join(path.dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js"),
      process.env.ProgramFiles ? path.join(process.env.ProgramFiles, "nodejs", "node_modules", "npm", "bin", "npm-cli.js") : undefined];
    const npmCli = candidates.find(value => {
      if (!value || !path.isAbsolute(value) || path.basename(value) !== "npm-cli.js") return false;
      try {return lstatSync(value).isFile() && realpathSync(value) === path.resolve(value);} catch {return false;}
    });
    assert.ok(npmCli, "The existing installed npm CLI is unavailable.");
    const result = spawnSync(process.execPath, [...MODEL_WINDOW_JOURNEY_ARGUMENTS], {
      cwd: process.cwd(), env: {...process.env, npm_execpath: npmCli, VISUAL_COMPOSER_MODEL_WINDOW_NODE_SEED: "1"}, windowsHide: true,
      stdio: "inherit", timeout: 600_000,
    });
    process.exitCode = result.status === 0 && !result.error ? 0 : 1;
  } catch {
    process.stderr.write("The fixed Desktop Model display check could not start.\n");
    process.exitCode = 1;
  }
}
