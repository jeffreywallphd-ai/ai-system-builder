import type { ConversationFailure, ConversationFailureKind } from '../../../contracts/conversations';

export const conversationSessionFailure = (
  failureKind: ConversationFailureKind,
  code: string,
  message: string
): ConversationFailure => ({ kind: 'failure', failureKind, diagnostics: [{ code, message }] });
