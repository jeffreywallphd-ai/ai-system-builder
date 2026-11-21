import type {StructuredDocumentStore} from "../../../adapters/persistence/shared";
import {captureModelReferenceSaveEffect, commitStructuredModelReferenceSave, inspectStructuredModelReferenceSave,
  type ModelReferenceSaveEffect} from "../../../adapters/persistence/system-builder/createStructuredHeadlessModelReferenceStore";
import {readStructuredOwnedModelPlanTaskSourceDigest} from "../../../adapters/persistence/system-builder/createStructuredHeadlessModelPlanTaskStore";
import type {ModelDownloadTasksUseCase} from "../../../application/use-cases/model/model-download-tasks.use-case";
import {isHeadlessReadCurrent} from "./headlessReadCurrent";
import {isDeepStrictEqual} from "node:util";
import {createHash} from "node:crypto";
import type {HeadlessPlanReviewTarget} from "../../../application/ports/system-builder/headless-build-plan-review.port";
import {readHeadlessModelReferenceSavePlanRequest, readHeadlessPlanStepResult, type HeadlessBuildPlanRequest,
  type HeadlessModelReferenceSavePlanRequest, type HeadlessPlanStepRequest} from "../../../contracts/headless";
import {copyHeadlessModelPlanData} from "./headlessModelDownloadReview";
import type {prepareStructuredHeadlessPlanStepWithModels} from "../../../adapters/persistence/system-builder/createStructuredHeadlessPlanStepOperationStore";

export type HeadlessModelReferenceSaveOwner = Pick<ModelDownloadTasksUseCase, "peekApprovedSourceRegistration">;
type PreparedModelReferenceStep = Extract<NonNullable<Awaited<ReturnType<typeof prepareStructuredHeadlessPlanStepWithModels>>>, {kind: "model-reference"}>;
function freeze<T>(value: T): T {
  if (value && typeof value === "object") {for (const child of Object.values(value)) freeze(child); Object.freeze(value);}
  return value;
}

/** Cached owner access is outside proposal transactions. The returned validator
 * only compares frozen facts and accepted ledger point reads in its given owner. */
export async function prepareHeadlessModelReferenceSaveReviews(options: {
  readonly documents: StructuredDocumentStore; readonly target: HeadlessPlanReviewTarget;
  readonly requests: readonly HeadlessBuildPlanRequest[]; readonly isCurrent: () => boolean;
  readonly stillAllowed: () => Promise<boolean>; readonly peekOwner: () => HeadlessModelReferenceSaveOwner | undefined;
}) {
  const {documents, isCurrent, stillAllowed, peekOwner} = options, current = () => isHeadlessReadCurrent(isCurrent);
  const forbidden = {ok: false, code: "headless.forbidden"} as const;
  const unavailable = {ok: false, code: "headless.unavailable"} as const;
  try {
    if (documents.organizationId !== undefined || !documents.runInOwnedTransaction) return forbidden;
    const requests = copyHeadlessModelPlanData(options.requests) as HeadlessBuildPlanRequest[];
    const selected = requests.flatMap((request, index) => request.operation === "models.save-download" ? [{request, step: index + 1}] : []);
    if (!selected.length) return forbidden;
    const first = selected[0];
    const target = captureModelReferenceSaveEffect({key: first.request.input.idempotencyKey, target: options.target, approvalRevision: 1,
      step: first.step, taskId: first.request.input.taskId, manifestDigest: first.request.input.sourceManifest.manifestDigest, name: first.request.input.name}).target;
    if (!current() || await stillAllowed() !== true || !current()) return forbidden;
    const transaction = documents.runInOwnedTransaction.bind(documents);
    let prepare: HeadlessModelReferenceSaveOwner["peekApprovedSourceRegistration"] | undefined;
    const prepared: {request: HeadlessModelReferenceSavePlanRequest; sourceCurrent: () => boolean}[] = [];
    for (const selection of selected) {
      const parsed = readHeadlessModelReferenceSavePlanRequest(selection.request, target.hostIncarnationId);
      if (!parsed.ok || parsed.request.input.workspaceId !== target.scope.workspaceId) return forbidden;
      const request = freeze(parsed.request), input = request.input;
      const expectedDigest = createHash("sha256").update(JSON.stringify(input.sourceManifest.source), "utf8").digest("hex");
      if (input.sourceManifest.manifestDigest !== "sha256:" + expectedDigest) return unavailable;
      const admitted = await transaction(owner => readStructuredOwnedModelPlanTaskSourceDigest(owner.forOrganization(target.scope.organizationId),
        target.scope, target.hostIncarnationId, input.taskId), () => {if (!current()) throw new Error("Model save review ended.");});
      if (admitted !== expectedDigest || !current() || await stillAllowed() !== true || !current()) return forbidden;
      if (!prepare) {
        const model = peekOwner(); if (!model || !current()) return unavailable;
        prepare = model.peekApprovedSourceRegistration.bind(model);
      }
      const snapshot = await prepare({workspaceId: input.workspaceId, requestId: input.taskId}, input.sourceManifest.manifestDigest,
        {organizationId: target.scope.organizationId, principalId: target.scope.principalId, modelWriteAuthorized: true});
      if (!snapshot || !current() || await stillAllowed() !== true || !current()) return unavailable;
      const sourceCurrent = snapshot.isOriginalSourceCurrent;
      if (!isHeadlessReadCurrent(sourceCurrent) || !isDeepStrictEqual(snapshot.sourceManifest, input.sourceManifest)) return unavailable;
      prepared.push({request, sourceCurrent});
    }
    const live = () => current() && prepared.every(row => isHeadlessReadCurrent(row.sourceCurrent));
    if (!live()) return forbidden;
    return {ok: true, isCurrent: live, async validate(partition: StructuredDocumentStore, request: HeadlessModelReferenceSavePlanRequest) {
      if (!live() || partition.organizationId !== target.scope.organizationId || !prepared.some(row => isDeepStrictEqual(row.request, request))) return false;
      const digest = await readStructuredOwnedModelPlanTaskSourceDigest(partition, target.scope, target.hostIncarnationId, request.input.taskId);
      return digest !== undefined && request.input.sourceManifest.manifestDigest === "sha256:" + digest && live();
    }} as const;
  } catch {return current() ? unavailable : forbidden;}
}

