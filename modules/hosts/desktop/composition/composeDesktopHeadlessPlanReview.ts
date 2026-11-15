import { createHash } from "node:crypto";
import { createStructuredHeadlessPlanReviewRepository } from "../../../adapters/persistence/system-builder/createStructuredHeadlessPlanReviewRepository";
import { prepareStructuredHeadlessPlanStep } from "../../../adapters/persistence/system-builder/createStructuredHeadlessPlanStepOperationStore";
import { createLocalWorkspaceRepository } from "../../../adapters/persistence/workspace";
import type { StructuredDocumentStore } from "../../../adapters/persistence/shared";
import type { DesktopHeadlessAuthoringWireGrant, startDesktopHeadlessLoopback } from "../../../adapters/transport/headless-loopback";
import type { WorkspaceOperationAuthorizationPort } from "../../../application/ports/security";
import type { WorkspaceRepository } from "../../../application/ports/workspace";
import { isDesktopHeadlessClientId, readHeadlessPlanStepResult, type HeadlessHostIncarnationId,
  type HeadlessPlanReviewAgentRequest } from "../../../contracts/headless";
import type { LocalIdentityProfile } from "../../../contracts/organization";
import type { WorkspaceId } from "../../../contracts/workspace";
import type { SystemBuilderCompositionRoot } from "../../shared/composition/composeSystemBuilder";
import { projectHeadlessPlanReview, validateHeadlessPlanSavedSources } from "../../shared/composition/headlessPlanReview";
import { composeDesktopWorkspaceAuthorization } from "./composeDesktopWorkspaceAuthorization";
import type { DesktopHeadlessAudit } from "./desktopHeadlessAudit";

type LoopbackPlanReview = NonNullable<Parameters<typeof startDesktopHeadlessLoopback>[0]["planReview"]>;
const forbidden = { ok: false, code: "headless.forbidden" } as const;
const unavailable = { ok: false, code: "headless.unavailable" } as const;
const requiredScopes = ["workspace:read", "asset:read", "asset:write"] as const;

