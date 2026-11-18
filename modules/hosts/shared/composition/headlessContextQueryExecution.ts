import {createHash} from "node:crypto";
import {isDeepStrictEqual} from "node:util";
import type {StructuredDocumentStore} from "../../../adapters/persistence/shared";
import {createStructuredOrganizationRepositories} from "../../../adapters/persistence/organization";
import {createLocalWorkspaceRepository} from "../../../adapters/persistence/workspace";
import {readStructuredSavedContextOrigin} from "../../../adapters/persistence/system-builder/createStructuredHeadlessContextResultStore";
import type {prepareStructuredHeadlessPlanStep, CompiledApprovedContextQuery} from "../../../adapters/persistence/system-builder/createStructuredHeadlessPlanStepOperationStore";
import type {ApplicationRequestContext} from "../../../application/ports";
import type {ContextBrowserUseCases} from "../../../application/use-cases/context-management";
import {AuthorizeWorkspaceOperationService, createOrganizationAuthorizationPolicy} from "../../../application/services/security";
import type {TenantPlacementConfig} from "../../../contracts/config";
import {isHeadlessContextQuestion, readHeadlessPlanStepResult, type HeadlessContextQueryPlanRequest, type HeadlessPlanStepRequest} from "../../../contracts/headless";
import {compileRecordedHeadlessContextInputs} from "./headlessContextRebuild";

export type HeadlessContextQueryOwner = Pick<ContextBrowserUseCases, "startAdmittedContextQuery" | "readAdmittedContextQueryTask">;
type PreparedQuery = Extract<NonNullable<Awaited<ReturnType<typeof prepareStructuredHeadlessPlanStep>>>, {kind: "context-query"}>;
const sha = (value: string) => `sha256:${createHash("sha256").update(value, "utf8").digest("hex")}`;

/** The caller owns current policy and the transaction. Reads only indexed, original metadata. */
export async function compileHeadlessContextQueryInputs(partition: StructuredDocumentStore, rootDirectory: string,
  request: HeadlessContextQueryPlanRequest, context: ApplicationRequestContext, stillAllowed: () => Promise<boolean>): Promise<CompiledApprovedContextQuery | undefined> {
  const {input} = request;
  const original = await compileRecordedHeadlessContextInputs(partition, rootDirectory, {version: request.version,
    operation: "context.preview-rebuild", input: {hostIncarnationId: input.hostIncarnationId, workspaceId: input.workspaceId,
      reference: input.reference}}, context, stillAllowed);
  if (!original || original.prepared.command.kind !== "rag-database" || !await stillAllowed()) return;
  const model = original.prepared.embeddingModel;
  if (!model || model.modelRecordId !== input.modelRecordId || model.modelUpdatedAt !== input.modelUpdatedAt) return;
  const saved = await readStructuredSavedContextOrigin(partition, rootDirectory, input.workspaceId, input.reference.contextId);
  if (!saved || saved.artifact.digest !== input.reference.artifactDigest || saved.effect.taskId !== input.reference.taskId ||
      saved.artifact.kind !== "rag-database" || !await stillAllowed()) return;
  return {artifactId: saved.artifact.artifactId, artifactDigest: saved.artifact.digest, artifactSizeBytes: saved.artifact.sizeBytes,
    embeddingModel: model, sources: original.prepared.admissionSources.map(({artifactId, digest}) => ({artifactId, digest})),
    publicSources: original.prepared.preview.sources.map(({reference, digest}) => ({reference, digest}))};
}

/** Accepted jobs use the verified actor, not a closed HTTP request, expired token or ambient context.
 * Membership, role, workspace, saved bytes metadata, sources and model witnesses are reread each time. */
export function composeOwnedHeadlessContextQueryPolicy(options: {documents: StructuredDocumentStore; rootDirectory: string;
  placement: TenantPlacementConfig; context: ApplicationRequestContext; request: HeadlessContextQueryPlanRequest;
  compiled: CompiledApprovedContextQuery; isCurrent: () => boolean}) {
  const {documents, rootDirectory, placement, isCurrent} = options;
  const context = Object.freeze({organizationId: options.context.organizationId, principalId: options.context.principalId,
    workspaceId: options.context.workspaceId});
  const request = structuredClone(options.request), expected = structuredClone(options.compiled);
  const transaction = documents.runInOwnedTransaction?.bind(documents);
  return async () => {
    if (!transaction || documents.organizationId !== undefined || !context.organizationId || !context.principalId ||
        !context.workspaceId || !isCurrent()) return false;
    try {
      const allowed = await transaction(async owner => {
        if (!isCurrent()) return false;
        const partition = owner.forOrganization(context.organizationId!);
        const policy = createOrganizationAuthorizationPolicy({...createStructuredOrganizationRepositories(owner), tenantPlacement: placement});
        const authorization = new AuthorizeWorkspaceOperationService({organizationContext: {getCurrentOrganizationContext: () => ({
          organizationId: context.organizationId!, principalId: context.principalId!})}, authorizer: {async execute(input) {
          if (!(await policy.authorize(input)).allowed) throw new Error("The Context query is unavailable.");
        }}});
        const workspace = await createLocalWorkspaceRepository({rootDirectory, documents: partition}).readWorkspace(request.input.workspaceId);
        if (!workspace || workspace.status !== "active" || workspace.organizationId !== context.organizationId || !isCurrent()) return false;
        await authorization.authorizeWorkspaceOperation({workspace, operation: "headless.context.query",
          requiredScopes: ["workspace:read", "artifact:read", "model:read"]});
        if (!isCurrent()) return false;
        const compiled = await compileHeadlessContextQueryInputs(partition, rootDirectory, request, context, async () => isCurrent());
        return isCurrent() && isDeepStrictEqual(compiled, expected);
      }, () => {if (!isCurrent()) throw new Error("The Context query ended.");});
      return allowed && isCurrent();
    } catch {return false;}
  };
}

