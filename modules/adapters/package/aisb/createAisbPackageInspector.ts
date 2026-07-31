import { createHash } from "node:crypto";

import type { AssetPackageInspectorPort } from "../../../application/ports/asset-package";
import { validateAssetPackManifest } from "../../../application/services/asset-packs";
import {
  ASSET_PACKAGE_FORMAT_VERSION,
  ASSET_PACKAGE_MEDIA_TYPE,
  type AssetPackageContainerV1,
  type AssetPackageInspectionIssue,
} from "../../../contracts/asset-package";
import {
  ASSET_IMPLEMENTATION_DEPLOYMENT_PROFILES,
  ASSET_IMPLEMENTATION_FACET_KINDS,
  ASSET_IMPLEMENTATION_RUNTIME_KINDS,
  normalizeSha256Digest,
} from "../../../contracts/asset-implementation";

const PACKAGE_ID = /^[a-z0-9][a-z0-9.-]{2,159}$/;
const VERSION =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?$/;
const CAPABILITY = /^[a-z][a-z0-9.-]{1,79}$/;
const BASE64 =
  /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
const SAFE_MEDIA_TYPES = new Set([
  "application/json",
  "application/javascript",
  "application/wasm",
  "application/spdx+json",
  "application/vnd.cyclonedx+json",
  "application/vnd.in-toto+json",
  "application/vnd.dev.sigstore.bundle.v0.3+json",
  "text/css",
  "text/plain",
  "application/octet-stream",
]);
const DEVICE_SEGMENT = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i;
const MAX_CAPABILITIES = 64;
const MAX_DEPENDENCIES = 256;
const MAX_DEFINITIONS = 5_000;
const MAX_IMPLEMENTATIONS = 5_000;
const MAX_FACETS_PER_IMPLEMENTATION = 16;

export interface AisbPackageInspectionLimits {
  readonly maxPackageBytes: number;
  readonly maxEntries: number;
  readonly maxEntryBytes: number;
  readonly maxExpandedBytes: number;
}

const DEFAULT_LIMITS: AisbPackageInspectionLimits = {
  maxPackageBytes: 32 * 1024 * 1024,
  maxEntries: 128,
  maxEntryBytes: 8 * 1024 * 1024,
  maxExpandedBytes: 64 * 1024 * 1024,
};

