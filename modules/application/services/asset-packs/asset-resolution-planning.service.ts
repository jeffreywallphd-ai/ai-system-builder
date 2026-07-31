import type {
  AssetReference,
  AssetResolutionConflict,
  AssetResolutionRequest,
  AssetResolutionResult,
  AssetResolutionTraceStep,
} from "../../../contracts/asset";

export function createExactAssetResolutionRequest(
  requestedRef: AssetReference,
  includeTrace = true,
): AssetResolutionRequest {
  return {
    requestedRef,
    mode: "exact",
    allowOverrides: false,
    includeTrace,
  };
}

export function createSemanticAssetResolutionRequest(
  requestedRef: AssetReference,
  options: Pick<
    AssetResolutionRequest,
    "scope" | "sourceLayerPreference" | "allowOverrides" | "includeTrace"
  > = {},
): AssetResolutionRequest {
  return {
    requestedRef,
    mode: "semantic",
    allowOverrides: options.allowOverrides ?? false,
    ...(options.scope ? { scope: options.scope } : {}),
    ...(options.sourceLayerPreference
      ? { sourceLayerPreference: [...options.sourceLayerPreference] }
      : {}),
    includeTrace: options.includeTrace ?? true,
  };
}

export function exactResolutionBypassesOverridesByDefault(
  request: AssetResolutionRequest,
): boolean {
  return request.mode === "exact" && request.allowOverrides === false;
}

export function semanticResolutionCanOptIntoOverrides(
  request: AssetResolutionRequest,
): boolean {
  return request.mode !== "exact" && request.allowOverrides === true;
}

export function createResolutionTraceFixture(input: {
  readonly requestedRef: AssetReference;
  readonly resolvedRef?: AssetReference;
  readonly appliedOverrideRuleIds?: readonly string[];
  readonly steps?: readonly AssetResolutionTraceStep[];
  readonly conflicts?: readonly AssetResolutionConflict[];
}): AssetResolutionResult {
  return {
    requestedRef: input.requestedRef,
    ...(input.resolvedRef ? { resolvedRef: input.resolvedRef } : {}),
    appliedOverrideRuleIds: [...(input.appliedOverrideRuleIds ?? [])],
    trace: [
      ...(input.steps ?? [
        {
          stepId: "resolution.plan.fixture",
          message: "Fixture trace for future resolver planning.",
          inputRef: input.requestedRef,
          ...(input.resolvedRef ? { outputRef: input.resolvedRef } : {}),
          ...(input.appliedOverrideRuleIds?.[0]
            ? { appliedOverrideRuleId: input.appliedOverrideRuleIds[0] }
            : {}),
        },
      ]),
    ],
    diagnostics: [],
    conflicts: [...(input.conflicts ?? [])],
  };
}

export function createAmbiguousOverrideConflictFixture(input: {
  readonly conflictId: string;
  readonly targetRef: AssetReference;
  readonly candidateRefs: readonly AssetReference[];
  readonly overrideRuleIds: readonly string[];
}): AssetResolutionConflict {
  return {
    conflictId: input.conflictId,
    targetRef: input.targetRef,
    candidateRefs: [...input.candidateRefs],
    overrideRuleIds: [...input.overrideRuleIds],
    message: "Multiple override candidates are available for future resolver policy.",
  };
}
