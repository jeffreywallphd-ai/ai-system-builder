import type { ExecutionFailureClassification } from '../../../contracts/execution-runs';

export class ConversationTurnFailureClassificationService {
  public classify(status: string): ExecutionFailureClassification {
    if (status === 'approval-required') return 'approval-required';
    if (status === 'approval-invalidated') return 'approval-invalidated';
    if (status === 'not-ready') return 'runtime-not-ready';
    if (status === 'unavailable') return 'runtime-unavailable';
    if (status === 'unsupported' || status === 'deferred') return 'runtime-unsupported';
    if (status === 'timed-out') return 'invocation-timed-out';
    if (status === 'cancelled') return 'invocation-cancelled';
    if (status === 'blocked') return 'runtime-readiness-not-acceptable';
    if (status === 'failed') return 'invocation-failed';
    return 'internal-error';
  }
}
