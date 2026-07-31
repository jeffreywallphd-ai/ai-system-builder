import type {
  AssetDefinition,
  AssetMetadata,
  AssetPackManifest,
  AssetPackOverrideRule,
  AssetReference,
  AssetResolutionConflict,
  AssetResolutionDiagnostic,
  AssetResolutionRequest,
  AssetResolutionResult,
  AssetResolutionTraceStep,
  AssetSourceLayer,
} from "../../../contracts/asset";
import { isAssetSourceLayer } from "../../../contracts/asset";
import {
  sanitizeAssetMetadata,
  sanitizeAssetStringValue,
} from "../asset/asset-safe-metadata";

export interface ResolveAssetDefinitionInput {
  readonly request: AssetResolutionRequest;
  readonly definitions: readonly AssetDefinition[];
  readonly manifests?: readonly AssetPackManifest[];
  readonly overrideRules?: readonly AssetPackOverrideRule[];
  readonly sourceLayerOrder?: readonly AssetSourceLayer[];
  readonly now?: () => Date;
}

export interface AssetResolutionService {
  readonly resolveAssetDefinition: (
    input: ResolveAssetDefinitionInput,
  ) => AssetResolutionResult;
}

interface Candidate {
  readonly definition: AssetDefinition;
  readonly definitionRef: AssetReference;
  readonly inputIndex: number;
  readonly sourceLayer?: AssetSourceLayer;
  readonly packIndex?: number;
}

interface Selection {
  readonly candidate?: Candidate;
  readonly diagnostics: readonly AssetResolutionDiagnostic[];
  readonly conflicts: readonly AssetResolutionConflict[];
  readonly trace: readonly AssetResolutionTraceStep[];
}

interface OverrideSelection {
  readonly rule?: AssetPackOverrideRule;
  readonly diagnostics: readonly AssetResolutionDiagnostic[];
  readonly conflicts: readonly AssetResolutionConflict[];
  readonly trace: readonly AssetResolutionTraceStep[];
}

const AVAILABLE_LIFECYCLE_STATUSES = new Set(["draft", "validated", "published"]);
const SIMPLE_SEMVER_PATTERN = /^\d+\.\d+\.\d+$/;

export const assetResolutionService: AssetResolutionService = {
  resolveAssetDefinition,
};

