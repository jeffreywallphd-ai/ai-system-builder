import { createWorkspaceId } from '../workspace';
import type { ExecutionPlanRecord } from './execution-plan-record';
import type { ExecutionStep } from './execution-plan-step';
import type { ExecutionDependency } from './execution-plan-dependency';
import type { ExecutionInput, ExecutionOutput } from './execution-plan-input-output';
import type { ExecutionAdapterReference } from './execution-plan-adapter-reference';
import type { ExecutionSafetyGate } from './execution-plan-safety-gate';
import type { ExecutionResourceEstimate } from './execution-plan-resource-estimate';
import type { ExecutionBlocker, ExecutionDiagnostic } from './execution-plan-diagnostics';
import type { ExecutionPlanProvenanceEntry } from './execution-plan-provenance';
import { normalizeExecutionPlanStatus, normalizeExecutionStepKind, normalizeExecutionStepStatus } from './execution-plan-status';
import { normalizeExecutionDependencyKind, normalizeExecutionDependencyStatus } from './execution-plan-dependency';
import { normalizeExecutionInputKind, normalizeExecutionInputOutputStatus, normalizeExecutionOutputKind } from './execution-plan-input-output';
import { normalizeExecutionAdapterReferenceKind, normalizeExecutionAdapterReferenceStatus } from './execution-plan-adapter-reference';
import { normalizeExecutionSafetyGateKind, normalizeExecutionSafetyGateStatus } from './execution-plan-safety-gate';
import { normalizeExecutionComputeEstimateCategory, normalizeExecutionDurationEstimateCategory, normalizeExecutionStorageEstimateCategory } from './execution-plan-resource-estimate';
import { normalizeExecutionBlockerId, normalizeExecutionDependencyId, normalizeExecutionDiagnosticId, normalizeExecutionAdapterReferenceId, normalizeExecutionInputId, normalizeExecutionOutputId, normalizeExecutionPlanId, normalizeExecutionResourceEstimateId, normalizeExecutionSafetyGateId, normalizeExecutionStepId, normalizeProviderAdapterReferenceId } from './execution-plan-identity';
import type { CreateExecutionPlanCommand, ReadExecutionPlanCommand, ListExecutionPlansCommand, ArchiveExecutionPlanCommand, RefreshExecutionPlanCommand, PrepareExecutionStepsCommand, PrepareExecutionDependenciesCommand, PrepareExecutionInputsCommand, PrepareExecutionOutputsCommand, ValidateExecutionPlanCommand, PreviewExecutionPlanCommand } from './execution-plan-commands';

import { passiveRecord as record, passiveOptional as optional, passiveArray as list,
  passiveText as text, passiveTypedString as typed, passiveEnum, passiveTimestamp as timestamp,
  passiveBoolean, passiveDiagnosticCode } from '../shared';

