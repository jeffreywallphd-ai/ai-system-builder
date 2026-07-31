#!/usr/bin/env node

import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import {
  buildAssetSystemFitnessViolationMessage,
  findAssetSystemFitnessViolations,
} from "./check-asset-system-fitness.mjs";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const defaultRepoRoot = path.resolve(scriptDirectory, "../../..");
const defaultConfigurationPath = path.resolve(
  defaultRepoRoot,
  "dev-tools/config/architecture-boundaries.json",
);

const normalizeToPosixPath = (value) => value.split(path.sep).join("/");

const isDirectory = (targetPath) => {
  try {
    return statSync(targetPath).isDirectory();
  } catch {
    return false;
  }
};

const isSourceFile = (fileName) => /\.[cm]?tsx?$/i.test(fileName);

export const readBoundaryConfiguration = (
  configurationPath = defaultConfigurationPath,
) => {
  const configuration = JSON.parse(readFileSync(configurationPath, "utf8"));
  const names = new Set(
    configuration.boundaries?.map((boundary) => boundary.name),
  );

  if (
    configuration.schemaVersion !== 1 ||
    !Array.isArray(configuration.boundaries)
  ) {
    throw new Error(
      "Architecture boundary configuration must use schemaVersion 1 and define boundaries.",
    );
  }

  for (const boundary of configuration.boundaries) {
    if (
      !boundary.name ||
      !boundary.pathPrefix ||
      !Array.isArray(boundary.forbiddenTargets)
    ) {
      throw new Error(
        "Every architecture boundary needs a name, pathPrefix, and forbiddenTargets array.",
      );
    }
    for (const forbiddenTarget of boundary.forbiddenTargets) {
      if (!names.has(forbiddenTarget)) {
        throw new Error(
          `Architecture boundary '${boundary.name}' references unknown target '${forbiddenTarget}'.`,
        );
      }
    }
  }

  for (const allowedViolation of configuration.allowedViolations ?? []) {
    if (
      !allowedViolation.source ||
      !allowedViolation.targetBoundary ||
      !allowedViolation.specifier ||
      !allowedViolation.tracking ||
      !allowedViolation.reason
    ) {
      throw new Error(
        "Every allowed architecture violation needs source, targetBoundary, specifier, tracking, and reason.",
      );
    }
    if (!names.has(allowedViolation.targetBoundary)) {
      throw new Error(
        `Allowed architecture violation references unknown target '${allowedViolation.targetBoundary}'.`,
      );
    }
  }

  return configuration;
};

export const extractModuleSpecifiers = (sourceText, fileName = "source.ts") => {
  const sourceFile = ts.createSourceFile(
    fileName,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    fileName.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const specifiers = [];

  const addStringLiteral = (node) => {
    if (node && ts.isStringLiteralLike(node)) {
      specifiers.push(node.text);
    }
  };

  const visit = (node) => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      addStringLiteral(node.moduleSpecifier);
    } else if (
      ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference)
    ) {
      addStringLiteral(node.moduleReference.expression);
    } else if (ts.isCallExpression(node) && node.arguments.length === 1) {
      const isDynamicImport =
        node.expression.kind === ts.SyntaxKind.ImportKeyword;
      const isRequire =
        ts.isIdentifier(node.expression) && node.expression.text === "require";
      if (isDynamicImport || isRequire) {
        addStringLiteral(node.arguments[0]);
      }
    }
    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return [...new Set(specifiers)];
};

const classifyBoundary = (relativePath, configuration) => {
  const normalizedPath = normalizeToPosixPath(relativePath);
  return [...configuration.boundaries]
    .sort((left, right) => right.pathPrefix.length - left.pathPrefix.length)
    .find((boundary) => normalizedPath.startsWith(boundary.pathPrefix));
};

const resolveRepositorySpecifier = (sourceRelativePath, specifier) => {
  if (specifier.startsWith(".")) {
    return normalizeToPosixPath(
      path.normalize(path.join(path.dirname(sourceRelativePath), specifier)),
    );
  }
  if (specifier.startsWith("modules/") || specifier.startsWith("apps/")) {
    return normalizeToPosixPath(path.normalize(specifier));
  }
  return null;
};

