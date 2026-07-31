#!/usr/bin/env node

import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import electronPath from "electron";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDirectory, "../../..");
const tsxCli = path.join(repoRoot, "node_modules", "tsx", "dist", "cli.mjs");
const maintenanceCli = path.join(scriptDirectory, "sqlite-maintenance.ts");
const child = spawn(electronPath, [tsxCli, maintenanceCli, ...process.argv.slice(2)], {
  cwd: repoRoot,
  env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
  stdio: "inherit",
  windowsHide: true,
});

child.once("error", (error) => {
  process.stderr.write(`Unable to start the SQLite maintenance runtime: ${error.message}\n`);
  process.exitCode = 1;
});
child.once("close", (code, signal) => {
  if (signal) {
    process.stderr.write(`SQLite maintenance stopped by ${signal}.\n`);
    process.exitCode = 1;
    return;
  }
  process.exitCode = code ?? 1;
});
