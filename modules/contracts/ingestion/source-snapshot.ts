import { createOrganizationId, type OrganizationId } from "../organization";
import { createWorkspaceId, type WorkspaceId } from "../workspace";
import { normalizeIngestionSha256Digest, type IngestionSha256Digest } from "./acquisition-task";

export type IngestionSourceId = string & { readonly __ingestionSourceId: unique symbol };
export type IngestionSourceSnapshotId = string & { readonly __ingestionSourceSnapshotId: unique symbol };
export type IngestionSourceRefreshId = string & { readonly __ingestionSourceRefreshId: unique symbol };
export type IngestionSourceRefreshOutcome = "unchanged" | "changed" | "unavailable" | "removed";

export interface IngestionSourceLocator {
  readonly kind: "file" | "hugging-face" | "website";
  readonly displayName: string;
  readonly originalName?: string;
  readonly repository?: string;
  readonly path?: string;
  readonly revision?: string;
  readonly requestedUrl?: string;
  readonly canonicalUrl?: string;
}

export interface IngestionSourceSnapshot {
  readonly schemaVersion: "1.0";
  readonly snapshotId: IngestionSourceSnapshotId;
  readonly sourceId: IngestionSourceId;
  readonly organizationId?: OrganizationId;
  readonly workspaceId: WorkspaceId;
  readonly locator: IngestionSourceLocator;
  readonly contentDigest?: IngestionSha256Digest;
  readonly sizeBytes: number;
  readonly mediaType: string;
  readonly rawArtifactKey: string;
  readonly derivedArtifactKeys?: readonly string[];
  readonly capturedAt: string;
  readonly previousSnapshotId?: IngestionSourceSnapshotId;
  readonly providerRevision?: string;
  readonly etag?: string;
  readonly lastModified?: string;
  readonly httpStatus?: number;
  readonly robots?: {
    readonly policyUrl: string;
    readonly checkedAt: string;
    readonly decision: "allowed";
  };
}

export interface IngestionSourceRefreshRecord {
  readonly schemaVersion: "1.0";
  readonly refreshId: IngestionSourceRefreshId;
  readonly sourceId: IngestionSourceId;
  readonly organizationId?: OrganizationId;
  readonly workspaceId: WorkspaceId;
  readonly outcome: IngestionSourceRefreshOutcome;
  readonly previousSnapshotId?: IngestionSourceSnapshotId;
  readonly currentSnapshotId?: IngestionSourceSnapshotId;
  readonly checkedAt: string;
  readonly summary: string;
}

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

export const normalizeIngestionSourceId = (value: string) => normalizeId(value, "Ingestion source id") as IngestionSourceId;
export const normalizeIngestionSourceSnapshotId = (value: string) => normalizeId(value, "Ingestion source snapshot id") as IngestionSourceSnapshotId;
export const normalizeIngestionSourceRefreshId = (value: string) => normalizeId(value, "Ingestion source refresh id") as IngestionSourceRefreshId;

export function normalizeIngestionSourceSnapshot(value: IngestionSourceSnapshot): IngestionSourceSnapshot {
  if (value.schemaVersion !== "1.0") throw new Error("Unsupported ingestion source snapshot schema version.");
  const locator = normalizeLocator(value.locator);
  const derivedArtifactKeys = value.derivedArtifactKeys?.map(storageKey);
  if (derivedArtifactKeys && (derivedArtifactKeys.length > 8 || new Set(derivedArtifactKeys).size !== derivedArtifactKeys.length)) throw new Error("Derived ingestion artifacts must be unique and bounded.");
  if (locator.kind === "hugging-face" && value.providerRevision !== locator.revision) throw new Error("Provider snapshots require the exact selected revision.");
  if (locator.kind !== "hugging-face" && !value.contentDigest) throw new Error("Local and website snapshots require a content digest.");
  if (locator.kind === "website" && !value.robots) throw new Error("Website snapshots require an allowed robots decision.");
  if (locator.kind !== "website" && (value.robots || value.httpStatus !== undefined || value.etag || value.lastModified)) throw new Error("HTTP evidence is only valid for website snapshots.");
  return {
    schemaVersion: "1.0",
    snapshotId: normalizeIngestionSourceSnapshotId(value.snapshotId),
    sourceId: normalizeIngestionSourceId(value.sourceId),
    ...(value.organizationId ? { organizationId: createOrganizationId(value.organizationId) } : {}),
    workspaceId: createWorkspaceId(value.workspaceId),
    locator,
    ...(value.contentDigest ? { contentDigest: normalizeIngestionSha256Digest(value.contentDigest) } : {}),
    sizeBytes: integer(value.sizeBytes, 0, 16 * 1024 * 1024 * 1024, "Source snapshot sizeBytes"),
    mediaType: text(value.mediaType, "Source snapshot mediaType", 128).toLowerCase(),
    rawArtifactKey: storageKey(value.rawArtifactKey),
    ...(derivedArtifactKeys?.length ? { derivedArtifactKeys } : {}),
    capturedAt: timestamp(value.capturedAt, "Source snapshot capturedAt"),
    ...(value.previousSnapshotId ? { previousSnapshotId: normalizeIngestionSourceSnapshotId(value.previousSnapshotId) } : {}),
    ...(value.providerRevision ? { providerRevision: text(value.providerRevision, "Provider revision", 160) } : {}),
    ...(value.etag ? { etag: safeValidator(value.etag, "ETag") } : {}),
    ...(value.lastModified ? { lastModified: safeValidator(value.lastModified, "Last-Modified") } : {}),
    ...(value.httpStatus !== undefined ? { httpStatus: integer(value.httpStatus, 100, 599, "HTTP status") } : {}),
    ...(value.robots ? { robots: { policyUrl: safeUrl(value.robots.policyUrl), checkedAt: timestamp(value.robots.checkedAt, "Robots checkedAt"), decision: "allowed" as const } } : {}),
  };
}

