import { constants } from "node:fs";
import {
  lstat,
  link,
  mkdir,
  open,
  readdir,
  realpath,
  rename,
  rm,
  stat,
  unlink,
} from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import {types} from "node:util";

declare const streamLifetimeBrand: unique symbol;
/** Optional private instrumentation. Possession grants no filesystem authority. */
export interface ContainedFileStreamLifetime {readonly [streamLifetimeBrand]: true}
type StreamLifetimeRecord = {
  started: boolean; finished: boolean; unknown: boolean; pending: Set<object>;
  issued: number; returned: number; openAttempted: boolean; handleAcquired: boolean;
  closeAttempted: boolean; closeAcknowledged: boolean;
  publication: "none" | "published" | "unconfirmed";
  binding?: Readonly<{rootDirectory: string; key: string; maximumBytes: number; overwrite: boolean}>;
  handle?: unknown;
};
const streamLifetimes = new WeakMap<ContainedFileStreamLifetime, StreamLifetimeRecord>();
const lifetimeUnavailable = () => new Error("The original file operation lifetime is unavailable.");
function streamLifetime(owner: ContainedFileStreamLifetime): StreamLifetimeRecord {
  if (!owner || typeof owner !== "object" || types.isProxy(owner)) throw lifetimeUnavailable();
  const record = streamLifetimes.get(owner); if (!record) throw lifetimeUnavailable(); return record;
}
export function createContainedFileStreamLifetime(): ContainedFileStreamLifetime {
  const owner = Object.freeze(Object.create(null)) as ContainedFileStreamLifetime;
  streamLifetimes.set(owner, {started: false, finished: false, unknown: false, pending: new Set(), issued: 0, returned: 0,
    openAttempted: false, handleAcquired: false, closeAttempted: false, closeAcknowledged: false, publication: "none"});
  return owner;
}
/** Local IO only. Unknown publication/accounting is independent of closure. */
export function inspectContainedFileStreamLifetime(owner: ContainedFileStreamLifetime) {
  const record = streamLifetime(owner);
  const closed = record.started && record.finished && record.pending.size === 0 && !record.unknown &&
    (!record.openAttempted || record.handleAcquired && record.closeAcknowledged);
  return Object.freeze({schema: "contained-file-stream-lifetime-v1" as const,
    phase: closed ? "closed" as const : record.unknown || record.finished ? "unconfirmed" as const : record.started ? "active" as const : "unused" as const,
    pendingOperations: record.pending.size, issuedOperations: record.issued, returnedOperations: record.returned,
    invocationFinished: record.finished, handleAcquired: record.handleAcquired, closeAttempted: record.closeAttempted,
    closeAcknowledged: record.closeAcknowledged, publication: record.publication});
}
async function streamEffect<T>(record: StreamLifetimeRecord | undefined, kind: string, action: () => Promise<T>): Promise<T> {
  if (!record) return action();
  if (record.finished || record.pending.size >= 8 || record.issued === Number.MAX_SAFE_INTEGER) {
    record.unknown = true; throw lifetimeUnavailable();
  }
  const operation = Object.freeze({kind}); record.pending.add(operation); record.issued++;
  let pending: Promise<T>;
  try {
    pending = action();
    if (!types.isPromise(pending)) throw lifetimeUnavailable();
  } catch (error) {record.unknown = true; throw error;} // No retained outcome: never manufacture zero IO.
  return new Promise<T>((resolve, reject) => {
    void Promise.prototype.then.call(pending, (value: T) => {
      record.pending.delete(operation); record.returned++; resolve(value);
    }, (error: unknown) => {
      record.pending.delete(operation); record.returned++;
      if (kind === "open" || kind === "close") record.unknown = true;
      reject(error);
    });
  });
}
function streamHandleMethod(handle: unknown, name: string): (...args: any[]) => Promise<any> {
  if (!handle || typeof handle !== "object" || types.isProxy(handle)) throw lifetimeUnavailable();
  let object: object | null = handle;
  for (let depth = 0; object && depth < 8; depth++, object = Object.getPrototypeOf(object)) {
    if (types.isProxy(object)) throw lifetimeUnavailable();
    const property = Object.getOwnPropertyDescriptor(object, name);
    if (property) {
      if (!("value" in property) || typeof property.value !== "function" || types.isProxy(property.value)) throw lifetimeUnavailable();
      const method = property.value; return (...args: any[]) => Reflect.apply(method, handle, args);
    }
  }
  throw lifetimeUnavailable();
}

