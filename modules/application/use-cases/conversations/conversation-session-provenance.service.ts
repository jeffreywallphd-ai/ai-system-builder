import type { ConversationProvenanceEntry } from '../../../contracts/conversations';

export const createConversationSessionProvenance = (
  kind: ConversationProvenanceEntry['kind'],
  at: string,
  actor = 'application'
): ConversationProvenanceEntry => ({ at, kind, actorId: actor });
