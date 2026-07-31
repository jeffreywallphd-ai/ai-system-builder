import { describe, expect, it } from '../../../testing/node-test';
import { normalizeExecutionRunId, normalizeExecutionAttemptId, normalizeExecutionRunStatus, normalizeExecutionAttemptStatus, normalizeExecutionApprovalStatus, normalizeExecutionRuntimeReferenceStatus, normalizeExecutionCancellationStatus, normalizeExecutionRetryStatus, normalizeExecutionRunRecord } from '..';

describe('execution-run contracts',()=>{
 it('normalizes ids and statuses',()=>{expect(normalizeExecutionRunId('run-1')).toBe('run-1'); expect(normalizeExecutionAttemptId('att-1')).toBe('att-1'); expect(normalizeExecutionRunStatus('running')).toBe('running'); expect(normalizeExecutionAttemptStatus('started')).toBe('started'); expect(normalizeExecutionApprovalStatus('granted')).toBe('granted'); expect(normalizeExecutionRuntimeReferenceStatus('supported')).toBe('supported'); expect(normalizeExecutionCancellationStatus('requested')).toBe('requested'); expect(normalizeExecutionRetryStatus('accepted')).toBe('accepted');});
 it('rejects unsafe ids',()=>{expect(()=>normalizeExecutionRunId(' ../x ')).toThrow('ExecutionRunId must be a safe non-empty identifier.'); expect(()=>normalizeExecutionRunId('https://x')).toThrow('ExecutionRunId must be a safe non-empty identifier.');});
 it('normalizes run record and rejects unsafe metadata payload patterns',()=>{expect(()=>normalizeExecutionRunRecord({id:'run-1',workspaceId:'ws-1',sourceExecutionPlanId:'plan-1',status:'running',attemptIds:[],eventIds:[],resultIds:[],createdAt:'2026-01-01T00:00:00.000Z',updatedAt:'2026-01-01T00:00:00.000Z'})).not.toThrow();});
});
