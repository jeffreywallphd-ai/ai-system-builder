import { createHash } from "node:crypto";

import { createStructuredOrganizationRepositories } from "../../../adapters/persistence/organization";
import type { StructuredDocumentStore } from "../../../adapters/persistence/shared";
import { createStructuredHeadlessPlanReviewRepository } from "../../../adapters/persistence/system-builder/createStructuredHeadlessPlanReviewRepository";
import { readStructuredHeadlessLocalFileSelection } from "../../../adapters/persistence/ingestion/createStructuredHeadlessLocalFileSelectionRepository";
import { prepareStructuredHeadlessPlanStep } from "../../../adapters/persistence/system-builder/createStructuredHeadlessPlanStepOperationStore";
import { createLocalWorkspaceRepository } from "../../../adapters/persistence/workspace";
import type { OrganizationRequestContextProviderPort } from "../../../application/ports/organization";
import type { WorkspaceOperationAuthorizationPort } from "../../../application/ports/security";
import type { WorkspaceRepository } from "../../../application/ports/workspace";
import { AuthorizeWorkspaceOperationService, createOrganizationAuthorizationPolicy } from "../../../application/services/security";
import type { TenantPlacementConfig } from "../../../contracts/config";
import { isDesktopHeadlessClientId, readHeadlessPlanStepResult, type HeadlessHostIncarnationId,
  type HeadlessLocalFileImportRequest, type HeadlessLocalFileImportResult,
  type HeadlessPlanReviewAgentRequest, type HeadlessPlanReviewAgentResult, type HeadlessPlanStepRequest,
  type HeadlessPlanStepResult } from "../../../contracts/headless";
import type { WorkspaceId } from "../../../contracts/workspace";
import type { SecurityScope } from "../../../contracts/security";
import type { SystemBuilderCompositionRoot } from "../../shared/composition/composeSystemBuilder";
import { projectHeadlessPlanReview, validateHeadlessPlanSavedSources } from "../../shared/composition/headlessPlanReview";
import type { ManagedPlanReviewRegistration } from "../security/resolveManagedHeadlessClientPolicy";

const forbidden = { ok: false, code: "headless.forbidden" } as const;
const unavailable = { ok: false, code: "headless.unavailable" } as const;
const unconfirmed = { ok: false, code: "headless.operation-unconfirmed" } as const;