export function createAisbPackageInspector(
  configured: Partial<AisbPackageInspectionLimits> = {},
): AssetPackageInspectorPort {
  const limits = { ...DEFAULT_LIMITS, ...configured };
  return {
    async inspect(input) {
      const issues: AssetPackageInspectionIssue[] = [];
      if (input.bytes.byteLength > limits.maxPackageBytes) {
        issues.push(
          issue(
            "error",
            "package.size.exceeded",
            "Package upload exceeds the inspection limit.",
          ),
        );
        return empty(input, digest(input.bytes), issues);
      }

      let candidate: unknown;
      try {
        candidate = JSON.parse(
          new TextDecoder("utf-8", { fatal: true }).decode(input.bytes),
        );
      } catch {
        issues.push(
          issue(
            "error",
            "package.container.invalid",
            "Package container is not valid UTF-8 JSON.",
          ),
        );
        return empty(input, digest(input.bytes), issues);
      }
      if (!isRecord(candidate)) {
        issues.push(
          issue(
            "error",
            "package.container.invalid",
            "Package container must be an object.",
          ),
        );
        return empty(input, digest(input.bytes), issues);
      }

      const container = candidate as unknown as AssetPackageContainerV1;
      if (container.mediaType !== ASSET_PACKAGE_MEDIA_TYPE) {
        issues.push(
          issue(
            "error",
            "package.media-type.unsupported",
            "Package media type is unsupported.",
            "mediaType",
          ),
        );
      }
      if (!isRecord(container.manifest) || !Array.isArray(container.entries)) {
        issues.push(
          issue(
            "error",
            "package.shape.invalid",
            "Package manifest and entries are required.",
          ),
        );
        return empty(input, digest(input.bytes), issues);
      }

      const packageDigest = digestCanonical(container);
      validateManifest(container, issues);
      const decodedEntries = validateEntries(container, limits, issues);
      validateImplementationReferences(container, decodedEntries, issues);

      const semanticIssues = safelyValidateSemanticManifest(container);
      issues.push(...semanticIssues);
      if (
        container.manifest.semanticManifest?.sourceKind === "system" ||
        container.manifest.semanticManifest?.trustStatus === "system-trusted"
      ) {
        issues.push(
          issue(
            "error",
            "package.trust.claim-forbidden",
            "Imported packages cannot claim system trust.",
          ),
        );
      }

      const expandedSizeBytes = decodedEntries.reduce(
        (total, entry) => total + entry.bytes.byteLength,
        0,
      );
      const signatureStatus = container.signature ? "unverified" : "missing";
      const provenanceStatus = hasEntry(
        container.manifest.provenanceEntryPath,
        decodedEntries,
      )
        ? "unverified"
        : "missing";
      const sbomStatus = hasEntry(
        container.manifest.sbomEntryPath,
        decodedEntries,
      )
        ? "unverified"
        : "missing";
      const safeIssues = uniqueIssues(issues);
      return {
        container,
        entries: decodedEntries,
        summary: {
          inspectionId: input.inspectionId,
          workspaceId: input.workspaceId,
          packageDigest,
          packageId: safeText(container.manifest.packageId),
          version: safeText(container.manifest.version),
          displayName: safeText(container.manifest.displayName),
          publisher: safeText(container.manifest.publisher),
          formatVersion: safeText(container.manifest.formatVersion),
          definitionCount: Array.isArray(
            container.manifest.semanticManifest?.assets,
          )
            ? container.manifest.semanticManifest.assets.length
            : 0,
          implementationCount: Array.isArray(container.manifest.implementations)
            ? container.manifest.implementations.length
            : 0,
          entryCount: decodedEntries.length,
          expandedSizeBytes,
          requestedCapabilities: safeStringArray(
            container.manifest.requestedCapabilities,
          ),
          supportedDeploymentProfiles: Array.isArray(
            container.manifest.supportedDeploymentProfiles,
          )
            ? container.manifest.supportedDeploymentProfiles.filter((value) =>
                ASSET_IMPLEMENTATION_DEPLOYMENT_PROFILES.includes(value),
              )
            : [],
          signatureStatus,
          provenanceStatus,
          sbomStatus,
          conflicts: [],
          issues: safeIssues,
          eligibleForAdmission: !safeIssues.some(
            (entry) => entry.severity === "error",
          ),
          inspectedAt: input.inspectedAt,
        },
      };
    },
  };
}

