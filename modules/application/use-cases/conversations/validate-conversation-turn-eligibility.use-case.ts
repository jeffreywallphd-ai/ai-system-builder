import { normalizeReadConversationSessionCommand } from '../../../contracts/conversations';
import type { ConversationSessionRepositoryPort } from '../../ports/conversations';
import type { ExecutionApprovalRepositoryPort } from '../../ports/execution-runs';
import { ConversationSessionApprovalValidityService } from './conversation-session-approval-validity.service';

export class ValidateConversationTurnEligibilityUseCase {
  public constructor(private readonly d:{sessionRepository:ConversationSessionRepositoryPort;approvalRepository:ExecutionApprovalRepositoryPort;approvalValidityService:ConversationSessionApprovalValidityService}){}
  public async execute(command:{workspaceId:string;conversationSessionId:string}){
    const c=normalizeReadConversationSessionCommand(command);
    const session=await this.d.sessionRepository.getConversationSessionById(c.workspaceId as never,c.conversationSessionId as never); if(!session) return {eligible:false,reason:'session-not-found',invocation:'deferred'};
    if (['closed','archived','stale','invalid','blocked'].includes(session.status)) return {eligible:false,reason:'session-not-eligible',invocation:'deferred'};
    const approval = session.executionApprovalId ? await this.d.approvalRepository.getExecutionApprovalById(c.workspaceId as never, session.executionApprovalId) : undefined;
    const validity=await this.d.approvalValidityService.isValidForInvocation(session,approval); if(!validity.valid) return {eligible:false,reason:validity.reason,invocation:'deferred'};
    return {eligible:true,reason:'session-approved-prerequisites-pass',invocation:'ready'};
  }
}
