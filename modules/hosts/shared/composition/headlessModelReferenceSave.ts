import type {StructuredDocumentStore} from "../../../adapters/persistence/shared";
import {captureModelReferenceSaveEffect, commitStructuredModelReferenceSave, inspectStructuredModelReferenceSave,
  captureModelTrainingSaveEffect, commitStructuredModelTrainingSave, inspectStructuredModelTrainingSave,
  type ModelReferenceSaveEffect, type ModelTrainingSaveEffect} from "../../../adapters/persistence/system-builder/createStructuredHeadlessModelReferenceStore";
import {readStructuredOwnedModelPlanTaskSourceDigest} from "../../../adapters/persistence/system-builder/createStructuredHeadlessModelPlanTaskStore";
import type {ModelDownloadTasksUseCase} from "../../../application/use-cases/model/model-download-tasks.use-case";
import {isHeadlessReadCurrent} from "./headlessReadCurrent";
import {isDeepStrictEqual, types} from "node:util";
import {createHash} from "node:crypto";
import type {HeadlessPlanReviewTarget} from "../../../application/ports/system-builder/headless-build-plan-review.port";
import {readHeadlessModelReferenceSavePlanRequest, readHeadlessPlanStepRequest, readHeadlessPlanStepResult, type HeadlessBuildPlanRequest,
  HEADLESS_MAX_BUILD_PLAN_STEPS,
  readHeadlessModelTrainingSavePlanRequest, type HeadlessModelTrainingSavePlanRequest,
  type HeadlessModelReferenceSavePlanRequest, type HeadlessPlanStepRequest} from "../../../contracts/headless";
import {copyHeadlessModelPlanData} from "./headlessModelDownloadReview";
import type {prepareStructuredHeadlessPlanStepWithModels, prepareStructuredHeadlessPlanStepWithTrainingSave} from "../../../adapters/persistence/system-builder/createStructuredHeadlessPlanStepOperationStore";
import {readStrictPassiveRecord} from "../../../contracts/shared";
import {readStructuredTrainingPlanTaskLineage} from "../../../adapters/persistence/system-builder/createStructuredHeadlessTrainingPlanTaskStore";
import type {ApprovedLocalTrainingSaveSession, ApprovedLocalTrainingSavePreparation, ReviewedGeneratedModelControl} from "../../../application/ports/model";
import {observeMalformedOriginalTrainingSaveReturn, type OriginalTrainingSaveQueryResult,
  type OriginalTrainingCandidateQueryResult} from "./headlessModelTrainingTasks";

export type HeadlessModelReferenceSaveOwner = Pick<ModelDownloadTasksUseCase, "peekApprovedSourceRegistration">;
type PreparedModelReferenceStep = Extract<NonNullable<Awaited<ReturnType<typeof prepareStructuredHeadlessPlanStepWithModels>>>, {kind: "model-reference"}>;
function freeze<T>(value: T): T {
  if (value && typeof value === "object") {for (const child of Object.values(value)) freeze(child); Object.freeze(value);}
  return value;
}
function captureTrainingSaveMethod<F extends (...args: any[]) => any>(owner: object, key: string): F {
  if (!owner || types.isProxy(owner)) throw new Error("The original trained Model Save method is unavailable.");
  const d = Object.getOwnPropertyDescriptor(owner, key);
  if (!d || !("value" in d) || typeof d.value !== "function" || types.isProxy(d.value))
    throw new Error("The original trained Model Save method is unavailable.");
  return ((...args: unknown[]) => Reflect.apply(d.value, owner, args)) as F;
}

/** Current original candidate observation occurs outside metadata transactions.
 * Only frozen request/proposal facts enter the returned point-read validator. */
