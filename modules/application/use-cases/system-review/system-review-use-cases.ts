import type { ArtifactBrowserMetadataReadPort } from "../../ports/artifact-browser";
import type { ArtifactContentRetrievalPort } from "../../ports/artifact-content";
import type {
  SystemReviewAuditRepositoryPort,
  SystemReviewReleaseDefinitionPort,
  SystemReviewResolvedDefinition,
} from "../../ports/system-review";
import type {
  ArtifactBrowseItem,
  ArtifactDetailReadModel,
} from "../../../contracts/artifact-browser";
import {
  systemReviewFailure,
  systemReviewSuccess,
  type BrowseSystemReviewArtifactsQuery,
  type DescribeSystemReviewQuery,
  type ListSystemReviewAuditQuery,
  type PreviewSystemReviewArtifactQuery,
  type ReadSystemReviewArtifactQuery,
  type SystemReviewAction,
  type SystemReviewArtifactDetail,
  type SystemReviewArtifactPage,
  type SystemReviewArtifactSummary,
  type SystemReviewAuditEntry,
  type SystemReviewAuditOutcome,
  type SystemReviewDescriptor,
  type SystemReviewMetadataValue,
  type SystemReviewPreview,
  type SystemReviewPrincipal,
  type SystemReviewResult,
  type SystemReviewTable,
} from "../../../contracts/system-review";

const SAFE_ID = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,159}$/;
const MAX_AUDIT_ITEMS = 200;
const MAX_TABLE_ROWS = 25;
const MAX_TABLE_COLUMNS = 20;
const MAX_CELL_CHARS = 1_000;
const ALWAYS_REDACTED_METADATA =
  /(path|locator|provider|checksum|token|secret|credential|password|storagekey)/i;

export interface ReleaseBoundSystemReviewDependencies {
  readonly definitions: SystemReviewReleaseDefinitionPort;
  readonly artifacts: ArtifactBrowserMetadataReadPort;
  readonly content: ArtifactContentRetrievalPort;
  readonly audit: SystemReviewAuditRepositoryPort;
  readonly generateAuditId: () => string;
  readonly now?: () => string;
}

interface ResolvedArtifact {
  readonly item: ArtifactBrowseItem;
  readonly artifactRef: string;
}

export class ReleaseBoundSystemReviewUseCases {
  private readonly now: () => string;

  public constructor(
    private readonly dependencies: ReleaseBoundSystemReviewDependencies,
  ) {
    this.now = dependencies.now ?? (() => new Date().toISOString());
  }

  public async describe(
    query: DescribeSystemReviewQuery,
  ): Promise<SystemReviewResult<SystemReviewDescriptor>> {
    const definition = await this.definition(query);
    if (!definition) return unavailable();
    if (!authorized(query.principal, definition)) {
      await this.audit(query, "describe", "denied");
      return denied();
    }
    if (!(await this.audit(query, "describe", "allowed")))
      return auditUnavailable();
    return systemReviewSuccess(definition.descriptor);
  }

  public async browse(
    query: BrowseSystemReviewArtifactsQuery,
  ): Promise<SystemReviewResult<SystemReviewArtifactPage>> {
    const definition = await this.definition(query);
    if (!definition) return unavailable();
    if (!authorized(query.principal, definition)) {
      await this.audit(query, "browse", "denied");
      return denied();
    }
    const browse = await this.dependencies.artifacts.browseArtifacts(
      {},
      { workspaceId: query.workspaceId },
    );
    if (!browse.ok) {
      await this.audit(query, "browse", "unavailable");
      return systemReviewFailure(
        "system-review.artifacts-unavailable",
        "Authorized artifacts are unavailable.",
      );
    }
    const nameQuery = safeQuery(query.nameQuery);
    const summaries = browse.value.items
      .map(toResolvedArtifact)
      .map(({ item, artifactRef }) => summary(item, artifactRef))
      .filter(
        (item) =>
          !nameQuery || item.displayName.toLowerCase().includes(nameQuery),
      );
    const limit = clampInteger(
      query.limit,
      1,
      definition.descriptor.maximumListItems,
      25,
    );
    if (!(await this.audit(query, "browse", "allowed")))
      return auditUnavailable();
    return systemReviewSuccess({
      items: summaries.slice(0, limit),
      total: summaries.length,
      limit,
    });
  }