/** Private metadata-only integration. No transport advertises saving until the
 * separate save-plan/approval protocol and real hosts qualify. Old download
 * consent must never be accepted by authorizeExactSave. */
export function composeHeadlessModelReferenceSave(options: {
  readonly documents: StructuredDocumentStore;
  readonly rootDirectory: string;
  readonly effect: ModelReferenceSaveEffect;
  readonly isCurrent: () => boolean;
  readonly authorizeExactSave: (owner: StructuredDocumentStore, effect: ModelReferenceSaveEffect) => Promise<boolean>;
  readonly peekOwner: () => Pick<ModelDownloadTasksUseCase, "peekApprovedSourceRegistration"> | undefined;
  readonly now?: () => number;
}) {
  const {documents, rootDirectory, isCurrent, authorizeExactSave, peekOwner} = options;
  const effect = captureModelReferenceSaveEffect(options.effect), now = options.now ?? Date.now;
  if (documents.organizationId !== undefined || !documents.runInOwnedTransaction || typeof authorizeExactSave !== "function" ||
      typeof peekOwner !== "function" || typeof isCurrent !== "function") throw new Error("A Model reference save requires the platform owner and exact save authorizer.");
  const transaction = documents.runInOwnedTransaction.bind(documents), current = () => isHeadlessReadCurrent(isCurrent);
  const protect = () => {if (!current()) throw new Error("The exact Model reference save ended.");};
  async function authorized(owner: StructuredDocumentStore) {
    return current() && await authorizeExactSave(owner, effect) === true && current()
      ? owner.forOrganization(effect.target.scope.organizationId) : undefined;
  }
  async function inspect() {
    return transaction(async owner => {
      const partition = await authorized(owner); if (!partition) return;
      const result = await inspectStructuredModelReferenceSave(partition, effect);
      return await authorized(owner) ? result : undefined;
    }, protect);
  }
  return {
    async save() {
      let entered = false;
      try {
        const existing = await inspect(); if (!existing || !current()) return;
        if (existing.kind === "committed") return {...existing, created: false};
        const admitted = await transaction(async owner => {
          const partition = await authorized(owner); if (!partition) return;
          const sourceDigest = await readStructuredOwnedModelPlanTaskSourceDigest(partition, effect.target.scope,
            effect.target.hostIncarnationId, effect.taskId);
          return sourceDigest && effect.manifestDigest === "sha256:" + sourceDigest && await authorized(owner) ? sourceDigest : undefined;
        }, protect);
        if (!admitted || !current()) return;
        const model = peekOwner(); if (!model || !current()) return;
        // Capture the original loaded owner's method. Compilation is cached-only
        // and runs OUTSIDE a retriable metadata transaction.
        const prepare = model.peekApprovedSourceRegistration.bind(model);
        const prepared = await prepare({workspaceId: effect.target.scope.workspaceId, requestId: effect.taskId}, effect.manifestDigest,
          {organizationId: effect.target.scope.organizationId, principalId: effect.target.scope.principalId, modelWriteAuthorized: true});
        if (!prepared || !current()) return;
        const sourceCurrent = prepared.isOriginalSourceCurrent;
        const live = () => current() && isHeadlessReadCurrent(sourceCurrent);
        if (!live()) return;
        // The application owner returns immutable private inputs. Detach the
        // snapshot again so DB awaits never retain mutable caller objects.
        const snapshot = Object.freeze({...structuredClone({review: prepared.review, sourceManifest: prepared.sourceManifest,
          localPath: prepared.localPath, storageAuthority: prepared.storageAuthority}), isOriginalSourceCurrent: sourceCurrent});
        entered = true;
        const result = await transaction(async owner => {
          const partition = await authorized(owner); if (!partition || !live()) throw new Error("Model saving is unavailable.");
          const sourceDigest = await readStructuredOwnedModelPlanTaskSourceDigest(partition, effect.target.scope,
            effect.target.hostIncarnationId, effect.taskId);
          if (sourceDigest !== admitted || !live() || !await authorized(owner)) throw new Error("Model saving is unavailable.");
          const saved = await commitStructuredModelReferenceSave(partition, rootDirectory, effect, snapshot, sourceDigest, now());
          if (!live() || !await authorized(owner)) throw new Error("Model saving is unavailable.");
          return saved;
        }, () => {if (!live()) throw new Error("The original Model source ended.");});
        return current() ? result : undefined;
      } catch {
        if (!entered || !current()) return;
        // One read-only reconciliation handles a lost commit reply. Never create
        // another record or repeat the mutation after an uncertain outcome.
        try {const result = await inspect(); return result?.kind === "committed" && current() ? {...result, created: false} : undefined;} catch {return;}
      }
    },
  };
}

