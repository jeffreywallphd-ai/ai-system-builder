import type { ConversationMessageId, ConversationSessionId, ConversationTurnId } from './conversation-identity'; import type { ConversationContentKind, ConversationMessageRole } from './conversation-status';
export const MAX_USER_MESSAGE_LENGTH=16000; export const MAX_ASSISTANT_RESPONSE_LENGTH=24000;
export type ConversationMessageRecord={id:ConversationMessageId;workspaceId:string;conversationSessionId:ConversationSessionId;conversationTurnId:ConversationTurnId;role:ConversationMessageRole;contentKind:ConversationContentKind;text:string;createdAt:string};
