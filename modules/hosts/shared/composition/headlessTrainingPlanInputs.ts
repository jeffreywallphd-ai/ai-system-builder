/** Private recorded-input composition. No provider, file bytes, runtime or task. */
import {isDeepStrictEqual, types} from "node:util";
import {isDesktopHeadlessClientId, isHeadlessHostIncarnationId, readHeadlessPlanReviewDecisionChoice, type HeadlessBuildPlanRequest} from "../../../contracts/headless";
import {readStrictPassiveRecord} from "../../../contracts/shared";
import {isOrganizationId} from "../../../contracts/organization";
import {isWorkspaceId} from "../../../contracts/workspace";
import type {StructuredDocumentStore} from "../../../adapters/persistence/shared";
import {createStructuredDatasetVersionRepository} from "../../../adapters/persistence/dataset-version";
import {createStructuredOrganizationRepositories} from "../../../adapters/persistence/organization";
import {createLocalWorkspaceRepository} from "../../../adapters/persistence/workspace";
import {AuthorizeWorkspaceOperationService, createOrganizationAuthorizationPolicy} from "../../../application/services/security";
import {createTenantPlacementConfig, type TenantPlacementConfig} from "../../../contracts/config";
import {readStructuredHeadlessTrainingPlanReview} from "../../../adapters/persistence/system-builder/createStructuredHeadlessPlanReviewRepository";
import {readModelTrainingReviewBindings, type ModelTrainingReviewBinding} from "../../../adapters/persistence/system-builder/headlessModelTrainingReviewBindings";
import type {WorkspaceRepository} from "../../../application/ports/workspace";
import type {WorkspaceOperationAuthorizationPort} from "../../../application/ports/security";
import type {HeadlessPlanReviewTarget} from "../../../application/ports/system-builder/headless-build-plan-review.port";
import type {CompileApprovedTrainingMetadata} from "../../../adapters/persistence/system-builder/createStructuredHeadlessPlanStepOperationStore";
import {ReadDatasetVersionUseCase, CompareDatasetVersionsUseCase} from "../../../application/use-cases/dataset-version/dataset-version-read.use-cases";
import {ReadHeadlessDatasetMetadataUseCase} from "../../../application/use-cases/dataset-version/headless-dataset-metadata.use-case";
import {PreviewHeadlessModelTrainingInputsUseCase} from "../../../application/use-cases/model/headless-model-training-inputs.use-case";
import {PrepareHeadlessModelTrainingPlanUseCase, canonicalHeadlessModelTrainingInputs} from "../../../application/use-cases/model/headless-model-training-plan.use-case";
import {copyHeadlessModelPlanData} from "./headlessModelDownloadReview";
import {composeHeadlessModelMetadata} from "./headlessModelMetadata";
import {isHeadlessReadCurrent} from "./headlessReadCurrent";

const unavailable = () => new Error("The original saved training metadata is unavailable.");
export const HEADLESS_TRAINING_REVIEW_SCOPES = Object.freeze(["workspace:read", "asset:read", "asset:write", "artifact:read", "model:read", "model:write"] as const);

/** Capture a trusted original method and receiver without invoking accessors. */
export function captureHeadlessTrainingMethod<Fn extends (...args: any[]) => any>(owner: unknown, name: string): Fn | undefined {
  try {
    if (!owner || typeof owner !== "object" || types.isProxy(owner)) return;
    for (let at: object | null = owner, depth = 0; at && at !== Object.prototype && depth < 8; at = Object.getPrototypeOf(at), depth++) {
      if (types.isProxy(at)) return;
      const field = Object.getOwnPropertyDescriptor(at, name);
      if (!field) continue;
      if (!("value" in field) || typeof field.value !== "function" || types.isProxy(field.value)) return;
      const method = field.value;
      return ((...args: unknown[]) => Reflect.apply(method, owner, args)) as Fn;
    }
  } catch {return;}
}

export function copyHeadlessTrainingPlanInput<T>(raw: T): T {return copyHeadlessModelPlanData(raw) as T;}

/** Changed data must not prevent an otherwise authorized denial or revocation.
 * Invalid requests still go through the original decision parser and cannot grant. */
export function trainingReviewNeedsFreshMetadata(raw: unknown): boolean {
  try {
    const request = readStrictPassiveRecord(copyHeadlessTrainingPlanInput(raw), ["fingerprint", "expectedRevision", "decision"]);
    const choice = readHeadlessPlanReviewDecisionChoice(request.decision);
    return !choice || choice.kind === "approve";
  } catch {return true;}
}

