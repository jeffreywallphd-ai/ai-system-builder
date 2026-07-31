export const ARTIFACT_PREVIEW_MAX_BYTES = 64 * 1024;
export const ARTIFACT_PREVIEW_MAX_CHARS = 16_000;
export const ARTIFACT_PREVIEW_MAX_LINES = 80;
export const ARTIFACT_PREVIEW_MAX_TABLE_ROWS = 25;
export const ARTIFACT_PREVIEW_MAX_TABLE_COLUMNS = 20;
export const ARTIFACT_PREVIEW_MAX_CELL_CHARS = 1_000;

export type ArtifactPreviewKind =
  | "text"
  | "markdown"
  | "json"
  | "csv"
  | "image"
  | "video"
  | "pdf"
  | "office-document"
  | "office-spreadsheet"
  | "unsupported";

export type ArtifactPreviewStatus =
  "idle" | "loading" | "ready" | "unavailable" | "error";

export interface ArtifactPreviewSource {
  readonly storageKey: string;
  readonly originalName?: string;
  readonly mediaType?: string;
  readonly artifactFamily?: string;
}

export interface ArtifactPreviewDescriptor extends ArtifactPreviewSource {
  readonly kind: ArtifactPreviewKind;
  readonly fileTypeLabel: string;
}

export interface ArtifactPreviewView {
  readonly status: ArtifactPreviewStatus;
  readonly descriptor?: ArtifactPreviewDescriptor;
  readonly title: string;
  readonly message?: string;
  readonly text?: string;
  readonly mediaUrl?: string;
  readonly table?: {
    readonly columns: readonly string[];
    readonly rows: readonly (readonly string[])[];
  };
  readonly truncated?: boolean;
}

const IMAGE_EXTENSIONS = new Set([
  ".avif",
  ".bmp",
  ".gif",
  ".jpeg",
  ".jpg",
  ".png",
  ".webp",
]);
const IMAGE_MEDIA_TYPES = new Set([
  "image/avif",
  "image/bmp",
  "image/gif",
  "image/jpeg",
  "image/png",
  "image/webp",
]);
const VIDEO_EXTENSIONS = new Set([
  ".avi",
  ".m4v",
  ".mkv",
  ".mov",
  ".mp4",
  ".mpeg",
  ".mpg",
  ".ogv",
  ".webm",
]);
const DOCUMENT_EXTENSIONS = new Set([".doc", ".docx"]);
const SPREADSHEET_EXTENSIONS = new Set([".xls", ".xlsx"]);

function normalizeMediaType(mediaType?: string): string {
  return mediaType?.split(";")[0]?.trim().toLowerCase() ?? "";
}

function getExtension(source: ArtifactPreviewSource): string {
  const fileName = source.originalName?.trim() || source.storageKey;
  const lastSegment = fileName.split(/[\\/]/).pop() ?? fileName;
  const dotIndex = lastSegment.lastIndexOf(".");
  return dotIndex >= 0 ? lastSegment.slice(dotIndex).toLowerCase() : "";
}

export function describeArtifactPreview(
  source: ArtifactPreviewSource,
): ArtifactPreviewDescriptor {
  const mediaType = normalizeMediaType(source.mediaType);
  const extension = getExtension(source);

  if (mediaType === "image/svg+xml" || extension === ".svg") {
    return { ...source, kind: "unsupported", fileTypeLabel: "SVG" };
  }

  if (IMAGE_MEDIA_TYPES.has(mediaType) || IMAGE_EXTENSIONS.has(extension)) {
    return { ...source, kind: "image", fileTypeLabel: "Image" };
  }

  if (mediaType.startsWith("video/") || VIDEO_EXTENSIONS.has(extension)) {
    return { ...source, kind: "video", fileTypeLabel: "Video" };
  }

  if (mediaType === "application/pdf" || extension === ".pdf") {
    return { ...source, kind: "pdf", fileTypeLabel: "PDF" };
  }

  if (mediaType === "application/json" || extension === ".json") {
    return { ...source, kind: "json", fileTypeLabel: "JSON" };
  }

  if (
    mediaType === "text/csv" ||
    mediaType === "application/csv" ||
    extension === ".csv"
  ) {
    return { ...source, kind: "csv", fileTypeLabel: "CSV" };
  }

  if (
    mediaType === "text/markdown" ||
    extension === ".md" ||
    extension === ".markdown"
  ) {
    return { ...source, kind: "markdown", fileTypeLabel: "Markdown" };
  }

  if (
    mediaType === "text/html" ||
    extension === ".html" ||
    extension === ".htm"
  ) {
    return { ...source, kind: "text", fileTypeLabel: "HTML source" };
  }

  if (
    mediaType.startsWith("text/") ||
    extension === ".txt" ||
    extension === ".log"
  ) {
    return { ...source, kind: "text", fileTypeLabel: "Text" };
  }

  if (
    mediaType === "application/msword" ||
    mediaType ===
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    DOCUMENT_EXTENSIONS.has(extension)
  ) {
    return {
      ...source,
      kind: "office-document",
      fileTypeLabel: extension === ".doc" ? "DOC" : "DOCX",
    };
  }

  if (
    mediaType === "application/vnd.ms-excel" ||
    mediaType ===
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
    SPREADSHEET_EXTENSIONS.has(extension)
  ) {
    return {
      ...source,
      kind: "office-spreadsheet",
      fileTypeLabel: extension === ".xls" ? "XLS" : "XLSX",
    };
  }

  return {
    ...source,
    kind: "unsupported",
    fileTypeLabel:
      source.mediaType ?? (extension.slice(1).toUpperCase() || "Unknown file"),
  };
}

