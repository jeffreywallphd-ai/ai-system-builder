#!/usr/bin/env node

import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  assessAssetSystemQualification,
  readAssetSystemQualificationConfig,
} from "./asset-system-qualification-core.mjs";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDirectory, "../../..");
const config = readAssetSystemQualificationConfig(
  path.resolve(repoRoot, "dev-tools/config/asset-system-qualification.json"),
);
const evidenceArgument = process.argv.indexOf("--evidence");
if (evidenceArgument >= 0) {
  const evidencePath = process.argv[evidenceArgument + 1];
  if (!evidencePath) throw new Error("--evidence requires a JSON file path.");
  const { readFileSync } = await import("node:fs");
  const assessment = assessAssetSystemQualification(
    config,
    JSON.parse(readFileSync(path.resolve(evidencePath), "utf8")),
  );
  process.stdout.write(`${JSON.stringify(assessment)}\n`);
  if (assessment.status !== "qualified") process.exitCode = 1;
} else {
  process.stdout.write(
    `${JSON.stringify({ operation: "asset-system-qualification-config", status: "passed", compatibilityRows: config.compatibilityMatrix.length, performanceBudgets: config.performanceBudgets.length, admissionControls: config.admissionControls.length, qualificationProfiles: config.qualificationProfiles.length })}\n`,
  );
}