/** Pin the same organization/transaction partition. Do not omit documents or
 * activate ordinary Model discovery if metadata is unavailable. */
export function composeHeadlessTrainingPlanInputs(documents: StructuredDocumentStore, rootDirectory: string,
  workspaces: Pick<WorkspaceRepository, "readWorkspace">, authorization: WorkspaceOperationAuthorizationPort) {
  const organizationId = documents.organizationId;
  const readWorkspace = captureHeadlessTrainingMethod<WorkspaceRepository["readWorkspace"]>(workspaces, "readWorkspace");
  const authorizeWorkspaceOperation = captureHeadlessTrainingMethod<WorkspaceOperationAuthorizationPort["authorizeWorkspaceOperation"]>(authorization, "authorizeWorkspaceOperation");
  if (!isOrganizationId(organizationId) || !readWorkspace || !authorizeWorkspaceOperation) throw unavailable();
  const partition = documents.forOrganization(organizationId);
  if (partition.organizationId !== organizationId) throw unavailable();
  const dependencies = {repository: createStructuredDatasetVersionRepository(partition),
    workspaceRepository: Object.freeze({readWorkspace}), workspaceAuthorization: Object.freeze({authorizeWorkspaceOperation})};
  return new PreviewHeadlessModelTrainingInputsUseCase({organizationId,
    models: composeHeadlessModelMetadata(partition, rootDirectory),
    datasets: new ReadHeadlessDatasetMetadataUseCase({versions: new ReadDatasetVersionUseCase(dependencies), comparisons: new CompareDatasetVersionsUseCase(dependencies)})});
}

export interface OwnedHeadlessTrainingMetadata {
  readonly documents: StructuredDocumentStore;
  readonly rootDirectory: string;
  readonly target: HeadlessPlanReviewTarget;
  readonly workspaces: Pick<WorkspaceRepository, "readWorkspace">;
  readonly authorization: WorkspaceOperationAuthorizationPort;
  readonly isCurrent: () => boolean;
  readonly stillAllowed: () => Promise<boolean>;
}

/** Use this exact metadata transaction owner, without starting another
 * transaction or adopting a different request's ambient organization. */
export function composeOwnedHeadlessTrainingMetadata(owner: StructuredDocumentStore, rootDirectory: string,
  placement: TenantPlacementConfig, rawTarget: HeadlessPlanReviewTarget, isCurrent: () => boolean): OwnedHeadlessTrainingMetadata {
  const copied = copyHeadlessTrainingPlanInput(rawTarget);
  const target = Object.freeze({...copied, scope: Object.freeze({...copied.scope})});
  if (!isHeadlessHostIncarnationId(target.hostIncarnationId) || !/^[a-f0-9]{64}$/.test(target.fingerprint)) throw unavailable();
  return Object.freeze({...composeOwnedTrainingWorkspace(owner, rootDirectory, placement, target.scope, isCurrent), target});
}

function composeOwnedTrainingWorkspace(owner: StructuredDocumentStore, rootDirectory: string, placement: TenantPlacementConfig,
  rawScope: HeadlessPlanReviewTarget["scope"], isCurrent: () => boolean): Omit<OwnedHeadlessTrainingMetadata, "target"> {
  const scope = Object.freeze(copyHeadlessTrainingPlanInput(rawScope));
  const fields = readStrictPassiveRecord(scope, ["organizationId", "principalId", "workspaceId", "registeredClientId"]);
  const selectedPlacement = createTenantPlacementConfig(copyHeadlessTrainingPlanInput(placement));
  if (Object.keys(fields).length !== 4 || owner.organizationId !== undefined || !isOrganizationId(scope.organizationId) ||
      !isWorkspaceId(scope.workspaceId) || !isDesktopHeadlessClientId(scope.registeredClientId) ||
      typeof scope.principalId !== "string" || !scope.principalId || scope.principalId.length > 160) throw unavailable();
  const current = () => isHeadlessReadCurrent(isCurrent);
  const documents = owner.forOrganization(scope.organizationId);
  if (documents.organizationId !== scope.organizationId) throw unavailable();
  const workspaces = createLocalWorkspaceRepository({rootDirectory, documents});
  const policy = createOrganizationAuthorizationPolicy({...createStructuredOrganizationRepositories(owner), tenantPlacement: selectedPlacement});
  const authorization = new AuthorizeWorkspaceOperationService({organizationContext: {getCurrentOrganizationContext: () => ({
    organizationId: scope.organizationId, principalId: scope.principalId})}, authorizer: {async execute(input) {
      if (!current() || !(await policy.authorize(input)).allowed || !current()) throw unavailable();
    }}});
  const stillAllowed = async () => {
    try {
      if (!current()) return false;
      const workspace = await workspaces.readWorkspace(scope.workspaceId);
      if (!current() || workspace?.workspaceId !== scope.workspaceId || workspace.organizationId !== scope.organizationId || workspace.status !== "active") return false;
      await authorization.authorizeWorkspaceOperation({workspace, operation: "headless.training-review", requiredScopes: HEADLESS_TRAINING_REVIEW_SCOPES});
      return current();
    } catch {return false;}
  };
  return Object.freeze({documents, rootDirectory, workspaces, authorization, isCurrent: current, stillAllowed});
}