const isIgnoredSourcePath = (relativePath, configuration) => {
  const segments = normalizeToPosixPath(relativePath).split("/");
  const ignoredDirectories = new Set(configuration.ignoredDirectoryNames ?? []);
  if (segments.some((segment) => ignoredDirectories.has(segment))) {
    return true;
  }
  return (configuration.ignoredFilePatterns ?? []).some((pattern) =>
    new RegExp(pattern, "i").test(relativePath),
  );
};

const walkSourceFiles = (repoRoot, sourceRoots, configuration) => {
  const files = [];
  const visit = (absolutePath) => {
    for (const entry of readdirSync(absolutePath, { withFileTypes: true })) {
      const entryPath = path.join(absolutePath, entry.name);
      const relativePath = normalizeToPosixPath(
        path.relative(repoRoot, entryPath),
      );
      if (entry.isDirectory()) {
        if (!isIgnoredSourcePath(`${relativePath}/`, configuration)) {
          visit(entryPath);
        }
      } else if (
        entry.isFile() &&
        isSourceFile(entry.name) &&
        !isIgnoredSourcePath(relativePath, configuration)
      ) {
        files.push({ absolutePath: entryPath, relativePath });
      }
    }
  };

  for (const sourceRoot of sourceRoots) {
    const absoluteRoot = path.resolve(repoRoot, sourceRoot);
    if (isDirectory(absoluteRoot)) {
      visit(absoluteRoot);
    }
  }
  return files.sort((left, right) =>
    left.relativePath.localeCompare(right.relativePath),
  );
};

export const findModuleDependencyViolations = ({
  repoRoot = defaultRepoRoot,
  configuration = readBoundaryConfiguration(),
  sourceRoots = ["modules", "apps"],
} = {}) => {
  const violations = [];

  for (const sourceFile of walkSourceFiles(
    repoRoot,
    sourceRoots,
    configuration,
  )) {
    const sourceBoundary = classifyBoundary(
      sourceFile.relativePath,
      configuration,
    );
    if (!sourceBoundary || sourceBoundary.forbiddenTargets.length === 0) {
      continue;
    }

    const sourceText = readFileSync(sourceFile.absolutePath, "utf8");
    for (const specifier of extractModuleSpecifiers(
      sourceText,
      sourceFile.relativePath,
    )) {
      const targetPath = resolveRepositorySpecifier(
        sourceFile.relativePath,
        specifier,
      );
      if (!targetPath) {
        continue;
      }
      const targetBoundary = classifyBoundary(targetPath, configuration);
      if (
        !targetBoundary ||
        !sourceBoundary.forbiddenTargets.includes(targetBoundary.name)
      ) {
        continue;
      }
      const isTrackedException = (configuration.allowedViolations ?? []).some(
        (allowedViolation) =>
          allowedViolation.source === sourceFile.relativePath &&
          allowedViolation.targetBoundary === targetBoundary.name &&
          allowedViolation.specifier === specifier,
      );
      if (isTrackedException) {
        continue;
      }

      violations.push({
        source: sourceFile.relativePath,
        sourceBoundary: sourceBoundary.name,
        specifier,
        target: targetPath,
        targetBoundary: targetBoundary.name,
        remediation: sourceBoundary.remediation,
      });
    }
  }

  return violations;
};

export const buildModuleDependencyViolationMessage = (
  violations,
  documentationPath,
) =>
  [
    "Architecture dependency guard failed.",
    `Rules: ${documentationPath}`,
    "",
    ...violations.flatMap((violation) => [
      `- ${violation.source} (${violation.sourceBoundary}) imports '${violation.specifier}' (${violation.targetBoundary}).`,
      `  ${violation.remediation}`,
    ]),
  ].join("\n");

const isDirectExecution =
  process.argv[1] &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);

if (isDirectExecution) {
  const configuration = readBoundaryConfiguration();
  const violations = findModuleDependencyViolations({ configuration });
  const assetSystemViolations = findAssetSystemFitnessViolations();
  if (violations.length > 0) {
    console.error(
      buildModuleDependencyViolationMessage(
        violations,
        configuration.documentation,
      ),
    );
    process.exitCode = 1;
  }
  if (assetSystemViolations.length > 0) {
    console.error(
      buildAssetSystemFitnessViolationMessage(assetSystemViolations),
    );
    process.exitCode = 1;
  }
}