export function resolveAssetDefinition(
  input: ResolveAssetDefinitionInput,
): AssetResolutionResult {
  const request = input.request;
  const includeTrace = request.includeTrace !== false;
  const trace: AssetResolutionTraceStep[] = [];
  const diagnostics: AssetResolutionDiagnostic[] = [];
  const conflicts: AssetResolutionConflict[] = [];
  const appliedOverrideRuleIds: string[] = [];
  const candidates = createCandidates(input.definitions, input.manifests);
  const sourceLayerOrder = input.sourceLayerOrder ?? request.sourceLayerPreference;
  const allowOverrides = request.allowOverrides ?? false;

  addTrace(trace, includeTrace, {
    stepId: "asset-resolution.request-received",
    message: "Asset resolution request received.",
    inputRef: safeRef(request.requestedRef),
    metadata: safeMetadata({
      mode: request.mode,
      allowOverrides,
      candidateCount: candidates.length,
      overrideRuleCount: input.overrideRules?.length ?? 0,
    }),
  });

  const baseSelection =
    request.mode === "exact"
      ? selectExactCandidate(request, candidates, sourceLayerOrder, includeTrace)
      : selectSemanticCandidate(request, candidates, sourceLayerOrder, includeTrace);

  trace.push(...baseSelection.trace);
  diagnostics.push(...baseSelection.diagnostics);
  conflicts.push(...baseSelection.conflicts);

  if (!allowOverrides) {
    addTrace(trace, includeTrace, {
      stepId: "asset-resolution.overrides-skipped",
      message: "Override rules were skipped because overrides are disabled for this request.",
      inputRef: safeRef(request.requestedRef),
      metadata: safeMetadata({ reason: "allowOverrides:false" }),
    });
    return finalizeResult(request, baseSelection.candidate, appliedOverrideRuleIds, trace, diagnostics, conflicts);
  }

  if (request.mode === "exact") {
    addTrace(trace, includeTrace, {
      stepId: "asset-resolution.exact-overrides-enabled",
      message: "Exact request explicitly allowed override rule evaluation.",
      inputRef: safeRef(request.requestedRef),
    });
  }

  if (!baseSelection.candidate && request.mode === "exact") {
    return finalizeResult(request, undefined, appliedOverrideRuleIds, trace, diagnostics, conflicts);
  }

  const overrideSelection = selectOverrideRule({
    request,
    resolvedRef: baseSelection.candidate?.definitionRef,
    overrideRules: input.overrideRules ?? [],
    sourceLayerOrder,
    includeTrace,
  });

  trace.push(...overrideSelection.trace);
  diagnostics.push(...overrideSelection.diagnostics);
  conflicts.push(...overrideSelection.conflicts);

  if (overrideSelection.conflicts.length > 0) {
    return finalizeResult(request, undefined, appliedOverrideRuleIds, trace, diagnostics, conflicts);
  }

  if (!overrideSelection.rule) {
    return finalizeResult(request, baseSelection.candidate, appliedOverrideRuleIds, trace, diagnostics, conflicts);
  }

  appliedOverrideRuleIds.push(overrideSelection.rule.ruleId);
  const replacementSelection = selectReplacementCandidate(
    overrideSelection.rule,
    candidates,
    sourceLayerOrder,
    includeTrace,
  );
  trace.push(...replacementSelection.trace);
  diagnostics.push(...replacementSelection.diagnostics);
  conflicts.push(...replacementSelection.conflicts);

  if (!replacementSelection.candidate) {
    return finalizeResult(request, undefined, appliedOverrideRuleIds, trace, diagnostics, conflicts);
  }

  addTrace(trace, includeTrace, {
    stepId: "asset-resolution.override-applied",
    message: "Override rule selected a replacement asset definition.",
    inputRef: safeRef(overrideSelection.rule.targetRef),
    outputRef: safeRef(replacementSelection.candidate.definitionRef),
    sourceLayer: overrideSelection.rule.sourceLayer,
    appliedOverrideRuleId: overrideSelection.rule.ruleId,
  });

  return finalizeResult(
    request,
    replacementSelection.candidate,
    appliedOverrideRuleIds,
    trace,
    diagnostics,
    conflicts,
  );
}

function selectExactCandidate(
  request: AssetResolutionRequest,
  candidates: readonly Candidate[],
  sourceLayerOrder: readonly AssetSourceLayer[] | undefined,
  includeTrace: boolean,
): Selection {
  const trace: AssetResolutionTraceStep[] = [];
  addTrace(trace, includeTrace, {
    stepId: "asset-resolution.exact-mode-selected",
    message: "Exact asset definition version resolution selected.",
    inputRef: safeRef(request.requestedRef),
  });

  const matches = candidates.filter((candidate) =>
    refMatchesExactDefinition(request.requestedRef, candidate.definition),
  );

  addTrace(trace, includeTrace, {
    stepId: "asset-resolution.candidates-considered",
    message: "Candidate asset definitions were considered for exact resolution.",
    inputRef: safeRef(request.requestedRef),
    metadata: safeMetadata({ candidateCount: matches.length }),
  });

  if (matches.length === 0) {
    return {
      trace,
      diagnostics: [
        diagnostic(
          "error",
          "asset-resolution.not-found",
          "No asset definition matched the exact requested definition ID and version.",
          request.requestedRef,
        ),
      ],
      conflicts: [],
    };
  }

  const duplicateSelection = selectDuplicateCandidate({
    request,
    candidates: matches,
    sourceLayerOrder,
    includeTrace,
    conflictCode: "asset-resolution.duplicate-exact-candidates",
    conflictMessage:
      "Multiple exact asset definitions matched and the supplied ordering did not identify one deterministic winner.",
  });
  return {
    ...duplicateSelection,
    trace: [...trace, ...duplicateSelection.trace],
  };
}

