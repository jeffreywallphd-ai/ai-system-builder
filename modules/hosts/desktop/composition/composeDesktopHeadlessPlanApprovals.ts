import {
  createStructuredHeadlessPlanReviewRepository,
  listStructuredHeadlessPlanReviews,
  readStructuredHeadlessPlanModelPermission,
} from "../../../adapters/persistence/system-builder/createStructuredHeadlessPlanReviewRepository";
import type { StructuredDocumentStore } from "../../../adapters/persistence/shared";
import { createLocalWorkspaceRepository } from "../../../adapters/persistence/workspace";
import type { createDesktopHeadlessClientAuthority } from "../../../adapters/security/headless/createDesktopHeadlessClientAuthority";
import type {
  HeadlessPlanReviewChannel, HeadlessPlanReviewTarget,
} from "../../../application/ports/system-builder/headless-build-plan-review.port";
import { HeadlessBuildPlanReviewUseCase } from "../../../application/use-cases/system-builder/headless-build-plan-review.use-case";
import { isDesktopHeadlessClientId, type HeadlessHostIncarnationId } from "../../../contracts/headless";
import type { LocalIdentityProfile } from "../../../contracts/organization";
import { isWorkspaceId, type WorkspaceId } from "../../../contracts/workspace";
import { composeDesktopWorkspaceAuthorization } from "./composeDesktopWorkspaceAuthorization";

const forbidden = { ok: false, code: "forbidden" } as const;
const unconfirmed = { ok: false, code: "unconfirmed" } as const;
const requiredScopes = ["workspace:read", "asset:read", "asset:write"] as const;
const ragScopes = [...requiredScopes, "artifact:read", "artifact:write", "model:read"] as const;
type CapturePlanReviewClients = ReturnType<typeof createDesktopHeadlessClientAuthority>["capturePlanReviewClients"];

interface DesktopPlanReviewSelection {
  readonly workspaceId: WorkspaceId;
  readonly registeredClientId: string;
  readonly fingerprint: string;
}

/** Supplied by a trusted interactive host adapter after verifying its caller. */
export interface DesktopPlanReviewCaller {
  readonly channel: HeadlessPlanReviewChannel;
  readonly isCurrent: () => boolean;
}

