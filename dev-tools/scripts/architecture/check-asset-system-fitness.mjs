import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { readAssetSystemQualificationConfig } from "../qualification/asset-system-qualification-core.mjs";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const defaultRepoRoot = path.resolve(scriptDirectory, "../../..");
const routePrefixes = [
  "modules/adapters/transport/api-express/asset-package/",
  "modules/adapters/transport/api-express/system-builder/",
  "modules/adapters/transport/api-express/system-build/",
  "modules/adapters/transport/api-express/system-data/",
  "modules/adapters/transport/api-express/system-review/",
  "modules/adapters/transport/api-express/system-deployment/",
];
const rendererPrefixes = [
  "apps/desktop/src/renderer/",
  "apps/thin-client/src/",
  "modules/ui/",
];
const privilegedPrefixes = [
  "modules/adapters/",
  "modules/domain/",
  "modules/hosts/",
];
const forbiddenMetadataProperty =
  /\b(?:readonly\s+)?(?:executableBytes|sourceCode|entrypoint|containerImage|wasmBytes|runtimePayload|packageBytes)\??\s*:/;

const requiredAnchors = [
  {
    rule: "operational-scope",
    path: "modules/contracts/system-deployment/system-deployment-models.ts",
    tokens: ["readonly organizationId:", "readonly workspaceId:"],
  },
  {
    rule: "operational-scope",
    path: "modules/application/ports/system-deployment/system-deployment-repository.port.ts",
    tokens: ["organizationId: OrganizationId", "workspaceId: WorkspaceId"],
  },
  {
    rule: "capability-drift",
    path: "modules/hosts/shared/composition/composeSystemDeployment.ts",
    tokens: [
      "allowedCapabilities: []",
      "allowedSecretReferences: []",
      'egress: { mode: "deny-all", allowedOrigins: [] }',
    ],
  },
  {
    rule: "capability-drift",
    path: "modules/application/services/asset-packs/system-foundation-functional-default-catalog.ts",
    tokens: ["requiredCapabilities: []"],
  },
  {
    rule: "capability-drift",
    path: "modules/application/services/system-deployment/system-deployment-policy.service.ts",
    tokens: ["validateNarrowing(", "authorizeRun("],
  },
  {
    rule: "admission-source-drift",
    path: "modules/adapters/package/aisb/createAisbPackageInspector.ts",
    tokens: [
      "maxPackageBytes: 32 * 1024 * 1024",
      "maxEntries: 128",
      "maxEntryBytes: 8 * 1024 * 1024",
      "maxExpandedBytes: 64 * 1024 * 1024",
      "const MAX_CAPABILITIES = 64",
      "const MAX_DEPENDENCIES = 256",
      "const MAX_DEFINITIONS = 5_000",
      "const MAX_IMPLEMENTATIONS = 5_000",
      "const MAX_FACETS_PER_IMPLEMENTATION = 16",
    ],
  },
  {
    rule: "admission-source-drift",
    path: "modules/application/use-cases/system-build/system-build-use-cases.ts",
    tokens: [
      "const MAX_DIAGNOSTICS = 200",
      "const MAX_SYSTEM_INSTANCES = 5_000",
    ],
  },
  {
    rule: "admission-source-drift",
    path: "modules/application/services/system-review/release-bound-system-review-definition.service.ts",
    tokens: ["1,\n        200", "1_024,\n        8_388_608"],
  },
  {
    rule: "admission-source-drift",
    path: "modules/application/services/system-builder/system-builder-reference-template-registry.service.ts",
    tokens: ["maximumPreviewBytes: 2_097_152"],
  },
  {
    rule: "admission-source-drift",
    path: "modules/application/use-cases/system-review/system-review-use-cases.ts",
    tokens: [
      "const MAX_TABLE_ROWS = 25",
      "const MAX_TABLE_COLUMNS = 20",
      "const MAX_CELL_CHARS = 1_000",
      "firstLines.slice(0, 16_000)",
    ],
  },
  {
    rule: "admission-source-drift",
    path: "modules/application/use-cases/system-deployment/system-deployment-use-cases.ts",
    tokens: ["const MAX_MANIFEST_BYTES = 8 * 1024 * 1024"],
  },
  {
    rule: "admission-source-drift",
    path: "modules/hosts/shared/composition/composeSystemDeployment.ts",
    tokens: [
      "maximumRunSeconds: 300",
      "maximumMemoryMiB: 512",
      "maximumOutputBytes: 1024 * 1024",
      "maximumConcurrentRuns: 4",
    ],
  },
];

const admissionExpectations = {
  package: {
    maximumPackageBytes: 33_554_432,
    maximumEntries: 128,
    maximumEntryBytes: 8_388_608,
    maximumExpandedBytes: 67_108_864,
    maximumDefinitions: 5_000,
    maximumImplementations: 5_000,
    maximumFacetsPerImplementation: 16,
    maximumCapabilities: 64,
    maximumDependencies: 256,
  },
  build: { maximumInstances: 5_000, maximumDiagnostics: 200 },
  preview: {
    maximumPreviewBytes: 8_388_608,
    referencePreviewBytes: 2_097_152,
    maximumListItems: 200,
    maximumRows: 25,
    maximumColumns: 20,
    maximumCellCharacters: 1_000,
    maximumTextCharacters: 16_000,
  },
  "release-manifest": {
    maximumManifestBytes: 8_388_608,
    maximumInstances: 5_000,
  },
  execution: {
    maximumRunSeconds: 300,
    maximumMemoryMiB: 512,
    maximumOutputBytes: 1_048_576,
    maximumConcurrentRuns: 4,
  },
};

