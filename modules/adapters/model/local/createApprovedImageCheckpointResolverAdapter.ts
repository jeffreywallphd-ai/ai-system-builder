import {createHash, randomUUID} from "node:crypto";
import type {BigIntStats} from "node:fs";
import {lstat, open, realpath, link, unlink, statfs} from "node:fs/promises";
import path from "node:path";
import {isDeepStrictEqual, types} from "node:util";
import {readStrictPassiveRecord} from "../../../contracts/shared";
import type {ModelRegistryPort} from "../../../application/ports/model";
import type {ApprovedImageGenerationAdmission, ApprovedImageGenerationFence} from "../../../application/ports/image/approved-image-generation.port";
import {checkpointFileDigest, CheckpointReadCloseUnconfirmedError} from "./createLocalModelCheckpointResolverAdapter";

/** Private predeclared reference; bind it to the exact approved plan before use.
 * The adapter never derives an approved hash from whatever bytes it finds. */
export interface RegisteredImageCheckpointReference {
  readonly workspaceId: string;
  readonly modelRecordId: string;
  readonly updatedAt: string;
  readonly fileName: string;
  readonly byteLength: number;
  readonly sha256: string;
}
const unavailable = () => Error("The approved image checkpoint is unavailable.");
function record(value: unknown, keys: readonly string[]) {
  if (types.isProxy(value)) throw unavailable();
  return readStrictPassiveRecord(value, keys);
}
function same(a: {dev: bigint; ino: bigint}, b: {dev: bigint; ino: bigint}) {return a.dev === b.dev && a.ino === b.ino;}
function fileName(value: unknown): value is string {
  return typeof value === "string" && value.length <= 240 && /^[A-Za-z0-9][A-Za-z0-9._-]*\.safetensors$/.test(value) && !value.includes("..");
}
async function plainDirectory(value: string, assertCurrent: () => void = () => {}) {
  if (!path.isAbsolute(value) || /^[\\/]{2}/.test(value) || path.normalize(value) !== value) throw unavailable();
  let current = path.parse(value).root;
  for (const part of value.slice(current.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, part); assertCurrent(); const info = await lstat(current, {bigint: true});
    if (!info.isDirectory() || info.isSymbolicLink()) throw unavailable();
  }
  assertCurrent(); const resolved = await realpath(value);
  if (process.platform === "win32" ? resolved.toLowerCase() !== value.toLowerCase() : resolved !== value) throw unavailable();
  assertCurrent(); return lstat(value, {bigint: true});
}
async function plainFile(value: string, bytes: number, assertCurrent: () => void = () => {}) {
  assertCurrent(); const info = await lstat(value, {bigint: true});
  if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1n || info.size !== BigInt(bytes)) throw unavailable();
  return info;
}
function modelSnapshot(value: unknown) {
  if (!value || typeof value !== "object" || types.isProxy(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw unavailable();
  const selected: Record<string, unknown> = {};
  for (const key of ["workspaceId", "modelRecordId", "localPath", "lifecycleStatus", "artifactForm", "serializationFormat", "taskTags"]) {
    const field = Object.getOwnPropertyDescriptor(value, key);
    if (!field?.enumerable || !("value" in field)) throw unavailable();
    if (key === "taskTags") {
      const tags = field.value;
      if (types.isProxy(tags) || !Array.isArray(tags) || Object.getPrototypeOf(tags) !== Array.prototype || tags.length > 64 ||
          Reflect.ownKeys(tags).length !== tags.length + 1) throw unavailable();
      const copied: string[] = [];
      for (let index = 0; index < tags.length; index++) {
        const item = Object.getOwnPropertyDescriptor(tags, String(index));
        if (!item?.enumerable || !("value" in item) || typeof item.value !== "string" || item.value.length > 80) throw unavailable();
        copied.push(item.value);
      }
      selected[key] = Object.freeze(copied);
    } else {
      if (typeof field.value !== "string" || field.value.length > 4096) throw unavailable();
      selected[key] = field.value;
    }
  }
  const timestamp = (name: string) => {
    const field = Object.getOwnPropertyDescriptor(value, name);
    if (field && (!field.enumerable || !("value" in field))) throw unavailable();
    return field?.value;
  };
  selected.updatedAt = timestamp("updatedAt") ?? timestamp("createdAt");
  if (typeof selected.updatedAt !== "string" || selected.updatedAt.length > 64) throw unavailable();
  return Object.freeze(selected);
}

/** Bounded-local, same-account-trusted adapter (ADR49). No discovery/runtime,
 * model load, provider call, overwrite, physical quota or hostile-process fence.
 * Own staging is retired after confirmed handle closure. Published verified
 * cache entries remain retained; another task may already reference them. */
export function createApprovedImageCheckpointResolverAdapter(dependencies: {
  readonly models: Pick<ModelRegistryPort, "readRecordedModel">;
  readonly reference: RegisteredImageCheckpointReference;
  readonly checkpointDirectory: string;
  readonly maximumCheckpointBytes: number;
  readonly minimumFreeDiskBytes: number;
}): ApprovedImageGenerationAdmission["resolveCheckpoint"] {
  const raw = record(dependencies.reference, ["workspaceId", "modelRecordId", "updatedAt", "fileName", "byteLength", "sha256"]);
  const reference = Object.freeze({...raw}) as unknown as RegisteredImageCheckpointReference;
  const root = dependencies.checkpointDirectory, maximum = dependencies.maximumCheckpointBytes, reserve = dependencies.minimumFreeDiskBytes;
  if (typeof reference.workspaceId !== "string" || !reference.workspaceId || reference.workspaceId.length > 200 ||
      typeof reference.modelRecordId !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:@-]{0,199}$/.test(reference.modelRecordId) || reference.modelRecordId.includes("..") ||
      typeof reference.updatedAt !== "string" || !Number.isFinite(Date.parse(reference.updatedAt)) || new Date(reference.updatedAt).toISOString() !== reference.updatedAt ||
      !fileName(reference.fileName) || !Number.isSafeInteger(maximum) || maximum < 1 || !Number.isSafeInteger(reserve) || reserve < 0 ||
      !Number.isSafeInteger(reference.byteLength) || reference.byteLength < 1 || reference.byteLength > maximum ||
      typeof reference.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(reference.sha256) || typeof root !== "string" || !path.isAbsolute(root)) throw unavailable();
  const readModel = dependencies.models.readRecordedModel?.bind(dependencies.models);
  const targetName = "aisb-" + reference.sha256 + ".safetensors", target = path.join(root, targetName);
  let retirementUnconfirmed = false, active = false;
  const verify = async (file: string, fence: ApprovedImageGenerationFence) => {
    const before = await plainFile(file, reference.byteLength, fence.assertCurrent); fence.assertCurrent();
    let digest: Awaited<ReturnType<typeof checkpointFileDigest>>;
    try {digest = await checkpointFileDigest(file, reference.byteLength, fence.assertCurrent);}
    catch (error) {
      if (error instanceof CheckpointReadCloseUnconfirmedError) retirementUnconfirmed = true;
      throw error;
    }
    const after = await plainFile(file, reference.byteLength, fence.assertCurrent); fence.assertCurrent();
    if (!same(before, after) || before.mtimeNs !== after.mtimeNs || digest.sha256 !== reference.sha256 || digest.byteLength !== reference.byteLength) throw unavailable();
  };
  return async (request, fence) => {
    if (active || retirementUnconfirmed) throw unavailable();
    active = true;
    let staging: string | undefined, stagingIdentity: BigIntStats | undefined;
    let originalRoot: BigIntStats | undefined, handlesClosed = true, writerClosed = true, stagingOpened = false;
    try {
      const input = record(request, ["selectedModel", "workspaceId", "taskTag"]);
      if (input.selectedModel !== reference.modelRecordId || input.workspaceId !== reference.workspaceId || input.taskTag !== "text-to-image" || !readModel) throw unavailable();
      await fence.authorize(); fence.assertCurrent();
      const selected = modelSnapshot(await readModel(reference.workspaceId as never, reference.modelRecordId));
      await fence.authorize(); fence.assertCurrent();
      if (selected.workspaceId !== reference.workspaceId || selected.modelRecordId !== reference.modelRecordId || selected.updatedAt !== reference.updatedAt ||
          !["downloaded", "generated", "validated"].includes(selected.lifecycleStatus as string) ||
          !["full-model", "merged-model", "checkpoint"].includes(selected.artifactForm as string) || selected.serializationFormat !== "safetensors" ||
          !Array.isArray(selected.taskTags) || !selected.taskTags.includes("text-to-image") || typeof selected.localPath !== "string" ||
          selected.localPath.length > 4096 || /[\x00-\x1f\x7f]/.test(selected.localPath)) throw unavailable();
      const sourceRoot = selected.localPath, source = path.join(sourceRoot, reference.fileName);
      await plainDirectory(sourceRoot, fence.assertCurrent); originalRoot = await plainDirectory(root, fence.assertCurrent); fence.assertCurrent();
      await verify(source, fence);
      const currentModel = async () => {
        await fence.authorize(); fence.assertCurrent();
        const current = modelSnapshot(await readModel(reference.workspaceId as never, reference.modelRecordId));
        await fence.authorize(); fence.assertCurrent();
        if (!isDeepStrictEqual(current, selected) || !same(originalRoot!, await plainDirectory(root, fence.assertCurrent))) throw unavailable();
        fence.assertCurrent();
      };
      try {
        fence.assertCurrent(); await lstat(target); await verify(target, fence); await currentModel();
        return {checkpoint: targetName};
      } catch (error) {if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;}
      fence.assertCurrent(); const space = await statfs(root, {bigint: true}); fence.assertCurrent();
      if (space.bavail * space.bsize < BigInt(reference.byteLength) + BigInt(reserve)) throw unavailable();
      staging = path.join(root, ".aisb-stage-" + randomUUID());
      await fence.authorize(); fence.assertCurrent();
      if (!same(originalRoot, await plainDirectory(root, fence.assertCurrent))) throw unavailable();
      fence.assertCurrent();
      const reader = await open(source, "r"); handlesClosed = false;
      try {
        if (!same(originalRoot, await plainDirectory(root, fence.assertCurrent))) throw unavailable();
        fence.assertCurrent(); const writer = await open(staging, "wx"); writerClosed = false; stagingOpened = true;
        try {
          stagingIdentity = await writer.stat({bigint: true}); fence.assertCurrent(); const originalSource = await reader.stat({bigint: true});
          if (!originalSource.isFile() || originalSource.nlink !== 1n || originalSource.size !== BigInt(reference.byteLength)) throw unavailable();
          const hash = createHash("sha256"), buffer = Buffer.alloc(64 * 1024); let copied = 0;
          for (;;) {
            fence.assertCurrent(); const read = await reader.read(buffer, 0, buffer.length, null);
            if (!read.bytesRead) break;
            copied += read.bytesRead; if (copied > reference.byteLength) throw unavailable();
            hash.update(buffer.subarray(0, read.bytesRead)); let offset = 0;
            while (offset < read.bytesRead) {
              fence.assertCurrent(); const written = await writer.write(buffer, offset, read.bytesRead - offset, null);
              if (!written.bytesWritten) throw unavailable(); offset += written.bytesWritten;
            }
          }
          fence.assertCurrent(); const finalSource = await reader.stat({bigint: true});
          if (!same(originalSource, finalSource) || originalSource.size !== finalSource.size || originalSource.mtimeNs !== finalSource.mtimeNs ||
              copied !== reference.byteLength || hash.digest("hex") !== reference.sha256) throw unavailable();
          fence.assertCurrent(); await writer.sync();
        } finally {
          try {await writer.close(); writerClosed = true;} catch {retirementUnconfirmed = true; throw unavailable();}
        }
      } finally {
        try {await reader.close(); handlesClosed = writerClosed;} catch {retirementUnconfirmed = true; throw unavailable();}
      }
      await verify(staging, fence); await currentModel();
      await fence.authorize(); fence.assertCurrent();
      if (!same(originalRoot, await plainDirectory(root, fence.assertCurrent))) throw unavailable();
      fence.assertCurrent();
      try {await link(staging, target);} catch (error) {if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;}
      // Remove only our closed original staging name, preserving the cache entry.
      const own = await lstat(staging, {bigint: true});
      if (!stagingIdentity || own.dev !== stagingIdentity.dev || own.ino !== stagingIdentity.ino || own.nlink > 2n || !same(originalRoot, await plainDirectory(root))) throw unavailable();
      await unlink(staging); staging = undefined;
      await verify(target, fence); await currentModel();
      return {checkpoint: targetName};
    } catch {throw unavailable();}
    finally {
      try {
      if (staging && stagingOpened && (!stagingIdentity || !originalRoot || !handlesClosed)) retirementUnconfirmed = true;
      if (staging && stagingIdentity && originalRoot && handlesClosed && !retirementUnconfirmed) {
        try {
          const own = await lstat(staging, {bigint: true});
          if (!own.isFile() || own.isSymbolicLink() || own.dev !== stagingIdentity.dev || own.ino !== stagingIdentity.ino || own.nlink > 2n ||
              !same(originalRoot, await plainDirectory(root))) throw unavailable();
          await unlink(staging);
        } catch {retirementUnconfirmed = true; throw unavailable();}
      }
      } finally {active = false;}
    }
  };
}