function selectSemanticCandidate(
  request: AssetResolutionRequest,
  candidates: readonly Candidate[],
  sourceLayerOrder: readonly AssetSourceLayer[] | undefined,
  includeTrace: boolean,
): Selection {
  const trace: AssetResolutionTraceStep[] = [];
  addTrace(trace, includeTrace, {
    stepId: "asset-resolution.semantic-mode-selected",
    message: "Semantic/default asset definition resolution selected.",
    inputRef: safeRef(request.requestedRef),
  });

  let matches: readonly Candidate[] = candidates.filter((candidate) =>
    refMatchesDefinitionId(request.requestedRef, candidate.definition),
  );

  addTrace(trace, includeTrace, {
    stepId: "asset-resolution.candidates-considered",
    message: "Candidate asset definitions were considered for semantic/default resolution.",
    inputRef: safeRef(request.requestedRef),
    metadata: safeMetadata({ candidateCount: matches.length }),
  });

  if (matches.length === 0) {
    return {
      trace,
      diagnostics: [
        diagnostic(
          "error",
          "asset-resolution.not-found",
          "No asset definition matched the requested definition ID.",
          request.requestedRef,
        ),
      ],
      conflicts: [],
    };
  }

  const available = matches.filter((candidate) =>
    AVAILABLE_LIFECYCLE_STATUSES.has(candidate.definition.lifecycleStatus),
  );
  if (available.length > 0 && available.length < matches.length) {
    matches = available;
    addTrace(trace, includeTrace, {
      stepId: "asset-resolution.available-candidates-preferred",
      message: "Available lifecycle candidates were preferred over unavailable candidates.",
      inputRef: safeRef(request.requestedRef),
      metadata: safeMetadata({ candidateCount: matches.length }),
    });
  }

  const sourceLayerSelection = selectBySourceLayer(matches, sourceLayerOrder);
  if (sourceLayerSelection.status === "selected") {
    return {
      candidate: sourceLayerSelection.candidate,
      trace,
      diagnostics: [],
      conflicts: [],
    };
  }

  if (sourceLayerSelection.status === "tied") {
    matches = sourceLayerSelection.candidates;
  }

  const versionSelection = selectHighestSimpleSemver(matches);
  if (versionSelection.status === "selected") {
    return {
      candidate: versionSelection.candidate,
      trace,
      diagnostics: [],
      conflicts: [],
    };
  }

  const conflict = conflictForCandidates(
    "asset-resolution.semantic-candidate-conflict",
    request.requestedRef,
    versionSelection.candidates,
    "Multiple semantic/default candidates were available and version choice was ambiguous.",
  );

  addTrace(trace, includeTrace, {
    stepId: "asset-resolution.candidate-conflict",
    message: "Semantic/default candidate selection produced a deterministic conflict diagnostic.",
    inputRef: safeRef(request.requestedRef),
  });

  return {
    trace,
    diagnostics: [
      diagnostic(
        "error",
        "asset-resolution.semantic-candidate-conflict",
        "Multiple semantic/default candidates were available and no deterministic candidate could be selected.",
        request.requestedRef,
        { conflictId: conflict.conflictId },
      ),
    ],
    conflicts: [conflict],
  };
}