export function composeDesktopHeadlessPlanApprovals(options: {
  readonly hostIncarnationId: HeadlessHostIncarnationId;
  readonly identity: LocalIdentityProfile;
  readonly platform: StructuredDocumentStore;
  readonly rootDirectory: string;
  readonly isOpen: () => boolean;
  readonly capturePlanReviewClients: CapturePlanReviewClients;
  readonly now?: () => number;
}) {
  const { hostIncarnationId, identity, platform, rootDirectory, isOpen, capturePlanReviewClients, now = Date.now } = options;
  if (platform.organizationId !== undefined || !platform.runInOwnedTransaction)
    throw new Error("Desktop plan approvals require the platform transaction owner.");
  const ownedTransaction = platform.runInOwnedTransaction.bind(platform);
  const { organizationId, principalId } = identity;

  async function authorize(owner: StructuredDocumentStore, workspaceId: WorkspaceId, operation: "list" | "read" | "decide",
    current: () => boolean, usesModel = false) {
    try {
      if (!current() || !isWorkspaceId(workspaceId)) return false;
      const documents = owner.forOrganization(organizationId);
      const repository = createLocalWorkspaceRepository({ rootDirectory, documents });
      const workspace = await repository.readWorkspace(workspaceId);
      if (!current() || workspace?.workspaceId !== workspaceId || workspace.organizationId !== organizationId ||
          workspace.status !== "active") return false;
      await composeDesktopWorkspaceAuthorization({ documents: owner, localIdentity: identity }).authorizeWorkspaceOperation({
        workspace, operation: `headless.plan-approval.${operation}`, requiredScopes: usesModel ? ragScopes : requiredScopes,
      });
      return current();
    } catch { return false; }
  }

  function reviewSelection(selection: DesktopPlanReviewSelection, caller: DesktopPlanReviewCaller, kind: "read" | "decide") {
    const { workspaceId, registeredClientId, fingerprint } = selection;
    if (!isWorkspaceId(workspaceId) || !isDesktopHeadlessClientId(registeredClientId) ||
        typeof fingerprint !== "string" || !/^[a-f0-9]{64}$/.test(fingerprint)) return;
    let requesterCurrent: (() => boolean) | undefined;
    const current = () => isOpen() && caller.isCurrent() && (requesterCurrent?.() ?? true);
    const target: HeadlessPlanReviewTarget = {
      hostIncarnationId, fingerprint, scope: { organizationId, principalId, workspaceId, registeredClientId },
    };
    async function canAccess(owner: StructuredDocumentStore) {
      if (!await authorize(owner, workspaceId, kind, current)) return false;
      const permissions = await readStructuredHeadlessPlanModelPermission(owner.forOrganization(organizationId), target);
      if (!permissions || !current() || (permissions.requiresModelRead && !await authorize(owner, workspaceId, kind, current, true))) return false;
      const clients = await capturePlanReviewClients(owner.forOrganization(organizationId), workspaceId);
      const requester = clients.find(client => client.registeredClientId === registeredClientId);
      if (!requester || !current()) return false;
      requesterCurrent = requester.isCurrent;
      return current();
    }
    const store = createStructuredHeadlessPlanReviewRepository(platform, async (owner, actual, action) =>
      action === kind && actual.hostIncarnationId === hostIncarnationId && actual.fingerprint === fingerprint &&
      actual.scope.organizationId === organizationId && actual.scope.principalId === principalId &&
      actual.scope.workspaceId === workspaceId && actual.scope.registeredClientId === registeredClientId &&
      await canAccess(owner), now);
    async function verify() {
      try {
        const allowed = await ownedTransaction(canAccess, () => {
          if (!current()) throw new Error("The approval caller is unavailable.");
        });
        return allowed && current();
      } catch { return false; }
    }
    return { target, store, current, verify };
  }

  return {
    async list(workspaceId: WorkspaceId, isCurrent: () => boolean) {
      const current = () => isOpen() && isCurrent();
      const selection = { hostIncarnationId, scope: { organizationId, workspaceId, principalId } };
      try {
        let clients: Awaited<ReturnType<CapturePlanReviewClients>> = [];
        const result = await listStructuredHeadlessPlanReviews(platform, { target: selection, isCurrent: current },
          async owner => {
            if (!await authorize(owner, workspaceId, "list", current)) return false;
            clients = await capturePlanReviewClients(owner.forOrganization(organizationId), workspaceId);
            return current();
          }, now);
        if (!result.ok) return result;
        if (!current()) return forbidden;
        const observedAt = now();
        const liveClients = new Map(clients.map(client => [client.registeredClientId, client.isCurrent]));
        return { ok: true, requests: result.requests.filter(entry =>
          entry.expiresAt > observedAt && liveClients.get(entry.registeredClientId)?.() === true) } as const;
      } catch { return current() ? unconfirmed : forbidden; }
    },
    async open(selection: DesktopPlanReviewSelection, caller: DesktopPlanReviewCaller) {
      const review = reviewSelection(selection, caller, "read");
      if (!review) return forbidden;
      try {
        const result = await review.store.read({ target: review.target, isCurrent: review.current });
        if (!await review.verify() || !review.current()) return forbidden;
        if (result.ok && result.snapshot.state.expiresAt <= now()) return { ok: false, code: "expired" } as const;
        return result;
      } catch { return review.current() ? unconfirmed : forbidden; }
    },
    async decide(selection: DesktopPlanReviewSelection, raw: unknown, caller: DesktopPlanReviewCaller) {
      const review = reviewSelection(selection, caller, "decide");
      if (!review) return forbidden;
      const result = await new HeadlessBuildPlanReviewUseCase(review.store, now).decide(raw, hostIncarnationId, review.target.scope, {
        organizationId, principalId, channel: caller.channel,
        isCurrent: review.current, canDecide: async actual =>
          actual.fingerprint === review.target.fingerprint && await review.verify(),
      });
      return review.current() ? result : forbidden;
    },
  };
}
