import { constants } from "node:fs";
import { copyFile, mkdir, open, readdir, stat } from "node:fs/promises";
import {createHash} from "node:crypto";
import { extname, join } from "node:path";

import type { ModelRegistryPort, ModelCheckpointResolverPort } from "../../../application/ports/model";

const CHECKPOINT_EXTENSIONS = [".safetensors", ".ckpt"] as const;

export class CheckpointReadCloseUnconfirmedError extends Error {
  constructor() {super("Checkpoint read closure is unconfirmed.");}
}

/** Stream a regular file with constant memory and detect mutation during reading.
 * Exact-profile callers separately reject aliased paths and supply pinned bounds. */
export async function checkpointFileDigest(file: string, maximumBytes: number, assertCurrent: () => void = () => {}) {
  assertCurrent(); const handle = await open(file, "r");
  try {
    const before = await handle.stat({bigint: true});
    if (!before.isFile() || !Number.isSafeInteger(maximumBytes) || maximumBytes < 0 || before.size > BigInt(maximumBytes)) throw Error("Checkpoint bytes are unavailable.");
    const hash = createHash("sha256"), buffer = Buffer.alloc(64 * 1024); let size = 0;
    for (;;) {
      assertCurrent(); const read = await handle.read(buffer, 0, buffer.length, null);
      size += read.bytesRead;
      if (size > maximumBytes) throw Error("Checkpoint bytes exceed their bound.");
      if (!read.bytesRead) break;
      hash.update(buffer.subarray(0, read.bytesRead));
    }
    const after = await handle.stat({bigint: true}); assertCurrent();
    if (before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size || before.mtimeNs !== after.mtimeNs || BigInt(size) !== before.size) throw Error("Checkpoint bytes changed.");
    return {sha256: hash.digest("hex"), byteLength: size};
  } finally {
    try {await handle.close();} catch {throw new CheckpointReadCloseUnconfirmedError();}
  }
}

function normalize(value: string | undefined): string | undefined {
  const v = value?.trim();
  return v ? v : undefined;
}

function isCheckpointFile(fileName: string): boolean {
  const lower = fileName.toLowerCase();
  return CHECKPOINT_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

function score(fileName: string): number {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".safetensors")) return 0;
  if (lower.endsWith(".ckpt")) return 1;
  return 99;
}

function withSuffix(fileName: string, suffix: string): string {
  const ext = extname(fileName);
  const base = ext.length > 0 ? fileName.slice(0, -ext.length) : fileName;
  return `${base}${suffix}${ext}`;
}

async function ensureComfyUiVisibleCheckpoint(input: {
  sourceFilePath: string;
  checkpointName: string;
  checkpointDirectory: string;
  log?: (entry: Record<string, unknown>) => void;
}): Promise<string> {
  await mkdir(input.checkpointDirectory, { recursive: true });
  const preferredTargetPath = join(input.checkpointDirectory, input.checkpointName);
  try {
    const existing = await stat(preferredTargetPath);
    const source = await stat(input.sourceFilePath);
    if (existing.isFile() && source.isFile() && existing.size === source.size &&
        (await checkpointFileDigest(input.sourceFilePath, source.size)).sha256 ===
        (await checkpointFileDigest(preferredTargetPath, source.size)).sha256) {
      input.log?.({ event: "image-generation.model-checkpoint-resolution.sync.skipped", reason: "already-exists", targetPath: preferredTargetPath });
      return input.checkpointName;
    }
  } catch (error) {if (error instanceof CheckpointReadCloseUnconfirmedError) throw error;}

  let targetName = input.checkpointName;
  let targetPath = preferredTargetPath;
  let attempt = 0;
  while (attempt < 20) {
    try {
      await copyFile(input.sourceFilePath, targetPath, constants.COPYFILE_EXCL);
      input.log?.({ event: "image-generation.model-checkpoint-resolution.sync.completed", sourcePath: input.sourceFilePath, targetPath, targetName });
      return targetName;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "EEXIST") throw error;
      attempt += 1;
      targetName = withSuffix(input.checkpointName, `-${attempt.toString().padStart(2, "0")}`);
      targetPath = join(input.checkpointDirectory, targetName);
    }
  }
  throw new Error(`Unable to synchronize checkpoint '${input.checkpointName}' into ComfyUI checkpoint directory after deterministic collision retries.`);
}