function selectDuplicateCandidate(input: {
  readonly request: AssetResolutionRequest;
  readonly candidates: readonly Candidate[];
  readonly sourceLayerOrder: readonly AssetSourceLayer[] | undefined;
  readonly includeTrace: boolean;
  readonly conflictCode: string;
  readonly conflictMessage: string;
}): Selection {
  if (input.candidates.length === 1) {
    return { candidate: input.candidates[0], trace: [], diagnostics: [], conflicts: [] };
  }

  const sourceLayerSelection = selectBySourceLayer(input.candidates, input.sourceLayerOrder);
  if (sourceLayerSelection.status === "selected") {
    return {
      candidate: sourceLayerSelection.candidate,
      trace: [
        traceStep(input.includeTrace, {
          stepId: "asset-resolution.source-layer-order-applied",
          message: "Explicit source-layer order selected one matching candidate.",
          inputRef: safeRef(input.request.requestedRef),
          sourceLayer: sourceLayerSelection.candidate.sourceLayer,
        }),
      ].filter(isTraceStep),
      diagnostics: [],
      conflicts: [],
    };
  }

  const packSelection = selectByPackOrder(input.candidates);
  if (packSelection.status === "selected") {
    return {
      candidate: packSelection.candidate,
      trace: [
        traceStep(input.includeTrace, {
          stepId: "asset-resolution.manifest-order-applied",
          message: "Explicit manifest order selected one matching candidate.",
          inputRef: safeRef(input.request.requestedRef),
          sourceLayer: packSelection.candidate.sourceLayer,
        }),
      ].filter(isTraceStep),
      diagnostics: [],
      conflicts: [],
    };
  }

  const conflict = conflictForCandidates(
    input.conflictCode,
    input.request.requestedRef,
    input.candidates,
    input.conflictMessage,
  );
  return {
    trace: [
      traceStep(input.includeTrace, {
        stepId: "asset-resolution.duplicate-candidate-conflict",
        message: "Duplicate matching candidates produced a deterministic conflict diagnostic.",
        inputRef: safeRef(input.request.requestedRef),
      }),
    ].filter(isTraceStep),
    diagnostics: [
      diagnostic("error", input.conflictCode, input.conflictMessage, input.request.requestedRef, {
        conflictId: conflict.conflictId,
      }),
    ],
    conflicts: [conflict],
  };
}

function selectOverrideRule(input: {
  readonly request: AssetResolutionRequest;
  readonly resolvedRef?: AssetReference;
  readonly overrideRules: readonly AssetPackOverrideRule[];
  readonly sourceLayerOrder: readonly AssetSourceLayer[] | undefined;
  readonly includeTrace: boolean;
}): OverrideSelection {
  const trace: AssetResolutionTraceStep[] = [];
  const enabledRules = input.overrideRules.filter(
    (rule) =>
      rule.enabled &&
      rule.conflictPolicy !== "disabled" &&
      (!input.request.scope || rule.scope === input.request.scope) &&
      (overrideTargetMatches(rule.targetRef, input.request.requestedRef) ||
        (input.resolvedRef ? overrideTargetMatches(rule.targetRef, input.resolvedRef) : false)),
  );

  if (enabledRules.length === 0) {
    addTrace(trace, input.includeTrace, {
      stepId: "asset-resolution.no-override-rule-matched",
      message: "No enabled override rule matched the request context.",
      inputRef: safeRef(input.request.requestedRef),
    });
    return { trace, diagnostics: [], conflicts: [] };
  }

  for (const rule of enabledRules) {
    addTrace(trace, input.includeTrace, {
      stepId: "asset-resolution.override-rule-matched",
      message: "Enabled override rule matched the request context.",
      inputRef: safeRef(rule.targetRef),
      outputRef: safeRef(rule.replacementRef),
      sourceLayer: rule.sourceLayer,
      appliedOverrideRuleId: rule.ruleId,
    });
  }

  const sortedByPriority = [...enabledRules].sort((left, right) =>
    right.priority - left.priority || left.ruleId.localeCompare(right.ruleId),
  );
  const highestPriority = sortedByPriority[0]?.priority;
  const priorityWinners = sortedByPriority.filter((rule) => rule.priority === highestPriority);

  if (priorityWinners.length === 1) {
    return { rule: priorityWinners[0], trace, diagnostics: [], conflicts: [] };
  }

  const layerWinner = selectOverrideBySourceLayer(priorityWinners, input.sourceLayerOrder);
  if (layerWinner.status === "selected") {
    return { rule: layerWinner.rule, trace, diagnostics: [], conflicts: [] };
  }

  const conflict = overrideConflict(input.request.requestedRef, priorityWinners);
  addTrace(trace, input.includeTrace, {
    stepId: "asset-resolution.override-conflict",
    message: "Matching override rules had equal priority and no deterministic tie-breaker.",
    inputRef: safeRef(input.request.requestedRef),
  });
  return {
    trace,
    diagnostics: [
      diagnostic(
        "error",
        "asset-resolution.override-conflict",
        "Multiple enabled override rules matched with equal priority and no deterministic tie-breaker.",
        input.request.requestedRef,
        { conflictId: conflict.conflictId },
      ),
    ],
    conflicts: [conflict],
  };
}

