#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import process from "node:process";

const python =
  process.env.PYTHON ?? (process.platform === "win32" ? "python" : "python3");
const controlledAiTests = [
  "modules.adapters.runtime.python.worker.tests.test_constrained_json_outlines_integration",
];
const result = spawnSync(python, ["-m", "unittest", ...controlledAiTests], {
  cwd: process.cwd(),
  env: process.env,
  stdio: "inherit",
});

if (result.error) {
  console.error(
    "Unable to start the controlled AI tests:",
    result.error.message,
  );
  process.exitCode = 1;
} else {
  process.exitCode = result.status ?? 1;
}