function validateManifest(
  container: AssetPackageContainerV1,
  issues: AssetPackageInspectionIssue[],
): void {
  const manifest = container.manifest;
  if (manifest.formatVersion !== ASSET_PACKAGE_FORMAT_VERSION) {
    issues.push(
      issue(
        "error",
        "package.format.unsupported",
        "Package format version is unsupported.",
        "manifest.formatVersion",
      ),
    );
  }
  if (!PACKAGE_ID.test(String(manifest.packageId ?? ""))) {
    issues.push(
      issue(
        "error",
        "package.identity.invalid",
        "Package ID is invalid.",
        "manifest.packageId",
      ),
    );
  }
  if (!VERSION.test(String(manifest.version ?? ""))) {
    issues.push(
      issue(
        "error",
        "package.version.invalid",
        "Package version is invalid.",
        "manifest.version",
      ),
    );
  }
  if (!safeText(manifest.displayName) || manifest.displayName.length > 120) {
    issues.push(
      issue(
        "error",
        "package.display-name.invalid",
        "Package display name is invalid.",
        "manifest.displayName",
      ),
    );
  }
  if (
    manifest.semanticManifest?.packId !== manifest.packageId ||
    manifest.semanticManifest?.version !== manifest.version
  ) {
    issues.push(
      issue(
        "error",
        "package.manifest.identity-mismatch",
        "Semantic manifest identity must match package identity.",
      ),
    );
  }
  const capabilities = safeStringArray(manifest.requestedCapabilities);
  if (
    capabilities.length > MAX_CAPABILITIES ||
    capabilities.length !== new Set(capabilities).size ||
    capabilities.some((value) => !CAPABILITY.test(value))
  ) {
    issues.push(
      issue(
        "error",
        "package.capability.invalid",
        "Requested capabilities must be unique safe identifiers.",
      ),
    );
  }
  if (
    !Array.isArray(manifest.supportedDeploymentProfiles) ||
    manifest.supportedDeploymentProfiles.some(
      (value) => !ASSET_IMPLEMENTATION_DEPLOYMENT_PROFILES.includes(value),
    )
  ) {
    issues.push(
      issue(
        "error",
        "package.deployment-profile.unsupported",
        "Package contains an unsupported deployment profile.",
      ),
    );
  }
  const definitions = Array.isArray(manifest.semanticManifest?.assets)
    ? manifest.semanticManifest.assets
    : [];
  if (definitions.length > MAX_DEFINITIONS) {
    issues.push(
      issue(
        "error",
        "package.definition-count.exceeded",
        "Package contains too many definitions.",
      ),
    );
  }
  const implementations = Array.isArray(manifest.implementations)
    ? manifest.implementations
    : [];
  if (implementations.length > MAX_IMPLEMENTATIONS) {
    issues.push(
      issue(
        "error",
        "package.implementation-count.exceeded",
        "Package contains too many implementations.",
      ),
    );
  }
  const dependencies = Array.isArray(manifest.dependencies)
    ? manifest.dependencies
    : [];
  if (dependencies.length > MAX_DEPENDENCIES) {
    issues.push(
      issue(
        "error",
        "package.dependency-count.exceeded",
        "Package contains too many dependencies.",
      ),
    );
  }
  for (const dependency of dependencies.slice(0, MAX_DEPENDENCIES)) {
    if (
      !PACKAGE_ID.test(String(dependency.packageId ?? "")) ||
      !/^[~^<>=*0-9A-Za-z .|,-]+$/.test(String(dependency.versionRange ?? ""))
    ) {
      issues.push(
        issue(
          "error",
          "package.dependency.invalid",
          "Package dependency declaration is invalid.",
        ),
      );
    }
  }
}

function validateEntries(
  container: AssetPackageContainerV1,
  limits: AisbPackageInspectionLimits,
  issues: AssetPackageInspectionIssue[],
) {
  if (container.entries.length > limits.maxEntries) {
    issues.push(
      issue(
        "error",
        "package.entry-count.exceeded",
        "Package contains too many entries.",
      ),
    );
  }
  const paths = new Set<string>();
  const result: { path: string; mediaType: string; bytes: Uint8Array }[] = [];
  let total = 0;
  for (const [index, entry] of container.entries
    .slice(0, limits.maxEntries)
    .entries()) {
    const path = normalizeEntryPath(entry.path);
    const issuePath = `entries.${index}`;
    if (!path) {
      issues.push(
        issue(
          "error",
          "package.entry.path-unsafe",
          "Package entry path is unsafe.",
          `${issuePath}.path`,
        ),
      );
      continue;
    }
    const collisionKey = path.toLowerCase();
    if (paths.has(collisionKey)) {
      issues.push(
        issue(
          "error",
          "package.entry.path-duplicate",
          "Package contains duplicate normalized entry paths.",
          `${issuePath}.path`,
        ),
      );
      continue;
    }
    paths.add(collisionKey);
    if (!SAFE_MEDIA_TYPES.has(entry.mediaType)) {
      issues.push(
        issue(
          "error",
          "package.entry.media-type-unsupported",
          "Package entry media type is unsupported.",
          `${issuePath}.mediaType`,
        ),
      );
      continue;
    }
    if (
      typeof entry.contentBase64 !== "string" ||
      !BASE64.test(entry.contentBase64)
    ) {
      issues.push(
        issue(
          "error",
          "package.entry.encoding-invalid",
          "Package entry encoding is invalid.",
          `${issuePath}.contentBase64`,
        ),
      );
      continue;
    }
    const bytes = Buffer.from(entry.contentBase64, "base64");
    total += bytes.byteLength;
    if (
      bytes.byteLength > limits.maxEntryBytes ||
      total > limits.maxExpandedBytes
    ) {
      issues.push(
        issue(
          "error",
          "package.entry.size-exceeded",
          "Package expanded content exceeds inspection limits.",
          issuePath,
        ),
      );
      continue;
    }
    if (entry.sizeBytes !== bytes.byteLength) {
      issues.push(
        issue(
          "error",
          "package.entry.size-mismatch",
          "Package entry size does not match its descriptor.",
          issuePath,
        ),
      );
      continue;
    }
    const actualDigest = digest(bytes);
    try {
      if (normalizeSha256Digest(entry.digest) !== actualDigest) {
        issues.push(
          issue(
            "error",
            "package.entry.digest-mismatch",
            "Package entry digest verification failed.",
            issuePath,
          ),
        );
        continue;
      }
    } catch {
      issues.push(
        issue(
          "error",
          "package.entry.digest-invalid",
          "Package entry digest is invalid.",
          issuePath,
        ),
      );
      continue;
    }
    result.push({ path, mediaType: entry.mediaType, bytes });
  }
  return result;
}

