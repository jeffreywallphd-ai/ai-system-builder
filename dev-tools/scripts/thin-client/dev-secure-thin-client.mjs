#!/usr/bin/env node
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export function getRepositoryRootFromScriptUrl(scriptUrl = import.meta.url) {
  return path.resolve(path.dirname(fileURLToPath(scriptUrl)), "..", "..", "..");
}

export function createSecureThinClientDevPaths(repositoryRootDirectory = getRepositoryRootFromScriptUrl()) {
  return {
    repositoryRootDirectory,
    thinClientDirectory: path.join(repositoryRootDirectory, "apps", "thin-client"),
    viteCliPath: path.join(repositoryRootDirectory, "node_modules", "vite", "bin", "vite.js"),
  };
}

export function createSecureThinClientDevEnvironment(environment = process.env) {
  const secureEnvironment = {
    ...environment,
    AI_SYSTEM_BUILDER_THIN_CLIENT_HTTPS_ENABLED:
      environment.AI_SYSTEM_BUILDER_THIN_CLIENT_HTTPS_ENABLED || "true",
    AI_SYSTEM_BUILDER_HTTPS_ENABLED: environment.AI_SYSTEM_BUILDER_HTTPS_ENABLED || "true",
    AI_SYSTEM_BUILDER_TLS_CERT_MODE: environment.AI_SYSTEM_BUILDER_TLS_CERT_MODE || "auto-self-signed",
  };

  if (process.platform !== "win32") {
    return secureEnvironment;
  }

  const normalizedEnvironment = {};
  const seenKeys = new Set();

  for (const [key, value] of Object.entries(secureEnvironment)) {
    const normalizedKey = key.toLowerCase();
    if (seenKeys.has(normalizedKey)) {
      continue;
    }

    seenKeys.add(normalizedKey);
    normalizedEnvironment[key] = value;
  }

  return normalizedEnvironment;
}

export function startSecureThinClientDevServer(options = {}) {
  const paths = options.paths ?? createSecureThinClientDevPaths();
  const child = spawn(process.execPath, [
    "--preserve-symlinks",
    "--preserve-symlinks-main",
    paths.viteCliPath,
    "--configLoader",
    "runner",
    ...(options.args ?? []),
  ], {
    cwd: paths.thinClientDirectory,
    env: createSecureThinClientDevEnvironment(options.env ?? process.env),
    stdio: "inherit",
  });

  child.once("exit", (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }
    process.exitCode = code ?? 1;
  });

  return child;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  startSecureThinClientDevServer({ args: process.argv.slice(2) });
}
