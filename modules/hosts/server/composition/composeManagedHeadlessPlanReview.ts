import { createHash } from "node:crypto";

import { createStructuredOrganizationRepositories } from "../../../adapters/persistence/organization";
import type { StructuredDocumentStore } from "../../../adapters/persistence/shared";
import { createStructuredHeadlessPlanReviewRepository } from "../../../adapters/persistence/system-builder/createStructuredHeadlessPlanReviewRepository";
import {
  readStructuredHeadlessLocalFileSelection, readStructuredHeadlessProviderFileSelection,
} from "../../../adapters/persistence/ingestion/createStructuredHeadlessLocalFileSelectionRepository";
import type { HeadlessFileSelectionResult, HeadlessLocalFileSelection } from "../../../application/ports/ingestion/headless-local-file-selection.port";
import { prepareStructuredHeadlessPlanStep } from "../../../adapters/persistence/system-builder/createStructuredHeadlessPlanStepOperationStore";
import { createLocalWorkspaceRepository } from "../../../adapters/persistence/workspace";
import type { OrganizationRequestContextProviderPort } from "../../../application/ports/organization";
import type { WorkspaceOperationAuthorizationPort } from "../../../application/ports/security";
import type { WorkspaceRepository } from "../../../application/ports/workspace";
import { AuthorizeWorkspaceOperationService, createOrganizationAuthorizationPolicy } from "../../../application/services/security";
import type { TenantPlacementConfig } from "../../../contracts/config";
import { isDesktopHeadlessClientId, readHeadlessPlanStepResult, type HeadlessHostIncarnationId,
  type HeadlessLocalFileImportRequest, type HeadlessProviderFileImportRequest,
  type HeadlessPlanReviewAgentRequest, type HeadlessPlanReviewAgentResult, type HeadlessPlanStepRequest,
  type HeadlessPlanStepResult } from "../../../contracts/headless";
import type { WorkspaceId } from "../../../contracts/workspace";
import type { SecurityScope } from "../../../contracts/security";
import type { SystemBuilderCompositionRoot } from "../../shared/composition/composeSystemBuilder";
import type { GovernedIngestionTaskUseCases } from "../../../application/use-cases/ingestion-acquisition/governed-ingestion-tasks.use-case";
import { projectHeadlessPlanReview, runPreparedHeadlessLocalFile, runPreparedHeadlessProviderFile,
  compileHeadlessDatasetPlanInputs, runPreparedHeadlessLocalDataset, type StartHeadlessDataset,
  compileHeadlessDatasetResultInputs, runPreparedHeadlessDatasetResult, type HeadlessDatasetResultOwner,
  validateHeadlessPlanSavedSources } from "../../shared/composition/headlessPlanReview";
import { composeIngestionAcquisitionRepository } from "../../shared/composition/composeIngestionAcquisitionRepository";
import type { ManagedPlanReviewRegistration } from "../security/resolveManagedHeadlessClientPolicy";
import {compileHeadlessContextPlanInputs, compileHeadlessContextModelBindings, runPreparedHeadlessContextPack, type StartHeadlessContext}
  from "../../shared/composition/headlessContextExecution";

const forbidden = { ok: false, code: "headless.forbidden" } as const;
const unavailable = { ok: false, code: "headless.unavailable" } as const;
const unconfirmed = { ok: false, code: "headless.operation-unconfirmed" } as const;
const planScopes = ["workspace:read", "asset:read", "asset:write"] as const;
const filePlanScopes = [...planScopes, "artifact:read", "artifact:write"] as const;
const ragScopes = [...filePlanScopes, "model:read"] as const;

