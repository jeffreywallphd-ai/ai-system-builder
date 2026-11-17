import { createStructuredSystemBuilderRepository } from "../../../adapters/persistence/system-builder";
import type { prepareStructuredHeadlessPlanStep } from "../../../adapters/persistence/system-builder/createStructuredHeadlessPlanStepOperationStore";
import type { StructuredDocumentStore } from "../../../adapters/persistence/shared";
import type { HeadlessPlanReviewSnapshotResult } from "../../../application/ports/system-builder/headless-build-plan-review.port";
import type { GovernedIngestionTaskUseCases } from "../../../application/use-cases/ingestion-acquisition/governed-ingestion-tasks.use-case";
import { readHeadlessPlanStepResult, type HeadlessBuildPlanRequest, type HeadlessLocalFileSavePlanRequest,
  type HeadlessProviderFileSavePlanRequest,
  type HeadlessPlanReviewAgentResult, type HeadlessPlanStepRequest } from "../../../contracts/headless";
import type { WorkspaceId } from "../../../contracts/workspace";

type PreparedLocalFileStep = Extract<NonNullable<Awaited<ReturnType<typeof prepareStructuredHeadlessPlanStep>>>, { kind: "local-file" }>;
type FinalizeApprovedLocalFile = GovernedIngestionTaskUseCases["finalizeApprovedLocalFile"];
type PreparedProviderFileStep = Extract<NonNullable<Awaited<ReturnType<typeof prepareStructuredHeadlessPlanStep>>>, { kind: "provider-file" }>;
type FinalizeApprovedProviderFile = GovernedIngestionTaskUseCases["finalizeApprovedProviderFile"];

/** Run the exact stored selection through the owning ingestion service and confirm its durable receipt. */
export async function runPreparedHeadlessLocalFile(options: {
  readonly prepared: PreparedLocalFileStep;
  readonly request: HeadlessPlanStepRequest;
  readonly context: Parameters<FinalizeApprovedLocalFile>[1];
  readonly canUse: () => Promise<boolean>;
  readonly resolveFinalize: () => Promise<FinalizeApprovedLocalFile | undefined>;
}) {
  const { prepared, request, context, canUse, resolveFinalize } = options;
  const forbidden = { result: { ok:false, code:"headless.forbidden" } } as const;
  const unconfirmed = { result: { ok:false, code:"headless.operation-unconfirmed" } } as const;
  if (!await canUse() || !prepared.isCurrent()) return forbidden;
  const observed = await prepared.inspect();
  if (!observed) return unconfirmed;
  let kind: "committed" | "replayed" = "replayed";
  let reference = observed.kind === "replayed" ? observed.receipt : undefined;
  if (observed.kind === "staged") {
    const finalize = await resolveFinalize();
    if (!finalize || !await canUse() || !await prepared.stillAllowed()) return forbidden;
    const outcome = await finalize({
      preview: observed.preview,
      stillAllowed: async () => await canUse() && await prepared.stillAllowed(),
      isCurrent: prepared.isCurrent,
      issuePublication: prepared.issuePublication,
    }, context);
    if (!outcome.ok) return outcome.code === "headless.forbidden" ? forbidden : unconfirmed;
    reference = await prepared.readReceipt();
    kind = "committed";
  }
  if (!reference) return unconfirmed;
  if (!prepared.isCurrent() || !await canUse() || !await prepared.stillAllowed()) return forbidden;
  const { fingerprint, approvalRevision, step } = request.input;
  return { result: readHeadlessPlanStepResult({ ok: true, value: { kind, operation: "data.save-local-source",
    reference, fingerprint, approvalRevision, step, expiresAt: prepared.expiresAt } }, request.input,
    { allowLocalFileSave: true }), publishIfCurrent: prepared.publishIfCurrent };
}