const WINDOWS_RESERVED_BASENAME = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i;
const WINDOWS_UNSAFE_SEGMENT = /[<>:"|?*\u0000-\u001f]/;

export class FilesystemContainmentError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "FilesystemContainmentError";
  }
}

function isMissing(error: unknown): boolean {
  return error instanceof Error && (error as NodeJS.ErrnoException).code === "ENOENT";
}

function isInside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function assertRegularFile(stats: Awaited<ReturnType<typeof lstat>>, operation: string): void {
  if (stats.isSymbolicLink()) {
    throw new FilesystemContainmentError(`${operation} rejected a symbolic link or junction.`);
  }
  if (!stats.isFile()) {
    throw new FilesystemContainmentError(`${operation} requires a regular file.`);
  }
  if (stats.nlink > 1) {
    throw new FilesystemContainmentError(`${operation} rejected a multiply linked file.`);
  }
}

function sameFileIdentity(
  left: Awaited<ReturnType<typeof lstat>>,
  right: Awaited<ReturnType<typeof lstat>>,
): boolean {
  if (left.dev === 0 || left.ino === 0 || right.dev === 0 || right.ino === 0) {
    return left.size === right.size && left.mtimeMs === right.mtimeMs;
  }
  return left.dev === right.dev && left.ino === right.ino;
}

function sameFileSnapshot(
  left: Awaited<ReturnType<typeof lstat>>,
  right: Awaited<ReturnType<typeof lstat>>,
): boolean {
  return sameFileIdentity(left, right)
    && left.size === right.size
    && left.mtimeMs === right.mtimeMs;
}

export function normalizeOpaqueFilesystemKey(value: string): string {
  const key = value.trim();
  if (!key || key.includes("\0")) {
    throw new FilesystemContainmentError("Filesystem key must be a non-empty opaque identifier.");
  }
  if (
    key.includes("\\")
    || key.startsWith("/")
    || key.endsWith("/")
    || path.posix.isAbsolute(key)
    || path.win32.isAbsolute(key)
    || /^[a-z]:/i.test(key)
    || key.startsWith("//")
  ) {
    throw new FilesystemContainmentError("Filesystem key must use relative forward-slash segments.");
  }

  const segments = key.split("/");
  for (const segment of segments) {
    if (
      !segment
      || segment === "."
      || segment === ".."
      || segment.endsWith(".")
      || segment.endsWith(" ")
      || WINDOWS_UNSAFE_SEGMENT.test(segment)
      || WINDOWS_RESERVED_BASENAME.test(segment)
    ) {
      throw new FilesystemContainmentError("Filesystem key contains an unsafe path segment.");
    }
  }
  return segments.join("/");
}

async function canonicalRoot(rootDirectory: string, create: boolean): Promise<string> {
  const absoluteRoot = path.resolve(rootDirectory);
  if (create) {
    await mkdir(absoluteRoot, { recursive: true });
  }
  const rootStats = await lstat(absoluteRoot);
  if (rootStats.isSymbolicLink() || !rootStats.isDirectory()) {
    throw new FilesystemContainmentError("Configured filesystem root must be a real directory.");
  }
  return realpath(absoluteRoot);
}

