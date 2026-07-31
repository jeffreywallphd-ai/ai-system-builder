import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { validateAssetDefinition } from '../../asset/validate-asset-definition.service';
import { CONVERSATION_ASSET_DEFINITIONS, CONVERSATION_ASSET_ENTRIES, SYSTEM_FOUNDATION_PACK_MANIFEST } from '../system-packs';

describe('conversational reusable assets', () => {
  it('defines required conversation assets and starter system', () => {
    const ids = CONVERSATION_ASSET_DEFINITIONS.map((d) => String(d.definitionId));
    for (const required of [
      'conversation.user-message-input','conversation.assistant-text-response-output','conversation.history-reference','conversation.message-composer','conversation.message-history-display','conversation.assistant-response-panel','conversation.chat-shell','conversation.session-behavior','conversation.turn-behavior','conversation.assistant-response-generation-behavior','conversation.history-context-behavior','conversation.text-generation-runtime-requirement','conversation.basic-assistant-system']) {
      assert.equal(ids.includes(required), true, required);
    }
  });

  it('preserves lineage and excludes runtime/provider payloads', () => {
    const serialized = JSON.stringify(CONVERSATION_ASSET_DEFINITIONS).toLowerCase();
    for (const def of CONVERSATION_ASSET_DEFINITIONS) {
      assert.equal(validateAssetDefinition(def).status, 'valid', String(def.definitionId));
      const deps = def.metadata?.dependencyDefinitionIds as readonly string[] | undefined;
      assert.ok((deps?.length ?? 0) >= 1, String(def.definitionId));
    }
    for (const forbidden of ['apikey','secret','credential','provider','endpoint','workflowjson','prompttext','execution run','conversation session id']) {
      assert.equal(serialized.includes(forbidden), false, forbidden);
    }
  });

  it('includes starter-system lineage chains and manifest discoverability', () => {
    const byId = new Map(CONVERSATION_ASSET_DEFINITIONS.map((d) => [String(d.definitionId), d]));
    const starterDeps = byId.get('conversation.basic-assistant-system')?.metadata?.dependencyDefinitionIds as readonly string[];
    assert.ok(starterDeps.includes('conversation.chat-shell'));
    assert.ok(starterDeps.includes('conversation.text-generation-runtime-requirement'));
    const composerDeps = byId.get('conversation.message-composer')?.metadata?.dependencyDefinitionIds as readonly string[];
    assert.ok(composerDeps.includes('builtin.form.text-area'));
    assert.ok(composerDeps.includes('builtin.form.submit-action'));
    const panelDeps = byId.get('conversation.assistant-response-panel')?.metadata?.dependencyDefinitionIds as readonly string[];
    assert.ok(panelDeps.includes('builtin.display.detail-view'));
    assert.ok(panelDeps.includes('builtin.state.loading-state'));
    assert.ok(panelDeps.includes('builtin.state.error-state'));
    for (const entry of CONVERSATION_ASSET_ENTRIES) {
      assert.equal(SYSTEM_FOUNDATION_PACK_MANIFEST.assets.includes(entry), true, entry.entryId);
      assert.equal(entry.category, 'conversational-systems');
    }
  });
});
