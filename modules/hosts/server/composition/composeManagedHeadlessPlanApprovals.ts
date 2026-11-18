import { createHash, randomUUID } from "node:crypto";
import { createStructuredOrganizationRepositories } from "../../../adapters/persistence/organization";
import {
  createStructuredHeadlessLocalFileSelectionRepository, readStructuredHeadlessLocalFileSelection,
  createStructuredHeadlessProviderFileSelectionRepository, readStructuredHeadlessProviderFileSelection,
} from
  "../../../adapters/persistence/ingestion/createStructuredHeadlessLocalFileSelectionRepository";
import type { StructuredDocumentStore } from "../../../adapters/persistence/shared";
import { createStructuredHeadlessPlanReviewRepository, listStructuredHeadlessPlanReviews } from "../../../adapters/persistence/system-builder/createStructuredHeadlessPlanReviewRepository";
import { createLocalWorkspaceRepository } from "../../../adapters/persistence/workspace";
import type { OrganizationRequestContextProviderPort } from "../../../application/ports/organization";
import type { HeadlessPlanReviewChannel, HeadlessPlanReviewTarget } from "../../../application/ports/system-builder/headless-build-plan-review.port";
import { AuthorizeWorkspaceOperationService, createOrganizationAuthorizationPolicy } from "../../../application/services/security";
import { HeadlessBuildPlanReviewUseCase } from "../../../application/use-cases/system-builder/headless-build-plan-review.use-case";
import type { HeadlessLocalFileSelection } from "../../../application/ports/ingestion/headless-local-file-selection.port";
import {
  HeadlessLocalFileSelectionUseCase, HeadlessProviderFileSelectionUseCase,
} from "../../../application/use-cases/ingestion-acquisition/headless-local-file-selection.use-case";
import { ReadHeadlessIngestionStatusUseCase } from "../../../application/use-cases/ingestion-acquisition/headless-ingestion-status.use-case";
import type { TenantPlacementConfig } from "../../../contracts/config";
import { HEADLESS_CONTRACT_VERSION, isDesktopHeadlessClientId, readHeadlessPlanReviewAgentResult,
  type HeadlessHostIncarnationId } from "../../../contracts/headless";
import { readDesktopPlanApprovalView, sameDesktopPlanApproval, type DesktopPlanApprovalSelection } from "../../../contracts/headless";
import type { ManagedBrowserPlanApprovalRequest } from "../../../contracts/headless";
import type { OrganizationRequestContext } from "../../../contracts/organization";
import type { SecurityScope } from "../../../contracts/security";
import type { WorkspaceId } from "../../../contracts/workspace";
import { projectHeadlessPlanReview } from "../../shared/composition/headlessPlanReview";

type Identity = Pick<OrganizationRequestContext, "organizationId" | "principalId">;
type View = {
  readonly viewId: string;
  readonly selection: DesktopPlanApprovalSelection;
  readonly documentCurrent: () => boolean;
  revision?: number;
  expiresAt?: number;
  stepCount?: number;
  fileSave?: boolean;
  usesModel?: boolean;
  deciding: boolean;
};

const forbidden = {ok:false, code:"forbidden"} as const;
const unconfirmed = {ok:false, code:"unconfirmed"} as const;
const planScopes = ["workspace:read", "asset:read", "asset:write"] as const;
const fileScopes = ["workspace:read", "artifact:read", "artifact:write"] as const;
const filePlanScopes = [...planScopes, "artifact:read", "artifact:write"] as const;
const ragScopes = [...filePlanScopes, "model:read"] as const;