function selectReplacementCandidate(
  rule: AssetPackOverrideRule,
  candidates: readonly Candidate[],
  sourceLayerOrder: readonly AssetSourceLayer[] | undefined,
  includeTrace: boolean,
): Selection {
  const request: AssetResolutionRequest = {
    requestedRef: rule.replacementRef,
    mode: rule.replacementRef.kind === "asset-definition-version" || rule.replacementRef.version
      ? "exact"
      : "semantic",
    allowOverrides: false,
    includeTrace,
  };
  const selection =
    request.mode === "exact"
      ? selectExactCandidate(request, candidates, sourceLayerOrder, includeTrace)
      : selectSemanticCandidate(request, candidates, sourceLayerOrder, includeTrace);

  if (!selection.candidate && selection.conflicts.length === 0) {
    return {
      ...selection,
      diagnostics: [
        diagnostic(
          "error",
          "asset-resolution.missing-replacement",
          "Override rule replacement reference did not resolve to an asset definition.",
          rule.replacementRef,
          { ruleId: rule.ruleId },
        ),
      ],
      trace: [
        ...selection.trace,
        traceStep(includeTrace, {
          stepId: "asset-resolution.missing-replacement",
          message: "Override rule replacement reference was missing.",
          inputRef: safeRef(rule.replacementRef),
          appliedOverrideRuleId: rule.ruleId,
        }),
      ].filter(isTraceStep),
    };
  }

  return selection;
}

function finalizeResult(
  request: AssetResolutionRequest,
  candidate: Candidate | undefined,
  appliedOverrideRuleIds: readonly string[],
  trace: readonly AssetResolutionTraceStep[],
  diagnostics: readonly AssetResolutionDiagnostic[],
  conflicts: readonly AssetResolutionConflict[],
): AssetResolutionResult {
  const finalTrace = [...trace];
  if (candidate) {
    finalTrace.push({
      stepId: "asset-resolution.final-definition-selected",
      message: "Final resolved asset definition selected.",
      inputRef: safeRef(request.requestedRef),
      outputRef: safeRef(candidate.definitionRef),
      ...(candidate.sourceLayer ? { sourceLayer: candidate.sourceLayer } : {}),
      metadata: safeMetadata({
        definitionId: String(candidate.definition.definitionId),
        version: String(candidate.definition.version),
      }),
    });
  }
  return {
    requestedRef: safeRef(request.requestedRef),
    ...(candidate ? { resolvedRef: safeRef(candidate.definitionRef), resolvedDefinition: candidate.definition } : {}),
    appliedOverrideRuleIds: [...appliedOverrideRuleIds],
    trace: request.includeTrace === false ? [] : finalTrace,
    diagnostics: [...diagnostics],
    conflicts: [...conflicts],
  };
}

function createCandidates(
  definitions: readonly AssetDefinition[],
  manifests: readonly AssetPackManifest[] | undefined,
): readonly Candidate[] {
  const manifestMetadata = new Map<string, { readonly sourceLayer: AssetSourceLayer; readonly packIndex: number }>();
  manifests?.forEach((manifest, packIndex) => {
    manifest.assets.forEach((entry) => {
      manifestMetadata.set(refKey(entry.definitionRef), {
        sourceLayer: entry.sourceLayer,
        packIndex,
      });
      manifestMetadata.set(definitionKey(entry.definition.definitionId, entry.definition.version), {
        sourceLayer: entry.sourceLayer,
        packIndex,
      });
    });
  });

  return definitions.map((definition, inputIndex) => {
    const definitionRef = definitionRefFor(definition);
    const metadata = manifestMetadata.get(refKey(definitionRef));
    return {
      definition,
      definitionRef,
      inputIndex,
      sourceLayer: metadata?.sourceLayer ?? sourceLayerFromDefinition(definition),
      packIndex: metadata?.packIndex,
    };
  });
}