async function resolveContainedParent(
  rootDirectory: string,
  key: string,
  createParents: boolean,
): Promise<{ root: string; key: string; absolutePath: string }> {
  const normalizedKey = normalizeOpaqueFilesystemKey(key);
  const root = await canonicalRoot(rootDirectory, createParents);
  const segments = normalizedKey.split("/");
  let current = root;

  for (const segment of segments.slice(0, -1)) {
    current = path.join(current, segment);
    let currentStats: Awaited<ReturnType<typeof lstat>>;
    try {
      currentStats = await lstat(current);
    } catch (error) {
      if (!createParents || !isMissing(error)) throw error;
      await mkdir(current);
      currentStats = await lstat(current);
    }
    if (currentStats.isSymbolicLink() || !currentStats.isDirectory()) {
      throw new FilesystemContainmentError("Filesystem key traverses a link or non-directory component.");
    }
    const canonicalCurrent = await realpath(current);
    if (!isInside(root, canonicalCurrent)) {
      throw new FilesystemContainmentError("Filesystem key escapes the configured root.");
    }
  }

  const absolutePath = path.join(root, ...segments);
  if (!isInside(root, absolutePath)) {
    throw new FilesystemContainmentError("Filesystem key escapes the configured root.");
  }
  return { root, key: normalizedKey, absolutePath };
}

async function inspectContainedFile(
  rootDirectory: string,
  key: string,
  operation: string,
): Promise<{
  root: string;
  key: string;
  absolutePath: string;
  stats: Awaited<ReturnType<typeof lstat>>;
}> {
  const resolved = await resolveContainedParent(rootDirectory, key, false);
  const fileStats = await lstat(resolved.absolutePath);
  assertRegularFile(fileStats, operation);
  const canonicalFile = await realpath(resolved.absolutePath);
  if (!isInside(resolved.root, canonicalFile)) {
    throw new FilesystemContainmentError(`${operation} rejected a file outside the configured root.`);
  }
  return { ...resolved, stats: fileStats };
}

export async function writeContainedFile(input: {
  rootDirectory: string;
  key: string;
  content: Uint8Array;
  overwrite: boolean;
}): Promise<{ key: string; absolutePath: string }> {
  const resolved = await resolveContainedParent(input.rootDirectory, input.key, true);
  const noFollow = constants.O_NOFOLLOW ?? 0;

  if (!input.overwrite) {
    const handle = await open(
      resolved.absolutePath,
      constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | noFollow,
      0o600,
    );
    try {
      await handle.writeFile(input.content);
      await handle.sync();
    } finally {
      await handle.close();
    }
    return { key: resolved.key, absolutePath: resolved.absolutePath };
  }

  try {
    const existing = await lstat(resolved.absolutePath);
    assertRegularFile(existing, "Artifact overwrite");
    const canonicalExisting = await realpath(resolved.absolutePath);
    if (!isInside(resolved.root, canonicalExisting)) {
      throw new FilesystemContainmentError("Artifact overwrite rejected a file outside the configured root.");
    }
  } catch (error) {
    if (!isMissing(error)) throw error;
  }

  const temporaryPath = path.join(
    path.dirname(resolved.absolutePath),
    `.${path.basename(resolved.absolutePath)}.${randomUUID()}.tmp`,
  );
  const handle = await open(
    temporaryPath,
    constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | noFollow,
    0o600,
  );
  try {
    await handle.writeFile(input.content);
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    await rename(temporaryPath, resolved.absolutePath);
  } catch (error) {
    await unlink(temporaryPath).catch(() => undefined);
    throw error;
  }
  return { key: resolved.key, absolutePath: resolved.absolutePath };
}