  public async detail(
    query: ReadSystemReviewArtifactQuery,
  ): Promise<SystemReviewResult<SystemReviewArtifactDetail>> {
    const definition = await this.definition(query);
    if (!definition) return unavailable();
    if (!authorized(query.principal, definition)) {
      await this.audit(
        query,
        "detail",
        "denied",
        safeArtifactRef(query.artifactRef),
      );
      return denied();
    }
    const resolved = await this.resolveArtifact(query, query.artifactRef);
    if (!resolved) {
      await this.audit(
        query,
        "detail",
        "unavailable",
        safeArtifactRef(query.artifactRef),
      );
      return notFound();
    }
    const read = await this.dependencies.artifacts.readArtifactDetail(
      { locator: { storageKey: resolved.item.storageKey } },
      { workspaceId: query.workspaceId },
    );
    if (!read.ok) {
      await this.audit(query, "detail", "unavailable", resolved.artifactRef);
      return notFound();
    }
    const value = detail(
      read.value.artifact,
      resolved.artifactRef,
      definition,
      query.principal,
    );
    if (!(await this.audit(query, "detail", "allowed", resolved.artifactRef)))
      return auditUnavailable();
    return systemReviewSuccess(value);
  }

  public async preview(
    query: PreviewSystemReviewArtifactQuery,
  ): Promise<SystemReviewResult<SystemReviewPreview>> {
    const definition = await this.definition(query);
    if (!definition) return unavailable();
    if (!authorized(query.principal, definition)) {
      await this.audit(
        query,
        "preview",
        "denied",
        safeArtifactRef(query.artifactRef),
      );
      return denied();
    }
    const resolved = await this.resolveArtifact(query, query.artifactRef);
    if (!resolved) {
      await this.audit(
        query,
        "preview",
        "unavailable",
        safeArtifactRef(query.artifactRef),
      );
      return notFound();
    }
    const displayName = safeDisplayName(
      resolved.item.originalName,
      resolved.artifactRef,
    );
    const mediaType = normalizeMediaType(resolved.item.mediaType);
    if (
      !mediaType ||
      !definition.descriptor.allowedMediaTypes.includes(mediaType)
    ) {
      return this.previewResult(query, resolved.artifactRef, "unsupported", {
        artifactRef: resolved.artifactRef,
        displayName,
        ...(mediaType ? { mediaType } : {}),
        kind: "unsupported",
        status: "unsupported",
        message: "This file type does not have a safe in-app preview.",
      });
    }
    if (
      resolved.item.sizeBytes !== undefined &&
      resolved.item.sizeBytes > definition.descriptor.maximumPreviewBytes
    ) {
      return this.previewResult(query, resolved.artifactRef, "oversized", {
        artifactRef: resolved.artifactRef,
        displayName,
        mediaType,
        kind: previewKind(mediaType),
        status: "oversized",
        message: "The artifact exceeds the preview limit.",
      });
    }
    const read =
      await this.dependencies.content.retrieveArtifactViewerMediaByStorageKey(
        {
          storageKey: String(resolved.item.storageKey),
          maximumBytes: definition.descriptor.maximumPreviewBytes,
        },
        { workspaceId: query.workspaceId },
      );
    if (!read.ok) {
      const oversized =
        read.error.code === "unavailable" &&
        /permitted read size/i.test(read.error.message);
      return this.previewResult(
        query,
        resolved.artifactRef,
        oversized ? "oversized" : "unavailable",
        {
          artifactRef: resolved.artifactRef,
          displayName,
          mediaType,
          kind: previewKind(mediaType),
          status: oversized ? "oversized" : "unavailable",
          message: oversized
            ? "The artifact exceeds the preview limit."
            : "The artifact preview is unavailable.",
        },
      );
    }
    const preview = createPreview(
      resolved.artifactRef,
      displayName,
      mediaType,
      read.value.bytes,
    );
    return this.previewResult(
      query,
      resolved.artifactRef,
      outcomeForStatus(preview.status),
      preview,
    );
  }

  public async listAudit(
    query: ListSystemReviewAuditQuery,
  ): Promise<SystemReviewResult<readonly SystemReviewAuditEntry[]>> {
    const definition = await this.definition(query);
    if (!definition) return unavailable();
    const canInspect =
      query.principal.authenticated &&
      query.principal.roles.some(
        (role) =>
          definition.unmaskRoles.includes(role) ||
          role === "owner" ||
          role === "developer",
      );
    if (!canInspect) {
      await this.audit(query, "audit", "denied");
      return denied();
    }
    const limit = clampInteger(query.limit, 1, MAX_AUDIT_ITEMS, 100);
    return systemReviewSuccess(
      await this.dependencies.audit.listAudit(
        query.workspaceId,
        query.releaseId,
        limit,
      ),
    );
  }

