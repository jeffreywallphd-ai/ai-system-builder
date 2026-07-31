#!/usr/bin/env node

import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const defaultRepoRoot = path.resolve(scriptDirectory, "../../..");
const normalizePath = (value) => value.split(path.sep).join("/");

const pathExists = (targetPath) => {
  try {
    statSync(targetPath);
    return true;
  } catch {
    return false;
  }
};

const readJson = (absolutePath) => JSON.parse(readFileSync(absolutePath, "utf8"));

const npmScriptName = (command) => {
  if (command === "npm test") {
    return "test";
  }
  const match = /^npm run ([a-z0-9:_-]+)$/i.exec(command);
  return match?.[1];
};

export const scenarioMatchesPack = (scenario, pack) => {
  const task = scenario.task.toLowerCase();
  const affectedPaths = scenario.affectedPaths.map((value) => normalizePath(value).toLowerCase());
  return (
    pack.taskSignals.some((signal) => task.includes(signal.toLowerCase())) ||
    pack.pathSignals.some((signal) => {
      const normalizedSignal = normalizePath(signal).toLowerCase();
      return affectedPaths.some((affectedPath) => affectedPath.startsWith(normalizedSignal));
    })
  );
};

export const findAgentSupportFailures = ({
  repoRoot = defaultRepoRoot,
  catalog,
  evaluationSuite,
  packageJson,
} = {}) => {
  const failures = [];
  const fail = (scope, message) => failures.push(`${scope}: ${message}`);

  if (catalog?.schemaVersion !== 1 || !Array.isArray(catalog?.packs)) {
    return ["pack-catalog: must use schemaVersion 1 and define a packs array."];
  }
  if (evaluationSuite?.schemaVersion !== 1 || !Array.isArray(evaluationSuite?.scenarios)) {
    return ["agent-evals: must use schemaVersion 1 and define a scenarios array."];
  }
  if (!Number.isInteger(catalog.defaultAdditionalPackLimit) || catalog.defaultAdditionalPackLimit < 1) {
    fail("pack-catalog", "defaultAdditionalPackLimit must be a positive integer.");
  }
  if (!pathExists(path.resolve(repoRoot, catalog.baselinePack ?? ""))) {
    fail("pack-catalog", `baseline pack '${catalog.baselinePack}' does not exist.`);
  }

  const packIds = new Set();
  const packPaths = new Set();
  for (const pack of catalog.packs) {
    const scope = `pack:${pack.id ?? "<missing>"}`;
    if (!pack.id || packIds.has(pack.id)) {
      fail(scope, "id must be present and unique.");
    }
    if (!pack.path || packPaths.has(pack.path)) {
      fail(scope, "path must be present and unique.");
    }
    packIds.add(pack.id);
    packPaths.add(pack.path);

    if (!pathExists(path.resolve(repoRoot, pack.path ?? ""))) {
      fail(scope, `path '${pack.path}' does not exist.`);
    }
    for (const field of ["taskSignals", "pathSignals", "verification"]) {
      if (!Array.isArray(pack[field]) || pack[field].length === 0) {
        fail(scope, `${field} must be a non-empty array.`);
      }
    }
    for (const command of pack.verification ?? []) {
      const scriptName = npmScriptName(command);
      if (!scriptName || !packageJson.scripts?.[scriptName]) {
        fail(scope, `verification command '${command}' is not a repository npm script.`);
      }
    }
  }

  const packsDirectory = path.resolve(repoRoot, "docs/context/packs");
  if (pathExists(packsDirectory)) {
    const actualPackPaths = readdirSync(packsDirectory, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith(".pack.md"))
      .map((entry) => `docs/context/packs/${entry.name}`)
      .filter((entryPath) => ![catalog.baselinePack, "docs/context/packs/pack.template.md"].includes(entryPath));
    for (const actualPackPath of actualPackPaths) {
      if (!packPaths.has(actualPackPath)) {
        fail("pack-catalog", `does not catalog '${actualPackPath}'.`);
      }
    }
    for (const catalogPath of packPaths) {
      if (!actualPackPaths.includes(catalogPath)) {
        fail("pack-catalog", `catalogs '${catalogPath}' but it is not a selectable pack file.`);
      }
    }
  }

  const packsById = new Map(catalog.packs.map((pack) => [pack.id, pack]));
  const scenarioIds = new Set();
  const coveredPackIds = new Set();
  for (const scenario of evaluationSuite.scenarios) {
    const scope = `scenario:${scenario.id ?? "<missing>"}`;
    if (!scenario.id || scenarioIds.has(scenario.id)) {
      fail(scope, "id must be present and unique.");
    }
    scenarioIds.add(scenario.id);

    for (const field of [
      "affectedPaths",
      "expectedPacks",
      "forbiddenPacks",
      "requiredSources",
      "requiredChecks",
      "acceptanceSignals",
    ]) {
      if (!Array.isArray(scenario[field])) {
        fail(scope, `${field} must be an array.`);
      }
    }
    if (!scenario.task || !["proceed", "escalate"].includes(scenario.decisionExpectation)) {
      fail(scope, "task and a proceed|escalate decisionExpectation are required.");
    }
    if (
      scenario.expectedPacks?.length === 0 ||
      scenario.expectedPacks?.length > catalog.defaultAdditionalPackLimit
    ) {
      fail(scope, `expectedPacks must contain 1-${catalog.defaultAdditionalPackLimit} packs.`);
    }

    const forbidden = new Set(scenario.forbiddenPacks ?? []);
    for (const packId of scenario.expectedPacks ?? []) {
      const pack = packsById.get(packId);
      if (!pack) {
        fail(scope, `references unknown expected pack '${packId}'.`);
        continue;
      }
      coveredPackIds.add(packId);
      if (forbidden.has(packId)) {
        fail(scope, `pack '${packId}' cannot be both expected and forbidden.`);
      }
      if (!scenarioMatchesPack(scenario, pack)) {
        fail(scope, `expected pack '${packId}' has no matching task or path signal.`);
      }
    }
    for (const packId of forbidden) {
      if (!packsById.has(packId)) {
        fail(scope, `references unknown forbidden pack '${packId}'.`);
      }
    }
    for (const source of scenario.requiredSources ?? []) {
      if (!pathExists(path.resolve(repoRoot, source))) {
        fail(scope, `required source '${source}' does not exist.`);
      }
    }
    for (const command of scenario.requiredChecks ?? []) {
      const scriptName = npmScriptName(command);
      if (!scriptName || !packageJson.scripts?.[scriptName]) {
        fail(scope, `required check '${command}' is not a repository npm script.`);
      }
    }
    if (
      scenario.decisionExpectation === "escalate" &&
      !(scenario.requiredSources ?? []).includes("docs/adr/decision-readiness.md")
    ) {
      fail(scope, "escalation scenarios must require docs/adr/decision-readiness.md.");
    }
    if ((scenario.acceptanceSignals ?? []).length === 0) {
      fail(scope, "must define at least one acceptance signal.");
    }
  }

  for (const packId of packIds) {
    if (!coveredPackIds.has(packId)) {
      fail("agent-evals", `has no scenario covering pack '${packId}'.`);
    }
  }

  return failures;
};

export const loadAgentSupportInputs = (repoRoot = defaultRepoRoot) => ({
  catalog: readJson(path.resolve(repoRoot, "docs/context/pack-catalog.json")),
  evaluationSuite: readJson(path.resolve(repoRoot, "dev-tools/agent-evals/scenarios.json")),
  packageJson: readJson(path.resolve(repoRoot, "package.json")),
});

const isDirectExecution = process.argv[1] &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);

if (isDirectExecution) {
  const inputs = loadAgentSupportInputs();
  const failures = findAgentSupportFailures(inputs);
  if (failures.length > 0) {
    console.error([
      "Agent support checks failed.",
      "",
      ...failures.map((failure) => `- ${failure}`),
    ].join("\n"));
    process.exitCode = 1;
  } else {
    console.log(
      `Agent support checks passed: ${inputs.catalog.packs.length} packs, ${inputs.evaluationSuite.scenarios.length} scenarios.`,
    );
  }
}
