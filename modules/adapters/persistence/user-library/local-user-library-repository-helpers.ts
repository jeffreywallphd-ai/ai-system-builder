import type { AssetReference } from "../../../contracts/asset";
import type { UserLibraryAssetReference } from "../../../contracts/user-library";
import { assertSafeUserLibraryRecord, cloneJson } from "./local-user-library-record-store";

export const USER_LIBRARY_LIST_LIMIT_MAXIMUM = 100;

export interface CursorPage<T> {
  readonly records: readonly T[];
  readonly nextCursor?: string;
}

export function assetReferenceEquals(left: AssetReference | undefined, right: AssetReference | undefined): boolean {
  if (!left || !right) return false;
  return left.kind === right.kind && left.id === right.id && (left.version ?? "") === (right.version ?? "");
}

export function userLibraryAssetReferenceEquals(
  left: UserLibraryAssetReference | undefined,
  right: UserLibraryAssetReference | undefined,
): boolean {
  if (!left || !right) return false;
  return left.assetId === right.assetId && (left.version ?? "") === (right.version ?? "");
}

export function pageRecords<T>(records: readonly T[], limit?: number, cursor?: string): CursorPage<T> {
  const offset = decodeCursor(cursor);
  const normalizedLimit = normalizeLimit(limit);
  const page = records.slice(offset, offset + normalizedLimit);
  const nextOffset = offset + page.length;
  return {
    records: cloneJson(page),
    nextCursor: nextOffset < records.length ? encodeCursor(nextOffset) : undefined,
  };
}

export function textValuesMatch(values: readonly (string | undefined)[], text?: string): boolean {
  const normalized = text?.trim().toLowerCase();
  if (!normalized) return true;
  return values.some((value) => typeof value === "string" && value.toLowerCase().includes(normalized));
}

export function upsertRecord<T>(records: readonly T[], nextRecord: T, keyFor: (record: T) => string): T[] {
  const jsonRecord = cloneJson(nextRecord);
  assertSafeUserLibraryRecord(jsonRecord);
  const nextKey = keyFor(nextRecord);
  return [...records.filter((record) => keyFor(record) !== nextKey), jsonRecord];
}

export function replaceRecord<T>(records: readonly T[], nextRecord: T, keyFor: (record: T) => string, missingMessage: string): T[] {
  const jsonRecord = cloneJson(nextRecord);
  assertSafeUserLibraryRecord(jsonRecord);
  const nextKey = keyFor(nextRecord);
  if (!records.some((record) => keyFor(record) === nextKey)) {
    const error = new Error(missingMessage);
    error.stack = undefined;
    throw error;
  }
  return records.map((record) => (keyFor(record) === nextKey ? jsonRecord : record));
}

export function encodeCursor(offset: number): string {
  return Buffer.from(JSON.stringify({ offset }), "utf8").toString("base64url");
}

function normalizeLimit(limit: number | undefined): number {
  if (typeof limit !== "number" || !Number.isFinite(limit) || limit <= 0) return USER_LIBRARY_LIST_LIMIT_MAXIMUM;
  return Math.min(Math.floor(limit), USER_LIBRARY_LIST_LIMIT_MAXIMUM);
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