function validateImplementationReferences(
  container: AssetPackageContainerV1,
  entries: readonly { path: string }[],
  issues: AssetPackageInspectionIssue[],
): void {
  const definitionRefs = new Set(
    (container.manifest.semanticManifest?.assets ?? []).map(
      (entry) =>
        `${entry.definitionRef.id}@${entry.definitionRef.version ?? ""}`,
    ),
  );
  const releaseIds = new Set<string>();
  const implementations = Array.isArray(container.manifest.implementations)
    ? container.manifest.implementations
    : [];
  for (const implementation of implementations.slice(0, MAX_IMPLEMENTATIONS)) {
    if (releaseIds.has(String(implementation.releaseId))) {
      issues.push(
        issue(
          "error",
          "package.implementation.duplicate",
          "Package implementation release IDs must be unique.",
        ),
      );
    }
    releaseIds.add(String(implementation.releaseId));
    if (
      !definitionRefs.has(
        `${implementation.definitionRef.id}@${implementation.definitionRef.version ?? ""}`,
      )
    ) {
      issues.push(
        issue(
          "error",
          "package.implementation.definition-missing",
          "Implementation must reference a definition in the package.",
        ),
      );
    }
    const facets = Array.isArray(implementation.facets)
      ? implementation.facets
      : [];
    if (facets.length > MAX_FACETS_PER_IMPLEMENTATION) {
      issues.push(
        issue(
          "error",
          "package.implementation.facet-count-exceeded",
          "Implementation contains too many facets.",
        ),
      );
    }
    for (const facet of facets.slice(0, MAX_FACETS_PER_IMPLEMENTATION)) {
      if (!ASSET_IMPLEMENTATION_FACET_KINDS.includes(facet.kind)) {
        issues.push(
          issue(
            "error",
            "package.implementation.facet-unsupported",
            "Implementation facet kind is unsupported.",
          ),
        );
      }
      if (
        !ASSET_IMPLEMENTATION_RUNTIME_KINDS.includes(facet.runtimeKind) ||
        facet.runtimeKind === "trusted-built-in"
      ) {
        issues.push(
          issue(
            "error",
            "package.implementation.runtime-unsupported",
            "Imported implementation runtime is unsupported.",
          ),
        );
      }
      if (
        facet.packageEntryPath &&
        !hasEntry(facet.packageEntryPath, entries)
      ) {
        issues.push(
          issue(
            "error",
            "package.implementation.entry-missing",
            "Implementation facet entry is missing.",
          ),
        );
      }
      const requiredCapabilities = safeStringArray(facet.requiredCapabilities);
      if (
        requiredCapabilities.length > MAX_CAPABILITIES ||
        requiredCapabilities.some((value) => !CAPABILITY.test(value))
      ) {
        issues.push(
          issue(
            "error",
            "package.implementation.capability-invalid",
            "Implementation capability identifier is invalid.",
          ),
        );
      }
    }
  }
  for (const path of [
    container.manifest.sbomEntryPath,
    container.manifest.provenanceEntryPath,
  ]) {
    if (path && !hasEntry(path, entries)) {
      issues.push(
        issue(
          "error",
          "package.evidence.entry-missing",
          "Declared package evidence entry is missing.",
        ),
      );
    }
  }
}