type WorkspaceCommand<T extends {workspaceId:string}> = Omit<T, "workspaceId"> & {workspaceId: ReturnType<typeof createWorkspaceId>};
type PlanCommand<T extends {workspaceId:string;executionPlanId:string}> = WorkspaceCommand<Omit<T, "executionPlanId"> & {executionPlanId: ReturnType<typeof normalizeExecutionPlanId>}>;
const workspaceId = typed(createWorkspaceId);
const planId = typed(normalizeExecutionPlanId);
const stepId = typed(normalizeExecutionStepId);
const adapterId = typed(normalizeExecutionAdapterReferenceId);
const inputId = typed(normalizeExecutionInputId);
const outputId = typed(normalizeExecutionOutputId);
const gateId = typed(normalizeExecutionSafetyGateId);
export const normalizeExecutionDiagnostic = record<ExecutionDiagnostic>({
  diagnosticId: optional(typed(normalizeExecutionDiagnosticId)), code: passiveDiagnosticCode,
  message: text, severity: passiveEnum(['info','warning','error']),
  targetReferenceId: optional(text), targetReferenceKind: optional(text),
});
export const normalizeExecutionBlocker = record<ExecutionBlocker>({
  blockerId: optional(typed(normalizeExecutionBlockerId)), code: passiveDiagnosticCode,
  message: text, targetReferenceId: optional(text), targetReferenceKind: optional(text),
});
const blockers = list(normalizeExecutionBlocker);
const diagnostics = list(normalizeExecutionDiagnostic);
export const normalizeExecutionStep = record<ExecutionStep>({
  id: stepId, sourceCompositionPlanId: text, sourceNodeId: optional(text), sourceRelationshipId: optional(text),
  planId: optional(planId), kind: typed(normalizeExecutionStepKind), status: typed(normalizeExecutionStepStatus),
  label: text, summary: optional(text), requiredAdapterReferenceIds: list(adapterId), inputIds: list(inputId),
  outputIds: list(outputId), dependencyIds: list(typed(normalizeExecutionDependencyId)), safetyGateIds: list(gateId),
  resourceEstimateId: optional(typed(normalizeExecutionResourceEstimateId)), blockers, diagnostics,
});
export const normalizeExecutionDependency = record<ExecutionDependency>({
  id: typed(normalizeExecutionDependencyId), kind: typed(normalizeExecutionDependencyKind), status: typed(normalizeExecutionDependencyStatus),
  sourceStepId: optional(stepId), targetStepId: optional(stepId), adapterReferenceId: optional(adapterId),
  safetyGateId: optional(gateId), inputId: optional(inputId), outputId: optional(outputId), label: text, summary: optional(text), blockers, diagnostics,
});
export const normalizeExecutionInput = record<ExecutionInput>({
  id: inputId, stepId, kind: typed(normalizeExecutionInputKind), status: typed(normalizeExecutionInputOutputStatus),
  label: text, summary: optional(text), sourceReferenceKind: text, sourceReferenceId: optional(text),
  required: passiveBoolean, blockers, diagnostics,
});
export const normalizeExecutionOutput = record<ExecutionOutput>({
  id: outputId, stepId, kind: typed(normalizeExecutionOutputKind), status: typed(normalizeExecutionInputOutputStatus),
  label: text, summary: optional(text), destinationReferenceKind: text, destinationReferenceId: optional(text),
  required: passiveBoolean, blockers, diagnostics,
});
export const normalizeExecutionAdapterReference = record<ExecutionAdapterReference>({
  id: adapterId, kind: typed(normalizeExecutionAdapterReferenceKind), status: typed(normalizeExecutionAdapterReferenceStatus),
  providerReferenceId: optional(typed(normalizeProviderAdapterReferenceId)), providerKind: optional(text), capabilityKind: optional(text),
  sourceRuntimeReadinessBindingId: text, sourceRuntimeBindingId: optional(text), label: text, summary: optional(text), blockers, diagnostics,
});
export const normalizeExecutionSafetyGate = record<ExecutionSafetyGate>({
  id: gateId, kind: typed(normalizeExecutionSafetyGateKind), status: typed(normalizeExecutionSafetyGateStatus),
  label: text, summary: optional(text), stepId: optional(stepId), inputId: optional(inputId), outputId: optional(outputId),
  adapterReferenceId: optional(adapterId), blockers, diagnostics,
});
export const normalizeExecutionResourceEstimate = record<ExecutionResourceEstimate>({
  id: typed(normalizeExecutionResourceEstimateId), compute: typed(normalizeExecutionComputeEstimateCategory),
  storage: typed(normalizeExecutionStorageEstimateCategory), duration: typed(normalizeExecutionDurationEstimateCategory), summary: optional(text),
});
export const normalizeExecutionPlanProvenanceEntry = record<ExecutionPlanProvenanceEntry>({
  kind: passiveEnum(['execution-plan-created','source-runtime-readiness-binding-checked','steps-planned',
    'dependencies-planned','inputs-planned','outputs-planned','adapter-references-planned','safety-gates-planned',
    'resource-estimates-added','blockers-detected','execution-plan-refreshed','execution-plan-archived']),
  at: timestamp, workspaceId: optional(workspaceId), executionPlanId: optional(planId),
  runtimeReadinessBindingId: optional(text), compositionPlanId: optional(text), stepId: optional(stepId),
  inputId: optional(inputId), outputId: optional(outputId), adapterReferenceId: optional(adapterId), safetyGateId: optional(gateId), actorId: optional(text),
});
export const normalizeExecutionPlanRecord = record<ExecutionPlanRecord>({
  id: planId, workspaceId, sourceCompositionPlanId: text, sourceRuntimeReadinessBindingId: text,
  sourceReadinessStatus: text, status: typed(normalizeExecutionPlanStatus), steps: list(normalizeExecutionStep),
  dependencies: list(normalizeExecutionDependency), inputs: list(normalizeExecutionInput), outputs: list(normalizeExecutionOutput),
  adapterReferences: list(normalizeExecutionAdapterReference), safetyGates: list(normalizeExecutionSafetyGate),
  blockers, diagnostics, resourceEstimates: list(normalizeExecutionResourceEstimate), provenance: list(normalizeExecutionPlanProvenanceEntry),
  createdAt: timestamp, updatedAt: timestamp, archivedAt: optional(timestamp),
});
export const normalizeCreateExecutionPlanCommand = record<WorkspaceCommand<CreateExecutionPlanCommand>>({ workspaceId, runtimeReadinessBindingId: text, compositionPlanId: optional(text) });
export const normalizeReadExecutionPlanCommand = record<PlanCommand<ReadExecutionPlanCommand>>({ workspaceId, executionPlanId: planId });
export const normalizeListExecutionPlansCommand = record<WorkspaceCommand<ListExecutionPlansCommand>>({ workspaceId });
export const normalizeArchiveExecutionPlanCommand = normalizeReadExecutionPlanCommand;
export const normalizeRefreshExecutionPlanCommand = record<PlanCommand<RefreshExecutionPlanCommand>>({ workspaceId, executionPlanId: planId, runtimeReadinessBindingId: text });
export const normalizePrepareExecutionStepsCommand = normalizeRefreshExecutionPlanCommand;
export const normalizePrepareExecutionDependenciesCommand = normalizeReadExecutionPlanCommand;
export const normalizePrepareExecutionInputsCommand = normalizeReadExecutionPlanCommand;
export const normalizePrepareExecutionOutputsCommand = normalizeReadExecutionPlanCommand;
export const normalizeValidateExecutionPlanCommand = normalizeReadExecutionPlanCommand;
export const normalizePreviewExecutionPlanCommand = normalizeReadExecutionPlanCommand;