export async function writeContainedFileStream(input: {
  rootDirectory: string;
  key: string;
  content: AsyncIterable<Uint8Array>;
  maximumBytes: number;
  overwrite: boolean;
}, lifetime?: ContainedFileStreamLifetime): Promise<{ key: string; absolutePath: string; sizeBytes: number }> {
  const record = lifetime === undefined ? undefined : streamLifetime(lifetime);
  if (record) {
    if (record.started || !input || typeof input !== "object" || types.isProxy(input)) throw lifetimeUnavailable();
    const fields = Object.getOwnPropertyDescriptors(input), keys = Object.keys(fields);
    if (Reflect.ownKeys(input).length !== 5 || keys.length !== 5 ||
        keys.some(key => !["rootDirectory", "key", "content", "maximumBytes", "overwrite"].includes(key) ||
          !("value" in fields[key]!) || fields[key]!.enumerable !== true)) throw lifetimeUnavailable();
    input = Object.freeze(Object.fromEntries(keys.map(key => [key, fields[key]!.value]))) as typeof input;
    if (typeof input.rootDirectory !== "string" || typeof input.key !== "string" || typeof input.overwrite !== "boolean" ||
        !Number.isSafeInteger(input.maximumBytes) || input.maximumBytes < 0) throw lifetimeUnavailable();
    record.binding = Object.freeze({rootDirectory: input.rootDirectory, key: input.key,
      maximumBytes: input.maximumBytes, overwrite: input.overwrite});
    record.started = true; // Before containment, open, iterator or any other await.
  }
  try {
  if (!Number.isSafeInteger(input.maximumBytes) || input.maximumBytes < 0) {
    throw new FilesystemContainmentError("Streamed artifact maximum bytes must be a non-negative safe integer.");
  }
  const resolved = await streamEffect(record, "containment", () => resolveContainedParent(input.rootDirectory, input.key, true));
  const noFollow = constants.O_NOFOLLOW ?? 0;
  if (input.overwrite) {
    try {
      const existing = await streamEffect(record, "inspect", () => lstat(resolved.absolutePath));
      assertRegularFile(existing, "Artifact stream overwrite");
      if (!isInside(resolved.root, await streamEffect(record, "inspect", () => realpath(resolved.absolutePath)))) {
        throw new FilesystemContainmentError("Artifact stream overwrite rejected a file outside the configured root.");
      }
    } catch (error) {
      if (!isMissing(error)) throw error;
    }
  }
  const temporaryPath = path.join(path.dirname(resolved.absolutePath), `.${path.basename(resolved.absolutePath)}.${randomUUID()}.stream.tmp`);
  if (record) record.openAttempted = true;
  const handle = await streamEffect(record, "open", () => open(temporaryPath, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | noFollow, 0o600));
  if (record) {record.handle = handle; record.handleAcquired = true;}
  const write = record ? streamHandleMethod(handle, "write") : (buffer: Uint8Array, offset: number, length: number) => handle.write(buffer, offset, length);
  const sync = record ? streamHandleMethod(handle, "sync") : () => handle.sync();
  const originalClose = record ? streamHandleMethod(handle, "close") : () => handle.close();
  const close = async () => {
    if (record) {if (record.closeAttempted) {record.unknown = true; throw lifetimeUnavailable();} record.closeAttempted = true;}
    await streamEffect(record, "close", () => originalClose());
    if (record) record.closeAcknowledged = true;
  };
  let sizeBytes = 0;
  try {
    for await (const chunk of input.content) {
      if (!(chunk instanceof Uint8Array)) throw new FilesystemContainmentError("Streamed artifact chunks must be binary bytes.");
      if (sizeBytes + chunk.byteLength > input.maximumBytes) throw new FilesystemContainmentError("Streamed artifact exceeds the permitted byte limit.");
      let offset = 0;
      while (offset < chunk.byteLength) {
        const result = await streamEffect(record, "write", () => write(chunk, offset, chunk.byteLength - offset));
        if (result.bytesWritten < 1) throw new FilesystemContainmentError("Streamed artifact write made no progress.");
        offset += result.bytesWritten;
      }
      sizeBytes += chunk.byteLength;
    }
    await streamEffect(record, "sync", () => sync());
  } catch (error) {
    await close().catch(() => undefined);
    await streamEffect(record, "unlink", () => unlink(temporaryPath)).catch(() => undefined);
    throw error;
  }
  await close();
  try {
    if (input.overwrite) {
      await streamEffect(record, "rename", () => rename(temporaryPath, resolved.absolutePath));
    } else {
      await streamEffect(record, "link", () => link(temporaryPath, resolved.absolutePath));
      await streamEffect(record, "unlink", () => unlink(temporaryPath));
    }
  } catch (error) {
    await streamEffect(record, "unlink", () => unlink(temporaryPath)).catch(() => undefined);
    throw error;
  }
  if (record) record.publication = "published";
  return { key: resolved.key, absolutePath: resolved.absolutePath, sizeBytes };
  } catch (error) {
    if (record) record.publication = "unconfirmed";
    throw error;
  } finally {if (record) record.finished = true;}
}