function sourceLayerFromDefinition(definition: AssetDefinition): AssetSourceLayer | undefined {
  const metadata = definition.metadata as Record<string, unknown> | undefined;
  const sourceLayer = metadata?.sourceLayer;
  return typeof sourceLayer === "string" && isAssetSourceLayer(sourceLayer)
    ? sourceLayer
    : undefined;
}

function selectBySourceLayer(
  candidates: readonly Candidate[],
  sourceLayerOrder: readonly AssetSourceLayer[] | undefined,
):
  | { readonly status: "not-applicable" }
  | { readonly status: "selected"; readonly candidate: Candidate }
  | { readonly status: "tied"; readonly candidates: readonly Candidate[] } {
  if (!sourceLayerOrder?.length) return { status: "not-applicable" };
  const ranks = new Map(sourceLayerOrder.map((layer, index) => [layer, index]));
  const ranked = candidates
    .map((candidate) => ({ candidate, rank: candidate.sourceLayer ? ranks.get(candidate.sourceLayer) : undefined }))
    .filter((entry): entry is { readonly candidate: Candidate; readonly rank: number } => typeof entry.rank === "number");
  if (ranked.length === 0) return { status: "not-applicable" };
  const bestRank = Math.min(...ranked.map((entry) => entry.rank));
  const winners = ranked.filter((entry) => entry.rank === bestRank).map((entry) => entry.candidate);
  return winners.length === 1 ? { status: "selected", candidate: winners[0] } : { status: "tied", candidates: winners };
}

function selectByPackOrder(
  candidates: readonly Candidate[],
):
  | { readonly status: "not-applicable" }
  | { readonly status: "selected"; readonly candidate: Candidate } {
  const ranked = candidates.filter((candidate) => typeof candidate.packIndex === "number");
  if (ranked.length !== candidates.length || ranked.length === 0) return { status: "not-applicable" };
  const bestIndex = Math.min(...ranked.map((candidate) => candidate.packIndex ?? Number.MAX_SAFE_INTEGER));
  const winners = ranked.filter((candidate) => candidate.packIndex === bestIndex);
  return winners.length === 1 ? { status: "selected", candidate: winners[0] } : { status: "not-applicable" };
}

function selectHighestSimpleSemver(
  candidates: readonly Candidate[],
):
  | { readonly status: "selected"; readonly candidate: Candidate }
  | { readonly status: "conflict"; readonly candidates: readonly Candidate[] } {
  if (candidates.length === 1) return { status: "selected", candidate: candidates[0] };
  if (!candidates.every((candidate) => SIMPLE_SEMVER_PATTERN.test(String(candidate.definition.version)))) {
    return { status: "conflict", candidates };
  }
  const sorted = [...candidates].sort(compareCandidateVersionDescending);
  const highest = sorted[0];
  const sameVersion = sorted.filter(
    (candidate) => compareVersions(candidate.definition.version, highest.definition.version) === 0,
  );
  return sameVersion.length === 1
    ? { status: "selected", candidate: highest }
    : { status: "conflict", candidates: sameVersion };
}

function compareCandidateVersionDescending(left: Candidate, right: Candidate): number {
  return compareVersions(right.definition.version, left.definition.version);
}

function compareVersions(left: string, right: string): number {
  const leftParts = left.split(".").map((part) => Number(part));
  const rightParts = right.split(".").map((part) => Number(part));
  for (let index = 0; index < 3; index += 1) {
    const delta = (leftParts[index] ?? 0) - (rightParts[index] ?? 0);
    if (delta !== 0) return delta;
  }
  return 0;
}

function selectOverrideBySourceLayer(
  rules: readonly AssetPackOverrideRule[],
  sourceLayerOrder: readonly AssetSourceLayer[] | undefined,
):
  | { readonly status: "not-applicable" }
  | { readonly status: "selected"; readonly rule: AssetPackOverrideRule } {
  if (!sourceLayerOrder?.length) return { status: "not-applicable" };
  const ranks = new Map(sourceLayerOrder.map((layer, index) => [layer, index]));
  const ranked = rules
    .map((rule) => ({ rule, rank: ranks.get(rule.sourceLayer) }))
    .filter((entry): entry is { readonly rule: AssetPackOverrideRule; readonly rank: number } => typeof entry.rank === "number");
  if (ranked.length === 0) return { status: "not-applicable" };
  const bestRank = Math.min(...ranked.map((entry) => entry.rank));
  const winners = ranked.filter((entry) => entry.rank === bestRank);
  return winners.length === 1 ? { status: "selected", rule: winners[0].rule } : { status: "not-applicable" };
}

