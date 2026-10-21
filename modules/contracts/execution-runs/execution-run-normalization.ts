import { normalizeAssetCompositionPlanId } from '../asset-composition';
import { normalizeExecutionPlanId } from '../execution-plans';
import { normalizeRuntimeReadinessBindingId } from '../runtime-readiness';
import { createWorkspaceId } from '../workspace';
import { normalizeSystemBuilderModelRecordId } from '../system-builder';
import { normalizeExecutionApprovalId, normalizeExecutionAttemptId, normalizeExecutionCancellationRequestId, normalizeExecutionEventId, normalizeExecutionResultId, normalizeExecutionRetryRequestId, normalizeExecutionRunId, normalizeExecutionRuntimeReferenceId } from './execution-run-identity';
import { normalizeExecutionApprovalKind, normalizeExecutionApprovalStatus, normalizeExecutionAttemptStatus, normalizeExecutionCancellationStatus, normalizeExecutionEventKind, normalizeExecutionFailureClassification, normalizeExecutionProgressPhase, normalizeExecutionResultKind, normalizeExecutionResultStatus, normalizeExecutionRetryStatus, normalizeExecutionRunStatus, normalizeExecutionRuntimeReferenceStatus } from './execution-run-status';
import type { ExecutionProgressSummary } from './execution-run-event';
import type { ExecutionRunRecord, ExecutionRunSourceContextKind } from './execution-run-record';
import type { ExecutionAttemptRecord } from './execution-run-attempt';
import type { ExecutionEventRecord } from './execution-run-event';
import type { ExecutionResultRecord } from './execution-run-result';
import type { ExecutionApprovalRecord } from './execution-run-approval';
import type { ExecutionRuntimeReferenceRecord } from './execution-run-runtime-reference';
import type { ExecutionCancellationRequestRecord } from './execution-run-cancellation';
import type { ExecutionRetryRequestRecord } from './execution-run-retry';
import type { ExecutionRunProvenanceEntry } from './execution-run-provenance';
import type { ExecutionDiagnostic, ExecutionBlocker } from './execution-run-diagnostics';
import * as Commands from './execution-run-commands';
import { passiveRecord as record, passiveOptional as optional, passiveArray, passiveText as text,
  passiveTypedString as typed, passiveEnum, passiveTimestamp as timestamp, passiveBoolean,
  passiveDiagnosticCode, passivePercentage, passivePositiveInteger } from '../shared';

