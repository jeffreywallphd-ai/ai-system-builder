import assert from "node:assert/strict";
import { realpath } from "node:fs/promises";
import path from "node:path";

const WORKER = "dev-tools/scripts/qualification/visual-composer/controlled-conversation-runtime-worker.mjs";

// An explicit test composition callback, never an environment/API bypass. The
// host still launches and authenticates its own worker and checks capabilities.
export function createControlledRuntimeEnvironmentPreparer({ repoRoot, runRoot, environment }) {
  const repository = path.resolve(repoRoot);
  const runtimeRoot = path.resolve(runRoot);
  const base = path.join(repository, "artifacts/qualification/visual-composer/d");
  const relative = path.relative(base, runtimeRoot);
  assert.ok(relative && !relative.startsWith("..") && !path.isAbsolute(relative));
  const cache = path.join(runtimeRoot, "controlled-model-cache");
  const port = environment.PYTHON_RUNTIME_PORT;
  assert.match(String(port), /^[0-9]{4,5}$/);
  assert.ok(Number(port) >= 1024 && Number(port) <= 65535);
  const baseUrl = `http://127.0.0.1:${port}`;
  assert.equal(environment.PYTHON_RUNTIME_HOST, "127.0.0.1");
  assert.equal(environment.PYTHON_RUNTIME_BASE_URL, baseUrl);
  return async context => {
    assert.equal(context.command, process.execPath);
    assert.deepEqual(context.args, [WORKER]);
    assert.equal(await realpath(context.cwd), await realpath(repository));
    assert.equal(context.env?.PYTHON_RUNTIME_HOST, "127.0.0.1");
    assert.equal(String(context.env?.PYTHON_RUNTIME_PORT), String(port));
    assert.equal(context.env?.PYTHON_RUNTIME_BASE_URL, baseUrl);
    assert.equal(path.resolve(context.env?.HF_HUB_CACHE ?? ""), cache);
  };
}