export function composeManagedHeadlessPlanReview(options: {
  readonly hostIncarnationId: HeadlessHostIncarnationId;
  readonly platform: StructuredDocumentStore;
  readonly rootDirectory: string;
  readonly workspaces: Pick<WorkspaceRepository, "readWorkspace">;
  readonly contexts: OrganizationRequestContextProviderPort;
  readonly authorization: WorkspaceOperationAuthorizationPort;
  readonly placement: TenantPlacementConfig;
  readonly systems?: Pick<SystemBuilderCompositionRoot, "composeHeadlessAuthoring">;
  readonly enableLocalFilePreview?: boolean;
}) {
  const { hostIncarnationId, platform, rootDirectory, workspaces, contexts, authorization, placement, systems } = options;
  if (platform.organizationId !== undefined || !platform.runInOwnedTransaction)
    throw new Error("Managed plan review requires the platform transaction owner.");

  function admitWorkspace(requested: Pick<HeadlessPlanReviewAgentRequest["target"], "workspaceId" | "hostIncarnationId">,
    operation: string, registration: ManagedPlanReviewRegistration, isOpen: () => boolean,
    requiredScopes: readonly SecurityScope[] = ["workspace:read", "asset:read", "asset:write"]) {
    const { organizationId, principalId, registeredClientId } = registration;
    const { workspaceId } = requested;
    const current = () => {
      const active = contexts.getCurrentOrganizationContext();
      return isOpen() && registration.isCurrent() && active?.organizationId === organizationId && active?.principalId === principalId;
    };
    if (registration.purpose !== "plan-review" || !isDesktopHeadlessClientId(registeredClientId) ||
        requested.hostIncarnationId !== hostIncarnationId || !current()) return;
    const scope = { organizationId, principalId, registeredClientId, workspaceId };

    async function authorize(repository: typeof workspaces, policy: WorkspaceOperationAuthorizationPort) {
      try {
        if (!current()) return false;
        const workspace = await repository.readWorkspace(workspaceId);
        if (!current() || workspace?.workspaceId !== workspaceId || workspace.organizationId !== organizationId ||
            workspace.status !== "active") return false;
        await policy.authorizeWorkspaceOperation({ workspace, operation: "headless." + operation,
          requiredScopes });
        return current();
      } catch { return false; }
    }

    return {
      scope, current,
      async authorizeCurrent() { return authorize(workspaces, authorization); },
      async authorizeOwned(owner: StructuredDocumentStore) {
        const repository = createLocalWorkspaceRepository({ rootDirectory, documents: owner.forOrganization(organizationId) });
        const policy = createOrganizationAuthorizationPolicy({ ...createStructuredOrganizationRepositories(owner), tenantPlacement: placement });
        const authorizer = new AuthorizeWorkspaceOperationService({ organizationContext: contexts, authorizer: {
          async execute(input) {
            const decision = await policy.authorize(input);
            if (!decision.allowed) throw new Error("The workspace is unavailable.");
          },
        } });
        return authorize(repository, authorizer);
      },
    };
  }

  function admit(requested: HeadlessPlanReviewAgentRequest["target"], operation: string,
    registration: ManagedPlanReviewRegistration, isOpen: () => boolean) {
    const access = admitWorkspace(requested, operation, registration, isOpen);
    if (access) return { ...access, target: { hostIncarnationId, fingerprint: requested.fingerprint, scope: access.scope } };
  }

  async function previewSelectedFile(request: HeadlessLocalFileImportRequest, registration: ManagedPlanReviewRegistration,
    isOpen: () => boolean): Promise<{ readonly result: HeadlessLocalFileImportResult;
      readonly publishIfCurrent?: (publish: () => boolean) => Promise<boolean> }> {
    const stableReads = platform.publishWithStableReads?.bind(platform);
    const access = admitWorkspace(request.input, "data.local-file-preview", registration, isOpen, ["workspace:read", "artifact:read"]);
    if (!options.enableLocalFilePreview || !stableReads || !access) return { result: forbidden };
    const { organizationId, principalId, registeredClientId } = access.scope;
    const selection = { organizationId, principalId, registeredClientId, target: request.input };
    async function observe(owner: StructuredDocumentStore) {
      if (!await access!.authorizeOwned(owner) || !access!.current()) return forbidden;
      const value = await readStructuredHeadlessLocalFileSelection(owner.forOrganization(organizationId), selection);
      return value && access!.current() ? value : forbidden;
    }
    try {
      const result = await platform.runInOwnedTransaction!(observe, () => {});
      if (!access.current()) return { result: forbidden };
      if (!result.ok && result.code !== "headless.stale" && result.code !== "headless.source-not-ready") return { result };
      return {
        result,
        async publishIfCurrent(publish) {
          if (!access.current()) return false;
          try {
            return await stableReads(async owner => JSON.stringify(await observe(owner)) === JSON.stringify(result),
              () => access.current() && (!result.ok || Date.now() < result.value.checkpointExpiresAt) && publish());
          } catch { return false; }
        },
      };
    } catch { return { result: access.current() ? unavailable : forbidden }; }
  }

  const handlers = {
    async execute(request: HeadlessPlanReviewAgentRequest, registration: ManagedPlanReviewRegistration,
      isOpen: () => boolean): Promise<HeadlessPlanReviewAgentResult> {
      const access = admit(request.target, request.operation, registration, isOpen);
      if (!access) return forbidden;
      const { target, scope, current, authorizeOwned } = access;
      const action = request.operation === "plan.submit" ? "propose" : "read";
      try {
        if (!await access.authorizeCurrent()) return forbidden;
        const reviews = createStructuredHeadlessPlanReviewRepository(platform, async (owner, actual, requested) => {
          const stored = actual.scope;
          return requested === action && actual.hostIncarnationId === hostIncarnationId && actual.fingerprint === target.fingerprint &&
            stored.organizationId === scope.organizationId && stored.principalId === scope.principalId &&
            stored.workspaceId === scope.workspaceId && stored.registeredClientId === scope.registeredClientId &&
            await authorizeOwned(owner);
        }, Date.now, documents => request.operation === "plan.submit"
          ? validateHeadlessPlanSavedSources(documents, scope.workspaceId, request.proposal.requests, current) : Promise.resolve(false));
        const outcome = request.operation === "plan.submit"
          ? await reviews.propose({ target, isCurrent: current, proposal: {
              ...request.proposal.scope,
              steps: request.proposal.preview.steps.map(({ operation, input }) => ({ operation, ...input })),
            } })
          : await reviews.read({ target, isCurrent: current });
        if (!await access.authorizeCurrent()) return forbidden;
        return projectHeadlessPlanReview(outcome, target.fingerprint);
      } catch { return current() ? unavailable : forbidden; }
    },

    async runStep(request: HeadlessPlanStepRequest, registration: ManagedPlanReviewRegistration, isOpen: () => boolean): Promise<{
      result: HeadlessPlanStepResult;
      publishIfCurrent?: (publish: () => boolean) => Promise<boolean>;
    }> {
      const access = admit(request.input, request.operation, registration, isOpen);
      if (!access || !systems || !platform.publishWithStableReads) return { result: forbidden };
      const { target, scope, current, authorizeOwned } = access;
      const { fingerprint, approvalRevision, step } = request.input;
      try {
        if (!await access.authorizeCurrent()) return { result: forbidden };
        const prepared = await prepareStructuredHeadlessPlanStep(platform, {
          target, approvalRevision, step, isCurrent: current,
        }, authorizeOwned, Date.now, "stable-reads");
        if (!prepared || prepared.kind !== "system" || !prepared.isCurrent()) return { result: forbidden };
        const active = (workspace: WorkspaceId, operation: string) =>
          workspace === scope.workspaceId && operation === prepared.request.operation && prepared.isCurrent();
        const service = systems.composeHeadlessAuthoring({
          digest: value => createHash("sha256").update(value, "utf8").digest("hex"),
          operations: prepared.operations,
          access: { async authorize(workspace, operation, permission) {
            if (permission !== "asset:write" || !active(workspace, operation) ||
                !await access.authorizeCurrent() || !prepared.isCurrent())
              throw new Error("The approved plan step is unavailable.");
          } },
        });
        const outcome = await service.execute(prepared.request, hostIncarnationId, {
          ...scope, isCurrent: active, canUse: async (workspace, operation) => active(workspace, operation),
        });
        if (!prepared.isCurrent()) return { result: forbidden };
        if (!outcome.ok) return { result: readHeadlessPlanStepResult({ ok: false, code: outcome.error.code }, request.input) };
        if (outcome.value.kind !== "committed" && outcome.value.kind !== "replayed") return { result: unconfirmed };
        return {
          result: readHeadlessPlanStepResult({ ok: true, value: { ...outcome.value, fingerprint, approvalRevision,
            step, expiresAt: prepared.expiresAt } }, request.input),
          publishIfCurrent: prepared.publishIfCurrent,
        };
      } catch { return { result: current() ? unconfirmed : forbidden }; }
    },
  };
  return Object.assign(handlers.execute, {
    runStep: systems && platform.publishWithStableReads ? handlers.runStep : undefined,
    previewSelectedFile: options.enableLocalFilePreview && platform.publishWithStableReads ? previewSelectedFile : undefined,
  });
}
