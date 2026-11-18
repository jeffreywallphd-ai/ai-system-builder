import {createHash} from "node:crypto";
import type {ModelInventoryRecord} from "../../../contracts/model";
import {isHeadlessContextModelId, isHeadlessContextTimestamp} from "../../../contracts/headless";
import {copyBoundedPassiveData, hasKnownPassiveCredential, readStrictPassiveRecord} from "../../../contracts/shared";
import type {ApprovedContextEmbeddingModelWitness} from "../../ports/context-management";

const selectedFields = ["workspaceId", "modelRecordId", "modelId", "localPath", "createdAt", "updatedAt", "source", "lifecycleStatus",
  "artifactForm", "provider", "validationStatus", "serializationFormat", "sizeBytes", "taskTags", "storageScope"] as const;

/** Hash only selected recorded facts. Never discover files or expose paths through the witness. */
export function prepareApprovedContextEmbeddingModel(model: ModelInventoryRecord, workspaceId: string):
  {readonly witness: ApprovedContextEmbeddingModelWitness; readonly localPath: string} | undefined {
  try {
    if (!model || ![Object.prototype, null].includes(Object.getPrototypeOf(model))) return;
    const fields: Record<string, unknown> = {};
    for (const name of selectedFields) {
      const descriptor = Object.getOwnPropertyDescriptor(model, name);
      if (descriptor && !("value" in descriptor)) return;
      if (descriptor?.value !== undefined) fields[name] = descriptor.value;
    }
    const snapshot = copyBoundedPassiveData(fields) as Record<string, unknown>;
    const updatedAt = snapshot.updatedAt ?? snapshot.createdAt;
    if (snapshot.workspaceId !== workspaceId || !isHeadlessContextModelId(snapshot.modelRecordId) || !isHeadlessContextTimestamp(updatedAt) ||
        typeof snapshot.modelId !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,95}\/[A-Za-z0-9][A-Za-z0-9._-]{0,95}$/.test(snapshot.modelId) ||
        hasKnownPassiveCredential(snapshot.modelId) || typeof snapshot.localPath !== "string" || snapshot.localPath.length < 1 ||
        snapshot.localPath.length > 4096 || snapshot.localPath !== snapshot.localPath.trim() || /[\u0000-\u001f\u007f]/u.test(snapshot.localPath) ||
        snapshot.artifactForm !== "full-model" || snapshot.validationStatus === "invalid" || snapshot.storageScope === "shared" ||
        (snapshot.serializationFormat !== undefined && snapshot.serializationFormat !== "safetensors") ||
        !["downloaded", "generated", "validated"].includes(snapshot.lifecycleStatus as string) ||
        !Array.isArray(snapshot.taskTags) || snapshot.taskTags.length > 32 || !snapshot.taskTags.includes("embeddings") ||
        snapshot.taskTags.some(tag => typeof tag !== "string" || tag.length > 64)) return;
    const witness = Object.freeze({modelRecordId: snapshot.modelRecordId, modelUpdatedAt: updatedAt, modelId: snapshot.modelId,
      recordDigest: "sha256:" + createHash("sha256").update(JSON.stringify(snapshot)).digest("hex")});
    return Object.freeze({witness, localPath: snapshot.localPath});
  } catch {return;}
}

export function compileApprovedContextEmbeddingModel(model: ModelInventoryRecord, workspaceId: string): ApprovedContextEmbeddingModelWitness | undefined {
  return prepareApprovedContextEmbeddingModel(model, workspaceId)?.witness;
}

export function readApprovedContextEmbeddingModelWitness(value: unknown): ApprovedContextEmbeddingModelWitness | undefined {
  try {
    const raw = readStrictPassiveRecord(copyBoundedPassiveData(value), ["modelRecordId", "modelUpdatedAt", "modelId", "recordDigest"]);
    if (Object.keys(raw).length !== 4 || !isHeadlessContextModelId(raw.modelRecordId) || !isHeadlessContextTimestamp(raw.modelUpdatedAt) ||
        typeof raw.modelId !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,95}\/[A-Za-z0-9][A-Za-z0-9._-]{0,95}$/.test(raw.modelId) ||
        hasKnownPassiveCredential(raw.modelId) || typeof raw.recordDigest !== "string" || !/^sha256:[a-f0-9]{64}$/.test(raw.recordDigest)) return;
    return Object.freeze({modelRecordId: raw.modelRecordId, modelUpdatedAt: raw.modelUpdatedAt, modelId: raw.modelId, recordDigest: raw.recordDigest});
  } catch {return;}
}
