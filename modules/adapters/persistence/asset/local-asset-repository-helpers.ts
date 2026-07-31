import type { AssetReference } from "../../../contracts/asset";
import { assertJsonCompatibleAssetRecord, cloneJson } from "./local-asset-record-store";

export interface CursorPage<T> {
  readonly records: readonly T[];
  readonly nextCursor?: string;
}

export function referenceEquals(left: AssetReference | undefined, right: AssetReference | undefined): boolean {
  if (!left || !right) return false;
  return left.kind === right.kind && left.id === right.id && (left.version ?? "") === (right.version ?? "");
}

export function pageRecords<T>(records: readonly T[], limit?: number, cursor?: string): CursorPage<T> {
  const offset = decodeCursor(cursor);
  const normalizedLimit = typeof limit === "number" && Number.isFinite(limit) && limit > 0 ? Math.floor(limit) : records.length;
  const page = records.slice(offset, offset + normalizedLimit);
  const nextOffset = offset + page.length;
  return {
    records: cloneJson(page),
    nextCursor: nextOffset < records.length ? encodeCursor(nextOffset) : undefined,
  };
}

export function sortByUpdatedAtDescendingThenId<T>(records: readonly T[], getId: (record: T) => string): T[] {
  return [...records].sort((left, right) => {
    const leftUpdatedAt = getUpdatedAt(left);
    const rightUpdatedAt = getUpdatedAt(right);
    if (leftUpdatedAt && rightUpdatedAt && leftUpdatedAt !== rightUpdatedAt) {
      return rightUpdatedAt.localeCompare(leftUpdatedAt);
    }
    if (leftUpdatedAt && !rightUpdatedAt) return -1;
    if (!leftUpdatedAt && rightUpdatedAt) return 1;
    return getId(left).localeCompare(getId(right));
  });
}

export function textValuesMatch(values: readonly (string | undefined)[], text?: string): boolean {
  const normalized = text?.trim().toLowerCase();
  if (!normalized) return true;
  return values.some((value) => typeof value === "string" && value.toLowerCase().includes(normalized));
}

export function upsertRecord<T>(records: readonly T[], nextRecord: T, keyFor: (record: T) => string): T[] {
  assertJsonCompatibleAssetRecord(nextRecord);
  const nextKey = keyFor(nextRecord);
  const filtered = records.filter((record) => keyFor(record) !== nextKey);
  return [...filtered, cloneJson(nextRecord)];
}

export function deleteRecord<T>(records: readonly T[], key: string, keyFor: (record: T) => string): T[] {
  return records.filter((record) => keyFor(record) !== key);
}

export function encodeCursor(offset: number): string {
  return Buffer.from(JSON.stringify({ offset }), "utf8").toString("base64url");
}

function decodeCursor(cursor: string | undefined): number {
  if (!cursor) return 0;
  try {
    const parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")) as { offset?: unknown };
    return typeof parsed.offset === "number" && Number.isFinite(parsed.offset) && parsed.offset > 0 ? Math.floor(parsed.offset) : 0;
  } catch {
    return 0;
  }
}

function getUpdatedAt(record: unknown): string | undefined {
  if (!record || typeof record !== "object") return undefined;
  const provenance = (record as { provenance?: { updatedAt?: unknown } }).provenance;
  return typeof provenance?.updatedAt === "string" ? provenance.updatedAt : undefined;
}
