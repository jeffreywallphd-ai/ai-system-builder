import {
  normalizeAssetId,
  normalizeAssetReferenceKind,
  normalizeAssetVersion,
  type AssetReference,
} from "../asset";
import { ASSET_STUDIO_LIMITS } from "../asset-studio";
import { createWorkspaceId } from "../workspace";
import {
  ASSET_IMPLEMENTATION_BACKING_RESOURCE_MEDIA_TYPE,
  ASSET_IMPLEMENTATION_BACKING_RESOURCE_ORIGINS,
  ASSET_IMPLEMENTATION_BACKING_RESOURCE_ROLES,
  type AssetImplementationBackingResourceBundleV1,
  type AssetImplementationBackingResourceFile,
  type AssetImplementationBackingResourceFileDescriptor,
  type AssetImplementationBackingResourceOrigin,
  type AssetImplementationBackingResourceRecord,
  type AssetImplementationBackingResourceRole,
} from "./asset-implementation-backing-resource";
import {
  normalizeAssetImplementationReleaseId,
  normalizeAssetSourceSnapshotId,
} from "./asset-implementation-identity";
import { normalizeAssetImplementationArtifactDescriptor } from "./asset-implementation-normalization";

const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,159}$/;
const SAFE_PATH_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const ALLOWED_FILE = /\.(?:ts|tsx|js|jsx|json|css|scss|html|md)$/i;
const EDITABLE_FILE = /\.(?:ts|tsx|json|css|md)$/i;
const SECRET_PATTERNS = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/i,
  /\b(?:api[_-]?key|access[_-]?token|client[_-]?secret|password)\s*[:=]\s*["'][^"']{8,}["']/i,
  /\b(?:sk|ghp|github_pat|hf)_[A-Za-z0-9_-]{16,}\b/,
];

function safeId(value: unknown, label: string): string {
  if (typeof value !== "string" || !SAFE_ID.test(value)) {
    throw new Error(`${label} is invalid.`);
  }
  return value;
}

function timestamp(value: unknown): string {
  if (
    typeof value !== "string" ||
    value !== value.trim() ||
    !Number.isFinite(Date.parse(value))
  ) {
    throw new Error("Backing resource timestamp is invalid.");
  }
  return value;
}

function exactDefinitionRef(value: AssetReference): AssetReference {
  if (
    normalizeAssetReferenceKind(value.kind) !== "asset-definition-version" ||
    value.version === undefined
  ) {
    throw new Error("Backing resources require an exact definition reference.");
  }
  return {
    kind: "asset-definition-version",
    id: normalizeAssetId(String(value.id)),
    version: normalizeAssetVersion(value.version),
  };
}

export function normalizeAssetImplementationBackingResourceRole(
  value: string,
): AssetImplementationBackingResourceRole {
  const normalized = value
    .trim()
    .toLowerCase() as AssetImplementationBackingResourceRole;
  if (!ASSET_IMPLEMENTATION_BACKING_RESOURCE_ROLES.includes(normalized)) {
    throw new Error("Backing resource role is unsupported.");
  }
  return normalized;
}

export function normalizeAssetImplementationBackingResourceOrigin(
  value: string,
): AssetImplementationBackingResourceOrigin {
  const normalized = value
    .trim()
    .toLowerCase() as AssetImplementationBackingResourceOrigin;
  if (!ASSET_IMPLEMENTATION_BACKING_RESOURCE_ORIGINS.includes(normalized)) {
    throw new Error("Backing resource origin is unsupported.");
  }
  return normalized;
}

export function normalizeAssetImplementationBackingResourcePath(
  value: string,
): string {
  const path = value.replace(/\\/g, "/");
  const segments = path.split("/");
  if (
    !path ||
    path !== value.trim().replace(/\\/g, "/") ||
    path.length > 240 ||
    path.startsWith("/") ||
    /^[A-Za-z]:/.test(path) ||
    !ALLOWED_FILE.test(path) ||
    !segments.every(
      (segment) =>
        SAFE_PATH_SEGMENT.test(segment) && segment !== "." && segment !== "..",
    ) ||
    segments.some((segment) =>
      ["node_modules", ".git", ".env"].includes(segment.toLowerCase()),
    )
  ) {
    throw new Error("Backing resource path is invalid.");
  }
  return path;
}