/** Workspace policy only; the task book separately proves exact accepted plan
 * lineage. A task-ID query must not invent a plan fingerprint for this check. */
export async function authorizeOwnedHeadlessTrainingWorkspace(owner: StructuredDocumentStore, rootDirectory: string,
  placement: TenantPlacementConfig, scope: HeadlessPlanReviewTarget["scope"], isCurrent: () => boolean): Promise<boolean> {
  try {return await composeOwnedTrainingWorkspace(owner, rootDirectory, placement, scope, isCurrent).stillAllowed();}
  catch {return false;}
}

function captureOwnedMetadata(options: OwnedHeadlessTrainingMetadata): OwnedHeadlessTrainingMetadata | undefined {
  const documents = options.documents, rootDirectory = options.rootDirectory, target = copyHeadlessTrainingPlanInput(options.target);
  const readWorkspace = captureHeadlessTrainingMethod<WorkspaceRepository["readWorkspace"]>(options.workspaces, "readWorkspace");
  const authorizeWorkspaceOperation = captureHeadlessTrainingMethod<WorkspaceOperationAuthorizationPort["authorizeWorkspaceOperation"]>(options.authorization, "authorizeWorkspaceOperation");
  const current = captureHeadlessTrainingMethod<OwnedHeadlessTrainingMetadata["isCurrent"]>(options, "isCurrent");
  const allowed = captureHeadlessTrainingMethod<OwnedHeadlessTrainingMetadata["stillAllowed"]>(options, "stillAllowed");
  if (!readWorkspace || !authorizeWorkspaceOperation || !current || !allowed || typeof rootDirectory !== "string") return;
  return Object.freeze({documents, rootDirectory, target, workspaces: Object.freeze({readWorkspace}),
    authorization: Object.freeze({authorizeWorkspaceOperation}), isCurrent: current, stillAllowed: allowed});
}

/** The caller supplies only its current owning transaction's metadata readers.
 * Never invoke the outside proposal factory from this retryable callback. */
export async function verifyHeadlessTrainingReviewInputs(options: OwnedHeadlessTrainingMetadata & {
  readonly requests: readonly HeadlessBuildPlanRequest[]; readonly bindings: readonly ModelTrainingReviewBinding[];
}): Promise<boolean> {
  try {
    const captured = captureOwnedMetadata(options); if (!captured) return false;
    const {target, documents, rootDirectory, workspaces, authorization} = captured, requests = copyHeadlessTrainingPlanInput(options.requests);
    const original = readModelTrainingReviewBindings(options.bindings, requests);
    const currentCallback = captured.isCurrent, authorize = captured.stillAllowed;
    if (!original || !currentCallback || !authorize || !isHeadlessHostIncarnationId(target.hostIncarnationId) ||
        !/^[a-f0-9]{64}$/.test(target.fingerprint) || !isOrganizationId(target.scope.organizationId) ||
        !isWorkspaceId(target.scope.workspaceId) || !isDesktopHeadlessClientId(target.scope.registeredClientId) ||
        documents.organizationId !== target.scope.organizationId) return false;
    const current = () => isHeadlessReadCurrent(currentCallback);
    const allowed = async () => current() && await authorize() === true && current();
    if (!await allowed()) return false;
    const inputs = composeHeadlessTrainingPlanInputs(documents, rootDirectory, workspaces, authorization);
    const compiler = new PrepareHeadlessModelTrainingPlanUseCase({organizationId: target.scope.organizationId, inputs});
    const refreshed: ModelTrainingReviewBinding[] = [];
    for (const binding of original) {
      const request = requests[binding.step - 1];
      if (request.operation !== "models.train" || !await allowed()) return false;
      const prepared = await compiler.execute(request, {hostIncarnationId: target.hostIncarnationId,
        context: {organizationId: target.scope.organizationId, principalId: target.scope.principalId, workspaceId: target.scope.workspaceId},
        clientId: target.scope.registeredClientId, isCurrent: current, stillAllowed: allowed});
      if (!prepared.ok || !await allowed() || !isDeepStrictEqual(prepared.prepared.request, request) ||
          !isDeepStrictEqual(canonicalHeadlessModelTrainingInputs(prepared.prepared.inputs), canonicalHeadlessModelTrainingInputs(binding.inputs))) return false;
      // Recognize only the existing complete original encodings. Never replace
      // an original legacy digest with the new compiler's preferred encoding.
      refreshed.push({...binding, inputs: prepared.prepared.inputs});
    }
    return !!readModelTrainingReviewBindings(refreshed, requests) && await allowed();
  } catch {return false;}
}