export function composeManagedHeadlessPlanReview(options: {
  readonly hostIncarnationId: HeadlessHostIncarnationId;
  readonly platform: StructuredDocumentStore;
  readonly rootDirectory: string;
  readonly workspaces: Pick<WorkspaceRepository, "readWorkspace">;
  readonly contexts: OrganizationRequestContextProviderPort;
  readonly authorization: WorkspaceOperationAuthorizationPort;
  readonly placement: TenantPlacementConfig;
  readonly systems?: Pick<SystemBuilderCompositionRoot, "composeHeadlessAuthoring">;
  readonly enableFilePreview?: boolean;
  readonly finalizeApprovedLocalFile?: GovernedIngestionTaskUseCases["finalizeApprovedLocalFile"];
  readonly finalizeApprovedProviderFile?: GovernedIngestionTaskUseCases["finalizeApprovedProviderFile"];
  readonly getDatasetStart?: () => Promise<StartHeadlessDataset>;
  readonly getDatasetResults?: () => Promise<HeadlessDatasetResultOwner>;
  readonly getContextStart?: () => Promise<StartHeadlessContext>;
}) {
  const { hostIncarnationId, platform, rootDirectory, workspaces, contexts, authorization, placement, systems } = options;
  if (platform.organizationId !== undefined || !platform.runInOwnedTransaction)
    throw new Error("Managed plan review requires the platform transaction owner.");
  const finalize = options.enableFilePreview && platform.publishWithStableReads ? options.finalizeApprovedLocalFile : undefined;
  const finalizeProvider = options.enableFilePreview && platform.publishWithStableReads ? options.finalizeApprovedProviderFile : undefined;
  const getDatasetStart = platform.publishWithStableReads ? options.getDatasetStart : undefined;
  const getDatasetResults = platform.publishWithStableReads ? options.getDatasetResults : undefined;
  const getContextStart = platform.publishWithStableReads ? options.getContextStart : undefined;

  function admitWorkspace(requested: Pick<HeadlessPlanReviewAgentRequest["target"], "workspaceId" | "hostIncarnationId">,
    operation: string, registration: ManagedPlanReviewRegistration, isOpen: () => boolean,
    requiredScopes: readonly SecurityScope[] = planScopes) {
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
    registration: ManagedPlanReviewRegistration, isOpen: () => boolean, requiredScopes?: readonly SecurityScope[]) {
    const access = admitWorkspace(requested, operation, registration, isOpen, requiredScopes);
    if (access) return { ...access, target: { hostIncarnationId, fingerprint: requested.fingerprint, scope: access.scope } };
  }

  async function previewSelectedFile<Preview>(target: HeadlessLocalFileSelection["target"],
    registration: ManagedPlanReviewRegistration, isOpen: () => boolean, profile: {
      readonly operation: "data.local-file-preview" | "data.provider-file-preview";
      readonly read: (owner: StructuredDocumentStore, selection: HeadlessLocalFileSelection) =>
        Promise<HeadlessFileSelectionResult<Preview> | undefined>;
      readonly deadline: (preview: Preview) => number;
    }): Promise<{ readonly result: HeadlessFileSelectionResult<Preview>;
      readonly publishIfCurrent?: (publish: () => boolean) => Promise<boolean> }> {
    const stableReads = platform.publishWithStableReads?.bind(platform);
    const access = admitWorkspace(target, profile.operation, registration, isOpen, ["workspace:read", "artifact:read"]);
    if (!options.enableFilePreview || !stableReads || !access) return { result: forbidden };
    const { organizationId, principalId, registeredClientId } = access.scope;
    const selection = { organizationId, principalId, registeredClientId, target };
    async function observe(owner: StructuredDocumentStore) {
      if (!await access!.authorizeOwned(owner) || !access!.current()) return forbidden;
      const value = await profile.read(owner.forOrganization(organizationId), selection);
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
              () => access.current() && (!result.ok || Date.now() < profile.deadline(result.value)) && publish());
          } catch { return false; }
        },
      };
    } catch { return { result: access.current() ? unavailable : forbidden }; }
  }

  const handlers = {
    async execute(request: HeadlessPlanReviewAgentRequest, registration: ManagedPlanReviewRegistration,
      isOpen: () => boolean): Promise<HeadlessPlanReviewAgentResult> {
      const savesFile = request.operation === "plan.submit" &&
        request.proposal.requests.some(step => step.operation === "data.save-local-source" || step.operation === "data.save-provider-source" ||
          step.operation === "data.prepare-local-dataset" || step.operation === "data.save-prepared-dataset" ||
          step.operation === "context.generate-pack" || step.operation === "context.generate-rag");
      const usesModel = request.operation === "plan.submit" && request.proposal.requests.some(step => step.operation === "context.generate-rag");
      if (request.operation === "plan.submit" && request.proposal.requests.some(step =>
        step.operation === "context.generate-pack" || step.operation === "context.generate-rag" ? !getContextStart :
        step.operation === "data.save-prepared-dataset" ? !getDatasetResults :
        step.operation === "data.save-local-source" ? !finalize : step.operation === "data.prepare-local-dataset" ? !getDatasetStart :
          step.operation === "data.save-provider-source" && !finalizeProvider))
        return forbidden;
      const access = admit(request.target, request.operation, registration, isOpen, usesModel ? ragScopes : savesFile ? filePlanScopes : planScopes);
      if (!access) return forbidden;
      const { target, scope, current, authorizeOwned } = access;
      const { organizationId, principalId, registeredClientId } = scope;
      const action = request.operation === "plan.submit" ? "propose" : "read";
      try {
        if (!await access.authorizeCurrent()) return forbidden;
        const reviews = createStructuredHeadlessPlanReviewRepository(platform, async (owner, actual, requested) => {
          const stored = actual.scope;
          return requested === action && actual.hostIncarnationId === hostIncarnationId && actual.fingerprint === target.fingerprint &&
            stored.organizationId === scope.organizationId && stored.principalId === scope.principalId &&
            stored.workspaceId === scope.workspaceId && stored.registeredClientId === scope.registeredClientId &&
            await authorizeOwned(owner);
        }, Date.now, async documents => request.operation === "plan.submit" &&
          validateHeadlessPlanSavedSources(documents, scope.workspaceId, request.proposal.requests, current, async step => {
            if (!finalize || !current()) return false;
            const { idempotencyKey: _key, ...selected } = step.input;
            const observed = await readStructuredHeadlessLocalFileSelection(documents, {
              organizationId, principalId, registeredClientId, target:selected,
            });
            if (!observed || !current()) return false;
            return observed.ok ? true : observed.code === "headless.stale" ? "stale" : false;
          }, async step => {
            if (!finalizeProvider || !current()) return false;
            const { idempotencyKey: _key, ...selected } = step.input;
            const observed = await readStructuredHeadlessProviderFileSelection(documents, {
              organizationId, principalId, registeredClientId, target: selected,
            });
            if (!observed || !current()) return false;
            return observed.ok ? true : observed.code === "headless.stale" ? "stale" : false;
          }, async selected => {
            if (!getDatasetStart) return false;
            const compiled = await compileHeadlessDatasetPlanInputs(rootDirectory, documents, selected, scope, async () => current());
            return compiled.ok ? true : compiled.code === "headless.stale" ? "stale" : false;
          }, async selected => {
            if (!getDatasetResults) return false;
            const compiled = await compileHeadlessDatasetResultInputs(documents, selected, scope, getDatasetResults, async () => current());
            return compiled?.review.saveAvailable === true;
          }, async selected => {
            if (!getContextStart) return false;
            const compiled = await compileHeadlessContextPlanInputs(rootDirectory, documents, selected, scope, async () => current());
            return compiled.ok && compiled.operation === "context.preview-generation" ? true :
              !compiled.ok && compiled.code === "headless.stale" ? "stale" : false;
          }), Boolean(finalize), Boolean(finalizeProvider), Boolean(getDatasetStart), Boolean(getDatasetResults), Boolean(getContextStart), Boolean(getContextStart),
          getContextStart ? (partition, requests) => compileHeadlessContextModelBindings(rootDirectory, partition, requests, scope, async () => current()) : undefined);
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
      const fileAccess = finalize || finalizeProvider || getDatasetStart || getDatasetResults || getContextStart
        ? admitWorkspace(request.input, request.operation, registration, isOpen, filePlanScopes) : undefined;
      const modelAccess = getContextStart ? admitWorkspace(request.input, request.operation, registration, isOpen, ragScopes) : undefined;
      try {
        if (!await access.authorizeCurrent()) return { result: forbidden };
        const prepared = await prepareStructuredHeadlessPlanStep(platform, {
          target, approvalRevision, step, isCurrent: current,
        }, async (owner, _scope, operation) => operation?.operation === "context.generate-rag" ? Boolean(await modelAccess?.authorizeOwned(owner)) :
          operation?.operation === "data.save-local-source" || operation?.operation === "data.save-provider-source" ||
          operation?.operation === "data.prepare-local-dataset" || operation?.operation === "data.save-prepared-dataset" || operation?.operation === "context.generate-pack"
          ? Boolean(await fileAccess?.authorizeOwned(owner)) : authorizeOwned(owner),
        Date.now, "stable-reads", Boolean(finalize && fileAccess), finalizeProvider && fileAccess
          ? (owner, ...input) => composeIngestionAcquisitionRepository(rootDirectory, owner).saveTaskWithProviderArtifact!(...input)
          : undefined, getDatasetStart && fileAccess ? async (owner, selected) => {
            const compiled = await compileHeadlessDatasetPlanInputs(rootDirectory, owner.forOrganization(scope.organizationId), selected,
              scope, async () => current() && await fileAccess.authorizeOwned(owner));
            return compiled.ok ? compiled.prepared : undefined;
          } : undefined, getDatasetResults && fileAccess ? async (owner, selected) =>
            compileHeadlessDatasetResultInputs(owner.forOrganization(scope.organizationId), selected, scope,
              getDatasetResults, async () => current()) : undefined,
          getContextStart && fileAccess ? async (owner, selected) => {
            const contextAccess = selected.operation === "context.generate-rag" ? modelAccess : fileAccess;
            if (!contextAccess) return;
            const compiled = await compileHeadlessContextPlanInputs(rootDirectory, owner.forOrganization(scope.organizationId), selected,
              scope, async () => current() && await contextAccess.authorizeOwned(owner));
            return compiled.ok && compiled.operation === "context.preview-generation" ? compiled.prepared : undefined;
          } : undefined);
        if (!prepared || !prepared.isCurrent()) return { result: forbidden };
        if (prepared.kind === "context-pack") {
          const contextAccess = prepared.request.operation === "context.generate-rag" ? modelAccess : fileAccess;
          if (!contextAccess || !getContextStart) return {result: forbidden};
          return await runPreparedHeadlessContextPack({prepared, request, context: scope,
            canUse: contextAccess.authorizeCurrent, resolveStart: getContextStart});
        }
        if (prepared.kind === "local-file") {
          if (!fileAccess || !finalize) return { result: forbidden };
          const { organizationId, principalId, workspaceId } = scope;
          return await runPreparedHeadlessLocalFile({ prepared, request, context:{ organizationId, principalId, workspaceId },
            canUse: fileAccess.authorizeCurrent, resolveFinalize: async () => finalize });
        }
        if (prepared.kind === "provider-file") {
          if (!fileAccess || !finalizeProvider) return { result: forbidden };
          const { organizationId, principalId, workspaceId } = scope;
          return await runPreparedHeadlessProviderFile({ prepared, request, context: { organizationId, principalId, workspaceId },
            canUse: fileAccess.authorizeCurrent, resolveFinalize: async () => finalizeProvider });
        }
        if (prepared.kind === "local-dataset") {
          if (!fileAccess || !getDatasetStart) return {result: forbidden};
          return await runPreparedHeadlessLocalDataset({prepared, request, context: scope,
            canUse: fileAccess.authorizeCurrent, resolveStart: getDatasetStart});
        }
        if (prepared.kind === "dataset-result") {
          if (!fileAccess || !getDatasetResults) return {result: forbidden};
          return await runPreparedHeadlessDatasetResult({prepared, request, context: scope,
            canUse: fileAccess.authorizeCurrent, getProcessor: getDatasetResults});
        }
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
    allowLocalFileSave: Boolean(finalize),
    allowProviderFileSave: Boolean(finalizeProvider),
    allowLocalDatasetPreparation: Boolean(getDatasetStart),
    allowDatasetResultSave: Boolean(getDatasetResults),
    allowContextPackGeneration: Boolean(getContextStart),
    allowContextRagGeneration: Boolean(getContextStart),
    runStep: systems && platform.publishWithStableReads ? handlers.runStep : undefined,
    previewSelectedFile: options.enableFilePreview && platform.publishWithStableReads
      ? (request: HeadlessLocalFileImportRequest, registration: ManagedPlanReviewRegistration, isOpen: () => boolean) =>
        previewSelectedFile(request.input, registration, isOpen, {
          operation: "data.local-file-preview", read: readStructuredHeadlessLocalFileSelection,
          deadline: result => result.checkpointExpiresAt,
        })
      : undefined,
    previewSelectedProviderFile: options.enableFilePreview && platform.publishWithStableReads
      ? (request: HeadlessProviderFileImportRequest, registration: ManagedPlanReviewRegistration, isOpen: () => boolean) =>
        previewSelectedFile(request.input, registration, isOpen, {
          operation: "data.provider-file-preview", read: readStructuredHeadlessProviderFileSelection,
          deadline: result => result.selectionExpiresAt,
        })
      : undefined,
  });
}