function normalizeFile(
  value: AssetImplementationBackingResourceFile,
): AssetImplementationBackingResourceFile {
  const path = normalizeAssetImplementationBackingResourcePath(value.path);
  if (
    typeof value.mediaType !== "string" ||
    value.mediaType !== value.mediaType.trim() ||
    !value.mediaType.includes("/") ||
    value.mediaType.length > 120 ||
    typeof value.content !== "string" ||
    value.content.length > ASSET_STUDIO_LIMITS.maxFileCharacters ||
    value.content.includes("\0") ||
    SECRET_PATTERNS.some((pattern) => pattern.test(value.content))
  ) {
    throw new Error("Backing resource file is invalid.");
  }
  return {
    path,
    role: normalizeAssetImplementationBackingResourceRole(value.role),
    mediaType: value.mediaType,
    content: value.content,
  };
}

export function normalizeAssetImplementationBackingResourceBundle(
  value: AssetImplementationBackingResourceBundleV1,
): AssetImplementationBackingResourceBundleV1 {
  if (value.formatVersion !== "1.0" || !Array.isArray(value.files)) {
    throw new Error("Backing resource bundle is invalid.");
  }
  if (
    value.files.length < 1 ||
    value.files.length > ASSET_STUDIO_LIMITS.maxFiles
  ) {
    throw new Error("Backing resource file count is invalid.");
  }
  const files = value.files.map(normalizeFile);
  const folded = files.map((file) => file.path.toLowerCase());
  if (new Set(folded).size !== folded.length) {
    throw new Error("Backing resource file paths must be unique.");
  }
  if (
    files.reduce((total, file) => total + file.content.length, 0) >
    ASSET_STUDIO_LIMITS.maxTotalSourceCharacters
  ) {
    throw new Error("Backing resource content exceeds the aggregate limit.");
  }
  return { formatVersion: "1.0", files };
}

export function describeAssetImplementationBackingResourceFiles(
  value: AssetImplementationBackingResourceBundleV1,
): readonly AssetImplementationBackingResourceFileDescriptor[] {
  return normalizeAssetImplementationBackingResourceBundle(value).files.map(
    (file) => ({
      path: file.path,
      role: file.role,
      mediaType: file.mediaType,
      sizeCharacters: file.content.length,
      editable:
        EDITABLE_FILE.test(file.path) &&
        file.path.toLowerCase() !== "other/definition.json",
    }),
  );
}

export function normalizeAssetImplementationBackingResourceRecord(
  value: AssetImplementationBackingResourceRecord,
): AssetImplementationBackingResourceRecord {
  if (value.scope !== "system" && value.scope !== "workspace") {
    throw new Error("Backing resource scope is invalid.");
  }
  const workspaceId =
    value.workspaceId === undefined
      ? undefined
      : createWorkspaceId(value.workspaceId);
  if (
    (value.scope === "system" && workspaceId !== undefined) ||
    (value.scope === "workspace" && workspaceId === undefined)
  ) {
    throw new Error("Backing resource workspace scope is inconsistent.");
  }
  const artifact = normalizeAssetImplementationArtifactDescriptor(
    value.artifact,
  );
  if (
    artifact.kind !== "source" ||
    artifact.mediaType !== ASSET_IMPLEMENTATION_BACKING_RESOURCE_MEDIA_TYPE
  ) {
    throw new Error("Backing resource artifact is invalid.");
  }
  const files = value.files.map((file) => ({
    path: normalizeAssetImplementationBackingResourcePath(file.path),
    role: normalizeAssetImplementationBackingResourceRole(file.role),
    mediaType: file.mediaType.trim(),
    sizeCharacters: file.sizeCharacters,
    editable: file.editable,
  }));
  if (
    files.length < 1 ||
    files.some(
      (file) =>
        !file.mediaType.includes("/") ||
        !Number.isSafeInteger(file.sizeCharacters) ||
        file.sizeCharacters < 0 ||
        typeof file.editable !== "boolean",
    ) ||
    new Set(files.map((file) => file.path.toLowerCase())).size !== files.length
  ) {
    throw new Error("Backing resource descriptors are invalid.");
  }
  return {
    backingResourceId: safeId(
      value.backingResourceId,
      "Backing resource id",
    ),
    origin: normalizeAssetImplementationBackingResourceOrigin(value.origin),
    releaseId: normalizeAssetImplementationReleaseId(value.releaseId),
    definitionRef: exactDefinitionRef(value.definitionRef),
    scope: value.scope,
    ...(workspaceId === undefined ? {} : { workspaceId }),
    artifactWorkspaceId: createWorkspaceId(value.artifactWorkspaceId),
    sourceSnapshotId: normalizeAssetSourceSnapshotId(value.sourceSnapshotId),
    artifact,
    files,
    createdAt: timestamp(value.createdAt),
    createdBy: safeId(value.createdBy, "Backing resource creator"),
  };
}