export async function runPreparedHeadlessProviderFile(options: {
  readonly prepared: PreparedProviderFileStep;
  readonly request: HeadlessPlanStepRequest;
  readonly context: Parameters<FinalizeApprovedProviderFile>[1];
  readonly canUse: () => Promise<boolean>;
  readonly resolveFinalize: () => Promise<FinalizeApprovedProviderFile | undefined>;
}) {
  const { prepared, request, context, canUse, resolveFinalize } = options;
  const forbidden = { result: { ok: false, code: "headless.forbidden" } } as const;
  const unconfirmed = { result: { ok: false, code: "headless.operation-unconfirmed" } } as const;
  if (!await canUse() || !prepared.isCurrent()) return forbidden;
  const observed = await prepared.inspect();
  if (!observed) return unconfirmed;
  let kind: "committed" | "replayed" = "replayed";
  let reference = observed.kind === "replayed" ? observed.receipt : undefined;
  if (observed.kind === "staged") {
    const finalize = await resolveFinalize();
    if (!finalize || !await canUse() || !await prepared.stillAllowed()) return forbidden;
    const outcome = await finalize({
      preview: observed.preview,
      stillAllowed: async () => await canUse() && await prepared.stillAllowed(),
      isCurrent: prepared.isCurrent,
      publish: prepared.publish,
    }, context);
    if (!outcome.ok) return outcome.code === "headless.forbidden" ? forbidden : unconfirmed;
    reference = await prepared.readReceipt();
    kind = "committed";
  }
  if (!reference) return unconfirmed;
  if (!prepared.isCurrent() || !await canUse() || !await prepared.stillAllowed()) return forbidden;
  const { fingerprint, approvalRevision, step } = request.input;
  return { result: readHeadlessPlanStepResult({ ok: true, value: { kind, operation: "data.save-provider-source",
    reference, fingerprint, approvalRevision, step, expiresAt: prepared.expiresAt } }, request.input,
    { allowLocalFileSave: false, allowProviderFileSave: true }), publishIfCurrent: prepared.publishIfCurrent };
}

/** The owning plan transaction calls this only for a new proposal. */
export async function validateHeadlessPlanSavedSources(
  documents: StructuredDocumentStore, workspaceId: WorkspaceId,
  requests: readonly HeadlessBuildPlanRequest[], isCurrent: () => boolean,
  validateLocalFile?: (request: HeadlessLocalFileSavePlanRequest) => Promise<true | false | "stale">,
  validateProviderFile?: (request: HeadlessProviderFileSavePlanRequest) => Promise<true | false | "stale">,
): Promise<true | false | "stale"> {
  const systems = createStructuredSystemBuilderRepository(documents);
  for (const request of requests) {
    const { operation, input } = request;
    if (!isCurrent() || input.workspaceId !== workspaceId) return false;
    if (operation === "data.save-local-source") {
      if (!validateLocalFile) return false;
      const eligible = await validateLocalFile(request);
      if (eligible !== true) return eligible;
      continue;
    }
    if (operation === "data.save-provider-source") {
      if (!validateProviderFile) return false;
      const eligible = await validateProviderFile(request);
      if (eligible !== true) return eligible;
      continue;
    }
    if (operation === "systems.create") continue;
    const record = await systems.readRecord(workspaceId, input.systemId);
    if (!isCurrent()) return false;
    if (!record || record.targetWorkspaceId !== workspaceId || record.systemId !== input.systemId ||
        record.status === "archived" || record.revision !== input.baseRecordRevision ||
        record.currentRevisionId !== input.baseRevisionId) return "stale";
    const revision = await systems.readRevision(workspaceId, input.systemId, input.baseRevisionId);
    if (!isCurrent()) return false;
    if (!revision || revision.targetWorkspaceId !== workspaceId || revision.systemId !== input.systemId ||
        revision.revisionId !== input.baseRevisionId ||
        revision.composition.compositionId !== record.composition.compositionId) return "stale";
  }
  return isCurrent();
}

export function projectHeadlessPlanReview(result: HeadlessPlanReviewSnapshotResult, fingerprint: string): HeadlessPlanReviewAgentResult {
  if (!result.ok) {
    switch (result.code) {
      case "forbidden": return { ok: false, code: "headless.forbidden" };
      case "invalid": return { ok: false, code: "headless.invalid-request" };
      case "expired": return { ok: false, code: "headless.plan-expired" };
      case "stale": return { ok: false, code: "headless.stale" };
      case "capacity": return { ok: false, code: "headless.operation-capacity" };
      default: return { ok: false, code: "headless.unavailable" };
    }
  }
  const { revision, stepCount, expiresAt, status, approvedSteps, mode } = result.snapshot.state;
  return { ok: true, value: { fingerprint, revision, stepCount, expiresAt, status, approvedSteps,
    ...(mode === undefined ? {} : { mode }) } };
}