/** Only this distinct approved plan step can invoke the private metadata save. */
export async function runPreparedHeadlessModelReferenceSave(options: {
  readonly documents: StructuredDocumentStore; readonly rootDirectory: string; readonly prepared: PreparedModelReferenceStep;
  readonly request: HeadlessPlanStepRequest; readonly canUse: () => Promise<boolean>;
  readonly peekOwner: () => HeadlessModelReferenceSaveOwner | undefined;
}) {
  const {prepared, canUse, request} = options;
  const forbidden = {result: {ok: false, code: "headless.forbidden"}} as const;
  const unconfirmed = {result: {ok: false, code: "headless.operation-unconfirmed"}} as const;
  if (!prepared.isCurrent() || await canUse() !== true || !prepared.isCurrent()) return forbidden;
  const owner = composeHeadlessModelReferenceSave({documents: options.documents, rootDirectory: options.rootDirectory, effect: prepared.effect,
    isCurrent: prepared.isCurrent, authorizeExactSave: prepared.authorizeSaveOwned, peekOwner: options.peekOwner});
  const saved = await owner.save();
  if (!prepared.isCurrent() || await canUse() !== true || !prepared.isCurrent() || !await prepared.stillAllowed()) return forbidden;
  if (!saved) return unconfirmed;
  const {fingerprint, approvalRevision, step} = request.input;
  return {result: readHeadlessPlanStepResult({ok: true, value: {kind: saved.created ? "committed" : "replayed", operation: "models.save-download",
    reference: saved.reference, fingerprint, approvalRevision, step, expiresAt: prepared.expiresAt}}, request.input,
    {allowLocalFileSave: false, allowModelReferenceSave: true}), publishIfCurrent: prepared.publishIfCurrent};
}
