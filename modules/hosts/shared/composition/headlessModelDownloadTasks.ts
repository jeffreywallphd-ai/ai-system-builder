import {types} from "node:util";
import type {StructuredDocumentStore} from "../../../adapters/persistence/shared";
import {readStructuredOwnedModelPlanTask, readStructuredOwnedModelPlanTaskByPlan,
  readStructuredOwnedModelPlanTaskSourceDigest} from "../../../adapters/persistence/system-builder/createStructuredHeadlessModelPlanTaskStore";
import type {ModelDownloadTasksUseCase} from "../../../application/use-cases/model/model-download-tasks.use-case";
import type {HeadlessOperationScope} from "../../../application/ports/system-builder";
import {HEADLESS_MAX_BUILD_PLAN_STEPS, isDesktopHeadlessClientId, isHeadlessHostIncarnationId} from "../../../contracts/headless";
import {isOrganizationId} from "../../../contracts/organization";
import {isWorkspaceId} from "../../../contracts/workspace";
import {readStrictPassiveRecord, hasKnownPassiveCredential} from "../../../contracts/shared";
import {isHeadlessReadCurrent} from "./headlessReadCurrent";

export type OwnedHeadlessModelTaskSelection = {readonly kind: "task"; readonly taskId: string} |
  {readonly kind: "plan-step"; readonly fingerprint: string; readonly step: number};
type SourceOwner = Pick<ModelDownloadTasksUseCase, "readApprovedSource" | "cancelApprovedSource">;
const forbidden = {ok: false, code: "headless.forbidden"} as const;
const unavailable = {ok: false, code: "headless.unavailable"} as const;
const isDigest = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);

/** Private host integration, not a public route or permission grant. Metadata
 * transactions prove original client ownership before touching an already loaded
 * Model owner. Runtime control never runs inside a retriable transaction. */
