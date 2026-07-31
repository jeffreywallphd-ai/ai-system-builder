#!/usr/bin/env node

import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { inspectServerDeploymentArtifacts } from "./server-deployment-artifacts-core.mjs";

const files = {
  dockerfile: "deployments/server/Dockerfile",
  compose: "deployments/server/compose.qualification.yaml",
  kubernetes: "deployments/server/kubernetes-deployment.example.yaml",
  runner: "deployments/server/kubernetes-runner.example.yaml",
  kustomization: "deployments/server/kustomization.yaml",
  workflow: ".github/workflows/ci.yml",
};

async function writeEvidence(path, value) {
  const target = resolve(path);
  const temporary = `${target}.${process.pid}.tmp`;
  await mkdir(dirname(target), { recursive: true });
  try {
    await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, {
      encoding: "utf8",
      flag: "wx",
    });
    await rename(temporary, target);
  } catch (error) {
    await unlink(temporary).catch(() => undefined);
    throw error;
  }
}

const sources = Object.fromEntries(
  await Promise.all(
    Object.entries(files).map(async ([name, path]) => [
      name,
      await readFile(path, "utf8"),
    ]),
  ),
);
const violations = inspectServerDeploymentArtifacts(sources);
await writeEvidence("artifacts/qualification/deployment/static-check.json", {
  kind: "ai-system-builder-deployment-static-check",
  schemaVersion: 1,
  status: violations.length === 0 ? "passed" : "failed",
  checkedFiles: Object.values(files),
  violationCount: violations.length,
  violations,
});
if (violations.length > 0) {
  throw new Error(
    `Deployment artifact qualification failed:\n- ${violations.join("\n- ")}`,
  );
}
process.stdout.write(
  `${JSON.stringify({ operation: "deployment-static-check", status: "passed", checkedFileCount: Object.keys(files).length })}\n`,
);