export function createIdleArtifactPreview(): ArtifactPreviewView {
  return {
    status: "idle",
    title: "Artifact preview",
    message: "Select an artifact with local bytes to see a limited preview.",
  };
}

export function createLoadingArtifactPreview(
  source: ArtifactPreviewSource,
): ArtifactPreviewView {
  return {
    status: "loading",
    descriptor: describeArtifactPreview(source),
    title: "Artifact preview",
    message: "Preparing a small preview...",
  };
}

export function createUnavailableArtifactPreview(
  source: ArtifactPreviewSource,
  message?: string,
): ArtifactPreviewView {
  return {
    status: "unavailable",
    descriptor: describeArtifactPreview(source),
    title: "Artifact preview",
    message:
      message ??
      "Preview is unavailable because the artifact bytes are not available locally.",
  };
}

export function isTextArtifactPreviewKind(kind: ArtifactPreviewKind): boolean {
  return (
    kind === "text" || kind === "markdown" || kind === "json" || kind === "csv"
  );
}

export function isMediaArtifactPreviewKind(kind: ArtifactPreviewKind): boolean {
  return kind === "image" || kind === "video" || kind === "pdf";
}

function limitPreviewText(text: string): { text: string; truncated: boolean } {
  const lines = text.split(/\r?\n/);
  const lineLimited = lines.length > ARTIFACT_PREVIEW_MAX_LINES;
  const firstLines = lineLimited
    ? lines.slice(0, ARTIFACT_PREVIEW_MAX_LINES).join("\n")
    : text;
  const charLimited = firstLines.length > ARTIFACT_PREVIEW_MAX_CHARS;
  return {
    text: charLimited
      ? firstLines.slice(0, ARTIFACT_PREVIEW_MAX_CHARS)
      : firstLines,
    truncated: lineLimited || charLimited,
  };
}

function decodeTextPreview(bytes: Uint8Array): {
  text: string;
  truncated: boolean;
} {
  const byteLimited = bytes.byteLength > ARTIFACT_PREVIEW_MAX_BYTES;
  const sampledBytes = byteLimited
    ? bytes.slice(0, ARTIFACT_PREVIEW_MAX_BYTES)
    : bytes;
  const decoded = new TextDecoder("utf-8", { fatal: false }).decode(
    sampledBytes,
  );
  const limited = limitPreviewText(decoded);
  return {
    text: limited.text,
    truncated: byteLimited || limited.truncated,
  };
}

function neutralizeTableCell(value: unknown): string {
  const rendered =
    typeof value === "string"
      ? value
      : (JSON.stringify(value) ?? String(value));
  const bounded = rendered.slice(0, ARTIFACT_PREVIEW_MAX_CELL_CHARS);
  return /^[=+\-@]/.test(bounded) ? `'${bounded}` : bounded;
}

