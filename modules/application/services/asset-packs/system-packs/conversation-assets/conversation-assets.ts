import type { AssetAiContext, AssetDefinition, AssetPackAssetEntry } from '../../../../../contracts/asset';
import { SYSTEM_FOUNDATION_PACK_ID, SYSTEM_FOUNDATION_PACK_SOURCE_LAYER, SYSTEM_FOUNDATION_PACK_VERSION } from '../system-foundation-pack.constants';

const V='1.0.0';
const ids = {
  userInput:'conversation.user-message-input', assistantOutput:'conversation.assistant-text-response-output', historyRef:'conversation.history-reference',
  composer:'conversation.message-composer', historyDisplay:'conversation.message-history-display', responsePanel:'conversation.assistant-response-panel', chatShell:'conversation.chat-shell',
  sessionBehavior:'conversation.session-behavior', turnBehavior:'conversation.turn-behavior', responseGenBehavior:'conversation.assistant-response-generation-behavior', historyCtxBehavior:'conversation.history-context-behavior',
  runtimeReq:'conversation.text-generation-runtime-requirement', starter:'conversation.basic-assistant-system',
} as const;

function def(definitionId:string, assetType:AssetDefinition['assetType'], assetFamily:AssetDefinition['assetFamily'], displayName:string, description:string, deps:string[], categoryId='conversational-systems'): AssetDefinition {
  return { definitionId, assetType, assetFamily, version:V, displayName, description, lifecycleStatus:'published', reviewStatus:'approved',
    provenance:{sourceKind:'system-generated', authorship:'human-authored', metadata:{sourcePackId:SYSTEM_FOUNDATION_PACK_ID,sourcePackVersion:SYSTEM_FOUNDATION_PACK_VERSION,categoryId,sourceLayer:SYSTEM_FOUNDATION_PACK_SOURCE_LAYER}},
    configurationSchema:{schemaId:`${definitionId}.configuration`,schemaVersion:V,strict:true,fields:[],requiredFieldIds:[],description:`${displayName} semantic definition.`,metadata:{declarativeOnly:true,categoryId}},
    aiContext:createAiContext(definitionId, displayName, description, deps),
    defaultConfiguration:{}, requirements:[{requirementId:`${definitionId}.declarative`,requirementKind:'custom',required:false,safetyStatus:'safe',summary:'Declarative asset-only definition.',details:{declarativeOnly:true}}],
    compositionRules:[{ruleId:`${definitionId}.dependencies`,ruleKind:'custom',description:'Preserves dependency lineage to referenced foundation and conversational assets.',metadata:{dependencyDefinitionIds:deps}}],
    metadata:{builtIn:true,systemOwned:true,declarativeOnly:true,categoryId,sourcePackId:SYSTEM_FOUNDATION_PACK_ID,sourcePackVersion:SYSTEM_FOUNDATION_PACK_VERSION,sourceLayer:SYSTEM_FOUNDATION_PACK_SOURCE_LAYER,dependencyDefinitionIds:deps}
  };
}

function createAiContext(definitionId:string, displayName:string, description:string, deps:string[]): AssetAiContext {
  return {
    purpose:description,
    userFacingSummary:`${displayName} describes one reusable part of a conversational assistant experience.`,
    developerFacingSummary:`${displayName} is a declarative conversation-system asset for composition planning; it is catalog meaning, not executable behavior.`,
    capabilities:[
      {capabilityId:`${definitionId}.capability.semantic-role`,summary:'Declares a safe semantic role for conversational system composition.'},
      {capabilityId:`${definitionId}.capability.lineage`,summary:'Preserves dependency lineage to the referenced foundation and conversation assets.'},
    ],
    limitations:[
      {limitationId:`${definitionId}.limitation.declarative-only`,summary:'Does not perform work, store messages, or create generated text.'},
      {limitationId:`${definitionId}.limitation.no-implementation`,summary:'Does not define screen code, route handlers, saved records, or adapter details.'},
    ],
    inputSummary:{summary:deps.length ? 'Uses referenced semantic foundation assets as composition inputs.' : 'No required composition inputs are declared.'},
    outputSummary:{summary:'Produces only catalog metadata for later planning and review.'},
    configurationGuidance:{summary:'No user-editable settings are defined by this foundation asset.',recommendedDefaults:{},commonMistakes:['Keep concrete service setup, message text, and executable details outside the catalog definition.']},
    compositionGuidance:{summary:'Use this asset as a safe reusable building block when composing conversational systems from foundation assets.',bindingGuidance:'References identify semantic dependencies only; invocation details remain outside system foundation definitions.'},
    safetyNotes:[{safetyNoteId:`${definitionId}.safety.declarative-only`,category:'thin-client',severity:'info',summary:'Safe for thin-client display because it contains descriptors and dependency references only.'}],
  };
}