  private definition(
    input: DescribeSystemReviewQuery,
  ): Promise<SystemReviewResolvedDefinition | undefined> {
    return this.dependencies.definitions.resolve(
      input.workspaceId,
      input.releaseId,
    );
  }

  private async resolveArtifact(
    query: DescribeSystemReviewQuery,
    artifactRefValue: string,
  ): Promise<ResolvedArtifact | undefined> {
    const artifactRef = safeArtifactRef(artifactRefValue);
    if (!artifactRef) return undefined;
    const browse = await this.dependencies.artifacts.browseArtifacts(
      {},
      { workspaceId: query.workspaceId },
    );
    if (!browse.ok) return undefined;
    const matches = browse.value.items
      .map(toResolvedArtifact)
      .filter((item) => item.artifactRef === artifactRef);
    return matches.length === 1 ? matches[0] : undefined;
  }

  private async previewResult(
    query: PreviewSystemReviewArtifactQuery,
    artifactRef: string,
    outcome: SystemReviewAuditOutcome,
    preview: SystemReviewPreview,
  ): Promise<SystemReviewResult<SystemReviewPreview>> {
    if (!(await this.audit(query, "preview", outcome, artifactRef)))
      return auditUnavailable();
    return systemReviewSuccess(preview);
  }

  private async audit(
    input: DescribeSystemReviewQuery,
    action: SystemReviewAction,
    outcome: SystemReviewAuditOutcome,
    artifactRef?: string,
  ): Promise<boolean> {
    try {
      await this.dependencies.audit.appendAudit({
        auditId: safeAuditId(this.dependencies.generateAuditId()),
        targetWorkspaceId: input.workspaceId,
        releaseId: input.releaseId,
        action,
        outcome,
        actorId: safeActor(input.principal.actorId),
        ...(artifactRef ? { artifactRef } : {}),
        occurredAt: this.now(),
      });
      return true;
    } catch {
      return false;
    }
  }
}

export function createSystemReviewArtifactRef(storageKey: string): string {
  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  const bytes = new TextEncoder().encode(storageKey);
  for (const byte of bytes) {
    hash ^= BigInt(byte);
    hash = BigInt.asUintN(64, hash * prime);
  }
  return `artifact-${hash.toString(16).padStart(16, "0")}`;
}

function toResolvedArtifact(item: ArtifactBrowseItem): ResolvedArtifact {
  return {
    item,
    artifactRef: createSystemReviewArtifactRef(String(item.storageKey)),
  };
}

function summary(
  item: ArtifactBrowseItem,
  artifactRef: string,
): SystemReviewArtifactSummary {
  return {
    artifactRef,
    displayName: safeDisplayName(item.originalName, artifactRef),
    artifactFamily: safeText(item.artifactFamily, 80) || "unknown",
    ...(normalizeMediaType(item.mediaType)
      ? { mediaType: normalizeMediaType(item.mediaType) }
      : {}),
    ...(safeSize(item.sizeBytes) !== undefined
      ? { sizeBytes: safeSize(item.sizeBytes) }
      : {}),
    ...(safeTimestamp(item.createdAt)
      ? { createdAt: safeTimestamp(item.createdAt) }
      : {}),
  };
}

function detail(
  artifact: ArtifactDetailReadModel,
  artifactRef: string,
  definition: SystemReviewResolvedDefinition,
  principal: SystemReviewPrincipal,
): SystemReviewArtifactDetail {
  const canUnmask = principal.roles.some((role) =>
    definition.unmaskRoles.includes(role),
  );
  const protectedFields = new Set(
    definition.protectedMetadataFields.map((field) => field.toLowerCase()),
  );
  const metadata = Object.fromEntries(
    Object.entries(artifact.metadata ?? {})
      .filter(
        ([key, value]) =>
          !ALWAYS_REDACTED_METADATA.test(key) &&
          (canUnmask || !protectedFields.has(key.toLowerCase())) &&
          isMetadataValue(value),
      )
      .slice(0, 40)
      .map(([key, value]) => [
        safeText(key, 80),
        normalizeMetadataValue(value as SystemReviewMetadataValue),
      ]),
  );
  return {
    ...summary(
      {
        artifactId: String(artifact.locator.storageKey),
        storageKey: artifact.locator.storageKey,
        artifactFamily: artifact.artifactFamily,
        mediaType: artifact.mediaType,
        sizeBytes: artifact.sizeBytes,
        originalName: artifact.originalName,
        createdAt: artifact.createdAt,
      },
      artifactRef,
    ),
    metadata,
  };
}

