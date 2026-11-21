import {types} from "node:util";
import type {StructuredDocumentStore} from "../../../adapters/persistence/shared";
import {readStructuredOwnedModelPlanTask, readStructuredOwnedModelPlanTaskByPlan,
  readStructuredOwnedModelPlanTaskSourceDigest, readStructuredModelPlanTaskLineage} from "../../../adapters/persistence/system-builder/createStructuredHeadlessModelPlanTaskStore";
import type {ModelDownloadTasksUseCase} from "../../../application/use-cases/model/model-download-tasks.use-case";
import type {HeadlessOperationScope} from "../../../application/ports/system-builder";
import {isDesktopHeadlessClientId, isHeadlessHostIncarnationId, readHeadlessModelTaskSelection, type HeadlessModelTaskSelection,
  readHeadlessModelTaskCancellationRequest, readHeadlessModelTaskCancellationValue,
  type HeadlessModelTaskCancellationResult} from "../../../contracts/headless";
import {isOrganizationId} from "../../../contracts/organization";
import {isWorkspaceId} from "../../../contracts/workspace";
import {readStrictPassiveRecord, hasKnownPassiveCredential} from "../../../contracts/shared";
import {isHeadlessReadCurrent} from "./headlessReadCurrent";

export type OwnedHeadlessModelTaskSelection = HeadlessModelTaskSelection;
export type OwnedHeadlessModelTaskReader = (query: {readonly scope: HeadlessOperationScope;
  readonly selection: HeadlessModelTaskSelection; readonly isCurrent: () => boolean}) => ReturnType<typeof runOwnedHeadlessModelDownloadTask>;
type SourceOwner = Pick<ModelDownloadTasksUseCase, "readApprovedSource" | "cancelApprovedSource">;
export type OwnedHeadlessModelSourceTasks = SourceOwner;
const forbidden = {ok: false, code: "headless.forbidden"} as const;
const unavailable = {ok: false, code: "headless.unavailable"} as const;
const isDigest = (value: unknown): value is string => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
function captureScope(value: unknown): HeadlessOperationScope | undefined {
  try {
    if (types.isProxy(value)) return;
    const raw = readStrictPassiveRecord(value, ["organizationId", "principalId", "workspaceId", "registeredClientId"]);
    if (!isOrganizationId(raw.organizationId) || !isWorkspaceId(raw.workspaceId) || !isDesktopHeadlessClientId(raw.registeredClientId) ||
        typeof raw.principalId !== "string" || !raw.principalId || raw.principalId.length > 160 || hasKnownPassiveCredential(raw.principalId)) return;
    return Object.freeze({organizationId: raw.organizationId, principalId: raw.principalId,
      workspaceId: raw.workspaceId, registeredClientId: raw.registeredClientId});
  } catch {return;}
}

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
    if (types.isProxy(options.selection)) return forbidden;
    const parsedScope = captureScope(options.scope); if (!parsedScope) return forbidden;
    const scope: HeadlessOperationScope = parsedScope;
    const parsedSelection = readHeadlessModelTaskSelection(options.selection);
    if (!parsedSelection) return forbidden;
    const selection: OwnedHeadlessModelTaskSelection = parsedSelection;
    if (!isHeadlessHostIncarnationId(hostIncarnationId) || !["read", "cancel"].includes(action) || !current() ||
        documents.organizationId !== undefined || !documents.runInOwnedTransaction) return forbidden;
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
        const lineage = await readStructuredModelPlanTaskLineage(partition, scope, hostIncarnationId, reference.taskId);
        if (!lineage || !current() || lineage.sourceDigest !== digest || lineage.target.scope.workspaceId !== reference.workspaceId ||
            (selection.kind === "plan-step" && (lineage.target.fingerprint !== selection.fingerprint || lineage.step !== selection.step))) return;
        return {reference, manifestDigest: "sha256:" + digest,
          plan: Object.freeze({fingerprint: lineage.target.fingerprint, step: lineage.step})};
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
    if (!fresh || !current() || fresh.reference.workspaceId !== admitted.reference.workspaceId || fresh.reference.taskId !== request.requestId ||
        fresh.manifestDigest !== admitted.manifestDigest || fresh.plan.fingerprint !== admitted.plan.fingerprint || fresh.plan.step !== admitted.plan.step) return forbidden;
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
    return {ok: true, value: {workspaceId: fresh.reference.workspaceId, taskId: request.requestId, plan: fresh.plan,
      state: fields.status as "queued" | "running" | "succeeded" | "failed" | "cancelled" | "unknown", percent,
      ...(action === "cancel" ? {cancellationAccepted: reply.cancelled as boolean} : {}),
      registration: "requires-separate-approval" as const, runtimeReadiness: "not-checked" as const}} as const;
  } catch {return captured && current() ? unavailable : forbidden;}
}

/** Private cancellation admission. Losing a reply never proves no native effect.
 * The original task owner retains its independent business/cleanup lifetime. */
export async function runOwnedHeadlessModelDownloadCancellation(options:
  Omit<Parameters<typeof runOwnedHeadlessModelDownloadTask>[0], "selection" | "action"> & {
    readonly request: unknown; readonly canUse: () => Promise<boolean>;
  }): Promise<HeadlessModelTaskCancellationResult> {
  const {documents, hostIncarnationId, isCurrent, authorize, peekOwner, canUse, request} = options;
  const current = () => isHeadlessReadCurrent(isCurrent);
  const unconfirmed = {ok: false, code: "headless.operation-unconfirmed"} as const;
  let sourceEntered = false;
  try {
    if (!isHeadlessHostIncarnationId(hostIncarnationId)) return {ok: false, code: "headless.invalid-request"};
    const parsed = readHeadlessModelTaskCancellationRequest(request, hostIncarnationId);
    if (!parsed.ok) return parsed;
    const scope = captureScope(options.scope); if (!scope) return forbidden;
    if (scope.workspaceId !== parsed.request.input.workspaceId || !current()) return forbidden;
    const result = await runOwnedHeadlessModelDownloadTask({documents, hostIncarnationId, scope,
      selection: parsed.request.input.selection, action: "cancel", isCurrent: current, authorize,
      peekOwner: () => {
        const owner = peekOwner();
        if (!owner) return;
        const cancel = owner.cancelApprovedSource.bind(owner);
        return {readApprovedSource: owner.readApprovedSource.bind(owner), async cancelApprovedSource(...args) {
          if (!current() || await canUse() !== true || !current()) throw new Error("Model cancellation is unavailable.");
          sourceEntered = true;
          return cancel(...args);
        }};
      }});
    if (!result.ok) return sourceEntered ? unconfirmed : result;
    if (!current() || await canUse() !== true || !current()) return sourceEntered ? unconfirmed : forbidden;
    const value = readHeadlessModelTaskCancellationValue(result.value, parsed.request.input);
    return value ? {ok: true, operation: "models.cancel-download", value} : sourceEntered ? unconfirmed : unavailable;
  } catch {return sourceEntered ? unconfirmed : current() ? unavailable : forbidden;}
}
