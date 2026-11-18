import type {StructuredDocumentStore} from "../../../adapters/persistence/shared";
import type {prepareStructuredHeadlessPlanStep} from "../../../adapters/persistence/system-builder/createStructuredHeadlessPlanStepOperationStore";
import {readStructuredOwnedContextPlanTask, readStructuredOwnedContextPlanTaskByPlan}
  from "../../../adapters/persistence/system-builder/createStructuredHeadlessContextPlanTaskStore";
import type {ApplicationRequestContext} from "../../../application/ports";
import type {ContextGenerationUseCase} from "../../../application/use-cases/context-management";
import {ReadHeadlessContextTaskUseCase} from "../../../application/use-cases/context-management";
import {contextCommandDigest} from "../../../application/use-cases/context-management/approved-context-generation-admission";
import {readHeadlessPlanStepResult, type HeadlessBuildPlanRequest, type HeadlessContextGenerationPlanRequest, type HeadlessPlanStepRequest}
  from "../../../contracts/headless";
import type {ContextPlanModelBinding} from "../../../adapters/persistence/system-builder/createStructuredHeadlessPlanReviewRepository";
import {composeHeadlessContextPreview} from "./headlessContextPreview";

type PreparedContextStep = Extract<NonNullable<Awaited<ReturnType<typeof prepareStructuredHeadlessPlanStep>>>, {kind: "context-pack"}>;
export type StartHeadlessContext = ContextGenerationUseCase["startAdmittedContext"];

/** Saved metadata only. The transaction performs no runtime, source-byte or provider operation. */
export async function compileHeadlessContextPlanInputs(rootDirectory: string, documents: StructuredDocumentStore,
  request: HeadlessContextGenerationPlanRequest, context: ApplicationRequestContext, stillAllowed: () => Promise<boolean>) {
  const {idempotencyKey: _key, ...input} = request.input;
  const compiled = await composeHeadlessContextPreview(documents, rootDirectory).execute({version: request.version,
    operation: "context.preview-generation", input}, {hostIncarnationId: input.hostIncarnationId, context, stillAllowed});
  if (compiled.ok && compiled.operation === "context.preview-generation") {
    const expected = request.operation === "context.generate-rag" ? "rag-database" : "markdown-context-pack";
    if (compiled.prepared.command.kind !== expected || (expected === "rag-database" && !compiled.prepared.embeddingModel))
      return {ok: false, code: "headless.source-not-ready"} as const;
  }
  return compiled;
}

/** Private proposal snapshot. Reads saved metadata only, inside the owning transaction. */
export async function compileHeadlessContextModelBindings(rootDirectory: string, documents: StructuredDocumentStore,
  requests: readonly HeadlessBuildPlanRequest[], context: ApplicationRequestContext, stillAllowed: () => Promise<boolean>) {
  const bindings: ContextPlanModelBinding[] = [];
  for (let index = 0; index < requests.length; index++) {
    const request = requests[index];
    if (request.operation !== "context.generate-rag") continue;
    const compiled = await compileHeadlessContextPlanInputs(rootDirectory, documents, request, context, stillAllowed);
    if (!compiled.ok || compiled.operation !== "context.preview-generation" || !compiled.prepared.embeddingModel || !await stillAllowed()) return;
    bindings.push({step: index + 1, model: compiled.prepared.embeddingModel});
  }
  return bindings;
}