function createPreview(
  artifactRef: string,
  displayName: string,
  mediaType: string,
  bytes: Uint8Array,
): SystemReviewPreview {
  const base = { artifactRef, displayName, mediaType };
  if (mediaType === "application/pdf") {
    if (!startsWith(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d]))
      return malformedPreview(base, "pdf");
    return {
      ...base,
      kind: "pdf",
      status: "ready",
      message: "A sandboxed PDF preview is ready.",
      bytes,
    };
  }
  if (mediaType.startsWith("image/")) {
    if (!validImageSignature(mediaType, bytes))
      return malformedPreview(base, "image");
    return {
      ...base,
      kind: "image",
      status: "ready",
      message: "A constrained raster preview is ready.",
      bytes,
    };
  }
  if (bytes.includes(0)) return malformedPreview(base, previewKind(mediaType));
  const text = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  if (mediaType === "application/json") {
    try {
      return {
        ...base,
        kind: "table",
        status: "ready",
        message: "Showing a bounded JSON table sample.",
        table: jsonTable(JSON.parse(text) as unknown),
      };
    } catch {
      return malformedPreview(base, "table");
    }
  }
  if (mediaType === "text/csv" || mediaType === "application/csv") {
    try {
      return {
        ...base,
        kind: "table",
        status: "ready",
        message: "Showing a bounded CSV table sample.",
        table: csvTable(text),
      };
    } catch {
      return malformedPreview(base, "table");
    }
  }
  const limited = limitText(text);
  return {
    ...base,
    kind: "text",
    status: "ready",
    message: "Showing a bounded plain-text sample.",
    text: limited.text,
    truncated: limited.truncated,
  };
}

function malformedPreview(
  base: { artifactRef: string; displayName: string; mediaType: string },
  kind: SystemReviewPreview["kind"],
): SystemReviewPreview {
  return {
    ...base,
    kind,
    status: "malformed",
    message: "The artifact could not be safely parsed.",
  };
}

function previewKind(mediaType: string): SystemReviewPreview["kind"] {
  if (mediaType === "application/pdf") return "pdf";
  if (mediaType.startsWith("image/")) return "image";
  if (["application/json", "text/csv", "application/csv"].includes(mediaType))
    return "table";
  if (mediaType.startsWith("text/")) return "text";
  return "unsupported";
}

function validImageSignature(mediaType: string, bytes: Uint8Array): boolean {
  if (mediaType === "image/png")
    return startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (mediaType === "image/jpeg") return startsWith(bytes, [0xff, 0xd8, 0xff]);
  if (mediaType === "image/gif")
    return startsWith(bytes, [0x47, 0x49, 0x46, 0x38]);
  if (mediaType === "image/webp") {
    return (
      startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) &&
      startsWith(bytes.slice(8), [0x57, 0x45, 0x42, 0x50])
    );
  }
  return false;
}

function startsWith(bytes: Uint8Array, signature: readonly number[]): boolean {
  return signature.every((value, index) => bytes[index] === value);
}

function jsonTable(value: unknown): SystemReviewTable {
  if (Array.isArray(value)) {
    const records = value.slice(0, MAX_TABLE_ROWS);
    if (
      records.every(
        (item) =>
          item !== null && typeof item === "object" && !Array.isArray(item),
      )
    ) {
      const columns = Array.from(
        new Set(
          records.flatMap((item) =>
            Object.keys(item as Record<string, unknown>),
          ),
        ),
      ).slice(0, MAX_TABLE_COLUMNS);
      return {
        columns,
        rows: records.map((item) =>
          columns.map((column) =>
            cell((item as Record<string, unknown>)[column] ?? ""),
          ),
        ),
      };
    }
    return { columns: ["Value"], rows: records.map((item) => [cell(item)]) };
  }
  if (value !== null && typeof value === "object") {
    return {
      columns: ["Field", "Value"],
      rows: Object.entries(value as Record<string, unknown>)
        .slice(0, MAX_TABLE_ROWS)
        .map(([key, item]) => [cell(key), cell(item)]),
    };
  }
  return { columns: ["Value"], rows: [[cell(value)]] };
}