export function composeDesktopHeadlessPlanReview(options: {
  readonly hostIncarnationId: HeadlessHostIncarnationId;
  readonly identity: LocalIdentityProfile;
  readonly platform: StructuredDocumentStore;
  readonly rootDirectory: string;
  readonly workspaces: Pick<WorkspaceRepository, "readWorkspace">;
  readonly authorization: WorkspaceOperationAuthorizationPort;
  readonly isOpen: () => boolean;
  readonly systems?: Pick<SystemBuilderCompositionRoot, "composeHeadlessAuthoring">;
  readonly audit?: DesktopHeadlessAudit;
}): LoopbackPlanReview {
  const { hostIncarnationId, identity, platform, rootDirectory, workspaces, authorization, isOpen, systems } = options;
  if (platform.organizationId !== undefined || !platform.runInOwnedTransaction)
    throw new Error("Desktop plan review requires the platform transaction owner.");

  async function authorize(
    repository: typeof workspaces, policy: WorkspaceOperationAuthorizationPort,
    workspaceId: WorkspaceId, operation: HeadlessPlanReviewAgentRequest["operation"] | "plan.run-step",
  ) {
    try {
      const workspace = await repository.readWorkspace(workspaceId);
      if (workspace?.organizationId !== identity.organizationId || workspace.workspaceId !== workspaceId ||
          workspace.status !== "active") return false;
      await policy.authorizeWorkspaceOperation({ workspace, operation: `headless.${operation}`, requiredScopes });
      return isOpen();
    } catch { return false; }
  }

  function admits(grant: DesktopHeadlessAuthoringWireGrant | undefined, clientId: string, workspaceId: WorkspaceId) {
    return Boolean(isOpen() && grant?.planReview === true &&
      !grant.authoring?.length && !grant.conversation && !grant.presentation && grant.isCurrent?.() &&
      grant.registeredClientId === clientId && grant.organizationId === identity.organizationId &&
      grant.principalId === identity.principalId && grant.workspaceIds.includes(workspaceId));
  }

  const runStep: NonNullable<LoopbackPlanReview["runStep"]> = async (request, initial, currentGrant) => {
    const { workspaceId, fingerprint, approvalRevision, step } = request.input;
    const { registeredClientId } = initial;
    if (!systems || request.input.hostIncarnationId !== hostIncarnationId ||
        !isDesktopHeadlessClientId(registeredClientId)) return { result: forbidden };
    const { organizationId, principalId } = identity;
    const scope = { organizationId, principalId, registeredClientId, workspaceId };
    const isCurrent = () => admits(initial, registeredClientId, workspaceId);
    const canUse = async () => isCurrent() && admits(await currentGrant(), registeredClientId, workspaceId) &&
      await authorize(workspaces, authorization, workspaceId, request.operation) && isCurrent();
    try {
      if (!await canUse()) return { result: forbidden };
      const prepared = await prepareStructuredHeadlessPlanStep(platform, {
        target: { hostIncarnationId, fingerprint, scope }, approvalRevision, step, isCurrent,
      }, async owner => {
        const repository = createLocalWorkspaceRepository({ rootDirectory, documents: owner.forOrganization(organizationId) });
        return authorize(repository, composeDesktopWorkspaceAuthorization({ documents: owner, localIdentity: identity }),
          workspaceId, request.operation);
      });
      if (!prepared || !await canUse() || !prepared.isCurrent()) return { result: forbidden };
      const { operation } = prepared.request;
      const active = (workspace: WorkspaceId, requested: string) => workspace === workspaceId &&
        requested === operation && prepared.isCurrent();
      const service = systems.composeHeadlessAuthoring({
        digest: value => createHash("sha256").update(value, "utf8").digest("hex"),
        operations: prepared.operations,
        access: { async authorize(workspace, requested, permission) {
          if (!active(workspace, requested) || permission !== "asset:write" || !await canUse() || !prepared.isCurrent())
            throw new Error("The approved plan step is unavailable.");
        } },
      });
      const result = await service.execute(prepared.request, hostIncarnationId, {
        ...scope, isCurrent: active,
        canUse: async (workspace, requested) => active(workspace, requested) && await canUse() && prepared.isCurrent(),
      });
      const auditStatus = result.ok ? (result.value.kind === "preview" ? "refused" : result.value.kind)
        : result.error.code === "headless.forbidden" ? "denied"
          : result.error.code === "headless.operation-unconfirmed" ? "unconfirmed" : "refused";
      options.audit?.backend("system-authoring", workspaceId, auditStatus);
      if (!await canUse() || !prepared.isCurrent()) return { result: forbidden };
      if (!result.ok) return { result: readHeadlessPlanStepResult({ ok: false, code: result.error.code }, request.input) };
      if (result.value.kind !== "committed" && result.value.kind !== "replayed") return { result: unavailable };
      return {
        result: readHeadlessPlanStepResult({ ok: true, value: { ...result.value, fingerprint, approvalRevision,
          step, expiresAt: prepared.expiresAt } }, request.input),
        publishIfCurrent: prepared.publishIfCurrent,
      };
    } catch { return { result: isCurrent() ? unavailable : forbidden }; }
  };

  return {
    hostIncarnationId,
    ...(systems ? { runStep } : {}),
    async execute(request, initialGrant, getCurrentGrant) {
      const { workspaceId, fingerprint } = request.target;
      const { registeredClientId } = initialGrant;
      const isCurrent = () => admits(initialGrant, registeredClientId, workspaceId);
      const canUse = async () => isCurrent() && admits(await getCurrentGrant(), registeredClientId, workspaceId) &&
        await authorize(workspaces, authorization, workspaceId, request.operation) && isCurrent();
      if (request.target.hostIncarnationId !== hostIncarnationId || !isDesktopHeadlessClientId(registeredClientId)) return forbidden;
      try {
        if (!await canUse()) return forbidden;
        const target = { hostIncarnationId, fingerprint, scope: {
          organizationId: identity.organizationId, principalId: identity.principalId, workspaceId, registeredClientId,
        } };
        const reviews = createStructuredHeadlessPlanReviewRepository(platform, async (owner, actual, action) => {
          if (!isCurrent() || actual.hostIncarnationId !== hostIncarnationId || actual.fingerprint !== fingerprint ||
              actual.scope.organizationId !== identity.organizationId || actual.scope.principalId !== identity.principalId ||
              actual.scope.workspaceId !== workspaceId || actual.scope.registeredClientId !== registeredClientId ||
              action !== (request.operation === "plan.submit" ? "propose" : "read")) return false;
          const documents = owner.forOrganization(identity.organizationId);
          const repository = createLocalWorkspaceRepository({ rootDirectory, documents });
          const policy = composeDesktopWorkspaceAuthorization({ documents: owner, localIdentity: identity });
          return await authorize(repository, policy, workspaceId, request.operation) && isCurrent();
        }, Date.now, async documents => request.operation === "plan.submit" &&
          validateHeadlessPlanSavedSources(documents, workspaceId, request.proposal.requests, isCurrent));
        const result = request.operation === "plan.submit" ?
          await reviews.propose({ target, isCurrent, proposal: {
            ...request.proposal.scope,
            steps: request.proposal.preview.steps.map(({ operation, input }) => ({ operation, ...input })),
          } }) : await reviews.read({ target, isCurrent });
        if (!await canUse()) return forbidden;
        return projectHeadlessPlanReview(result, fingerprint);
      } catch { return isCurrent() ? unavailable : forbidden; }
    },
  };
}