export function findAssetSystemFitnessViolations({
  repoRoot = defaultRepoRoot,
  files = readProductionFiles(repoRoot),
  qualificationConfig = readAssetSystemQualificationConfig(
    path.resolve(repoRoot, "dev-tools/config/asset-system-qualification.json"),
  ),
} = {}) {
  const violations = [
    ...findExecutableMetadataViolations(files),
    ...findRendererBoundaryViolations(files),
    ...findRoutePolicyViolations(files),
    ...findRequiredAnchorViolations(files),
    ...findAdmissionDriftViolations(qualificationConfig),
  ];
  return violations.sort((left, right) =>
    `${left.rule}:${left.path}:${left.detail}`.localeCompare(
      `${right.rule}:${right.path}:${right.detail}`,
    ),
  );
}

export function findExecutableMetadataViolations(files) {
  const violations = [];
  for (const [filePath, contents] of files) {
    if (
      filePath.startsWith("modules/contracts/asset/") &&
      !filePath.includes("/tests/") &&
      forbiddenMetadataProperty.test(contents)
    )
      violations.push({
        rule: "executable-metadata",
        path: filePath,
        detail: "Asset Kernel metadata declares an executable payload field.",
      });
  }
  return violations;
}

export function findRendererBoundaryViolations(files) {
  const violations = [];
  for (const [filePath, contents] of files) {
    if (
      !rendererPrefixes.some((prefix) => filePath.startsWith(prefix)) ||
      filePath.includes("/tests/")
    )
      continue;
    for (const specifier of extractSpecifiers(contents)) {
      if (!specifier.startsWith(".")) continue;
      const target = path.posix.normalize(
        path.posix.join(path.posix.dirname(filePath), specifier),
      );
      if (privilegedPrefixes.some((prefix) => target.startsWith(prefix)))
        violations.push({
          rule: "renderer-boundary",
          path: filePath,
          detail: `Renderer import '${specifier}' reaches privileged source '${target}'.`,
        });
    }
  }
  return violations;
}

export function findRoutePolicyViolations(files) {
  const policyPath =
    "modules/adapters/transport/api-express/security/apiRouteSecurityPolicy.ts";
  const policy = files.get(policyPath) ?? "";
  const registered = new Set();
  for (const [filePath, contents] of files) {
    if (
      !routePrefixes.some((prefix) => filePath.startsWith(prefix)) ||
      filePath.includes("/tests/")
    )
      continue;
    const pattern = /\.(get|post|delete|patch)\(\s*["'](\/api\/[^"']+)["']/gi;
    for (const match of contents.matchAll(pattern))
      registered.add(`${match[1].toUpperCase()} ${match[2]}`);
  }
  return [...registered]
    .filter((route) => !policy.includes(`"${route}"`))
    .map((route) => ({
      rule: "route-policy",
      path: policyPath,
      detail: `Registered asset/system route '${route}' has no explicit security policy.`,
    }));
}

export function findRequiredAnchorViolations(files) {
  return requiredAnchors.flatMap((anchor) => {
    const contents = files.get(anchor.path) ?? "";
    return anchor.tokens
      .filter((token) => !contents.includes(token))
      .map((token) => ({
        rule: anchor.rule,
        path: anchor.path,
        detail: `Required invariant anchor is missing: ${token}`,
      }));
  });
}

export function findAdmissionDriftViolations(config) {
  const actual = new Map(
    config.admissionControls.map((control) => [control.id, control.limits]),
  );
  return Object.entries(admissionExpectations).flatMap(([id, expected]) =>
    Object.entries(expected)
      .filter(([key, value]) => actual.get(id)?.[key] !== value)
      .map(([key, value]) => ({
        rule: "admission-drift",
        path: "dev-tools/config/asset-system-qualification.json",
        detail: `${id}.${key} must remain aligned at ${value}.`,
      })),
  );
}

export function buildAssetSystemFitnessViolationMessage(violations) {
  return [
    "Asset/system architecture fitness check failed.",
    "Rules: docs/architecture/architecture-verification.md",
    "",
    ...violations.map(
      (violation) =>
        `- [${violation.rule}] ${violation.path}: ${violation.detail}`,
    ),
  ].join("\n");
}

function readProductionFiles(repoRoot) {
  const files = new Map();
  for (const prefix of ["apps", "modules", "dev-tools/config"]) {
    const root = path.resolve(repoRoot, prefix);
    if (!isDirectory(root)) continue;
    walk(root, (absolutePath) => {
      if (!/\.(?:ts|tsx|json)$/i.test(absolutePath)) return;
      const relativePath = path
        .relative(repoRoot, absolutePath)
        .split(path.sep)
        .join("/");
      files.set(relativePath, readFileSync(absolutePath, "utf8"));
    });
  }
  return files;
}

function walk(directory, visit) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (["node_modules", ".git", "artifacts"].includes(entry.name)) continue;
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) walk(absolutePath, visit);
    else visit(absolutePath);
  }
}

function extractSpecifiers(contents) {
  return [
    ...contents.matchAll(/(?:from\s+|import\s*\()\s*["']([^"']+)["']/g),
  ].map((match) => match[1]);
}

function isDirectory(value) {
  try {
    return statSync(value).isDirectory();
  } catch {
    return false;
  }
}