function refMatchesExactDefinition(ref: AssetReference, definition: AssetDefinition): boolean {
  return String(ref.id) === String(definition.definitionId) && ref.version === definition.version;
}

function refMatchesDefinitionId(ref: AssetReference, definition: AssetDefinition): boolean {
  return String(ref.id) === String(definition.definitionId);
}

function overrideTargetMatches(targetRef: AssetReference, candidateRef: AssetReference): boolean {
  if (String(targetRef.id) !== String(candidateRef.id)) return false;
  if (targetRef.kind === "asset-definition" && !targetRef.version) return true;
  if (targetRef.kind === "asset-definition-version" || targetRef.version) {
    return candidateRef.version === targetRef.version;
  }
  return targetRef.kind === candidateRef.kind;
}

function definitionRefFor(definition: AssetDefinition): AssetReference {
  return {
    kind: "asset-definition-version",
    id: definition.definitionId as AssetReference["id"],
    version: definition.version,
  };
}

function conflictForCandidates(
  conflictId: string,
  targetRef: AssetReference,
  candidates: readonly Candidate[],
  message: string,
): AssetResolutionConflict {
  return {
    conflictId,
    targetRef: safeRef(targetRef),
    candidateRefs: candidates.map((candidate) => safeRef(candidate.definitionRef)).sort(compareRefs),
    message,
  };
}

function overrideConflict(
  targetRef: AssetReference,
  rules: readonly AssetPackOverrideRule[],
): AssetResolutionConflict {
  return {
    conflictId: "asset-resolution.override-conflict",
    targetRef: safeRef(targetRef),
    candidateRefs: rules.map((rule) => safeRef(rule.replacementRef)).sort(compareRefs),
    overrideRuleIds: rules.map((rule) => rule.ruleId).sort(),
    message:
      "Multiple enabled override rules matched with equal priority and no deterministic tie-breaker.",
  };
}

function diagnostic(
  severity: AssetResolutionDiagnostic["severity"],
  code: string,
  message: string,
  ref?: AssetReference,
  metadata?: AssetMetadata,
): AssetResolutionDiagnostic {
  return {
    severity,
    code,
    message,
    ...(ref ? { ref: safeRef(ref) } : {}),
    ...(metadata ? { metadata: safeMetadata(metadata) } : {}),
  };
}

function traceStep(
  includeTrace: boolean,
  step: AssetResolutionTraceStep,
): AssetResolutionTraceStep | undefined {
  return includeTrace ? step : undefined;
}

function isTraceStep(step: AssetResolutionTraceStep | undefined): step is AssetResolutionTraceStep {
  return Boolean(step);
}

function addTrace(
  trace: AssetResolutionTraceStep[],
  includeTrace: boolean,
  step: AssetResolutionTraceStep,
): void {
  if (includeTrace) trace.push(step);
}

function safeRef(reference: AssetReference): AssetReference {
  const label = sanitizeAssetStringValue(reference.label);
  return {
    kind: reference.kind,
    id: reference.id,
    ...(reference.version ? { version: reference.version } : {}),
    ...(label ? { label } : {}),
  };
}

function safeMetadata(metadata: AssetMetadata): AssetMetadata | undefined {
  return sanitizeAssetMetadata(metadata);
}

function definitionKey(id: unknown, version: unknown): string {
  return `asset-definition-version:${String(id)}:${String(version)}`;
}

function refKey(ref: AssetReference): string {
  return `${ref.kind}:${String(ref.id)}:${ref.version ?? ""}`;
}

function compareRefs(left: AssetReference, right: AssetReference): number {
  return refKey(left).localeCompare(refKey(right));
}
