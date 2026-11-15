import { createHash, randomUUID } from "node:crypto";
import { createStructuredOrganizationRepositories } from "../../../adapters/persistence/organization";
import type { StructuredDocumentStore } from "../../../adapters/persistence/shared";
import { createStructuredHeadlessPlanReviewRepository, listStructuredHeadlessPlanReviews } from "../../../adapters/persistence/system-builder/createStructuredHeadlessPlanReviewRepository";
import { createLocalWorkspaceRepository } from "../../../adapters/persistence/workspace";
import type { OrganizationRequestContextProviderPort } from "../../../application/ports/organization";
import type { HeadlessPlanReviewChannel, HeadlessPlanReviewTarget } from "../../../application/ports/system-builder/headless-build-plan-review.port";
import { AuthorizeWorkspaceOperationService, createOrganizationAuthorizationPolicy } from "../../../application/services/security";
import { HeadlessBuildPlanReviewUseCase } from "../../../application/use-cases/system-builder/headless-build-plan-review.use-case";
import type { TenantPlacementConfig } from "../../../contracts/config";
import { isDesktopHeadlessClientId, readHeadlessPlanReviewAgentResult, type HeadlessHostIncarnationId } from "../../../contracts/headless";
import { readDesktopPlanApprovalView, sameDesktopPlanApproval, type DesktopPlanApprovalSelection } from "../../../contracts/headless/desktop-headless-plan-approval";
import type { ManagedBrowserPlanApprovalRequest } from "../../../contracts/headless/managed-browser-plan-approval";
import type { OrganizationRequestContext } from "../../../contracts/organization";
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
  deciding: boolean;
};

const forbidden = {ok:false, code:"forbidden"} as const;
const unconfirmed = {ok:false, code:"unconfirmed"} as const;

export function composeManagedHeadlessPlanApprovals(options: {
  readonly hostIncarnationId: HeadlessHostIncarnationId;
  readonly planClientId: string;
  readonly platform: StructuredDocumentStore;
  readonly rootDirectory: string;
  readonly contexts: OrganizationRequestContextProviderPort;
  readonly placement: TenantPlacementConfig;
  readonly now?: () => number;
}) {
  const {hostIncarnationId, planClientId, platform, rootDirectory, contexts, placement, now = Date.now} = options;
  if (platform.organizationId !== undefined || !platform.runInOwnedTransaction || !isDesktopHeadlessClientId(planClientId))
    throw new Error("Managed approval needs the current client and transaction owner.");
  const transaction = platform.runInOwnedTransaction.bind(platform);
  const views = new Map<string, View>();

  async function authorize(owner: StructuredDocumentStore, identity: Identity, workspaceId: WorkspaceId, current: () => boolean) {
    try {
      if (!current()) return false;
      const repository = createLocalWorkspaceRepository({rootDirectory, documents:owner.forOrganization(identity.organizationId)});
      const workspace = await repository.readWorkspace(workspaceId);
      if (!current() || workspace?.workspaceId !== workspaceId || workspace.organizationId !== identity.organizationId ||
          workspace.status !== "active") return false;
      const policy = createOrganizationAuthorizationPolicy({...createStructuredOrganizationRepositories(owner), tenantPlacement:placement});
      await new AuthorizeWorkspaceOperationService({organizationContext:contexts, authorizer:{async execute(input) {
        if (!(await policy.authorize(input)).allowed) throw new Error("The approval is unavailable.");
      }}}).authorizeWorkspaceOperation({workspace, operation:"headless.plan-approval", requiredScopes:["workspace:read","asset:read","asset:write"]});
      return current();
    } catch {return false;}
  }

  async function verifyAccess(identity: Identity, workspaceId: WorkspaceId, current: () => boolean) {
    try {
      const allowed = await transaction(owner => authorize(owner, identity, workspaceId, current), () => {
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
        if (!await verifyAccess(identity, workspaceId, active)) return forbidden;
        const summary = projectHeadlessPlanReview(outcome, selection.fingerprint);
        if (!summary.ok || summary.value.expiresAt <= now() ||
            (summary.value.status !== "pending" && summary.value.status !== "approved")) return forbidden;
        const ready = readDesktopPlanApprovalView({selection, viewId:view.viewId, preview:outcome.snapshot.preview, state:summary.value}, selection);
        if (!ready || createHash("sha256").update(JSON.stringify(ready.preview), "utf8").digest("hex") !== selection.fingerprint)
          return unconfirmed;
        view.revision = ready.state.revision;
        view.expiresAt = ready.state.expiresAt;
        view.stepCount = ready.state.stepCount;
        return {ok:true, value:ready, canPublish:() => active() && now() < ready.state.expiresAt} as const;
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
    const store = createStructuredHeadlessPlanReviewRepository(platform, async (owner, actual, action) =>
      exact(actual) && action === "decide" && await authorize(owner, identity, workspaceId, active), now);
    try {
      const outcome = await new HeadlessBuildPlanReviewUseCase(store, now).decide({
        fingerprint:selection.fingerprint, expectedRevision:request.decision.expectedRevision, decision:request.decision.decision,
      }, hostIncarnationId, scope, {
        ...identity, channel, isCurrent:active,
        canDecide: async actual => exact(actual) && await verifyAccess(identity, workspaceId, active),
      });
      if (!outcome.ok || !active()) return outcome.ok ? forbidden : outcome;
      const state = outcome.state;
      const value = {fingerprint:selection.fingerprint, revision:state.revision, stepCount:state.stepCount,
        expiresAt:state.expiresAt, status:state.status, approvedSteps:state.approvedSteps,
        ...(state.mode === undefined ? {} : {mode:state.mode})};
      const receipt = readHeadlessPlanReviewAgentResult({ok:true, value}, selection.fingerprint, view.stepCount);
      return receipt.ok ? {...receipt, canPublish:() => current() && now() < receipt.value.expiresAt} : unconfirmed;
    } finally {
      if (views.get(documentKey) === view) views.delete(documentKey);
    }
  };
}