export function normalizeIngestionSourceRefreshRecord(value: IngestionSourceRefreshRecord): IngestionSourceRefreshRecord {
  if (value.schemaVersion !== "1.0") throw new Error("Unsupported source refresh schema version.");
  if (!(["unchanged", "changed", "unavailable", "removed"] as const).includes(value.outcome)) throw new Error("Unsupported source refresh outcome.");
  if (value.outcome === "changed" && (!value.previousSnapshotId || !value.currentSnapshotId || value.previousSnapshotId === value.currentSnapshotId)) throw new Error("Changed refreshes require distinct previous and current snapshots.");
  if (value.outcome === "unchanged" && (!value.previousSnapshotId || value.currentSnapshotId !== value.previousSnapshotId)) throw new Error("Unchanged refreshes must retain the previous snapshot.");
  if ((value.outcome === "unavailable" || value.outcome === "removed") && value.currentSnapshotId) throw new Error("Unavailable or removed refreshes cannot create a snapshot.");
  return {
    schemaVersion: "1.0",
    refreshId: normalizeIngestionSourceRefreshId(value.refreshId),
    sourceId: normalizeIngestionSourceId(value.sourceId),
    ...(value.organizationId ? { organizationId: createOrganizationId(value.organizationId) } : {}),
    workspaceId: createWorkspaceId(value.workspaceId),
    outcome: value.outcome,
    ...(value.previousSnapshotId ? { previousSnapshotId: normalizeIngestionSourceSnapshotId(value.previousSnapshotId) } : {}),
    ...(value.currentSnapshotId ? { currentSnapshotId: normalizeIngestionSourceSnapshotId(value.currentSnapshotId) } : {}),
    checkedAt: timestamp(value.checkedAt, "Source refresh checkedAt"),
    summary: text(value.summary, "Source refresh summary", 240),
  };
}

function normalizeLocator(value: IngestionSourceLocator): IngestionSourceLocator {
  if (!(["file", "hugging-face", "website"] as const).includes(value.kind)) throw new Error("Unsupported ingestion source locator kind.");
  const displayName = text(value.displayName, "Source display name", 255);
  if (value.kind === "file") return { kind: "file", displayName, originalName: baseName(value.originalName ?? displayName) };
  if (value.kind === "hugging-face") return { kind: "hugging-face", displayName, repository: repository(value.repository), path: providerPath(value.path), revision: providerRevision(value.revision) };
  return { kind: "website", displayName, requestedUrl: safeUrl(value.requestedUrl ?? ""), canonicalUrl: safeUrl(value.canonicalUrl ?? "") };
}

function safeUrl(value: string): string {
  const normalized = text(value, "Website URL", 2048);
  const parsed = new URL(normalized);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new Error("Website URL must use HTTP or HTTPS.");
  if (parsed.username || parsed.password) throw new Error("Website URL must not include credentials.");
  parsed.hash = "";
  return parsed.toString();
}
function repository(value?: string): string {
  const normalized = text(value ?? "", "Provider repository", 200);
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}\/[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/.test(normalized)) throw new Error("Provider repository must use owner/name format.");
  return normalized;
}
function providerPath(value?: string): string {
  const normalized = text(value ?? "", "Provider path", 512).replaceAll("\\", "/");
  if (normalized.startsWith("/") || normalized.split("/").some((part) => !part || part === "." || part === "..")) throw new Error("Provider path must be contained.");
  return normalized;
}
function providerRevision(value?: string): string {
  const normalized = text(value ?? "", "Provider revision", 64).toLowerCase();
  if (!/^[a-f0-9]{7,64}$/.test(normalized)) throw new Error("Provider revision must be an immutable commit SHA.");
  return normalized;
}
function storageKey(value: string): string { return providerPath(value); }
function baseName(value: string): string {
  const normalized = text(value, "Source file name", 255);
  if (/[\\/\u0000-\u001f]/.test(normalized) || normalized === "." || normalized === "..") throw new Error("Source file name must not contain a path.");
  return normalized;
}
function safeValidator(value: string, label: string): string {
  const normalized = text(value, label, 512);
  if (/\r|\n|authorization|cookie/i.test(normalized)) throw new Error(`${label} contains unsafe data.`);
  return normalized;
}
function normalizeId(value: string, label: string): string { const normalized = String(value).trim(); if (!ID_PATTERN.test(normalized)) throw new Error(`${label} must be a bounded opaque identifier.`); return normalized; }
function text(value: string, label: string, maximum: number): string { const normalized = String(value).trim(); if (!normalized || normalized.length > maximum) throw new Error(`${label} must contain 1 through ${maximum} characters.`); return normalized; }
function integer(value: number, minimum: number, maximum: number, label: string): number { if (!Number.isSafeInteger(value) || value < minimum || value > maximum) throw new Error(`${label} must be an integer from ${minimum} through ${maximum}.`); return value; }
function timestamp(value: string, label: string): string { const normalized = text(value, label, 64); if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(normalized) || Number.isNaN(Date.parse(normalized))) throw new Error(`${label} must be an ISO-8601 UTC timestamp.`); return normalized; }
