import {compileHeadlessContextQueryInputs, runPreparedHeadlessContextQuery, composeOwnedHeadlessContextQueryPolicy,
  type HeadlessContextQueryOwner} from "../../shared/composition/headlessContextQueryExecution";
import { createHash } from "node:crypto";
import { createStructuredHeadlessPlanReviewRepository, readStructuredHeadlessPlanModelPermission } from "../../../adapters/persistence/system-builder/createStructuredHeadlessPlanReviewRepository";
import {prepareHeadlessModelDownloadReviews, type GetHeadlessModelSourcePreview} from "../../shared/composition/headlessModelDownloadReview";
import {isHeadlessReadCurrent} from "../../shared/composition/headlessReadCurrent";
import {prepareHeadlessModelReferenceSaveReviews, runPreparedHeadlessModelReferenceSave,
  type HeadlessModelReferenceSaveOwner} from "../../shared/composition/headlessModelReferenceSave";
import {runOwnedHeadlessModelDownloadCancellation, type OwnedHeadlessModelSourceTasks} from "../../shared/composition/headlessModelDownloadTasks";
import {readHeadlessModelTaskCancellationRequest, type HeadlessModelTaskCancellationResult} from "../../../contracts/headless";
import { prepareStructuredHeadlessPlanStep, prepareStructuredHeadlessPlanStepWithModels } from "../../../adapters/persistence/system-builder/createStructuredHeadlessPlanStepOperationStore";
import {runPreparedHeadlessModelDownload, composeOwnedHeadlessModelDownloadPolicy, type StartHeadlessModelDownload}
  from "../../shared/composition/headlessModelDownloadExecution";
import {createTenantPlacementConfig} from "../../../contracts/config";
import { readStructuredHeadlessLocalFileSelection, readStructuredHeadlessProviderFileSelection } from "../../../adapters/persistence/ingestion/createStructuredHeadlessLocalFileSelectionRepository";
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
import { projectHeadlessPlanReview, runPreparedHeadlessLocalFile, runPreparedHeadlessProviderFile,
  compileHeadlessDatasetPlanInputs, runPreparedHeadlessLocalDataset, type StartHeadlessDataset,
  compileHeadlessDatasetResultInputs, runPreparedHeadlessDatasetResult, type HeadlessDatasetResultOwner,
  validateHeadlessPlanSavedSources } from "../../shared/composition/headlessPlanReview";
import { composeIngestionAcquisitionRepository } from "../../shared/composition/composeIngestionAcquisitionRepository";
import { composeDesktopWorkspaceAuthorization } from "./composeDesktopWorkspaceAuthorization";
import type { DesktopHeadlessAudit } from "./desktopHeadlessAudit";
import type { DesktopIngestionTaskCommands } from "./composeDesktopIngestionFeature";
import {compileHeadlessContextPlanInputs, compileHeadlessContextModelBindings, runPreparedHeadlessContextPack, type StartHeadlessContext}
  from "../../shared/composition/headlessContextExecution";
import {compileHeadlessContextResultInputs, runPreparedHeadlessContextResult, type HeadlessContextResultOwner}
  from "../../shared/composition/headlessContextResults";

type LoopbackPlanReview = NonNullable<Parameters<typeof startDesktopHeadlessLoopback>[0]["planReview"]>;
const forbidden = { ok: false, code: "headless.forbidden" } as const;
const unavailable = { ok: false, code: "headless.unavailable" } as const;
const unconfirmed = { ok: false, code: "headless.operation-unconfirmed" } as const;
const requiredScopes = ["workspace:read", "asset:read", "asset:write"] as const;
const fileSaveScopes = [...requiredScopes, "artifact:read", "artifact:write"] as const;
const ragScopes = [...fileSaveScopes, "model:read"] as const;
const queryScopes = [...requiredScopes, "artifact:read", "model:read"] as const;
type CancelModelDownload = (request: unknown, initial: DesktopHeadlessAuthoringWireGrant,
  currentGrant: () => Promise<DesktopHeadlessAuthoringWireGrant | undefined>) => Promise<HeadlessModelTaskCancellationResult>;