export async function runOwnedHeadlessModelDownloadTask(options: {
  readonly documents: StructuredDocumentStore;
  readonly hostIncarnationId: string;
  readonly scope: HeadlessOperationScope;
  readonly selection: OwnedHeadlessModelTaskSelection;
  readonly action: "read" | "cancel";
  readonly isCurrent: () => boolean;
  /** Reconstruct current workspace and ModelRead/ModelWrite policy in this owner. */
  readonly authorize: (owner: StructuredDocumentStore, scope: HeadlessOperationScope, action: "read" | "cancel") => Promise<boolean>;
  /** Only the retained loaded owner. This callback must not initialize runtime. */
  readonly peekOwner: () => SourceOwner | undefined;
}) {
  const {documents, isCurrent, authorize, peekOwner, hostIncarnationId, action} = options;
  const current = () => isHeadlessReadCurrent(isCurrent);
  let captured = false;
  try {
    if (types.isProxy(options.scope) || types.isProxy(options.selection)) return forbidden;
    const rawScope = readStrictPassiveRecord(options.scope,
      ["organizationId", "principalId", "workspaceId", "registeredClientId"]);
    const raw = readStrictPassiveRecord(options.selection, ["kind", "taskId", "fingerprint", "step"]);
    let selection: OwnedHeadlessModelTaskSelection;
    if (raw.kind === "task" && Object.keys(raw).length === 2 && isHeadlessHostIncarnationId(raw.taskId))
      selection = Object.freeze({kind: "task", taskId: raw.taskId});
    else if (raw.kind === "plan-step" && Object.keys(raw).length === 3 && isDigest(raw.fingerprint) &&
        typeof raw.step === "number" && Number.isSafeInteger(raw.step) && raw.step >= 1 && raw.step <= HEADLESS_MAX_BUILD_PLAN_STEPS)
      selection = Object.freeze({kind: "plan-step", fingerprint: raw.fingerprint, step: raw.step});
    else return forbidden;
    if (!isOrganizationId(rawScope.organizationId) || !isWorkspaceId(rawScope.workspaceId) || !isDesktopHeadlessClientId(rawScope.registeredClientId) ||
        typeof rawScope.principalId !== "string" || !rawScope.principalId || rawScope.principalId.length > 160 || hasKnownPassiveCredential(rawScope.principalId) ||
        !isHeadlessHostIncarnationId(hostIncarnationId) || !["read", "cancel"].includes(action) || !current() ||
        documents.organizationId !== undefined || !documents.runInOwnedTransaction) return forbidden;
    const scope: HeadlessOperationScope = Object.freeze({organizationId: rawScope.organizationId, principalId: rawScope.principalId,
      workspaceId: rawScope.workspaceId, registeredClientId: rawScope.registeredClientId});
    captured = true;
    const transaction = documents.runInOwnedTransaction.bind(documents);
    const fence = () => {if (!current()) throw new Error("The original task request ended.");};
    async function admit() {
      return transaction(async owner => {
        if (!current() || await authorize(owner, scope, action) !== true || !current()) return;
        const partition = owner.forOrganization(scope.organizationId);
        const reference = selection.kind === "task"
          ? await readStructuredOwnedModelPlanTask(partition, scope, hostIncarnationId, selection.taskId)
          : await readStructuredOwnedModelPlanTaskByPlan(partition, scope, hostIncarnationId, selection.fingerprint, selection.step);
        if (!reference || !current()) return;
        const digest = await readStructuredOwnedModelPlanTaskSourceDigest(partition, scope, hostIncarnationId, reference.taskId);
        if (!digest || !isDigest(digest) || !current()) return;
        return {reference, manifestDigest: "sha256:" + digest};
      }, fence);
    }
    const admitted = await admit(); if (!admitted || !current()) return forbidden;
    const owner = peekOwner(); if (!current()) return forbidden;
    if (!owner) return unavailable;
    const request = {workspaceId: scope.workspaceId, requestId: admitted.reference.taskId};
    const authority = {organizationId: scope.organizationId, principalId: scope.principalId, modelWriteAuthorized: action === "cancel"};
    const result = action === "cancel" ? await owner.cancelApprovedSource(request, admitted.manifestDigest, authority)
      : await owner.readApprovedSource(request, admitted.manifestDigest, authority);
    if (!current()) return forbidden;
    const fresh = await admit();
    if (!fresh || !current() || fresh.reference.taskId !== request.requestId || fresh.manifestDigest !== admitted.manifestDigest) return forbidden;
    if (types.isProxy(result)) return unavailable;
    const reply = readStrictPassiveRecord(result, ["activity", "cancelled"]);
    const activity = reply.activity;
    if (types.isProxy(activity)) return unavailable;
    const fields = readStrictPassiveRecord(activity, ["requestId", "workspaceId", "modelId", "displayName", "status", "progress", "error", "model",
      "startedAt", "updatedAt", "completedAt"]);
    if (fields.requestId !== request.requestId || fields.workspaceId !== scope.workspaceId ||
        !["queued", "running", "succeeded", "failed", "cancelled", "unknown"].includes(fields.status as string)) return unavailable;
    let percent: number | null = null;
    if (fields.progress !== undefined) {
      if (types.isProxy(fields.progress)) return unavailable;
      const progress = readStrictPassiveRecord(fields.progress, ["message", "current", "total", "unit", "percent", "details"]);
      if (progress.percent !== undefined) {
        if (typeof progress.percent !== "number" || !Number.isFinite(progress.percent) || progress.percent < 0 || progress.percent > 100) return unavailable;
        percent = progress.percent;
      }
    }
    if (action === "cancel" && typeof reply.cancelled !== "boolean") return unavailable;
    if (!current()) return forbidden;
    return {ok: true, value: {taskId: request.requestId,
      state: fields.status as "queued" | "running" | "succeeded" | "failed" | "cancelled" | "unknown", percent,
      ...(action === "cancel" ? {cancellationAccepted: reply.cancelled as boolean} : {}),
      registration: "requires-separate-approval" as const, runtimeReadiness: "not-checked" as const}} as const;
  } catch {return captured && current() ? unavailable : forbidden;}
}
