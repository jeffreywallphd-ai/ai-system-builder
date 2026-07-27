import type { ConversationTurnInvocationPort, ConversationalInvocationContextPort, ConversationalInvocationRuntimeReference } from '../../ports/conversational-execution';
import { ConversationSessionApprovalValidityService } from '../../use-cases/conversations';
import { ConversationalInvocationContextValidationService } from './conversational-invocation-context-validation.service';
import { ConversationalRuntimeAdapterSelectionService } from './conversational-runtime-adapter-selection.service';
import { ConversationalRuntimeGuardService } from './conversational-runtime-guard.service';
<<<<<<< ours
import type { ConversationSessionRecord } from '../../../contracts/conversations';
import type { ExecutionApprovalRecord } from '../../../contracts/execution-runs';
=======
>>>>>>> theirs

export class ConversationTurnInvocationOrchestratorService {
  public constructor(private readonly d:{approvalValidityService:ConversationSessionApprovalValidityService;adapterSelectionService:ConversationalRuntimeAdapterSelectionService;runtimeGuardService:ConversationalRuntimeGuardService;contextPort:ConversationalInvocationContextPort;contextValidationService:ConversationalInvocationContextValidationService;invocationPort:ConversationTurnInvocationPort}){}

<<<<<<< ours
  public async invoke(input:{workspaceId:string;session:ConversationSessionRecord;approval?:ExecutionApprovalRecord;runtime:ConversationalInvocationRuntimeReference;userTurnContent:string}) {
    if (!input.workspaceId) return { status: 'invalid-request' } as const;
    const validity = await this.d.approvalValidityService.isValidForInvocation(input.session, input.approval);
=======
  public async invoke(input:{workspaceId:string;session:{id:string;status:string;executionApprovalId?:string;sourceExecutionPlanId?:string};approval?:{approvalStatus:string;invalidatedAt?:string|null};runtime:ConversationalInvocationRuntimeReference;userTurnContent:string}) {
    if (!input.workspaceId) return { status: 'invalid-request' } as const;
    const validity = this.d.approvalValidityService.isValid(input.session as any, input.approval as any);
>>>>>>> theirs
    if (!validity.valid) return { status: validity.reason } as const;
    if (['stale','blocked','invalid','archived','closed'].includes(input.session.status)) return { status: 'session-not-eligible' } as const;
    const selection = await this.d.adapterSelectionService.select(input.runtime);
    if (selection.status !== 'supported') return { status: selection.status } as const;
    const guard = await this.d.runtimeGuardService.canInvoke(selection.adapterId);
    if (!guard.allowed) return { status: guard.status } as const;
    const context = await this.d.contextPort.prepareProtectedInvocationContext({ workspaceId: input.workspaceId, conversationSessionId: input.session.id, runtime: input.runtime, userTurnContent: input.userTurnContent });
    const cv = this.d.contextValidationService.validate(context);
    if (!cv.valid) return { status: 'invalid-invocation-context', reason: cv.reason } as const;
    const outcome = await this.d.invocationPort.invokeConversationTurn({ workspaceId: input.workspaceId, conversationSessionId: input.session.id, runtime: input.runtime, context });
    if (outcome.status === 'completed') return { status: 'completed', assistantResponseText: outcome.assistantResponseText } as const;
    return { status: outcome.status } as const;
  }
}