export async function verifyStoredHeadlessTrainingReviewInputs(options: OwnedHeadlessTrainingMetadata): Promise<boolean> {
  try {
    const captured = captureOwnedMetadata(options); if (!captured) return false;
    const {target, isCurrent: current, stillAllowed: authorize} = captured;
    const allowed = async () => isHeadlessReadCurrent(current) && await authorize() === true && isHeadlessReadCurrent(current);
    const saved = await readStructuredHeadlessTrainingPlanReview(captured.documents, target, allowed);
    return !!saved && await verifyHeadlessTrainingReviewInputs({...captured, target, requests: saved.requests, bindings: saved.bindings,
      isCurrent: current, stillAllowed: allowed});
  } catch {return false;}
}

/** Recompile only recorded inputs in this exact step transaction. Byte readers,
 * the outside preparation factory and runtime initialization stay outside. */
export async function compileHeadlessTrainingStepMetadata(options: {
  readonly owner: StructuredDocumentStore; readonly rootDirectory: string; readonly placement: TenantPlacementConfig;
  readonly target: HeadlessPlanReviewTarget; readonly request: Parameters<CompileApprovedTrainingMetadata>[1];
  readonly isCurrent: () => boolean;
}): ReturnType<CompileApprovedTrainingMetadata> {
  try {
    const originalCurrent = captureHeadlessTrainingMethod<() => boolean>(options, "isCurrent");
    if (!originalCurrent) return;
    const current = () => isHeadlessReadCurrent(originalCurrent);
    const request = copyHeadlessTrainingPlanInput(options.request);
    const metadata = composeOwnedHeadlessTrainingMetadata(options.owner, options.rootDirectory, options.placement, options.target, current);
    if (!current() || !await metadata.stillAllowed() || !current()) return;
    const inputs = composeHeadlessTrainingPlanInputs(metadata.documents, metadata.rootDirectory, metadata.workspaces, metadata.authorization);
    const compiled = await new PrepareHeadlessModelTrainingPlanUseCase({organizationId: metadata.target.scope.organizationId, inputs}).execute(request, {
      hostIncarnationId: metadata.target.hostIncarnationId,
      context: {organizationId: metadata.target.scope.organizationId, principalId: metadata.target.scope.principalId, workspaceId: metadata.target.scope.workspaceId},
      clientId: metadata.target.scope.registeredClientId, isCurrent: current, stillAllowed: metadata.stillAllowed,
    });
    if (compiled.ok && current() && await metadata.stillAllowed() && current()) return compiled.prepared;
  } catch {return;}
}

/** Accepted work keeps fresh original actor/workspace business permission after
 * an outward request ends. This supplies no native or resource permission. */
export function composeOwnedHeadlessTrainingBusinessPolicy(options: {
  readonly documents: StructuredDocumentStore; readonly rootDirectory: string; readonly placement: TenantPlacementConfig;
  readonly target: HeadlessPlanReviewTarget; readonly isHostCurrent: () => boolean;
}): () => Promise<boolean> {
  const originalCurrent = captureHeadlessTrainingMethod<() => boolean>(options, "isHostCurrent");
  const transaction = captureHeadlessTrainingMethod<NonNullable<StructuredDocumentStore["runInOwnedTransaction"]>>(options.documents, "runInOwnedTransaction");
  const target = copyHeadlessTrainingPlanInput(options.target), placement = copyHeadlessTrainingPlanInput(options.placement);
  const rootDirectory = options.rootDirectory;
  if (!originalCurrent || !transaction || options.documents.organizationId !== undefined) throw unavailable();
  const current = () => isHeadlessReadCurrent(originalCurrent);
  return async () => {
    try {
      if (!current()) return false;
      const allowed = await transaction(owner => composeOwnedHeadlessTrainingMetadata(owner, rootDirectory, placement, target, current).stillAllowed(),
        () => {if (!current()) throw unavailable();});
      return allowed === true && current();
    } catch {return false;}
  };
}
