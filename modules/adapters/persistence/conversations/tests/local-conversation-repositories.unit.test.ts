import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createWorkspaceId } from '../../../../contracts/workspace';
import { normalizeConversationMessageId, normalizeConversationSessionId, normalizeConversationTurnId } from '../../../../contracts/conversations';
import { createLocalConversationRepositoryAdapters } from '../index';

const now='2026-01-01T00:00:00.000Z';
const wsA=createWorkspaceId('ws-a'); const wsB=createWorkspaceId('ws-b');
const sid=normalizeConversationSessionId('session-1'); const tid=normalizeConversationTurnId('turn-1'); const mid=normalizeConversationMessageId('message-1');
async function setup(){const root=await mkdtemp(join(tmpdir(),'conv-')); return {root,a:createLocalConversationRepositoryAdapters({rootDir:root,now:()=>now})};}

test('persists valid plain-text message and preserves workspace isolation', async()=>{const {a}=await setup();
  await a.conversationMessageRepository.saveConversationMessage({id:mid,workspaceId:wsA,conversationSessionId:sid,conversationTurnId:tid,role:'user',contentKind:'plain-text',text:'path command token API JSON workflow prompt environment variable code',createdAt:now});
  await a.conversationMessageRepository.saveConversationMessage({id:mid,workspaceId:wsB,conversationSessionId:sid,conversationTurnId:tid,role:'user',contentKind:'plain-text',text:'other',createdAt:now});
  assert.equal((await a.conversationMessageRepository.listConversationMessagesBySession(wsA,sid)).length,1);
  assert.equal((await a.conversationMessageRepository.getConversationMessageById(wsB,mid))?.text,'other');
});

test('malformed JSON and manifest mismatch are rejected', async()=>{const {root,a}=await setup();
  const dir=join(root,'conversations');
  await mkdir(dir,{recursive:true});
  await writeFile(join(dir,'conversations-manifest.json'),'{"schemaVersion":2,"storeKind":"conversations-local-store"}');
  await assert.rejects(()=>a.conversationSessionRepository.listConversationSessions({workspaceId:wsA}));
  await writeFile(join(dir,'conversations-manifest.json'),'{"schemaVersion":1,"storeKind":"conversations-local-store"}');
  await writeFile(join(dir,'conversation-sessions.json'),'{not-json');
  await assert.rejects(()=>a.conversationSessionRepository.listConversationSessions({workspaceId:wsA}));
});