/** Text is transient. Only an exact question hash may enter one newly reserved runtime attempt. */
export async function runPreparedHeadlessContextQuery(options: {prepared: PreparedQuery; request: HeadlessPlanStepRequest;
  question?: string; context: ApplicationRequestContext; canUse: () => Promise<boolean>;
  resolveOwner: () => Promise<HeadlessContextQueryOwner | undefined>;
  ownedPolicy: (compiled: CompiledApprovedContextQuery) => () => Promise<boolean>; isHostCurrent: () => boolean}) {
  const {prepared, request, canUse, resolveOwner, ownedPolicy, isHostCurrent} = options;
  const context = {organizationId: options.context.organizationId, principalId: options.context.principalId, workspaceId: options.context.workspaceId};
  const forbidden = {result: {ok: false, code: "headless.forbidden"}} as const;
  const unconfirmed = {result: {ok: false, code: "headless.operation-unconfirmed"}} as const;
  let question = options.question;
  if (question !== undefined && (!isHeadlessContextQuestion(question) || sha(question) !== prepared.request.input.queryDigest)) return forbidden;
  if (!prepared.isCurrent() || !await canUse() || !prepared.isCurrent()) return forbidden;
  const observed = await prepared.inspect();
  if (!observed) return unconfirmed;
  let reference = observed.kind === "accepted" ? observed.reference : undefined;
  let kind: "started" | "replayed" = "replayed", notStarted = observed.kind === "not-started";
  if (observed.kind === "absent") {
    if (question === undefined || !await prepared.validateInputs() || !prepared.isCurrent()) return forbidden;
    const owner = await resolveOwner();
    if (!owner || !prepared.isCurrent() || !await canUse() || !await prepared.stillAllowed() || !prepared.isCurrent()) return forbidden;
    const reserved = await prepared.reserve();
    if (!reserved) return unconfirmed;
    if (reserved.kind === "capacity") return {result: {ok: false, code: "headless.operation-capacity"}} as const;
    if (reserved.kind === "not-started") notStarted = true;
    else if (reserved.kind === "accepted") reference = reserved.reference;
    else if (reserved.kind === "new") {
      if (!context.organizationId || !context.principalId || context.workspaceId !== prepared.request.input.workspaceId) return forbidden;
      const {compiled, taskId, sourceDigest} = reserved;
      const afterAcceptance = ownedPolicy(compiled);
      let accepted = false;
      const current = () => isHostCurrent() && (accepted || prepared.isCurrent());
      const result = await owner.startAdmittedContextQuery({artifactId: compiled.artifactId, query: question,
        maximumResults: prepared.request.input.maximumResults, embeddingDevice: prepared.request.input.embeddingDevice}, context,
        {taskId, organizationId: context.organizationId, principalId: context.principalId, workspaceId: context.workspaceId,
          artifactId: compiled.artifactId, artifactDigest: compiled.artifactDigest, artifactSizeBytes: compiled.artifactSizeBytes,
          queryDigest: prepared.request.input.queryDigest, maximumResults: prepared.request.input.maximumResults,
          embeddingDevice: prepared.request.input.embeddingDevice, embeddingModel: compiled.embeddingModel, sources: compiled.sources,
          isCurrent: current, stillAllowed: async () => current() && (accepted ? await afterAcceptance() :
            await canUse() && await prepared.stillAllowed()) && current(),
          issue: () => prepared.issue(taskId, sourceDigest), accept: async selected => {
            if (selected !== taskId || accepted) return false;
            const recorded = await prepared.accept(selected);
            if (recorded) accepted = true;
            return recorded;
          }});
      question = undefined;
      if (result.kind === "not-started") {
        if (!await prepared.recordNotStarted(taskId, sourceDigest)) return unconfirmed;
        notStarted = true;
      } else {
        if (result.kind !== "accepted" || result.taskId !== taskId || !accepted) return unconfirmed;
        kind = "started";
        reference = await prepared.readReceipt();
      }
    }
  }
  if (!prepared.isCurrent() || !await canUse() || !await prepared.stillAllowed() || !prepared.isCurrent()) return forbidden;
  if (notStarted) return {result: {ok: false, code: "headless.not-started"}} as const;
  if (!reference) return unconfirmed;
  const {fingerprint, approvalRevision, step} = request.input;
  return {result: readHeadlessPlanStepResult({ok: true, value: {kind, operation: "context.query", reference,
    fingerprint, approvalRevision, step, expiresAt: prepared.expiresAt}}, request.input, {allowLocalFileSave: false, allowContextQuery: true}),
    publishIfCurrent: prepared.publishIfCurrent};
}
