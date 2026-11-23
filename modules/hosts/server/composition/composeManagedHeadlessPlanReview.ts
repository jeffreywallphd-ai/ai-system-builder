import {prepareHeadlessModelTrainingReviews, type GetHeadlessModelTrainingInputs} from "../../shared/composition/headlessModelTrainingReview";
import {captureHeadlessTrainingMethod, copyHeadlessTrainingPlanInput, composeOwnedHeadlessTrainingMetadata,
  verifyHeadlessTrainingReviewInputs, verifyStoredHeadlessTrainingReviewInputs, compileHeadlessTrainingStepMetadata,
  composeOwnedHeadlessTrainingBusinessPolicy, authorizeOwnedHeadlessTrainingWorkspace, HEADLESS_TRAINING_REVIEW_SCOPES} from "../../shared/composition/headlessTrainingPlanInputs";
import {createOriginalHeadlessTrainingTaskOwner, type OriginalTrainingRunOptions, type OriginalTrainingCompletionQueryResult} from "../../shared/composition/headlessModelTrainingTasks";
import {readStructuredHeadlessTrainingPlanPermission, type BindModelTrainingReviews} from "../../../adapters/persistence/system-builder/createStructuredHeadlessPlanReviewRepository";
import {compileHeadlessContextQueryInputs, runPreparedHeadlessContextQuery, composeOwnedHeadlessContextQueryPolicy,
  type HeadlessContextQueryOwner} from "../../shared/composition/headlessContextQueryExecution";
import { createHash } from "node:crypto";

import { createStructuredOrganizationRepositories } from "../../../adapters/persistence/organization";
import type { StructuredDocumentStore } from "../../../adapters/persistence/shared";
import { createStructuredHeadlessPlanReviewRepository, readStructuredHeadlessPlanModelPermission } from "../../../adapters/persistence/system-builder/createStructuredHeadlessPlanReviewRepository";
import {prepareHeadlessModelDownloadReviews, type GetHeadlessModelSourcePreview} from "../../shared/composition/headlessModelDownloadReview";
import {
  readStructuredHeadlessLocalFileSelection, readStructuredHeadlessProviderFileSelection,
} from "../../../adapters/persistence/ingestion/createStructuredHeadlessLocalFileSelectionRepository";
import type { HeadlessFileSelectionResult, HeadlessLocalFileSelection } from "../../../application/ports/ingestion/headless-local-file-selection.port";
import { prepareStructuredHeadlessPlanStep, prepareStructuredHeadlessPlanStepWithModels, prepareStructuredHeadlessPlanStepWithTraining } from "../../../adapters/persistence/system-builder/createStructuredHeadlessPlanStepOperationStore";
import {runPreparedHeadlessModelDownload, composeOwnedHeadlessModelDownloadPolicy, type StartHeadlessModelDownload}
  from "../../shared/composition/headlessModelDownloadExecution";
import {isHeadlessReadCurrent} from "../../shared/composition/headlessReadCurrent";
import {runOwnedHeadlessModelDownloadCancellation, type OwnedHeadlessModelSourceTasks} from "../../shared/composition/headlessModelDownloadTasks";
import {readHeadlessModelTaskCancellationRequest, type HeadlessModelTaskCancellationResult,
  readHeadlessTrainingTaskRequest, type HeadlessTrainingTaskResult} from "../../../contracts/headless";
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
import {compileHeadlessContextResultInputs, runPreparedHeadlessContextResult, type HeadlessContextResultOwner}
  from "../../shared/composition/headlessContextResults";
import {prepareHeadlessModelReferenceSaveReviews, runPreparedHeadlessModelReferenceSave,
  type HeadlessModelReferenceSaveOwner} from "../../shared/composition/headlessModelReferenceSave";

