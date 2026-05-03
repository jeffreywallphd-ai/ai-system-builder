import { existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "../../testing/node-test";

import * as contracts from "..";

const CONTRACT_FAMILIES = [
  "api",
  "artifact",
  "artifactBrowser",
  "config",
  "dataset",
  "host",
  "artifactUpload",
  "ingestion",
  "ipc",
  "lineage",
  "logging",
  "model",
  "persistence",
  "runtime",
  "runtimeInstaller",
  "settings",
  "shared",
  "storage",
  "transform",
  "transport",
] as const;

const IMPORT_SCAN_ROOTS = [
  "modules/application",
  "modules/adapters",
  "modules/hosts",
  "modules/ui",
  "apps",
] as const;

const IMPORT_PATTERN = /\bfrom\s+["']([^"']+)["']/g;

type ImportDisciplineViolation = {
  filePath: string;
  importPath: string;
  reason: string;
};

function collectTypeScriptFiles(directoryPath: string): string[] {
  if (!existsSync(directoryPath)) {
    return [];
  }

  const files: string[] = [];
  const entries = readdirSync(directoryPath, { withFileTypes: true });

  for (const entry of entries) {
    const entryPath = resolve(directoryPath, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectTypeScriptFiles(entryPath));
      continue;
    }

    if (entry.isFile() && (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx"))) {
      files.push(entryPath);
    }
  }

  return files;
}

function getContractsImportViolation(importPath: string): string | null {
  const contractsSegmentIndex = importPath.lastIndexOf("contracts");
  if (contractsSegmentIndex === -1) {
    return null;
  }

  const suffix = importPath.slice(contractsSegmentIndex + "contracts".length);
  if (suffix.length === 0) {
    return "root contracts import is disallowed; import from a specific contracts family barrel";
  }

  if (!suffix.startsWith("/")) {
    return null;
  }

  const segments = suffix.split("/").filter(Boolean);
  if (segments.length !== 1) {
    return "deep contracts import is disallowed; import from modules/contracts/<family>";
  }

  return null;
}

describe("contracts public-surface discipline", () => {
  it("exports only contract-family namespaces from the root contracts entry point", () => {
    expect(Object.keys(contracts).sort()).toEqual([...CONTRACT_FAMILIES].sort());
  });

  it("keeps non-contract modules on family-level contract imports", () => {
    const violations: ImportDisciplineViolation[] = [];

    for (const scanRoot of IMPORT_SCAN_ROOTS) {
      const absoluteScanRoot = resolve(scanRoot);
      const files = collectTypeScriptFiles(absoluteScanRoot);

      for (const filePath of files) {
        const fileContent = readFileSync(filePath, "utf8");
        const matches = fileContent.matchAll(IMPORT_PATTERN);
        for (const match of matches) {
          const importPath = match[1];
          const violationReason = getContractsImportViolation(importPath);
          if (!violationReason) {
            continue;
          }

          violations.push({
            filePath,
            importPath,
            reason: violationReason,
          });
        }
      }
    }

    expect(violations).toEqual([]);
  });
});