export async function readContainedFile(input: {
  rootDirectory: string;
  key: string;
  maximumBytes?: number;
}): Promise<{ key: string; absolutePath: string; content: Uint8Array; size: number }> {
  const inspected = await inspectContainedFile(input.rootDirectory, input.key, "Artifact read");
  if (input.maximumBytes !== undefined && inspected.stats.size > input.maximumBytes) {
    throw new FilesystemContainmentError("Artifact exceeds the permitted read size.");
  }
  const handle = await open(inspected.absolutePath, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const openedStats = await handle.stat();
    assertRegularFile(openedStats, "Artifact read");
    if (!sameFileIdentity(inspected.stats, openedStats)) {
      throw new FilesystemContainmentError("Artifact changed while it was being opened.");
    }
    const content = new Uint8Array(await handle.readFile());
    const completedStats = await handle.stat();
    if (!sameFileSnapshot(openedStats, completedStats)) {
      throw new FilesystemContainmentError("Artifact changed while it was being read.");
    }
    if (input.maximumBytes !== undefined && content.byteLength > input.maximumBytes) {
      throw new FilesystemContainmentError("Artifact exceeds the permitted read size.");
    }
    return {
      key: inspected.key,
      absolutePath: inspected.absolutePath,
      content,
      size: openedStats.size,
    };
  } finally {
    await handle.close();
  }
}

export async function statContainedFile(input: {
  rootDirectory: string;
  key: string;
}): Promise<{ key: string; absolutePath: string; size: number }> {
  const inspected = await inspectContainedFile(input.rootDirectory, input.key, "Artifact stat");
  return { key: inspected.key, absolutePath: inspected.absolutePath, size: Number(inspected.stats.size) };
}

