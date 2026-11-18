import {createHash} from "node:crypto";
import type {ApplicationRequestContext} from "../../ports";
import {APPROVED_CONTEXT_MAX_SOURCES, APPROVED_CONTEXT_MAX_SOURCE_BYTES, APPROVED_CONTEXT_MAX_LICENSE_CHARACTERS,
  type ApprovedContextGenerationAdmission} from "../../ports/context-management";
import {copyBoundedPassiveData, hasKnownPassiveCredential, readStrictPassiveRecord} from "../../../contracts/shared";
import {validateStartContextGenerationCommand, type StartContextGenerationCommand} from "../../../contracts/context-management";
import {isWorkspaceId} from "../../../contracts/workspace";
import {normalizeStorageArtifactKey} from "../../../contracts/storage";

const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const digest = /^sha256:[a-f0-9]{64}$/;
export function contextCommandDigest(command: StartContextGenerationCommand): string {
  return "sha256:" + createHash("sha256").update(JSON.stringify(validateStartContextGenerationCommand(command))).digest("hex");
}

/** Copy data before awaiting anything. Function capabilities must be own data descriptors. */
export function readApprovedContextAdmission(rawCommand: StartContextGenerationCommand, context: ApplicationRequestContext,
  admission: ApprovedContextGenerationAdmission): {command: StartContextGenerationCommand; admission: ApprovedContextGenerationAdmission} | undefined {
  try {
    const raw = readStrictPassiveRecord(admission, ["taskId", "organizationId", "principalId", "workspaceId", "commandDigest", "sources",
      "isCurrent", "stillAllowed", "issue"]);
    if (!isWorkspaceId(context.workspaceId) || !context.organizationId || !context.principalId ||
        raw.organizationId !== context.organizationId || raw.principalId !== context.principalId || raw.workspaceId !== context.workspaceId ||
        typeof raw.taskId !== "string" || !uuid.test(raw.taskId) || typeof raw.commandDigest !== "string" || !digest.test(raw.commandDigest) ||
        typeof raw.isCurrent !== "function" || typeof raw.stillAllowed !== "function" || typeof raw.issue !== "function") return;
    const copied = copyBoundedPassiveData(rawCommand) as unknown as StartContextGenerationCommand;
    readStrictPassiveRecord(copied, ["kind", "name", "sources", "manualEntries", "chunking", "sourceChecks", "embedding", "contextPack"]);
    if ((copied.kind !== "rag-database" && copied.kind !== "markdown-context-pack") || !Array.isArray(copied.sources) ||
        copied.sources.length < 1 || copied.sources.length > APPROVED_CONTEXT_MAX_SOURCES) return;
    for (const source of copied.sources) readStrictPassiveRecord(source, ["artifactId"]);
    if (copied.sourceChecks !== undefined) readStrictPassiveRecord(copied.sourceChecks,
      ["preset", "allowedLanguages", "requireLicenseMetadata", "requireConsentMetadata", "includeSourceAttribution"]);
    const command = validateStartContextGenerationCommand(copied);
    if (contextCommandDigest(command) !== raw.commandDigest || hasKnownPassiveCredential(command.name) ||
        command.sources.length < 1 || command.sources.length > APPROVED_CONTEXT_MAX_SOURCES || command.manualEntries?.length ||
        !Number.isSafeInteger(command.chunking.maximumChunks) || command.chunking.maximumChunks! < 1 || command.chunking.maximumChunks! > 1000) return;
    readStrictPassiveRecord(command.chunking, ["strategy", "chunkCharacters", "overlapCharacters", "maximumChunks", "textFields"]);
    if (command.kind === "rag-database") {
      const embedding = command.embedding;
      if (!embedding || command.chunking.strategy !== "fixed-length" || embedding.provider !== "transformers" || hasKnownPassiveCredential(embedding.modelId) ||
          (embedding.device !== "cpu" && embedding.device !== "cuda") || !Number.isSafeInteger(embedding.batchSize) ||
          embedding.batchSize! < 1 || embedding.batchSize! > 32 || !command.sourceChecks) return;
      readStrictPassiveRecord(embedding, ["provider", "modelId", "batchSize", "device"]);
      readStrictPassiveRecord(command.sourceChecks, ["preset", "allowedLanguages", "requireLicenseMetadata", "requireConsentMetadata", "includeSourceAttribution"]);
    } else {
      const pack = command.contextPack;
      if (!pack || command.chunking.strategy !== "topic-aware" || pack.inputMode !== "source-materials" || pack.method !== "none") return;
      readStrictPassiveRecord(pack, ["inputMode", "method", "cleaningPreset"]);
    }
    const sourceData = copyBoundedPassiveData(raw.sources);
    if (!Array.isArray(sourceData) || sourceData.length !== command.sources.length) return;
    const sources = sourceData.map((value, index) => {
      const source = readStrictPassiveRecord(value, ["artifactId", "storageKey", "digest", "sizeBytes", "mediaType", "format", "declaredLicense"]);
      if (source.artifactId !== command.sources[index].artifactId || typeof source.storageKey !== "string" ||
          normalizeStorageArtifactKey(source.storageKey) !== source.storageKey || typeof source.digest !== "string" || !digest.test(source.digest) ||
          !Number.isSafeInteger(source.sizeBytes) || (source.sizeBytes as number) < 1 || (source.sizeBytes as number) > APPROVED_CONTEXT_MAX_SOURCE_BYTES ||
          typeof source.mediaType !== "string" || source.mediaType.length < 1 || source.mediaType.length > 128 ||
          !["csv", "json", "jsonl", "parquet", "text", "markdown", "html", "pdf", "docx"].includes(source.format as string)) throw new Error("Invalid Context source binding.");
      if (source.declaredLicense !== undefined && (typeof source.declaredLicense !== "string" || !source.declaredLicense.trim() ||
          source.declaredLicense !== source.declaredLicense.trim() || source.declaredLicense.length > APPROVED_CONTEXT_MAX_LICENSE_CHARACTERS ||
          hasKnownPassiveCredential(source.declaredLicense) || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(source.declaredLicense)))
        throw new Error("Invalid declared Context source license.");
      return source as unknown as ApprovedContextGenerationAdmission["sources"][number];
    });
    if (new Set(sources.map(source => source.storageKey)).size !== sources.length) return;
    return {command, admission: {taskId: raw.taskId, organizationId: context.organizationId, principalId: context.principalId,
      workspaceId: context.workspaceId, commandDigest: raw.commandDigest, sources,
      isCurrent: raw.isCurrent as ApprovedContextGenerationAdmission["isCurrent"],
      stillAllowed: raw.stillAllowed as ApprovedContextGenerationAdmission["stillAllowed"],
      issue: raw.issue as ApprovedContextGenerationAdmission["issue"]}};
  } catch {return;}
}

export async function approvedContextAdmissionCurrent(admission: ApprovedContextGenerationAdmission): Promise<boolean> {
  try {return admission.isCurrent() && await admission.stillAllowed() && admission.isCurrent();} catch {return false;}
}
