#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const severityNames = ["info", "low", "moderate", "high", "critical"];
const decoderPythonMarker =
  'python_version >= "3.10" and python_version < "3.14"';
const reviewedDecoderDependencies = [
  { name: "outlines", version: "1.3.2", license: "Apache-2.0" },
  { name: "outlines-core", version: "0.2.14", license: "Apache-2.0" },
  { name: "jsonschema", version: "4.26.0", license: "MIT" },
  { name: "llguidance", version: "1.9.1", license: "MIT" },
];
const reviewedParquetDependencies = [
  { name: "pyarrow", version: "25.0.0", license: "Apache-2.0" },
];
const reviewedModelPlacementDependencies = [
  { name: "accelerate", version: "1.14.0", license: "Apache-2.0" },
  { name: "peft", version: "0.15.2", license: "Apache-2.0" },
];
const reviewedTextTrainingDependencies = [
  { name: "datasets", version: "5.0.1", license: "Apache-2.0" },
  { name: "peft", version: "0.15.2", license: "Apache-2.0" },
];
const reviewedContextDependencies = [
  { name: "lancedb", version: "0.34.0", license: "Apache-2.0" },
  { name: "pyarrow", version: "25.0.0", license: "Apache-2.0" },
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
  const formatOptions = lines.filter((line) => /^--(?:only|no)-binary\b/u.test(line));
  if (formatOptions.length !== 1 || formatOptions[0] !== "--only-binary=llguidance") {
    throw new Error("Python decoder native dependency requires the reviewed wheel-only policy.");
  }
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

export function validatePythonParquetDependencyInventory(requirementsText) {
  const lines = requirementsText
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"));
  const packages = reviewedParquetDependencies.map((dependency) => {
    const expected = `${dependency.name}==${dependency.version}`;
    if (
      lines.filter((line) =>
        line.toLowerCase().startsWith(`${dependency.name}==`),
      ).length !== 1
    ) {
      throw new Error(
        `Python Parquet dependency '${dependency.name}' must appear exactly once.`,
      );
    }
    if (!lines.includes(expected)) {
      throw new Error(
        `Python Parquet dependency '${dependency.name}' must use the reviewed exact version.`,
      );
    }
    return {
      ...dependency,
      purl: `pkg:pypi/${dependency.name}@${dependency.version}`,
    };
  });

  return {
    source: "modules/adapters/runtime/python/worker/requirements.txt",
    supportedPython: ">=3.10 <3.15",
    packages,
  };
}

export function validatePythonModelPlacementDependencyInventory(
  requirementsText,
) {
  const lines = requirementsText
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"));
  const packages = reviewedModelPlacementDependencies.map((dependency) => {
    const expected = `${dependency.name}==${dependency.version}`;
    if (
      lines.filter((line) =>
        line.toLowerCase().startsWith(`${dependency.name}==`),
      ).length !== 1
    ) {
      throw new Error(
        `Python model-placement dependency '${dependency.name}' must appear exactly once.`,
      );
    }
    if (!lines.includes(expected)) {
      throw new Error(
        `Python model-placement dependency '${dependency.name}' must use the reviewed exact version.`,
      );
    }
    return {
      ...dependency,
      purl: `pkg:pypi/${dependency.name}@${dependency.version}`,
    };
  });

  return {
    source: "modules/adapters/runtime/python/worker/requirements.txt",
    supportedPython: ">=3.10 <3.15",
    packages,
  };
}

export function validatePythonTextTrainingDependencyInventory(
  requirementsText,
) {
  const lines = requirementsText
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"));
  if (lines.length !== reviewedTextTrainingDependencies.length) {
    throw new Error(
      "Python text-training dependency inventory is incomplete or contains unreviewed direct packages.",
    );
  }
  const packages = reviewedTextTrainingDependencies.map((dependency) => {
    const expected = `${dependency.name}==${dependency.version}`;
    if (
      lines.filter((line) =>
        line.toLowerCase().startsWith(`${dependency.name}==`),
      ).length !== 1 ||
      !lines.includes(expected)
    ) {
      throw new Error(
        `Python text-training dependency '${dependency.name}' must use the reviewed exact version.`,
      );
    }
    return {
      ...dependency,
      purl: `pkg:pypi/${dependency.name}@${dependency.version}`,
    };
  });
  return {
    source:
      "modules/adapters/runtime/python/worker/requirements-training-text.txt",
    supportedPython: ">=3.10 <3.15",
    packages,
  };
}

export function validatePythonContextDependencyInventory(requirementsText) {
  const lines = requirementsText
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"));
  if (lines.length !== reviewedContextDependencies.length) {
    throw new Error(
      "Python Context dependency inventory is incomplete or contains unreviewed direct packages.",
    );
  }
  const packages = reviewedContextDependencies.map((dependency) => {
    const expected = `${dependency.name}==${dependency.version}`;
    if (
      lines.filter((line) =>
        line.toLowerCase().startsWith(`${dependency.name}==`),
      ).length !== 1 ||
      !lines.includes(expected)
    ) {
      throw new Error(
        `Python Context dependency '${dependency.name}' must use the reviewed exact version.`,
      );
    }
    return {
      ...dependency,
      purl: `pkg:pypi/${dependency.name}@${dependency.version}`,
    };
  });
  return {
    source: "modules/adapters/runtime/python/worker/requirements-context.txt",
    supportedPython: ">=3.10 <3.15",
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

function isRegularFile(file) {
  try { return statSync(file).isFile(); }
  catch { return false; }
}

export function resolveNpmInvocation({
  platform = process.platform,
  npmExecPath = process.env.npm_execpath,
  executablePath = process.execPath,
  searchPath = process.env.PATH ?? process.env.Path ?? "",
  isFile = isRegularFile,
} = {}) {
  if (npmExecPath) return { command: executablePath, prefixArgs: [npmExecPath] };
  if (platform !== "win32") return { command: "npm", prefixArgs: [] };
  const unavailable = () => new Error(
    "The npm CLI is unavailable. Run this check from npm or select an installed Node.js/npm toolchain.",
  );
  if (typeof searchPath !== "string" || searchPath.length > 32_768) throw unavailable();
  // The operator-configured toolchain remains trusted. Never run a command
  // script through a shell; skip current-directory, relative and UNC entries.
  for (const entry of searchPath.split(";").slice(0, 128)) {
    const trimmed = entry.trim();
    const directory = trimmed.startsWith('"') && trimmed.endsWith('"')
      ? trimmed.slice(1, -1) : trimmed;
    if (!/^[A-Za-z]:[\\/]/.test(directory)
        || /[\u0000-\u001f"<>|?*]/u.test(directory) || directory.slice(2).includes(":")) continue;
    for (const name of ["npm.exe", "npm.com"]) {
      const executable = path.win32.join(directory, name);
      if (isFile(executable)) return { command: executable, prefixArgs: [] };
    }
    const wrapper = path.win32.join(directory, "npm.cmd");
    const cli = path.win32.join(directory, "node_modules", "npm", "bin", "npm-cli.js");
    if (isFile(wrapper) && isFile(cli)) return { command: executablePath, prefixArgs: [cli] };
  }
  throw unavailable();
}

function runNpmJson(args, acceptedExitCodes = [0]) {
  const { command, prefixArgs } = resolveNpmInvocation();
  const commandArgs = [...prefixArgs, ...args];
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
  const pythonParquet = validatePythonParquetDependencyInventory(
    readFileSync(
      "modules/adapters/runtime/python/worker/requirements.txt",
      "utf8",
    ),
  );
  const pythonModelPlacement = validatePythonModelPlacementDependencyInventory(
    readFileSync(
      "modules/adapters/runtime/python/worker/requirements.txt",
      "utf8",
    ),
  );
  const pythonTextTraining = validatePythonTextTrainingDependencyInventory(
    readFileSync(
      "modules/adapters/runtime/python/worker/requirements-training-text.txt",
      "utf8",
    ),
  );
  const pythonContext = validatePythonContextDependencyInventory(
    readFileSync(
      "modules/adapters/runtime/python/worker/requirements-context.txt",
      "utf8",
    ),
  );

  console.log(
    JSON.stringify(
      {
        runtime,
        toolchain,
        sbom,
        pythonDecoder,
        pythonParquet,
        pythonModelPlacement,
        pythonTextTraining,
        pythonContext,
      },
      null,
      2,
    ),
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
