import {
  normalizeAssetCustomizationSourceChanges,
  normalizeAssetDerivedCustomizationSemanticPatch,
  normalizeExactAssetDefinitionReference,
  type CreateAssetDerivedCustomizationCommand,
  type UpdateAssetDerivedCustomizationCommand,
  type ReviewAssetDerivedCustomizationCommand,
  type ListAssetDerivedCustomizationTargetsQuery,
  type ReadAssetDerivedCustomizationTargetQuery,
  type ListAssetDerivedCustomizationsQuery,
} from "../../../contracts/asset-authoring";

function text(value: string): string {
  if (typeof value !== "string") throw new Error("Derived customization request is invalid.");
  return value;
}
function number(value: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error("Derived customization request is invalid.");
  return value;
}
function optionalText(value: unknown): void {
  if (value !== undefined && typeof value !== "string") throw new Error("Derived customization query is invalid.");
}
function optionalNumber(value: unknown): void {
  if (value !== undefined && (typeof value !== "number" || !Number.isFinite(value))) throw new Error("Derived customization query is invalid.");
}

// Canonical semantic validation retains some nested references. Own its result
// before any async policy, readiness, repository or artifact call. This does not
// add a new preallocation guarantee for arbitrary metadata/JSON input.
export function captureDerivedCreate(command: CreateAssetDerivedCustomizationCommand, actorId: string = command.actorId): CreateAssetDerivedCustomizationCommand {
  return {
    workspaceId: command.workspaceId,
    baseDefinitionRef: normalizeExactAssetDefinitionReference(command.baseDefinitionRef),
    baseImplementationReleaseId: text(command.baseImplementationReleaseId) as typeof command.baseImplementationReleaseId,
    derivedDefinitionRef: normalizeExactAssetDefinitionReference(command.derivedDefinitionRef),
    semanticPatch: structuredClone(normalizeAssetDerivedCustomizationSemanticPatch(command.semanticPatch)),
    ...(command.sourceChanges !== undefined ? {sourceChanges: normalizeAssetCustomizationSourceChanges(command.sourceChanges)} : {}),
    actorId: text(actorId),
  };
}

export function captureDerivedUpdate(command: UpdateAssetDerivedCustomizationCommand, actorId: string = command.actorId): UpdateAssetDerivedCustomizationCommand {
  if (command.clearSourceOverlay !== undefined && typeof command.clearSourceOverlay !== "boolean") throw new Error("Derived customization request is invalid.");
  return {
    workspaceId: command.workspaceId, customizationId: text(command.customizationId) as typeof command.customizationId,
    expectedRevision: number(command.expectedRevision),
    semanticPatch: structuredClone(normalizeAssetDerivedCustomizationSemanticPatch(command.semanticPatch)),
    ...(command.sourceChanges !== undefined ? {sourceChanges: normalizeAssetCustomizationSourceChanges(command.sourceChanges)} : {}),
    clearSourceOverlay: command.clearSourceOverlay, actorId: text(actorId),
  };
}

export function captureDerivedTransition(command: ReviewAssetDerivedCustomizationCommand, actorId: string = command.actorId): ReviewAssetDerivedCustomizationCommand {
  return {workspaceId: command.workspaceId, customizationId: text(command.customizationId) as typeof command.customizationId, expectedRevision: number(command.expectedRevision), actorId: text(actorId)};
}

export function captureDerivedTargetList(query: ListAssetDerivedCustomizationTargetsQuery): ListAssetDerivedCustomizationTargetsQuery {
  optionalText(query.text); optionalText(query.sourceKind); optionalText(query.eligibility); optionalText(query.cursor); optionalNumber(query.limit);
  return {workspaceId: query.workspaceId, text: query.text, sourceKind: query.sourceKind, eligibility: query.eligibility, limit: query.limit, cursor: query.cursor};
}

export function captureDerivedTargetRead(query: ReadAssetDerivedCustomizationTargetQuery): ReadAssetDerivedCustomizationTargetQuery {
  return {workspaceId: query.workspaceId, definitionRef: normalizeExactAssetDefinitionReference(query.definitionRef), implementationReleaseId: text(query.implementationReleaseId) as typeof query.implementationReleaseId};
}

export function captureDerivedList(query: ListAssetDerivedCustomizationsQuery): ListAssetDerivedCustomizationsQuery {
  optionalText(query.status); optionalText(query.text); optionalText(query.cursor); optionalNumber(query.limit);
  return {workspaceId: query.workspaceId, status: query.status, text: query.text, limit: query.limit, cursor: query.cursor};
}