export function composeManagedHeadlessPlanApprovals(options: {
  readonly hostIncarnationId: HeadlessHostIncarnationId;
  readonly planClientId: string;
  readonly platform: StructuredDocumentStore;
  readonly rootDirectory: string;
  readonly contexts: OrganizationRequestContextProviderPort;
  readonly placement: TenantPlacementConfig;
  readonly localIngestion?: ConstructorParameters<typeof ReadHeadlessIngestionStatusUseCase>[0];
  readonly allowLocalFileSave?: boolean;
  readonly allowProviderFileSave?: boolean;
  readonly allowLocalDatasetPreparation?: boolean;
  readonly allowDatasetResultSave?: boolean;
  readonly allowContextPackGeneration?: boolean;
  readonly allowContextRagGeneration?: boolean;
  readonly allowContextResultSave?: boolean;
  readonly allowContextQuery?: boolean;
  readonly now?: () => number;
}) {
  const {hostIncarnationId, planClientId, platform, rootDirectory, contexts, placement, now = Date.now} = options;
  if (platform.organizationId !== undefined || !platform.runInOwnedTransaction || !isDesktopHeadlessClientId(planClientId))
    throw new Error("Managed approval needs the current client and transaction owner.");
  const transaction = platform.runInOwnedTransaction.bind(platform);
  const stableReads = platform.publishWithStableReads?.bind(platform);
  const allowLocalFileSave = options.allowLocalFileSave === true && stableReads !== undefined;
  const allowProviderFileSave = options.allowProviderFileSave === true && stableReads !== undefined;
  const allowLocalDatasetPreparation = options.allowLocalDatasetPreparation === true && stableReads !== undefined;
  const allowDatasetResultSave = options.allowDatasetResultSave === true && stableReads !== undefined;
  const allowContextPackGeneration = options.allowContextPackGeneration === true && stableReads !== undefined;
  const allowContextRagGeneration = options.allowContextRagGeneration === true && stableReads !== undefined;
  const allowContextQuery = options.allowContextQuery === true && stableReads !== undefined;
  const allowContextResultSave = options.allowContextResultSave === true && stableReads !== undefined;
  const views = new Map<string, View>();

  async function authorize(owner: StructuredDocumentStore, identity: Identity, workspaceId: WorkspaceId, current: () => boolean,
    requiredScopes: readonly SecurityScope[] = planScopes, operation = "headless.plan-approval") {
    try {
      if (!current()) return false;
      const repository = createLocalWorkspaceRepository({rootDirectory, documents:owner.forOrganization(identity.organizationId)});
      const workspace = await repository.readWorkspace(workspaceId);
      if (!current() || workspace?.workspaceId !== workspaceId || workspace.organizationId !== identity.organizationId ||
          workspace.status !== "active") return false;
      const policy = createOrganizationAuthorizationPolicy({...createStructuredOrganizationRepositories(owner), tenantPlacement:placement});
      await new AuthorizeWorkspaceOperationService({organizationContext:contexts, authorizer:{async execute(input) {
        if (!(await policy.authorize(input)).allowed) throw new Error("The approval is unavailable.");
      }}}).authorizeWorkspaceOperation({workspace, operation, requiredScopes});
      return current();
    } catch {return false;}
  }

  async function verifyAccess(identity: Identity, workspaceId: WorkspaceId, current: () => boolean,
    requiredScopes: readonly SecurityScope[] = planScopes) {
    try {
      const allowed = await transaction(owner => authorize(owner, identity, workspaceId, current, requiredScopes), () => {
        if (!current()) throw new Error("The approval document is unavailable.");
      });
      return allowed && current();
    } catch {return false;}
  }

  return async function execute(request: ManagedBrowserPlanApprovalRequest, identity: Identity,
    documentCurrent: () => boolean, responseCurrent: () => boolean, channel: HeadlessPlanReviewChannel = "app-popup") {
    const documentKey = `${request.document.windowId}:${channel}`;
    const {workspaceId} = request.document;
    const current = () => {
      const context = contexts.getCurrentOrganizationContext();
      return responseCurrent() && documentCurrent() && context?.organizationId === identity.organizationId &&
        context.principalId === identity.principalId;
    };
    if (!current() || request.document.hostIncarnationId !== hostIncarnationId) return forbidden;
    for (const [key, view] of views) {
      if (!view.documentCurrent() || (view.expiresAt !== undefined && view.expiresAt <= now())) views.delete(key);
    }
    const {organizationId, principalId} = identity;
    const baseScope = {organizationId, principalId, workspaceId};
    function publishFilePlanReply(isFresh: () => boolean, requiredScopes: readonly SecurityScope[] = filePlanScopes) {
      return async (publish: () => boolean) => {
        if (!stableReads || !isFresh()) return false;
        try {
          return await stableReads(owner => authorize(owner, identity, workspaceId, isFresh, requiredScopes),
            () => isFresh() && publish());
        } catch {return false;}
      };
    }
    if (request.operation === "list-file-clients" || request.operation === "select-file" || request.operation === "select-provider-file") {
      const ingestion = options.localIngestion;
      if (channel !== "app-popup" || !ingestion || !stableReads) return forbidden;
      const isSelect = request.operation !== "list-file-clients";
      const provider = request.operation === "select-provider-file";
      const operation = provider ? "headless.data.select-provider-file"
        : isSelect ? "headless.data.select-local-file" : "headless.data.list-file-clients";
      const authorizeFile = (owner: StructuredDocumentStore) => authorize(owner, identity, workspaceId, current,
        fileScopes, operation);
      const requireCurrent = () => { if (!current()) throw new Error("The file selection document is unavailable."); };
      const stillAllowed = () => transaction(authorizeFile, requireCurrent).catch(() => false);
      if (!await stillAllowed() || !current()) return forbidden;
      if (!isSelect) return {
        ok: true, value: [planClientId], canPublish: current,
        publishIfCurrent: (publish: () => boolean) => stableReads(authorizeFile, () => current() && publish()),
      } as const;

      const { registeredClientId, expectedSelectionRevision, ...selectedFile } = request.file;
      if (registeredClientId !== planClientId || selectedFile.workspaceId !== workspaceId) return forbidden;
      const target = { hostIncarnationId, ...selectedFile };
      const selection = { organizationId, principalId, registeredClientId, target };
      const writePolicy = {
        platform, async allows(owner: StructuredDocumentStore, item: HeadlessLocalFileSelection) {
          return item.organizationId === organizationId && item.principalId === principalId &&
            item.registeredClientId === planClientId && item.target.workspaceId === workspaceId &&
            item.target.hostIncarnationId === hostIncarnationId && item.target.taskId === target.taskId &&
            item.target.fileId === target.fileId && item.target.taskRevision === target.taskRevision && await authorizeFile(owner);
        },
      };
      const documents = platform.forOrganization(organizationId);
      const status = new ReadHeadlessIngestionStatusUseCase(ingestion, now);
      const files = provider
        ? new HeadlessProviderFileSelectionUseCase(createStructuredHeadlessProviderFileSelectionRepository(documents, now, writePolicy), status, now)
        : new HeadlessLocalFileSelectionUseCase(createStructuredHeadlessLocalFileSelectionRepository(documents, now, writePolicy), status, now);
      const selected = await files
        .recordSelectedFile({ version: HEADLESS_CONTRACT_VERSION,
          operation: provider ? "data.prepare-provider-file" : "data.prepare-local-file", input: target },
          { context: baseScope, hostIncarnationId, registeredClientId, expectedSelectionRevision, isCurrent: current, stillAllowed });
      if (!selected.ok || !current()) return forbidden;
      const { taskId, fileId, taskRevision } = selected.value;
      const expiresAt = "selectionExpiresAt" in selected.value ? selected.value.selectionExpiresAt : selected.value.checkpointExpiresAt;
      const ready = () => {
        const time = now();
        return current() && Number.isSafeInteger(time) && time > 0 && time < expiresAt;
      };
      return {
        ok: true, value: { workspaceId, taskId, fileId, taskRevision, selectionRevision: selected.selectionRevision }, canPublish: ready,
        publishIfCurrent: (publish: () => boolean) => stableReads(async owner => {
          if (!await authorizeFile(owner) || !ready()) return false;
          const scope = owner.forOrganization(organizationId);
          const latest = provider ? await readStructuredHeadlessProviderFileSelection(scope, selection, now)
            : await readStructuredHeadlessLocalFileSelection(scope, selection, now);
          return latest?.ok === true && JSON.stringify(latest.value) === JSON.stringify(selected.value) && ready();
        }, () => ready() && publish()),
      } as const;
    }
    if (request.operation === "list") {
      const result = await listStructuredHeadlessPlanReviews(platform, {target:{hostIncarnationId, scope:baseScope}, isCurrent:current},
        owner => authorize(owner, identity, workspaceId, current), now);
      if (!result.ok || !current()) return forbidden;
      const entries = result.requests.filter(item => item.registeredClientId === planClientId)
        .map(item => ({...item, workspaceId}));
      return {ok:true, value:entries, canPublish:() => {
        const observedAt = now();
        return current() && entries.every(entry => entry.expiresAt > observedAt);
      }} as const;
    }
    if (request.operation === "dismiss") {
      if (views.get(documentKey)?.viewId === request.viewId) views.delete(documentKey);
      return {ok:true, value:true} as const;
    }
    const selection = request.operation === "open" ? request.selection : request.decision.selection;
    if (selection.workspaceId !== workspaceId || selection.registeredClientId !== planClientId) return forbidden;
    const scope = { ...baseScope, registeredClientId:planClientId };
    const target = { hostIncarnationId, fingerprint:selection.fingerprint, scope };
    function exact(other: HeadlessPlanReviewTarget) {
      return other.hostIncarnationId === hostIncarnationId && other.fingerprint === selection.fingerprint &&
        other.scope.workspaceId === workspaceId && other.scope.organizationId === identity.organizationId &&
        other.scope.principalId === identity.principalId && other.scope.registeredClientId === planClientId;
    }

    if (request.operation === "open") {
      if (!views.has(documentKey) && views.size >= 32) return unconfirmed;
      const view: View = {viewId:randomUUID(), documentCurrent, selection, deciding:false};
      views.set(documentKey, view);
      const active = () => current() && views.get(documentKey) === view;
      const store = createStructuredHeadlessPlanReviewRepository(platform, async (owner, actual, action) =>
        exact(actual) && action === "read" && await authorize(owner, identity, workspaceId, active), now);
      try {
        const outcome = await store.read({target, isCurrent:active});
        if (!outcome.ok || !active()) return forbidden;
        const summary = projectHeadlessPlanReview(outcome, selection.fingerprint);
        if (!summary.ok || summary.value.expiresAt <= now() ||
            (summary.value.status !== "pending" && summary.value.status !== "approved")) return forbidden;
        const ready = readDesktopPlanApprovalView({selection, viewId:view.viewId, preview:outcome.snapshot.preview, state:summary.value},
          selection, { allowLocalFileSave, allowProviderFileSave, allowLocalDatasetPreparation, allowDatasetResultSave,
            allowContextPackGeneration, allowContextRagGeneration, allowContextResultSave, allowContextQuery });
        if (!ready || createHash("sha256").update(JSON.stringify(ready.preview), "utf8").digest("hex") !== selection.fingerprint)
          return unconfirmed;
        const fileSave = ready.preview.steps.some(step => step.operation === "data.save-local-source" || step.operation === "data.save-provider-source" ||
          step.operation === "data.prepare-local-dataset" || step.operation === "data.save-prepared-dataset" ||
          step.operation === "context.generate-pack" || step.operation === "context.generate-rag" || step.operation === "context.save-result");
        const usesModel = ready.preview.steps.some(step => step.operation === "context.generate-rag" || step.operation === "context.query");
        const requiredScopes = usesModel ? fileSave ? ragScopes : [...planScopes, "artifact:read", "model:read"] as const : fileSave ? filePlanScopes : planScopes;
        if (!await verifyAccess(identity, workspaceId, active, requiredScopes)) return forbidden;
        view.revision = ready.state.revision;
        view.expiresAt = ready.state.expiresAt;
        view.stepCount = ready.state.stepCount;
        view.fileSave = fileSave;
        view.usesModel = usesModel;
        const canPublish = () => active() && now() < ready.state.expiresAt;
        return {ok:true, value:ready, canPublish,
          ...(fileSave || usesModel ? {publishIfCurrent:publishFilePlanReply(canPublish, requiredScopes)} : {})} as const;
      } finally {
        if (views.get(documentKey) === view && view.revision === undefined) views.delete(documentKey);
      }
    }

    const view = views.get(documentKey);
    if (!view || view.deciding || view.stepCount === undefined || view.viewId !== request.decision.viewId ||
        view.revision !== request.decision.expectedRevision ||
        !sameDesktopPlanApproval(view.selection, selection)) return forbidden;
    const active = () => current() && view.documentCurrent() && views.get(documentKey) === view &&
      view.expiresAt !== undefined && now() < view.expiresAt;
    if (!active()) return forbidden;
    view.deciding = true;
    const requiredScopes = view.usesModel ? view.fileSave ? ragScopes : [...planScopes, "artifact:read", "model:read"] as const : view.fileSave ? filePlanScopes : planScopes;
    const store = createStructuredHeadlessPlanReviewRepository(platform, async (owner, actual, action) =>
      exact(actual) && action === "decide" && await authorize(owner, identity, workspaceId, active, requiredScopes), now);
    try {
      const outcome = await new HeadlessBuildPlanReviewUseCase(store, now).decide({
        fingerprint:selection.fingerprint, expectedRevision:request.decision.expectedRevision, decision:request.decision.decision,
      }, hostIncarnationId, scope, {
        ...identity, channel, isCurrent:active,
        canDecide: async actual => exact(actual) && await verifyAccess(identity, workspaceId, active, requiredScopes),
      });
      if (!outcome.ok || !active()) return outcome.ok ? forbidden : outcome;
      const state = outcome.state;
      const value = {fingerprint:selection.fingerprint, revision:state.revision, stepCount:state.stepCount,
        expiresAt:state.expiresAt, status:state.status, approvedSteps:state.approvedSteps,
        ...(state.mode === undefined ? {} : {mode:state.mode})};
      const receipt = readHeadlessPlanReviewAgentResult({ok:true, value}, selection.fingerprint, view.stepCount);
      if (!receipt.ok) return unconfirmed;
      const canPublish = () => current() && now() < receipt.value.expiresAt;
      return {...receipt, canPublish,
        ...(view.fileSave || view.usesModel ? {publishIfCurrent:publishFilePlanReply(canPublish, requiredScopes)} : {})};
    } finally {
      if (views.get(documentKey) === view) views.delete(documentKey);
    }
  };
}
