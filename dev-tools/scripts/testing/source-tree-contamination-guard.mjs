#!/usr/bin/env node

import { readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const generatedJavaScriptPattern = /\.(?:js|mjs|cjs)$/i;
const ignoredDirectoryNames = new Set([
  ".git",
  "artifacts",
  "dist",
  "node_modules",
]);

// No JavaScript implementation files are currently allowed under modules/**.
const allowedModuleJavaScriptPaths = new Set([]);

const normalizeToPosixPath = (value) => value.split(path.sep).join("/");

const isDirectoryPath = (targetPath) => {
  try {
    return statSync(targetPath).isDirectory();
  } catch {
    return false;
  }
};

const walkFiles = (startPath, visit) => {
  const entries = readdirSync(startPath, { withFileTypes: true });

  for (const entry of entries) {
    const absolutePath = path.join(startPath, entry.name);

    if (entry.isDirectory()) {
      if (!ignoredDirectoryNames.has(entry.name)) {
        walkFiles(absolutePath, visit);
      }
      continue;
    }

    if (entry.isFile()) {
      visit(absolutePath);
    }
  }
};

export const findSourceTreeJavaScriptArtifacts = (repoRoot) => {
  const modulesRoot = path.resolve(repoRoot, "modules");
  if (!isDirectoryPath(modulesRoot)) {
    return [];
  }

  const artifacts = [];
  walkFiles(modulesRoot, (absolutePath) => {
    const relativePath = normalizeToPosixPath(path.relative(repoRoot, absolutePath));
    if (
      generatedJavaScriptPattern.test(relativePath) &&
      !allowedModuleJavaScriptPaths.has(relativePath)
    ) {
      artifacts.push(relativePath);
    }
  });

  return artifacts.sort((left, right) => left.localeCompare(right));
};

export const buildSourceTreeContaminationMessage = (artifacts) => {
  const sample = artifacts.slice(0, 20).map((artifact) => `  - ${artifact}`);
  const omittedCount = artifacts.length - sample.length;
  const omittedLine = omittedCount > 0 ? [`  - ...and ${omittedCount} more`] : [];

  return [
    "TypeScript output was emitted into modules/**.",
    "Generated JavaScript implementation artifacts must not live beside TypeScript source.",
    "Use the project TypeScript configuration so output is written to dist/, artifacts/test-runtime/, or another intentional build/runtime output directory.",
    "Contaminating files:",
    ...sample,
    ...omittedLine,
  ].join("\n");
};

export const assertNoSourceTreeJavaScriptArtifacts = (repoRoot) => {
  const artifacts = findSourceTreeJavaScriptArtifacts(repoRoot);
  if (artifacts.length > 0) {
    throw new Error(buildSourceTreeContaminationMessage(artifacts));
  }
};

const isDirectExecution = process.argv[1] &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);

if (isDirectExecution) {
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
  assertNoSourceTreeJavaScriptArtifacts(repoRoot);
}
