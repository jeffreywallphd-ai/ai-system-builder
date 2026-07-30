#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const severityNames = ["info", "low", "moderate", "high", "critical"];
const decoderPythonMarker =
  'python_version >= "3.10" and python_version < "3.14"';
const reviewedDecoderDependencies = [
  { name: "outlines", version: "1.3.2", license: "Apache-2.0" },
  { name: "outlines-core", version: "0.2.14", license: "Apache-2.0" },
  { name: "jsonschema", version: "4.26.0", license: "MIT" },
];

export function validatePythonDecoderDependencyInventory(requirementsText) {
  const lines = requirementsText
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"));
  const decoderLines = lines.filter((line) =>
    reviewedDecoderDependencies.some(({ name }) =>
      line.toLowerCase().startsWith(`${name}==`),
    ),
  );
  if (decoderLines.length !== reviewedDecoderDependencies.length) {
    throw new Error(
      "Python decoder dependency inventory is incomplete or duplicated.",
    );
  }

  const packages = reviewedDecoderDependencies.map((dependency) => {
    const expected = `${dependency.name}==${dependency.version}; ${decoderPythonMarker}`;
    if (!decoderLines.includes(expected)) {
      throw new Error(
        `Python decoder dependency '${dependency.name}' must use the reviewed exact version and Python marker.`,
      );
    }
    return {
      ...dependency,
      purl: `pkg:pypi/${dependency.name}@${dependency.version}`,
    };
  });

  return {
    source: "modules/adapters/runtime/python/worker/requirements.txt",
    supportedPython: ">=3.10 <3.14",
    packages,
  };
}

export function evaluateAuditReport(report, scope) {
  const vulnerabilities = report?.metadata?.vulnerabilities;
  if (!vulnerabilities || typeof vulnerabilities !== "object") {
    throw new Error(`${scope} audit did not return vulnerability metadata.`);
  }

  const counts = Object.fromEntries(
    severityNames.map((severity) => {
      const value = vulnerabilities[severity];
      if (!Number.isInteger(value) || value < 0) {
        throw new Error(
          `${scope} audit returned an invalid ${severity} count.`,
        );
      }
      return [severity, value];
    }),
  );
  const total = severityNames.reduce(
    (sum, severity) => sum + counts[severity],
    0,
  );

  return {
    scope,
    counts: { ...counts, total },
    blocking: total > 0,
  };
}

export function validateRuntimeSbom(sbom) {
  if (sbom?.spdxVersion !== "SPDX-2.3") {
    throw new Error("Runtime SBOM must use SPDX 2.3.");
  }
  if (!Array.isArray(sbom.packages) || sbom.packages.length === 0) {
    throw new Error("Runtime SBOM must contain at least one package.");
  }
  if (!Array.isArray(sbom.relationships) || sbom.relationships.length === 0) {
    throw new Error("Runtime SBOM must contain dependency relationships.");
  }
  return {
    packageCount: sbom.packages.length,
    relationshipCount: sbom.relationships.length,
  };
}

function runNpmJson(args, acceptedExitCodes = [0]) {
  const npmCliPath = process.env.npm_execpath;
  const command = npmCliPath ? process.execPath : "npm";
  const commandArgs = npmCliPath ? [npmCliPath, ...args] : args;
  const result = spawnSync(command, commandArgs, {
    cwd: process.cwd(),
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
    shell: false,
  });

  if (result.error) {
    throw new Error(`Unable to run npm ${args[0]}: ${result.error.message}`);
  }
  if (!acceptedExitCodes.includes(result.status ?? -1)) {
    throw new Error(
      `npm ${args[0]} exited with ${result.status}: ${result.stderr.trim()}`,
    );
  }

  try {
    return JSON.parse(result.stdout);
  } catch {
    throw new Error(`npm ${args[0]} did not return valid JSON.`);
  }
}

export function runDependencySecurityCheck() {
  const runtime = evaluateAuditReport(
    runNpmJson(["audit", "--omit=dev", "--json"], [0, 1]),
    "runtime",
  );
  const toolchain = evaluateAuditReport(
    runNpmJson(["audit", "--json"], [0, 1]),
    "toolchain",
  );
  const sbom = validateRuntimeSbom(
    runNpmJson(["sbom", "--omit=dev", "--sbom-format=spdx"]),
  );
  const pythonDecoder = validatePythonDecoderDependencyInventory(
    readFileSync(
      "modules/adapters/runtime/python/worker/requirements.txt",
      "utf8",
    ),
  );

  console.log(
    JSON.stringify({ runtime, toolchain, sbom, pythonDecoder }, null, 2),
  );
  if (runtime.blocking) {
    throw new Error("Runtime dependency audit contains known vulnerabilities.");
  }
  if (toolchain.blocking) {
    throw new Error(
      "Development toolchain audit contains known vulnerabilities.",
    );
  }
}

const invokedPath = process.argv[1]
  ? pathToFileURL(process.argv[1]).href
  : undefined;
if (invokedPath === import.meta.url) {
  try {
    runDependencySecurityCheck();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
