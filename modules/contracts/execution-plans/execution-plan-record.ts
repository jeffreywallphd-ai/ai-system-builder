import type { ExecutionPlanStatus } from './execution-plan-status';
import type { ExecutionPlanId } from './execution-plan-identity';
import type { ExecutionStep } from './execution-plan-step';
import type { ExecutionDependency } from './execution-plan-dependency';
import type { ExecutionInput, ExecutionOutput } from './execution-plan-input-output';
import type { ExecutionAdapterReference } from './execution-plan-adapter-reference';
import type { ExecutionSafetyGate } from './execution-plan-safety-gate';
import type { ExecutionResourceEstimate } from './execution-plan-resource-estimate';
import type { ExecutionBlocker, ExecutionDiagnostic } from './execution-plan-diagnostics';
import type { ExecutionPlanProvenanceEntry } from './execution-plan-provenance';
export interface ExecutionPlanRecord { id: ExecutionPlanId; workspaceId: string; sourceCompositionPlanId: string; sourceRuntimeReadinessBindingId: string; sourceReadinessStatus: string; status: ExecutionPlanStatus; steps: ExecutionStep[]; dependencies: ExecutionDependency[]; inputs: ExecutionInput[]; outputs: ExecutionOutput[]; adapterReferences: ExecutionAdapterReference[]; safetyGates: ExecutionSafetyGate[]; blockers: ExecutionBlocker[]; diagnostics: ExecutionDiagnostic[]; resourceEstimates: ExecutionResourceEstimate[]; provenance: ExecutionPlanProvenanceEntry[]; createdAt: string; updatedAt: string; archivedAt?: string; }
