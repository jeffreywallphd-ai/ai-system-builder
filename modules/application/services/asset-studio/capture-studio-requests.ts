import type { AssetReference } from "../../../contracts/asset";
import { normalizeAssetImplementationBackingResourceBundle, type AssetImplementationBackingResourceFile } from "../../../contracts/asset-implementation";
import {
  ASSET_STUDIO_LIMITS,
  normalizeAssetStudioExactDefinitionReference,
  normalizeAssetStudioSemanticDefinitionInput,
  type AssetStudioPatchProposal,
  type StartAssetStudioCommand,
  type ProposeAssetStudioChangeCommand,
  type ReviewAssetStudioProposalCommand,
  type CreateAssetStudioAssetDraftCommand,
  type UpdateAssetStudioAssetDraftCommand,
  type ReadAssetStudioAssetDraftQuery,
  type ListAssetStudioAssetDraftsQuery,
  type TransitionAssetStudioAssetDraftCommand,
} from "../../../contracts/asset-studio";

// Capture only contract fields. Call before the first policy, repository or lazy
// feature await. Canonical validators still own semantic policy and diagnostics.
function text(value: string): string {
  if (typeof value !== "string") throw new Error("Studio request is invalid.");
  return value;
}

function strings(value: readonly string[], maximum?: number): string[] {
  if (!Array.isArray(value) || (maximum !== undefined && value.length > maximum)) throw new Error("Studio collection is invalid.");
  const result: string[] = [];
  for (let index = 0; index < value.length; index++) result.push(text(value[index]));
  return result;
}

function reference(value: AssetReference): AssetReference {
  return {
    kind: text(value.kind) as AssetReference["kind"], id: text(value.id) as AssetReference["id"],
    ...(value.version !== undefined ? { version: text(value.version) } : {}),
    ...(value.label !== undefined ? { label: text(value.label) } : {}),
    ...(value.metadata !== undefined ? { metadata: structuredClone(value.metadata) } : {}),
  };
}

export function captureStudioStart(command: StartAssetStudioCommand): StartAssetStudioCommand {
  return { workspaceId: command.workspaceId, definitionRef: reference(command.definitionRef), displayName: text(command.displayName), actorId: text(command.actorId) };
}

export function captureStudioProposal(proposal: AssetStudioPatchProposal): AssetStudioPatchProposal {
  if (!Array.isArray(proposal.files) || proposal.files.length > ASSET_STUDIO_LIMITS.maxFiles) throw new Error("Studio files are invalid.");
  let total = 0;
  const files = proposal.files.map(file => {
    const content = text(file.content);
    total += content.length;
    if (content.length > ASSET_STUDIO_LIMITS.maxFileCharacters || total > ASSET_STUDIO_LIMITS.maxTotalSourceCharacters) throw new Error("Studio source is too large.");
    return { path: text(file.path), content };
  });
  return {
    summary: text(proposal.summary), plan: strings(proposal.plan, ASSET_STUDIO_LIMITS.maxPlanSteps), files,
    dependencies: strings(proposal.dependencies, ASSET_STUDIO_LIMITS.maxDependencies),
    requestedCapabilities: strings(proposal.requestedCapabilities, ASSET_STUDIO_LIMITS.maxCapabilities),
    ...(proposal.model !== undefined ? { model: { provider: text(proposal.model.provider), modelId: text(proposal.model.modelId) } } : {}),
  };
}

export function captureStudioPropose(command: ProposeAssetStudioChangeCommand): ProposeAssetStudioChangeCommand {
  if (!Array.isArray(command.context) || command.context.length > ASSET_STUDIO_LIMITS.maxContextItems) throw new Error("Studio context is invalid.");
  let total = 0;
  const context = command.context.map(item => {
    const content = text(item.content); total += content.length;
    if (total > ASSET_STUDIO_LIMITS.maxContextCharacters) throw new Error("Studio context is too large.");
    return { id: text(item.id), kind: text(item.kind) as typeof item.kind, content };
  });
  return {
    workspaceId: command.workspaceId, workflowId: text(command.workflowId), implementationDraftId: command.implementationDraftId,
    definitionRef: reference(command.definitionRef), mode: command.mode, intent: text(command.intent), context,
    // These are policy universes, not proposal requests. Do not cap them at the
    // proposal's dependency/capability cardinality.
    allowedDependencies: strings(command.allowedDependencies), allowedCapabilities: strings(command.allowedCapabilities),
    actorId: text(command.actorId),
    ...(command.manualProposal !== undefined ? { manualProposal: captureStudioProposal(command.manualProposal) } : {}),
  };
}

export function captureStudioReview(command: ReviewAssetStudioProposalCommand): ReviewAssetStudioProposalCommand {
  return { workspaceId: command.workspaceId, workflowId: text(command.workflowId), expectedRevision: command.expectedRevision, decision: command.decision,
    approvedDependencies: strings(command.approvedDependencies, ASSET_STUDIO_LIMITS.maxDependencies),
    approvedCapabilities: strings(command.approvedCapabilities, ASSET_STUDIO_LIMITS.maxCapabilities), actorId: text(command.actorId) };
}

function resources(files: readonly AssetImplementationBackingResourceFile[]): readonly AssetImplementationBackingResourceFile[] {
  // The existing normalizer checks cardinality before traversal and owns fixed
  // file records. Keep the generated review definition outside editable input.
  const bundle = normalizeAssetImplementationBackingResourceBundle({ formatVersion: "1.0", files });
  if (bundle.files.some(file => file.path.toLowerCase() === "other/definition.json")) throw new Error("Studio definition resource is protected.");
  return bundle.files;
}

export function captureStudioDraftCreate(command: CreateAssetStudioAssetDraftCommand): CreateAssetStudioAssetDraftCommand {
  return { workspaceId: command.workspaceId, definitionRef: normalizeAssetStudioExactDefinitionReference(command.definitionRef),
    semanticDefinition: normalizeAssetStudioSemanticDefinitionInput(command.semanticDefinition), resources: resources(command.resources),
    ...(command.sourceLegacyDraftId !== undefined ? { sourceLegacyDraftId: command.sourceLegacyDraftId } : {}), actorId: text(command.actorId) };
}

export function captureStudioDraftUpdate(command: UpdateAssetStudioAssetDraftCommand): UpdateAssetStudioAssetDraftCommand {
  return { workspaceId: command.workspaceId, draftId: command.draftId, expectedRevision: command.expectedRevision,
    semanticDefinition: normalizeAssetStudioSemanticDefinitionInput(command.semanticDefinition), resources: resources(command.resources), actorId: text(command.actorId) };
}

export function captureStudioDraftRead(query: ReadAssetStudioAssetDraftQuery): ReadAssetStudioAssetDraftQuery {
  return { workspaceId: query.workspaceId, draftId: query.draftId };
}

export function captureStudioDraftList(query: ListAssetStudioAssetDraftsQuery): ListAssetStudioAssetDraftsQuery {
  return { workspaceId: query.workspaceId, status: query.status, unpublishedOnly: query.unpublishedOnly, text: query.text, limit: query.limit, cursor: query.cursor };
}

export function captureStudioDraftTransition(command: TransitionAssetStudioAssetDraftCommand): TransitionAssetStudioAssetDraftCommand {
  return { workspaceId: command.workspaceId, draftId: command.draftId, expectedRevision: command.expectedRevision, actorId: text(command.actorId) };
}