export function composeDesktopHeadlessPlanReview(options: {
  readonly hostIncarnationId: HeadlessHostIncarnationId;
  readonly identity: LocalIdentityProfile;
  readonly platform: StructuredDocumentStore;
  readonly rootDirectory: string;
  readonly workspaces: Pick<WorkspaceRepository, "readWorkspace">;
  readonly authorization: WorkspaceOperationAuthorizationPort;
  readonly isOpen: () => boolean;
  readonly systems?: Pick<SystemBuilderCompositionRoot, "composeHeadlessAuthoring">;
  readonly getIngestionTasks?: () => Promise<DesktopIngestionTaskCommands>;
  readonly getDatasetStart?: () => Promise<StartHeadlessDataset>;
  readonly getDatasetResults?: () => Promise<HeadlessDatasetResultOwner>;
  readonly getContextStart?: () => Promise<StartHeadlessContext>;
  readonly getContextQueryOwner?: () => Promise<HeadlessContextQueryOwner>;
  /** Private metadata preparation only; no public Model download capability. */
  readonly getModelSourcePreview?: GetHeadlessModelSourcePreview;
  /** Private execution opt-in; public roots remain unconfigured until status/save qualify. */
  readonly getModelDownloadStart?: () => Promise<StartHeadlessModelDownload | undefined>;
  readonly peekModelDownloadTasks?: () => OwnedHeadlessModelSourceTasks | undefined;
  /** Private exact-save opt-in; must only peek the original loaded Model owner. */
  readonly peekModelReferenceSave?: () => HeadlessModelReferenceSaveOwner | undefined;
  /** Only an already loaded retained owner; never start dependencies in a proposal transaction. */
  readonly peekContextResults?: () => HeadlessContextResultOwner | undefined;
  readonly audit?: DesktopHeadlessAudit;
}): LoopbackPlanReview & {readonly cancelModelDownload?: CancelModelDownload} {
  const { hostIncarnationId, identity, platform, rootDirectory, workspaces, authorization, isOpen, systems, getIngestionTasks, getModelSourcePreview, getModelDownloadStart, peekModelDownloadTasks } = options;
  const peekModelReferenceSave = options.peekModelReferenceSave;
  if (platform.organizationId !== undefined || !platform.runInOwnedTransaction)
    throw new Error("Desktop plan review requires the platform transaction owner.");

  async function authorize(
    repository: typeof workspaces, policy: WorkspaceOperationAuthorizationPort,
    workspaceId: WorkspaceId, operation: HeadlessPlanReviewAgentRequest["operation"] | "plan.run-step" | "models.cancel-download",
    savesFile = false, usesModel = false, modelPurpose?: "prepare" | "review" | "execute",
  ) {
    try {
      const workspace = await repository.readWorkspace(workspaceId);
      if (workspace?.organizationId !== identity.organizationId || workspace.workspaceId !== workspaceId ||
          workspace.status !== "active") return false;
      await policy.authorizeWorkspaceOperation({ workspace, operation: `headless.${operation}`,
        requiredScopes: operation === "models.cancel-download" ? ["workspace:read", "model:read", "model:write"] : [...(usesModel ? savesFile ? ragScopes : queryScopes : savesFile ? fileSaveScopes : requiredScopes),
          ...(modelPurpose ? ["model:read", "model:write"] as const : []),
          ...(modelPurpose === "prepare" ? ["provider-credential:use"] as const : [])] });
      return isOpen();
    } catch { return false; }
  }

  function admits(grant: DesktopHeadlessAuthoringWireGrant | undefined, clientId: string, workspaceId: WorkspaceId) {
    return Boolean(isOpen() && grant?.planReview === true &&
      !grant.authoring?.length && !grant.conversation && !grant.presentation && isHeadlessReadCurrent(grant.isCurrent) &&
      grant.registeredClientId === clientId && grant.organizationId === identity.organizationId &&
      grant.principalId === identity.principalId && grant.workspaceIds.includes(workspaceId));
  }

  const runStep: NonNullable<LoopbackPlanReview["runStep"]> = async (incoming, initial, currentGrant) => {
    const question = incoming.transient?.contextQuery;
    const request = {version: incoming.version, operation: incoming.operation, input: {...incoming.input}};
    const { workspaceId, fingerprint, approvalRevision, step } = request.input;
    const { registeredClientId } = initial;
    if (!systems || request.input.hostIncarnationId !== hostIncarnationId ||
        !isDesktopHeadlessClientId(registeredClientId)) return { result: forbidden };
    const { organizationId, principalId } = identity;
    const scope = { organizationId, principalId, registeredClientId, workspaceId };
    const operationCurrent = initial.isOperationCurrent;
    let isModelStep = false;
    // Selection is established by the owned stored request. Thereafter every
    // reservation/issue/dispatch fence includes this request's synchronous life.
    const isCurrent = () => admits(initial, registeredClientId, workspaceId) &&
      (!isModelStep || isHeadlessReadCurrent(operationCurrent));
    const canUse = async (savesFile = false, usesModel = false, modelPurpose?: "execute") =>
      isCurrent() && admits(await currentGrant(), registeredClientId, workspaceId) &&
      await authorize(workspaces, authorization, workspaceId, request.operation, savesFile, usesModel, modelPurpose) && isCurrent();
    let savingFile: "local-data-save" | "provider-data-save" | "local-dataset-start" | "local-dataset-save" | "context-pack-start" | "context-rag-start" | "context-result-save" | undefined;
    function localFailure(result: typeof forbidden | typeof unconfirmed | {readonly ok: false; readonly code: "headless.not-started"}) {
      options.audit?.backend(savingFile ?? "local-data-save", workspaceId,
        result.code === "headless.forbidden" || result.code === "headless.not-started" ? "denied" : "unconfirmed");
      return { result };
    }
    try {
      if (!await canUse()) return { result: forbidden };
      const prepare = getModelDownloadStart || peekModelReferenceSave ? prepareStructuredHeadlessPlanStepWithModels : prepareStructuredHeadlessPlanStep;
      const prepared = await prepare(platform, {
        target: { hostIncarnationId, fingerprint, scope }, approvalRevision, step, isCurrent,
      }, async (owner, _scope, approvedRequest) => {
        if (approvedRequest?.operation === "models.download" || approvedRequest?.operation === "models.save-download") isModelStep = true;
        const repository = createLocalWorkspaceRepository({ rootDirectory, documents: owner.forOrganization(organizationId) });
        return await authorize(repository, composeDesktopWorkspaceAuthorization({ documents: owner, localIdentity: identity }),
          workspaceId, request.operation, approvedRequest?.operation === "data.save-local-source" ||
            approvedRequest?.operation === "data.save-provider-source" || approvedRequest?.operation === "data.prepare-local-dataset" ||
            approvedRequest?.operation === "data.save-prepared-dataset" || approvedRequest?.operation === "context.generate-pack" ||
            approvedRequest?.operation === "context.generate-rag" || approvedRequest?.operation === "context.save-result", (approvedRequest?.operation === "context.generate-rag" || approvedRequest?.operation === "context.query"),
          approvedRequest?.operation === "models.download" || approvedRequest?.operation === "models.save-download" ? "execute" : undefined) && isCurrent();
      }, Date.now, "serialized-owner", Boolean(getIngestionTasks), getIngestionTasks
        ? (owner, ...input) => composeIngestionAcquisitionRepository(rootDirectory, owner).saveTaskWithProviderArtifact!(...input)
        : undefined, options.getDatasetStart ? async (owner, selected, taskScope) => {
          const repository = createLocalWorkspaceRepository({rootDirectory, documents: owner.forOrganization(organizationId)});
          const policy = composeDesktopWorkspaceAuthorization({documents: owner, localIdentity: identity});
          const compiled = await compileHeadlessDatasetPlanInputs(rootDirectory, owner.forOrganization(organizationId), selected,
            taskScope, async () => isCurrent() && await authorize(repository, policy, workspaceId, request.operation, true));
          return compiled.ok ? compiled.prepared : undefined;
        } : undefined, options.getDatasetResults ? async (owner, selected, taskScope) =>
          compileHeadlessDatasetResultInputs(owner.forOrganization(organizationId), selected, taskScope,
            options.getDatasetResults!, async () => isCurrent()) : undefined,
        options.getContextStart ? async (owner, selected, taskScope) => {
          const repository = createLocalWorkspaceRepository({rootDirectory, documents: owner.forOrganization(organizationId)});
          const policy = composeDesktopWorkspaceAuthorization({documents: owner, localIdentity: identity});
          const compiled = await compileHeadlessContextPlanInputs(rootDirectory, owner.forOrganization(organizationId), selected,
            taskScope, async () => isCurrent() && await authorize(repository, policy, workspaceId, request.operation, true,
              selected.operation === "context.generate-rag"));
          return compiled.ok && compiled.operation === "context.preview-generation" ? compiled.prepared : undefined;
        } : undefined, options.peekContextResults || peekModelReferenceSave ? rootDirectory : undefined, options.getContextQueryOwner ? async (owner, selected, taskScope) => {
          const repository = createLocalWorkspaceRepository({rootDirectory, documents: owner.forOrganization(organizationId)});
          const policy = composeDesktopWorkspaceAuthorization({documents: owner, localIdentity: identity});
          return compileHeadlessContextQueryInputs(owner.forOrganization(organizationId), rootDirectory, selected, taskScope,
            async () => isCurrent() && await authorize(repository, policy, workspaceId, request.operation, false, true));
        } : undefined, Boolean(getModelDownloadStart), Boolean(peekModelReferenceSave));
      if (!prepared || !await canUse() || !prepared.isCurrent() || question !== undefined && prepared.kind !== "context-query") return { result: forbidden };
      if (prepared.kind === "model-reference") {
        if (!peekModelReferenceSave) return {result: forbidden};
        return runPreparedHeadlessModelReferenceSave({documents: platform, rootDirectory, prepared, request,
          canUse: () => canUse(false, false, "execute"), peekOwner: peekModelReferenceSave});
      }
      if (prepared.kind === "model-download") {
        if (!getModelDownloadStart) return {result: forbidden};
        return runPreparedHeadlessModelDownload({prepared, request, context: scope, canUse: () => canUse(false, false, "execute"),
          isHostCurrent: isOpen, resolveStart: getModelDownloadStart,
          stillBusinessAllowed: composeOwnedHeadlessModelDownloadPolicy({documents: platform, rootDirectory,
            placement: createTenantPlacementConfig({mode: "dedicated", organizationId}), context: scope, isHostCurrent: isOpen})});
      }
      if (prepared.kind === "context-query") {
        return runPreparedHeadlessContextQuery({prepared, request, question, context: scope,
          canUse: () => canUse(false, true), resolveOwner: async () => options.getContextQueryOwner?.(), isHostCurrent: isOpen,
          ownedPolicy: compiled => composeOwnedHeadlessContextQueryPolicy({documents: platform, rootDirectory,
            placement: {mode: "dedicated", organizationId}, context: scope, request: prepared.request, compiled, isCurrent: isOpen})});
      }
      if (prepared.kind === "context-result") {
        savingFile = "context-result-save";
        if (!options.peekContextResults) return localFailure(forbidden);
        const outcome = await runPreparedHeadlessContextResult({documents: platform, rootDirectory, prepared, request,
          context: {organizationId, principalId, workspaceId}, canUse: () => canUse(true), peekOwner: options.peekContextResults});
        if (!outcome.result.ok) return localFailure(outcome.result.code === "headless.forbidden" ? forbidden : unconfirmed);
        options.audit?.backend(savingFile, workspaceId, outcome.result.value.kind);
        return outcome;
      }
      if (prepared.kind === "context-pack") {
        const rag = prepared.request.operation === "context.generate-rag";
        savingFile = rag ? "context-rag-start" : "context-pack-start";
        const outcome = await runPreparedHeadlessContextPack({prepared, request, context: {organizationId, principalId, workspaceId},
          canUse: () => canUse(true, rag), resolveStart: async () => options.getContextStart?.()});
        if (!outcome.result.ok) return localFailure(outcome.result.code === "headless.not-started" ? outcome.result
          : outcome.result.code === "headless.forbidden" ? forbidden : unconfirmed);
        options.audit?.backend(savingFile, workspaceId, outcome.result.value.kind);
        return outcome;
      }
      if (prepared.kind === "local-file") {
        savingFile = "local-data-save";
        if (!getIngestionTasks) return localFailure(forbidden);
        const outcome = await runPreparedHeadlessLocalFile({ prepared, request, context: { organizationId, principalId, workspaceId },
          canUse: () => canUse(true), resolveFinalize: async () => {
            const ingestion = await getIngestionTasks();
            return ingestion.finalizeApprovedLocalFile?.bind(ingestion);
          } });
        if (!outcome.result.ok) return localFailure(outcome.result.code === "headless.forbidden" ? forbidden : unconfirmed);
        options.audit?.backend("local-data-save", workspaceId, outcome.result.value.kind);
        return outcome;
      }
      if (prepared.kind === "provider-file") {
        savingFile = "provider-data-save";
        if (!getIngestionTasks) return localFailure(forbidden);
        const outcome = await runPreparedHeadlessProviderFile({ prepared, request,
          context: { organizationId, principalId, workspaceId }, canUse: () => canUse(true),
          resolveFinalize: async () => {
            const ingestion = await getIngestionTasks();
            return ingestion.finalizeApprovedProviderFile?.bind(ingestion);
          } });
        if (!outcome.result.ok) return localFailure(outcome.result.code === "headless.forbidden" ? forbidden : unconfirmed);
        options.audit?.backend("provider-data-save", workspaceId, outcome.result.value.kind);
        return outcome;
      }
      if (prepared.kind === "local-dataset") {
        savingFile = "local-dataset-start";
        const outcome = await runPreparedHeadlessLocalDataset({prepared, request, context: {organizationId, principalId, workspaceId},
          canUse: () => canUse(true), resolveStart: async () => options.getDatasetStart?.()});
        if (!outcome.result.ok) return localFailure(outcome.result.code === "headless.forbidden" ? forbidden : unconfirmed);
        options.audit?.backend("local-dataset-start", workspaceId, outcome.result.value.kind);
        return outcome;
      }
      if (prepared.kind === "dataset-result") {
        savingFile = "local-dataset-save";
        if (!options.getDatasetResults) return localFailure(forbidden);
        const outcome = await runPreparedHeadlessDatasetResult({prepared, request,
          context: {organizationId, principalId, workspaceId}, canUse: () => canUse(true),
          getProcessor: options.getDatasetResults});
        if (!outcome.result.ok) return localFailure(outcome.result.code === "headless.forbidden" ? forbidden : unconfirmed);
        options.audit?.backend("local-dataset-save", workspaceId, outcome.result.value.kind);
        return outcome;
      }
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
    } catch {
      if (savingFile) return localFailure(isCurrent() ? unconfirmed : forbidden);
      return { result: isCurrent() ? unavailable : forbidden };
    }
  };

  const cancelModelDownload: CancelModelDownload | undefined = peekModelDownloadTasks ? async (incoming, initial, currentGrant) => {
    const parsed = readHeadlessModelTaskCancellationRequest(incoming, hostIncarnationId);
    if (!parsed.ok) return parsed;
    const {workspaceId} = parsed.request.input, {registeredClientId} = initial;
    const {organizationId, principalId} = identity;
    const registrationCurrent = initial.isCurrent, operationCurrent = initial.isOperationCurrent;
    const current = () => isHeadlessReadCurrent(isOpen) && identity.organizationId === organizationId && identity.principalId === principalId &&
      isHeadlessReadCurrent(registrationCurrent) && isHeadlessReadCurrent(operationCurrent) && admits(initial, registeredClientId, workspaceId);
    if (!isDesktopHeadlessClientId(registeredClientId) || !current()) return forbidden;
    const scope = Object.freeze({organizationId, principalId, registeredClientId, workspaceId});
    const canUse = async () => {
      if (!current()) return false;
      const latest = await currentGrant();
      return current() && admits(latest, registeredClientId, workspaceId) && isHeadlessReadCurrent(latest?.isCurrent) &&
        isHeadlessReadCurrent(latest?.isOperationCurrent) && await authorize(workspaces, authorization, workspaceId, "models.cancel-download") && current();
    };
    try {
      if (!await canUse()) return forbidden;
      return await runOwnedHeadlessModelDownloadCancellation({documents: platform, hostIncarnationId, scope, request: parsed.request,
        isCurrent: current, canUse, peekOwner: peekModelDownloadTasks, authorize: async (owner, selected, action) => {
          if (action !== "cancel" || !current() || selected.organizationId !== organizationId || selected.principalId !== principalId ||
              selected.registeredClientId !== registeredClientId || selected.workspaceId !== workspaceId) return false;
          const repository = createLocalWorkspaceRepository({rootDirectory, documents: owner.forOrganization(organizationId)});
          return await authorize(repository, composeDesktopWorkspaceAuthorization({documents: owner, localIdentity: identity}),
            workspaceId, "models.cancel-download") && current();
        }});
    } catch {return current() ? unavailable : forbidden;}
  } : undefined;

  return {
    hostIncarnationId,
    cancelModelDownload,
    ...(getIngestionTasks ? { allowLocalFileSave: true as const } : {}),
    ...(getIngestionTasks ? { allowProviderFileSave: true as const } : {}),
    ...(options.getDatasetStart ? {allowLocalDatasetPreparation: true as const} : {}),
    ...(options.getDatasetResults ? {allowDatasetResultSave: true as const} : {}),
    ...(options.getContextStart ? {allowContextPackGeneration: true as const, allowContextRagGeneration: true as const} : {}),
    ...(options.peekContextResults ? {allowContextResultSave: true as const} : {}),
    ...(options.getContextQueryOwner ? {allowContextQuery: true as const} : {}),
    ...(systems ? { runStep } : {}),
    async execute(request, initialGrant, getCurrentGrant) {
      const { workspaceId, fingerprint } = request.target;
      const { registeredClientId } = initialGrant;
      const readCurrent = initialGrant.isReadCurrent;
      const preparesModel = request.operation === "plan.submit" && request.proposal.requests.some(step => step.operation === "models.download");
      const preparesModelSave = request.operation === "plan.submit" && request.proposal.requests.some(step => step.operation === "models.save-download");
      let readsModel = false;
      const isCurrent = () => admits(initialGrant, registeredClientId, workspaceId) &&
        (!(preparesModel || preparesModelSave || readsModel) || initialGrant.modelSourceRead === true && isHeadlessReadCurrent(readCurrent));
      const savesFile = request.operation === "plan.submit" &&
        request.proposal.requests.some(step => step.operation === "data.save-local-source" || step.operation === "data.save-provider-source" ||
            step.operation === "data.prepare-local-dataset" || step.operation === "data.save-prepared-dataset" ||
            step.operation === "context.generate-pack" || step.operation === "context.generate-rag" || step.operation === "context.save-result");
      const usesModel = request.operation === "plan.submit" && request.proposal.requests.some(step => step.operation === "context.generate-rag" || step.operation === "context.query");
      const canUse = async () => {
        if (!isCurrent()) return false;
        const grant = await getCurrentGrant();
        return admits(grant, registeredClientId, workspaceId) &&
          (!(preparesModel || preparesModelSave || readsModel) || grant?.modelSourceRead === true) &&
          await authorize(workspaces, authorization, workspaceId, request.operation, savesFile, usesModel,
            preparesModel ? "prepare" : preparesModelSave || readsModel ? "review" : undefined) && isCurrent();
      };
      if (request.target.hostIncarnationId !== hostIncarnationId || !isDesktopHeadlessClientId(registeredClientId)) return forbidden;
      try {
        if ((request.operation === "plan.submit" && request.proposal.requests.some(step =>
          step.operation === "models.save-download" ? !peekModelReferenceSave :
          step.operation === "models.download" ? !getModelSourcePreview :
          step.operation === "context.query" ? !options.getContextQueryOwner :
          step.operation === "context.save-result" ? !options.peekContextResults :
          step.operation === "context.generate-pack" || step.operation === "context.generate-rag" ? !options.getContextStart :
          step.operation === "data.save-prepared-dataset" ? !options.getDatasetResults :
          step.operation === "data.prepare-local-dataset" ? !options.getDatasetStart :
            (step.operation === "data.save-local-source" || step.operation === "data.save-provider-source") && !getIngestionTasks)) ||
            !await canUse()) return forbidden;
        const target = { hostIncarnationId, fingerprint, scope: {
          organizationId: identity.organizationId, principalId: identity.principalId, workspaceId, registeredClientId,
        } };
        const preparation = preparesModel ? await prepareHeadlessModelDownloadReviews({target,
          requests: request.operation === "plan.submit" ? request.proposal.requests : [], getSource: getModelSourcePreview!,
          isCurrent, stillAllowed: canUse}) : undefined;
        if (preparation && !preparation.ok) return preparation;
        const preparedModels = preparation?.ok ? preparation : undefined;
        const savePreparation = preparesModelSave ? await prepareHeadlessModelReferenceSaveReviews({documents: platform, target,
          requests: request.operation === "plan.submit" ? request.proposal.requests : [], isCurrent, stillAllowed: canUse,
          peekOwner: peekModelReferenceSave!}) : undefined;
        if (savePreparation && !savePreparation.ok) return savePreparation;
        const preparedSaves = savePreparation?.ok ? savePreparation : undefined;
        const reviews = createStructuredHeadlessPlanReviewRepository(platform, async (owner, actual, action) => {
          if (!isCurrent() || actual.hostIncarnationId !== hostIncarnationId || actual.fingerprint !== fingerprint ||
              actual.scope.organizationId !== identity.organizationId || actual.scope.principalId !== identity.principalId ||
              actual.scope.workspaceId !== workspaceId || actual.scope.registeredClientId !== registeredClientId ||
              action !== (request.operation === "plan.submit" ? "propose" : "read")) return false;
          const documents = owner.forOrganization(identity.organizationId);
          const repository = createLocalWorkspaceRepository({ rootDirectory, documents });
          const policy = composeDesktopWorkspaceAuthorization({ documents: owner, localIdentity: identity });
          if (action === "read") {
            const permissions = await readStructuredHeadlessPlanModelPermission(documents, target);
            if (!permissions || !isCurrent()) return false;
            if (permissions.requiresModelWrite) readsModel = true;
          }
          return await authorize(repository, policy, workspaceId, request.operation, savesFile, usesModel,
            preparesModel ? "prepare" : preparesModelSave || readsModel ? "review" : undefined) && isCurrent();
        }, Date.now, async documents => request.operation === "plan.submit" &&
          validateHeadlessPlanSavedSources(documents, workspaceId, request.proposal.requests, isCurrent, async step => {
            const { idempotencyKey: _key, ...selected } = step.input;
            const observed = await readStructuredHeadlessLocalFileSelection(documents, {
              organizationId: identity.organizationId, principalId: identity.principalId, registeredClientId, target: selected,
            });
            if (!observed || !isCurrent()) return false;
            return observed.ok ? true : observed.code === "headless.stale" ? "stale" : false;
          }, async step => {
            if (!getIngestionTasks) return false;
            const { idempotencyKey: _key, ...selected } = step.input;
            const observed = await readStructuredHeadlessProviderFileSelection(documents, {
              organizationId: identity.organizationId, principalId: identity.principalId, registeredClientId, target: selected,
            });
            if (!observed || !isCurrent()) return false;
            return observed.ok ? true : observed.code === "headless.stale" ? "stale" : false;
          }, async selected => {
            if (!options.getDatasetStart) return false;
            const compiled = await compileHeadlessDatasetPlanInputs(rootDirectory, documents, selected,
              target.scope, async () => isCurrent());
            return compiled.ok ? true : compiled.code === "headless.stale" ? "stale" : false;
          }, async selected => {
            if (!options.getDatasetResults) return false;
            const compiled = await compileHeadlessDatasetResultInputs(documents, selected, target.scope,
              options.getDatasetResults, async () => isCurrent());
            return compiled?.review.saveAvailable === true;
          }, async selected => {
            if (!options.getContextStart) return false;
            const compiled = await compileHeadlessContextPlanInputs(rootDirectory, documents, selected,
              target.scope, async () => isCurrent());
            return compiled.ok && compiled.operation === "context.preview-generation" ? true :
              !compiled.ok && compiled.code === "headless.stale" ? "stale" : false;
          }, async selected => {
            const processor = options.peekContextResults?.(); if (!processor) return false;
            const compiled = await compileHeadlessContextResultInputs(documents, target.scope, hostIncarnationId,
              selected.input.taskId, selected.input.reportFingerprint, processor, async () => isCurrent());
            return compiled?.prepared.name === selected.input.name;
          }, async selected => Boolean(options.getContextQueryOwner && await compileHeadlessContextQueryInputs(documents, rootDirectory,
            selected, target.scope, async () => isCurrent())), preparedModels?.validate,
          preparedSaves ? selected => preparedSaves.validate(documents, selected) : undefined), Boolean(getIngestionTasks), Boolean(getIngestionTasks), Boolean(options.getDatasetStart), Boolean(options.getDatasetResults),
          Boolean(options.getContextStart), Boolean(options.getContextStart), options.getContextStart
            ? (partition, requests) => compileHeadlessContextModelBindings(rootDirectory, partition, requests, target.scope, async () => isCurrent())
            : undefined, Boolean(options.peekContextResults), Boolean(options.getContextQueryOwner), preparedModels?.bind, Boolean(getModelSourcePreview), Boolean(peekModelReferenceSave));
        const result = request.operation === "plan.submit" ?
          await reviews.propose({ target, isCurrent: () => isCurrent() && (preparedSaves?.isCurrent() ?? true), proposal: {
            ...request.proposal.scope,
            steps: request.proposal.preview.steps.map(({ operation, input }) => ({ operation, ...input })),
          } }) : await reviews.read({ target, isCurrent });
        if (!await canUse()) return forbidden;
        return projectHeadlessPlanReview(result, fingerprint);
      } catch { return isCurrent() ? unavailable : forbidden; }
    },
  };
}