function safelyValidateSemanticManifest(
  container: AssetPackageContainerV1,
): AssetPackageInspectionIssue[] {
  try {
    return validateAssetPackManifest(
      container.manifest.semanticManifest,
    ).issues.map((entry) =>
      issue(
        entry.severity,
        `package.semantic.${entry.category}`,
        entry.message,
        entry.path?.join("."),
      ),
    );
  } catch {
    return [
      issue(
        "error",
        "package.semantic.invalid",
        "Semantic asset manifest is invalid.",
      ),
    ];
  }
}

function normalizeEntryPath(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length < 1 || value.length > 240)
    return undefined;
  if (value.includes("\\") || value.startsWith("/") || value.includes(":"))
    return undefined;
  const segments = value.split("/");
  if (
    segments.some(
      (segment) =>
        !segment ||
        segment === "." ||
        segment === ".." ||
        segment.endsWith(".") ||
        segment.endsWith(" ") ||
        DEVICE_SEGMENT.test(segment),
    )
  )
    return undefined;
  return segments.join("/");
}

function digest(value: Uint8Array): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function digestCanonical(
  container: AssetPackageContainerV1,
): `sha256:${string}` {
  const evidencePaths = new Set(
    [
      container.manifest.sbomEntryPath,
      container.manifest.provenanceEntryPath,
    ].filter((value): value is string => Boolean(value)),
  );
  const value = stableStringify({
    mediaType: container.mediaType,
    manifest: container.manifest,
    entries: container.entries.filter(
      (entry) => !evidencePaths.has(entry.path),
    ),
  });
  return digest(new TextEncoder().encode(value));
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (isRecord(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function hasEntry(
  path: string | undefined,
  entries: readonly { path: string }[],
): boolean {
  const normalized = normalizeEntryPath(path);
  return (
    normalized !== undefined &&
    entries.some((entry) => entry.path === normalized)
  );
}

function empty(
  input: { inspectionId: string; workspaceId: any; inspectedAt: string },
  packageDigest: `sha256:${string}`,
  issues: readonly AssetPackageInspectionIssue[],
) {
  return {
    entries: [],
    summary: {
      inspectionId: input.inspectionId,
      workspaceId: input.workspaceId,
      packageDigest,
      definitionCount: 0,
      implementationCount: 0,
      entryCount: 0,
      expandedSizeBytes: 0,
      requestedCapabilities: [],
      supportedDeploymentProfiles: [],
      signatureStatus: "missing" as const,
      provenanceStatus: "missing" as const,
      sbomStatus: "missing" as const,
      conflicts: [],
      issues,
      eligibleForAdmission: false,
      inspectedAt: input.inspectedAt,
    },
  };
}

function issue(
  severity: AssetPackageInspectionIssue["severity"],
  code: string,
  message: string,
  path?: string,
): AssetPackageInspectionIssue {
  return { severity, code, message, ...(path ? { path } : {}) };
}

function uniqueIssues(
  issues: readonly AssetPackageInspectionIssue[],
): readonly AssetPackageInspectionIssue[] {
  const seen = new Set<string>();
  return issues.filter((entry) => {
    const key = `${entry.severity}:${entry.code}:${entry.path ?? ""}:${entry.message}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function safeText(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  return normalized && normalized.length <= 160 ? normalized : undefined;
}

function safeStringArray(value: unknown): readonly string[] {
  return Array.isArray(value)
    ? value
        .filter((entry): entry is string => typeof entry === "string")
        .map((entry) => entry.trim())
        .filter(Boolean)
    : [];
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