function createJsonTable(
  text: string,
): ArtifactPreviewView["table"] | undefined {
  const value = JSON.parse(text) as unknown;
  if (Array.isArray(value)) {
    const records = value.slice(0, ARTIFACT_PREVIEW_MAX_TABLE_ROWS);
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
      ).slice(0, ARTIFACT_PREVIEW_MAX_TABLE_COLUMNS);
      return {
        columns,
        rows: records.map((item) =>
          columns.map((column) =>
            neutralizeTableCell(
              (item as Record<string, unknown>)[column] ?? "",
            ),
          ),
        ),
      };
    }
    return {
      columns: ["Value"],
      rows: records.map((item) => [neutralizeTableCell(item)]),
    };
  }
  if (value !== null && typeof value === "object") {
    return {
      columns: ["Field", "Value"],
      rows: Object.entries(value as Record<string, unknown>)
        .slice(0, ARTIFACT_PREVIEW_MAX_TABLE_ROWS)
        .map(([key, item]) => [
          neutralizeTableCell(key),
          neutralizeTableCell(item),
        ]),
    };
  }
  return { columns: ["Value"], rows: [[neutralizeTableCell(value)]] };
}

function parseCsvRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (character === '"') {
      if (quoted && text[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (character === "," && !quoted) {
      row.push(cell);
      cell = "";
    } else if ((character === "\n" || character === "\r") && !quoted) {
      if (character === "\r" && text[index + 1] === "\n") index += 1;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
      if (rows.length > ARTIFACT_PREVIEW_MAX_TABLE_ROWS) break;
    } else {
      cell += character;
    }
  }
  if (quoted) throw new Error("Malformed CSV quotation.");
  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

function createCsvTable(text: string): ArtifactPreviewView["table"] {
  const parsed = parseCsvRows(text);
  const rawColumns = parsed.shift() ?? [];
  const columns = rawColumns
    .slice(0, ARTIFACT_PREVIEW_MAX_TABLE_COLUMNS)
    .map((column, index) =>
      neutralizeTableCell(column.trim() || `Column ${index + 1}`),
    );
  return {
    columns,
    rows: parsed
      .slice(0, ARTIFACT_PREVIEW_MAX_TABLE_ROWS)
      .map((row) =>
        columns.map((_column, index) => neutralizeTableCell(row[index] ?? "")),
      ),
  };
}

export function createTextArtifactPreview(
  source: ArtifactPreviewSource,
  bytes: Uint8Array,
): ArtifactPreviewView {
  const descriptor = describeArtifactPreview(source);
  const previewName = source.originalName?.trim() || source.storageKey;
  const decoded = decodeTextPreview(bytes);
  let table: ArtifactPreviewView["table"];
  try {
    if (descriptor.kind === "json") table = createJsonTable(decoded.text);
    if (descriptor.kind === "csv") table = createCsvTable(decoded.text);
  } catch {
    return {
      status: "error",
      descriptor,
      title: `${descriptor.fileTypeLabel} preview for ${previewName}`,
      message:
        "The artifact could not be safely parsed. Download it to inspect the original file.",
    };
  }

  return {
    status: "ready",
    descriptor,
    title: `${descriptor.fileTypeLabel} preview for ${previewName}`,
    message:
      "Showing a small sample. Download the artifact to view the full file.",
    text: table ? undefined : decoded.text,
    table,
    truncated:
      decoded.truncated ||
      (descriptor.kind === "json" &&
        (table?.rows.length ?? 0) >= ARTIFACT_PREVIEW_MAX_TABLE_ROWS) ||
      (descriptor.kind === "csv" &&
        (table?.rows.length ?? 0) >= ARTIFACT_PREVIEW_MAX_TABLE_ROWS),
  };
}

export function createMediaArtifactPreview(
  source: ArtifactPreviewSource,
  mediaUrl: string,
): ArtifactPreviewView {
  const descriptor = describeArtifactPreview(source);
  const previewName = source.originalName?.trim() || source.storageKey;
  return {
    status: "ready",
    descriptor,
    title: `${descriptor.fileTypeLabel} preview for ${previewName}`,
    message:
      descriptor.kind === "pdf"
        ? "Showing the first page when the browser supports PDF preview. Download the artifact to view the full file."
        : "Showing a compact preview. Download the artifact to view the original file.",
    mediaUrl,
  };
}

export function createUnsupportedArtifactPreview(
  source: ArtifactPreviewSource,
): ArtifactPreviewView {
  const descriptor = describeArtifactPreview(source);
  const previewName = source.originalName?.trim() || source.storageKey;
  const message =
    descriptor.kind === "office-document" ||
    descriptor.kind === "office-spreadsheet"
      ? "This file type is recognized, but a safe in-app document preview is not available yet. Download the artifact to view the full file."
      : "This file type does not have an in-app preview yet. Download the artifact to view the full file.";

  return {
    status: "ready",
    descriptor,
    title: `${descriptor.fileTypeLabel} preview for ${previewName}`,
    message,
  };
}
