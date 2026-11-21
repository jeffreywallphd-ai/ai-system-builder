import type {prepareStructuredHeadlessPlanStepWithModels} from "../../../adapters/persistence/system-builder/createStructuredHeadlessPlanStepOperationStore";
import type {ModelDownloadTasksUseCase} from "../../../application/use-cases/model/model-download-tasks.use-case";
import type {ApplicationRequestContext} from "../../../application/ports";
import {readHeadlessPlanStepRequest, readHeadlessPlanStepResult, type HeadlessPlanStepRequest} from "../../../contracts/headless";
import {isHeadlessReadCurrent} from "./headlessReadCurrent";

type PreparedModelStep = Extract<NonNullable<Awaited<ReturnType<typeof prepareStructuredHeadlessPlanStepWithModels>>>, {kind: "model-download"}>;
export type StartHeadlessModelDownload = ModelDownloadTasksUseCase["startApprovedSource"];

/** Compose one approved stored step with the existing Model application owner.
 * Real hosts must supply fresh request policy and separately retained original
 * actor/host business ModelWrite policy. This helper does not advertise a route. */
export async function runPreparedHeadlessModelDownload(options: {
  readonly prepared: PreparedModelStep;
  readonly request: HeadlessPlanStepRequest;
  readonly context: ApplicationRequestContext;
  readonly canUse: () => Promise<boolean>;
  readonly isHostCurrent: () => boolean;
  readonly stillBusinessAllowed: () => Promise<boolean>;
  readonly resolveStart: () => Promise<StartHeadlessModelDownload | undefined>;
}) {
  const {prepared, canUse, isHostCurrent, stillBusinessAllowed, resolveStart} = options;
  const context = {...options.context}, scope = prepared.scope;
  const forbidden = {result: {ok: false, code: "headless.forbidden"}} as const;
  const unconfirmed = {result: {ok: false, code: "headless.operation-unconfirmed"}} as const;
  try {
    const parsed = readHeadlessPlanStepRequest(options.request, prepared.selection.hostIncarnationId);
    if (!parsed.ok || parsed.request.transient !== undefined ||
        JSON.stringify(parsed.request.input) !== JSON.stringify(prepared.selection) ||
        context.organizationId !== scope.organizationId || context.principalId !== scope.principalId || context.workspaceId !== scope.workspaceId) return forbidden;
    const request = parsed.request;
    const hostCurrent = () => isHeadlessReadCurrent(isHostCurrent);
    const admit = async () => hostCurrent() && prepared.isCurrent() && await canUse() === true &&
      prepared.isCurrent() && await prepared.stillAllowed() && prepared.isCurrent() && hostCurrent();
    if (!await admit()) return forbidden;
    const observed = await prepared.inspect(); if (!observed) return unconfirmed;
    let notStarted = observed.kind === "not-started", kind: "started" | "replayed" = "replayed";
    let reference = observed.kind === "accepted" ? observed.reference : undefined;
    if (observed.kind === "absent") {
      const start = await resolveStart();
      if (!start || !await admit() || await stillBusinessAllowed() !== true || !hostCurrent()) return forbidden;
      const reserved = await prepared.reserve(); if (!reserved) return unconfirmed;
      if (reserved.kind === "capacity") return {result: {ok: false, code: "headless.operation-capacity"}} as const;
      if (reserved.kind === "not-started") notStarted = true;
      else if (reserved.kind === "accepted") reference = reserved.reference;
      else if (reserved.kind === "new") {
        const {taskId, sourceDigest} = reserved, input = prepared.request.input;
        let owningStartReturned = false;
        let result: Awaited<ReturnType<StartHeadlessModelDownload>>;
        try {
          result = await start({workspaceId: scope.workspaceId, provider: "huggingface", modelId: input.sourceManifest.source.modelId,
            revision: input.sourceManifest.source.revision, displayName: input.name,
            ...(input.inferenceMode ? {inferenceMode: input.inferenceMode} : {})}, {
            source: {requestId: taskId, workspaceId: scope.workspaceId, sourceManifest: input.sourceManifest,
              maximumDurationSeconds: input.maximumDurationSeconds, allowedOrigins: input.allowedOrigins},
            control: {isCurrent: hostCurrent, stillAllowed: async () => hostCurrent() && await stillBusinessAllowed() === true &&
              hostCurrent() && (owningStartReturned || await admit())},
            isAdmissionCurrent: () => hostCurrent() && prepared.isCurrent(),
            acknowledgeIssued: async () => {
              if (!await admit()) return false;
              const outcome = await prepared.issue(taskId, sourceDigest);
              if (outcome === "unconfirmed") throw new Error("The original Model issuance is unconfirmed.");
              return outcome === "issued";
            },
          }, {organizationId: scope.organizationId, principalId: scope.principalId, modelWriteAuthorized: true});
        } finally {owningStartReturned = true;}
        if (result.kind === "unavailable") {
          if (!await prepared.recordNotStarted(taskId, sourceDigest)) return unconfirmed;
          notStarted = true;
        } else {
          if (result.kind !== "accepted" || result.value.activity.requestId !== taskId ||
              result.value.activity.workspaceId !== scope.workspaceId || result.value.activity.modelId !== input.sourceManifest.source.modelId ||
              !["queued", "running"].includes(result.value.activity.status)) return unconfirmed;
          // Persist the original admitted business outcome even after outward
          // request/approval revocation. Publication remains separately guarded.
          if (!await prepared.accept(taskId)) return unconfirmed;
          kind = "started"; reference = await prepared.readReceipt();
        }
      }
    }
    if (!await admit()) return forbidden;
    if (notStarted) return {result: {ok: false, code: "headless.not-started"}} as const;
    if (!reference) return unconfirmed;
    return {result: readHeadlessPlanStepResult({ok: true, value: {kind, operation: "models.download", reference,
      fingerprint: request.input.fingerprint, step: request.input.step, approvalRevision: request.input.approvalRevision,
      expiresAt: prepared.expiresAt}}, request.input, {allowLocalFileSave: false, allowModelDownload: true}),
      publishIfCurrent: prepared.publishIfCurrent};
  } catch {return unconfirmed;}
}