const forbidden = { ok: false, code: "headless.forbidden" } as const;
const unavailable = { ok: false, code: "headless.unavailable" } as const;
const unconfirmed = { ok: false, code: "headless.operation-unconfirmed" } as const;
const planScopes = ["workspace:read", "asset:read", "asset:write"] as const;
const filePlanScopes = [...planScopes, "artifact:read", "artifact:write"] as const;
const ragScopes = [...filePlanScopes, "model:read"] as const;
const queryScopes = [...planScopes, "artifact:read", "model:read"] as const;

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
  readonly getContextQueryOwner?: () => Promise<HeadlessContextQueryOwner>;
  /** Private metadata preparation only. Caller supplies its current read lifetime. */
  readonly getModelSourcePreview?: GetHeadlessModelSourcePreview;
  /** Private saved-input review. Actual Root and transport remain disabled. */
  readonly getModelTrainingInputs?: GetHeadlessModelTrainingInputs;
  readonly getModelTrainingStart?: OriginalTrainingRunOptions["resolveStart"];
  readonly getModelTrainingReaders?: OriginalTrainingRunOptions["getReaders"];
  /** Private opt-in. Both callbacks are required; host lifetime is not an HTTP lifetime. */
  readonly getModelDownloadStart?: () => Promise<StartHeadlessModelDownload | undefined>;
  readonly isModelHostCurrent?: () => boolean;
  readonly peekModelDownloadTasks?: () => OwnedHeadlessModelSourceTasks | undefined;
  readonly peekModelReferenceSave?: () => HeadlessModelReferenceSaveOwner | undefined;
  readonly peekContextResults?: () => HeadlessContextResultOwner | undefined;
}) {
  const { hostIncarnationId, platform, rootDirectory, workspaces, contexts: configuredContexts, authorization, placement: configuredPlacement, systems } = options;
  if (platform.organizationId !== undefined || !platform.runInOwnedTransaction)
    throw new Error("Managed plan review requires the platform transaction owner.");
  const finalize = options.enableFilePreview && platform.publishWithStableReads ? options.finalizeApprovedLocalFile : undefined;
  const finalizeProvider = options.enableFilePreview && platform.publishWithStableReads ? options.finalizeApprovedProviderFile : undefined;
  const getDatasetStart = platform.publishWithStableReads ? options.getDatasetStart : undefined;
  const getDatasetResults = platform.publishWithStableReads ? options.getDatasetResults : undefined;
  const getContextStart = platform.publishWithStableReads ? options.getContextStart : undefined;
  const getContextQueryOwner = platform.publishWithStableReads ? options.getContextQueryOwner : undefined;
  const peekContextResults = platform.publishWithStableReads ? options.peekContextResults : undefined;
  const getModelSourcePreview = platform.publishWithStableReads ? options.getModelSourcePreview : undefined;
  const readTrainingContext = captureHeadlessTrainingMethod<OrganizationRequestContextProviderPort["getCurrentOrganizationContext"]>(configuredContexts, "getCurrentOrganizationContext");
  const getModelTrainingInputs = platform.publishWithStableReads && readTrainingContext
    ? captureHeadlessTrainingMethod<GetHeadlessModelTrainingInputs>(options, "getModelTrainingInputs") : undefined;
  const contexts = getModelTrainingInputs ? Object.freeze({getCurrentOrganizationContext: readTrainingContext!}) : configuredContexts;
  const placement = getModelTrainingInputs ? Object.freeze(copyHeadlessTrainingPlanInput(configuredPlacement)) : configuredPlacement;
  const trainingPlacement = placement;
  const getModelTrainingStart = captureHeadlessTrainingMethod<OriginalTrainingRunOptions["resolveStart"]>(options, "getModelTrainingStart");
  const getModelTrainingReaders = captureHeadlessTrainingMethod<OriginalTrainingRunOptions["getReaders"]>(options, "getModelTrainingReaders");
  const trainingHostCurrent = captureHeadlessTrainingMethod<() => boolean>(options, "isModelHostCurrent");
  const trainingTasks = getModelTrainingInputs && getModelTrainingStart && getModelTrainingReaders && trainingHostCurrent
    ? createOriginalHeadlessTrainingTaskOwner() : undefined;
  const isModelHostCurrent = options.isModelHostCurrent;
  const getModelDownloadStart = platform.publishWithStableReads && typeof isModelHostCurrent === "function" ? options.getModelDownloadStart : undefined;
  const peekModelDownloadTasks = platform.publishWithStableReads && typeof isModelHostCurrent === "function" ? options.peekModelDownloadTasks : undefined;
  const peekModelReferenceSave = platform.publishWithStableReads && typeof isModelHostCurrent === "function" ? options.peekModelReferenceSave : undefined;

  function captureTrainingRegistration(registration: ManagedPlanReviewRegistration): ManagedPlanReviewRegistration {
    const originalCurrent = captureHeadlessTrainingMethod<() => boolean>(registration, "isCurrent");
    const isCurrent = () => isHeadlessReadCurrent(originalCurrent);
    return Object.freeze({...copyHeadlessTrainingPlanInput({organizationId: registration.organizationId, principalId: registration.principalId,
      registeredClientId: registration.registeredClientId, purpose: registration.purpose, modelSourceRead: registration.modelSourceRead}), isCurrent});
  }

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

  const cancelModelDownload = peekModelDownloadTasks ? async (incoming: unknown, registration: ManagedPlanReviewRegistration,
    isOpen: () => boolean): Promise<HeadlessModelTaskCancellationResult> => {
    const parsed = readHeadlessModelTaskCancellationRequest(incoming, hostIncarnationId);
    if (!parsed.ok) return parsed;
    const {organizationId, principalId, registeredClientId, purpose} = registration;
    const registrationCurrent = registration.isCurrent;
    const current = () => isHeadlessReadCurrent(isOpen) && isHeadlessReadCurrent(isModelHostCurrent) &&
      isHeadlessReadCurrent(registrationCurrent) && registration.organizationId === organizationId &&
      registration.principalId === principalId && registration.registeredClientId === registeredClientId && registration.purpose === purpose;
    const captured = Object.freeze({organizationId, principalId, registeredClientId, purpose, isCurrent: current});
    const access = admitWorkspace(parsed.request.input, "models.cancel-download", captured, current,
      ["workspace:read", "model:read", "model:write"]);
    if (!access || !current()) return forbidden;
    const canUse = async () => current() && access.current() && await access.authorizeCurrent() && access.current() && current();
    try {
      if (!await canUse()) return forbidden;
      return await runOwnedHeadlessModelDownloadCancellation({documents: platform, hostIncarnationId, scope: Object.freeze(access.scope),
        request: parsed.request, isCurrent: () => current() && access.current(), canUse, peekOwner: peekModelDownloadTasks,
        authorize: async (owner, selected, action) => action === "cancel" && selected.organizationId === organizationId &&
          selected.principalId === principalId && selected.registeredClientId === registeredClientId &&
          selected.workspaceId === parsed.request.input.workspaceId && current() && await access.authorizeOwned(owner) && current()});
    } catch {return current() ? unavailable : forbidden;}
  } : undefined;

  const handlers = {
    async execute(incoming: HeadlessPlanReviewAgentRequest, registration: ManagedPlanReviewRegistration,
      isOpen: () => boolean): Promise<HeadlessPlanReviewAgentResult> {
      let request = incoming;
      if (getModelTrainingInputs) {try {request = copyHeadlessTrainingPlanInput(incoming);} catch {return forbidden;}}
      const registrationCurrent = getModelTrainingInputs ? captureHeadlessTrainingMethod<() => boolean>(registration, "isCurrent") : undefined;
      const preparesModel = request.operation === "plan.submit" && request.proposal.requests.some(step => step.operation === "models.download");
      const preparesModelSave = request.operation === "plan.submit" && request.proposal.requests.some(step => step.operation === "models.save-download");
      const preparesTraining = request.operation === "plan.submit" && request.proposal.requests.some(step => step.operation === "models.train");
      let readsModel = false, readsTraining = false;
      const savesFile = request.operation === "plan.submit" &&
        request.proposal.requests.some(step => step.operation === "data.save-local-source" || step.operation === "data.save-provider-source" ||
          step.operation === "data.prepare-local-dataset" || step.operation === "data.save-prepared-dataset" ||
          step.operation === "context.generate-pack" || step.operation === "context.generate-rag" || step.operation === "context.save-result");
      const usesModel = request.operation === "plan.submit" && request.proposal.requests.some(step => step.operation === "context.generate-rag" || step.operation === "context.query");
      if (request.operation === "plan.submit" && request.proposal.requests.some(step =>
        step.operation === "models.train" ? !getModelTrainingInputs :
        step.operation === "models.save-download" ? !peekModelReferenceSave || registration.modelSourceRead !== true :
        step.operation === "models.download" ? !getModelSourcePreview || registration.modelSourceRead !== true :
        step.operation === "context.query" ? !getContextQueryOwner :
        step.operation === "context.save-result" ? !peekContextResults :
        step.operation === "context.generate-pack" || step.operation === "context.generate-rag" ? !getContextStart :
        step.operation === "data.save-prepared-dataset" ? !getDatasetResults :
        step.operation === "data.save-local-source" ? !finalize : step.operation === "data.prepare-local-dataset" ? !getDatasetStart :
          step.operation === "data.save-provider-source" && !finalizeProvider))
        return forbidden;
      const baseScopes = usesModel ? savesFile ? ragScopes : queryScopes : savesFile ? filePlanScopes : planScopes;
      const reviewScopes = [...baseScopes, "model:read", "model:write"] as const;
      const trainingScopes = [...reviewScopes, "artifact:read"] as const;
      const sourceScopes = [...reviewScopes, "provider-credential:use", ...(preparesTraining ? ["artifact:read"] as const : [])] as const;
      const access = admit(request.target, request.operation, registration, isOpen,
        preparesModel ? sourceScopes : preparesTraining ? trainingScopes : preparesModelSave ? reviewScopes : baseScopes);
      if (!access) return forbidden;
      const { target, scope, authorizeOwned } = access;
      const modelReviewAccess = getModelSourcePreview || peekModelReferenceSave ? admit(request.target, request.operation, registration, isOpen, reviewScopes) : undefined;
      const trainingReviewAccess = getModelTrainingInputs ? admit(request.target, request.operation, registration, isOpen, trainingScopes) : undefined;
      const trainingCurrent = () => {
        try {
          const actual = readTrainingContext?.();
          return isHeadlessReadCurrent(registrationCurrent) && isHeadlessReadCurrent(isOpen) &&
            actual?.organizationId === scope.organizationId && actual.principalId === scope.principalId;
        } catch {return false;}
      };
      const current = () => access.current() && (!(preparesModel || preparesModelSave || readsModel) || registration.modelSourceRead === true) &&
        (!preparesModelSave || isHeadlessReadCurrent(isModelHostCurrent)) && (!(preparesTraining || readsTraining) || trainingCurrent());
      const canUse = async () => current() && await access.authorizeCurrent() &&
        (!readsModel || await modelReviewAccess?.authorizeCurrent() === true) &&
        (!readsTraining || await trainingReviewAccess?.authorizeCurrent() === true) && current();
      const { organizationId, principalId, registeredClientId } = scope;
      const action = request.operation === "plan.submit" ? "propose" : "read";
      try {
        if (!await canUse()) return forbidden;
        const trainingPreparation = preparesTraining ? await prepareHeadlessModelTrainingReviews({target,
          requests: request.operation === "plan.submit" ? request.proposal.requests : [], getInputs: getModelTrainingInputs!,
          isCurrent: current, stillAllowed: canUse}) : undefined;
        if (trainingPreparation && !trainingPreparation.ok) return {ok: false,
          code: trainingPreparation.code === "headless.not-found" ? "headless.stale" : trainingPreparation.code} as const;
        const preparedTraining = trainingPreparation?.ok ? trainingPreparation : undefined;
        const originalTrainingBind = preparedTraining?.bind;
        const bindTraining: BindModelTrainingReviews | undefined = originalTrainingBind ? async (partition, actual, requests, owner) => {
          if (!owner || !current()) return;
          const bindings = await originalTrainingBind(partition, actual, requests);
          if (!bindings || !current()) return;
          const metadata = composeOwnedHeadlessTrainingMetadata(owner, rootDirectory, trainingPlacement, actual, current);
          return await verifyHeadlessTrainingReviewInputs({...metadata, requests, bindings}) && current() ? bindings : undefined;
        } : undefined;
        const preparation = preparesModel ? await prepareHeadlessModelDownloadReviews({target,
          requests: request.operation === "plan.submit" ? request.proposal.requests : [], getSource: getModelSourcePreview!,
          isCurrent: current, stillAllowed: canUse}) : undefined;
        if (preparation && !preparation.ok) return preparation;
        const preparedModels = preparation?.ok ? preparation : undefined;
        const savePreparation = preparesModelSave ? await prepareHeadlessModelReferenceSaveReviews({documents: platform, target,
          requests: request.operation === "plan.submit" ? request.proposal.requests : [], isCurrent: current, stillAllowed: canUse,
          peekOwner: peekModelReferenceSave!}) : undefined;
        if (savePreparation && !savePreparation.ok) return savePreparation;
        const preparedSaves = savePreparation?.ok ? savePreparation : undefined;
        const reviews = createStructuredHeadlessPlanReviewRepository(platform, async (owner, actual, requested) => {
          const stored = actual.scope;
          if (!(requested === action && actual.hostIncarnationId === hostIncarnationId && actual.fingerprint === target.fingerprint &&
            stored.organizationId === scope.organizationId && stored.principalId === scope.principalId &&
            stored.workspaceId === scope.workspaceId && stored.registeredClientId === scope.registeredClientId &&
            await authorizeOwned(owner))) return false;
          if (requested === "read") {
            const partition = owner.forOrganization(organizationId);
            const modelPermissions = await readStructuredHeadlessPlanModelPermission(partition, target);
            const trainingPermissions = !modelPermissions && getModelTrainingInputs
              ? await readStructuredHeadlessTrainingPlanPermission(partition, target, async () => current()) : undefined;
            const permissions = modelPermissions ?? trainingPermissions;
            if (!permissions || !current()) return false;
            if (trainingPermissions) {
              readsTraining = true; if (trainingPermissions.requiresModelSourceRead) readsModel = true;
              if (!trainingCurrent() || await trainingReviewAccess?.authorizeOwned(owner) !== true) return false;
              const metadata = composeOwnedHeadlessTrainingMetadata(owner, rootDirectory, trainingPlacement, target, current);
              if (!await verifyStoredHeadlessTrainingReviewInputs(metadata)) return false;
            } else if (permissions.requiresModelWrite) readsModel = true;
          }
          return current() && (!readsModel || await modelReviewAccess?.authorizeOwned(owner) === true) &&
            (!readsTraining || await trainingReviewAccess?.authorizeOwned(owner) === true) && current();
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
          }, async selected => {
            const processor = peekContextResults?.(); if (!processor) return false;
            const compiled = await compileHeadlessContextResultInputs(documents, scope, hostIncarnationId,
              selected.input.taskId, selected.input.reportFingerprint, processor, async () => current());
            return compiled?.prepared.name === selected.input.name;
          }, async selected => Boolean(getContextQueryOwner && await compileHeadlessContextQueryInputs(documents, rootDirectory,
            selected, scope, async () => current())), preparedModels?.validate,
            preparedSaves ? selected => preparedSaves.validate(documents, selected) : undefined, preparedTraining?.validate), Boolean(finalize), Boolean(finalizeProvider), Boolean(getDatasetStart), Boolean(getDatasetResults), Boolean(getContextStart), Boolean(getContextStart),
          getContextStart ? (partition, requests) => compileHeadlessContextModelBindings(rootDirectory, partition, requests, scope, async () => current()) : undefined,
          Boolean(peekContextResults), Boolean(getContextQueryOwner), preparedModels?.bind, Boolean(getModelSourcePreview), Boolean(peekModelReferenceSave),
          {bind: bindTraining, allowStored: Boolean(getModelTrainingInputs)});
        const outcome = request.operation === "plan.submit"
          ? await reviews.propose({ target, isCurrent: () => current() && (preparedSaves?.isCurrent() ?? true), proposal: {
              ...request.proposal.scope,
              steps: request.proposal.preview.steps.map(({ operation, input }) => ({ operation, ...input })),
            } })
          : await reviews.read({ target, isCurrent: current });
        if (!await canUse()) return forbidden;
        return projectHeadlessPlanReview(outcome, target.fingerprint);
      } catch { return current() ? unavailable : forbidden; }
    },

    async runStep(incoming: HeadlessPlanStepRequest, registration: ManagedPlanReviewRegistration, isOpen: () => boolean): Promise<{
      result: HeadlessPlanStepResult;
      publishIfCurrent?: (publish: () => boolean) => Promise<boolean>;
    }> {
      let captured = incoming;
      if (trainingTasks) {try {
        captured = copyHeadlessTrainingPlanInput(incoming); registration = captureTrainingRegistration(registration);
        const originalOpen = isOpen; isOpen = () => isHeadlessReadCurrent(originalOpen);
      } catch {return {result: forbidden};}}
      const question = captured.transient?.contextQuery;
      const request = trainingTasks ? captured : {version: captured.version, operation: captured.operation, input: {...captured.input}};
      const access = admit(request.input, request.operation, registration, isOpen);
      if (!access || !systems || !platform.publishWithStableReads) return { result: forbidden };
      const { target, scope, authorizeOwned } = access;
      let isModelStep = false;
      let isTrainingStep = false;
      const current = () => access.current() && (!isModelStep || isHeadlessReadCurrent(isTrainingStep ? trainingHostCurrent : isModelHostCurrent));
      const { fingerprint, approvalRevision, step } = request.input;
      const fileAccess = finalize || finalizeProvider || getDatasetStart || getDatasetResults || getContextStart || peekContextResults
        ? admitWorkspace(request.input, request.operation, registration, isOpen, filePlanScopes) : undefined;
      const queryAccess = getContextQueryOwner ? admitWorkspace(request.input, request.operation, registration, isOpen, queryScopes) : undefined;
      const modelAccess = getContextStart ? admitWorkspace(request.input, request.operation, registration, isOpen, ragScopes) : undefined;
      const downloadAccess = getModelDownloadStart || peekModelReferenceSave ? admitWorkspace(request.input, request.operation, registration, isOpen,
        [...planScopes, "model:read", "model:write"]) : undefined;
      const trainingAccess = trainingTasks ? admitWorkspace(request.input, request.operation, registration, isOpen, HEADLESS_TRAINING_REVIEW_SCOPES) : undefined;
      try {
        if (!await access.authorizeCurrent()) return { result: forbidden };
        const prepare = trainingTasks ? prepareStructuredHeadlessPlanStepWithTraining
          : getModelDownloadStart || peekModelReferenceSave ? prepareStructuredHeadlessPlanStepWithModels : prepareStructuredHeadlessPlanStep;
        const prepared = await prepare(platform, {
          target, approvalRevision, step, isCurrent: current,
        }, async (owner, _scope, operation) => {
          if (operation?.operation === "models.download" || operation?.operation === "models.save-download") {isModelStep = true; return current() && await downloadAccess?.authorizeOwned(owner) === true && current();}
          if (operation?.operation === "models.train") {isModelStep = true; isTrainingStep = true; return current() && await trainingAccess?.authorizeOwned(owner) === true && current();}
          return operation?.operation === "context.query" ? Boolean(await queryAccess?.authorizeOwned(owner)) : operation?.operation === "context.generate-rag" ? Boolean(await modelAccess?.authorizeOwned(owner)) :
          operation?.operation === "data.save-local-source" || operation?.operation === "data.save-provider-source" ||
          operation?.operation === "data.prepare-local-dataset" || operation?.operation === "data.save-prepared-dataset" || operation?.operation === "context.generate-pack" || operation?.operation === "context.save-result"
          ? Boolean(await fileAccess?.authorizeOwned(owner)) : authorizeOwned(owner);
        },
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
          } : undefined, peekContextResults || peekModelReferenceSave ? rootDirectory : undefined, getContextQueryOwner && queryAccess ? async (owner, selected) =>
            compileHeadlessContextQueryInputs(owner.forOrganization(scope.organizationId), rootDirectory, selected, scope,
              async () => current() && await queryAccess.authorizeOwned(owner)) : undefined, Boolean(getModelDownloadStart), Boolean(peekModelReferenceSave),
          trainingTasks ? (owner, selected, taskScope) => compileHeadlessTrainingStepMetadata({owner, rootDirectory, placement,
            target: {...target, scope: taskScope}, request: selected, isCurrent: current}) : undefined);
        if (!prepared || !prepared.isCurrent() || question !== undefined && prepared.kind !== "context-query") return { result: forbidden };
        if (prepared.kind === "model-training") {
          if (!trainingTasks || !trainingAccess || !getModelTrainingStart || !getModelTrainingReaders || !trainingHostCurrent) return {result: forbidden};
          return trainingTasks.runPrepared({prepared, request, context: scope,
            canUse: async () => current() && await trainingAccess.authorizeCurrent() && current(),
            isHostCurrent: trainingHostCurrent, resolveStart: getModelTrainingStart, getReaders: getModelTrainingReaders,
            stillBusinessAllowed: composeOwnedHeadlessTrainingBusinessPolicy({documents: platform, rootDirectory, placement, target,
              isHostCurrent: trainingHostCurrent})});
        }
        if (prepared.kind === "model-reference") {
          if (!downloadAccess || !peekModelReferenceSave) return {result: forbidden};
          return runPreparedHeadlessModelReferenceSave({documents: platform, rootDirectory, prepared, request,
            canUse: async () => current() && await downloadAccess.authorizeCurrent() && current(), peekOwner: peekModelReferenceSave});
        }
        if (prepared.kind === "model-download") {
          if (!downloadAccess || !getModelDownloadStart || typeof isModelHostCurrent !== "function") return {result: forbidden};
          return runPreparedHeadlessModelDownload({prepared, request, context: scope,
            canUse: async () => current() && await downloadAccess.authorizeCurrent() && current(),
            isHostCurrent: isModelHostCurrent, resolveStart: getModelDownloadStart,
            stillBusinessAllowed: composeOwnedHeadlessModelDownloadPolicy({documents: platform, rootDirectory, placement,
              context: scope, isHostCurrent: isModelHostCurrent})});
        }
        if (prepared.kind === "context-query") {
          if (!queryAccess || !getContextQueryOwner) return {result: forbidden};
          // The retained Browser's existing reconciler fences host shutdown. No old request or token becomes job authority.
          return runPreparedHeadlessContextQuery({prepared, request, question, context: scope,
            canUse: queryAccess.authorizeCurrent, resolveOwner: getContextQueryOwner, isHostCurrent: () => true,
            ownedPolicy: compiled => composeOwnedHeadlessContextQueryPolicy({documents: platform, rootDirectory,
              placement, context: scope, request: prepared.request, compiled, isCurrent: () => true})});
        }
        if (prepared.kind === "context-result") {
          if (!fileAccess || !peekContextResults) return {result: forbidden};
          return runPreparedHeadlessContextResult({documents: platform, rootDirectory, prepared, request, context: scope,
            canUse: fileAccess.authorizeCurrent, peekOwner: peekContextResults});
        }
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
  function controlTraining(incoming: unknown, originalRegistration: ManagedPlanReviewRegistration,
    isOpen: () => boolean, action: "review"): Promise<OriginalTrainingCompletionQueryResult>;
  function controlTraining(incoming: unknown, originalRegistration: ManagedPlanReviewRegistration,
    isOpen: () => boolean, action: "read" | "cancel"): Promise<HeadlessTrainingTaskResult>;
  async function controlTraining(incoming: unknown, originalRegistration: ManagedPlanReviewRegistration,
    isOpen: () => boolean, action: "read" | "cancel" | "review"): Promise<HeadlessTrainingTaskResult | OriginalTrainingCompletionQueryResult> {
    let effectPossible = false;
    try {
      if (!trainingTasks || !trainingHostCurrent) return forbidden;
      const parsed = readHeadlessTrainingTaskRequest(copyHeadlessTrainingPlanInput(incoming), hostIncarnationId);
      if (!parsed.ok) return parsed;
      if (parsed.request.operation !== (action === "cancel" ? "models.cancel-training" : "models.training-task")) return forbidden;
      const registration = captureTrainingRegistration(originalRegistration);
      const current = () => isHeadlessReadCurrent(isOpen) && isHeadlessReadCurrent(trainingHostCurrent);
      const access = admitWorkspace(parsed.request.input, parsed.request.operation, registration, current, HEADLESS_TRAINING_REVIEW_SCOPES);
      if (!access || !await access.authorizeCurrent()) return forbidden;
      const {scope} = access;
      const query = {documents: platform, hostIncarnationId, scope, request: parsed.request, isCurrent: access.current,
        authorize: async (owner: StructuredDocumentStore) => access.current() &&
          await authorizeOwnedHeadlessTrainingWorkspace(owner, rootDirectory, placement, scope, access.current) && access.current()};
      effectPossible = action === "cancel";
      const result = await (action === "review" ? trainingTasks.reviewCompletion(query) : action === "read" ? trainingTasks.read(query) : trainingTasks.cancel(query));
      if (!access.current() || !await access.authorizeCurrent() || !access.current()) return effectPossible ? unconfirmed : forbidden;
      return result;
    } catch {return effectPossible ? unconfirmed : unavailable;}
  }

  return Object.assign(handlers.execute, {
    allowLocalFileSave: Boolean(finalize),
    allowProviderFileSave: Boolean(finalizeProvider),
    allowLocalDatasetPreparation: Boolean(getDatasetStart),
    allowDatasetResultSave: Boolean(getDatasetResults),
    allowContextPackGeneration: Boolean(getContextStart),
    allowContextResultSave: Boolean(peekContextResults),
    allowContextQuery: Boolean(getContextQueryOwner),
    allowContextRagGeneration: Boolean(getContextStart),
    runStep: systems && platform.publishWithStableReads ? handlers.runStep : undefined,
    cancelModelDownload,
    readTrainingTask: trainingTasks ? (request: unknown, registration: ManagedPlanReviewRegistration, current: () => boolean) =>
      controlTraining(request, registration, current, "read") : undefined,
    cancelTrainingTask: trainingTasks ? (request: unknown, registration: ManagedPlanReviewRegistration, current: () => boolean) =>
      controlTraining(request, registration, current, "cancel") : undefined,
    readTrainingCompletion: trainingTasks ? (request: unknown, registration: ManagedPlanReviewRegistration, current: () => boolean) =>
      controlTraining(request, registration, current, "review") : undefined,
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