export function createLocalModelCheckpointResolverAdapter(deps: {
  modelRegistry: ModelRegistryPort;
  comfyUiCheckpointDirectory?: string;
  log?: (entry: Record<string, unknown>) => void;
}): ModelCheckpointResolverPort {
  return {
    async resolveCheckpoint(request) {
      const selected = normalize(request.selectedModel);
      if (!selected) return {};
      if (isCheckpointFile(selected) && !selected.includes("/") && !selected.includes("\\")) return { checkpoint: selected };

      const models = await deps.modelRegistry.listModels({ workspaceId: request.workspaceId as never, search: selected, limit: 200 });
      const record = models.models.find((m) => [m.modelRecordId, m.modelId, m.displayName, m.localPath].some((x) => normalize(x) === selected));
      if (!record) {
        throw new Error(`No matching downloaded model record found for selected model '${selected}'. Choose a downloaded checkpoint-compatible model or provide a checkpoint filename (${CHECKPOINT_EXTENSIONS.join(", ")}).`);
      }

      const localPath = normalize(record.localPath);
      deps.log?.({ event: "image-generation.model-checkpoint-resolution.started", selectedModel: selected, matchedModelRecordId: record.modelRecordId, modelId: record.modelId, localPath, provider: record.provider, source: record.source });
      if (!localPath) {
        throw new Error(`Unable to resolve ComfyUI checkpoint for selected model '${selected}'. Matched model record: ${record.modelRecordId}. No local model folder is recorded. Download a checkpoint-format model (${CHECKPOINT_EXTENSIONS.join(", ")}) and try again.`);
      }

      let files: string[];
      try {
        files = await readdir(localPath);
      } catch {
        throw new Error(`Unable to resolve ComfyUI checkpoint for selected model '${selected}'. Matched model record: ${record.modelRecordId}. Local folder checked: ${localPath}. Supported extensions: ${CHECKPOINT_EXTENSIONS.join(", ")}. Synchronization attempted: no.`);
      }

      const metadataCheckpointFile = typeof record.metadata?.checkpointFile === "string" ? record.metadata.checkpointFile.trim() : undefined;
      const candidates = files.filter(isCheckpointFile).sort((a, b) => {
        if (metadataCheckpointFile && a === metadataCheckpointFile) return -1;
        if (metadataCheckpointFile && b === metadataCheckpointFile) return 1;
        return score(a) - score(b) || a.localeCompare(b);
      });
      if (candidates.length === 0) {
        throw new Error(`Downloaded model '${selected}' is not currently usable as a ComfyUI checkpoint. Matched model record: ${record.modelRecordId}. Local folder checked: ${localPath}. Supported extensions: ${CHECKPOINT_EXTENSIONS.join(", ")}. Synchronization attempted: no. Next action: download a checkpoint-format model artifact.`);
      }

      const chosen = candidates[0];
      const sourceFilePath = join(localPath, chosen);
      let checkpoint = chosen;
      let synchronizationAttempted = false;
      if (deps.comfyUiCheckpointDirectory) {
        synchronizationAttempted = true;
        checkpoint = await ensureComfyUiVisibleCheckpoint({
          sourceFilePath,
          checkpointName: chosen,
          checkpointDirectory: deps.comfyUiCheckpointDirectory,
          log: deps.log,
        });
      }

      deps.log?.({ event: "image-generation.model-checkpoint-resolution.selected", selectedModel: selected, matchedModelRecordId: record.modelRecordId, sourceCheckpointPath: sourceFilePath, comfyUiCheckpointName: checkpoint, synchronizationAttempted, comfyUiCheckpointDirectory: deps.comfyUiCheckpointDirectory });
      return { checkpoint };
    },
  };
}