function csvTable(text: string): SystemReviewTable {
  const rows: string[][] = [];
  let row: string[] = [];
  let current = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (character === '"') {
      if (quoted && text[index + 1] === '"') {
        current += '"';
        index += 1;
      } else quoted = !quoted;
    } else if (character === "," && !quoted) {
      row.push(current);
      current = "";
    } else if ((character === "\n" || character === "\r") && !quoted) {
      if (character === "\r" && text[index + 1] === "\n") index += 1;
      row.push(current);
      rows.push(row);
      row = [];
      current = "";
      if (rows.length > MAX_TABLE_ROWS) break;
    } else current += character;
  }
  if (quoted) throw new Error("Malformed CSV.");
  if (current || row.length) {
    row.push(current);
    rows.push(row);
  }
  const columns = (rows.shift() ?? [])
    .slice(0, MAX_TABLE_COLUMNS)
    .map((value, index) => cell(value.trim() || `Column ${index + 1}`));
  return {
    columns,
    rows: rows
      .slice(0, MAX_TABLE_ROWS)
      .map((item) => columns.map((_column, index) => cell(item[index] ?? ""))),
  };
}

function cell(value: unknown): string {
  const rendered =
    typeof value === "string"
      ? value
      : (JSON.stringify(value) ?? String(value));
  const bounded = rendered.slice(0, MAX_CELL_CHARS);
  return /^[=+\-@]/.test(bounded) ? `'${bounded}` : bounded;
}

function limitText(value: string): { text: string; truncated: boolean } {
  const lines = value.split(/\r?\n/);
  const firstLines = lines.slice(0, 80).join("\n");
  const text = firstLines.slice(0, 16_000);
  return { text, truncated: lines.length > 80 || firstLines.length > 16_000 };
}

function authorized(
  principal: SystemReviewPrincipal,
  definition: SystemReviewResolvedDefinition,
): boolean {
  return (
    principal.authenticated &&
    principal.roles.some((role) => definition.allowedRoles.includes(role))
  );
}

function safeArtifactRef(value: string): string | undefined {
  const normalized = value.trim();
  return /^artifact-[a-f0-9]{16}$/.test(normalized) ? normalized : undefined;
}

function safeDisplayName(
  value: string | undefined,
  artifactRef: string,
): string {
  const normalized = value?.trim().split(/[\\/]/).pop()?.trim();
  return safeText(normalized, 160) || `Artifact ${artifactRef.slice(-8)}`;
}

function safeText(value: unknown, maximum: number): string {
  if (typeof value !== "string") return "";
  const normalized = value.trim();
  return normalized &&
    normalized.length <= maximum &&
    !/[\u0000-\u001f\u007f]/.test(normalized)
    ? normalized
    : "";
}

function safeTimestamp(value: unknown): string | undefined {
  const normalized = safeText(value, 40);
  return normalized && !Number.isNaN(Date.parse(normalized))
    ? normalized
    : undefined;
}

function safeSize(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : undefined;
}

function normalizeMediaType(value: unknown): string {
  return typeof value === "string"
    ? value.split(";", 1)[0].trim().toLowerCase()
    : "";
}

function safeQuery(value: string | undefined): string {
  return value?.trim().toLowerCase().slice(0, 120) ?? "";
}

function isMetadataValue(value: unknown): value is SystemReviewMetadataValue {
  return (
    value === null || ["string", "number", "boolean"].includes(typeof value)
  );
}

function normalizeMetadataValue(
  value: SystemReviewMetadataValue,
): SystemReviewMetadataValue {
  if (typeof value === "string") return value.slice(0, 200);
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  return value;
}

function safeAuditId(value: string): string {
  const normalized = value.trim();
  return SAFE_ID.test(normalized) ? normalized : "audit-fallback";
}

function safeActor(value: string): string {
  return safeText(value, 160) || "unknown-actor";
}

function clampInteger(
  value: number | undefined,
  minimum: number,
  maximum: number,
  fallback: number,
): number {
  return Number.isInteger(value)
    ? Math.max(minimum, Math.min(maximum, value!))
    : fallback;
}

function outcomeForStatus(
  status: SystemReviewPreview["status"],
): SystemReviewAuditOutcome {
  return status === "ready" ? "allowed" : status;
}

function unavailable<T>(): SystemReviewResult<T> {
  return systemReviewFailure(
    "system-review.release-unavailable",
    "This approved release does not expose a supported review runtime.",
  );
}

function denied<T>(): SystemReviewResult<T> {
  return systemReviewFailure(
    "system-review.forbidden",
    "You do not have permission to perform this action.",
  );
}

function notFound<T>(): SystemReviewResult<T> {
  return systemReviewFailure(
    "system-review.not-found",
    "The artifact was not found.",
  );
}

function auditUnavailable<T>(): SystemReviewResult<T> {
  return systemReviewFailure(
    "system-review.audit-unavailable",
    "The review audit service is unavailable.",
  );
}