const list = <T>(parse: (value: unknown) => T) => passiveArray(parse, true);
const workspaceId = typed(createWorkspaceId);
const runId = typed(normalizeExecutionRunId);
const attemptId = typed(normalizeExecutionAttemptId);
const planId = typed(normalizeExecutionPlanId);
const runtimeId = typed(normalizeExecutionRuntimeReferenceId);
const provenance = record<ExecutionRunProvenanceEntry>({
  kind: passiveEnum(['execution-run-created','execution-run-approval-requested','execution-run-approved',
    'execution-run-approval-invalidated','execution-run-start-requested','execution-run-attempt-created',
    'execution-run-progress-recorded','execution-run-result-recorded','execution-run-succeeded',
    'execution-run-failed','execution-run-cancellation-requested','execution-run-cancelled',
    'execution-run-retry-requested','execution-run-marked-stale','execution-run-archived']),
  at: timestamp, actorId: optional(text), workspaceId: optional(workspaceId),
  executionRunId: optional(runId), executionAttemptId: optional(attemptId),
  executionResultId: optional(typed(normalizeExecutionResultId)),
});
export const normalizeExecutionDiagnostic = record<ExecutionDiagnostic>({
  code: passiveDiagnosticCode, message: text, severity: passiveEnum(['info','warning','error']),
  targetReferenceId: optional(text), targetReferenceKind: optional(text),
});
export const normalizeExecutionBlocker = record<ExecutionBlocker>({
  code: passiveDiagnosticCode, message: text, targetReferenceId: optional(text), targetReferenceKind: optional(text),
});
const diagnostics = list(normalizeExecutionDiagnostic);
const blockers = list(normalizeExecutionBlocker);
const progressSchema = record<ExecutionProgressSummary>({
  phase: typed(normalizeExecutionProgressPhase), label: text, summary: optional(text),
  percentage: optional(passivePercentage), at: timestamp, terminal: passiveBoolean,
});
export const normalizeExecutionProgressSummary = progressSchema;
export const normalizeExecutionRunRecord = record<ExecutionRunRecord>({
  id: runId, workspaceId, sourceExecutionPlanId: planId,
  sourceCompositionPlanId: optional(typed(normalizeAssetCompositionPlanId)),
  sourceRuntimeReadinessBindingId: optional(typed(normalizeRuntimeReadinessBindingId)),
  sourceContextKind: optional(passiveEnum<ExecutionRunSourceContextKind>(['conversation-turn','generic-context'])),
  sourceContextId: optional(text), status: typed(normalizeExecutionRunStatus),
  approvalId: optional(typed(normalizeExecutionApprovalId)), approvalStatus: optional(typed(normalizeExecutionApprovalStatus)),
  runtimeReferenceId: optional(runtimeId), attemptIds: list(attemptId), eventIds: list(typed(normalizeExecutionEventId)),
  resultIds: list(typed(normalizeExecutionResultId)), progress: optional(progressSchema), blockers, diagnostics,
  provenance: list(provenance), createdAt: timestamp, updatedAt: timestamp,
  startedAt: optional(timestamp), completedAt: optional(timestamp), cancelledAt: optional(timestamp), archivedAt: optional(timestamp),
});
export const normalizeExecutionAttemptRecord = record<ExecutionAttemptRecord>({
  id: attemptId, workspaceId, executionRunId: runId, attemptNumber: passivePositiveInteger,
  status: typed(normalizeExecutionAttemptStatus), runtimeReferenceId: runtimeId,
  progress: optional(progressSchema), resultId: optional(typed(normalizeExecutionResultId)),
  failureClassification: optional(typed(normalizeExecutionFailureClassification)),
  cancellationRequestId: optional(typed(normalizeExecutionCancellationRequestId)), blockers, diagnostics,
  provenance: list(provenance), createdAt: timestamp, updatedAt: timestamp, startedAt: optional(timestamp), completedAt: optional(timestamp),
});
export const normalizeExecutionEventRecord = record<ExecutionEventRecord>({
  id: typed(normalizeExecutionEventId), workspaceId, executionRunId: runId, executionAttemptId: optional(attemptId),
  conversationSessionId: optional(text), conversationTurnId: optional(text), kind: typed(normalizeExecutionEventKind),
  category: text, message: text, progress: optional(progressSchema), diagnostics, blockers, at: timestamp,
});
export const normalizeExecutionResultRecord = record<ExecutionResultRecord>({
  id: typed(normalizeExecutionResultId), workspaceId, executionRunId: runId, executionAttemptId: optional(attemptId),
  kind: typed(normalizeExecutionResultKind), status: typed(normalizeExecutionResultStatus),
  assistantResponseId: optional(text), outputReferenceId: optional(text), summary: optional(text), conversationTurnId: optional(text),
  blockers, diagnostics, provenance: list(provenance), createdAt: timestamp, completedAt: optional(timestamp),
});
export const normalizeExecutionApprovalRecord = record<ExecutionApprovalRecord>({
  id: typed(normalizeExecutionApprovalId), workspaceId, sourceExecutionPlanId: planId,
  conversationSessionId: optional(text), executionRunId: optional(runId),
  approvalKind: typed(normalizeExecutionApprovalKind), approvalStatus: typed(normalizeExecutionApprovalStatus),
  label: text, summary: optional(text), runtimeReferenceId: optional(runtimeId),
  sourcePlanRevision: optional(text), sourceReadinessRevision: optional(text), blockers, diagnostics, provenance: list(provenance),
  createdAt: timestamp, updatedAt: timestamp, grantedAt: optional(timestamp), revokedAt: optional(timestamp), invalidatedAt: optional(timestamp),
});
export const normalizeExecutionRuntimeReferenceRecord = record<ExecutionRuntimeReferenceRecord>({
  id: runtimeId, workspaceId, sourceExecutionPlanAdapterReferenceId: text,
  sourceRuntimeReadinessBindingId: typed(normalizeRuntimeReadinessBindingId), runtimeKind: text, capabilityKind: text,
  selectedModelRecordId: optional(typed(normalizeSystemBuilderModelRecordId)), status: typed(normalizeExecutionRuntimeReferenceStatus),
  label: text, summary: optional(text), blockers, diagnostics,
});
export const normalizeExecutionCancellationRequestRecord = record<ExecutionCancellationRequestRecord>({
  id: typed(normalizeExecutionCancellationRequestId), workspaceId, executionRunId: runId, executionAttemptId: optional(attemptId),
  status: typed(normalizeExecutionCancellationStatus), reasonCategory: optional(text), diagnostics, provenance: list(provenance),
  requestedAt: timestamp, acknowledgedAt: optional(timestamp), completedAt: optional(timestamp),
});
export const normalizeExecutionRetryRequestRecord = record<ExecutionRetryRequestRecord>({
  id: typed(normalizeExecutionRetryRequestId), workspaceId, originalExecutionRunId: runId,
  originalExecutionAttemptId: optional(attemptId), resultingExecutionRunId: optional(runId), resultingExecutionAttemptId: optional(attemptId),
  status: typed(normalizeExecutionRetryStatus), reasonCategory: optional(text), diagnostics, provenance: list(provenance),
  requestedAt: timestamp, completedAt: optional(timestamp), rejectedAt: optional(timestamp),
});
export const normalizeCreateExecutionRunCommand = record<Commands.CreateExecutionRunCommand>({
  workspaceId, sourceExecutionPlanId: planId, sourceCompositionPlanId: optional(typed(normalizeAssetCompositionPlanId)),
  sourceRuntimeReadinessBindingId: optional(typed(normalizeRuntimeReadinessBindingId)),
  conversationSessionId: optional(text), conversationTurnId: optional(text),
});
export const normalizeReadExecutionRunCommand = record<Commands.ReadExecutionRunCommand>({ workspaceId, executionRunId: runId });
export const normalizeListExecutionRunsCommand = record<Commands.ListExecutionRunsCommand>({ workspaceId });
export const normalizeApproveExecutionRunCommand = record<Commands.ApproveExecutionRunCommand>({ workspaceId, executionRunId: runId, approvalId: typed(normalizeExecutionApprovalId) });
export const normalizeValidateExecutionRunEligibilityCommand = normalizeReadExecutionRunCommand;
export const normalizeStartExecutionRunCommand = normalizeReadExecutionRunCommand;
export const normalizeArchiveExecutionRunCommand = normalizeReadExecutionRunCommand;
export const normalizeCancelExecutionRunCommand = record<Commands.CancelExecutionRunCommand>({ workspaceId, executionRunId: runId, reasonCategory: optional(text) });
export const normalizeRetryExecutionRunCommand = normalizeCancelExecutionRunCommand;
export const normalizeReadExecutionAttemptCommand = record<Commands.ReadExecutionAttemptCommand>({ workspaceId, executionAttemptId: attemptId });
export const normalizeListExecutionAttemptsCommand = record<Commands.ListExecutionAttemptsCommand>({ workspaceId, executionRunId: runId });
export const normalizeListExecutionEventsCommand = normalizeListExecutionAttemptsCommand;
export const normalizeReadExecutionResultCommand = record<Commands.ReadExecutionResultCommand>({ workspaceId, executionResultId: typed(normalizeExecutionResultId) });