export function composeHeadlessContextTask(documents: StructuredDocumentStore,
  getProcessor: () => Promise<Pick<ContextGenerationUseCase, "readAdmittedContextTask">>) {
  if (documents.organizationId !== undefined || !documents.runInOwnedTransaction)
    throw new Error("Context task status requires the platform owner.");
  const transaction = documents.runInOwnedTransaction.bind(documents);
  return new ReadHeadlessContextTaskUseCase(async (request, context, registeredClientId) => {
    if (!context.organizationId || !context.principalId || context.workspaceId !== request.input.workspaceId) return;
    const scope = {organizationId: context.organizationId, principalId: context.principalId, registeredClientId,
      workspaceId: request.input.workspaceId};
    const {hostIncarnationId, selection} = request.input;
    const receipt = await transaction(async owner => {
      const partition = owner.forOrganization(scope.organizationId);
      return selection.kind === "task"
        ? readStructuredOwnedContextPlanTask(partition, scope, hostIncarnationId, selection.taskId)
        : readStructuredOwnedContextPlanTaskByPlan(partition, scope, hostIncarnationId, selection.fingerprint, selection.step);
    }, () => {});
    return receipt?.taskId;
  }, async (taskId, context, stillAllowed) => {
    const processor = await getProcessor();
    if (!await stillAllowed()) return;
    return processor.readAdmittedContextTask(taskId, context);
  });
}

/** One new reservation may enter the existing installed-only owner; uncertain attempts never authorize a retry. */
export async function runPreparedHeadlessContextPack(options: {
  readonly prepared: PreparedContextStep;
  readonly request: HeadlessPlanStepRequest;
  readonly context: ApplicationRequestContext;
  readonly canUse: () => Promise<boolean>;
  readonly resolveStart: () => Promise<StartHeadlessContext | undefined>;
}) {
  const {prepared, request, canUse, resolveStart} = options, context = {...options.context};
  const forbidden = {result: {ok: false, code: "headless.forbidden"}} as const;
  const unconfirmed = {result: {ok: false, code: "headless.operation-unconfirmed"}} as const;
  if (!prepared.isCurrent() || !await canUse()) return forbidden;
  const observed = await prepared.inspect();
  if (!observed) return unconfirmed;
  let kind: "started" | "replayed" = "replayed";
  let reference = observed.kind === "accepted" ? observed.reference : undefined;
  if (observed.kind === "absent") {
    if (!await prepared.validateInputs()) return forbidden;
    const start = await resolveStart();
    if (!start || !prepared.isCurrent() || !await canUse() || !await prepared.stillAllowed()) return forbidden;
    const reserved = await prepared.reserve();
    if (!reserved) return unconfirmed;
    if (reserved.kind === "capacity") return {result: {ok: false, code: "headless.operation-capacity"}} as const;
    if (reserved.kind === "accepted") reference = reserved.reference;
    else if (reserved.kind === "new") {
      const {taskId, sourceDigest, compiled} = reserved;
      if (!context.organizationId || !context.principalId || context.workspaceId !== prepared.request.input.workspaceId) return forbidden;
      const result = await start(compiled.command, context, {taskId, organizationId: context.organizationId,
        principalId: context.principalId, workspaceId: context.workspaceId, commandDigest: contextCommandDigest(compiled.command),
        sources: compiled.admissionSources, ...(compiled.embeddingModel ? {embeddingModel: compiled.embeddingModel} : {}),
        isCurrent: prepared.isCurrent,
        stillAllowed: async () => prepared.isCurrent() && await canUse() && await prepared.stillAllowed(),
        issue: () => prepared.issue(taskId, sourceDigest)});
      if (!result.ok || result.value.requestId !== taskId || result.value.taskType !== "generate-context-artifact" ||
          result.value.accepted !== true || (result.value.status !== "queued" && result.value.status !== "running")) return unconfirmed;
      // Record the admitted outcome even after caller revocation; outward disclosure is a separate boundary.
      if (!await prepared.accept(taskId)) return unconfirmed;
      kind = "started";
      reference = await prepared.readReceipt();
    }
  }
  if (!prepared.isCurrent() || !await canUse() || !await prepared.stillAllowed()) return forbidden;
  if (!reference) return unconfirmed;
  const {fingerprint, approvalRevision, step} = request.input;
  return {result: readHeadlessPlanStepResult({ok: true, value: {kind, operation: prepared.request.operation,
    reference, fingerprint, approvalRevision, step, expiresAt: prepared.expiresAt}}, request.input,
    {allowLocalFileSave: false, allowContextPackGeneration: true, allowContextRagGeneration: true}), publishIfCurrent: prepared.publishIfCurrent};
}
