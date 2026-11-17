import {types} from "node:util";

export type FunctionalHost="packaged-desktop"|"thin-chrome";
export const FUNCTIONAL_HOST_TIMEOUT_MS=120_000;
export const FUNCTIONAL_REFERENCE_MODEL="Qwen/Qwen2.5-0.5B-Instruct";
export const MODEL_REFERENCE_PHASES=Object.freeze([
  "workspace-opened","inventory-empty","search-complete","metadata-confirmed",
  "reference-saved","details-confirmed","reload-confirmed","isolation-confirmed","original-workspace-confirmed",
]);
const invalid=()=>new Error("The functional host observation is invalid.");
export function functionalHostIdentity(run:unknown,source:unknown,host:unknown){
  if(typeof run!=="string"||!/^[a-z0-9-]{20,80}$/.test(run)||typeof source!=="string"||!/^source\.[a-f0-9]{64}$/.test(source)||host!=="packaged-desktop"&&host!=="thin-chrome")throw invalid();
  return Object.freeze({runId:run,sourceRevision:source,host});
}
function ownObject(value:unknown):Record<string,unknown>{
  if(!value||typeof value!=="object"||types.isProxy(value)||Array.isArray(value)||![Object.prototype,null].includes(Object.getPrototypeOf(value)))throw invalid();
  const fields=Object.getOwnPropertyDescriptors(value),keys=Reflect.ownKeys(fields);
  if(keys.length>16||keys.some(k=>typeof k!=="string"||!("value" in fields[k])))throw invalid();
  const result=Object.create(null) as Record<string,unknown>;
  for(const key of keys){if(typeof key!=="string")throw invalid();result[key]=fields[key]!.value;}
  return result;
}
/** Capture only the small projection supplied by the real read-only host operation. */
export function captureModelReferenceInventory(value:unknown,workspace:unknown){
  if(typeof workspace!=="string"||!/^workspace\.[A-Za-z0-9._:-]{1,160}$/.test(workspace))throw invalid();
  if(types.isProxy(value)||!Array.isArray(value)||Object.getPrototypeOf(value)!==Array.prototype||value.length>20)throw invalid();
  const fields=Object.getOwnPropertyDescriptors(value);
  if(Reflect.ownKeys(fields).length!==value.length+1)throw invalid();
  const seen=new Set<string>(),captured=[];
  for(let i=0;i<value.length;i++){
    const field=fields[String(i)];if(!field||!("value" in field))throw invalid();
    const row=ownObject(field.value),keys=["modelRecordId","modelId","workspaceId","provider","source","lifecycleStatus","artifactForm","localFilesAvailable"];
    if(Object.keys(row).length!==keys.length||keys.some(k=>!Object.prototype.hasOwnProperty.call(row,k))||typeof row.modelRecordId!=="string"||!(/^[A-Za-z0-9._:-]{1,160}$/).test(row.modelRecordId)||seen.has(row.modelRecordId)||row.workspaceId!==workspace||row.modelId!==FUNCTIONAL_REFERENCE_MODEL||row.provider!=="huggingface"||row.source!=="huggingface"||row.lifecycleStatus!=="saved-reference"||row.artifactForm!=="full-model"||row.localFilesAvailable!==false)throw invalid();
    seen.add(row.modelRecordId);captured.push(Object.freeze({...row,modelRecordId:row.modelRecordId}));
  }
  return Object.freeze(captured);
}
/** Ordered completed assertions only; source construction is not qualification. */
export function modelReferenceHostReport(run:unknown,source:unknown,host:unknown,phases:unknown,failed:unknown){
  const identity=functionalHostIdentity(run,source,host);
  if(typeof failed!=="boolean"||types.isProxy(phases)||!Array.isArray(phases)||Object.getPrototypeOf(phases)!==Array.prototype||phases.length>MODEL_REFERENCE_PHASES.length)throw invalid();
  const fields=Object.getOwnPropertyDescriptors(phases),captured:string[]=[];
  if(Reflect.ownKeys(fields).length!==phases.length+1)throw invalid();
  for(let i=0;i<phases.length;i++){const f=fields[String(i)];if(!f||!("value" in f)||f.value!==MODEL_REFERENCE_PHASES[i])throw invalid();captured.push(f.value);}
  return {schemaVersion:"functional-model-reference-host-v1",...identity,status:!failed&&captured.length===MODEL_REFERENCE_PHASES.length?"passed":"failed",phases:captured,nextPhase:MODEL_REFERENCE_PHASES[captured.length]??"complete",parentQualificationGranted:false,modelLoadingQualified:false,modelQualityQualified:false,weightDownloadPerformed:false,
    scope:"Model metadata search and saved-reference UI only. No weights, inference, accuracy, private-provider publication, complete worker retirement or parent qualification."};
}
