import { createHash, randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";

export const VISUAL_COMPOSER_QUALIFICATION_SCHEMA_VERSION = 1;
export const VISUAL_COMPOSER_QUALIFICATION_MAX_DIAGNOSTIC_CHARACTERS = 500;

const SAFE_RUN_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,95}$/;
const SECRET_PATTERNS = [
  /\b(bearer|token|password|secret)\s*[=:]\s*[^\s,;]+/gi,
  /\b(authorization)\s*:\s*[^\r\n]+/gi,
];

export function createVisualComposerQualificationRunId(now = new Date()) {
  return `${now
    .toISOString()
    .replace(/[:.]/g, "-")
    .toLowerCase()}-${randomUUID().slice(0, 8)}`;
}

export function resolveVisualComposerQualificationPaths(repoRoot, runId) {
  if (!SAFE_RUN_ID_PATTERN.test(runId)) {
    throw new Error("Qualification run id is invalid.");
  }
  const qualificationRoot = resolve(
    repoRoot,
    "artifacts",
    "qualification",
    "visual-composer",
  );
  const runRoot = resolve(qualificationRoot, "runs", runId);
  assertContainedPath(qualificationRoot, runRoot);
  return {
    qualificationRoot,
    runRoot,
    evidencePath: resolve(runRoot, "evidence.json"),
    desktopDataRoot: resolve(runRoot, "desktop-user-data"),
    thinStorageRoot: resolve(runRoot, "thin-storage"),
    thinRuntimeRoot: resolve(runRoot, "thin-runtime"),
  };
}

export function sanitizeVisualComposerQualificationDiagnostic(
  value,
  options = {},
) {
  const roots = [options.repoRoot, options.userRoot]
    .filter(Boolean)
    .map((root) => String(root));
  let result = String(value ?? "");
  for (const root of roots) {
    result = result.replaceAll(
      root,
      root === options.repoRoot ? "<repo>" : "<user>",
    );
    result = result.replaceAll(
      root.replaceAll("\\", "/"),
      root === options.repoRoot ? "<repo>" : "<user>",
    );
  }
  for (const pattern of SECRET_PATTERNS) {
    result = result.replace(pattern, (match, label) => `${label}=<redacted>`);
  }
  result = result
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
  return result.slice(
    0,
    options.maximumCharacters ??
      VISUAL_COMPOSER_QUALIFICATION_MAX_DIAGNOSTIC_CHARACTERS,
  );
}

export function createVisualComposerQualificationEvidence(input) {
  if (!input.checks.length) {
    throw new Error(
      "Qualification evidence requires at least one executed check.",
    );
  }
  const checks = input.checks.map((check) => ({
    id: String(check.id),
    target: String(check.target),
    status: normalizeStatus(check.status),
    durationMs: Math.max(0, Math.round(Number(check.durationMs) || 0)),
    diagnostic: check.diagnostic
      ? sanitizeVisualComposerQualificationDiagnostic(check.diagnostic, {
          repoRoot: input.repoRoot,
          userRoot: input.userRoot,
        })
      : undefined,
  }));
  const evidence = {
    schemaVersion: VISUAL_COMPOSER_QUALIFICATION_SCHEMA_VERSION,
    runId: input.runId,
    environmentId: String(input.environmentId),
    sourceRevision: String(input.sourceRevision || "worktree"),
    startedAt: new Date(input.startedAt).toISOString(),
    completedAt: new Date(input.completedAt).toISOString(),
    status: checks.every((check) => check.status === "passed")
      ? "passed"
      : "failed",
    checks,
  };
  return {
    ...evidence,
    digest: createHash("sha256").update(JSON.stringify(evidence)).digest("hex"),
  };
}

export function writeVisualComposerQualificationEvidence(path, evidence) {
  mkdirSync(resolve(path, ".."), { recursive: true });
  writeFileSync(path, `${JSON.stringify(evidence, null, 2)}\n`, {
    encoding: "utf8",
    flag: "wx",
  });
}

export function percentile95(samples) {
  if (!samples.length)
    throw new Error("At least one timing sample is required.");
  const sorted = samples.map(Number).sort((left, right) => left - right);
  return sorted[Math.max(0, Math.ceil(sorted.length * 0.95) - 1)];
}

function assertContainedPath(root, candidate) {
  const relativePath = relative(root, candidate);
  if (
    relativePath === "" ||
    (!relativePath.startsWith("..") && !isAbsolute(relativePath))
  ) {
    return;
  }
  throw new Error("Qualification path escaped its artifact root.");
}

function normalizeStatus(status) {
  if (status === "passed" || status === "failed") return status;
  throw new Error("Qualification check status must be passed or failed.");
}
