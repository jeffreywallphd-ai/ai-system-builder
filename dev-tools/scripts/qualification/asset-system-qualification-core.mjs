import { readFileSync } from "node:fs";

import { validateAssetSystemPerformanceReport } from "./asset-system-performance-core.mjs";

const COMPONENTS = [
  "definition",
  "implementation",
  "package",
  "system",
  "schema",
  "host",
  "runtime",
  "deployment",
];
const OPERATIONS = [
  "catalog.browse",
  "studio.validate",
  "implementation.resolve",
  "system.build",
  "system.preview",
  "runtime.handoff",
];
const CONTROLS = [
  "package",
  "build",
  "preview",
  "release-manifest",
  "execution",
];
const PROFILES = [
  "local-windows",
  "local-macos",
  "local-linux",
  "campus-server",
  "cloud-server",
];
const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?$/;
const SAFE_ID = /^[a-z0-9][a-z0-9.-]{1,159}$/;
const SHA256 = /^sha256:[a-f0-9]{64}$/;

export function readAssetSystemQualificationConfig(path) {
  const value = JSON.parse(readFileSync(path, "utf8"));
  validateAssetSystemQualificationConfig(value);
  return value;
}

export function validateAssetSystemQualificationConfig(value) {
  const errors = [];
  if (!value || typeof value !== "object" || Array.isArray(value))
    errors.push("configuration must be an object");
  if (value?.schemaVersion !== 1) errors.push("schemaVersion must be 1");
  if (!SEMVER.test(String(value?.productVersion ?? "")))
    errors.push("productVersion must be semantic version text");
  exactIds(
    value?.compatibilityMatrix,
    "component",
    COMPONENTS,
    "compatibilityMatrix",
    errors,
  );
  for (const item of value?.compatibilityMatrix ?? []) {
    if (!safeText(item.supported) || !safeText(item.changeRule))
      errors.push(`compatibility ${item.component ?? "unknown"} is incomplete`);
  }
  const deprecation = value?.deprecationPolicy;
  if (
    !Number.isInteger(deprecation?.minimumMinorReleasesBeforeRemoval) ||
    deprecation.minimumMinorReleasesBeforeRemoval < 1 ||
    [
      "requiresReplacement",
      "requiresDocumentation",
      "removalRequiresMajorVersion",
      "revocationOverridesWindow",
    ].some((key) => deprecation?.[key] !== true)
  )
    errors.push(
      "deprecationPolicy must preserve replacement, documentation, major removal, and revocation rules",
    );
  exactIds(
    value?.performanceBudgets,
    "operation",
    OPERATIONS,
    "performanceBudgets",
    errors,
  );
  for (const budget of value?.performanceBudgets ?? []) {
    if (
      budget.percentile !== 95 ||
      !positiveInteger(budget.maximumMilliseconds) ||
      !safeText(budget.workload)
    )
      errors.push(
        `performance budget ${budget.operation ?? "unknown"} is invalid`,
      );
  }
  exactIds(
    value?.admissionControls,
    "id",
    CONTROLS,
    "admissionControls",
    errors,
  );
  for (const control of value?.admissionControls ?? []) {
    if (
      !safePath(control.source) ||
      !control.limits ||
      Object.keys(control.limits).length === 0 ||
      Object.values(control.limits).some((item) => !positiveInteger(item))
    )
      errors.push(`admission control ${control.id ?? "unknown"} is invalid`);
  }
  exactIds(
    value?.qualificationProfiles,
    "profile",
    PROFILES,
    "qualificationProfiles",
    errors,
  );
  for (const profile of value?.qualificationProfiles ?? []) {
    if (
      !Array.isArray(profile.requiredEvidence) ||
      profile.requiredEvidence.length === 0 ||
      profile.requiredEvidence.some((item) => !SAFE_ID.test(String(item))) ||
      new Set(profile.requiredEvidence).size !== profile.requiredEvidence.length
    )
      errors.push(
        `qualification profile ${profile.profile ?? "unknown"} has invalid evidence identifiers`,
      );
  }
  if (errors.length > 0)
    throw new Error(
      `Asset/system qualification configuration is invalid:\n- ${errors.join("\n- ")}`,
    );
  return value;
}

export function assessAssetSystemQualification(config, evidence) {
  validateAssetSystemQualificationConfig(config);
  if (
    evidence?.schemaVersion !== 1 ||
    !PROFILES.includes(evidence?.profile) ||
    !SAFE_ID.test(String(evidence?.sourceRevision ?? "")) ||
    !SHA256.test(String(evidence?.productDigest ?? "")) ||
    Number.isNaN(Date.parse(String(evidence?.recordedAt ?? ""))) ||
    !Array.isArray(evidence?.checks)
  )
    throw new Error("Qualification evidence envelope is invalid.");
  const profile = config.qualificationProfiles.find(
    (item) => item.profile === evidence.profile,
  );
  const checks = new Map();
  for (const check of evidence.checks) {
    if (
      !SAFE_ID.test(String(check?.id ?? "")) ||
      !["passed", "failed", "not-run", "not-applicable"].includes(
        check?.status,
      ) ||
      checks.has(check.id) ||
      (check.status === "passed" &&
        (!SAFE_ID.test(String(check?.evidenceId ?? "")) ||
          !SHA256.test(String(check?.evidenceDigest ?? ""))))
    )
      throw new Error("Qualification evidence check is invalid.");
    if (check.id === "performance" && check.status === "passed") {
      validateAssetSystemPerformanceReport(config, check.performanceReport);
      if (check.performanceReport.status !== "passed")
        throw new Error("Passed performance evidence exceeds a budget.");
    }
    checks.set(check.id, check);
  }
  const required = profile.requiredEvidence.map((id) => ({
    id,
    status: checks.get(id)?.status ?? "not-run",
  }));
  const status = required.some((item) => item.status === "failed")
    ? "failed"
    : required.every((item) => item.status === "passed")
      ? "qualified"
      : "incomplete";
  return {
    schemaVersion: 1,
    profile: profile.profile,
    sourceRevision: evidence.sourceRevision,
    productDigest: evidence.productDigest,
    status,
    required,
  };
}

function exactIds(items, key, expected, label, errors) {
  if (!Array.isArray(items)) {
    errors.push(`${label} must be an array`);
    return;
  }
  const actual = items.map((item) => item?.[key]);
  if (
    actual.length !== expected.length ||
    new Set(actual).size !== actual.length ||
    expected.some((item) => !actual.includes(item))
  )
    errors.push(`${label} must contain exactly: ${expected.join(", ")}`);
}

const positiveInteger = (value) => Number.isInteger(value) && value > 0;
const safeText = (value) =>
  typeof value === "string" &&
  value.trim().length > 0 &&
  value.length <= 500 &&
  !/[\u0000-\u001f\u007f]/.test(value);
const safePath = (value) =>
  typeof value === "string" &&
  /^(?:modules|apps|dev-tools)\/[A-Za-z0-9._/-]+$/.test(value) &&
  !value.includes("..");