const foundation = {
  textInput:'builtin.form.text-area', submit:'builtin.form.submit-action', list:'builtin.display.list', container:'builtin.ui.container', stack:'builtin.ui.stack',
  detail:'builtin.display.detail-view', loading:'builtin.state.loading-state', error:'builtin.state.error-state', status:'builtin.display.status-badge',
  system:'builtin.system.system', subsystem:'builtin.system.subsystem'
} as const;

export const CONVERSATION_ASSET_DEFINITIONS: readonly AssetDefinition[] = [
  def(ids.userInput,'schema','structural','Conversation User Message Input','Bounded one-turn user text input contract.',[foundation.textInput]),
  def(ids.assistantOutput,'schema','structural','Conversation Assistant Text Response Output','Bounded assistant text output contract.',[foundation.detail]),
  def(ids.historyRef,'schema','structural','Conversation History Reference','Ordered conversational history reference contract.',[foundation.list]),
  def(ids.composer,'ui-component','composition','Conversation Message Composer','Composed message composer using foundational text input and submit semantics.',[ids.userInput,foundation.textInput,foundation.submit,foundation.status]),
  def(ids.historyDisplay,'ui-component','composition','Conversation Message History Display','Composed conversational history display using foundational list/container semantics.',[ids.historyRef,foundation.list,foundation.container]),
  def(ids.responsePanel,'ui-component','composition','Conversation Assistant Response Panel','Composed assistant response panel with text display and loading/error/status semantics.',[ids.assistantOutput,foundation.detail,foundation.loading,foundation.error,foundation.status]),
  def(ids.chatShell,'feature','composition','Conversation Chat Shell','Composed conversational shell that arranges history display, response panel, and message composer.',[ids.historyDisplay,ids.responsePanel,ids.composer,foundation.stack,foundation.container]),
  def(ids.sessionBehavior,'workflow-step','behavioral','Conversation Session Behavior','Declarative session-level turn and history relationship semantics.',[ids.turnBehavior,ids.historyCtxBehavior]),
  def(ids.turnBehavior,'workflow-step','behavioral','Conversation Turn Behavior','Declarative one-turn user-input to assistant-response interaction semantics.',[ids.userInput,ids.assistantOutput]),
  def(ids.runtimeReq,'runtime-binding','context','Conversation Text Generation Runtime Requirement','Requires supported text-generation runtime capability only.',[foundation.subsystem]),
  def(ids.responseGenBehavior,'workflow-step','behavioral','Conversation Assistant Response Generation Behavior','Declarative behavior that depends on text-generation runtime capability.',[ids.runtimeReq]),
  def(ids.historyCtxBehavior,'workflow-step','behavioral','Conversation History Context Behavior','Declarative behavior that maps prior history to response-generation context.',[ids.historyRef]),
  def(ids.starter,'system','composition','Conversation Basic Assistant System','Reusable starter conversational assistant system composed from conversation assets and foundation shell semantics.',[ids.chatShell,ids.sessionBehavior,ids.turnBehavior,ids.responseGenBehavior,ids.historyCtxBehavior,ids.userInput,ids.assistantOutput,ids.historyRef,ids.runtimeReq,foundation.system]),
];

export const CONVERSATION_ASSET_ENTRIES: readonly AssetPackAssetEntry[] = CONVERSATION_ASSET_DEFINITIONS.map((definition)=>({
  entryId:`system.foundation.${String(definition.definitionId).replace(/\./g,'-')}`,
  definition,
  definitionRef:{kind:'asset-definition-version',id:String(definition.definitionId) as never,version:definition.version,label:definition.displayName},
  category:'conversational-systems',sourceLayer:SYSTEM_FOUNDATION_PACK_SOURCE_LAYER,fingerprint:`fnv1a:${Math.abs(String(definition.definitionId).split('').reduce((a,c)=>((a<<5)-a+c.charCodeAt(0))|0,0)).toString(16).padStart(8,'0').slice(0,8)}`,
  tags:['foundation','conversational-systems','conversation','reusable'],
  metadata:{sourcePack:{packId:SYSTEM_FOUNDATION_PACK_ID,version:SYSTEM_FOUNDATION_PACK_VERSION},categoryId:'conversational-systems',sourceLayer:SYSTEM_FOUNDATION_PACK_SOURCE_LAYER,builtIn:true,systemOwned:true,declarativeOnly:true,derivedComposite:true,lineage:'foundation-referenced'}
}));