export async function deleteContainedFile(input: {
  rootDirectory: string;
  key: string;
}): Promise<{ key: string; deleted: boolean }> {
  let inspected: Awaited<ReturnType<typeof inspectContainedFile>>;
  try {
    inspected = await inspectContainedFile(input.rootDirectory, input.key, "Artifact delete");
  } catch (error) {
    if (isMissing(error)) return { key: normalizeOpaqueFilesystemKey(input.key), deleted: false };
    throw error;
  }

  const handle = await open(inspected.absolutePath, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  const quarantinePath = path.join(
    path.dirname(inspected.absolutePath),
    `.${path.basename(inspected.absolutePath)}.${randomUUID()}.delete`,
  );
  try {
    const openedStats = await handle.stat();
    assertRegularFile(openedStats, "Artifact delete");
    if (!sameFileIdentity(inspected.stats, openedStats)) {
      throw new FilesystemContainmentError("Artifact changed while it was being opened for deletion.");
    }
    await rename(inspected.absolutePath, quarantinePath);
    const quarantinedStats = await lstat(quarantinePath);
    if (!sameFileIdentity(openedStats, quarantinedStats)) {
      throw new FilesystemContainmentError("Artifact changed before deletion could be isolated.");
    }
    await unlink(quarantinePath);
  } finally {
    await handle.close();
  }
  return { key: inspected.key, deleted: true };
}

export async function listContainedFiles(input: {
  rootDirectory: string;
  prefix?: string;
  rejectUnsafeEntries?: boolean;
}): Promise<string[]> {
  const prefix = input.prefix ? normalizeOpaqueFilesystemKey(input.prefix) : "";
  const root = await canonicalRoot(input.rootDirectory, false);
  const prefixPath = prefix ? path.join(root, ...prefix.split("/")) : root;
  const prefixStats = await lstat(prefixPath).catch((error) => {
    if (isMissing(error)) return undefined;
    throw error;
  });
  if (!prefixStats) return [];
  if (prefixStats.isSymbolicLink() || !prefixStats.isDirectory()) {
    throw new FilesystemContainmentError("Filesystem browse prefix must be a real directory.");
  }
  if (!isInside(root, await realpath(prefixPath))) {
    throw new FilesystemContainmentError("Filesystem browse prefix escapes the configured root.");
  }

  const output: string[] = [];
  async function walk(directory: string, relativePrefix: string): Promise<void> {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const absoluteEntry = path.join(directory, entry.name);
      const relativeEntry = relativePrefix ? `${relativePrefix}/${entry.name}` : entry.name;
      const entryStats = await lstat(absoluteEntry);
      if (entryStats.isSymbolicLink()) {
        if (input.rejectUnsafeEntries) {
          throw new FilesystemContainmentError("Filesystem enumeration rejected a symbolic link or junction.");
        }
        continue;
      }
      if (entryStats.isDirectory()) {
        if (isInside(root, await realpath(absoluteEntry))) await walk(absoluteEntry, relativeEntry);
        continue;
      }
      if (entryStats.isFile()) {
        if (entryStats.nlink > 1) {
          if (input.rejectUnsafeEntries) {
            throw new FilesystemContainmentError("Filesystem enumeration rejected a multiply linked file.");
          }
          continue;
        }
        if (isInside(root, await realpath(absoluteEntry))) output.push(relativeEntry);
      }
    }
  }
  await walk(prefixPath, "");
  return output;
}

export async function removeEmptyContainedParent(input: {
  rootDirectory: string;
  key: string;
}): Promise<void> {
  const resolved = await resolveContainedParent(input.rootDirectory, input.key, false);
  const parent = path.dirname(resolved.absolutePath);
  if (parent !== resolved.root && isInside(resolved.root, parent)) {
    await rm(parent, { recursive: false, force: false }).catch(() => undefined);
  }
}

export async function resolveApprovedDirectory(input: {
  allowedRoots: readonly string[];
  candidateDirectory: string;
}): Promise<{ rootDirectory: string; relativeKey: string }> {
  const candidate = path.resolve(input.candidateDirectory);
  for (const configuredRoot of input.allowedRoots) {
    const root = await canonicalRoot(configuredRoot, false).catch(() => undefined);
    if (!root || !isInside(root, candidate)) continue;
    const candidateCanonical = await realpath(candidate);
    if (!isInside(root, candidateCanonical)) continue;
    const relativeKey = path.relative(root, candidateCanonical).split(path.sep).join("/");
    if (!relativeKey) return { rootDirectory: root, relativeKey: "" };
    normalizeOpaqueFilesystemKey(relativeKey);
    let current = root;
    for (const segment of relativeKey.split("/")) {
      current = path.join(current, segment);
      const currentStats = await lstat(current);
      if (currentStats.isSymbolicLink()) {
        throw new FilesystemContainmentError("Approved directory traverses a symbolic link or junction.");
      }
    }
    const candidateStats = await stat(candidateCanonical);
    if (!candidateStats.isDirectory()) {
      throw new FilesystemContainmentError("Approved model path must be a directory.");
    }
    return { rootDirectory: root, relativeKey };
  }
  throw new FilesystemContainmentError("Path is outside every approved filesystem root.");
}
