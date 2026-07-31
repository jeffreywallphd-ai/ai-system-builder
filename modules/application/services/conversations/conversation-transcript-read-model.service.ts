import type { ConversationTurnRepositoryPort, ConversationMessageRepositoryPort, AssistantResponseRepositoryPort } from '../../ports/conversations';
import { createWorkspaceId } from '../../../contracts/workspace';
import type { ConversationTranscriptReadModel } from './conversation-read-model-types';

export class ConversationTranscriptReadModelService {
  constructor(private readonly turns:ConversationTurnRepositoryPort, private readonly messages:ConversationMessageRepositoryPort, private readonly responses:AssistantResponseRepositoryPort){}
  async readTranscript(request:{workspaceId:string; conversationSessionId:string}):Promise<ConversationTranscriptReadModel>{
    if(!request.workspaceId) return {ok:false,code:'workspace-required',message:'Workspace is required.'};
    const ws=createWorkspaceId(request.workspaceId); const turns=await this.turns.listConversationTurnsBySession(ws,request.conversationSessionId as any);
    const ordered=[...turns].sort((a,b)=>a.sequence-b.sequence);
    const projected=[];
    for(const t of ordered){ const msgs=await this.messages.listConversationMessagesByTurn(ws,t.id); const user=msgs.find((m)=>m.role==='user'); const responses=await this.responses.listAssistantResponsesByTurn(ws,t.id); const assistant=responses.find((r)=>r.status==='completed'); const degraded=t.status==='succeeded'&&!assistant?{code:'response-unavailable' as const,message:'Response unavailable.'}:undefined; projected.push({turnId:t.id,sequence:t.sequence,turnStatus:t.status,createdAt:t.createdAt,updatedAt:t.updatedAt,completedAt:t.completedAt,activityState:t.status,userMessage:user?{id:user.id,role:'user' as const,text:user.text,createdAt:user.createdAt}:undefined,assistantResponse:assistant?{id:assistant.id,role:'assistant' as const,text:assistant.text,createdAt:assistant.createdAt,completedAt:assistant.completedAt,status:assistant.status}:undefined,executionRunId:t.executionRunId,degraded}); }
    return {ok:true,turns:projected};
  }
}
