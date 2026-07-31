#!/usr/bin/env node

import path from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

import { readAssetSystemQualificationConfig } from "./asset-system-qualification-core.mjs";
import { runAssetSystemPerformanceQualification } from "./asset-system-performance-core.mjs";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDirectory, "../../..");
const probeModuleArgument = process.argv.indexOf("--probe-module");
const probeModulePath = process.argv[probeModuleArgument + 1];
if (probeModuleArgument < 0 || !probeModulePath)
  throw new Error("--probe-module requires a trusted local module path.");

const config = readAssetSystemQualificationConfig(
  path.resolve(repoRoot, "dev-tools/config/asset-system-qualification.json"),
);
const imported = await import(
  pathToFileURL(path.resolve(probeModulePath)).href
);
const probeSet = imported.default ?? imported.qualificationProbeSet;
if (!probeSet || typeof probeSet !== "object")
  throw new Error(
    "The probe module must export a default qualification probe set.",
  );
const report = await runAssetSystemPerformanceQualification({
  config,
  environmentId: probeSet.environmentId,
  sourceRevision: probeSet.sourceRevision,
  probes: probeSet.probes,
  iterations: probeSet.iterations,
  warmupIterations: probeSet.warmupIterations,
});
process.stdout.write(`${JSON.stringify(report)}\n`);
if (report.status !== "passed") process.exitCode = 1;