export async function prepareHeadlessModelTrainingSaveReviews(options: {
  readonly target: HeadlessPlanReviewTarget; readonly requests: readonly HeadlessBuildPlanRequest[];
  readonly isCurrent: () => boolean; readonly stillAllowed: () => Promise<boolean>;
  readonly reviewOriginalTask: (request: HeadlessModelTrainingSavePlanRequest) => Promise<OriginalTrainingCandidateQueryResult>;
}) {
  const unavailable = {ok: false, code: "headless.unavailable"} as const;
  const forbidden = {ok: false, code: "headless.forbidden"} as const;
  try {
    const currentMethod = captureTrainingSaveMethod<() => boolean>(options, "isCurrent"),
      allowed = captureTrainingSaveMethod<() => Promise<boolean>>(options, "stillAllowed"),
      review = captureTrainingSaveMethod<typeof options.reviewOriginalTask>(options, "reviewOriginalTask");
    const current = () => isHeadlessReadCurrent(currentMethod);
    const requests = copyHeadlessModelPlanData(options.requests) as HeadlessBuildPlanRequest[];
    const selected = requests.flatMap((request, index) => request.operation === "models.save-training" ? [{request, step: index + 1}] : []);
    if (!selected.length || requests.length > HEADLESS_MAX_BUILD_PLAN_STEPS) return forbidden;
    const first = selected[0], target = captureModelTrainingSaveEffect({key: first.request.input.idempotencyKey, target: options.target,
      approvalRevision: 1, step: first.step, taskId: first.request.input.taskId, candidateDigest: first.request.input.candidateDigest, name: first.request.input.name}).target;
    const prepared: {request: HeadlessModelTrainingSavePlanRequest; proposalDigest: string}[] = [];
    for (const {request: raw} of selected) {
      const parsed = readHeadlessModelTrainingSavePlanRequest(raw, target.hostIncarnationId);
      if (!parsed.ok || parsed.request.input.workspaceId !== target.scope.workspaceId || !current() || await allowed() !== true || !current()) return forbidden;
      const request = freeze(parsed.request);
      const outer = readStrictPassiveRecord(copyHeadlessModelPlanData(await review(request)), ["ok", "value", "code"]);
      if (outer.ok !== true || Object.keys(outer).length !== 2) return unavailable;
      const value = readStrictPassiveRecord(outer.value, ["kind", "requestId", "workspaceId", "history", "retainedFiles", "candidateDigest", "execution"]);
      if (Object.keys(value).length !== (value.execution === undefined ? 6 : 7)) return unavailable;
      const reply = {ok: true, value} as unknown as Extract<OriginalTrainingCandidateQueryResult, {ok: true}>;
      // The callback is the configured original task book, never cached history
      // or caller-supplied candidate data. File lists stay private and unstored.
      if (!reply || reply.ok !== true || reply.value.kind !== "ready") return unavailable;
      const candidate = reply.value, history = candidate.history;
      if (candidate.requestId !== request.input.taskId || candidate.workspaceId !== target.scope.workspaceId ||
        candidate.candidateDigest !== request.input.candidateDigest || history?.kind !== "ready" ||
        history.requestId !== candidate.requestId || history.workspaceId !== candidate.workspaceId ||
        candidate.retainedFiles?.verification !== "sha256-current-local-v1" ||
        typeof history.provenance?.proposalDigest !== "string" || !/^sha256:[a-f0-9]{64}$/.test(history.provenance.proposalDigest)) return unavailable;
      if (!current() || await allowed() !== true || !current()) return forbidden;
      prepared.push({request, proposalDigest: history.provenance.proposalDigest});
    }
    return {ok: true, isCurrent: current,
      async validate(partition: StructuredDocumentStore, request: HeadlessModelTrainingSavePlanRequest) {
        const selected = prepared.find(row => isDeepStrictEqual(row.request, request));
        if (!selected || !current() || partition.organizationId !== target.scope.organizationId) return false;
        const lineage = await readStructuredTrainingPlanTaskLineage(partition, target.scope, target.hostIncarnationId, request.input.taskId);
        return !!lineage && lineage.proposalDigest === selected.proposalDigest && current();
      }} as const;
  } catch {return unavailable;}
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

/** Private publication owner. bindOriginalTask must use the exclusive retained
 * task-book capability, never reconstruct a task or expose its session elsewhere.
 * Original copy IO is outside retriable metadata transactions. */
export function composeHeadlessTrainedModelSave(options: {
  readonly documents: StructuredDocumentStore; readonly rootDirectory: string;
  readonly effect: ModelTrainingSaveEffect; readonly isCurrent: () => boolean;
  readonly authorizeExactSave: (owner: StructuredDocumentStore, effect: ModelTrainingSaveEffect) => Promise<boolean>;
  /** Approval serialization only at publication. Authorization/inspection must
   * remain metadata-read-only and must not call this mutation fence. */
  readonly fenceSaveOwned: (owner: StructuredDocumentStore, effect: ModelTrainingSaveEffect) => Promise<boolean>;
  readonly bindOriginalTask: (effect: ModelTrainingSaveEffect, control: ReviewedGeneratedModelControl) => Promise<OriginalTrainingSaveQueryResult>;
  readonly now?: () => number;
}) {
  const {documents, rootDirectory, isCurrent, authorizeExactSave, fenceSaveOwned, bindOriginalTask} = options;
  const effect = captureModelTrainingSaveEffect(options.effect), now = options.now ?? Date.now;
  if (documents.organizationId !== undefined || !documents.runInOwnedTransaction ||
    [isCurrent, authorizeExactSave, fenceSaveOwned, bindOriginalTask, now].some(f => typeof f !== "function" || types.isProxy(f)))
    throw new Error("Trained Model Save requires the original owner and exact consent.");
  const transaction = documents.runInOwnedTransaction.bind(documents), current = () => isHeadlessReadCurrent(isCurrent);
  const failed = () => new Error("The original trained Model Save is unavailable.");
  const need = (condition: unknown) => {if (condition !== true) throw failed();};
  const record = (raw: unknown, keys: readonly string[]) => {if (types.isProxy(raw)) throw failed(); return readStrictPassiveRecord(raw, keys);};
  const retained: {kind: "bind" | "write" | "cleanup" | "sync"; original: unknown; settled: boolean; uncertain: boolean; observation?: unknown}[] = [];
  let attempted = false, publicationIssued = false, fenceAttempted = false, cleanupAttempted = false, cleaned = false;
  let session: ApprovedLocalTrainingSaveSession | undefined, write: ApprovedLocalTrainingSaveSession["write"] | undefined,
    fence: ApprovedLocalTrainingSaveSession["fence"] | undefined, sourceCurrent: ApprovedLocalTrainingSaveSession["isCurrent"] | undefined,
    discard: ApprovedLocalTrainingSaveSession["discard"] | undefined;
  const uncertain = () => retained.some(r => r.uncertain);
  function unknown(raw: unknown, kind: "bind" | "write" | "cleanup" | "sync") {
    retained.push({kind, original: raw, settled: false, uncertain: true, observation: observeMalformedOriginalTrainingSaveReturn(raw)});
  }
  async function invoke<T>(kind: "bind" | "write" | "cleanup", operation: () => Promise<T>): Promise<T> {
    let original: Promise<T>;
    try {original = operation();} catch {unknown(undefined, kind); throw failed();}
    if (!types.isPromise(original) || types.isProxy(original) || Object.getPrototypeOf(original) !== Promise.prototype ||
      Object.getOwnPropertyDescriptor(original, "then") || Object.getOwnPropertyDescriptor(original, "constructor")) {
      unknown(original, kind); throw failed();
    }
    const owned = {kind, original, settled: false, uncertain: false}; retained.push(owned);
    try {return await original;} finally {owned.settled = true;}
  }
  function sourceLive() {
    try {
      if (!current() || !session || !sourceCurrent || uncertain()) return false;
      const value = sourceCurrent();
      if (types.isPromise(value)) {unknown(value, "sync"); return false;}
      if (typeof value !== "boolean") {unknown(value, "sync"); return false;}
      return value === true;
    } catch {unknown(undefined, "sync"); return false;}
  }
  function fenceSource() {
    if (!fence || fenceAttempted) return; fenceAttempted = true;
    try {const value = fence(); if (value !== undefined) unknown(value, "sync");}
    catch {unknown(undefined, "sync");}
  }
  async function authorized(owner: StructuredDocumentStore) {
    if (!current() || await authorizeExactSave(owner, effect) !== true || !current()) return;
    const partition = owner.forOrganization(effect.target.scope.organizationId);
    return await readStructuredTrainingPlanTaskLineage(partition, effect.target.scope, effect.target.hostIncarnationId, effect.taskId) && current()
      ? partition : undefined;
  }
  const protect = () => need(current());
  async function inspect() {
    return transaction(async owner => {
      const partition = await authorized(owner); if (!partition) return;
      const result = await inspectStructuredModelTrainingSave(partition, effect);
      return await authorized(owner) ? result : undefined;
    }, protect);
  }
  // Independent cleanup of this exclusive fresh copy only. No write-caller
  // expiry can grant it; any issued/uncertain publication permanently denies it.
  const neverIssued = () => !!session && !publicationIssued && !uncertain() &&
    retained.every(r => r.kind === "cleanup" || r.settled);
  async function mayDiscard() {
    try {
      if (!neverIssued()) return false;
      const absent = await transaction(async owner => (await inspectStructuredModelTrainingSave(
        owner.forOrganization(effect.target.scope.organizationId), effect)).kind === "absent", () => need(neverIssued()));
      return absent && neverIssued();
    } catch {return false;}
  }
  async function discardUnpublished() {
    fenceSource();
    if (cleaned) return true;
    if (cleanupAttempted || !discard || !await mayDiscard()) return false;
    if (cleanupAttempted) return false;
    cleanupAttempted = true;
    try {cleaned = await invoke("cleanup", discard) === true; return cleaned;}
    catch {return false;}
  }
  return Object.freeze({discardUnpublished, async save() {
    try {
      const existing = await inspect(); if (!existing || !current()) return;
      if (existing.kind === "committed") return {...existing, created: false};
      if (attempted) return; attempted = true;
      const reply = record(await invoke("bind", () => bindOriginalTask(effect, Object.freeze({isCurrent: current,
        stillAllowed: async () => Boolean(await transaction(authorized, protect)), mayDiscard}))), ["ok", "value", "code"]);
      if (reply.ok !== true || Object.keys(reply).length !== 2) return;
      session = reply.value as ApprovedLocalTrainingSaveSession;
      try {
        need(Object.keys(record(session, ["write", "fence", "isCurrent", "inspect", "discard"])).length === 5);
        fence = captureTrainingSaveMethod(session, "fence"); discard = captureTrainingSaveMethod(session, "discard");
        write = captureTrainingSaveMethod(session, "write"); sourceCurrent = captureTrainingSaveMethod(session, "isCurrent");
      } catch {unknown(session, "sync"); throw failed();}
      need(current());
      const preparation = freeze(copyHeadlessModelPlanData(await invoke("write", write))) as ApprovedLocalTrainingSavePreparation;
      need(sourceLive());
      const result = await transaction(async owner => {
        const partition = await authorized(owner); need(!!partition && sourceLive());
        need(await fenceSaveOwned(owner, effect) === true && sourceLive());
        // This latch is monotonic across callback retries and lost replies.
        publicationIssued = true;
        const saved = await commitStructuredModelTrainingSave(partition!, rootDirectory, effect, preparation, now());
        need(sourceLive() && !!await authorized(owner)); return saved;
      }, () => need(sourceLive()));
      return current() ? result : undefined;
    } catch {
      fenceSource();
      if (publicationIssued) {
        try {const saved = await inspect(); return saved?.kind === "committed" && current() ? {...saved, created: false} : undefined;}
        catch {return;}
      }
      await discardUnpublished();
      return;
    }
  }});
}

type PreparedTrainingSaveStep = Extract<NonNullable<Awaited<ReturnType<typeof prepareStructuredHeadlessPlanStepWithTrainingSave>>>, {kind: "model-training-save"}>;
/** The exact separately approved step is the only publication entry point. */
export async function runPreparedHeadlessTrainedModelSave(options: {
  readonly documents: StructuredDocumentStore; readonly rootDirectory: string; readonly prepared: PreparedTrainingSaveStep;
  readonly request: HeadlessPlanStepRequest; readonly canUse: () => Promise<boolean>;
  readonly bindOriginalTask: Parameters<typeof composeHeadlessTrainedModelSave>[0]["bindOriginalTask"];
}) {
  const forbidden = {result: {ok: false, code: "headless.forbidden"}} as const;
  const unconfirmed = {result: {ok: false, code: "headless.operation-unconfirmed"}} as const;
  try {
    const {prepared, documents, rootDirectory} = options;
    const effect = captureModelTrainingSaveEffect(prepared.effect), expiresAt = prepared.expiresAt;
    const isCurrent = captureTrainingSaveMethod<PreparedTrainingSaveStep["isCurrent"]>(prepared, "isCurrent"),
      authorizeExactSave = captureTrainingSaveMethod<PreparedTrainingSaveStep["authorizeSaveOwned"]>(prepared, "authorizeSaveOwned"),
      fenceSaveOwned = captureTrainingSaveMethod<PreparedTrainingSaveStep["fenceSaveOwned"]>(prepared, "fenceSaveOwned"),
      stillAllowed = captureTrainingSaveMethod<PreparedTrainingSaveStep["stillAllowed"]>(prepared, "stillAllowed"),
      publishIfCurrent = captureTrainingSaveMethod<PreparedTrainingSaveStep["publishIfCurrent"]>(prepared, "publishIfCurrent"),
      canUse = captureTrainingSaveMethod<typeof options.canUse>(options, "canUse"),
      bindOriginalTask = captureTrainingSaveMethod<typeof options.bindOriginalTask>(options, "bindOriginalTask");
    const decoded = readHeadlessPlanStepRequest(options.request, effect.target.hostIncarnationId);
    if (!decoded.ok || decoded.request.transient || !Number.isSafeInteger(expiresAt) || expiresAt <= 0) return forbidden;
    const request = decoded.request, selected = request.input;
    if (selected.workspaceId !== effect.target.scope.workspaceId || selected.fingerprint !== effect.target.fingerprint ||
      selected.approvalRevision !== effect.approvalRevision || selected.step !== effect.step) return forbidden;
    // Construct the inert owner now: its original transaction method and exact
    // effect are captured before a permission callback can replace shared data.
    const owner = composeHeadlessTrainedModelSave({documents, rootDirectory, effect, isCurrent,
      authorizeExactSave, fenceSaveOwned, bindOriginalTask});
    if (!isHeadlessReadCurrent(isCurrent) || await canUse() !== true || !isHeadlessReadCurrent(isCurrent)) return forbidden;
    const saved = await owner.save();
    if (!isHeadlessReadCurrent(isCurrent) || await canUse() !== true || !isHeadlessReadCurrent(isCurrent) || await stillAllowed() !== true) return forbidden;
    if (!saved) return unconfirmed;
    const {fingerprint, approvalRevision, step} = request.input;
    return {result: readHeadlessPlanStepResult({ok: true, value: {kind: saved.created ? "committed" : "replayed",
      operation: "models.save-training", reference: saved.reference, fingerprint, approvalRevision, step, expiresAt}},
      request.input, {allowLocalFileSave: false, allowModelTrainingSave: true}), publishIfCurrent};
  } catch {return unconfirmed;}
}
