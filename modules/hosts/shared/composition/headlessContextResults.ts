import {createHash} from "node:crypto";
import type {StructuredDocumentStore} from "../../../adapters/persistence/shared";
import {readStructuredOwnedContextPlanTaskSourceDigest} from "../../../adapters/persistence/system-builder/createStructuredHeadlessContextPlanTaskStore";
import type {HeadlessOperationScope} from "../../../application/ports/system-builder";
import type {ContextGenerationUseCase} from "../../../application/use-cases/context-management";
import type {PreparedContextResultReview} from "../../../application/ports/context-management";
import type {ContextSavedArtifactReference} from "../../../contracts/context-management";
import {reserveStructuredContextResultSave, inspectStructuredContextResultSave, issueStructuredContextResultSave,
  commitStructuredContextResultSave, readCommittedStructuredContextResult, type ContextResultSaveEffect}
  from "../../../adapters/persistence/system-builder/createStructuredHeadlessContextResultStore";

/** Metadata only inside the caller's owning organization transaction. The
 * already-instantiated processor is supplied, so compilation cannot open runtime
 * dependencies. Current approval/policy fencing is the caller's obligation. */
export async function compileHeadlessContextResultInputs(documents: StructuredDocumentStore, scope: HeadlessOperationScope,
  hostIncarnationId: string, taskId: string, reportFingerprint: string,
  processor: Pick<ContextGenerationUseCase, "peekAdmittedContextSaveInputs">, stillAllowed: () => Promise<boolean>) {
  if (!await stillAllowed()) return;
  const admittedSourceDigest = await readStructuredOwnedContextPlanTaskSourceDigest(documents, scope, hostIncarnationId, taskId);
  if (!admittedSourceDigest || !await stillAllowed()) return;
  const prepared = processor.peekAdmittedContextSaveInputs(taskId, scope);
  if (!prepared || prepared.review.reportFingerprint !== reportFingerprint || !await stillAllowed()) return;
  return {prepared, admittedSourceDigest};
}

/** Private composition for the future approved result-save step. The trusted
 * caller must supply an exact save-specific approval/policy check using only the
 * provided transaction. A general task-start approval is not save authority.
 * This helper does not register or advertise any transport operation. */
export function composeHeadlessContextResultSave(options: {
  readonly documents: StructuredDocumentStore;
  readonly rootDirectory: string;
  readonly effect: ContextResultSaveEffect;
  readonly processor: Pick<ContextGenerationUseCase, "peekAdmittedContextSaveInputs">;
  readonly isCurrent: () => boolean;
  readonly authorizeExactSave: (owner: StructuredDocumentStore, effect: ContextResultSaveEffect) => Promise<boolean>;
  readonly now?: () => number;
}) {
  const {documents, rootDirectory, processor, isCurrent, authorizeExactSave} = options;
  const effect = structuredClone(options.effect), now = options.now ?? Date.now;
  if (documents.organizationId !== undefined || !documents.runInOwnedTransaction ||
      typeof isCurrent !== "function" || typeof authorizeExactSave !== "function")
    throw new Error("Context result saving requires the platform owner and an exact save authorizer.");
  const transaction = documents.runInOwnedTransaction.bind(documents);
  const protect = () => {if (!isCurrent()) throw new Error("The approved Context save ended.");};
  async function authorized(owner: StructuredDocumentStore) {
    if (!isCurrent() || !await authorizeExactSave(owner, effect) || !isCurrent()) return;
    return owner.forOrganization(effect.target.scope.organizationId);
  }
  async function compile(owner: StructuredDocumentStore) {
    const partition = await authorized(owner); if (!partition) return;
    return compileHeadlessContextResultInputs(partition, effect.target.scope, effect.target.hostIncarnationId,
      effect.taskId, effect.reportFingerprint, processor, async () => isCurrent() && await authorizeExactSave(owner, effect) && isCurrent());
  }
  const sum = (prepared: PreparedContextResultReview, sourceDigest: string) =>
    createHash("sha256").update(JSON.stringify([sourceDigest, prepared]), "utf8").digest("hex");
  return {
    async inspect() {
      try {return await transaction(async owner => {
        const partition = await authorized(owner);
        return partition ? inspectStructuredContextResultSave(partition, rootDirectory, effect) : undefined;
      }, protect);} catch {return;}
    },
    async reserve() {
      try {return await transaction(async owner => {
        const partition = await authorized(owner); if (!partition) return;
        const existing = await inspectStructuredContextResultSave(partition, rootDirectory, effect);
        if (existing.kind !== "absent") return existing;
        const compiled = await compile(owner); if (!compiled) return;
        const reserved = await reserveStructuredContextResultSave(partition, effect, compiled.prepared, compiled.admittedSourceDigest, now());
        return reserved.kind === "new" ? {...reserved, sourceDigest: compiled.admittedSourceDigest,
          reviewDigest: sum(compiled.prepared, compiled.admittedSourceDigest)} : reserved;
      }, protect);} catch {return;}
    },
    async issue(saveId: string, sourceDigest: string, reviewDigest: string): Promise<"issued" | "denied" | "unconfirmed"> {
      try {return await transaction(async owner => {
        const partition = await authorized(owner); if (!partition) return "denied" as const;
        const compiled = await compile(owner);
        if (!compiled || sum(compiled.prepared, compiled.admittedSourceDigest) !== reviewDigest || compiled.admittedSourceDigest !== sourceDigest)
          return "denied" as const;
        return await issueStructuredContextResultSave(partition, effect, saveId, sourceDigest, now()) ? "issued" as const : "unconfirmed" as const;
      }, protect);} catch {return "unconfirmed";}
    },
    async commit(saveId: string, sourceDigest: string, reviewDigest: string, artifact: ContextSavedArtifactReference) {
      // Capture the primitive descriptor before transaction retries or any await.
      const candidate = structuredClone(artifact);
      try {return await transaction(async owner => {
        const partition = await authorized(owner); if (!partition) throw new Error("Context publication is unavailable.");
        const compiled = await compile(owner);
        if (!compiled || sum(compiled.prepared, compiled.admittedSourceDigest) !== reviewDigest || compiled.admittedSourceDigest !== sourceDigest)
          throw new Error("Context publication is unavailable.");
        return commitStructuredContextResultSave(partition, rootDirectory, effect, saveId, sourceDigest, candidate, now());
      }, protect);} catch {
        // One exact read-only reconciliation may confirm a lost commit reply.
        // It never republishes bytes/metadata and is not outward authority.
        return transaction(async owner => {
          const saved = await readCommittedStructuredContextResult(owner.forOrganization(effect.target.scope.organizationId), rootDirectory,
            effect, {saveId, sourceDigest});
          if (!saved || Object.keys(candidate).length !== Object.keys(saved.artifact).length ||
              !Object.entries(saved.artifact).every(([key, value]) => candidate[key as keyof typeof candidate] === value))
            throw new Error("Context publication is unconfirmed.");
          return {...saved, created: false};
        }, () => {});
      }
    },
    async readReceipt() {
      try {return await transaction(async owner => {
        const partition = await authorized(owner);
        return partition ? readCommittedStructuredContextResult(partition, rootDirectory, effect) : undefined;
      }, protect);} catch {return;}
    },
  };
}
