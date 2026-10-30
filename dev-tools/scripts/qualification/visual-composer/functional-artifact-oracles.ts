import {createHash} from "node:crypto";
import {types} from "node:util";
import {functionalHostIdentity,type FunctionalHost} from "./functional-host-oracles";

export const ARTIFACT_HOST_TIMEOUT_MS=180_000;
export const ARTIFACT_SAMPLE_NAME="qualification-inventory.json";
export const ARTIFACT_SAMPLE_TEXT='{"inventory":[{"item":"solar lantern","quantity":3},{"item":"water filter","quantity":2}]}\n';
export const ARTIFACT_SAMPLE_SHA256=createHash("sha256").update(ARTIFACT_SAMPLE_TEXT).digest("hex");
export const ARTIFACT_SAMPLE_BYTES=Buffer.byteLength(ARTIFACT_SAMPLE_TEXT);
export type ArtifactHostCase="local-lifecycle"|"publication-denial";
const invalid=()=>new Error("The artifact host observation is invalid.");
function object(value:unknown){
  if(!value||typeof value!=="object"||types.isProxy(value)||Array.isArray(value)||![Object.prototype,null].includes(Object.getPrototypeOf(value)))throw invalid();
  const fields=Object.getOwnPropertyDescriptors(value),result=Object.create(null) as Record<string,unknown>;
  if(Reflect.ownKeys(fields).length>16)throw invalid();
  for(const key of Reflect.ownKeys(fields)){if(typeof key!=="string"||!("value" in fields[key]))throw invalid();result[key]=fields[key]!.value;}
  return result;
}
export function artifactWorkspace(value:unknown):string{
  if(typeof value!=="string"||!/^workspace\.[A-Za-z0-9._:-]{1,160}$/.test(value))throw invalid();return value;
}
export function artifactKey(value:unknown):string{
  if(typeof value!=="string"||value.length<1||Buffer.byteLength(value)>1024||value.startsWith("/")||value.includes("\\")||/^[A-Za-z]:/.test(value)||/[\0-\x1f\x7f]/.test(value)||value.split("/").some(v=>v===""||v==="."||v===".."))throw invalid();return value;
}
/** The workspace field labels the real request, never an invented response field. */
export function captureLocalArtifactState(value:unknown,workspace:string,key:string){
  artifactWorkspace(workspace);artifactKey(key);const v=object(value);
  const keys=["requestedWorkspaceId","storageKey","originalName","sourceKind","sizeBytes","sha256","contentAvailable","hasImportedBacking","hasPublishedBacking"];
  if(Object.keys(v).length!==keys.length||keys.some(k=>!Object.prototype.hasOwnProperty.call(v,k))||v.requestedWorkspaceId!==workspace||v.storageKey!==key||v.originalName!==ARTIFACT_SAMPLE_NAME||v.sourceKind!=="upload"||v.sizeBytes!==ARTIFACT_SAMPLE_BYTES||v.sha256!==ARTIFACT_SAMPLE_SHA256||v.contentAvailable!==true||v.hasImportedBacking!==false||v.hasPublishedBacking!==false)throw invalid();
  return Object.freeze({requestedWorkspaceId:workspace,storageKey:key,sizeBytes:ARTIFACT_SAMPLE_BYTES,sha256:ARTIFACT_SAMPLE_SHA256});
}
export function artifactHostPhases(host:FunctionalHost,scenario:ArtifactHostCase):readonly string[]{
  if(scenario==="publication-denial"){
    if(host!=="thin-chrome")throw invalid();
    return Object.freeze(["owned-artifact-imported","readonly-authenticated","publication-forbidden","local-artifact-unchanged","reload-keeps-artifact"]);
  }
  if(scenario!=="local-lifecycle"||host!=="packaged-desktop"&&host!=="thin-chrome")throw invalid();
  return Object.freeze(["owned-artifact-imported","local-readback-confirmed","reload-confirmed",...(host==="packaged-desktop"?["export-bytes-confirmed"]:[]),"second-workspace-owned","cross-workspace-read-denied","second-artifact-imported","cancel-preserves-artifact","typed-confirmation-required","local-deletion-confirmed","reload-keeps-deletion","second-workspace-retained"]);
}
export function artifactHostReport(run:unknown,source:unknown,host:unknown,scenario:unknown,phases:unknown,failed:unknown){
  const identity=functionalHostIdentity(run,source,host);
  if(scenario!=="local-lifecycle"&&scenario!=="publication-denial")throw invalid();
  const expected=artifactHostPhases(identity.host,scenario);
  if(typeof failed!=="boolean"||types.isProxy(phases)||!Array.isArray(phases)||Object.getPrototypeOf(phases)!==Array.prototype||phases.length>expected.length)throw invalid();
  const fields=Object.getOwnPropertyDescriptors(phases),captured:string[]=[];if(Reflect.ownKeys(fields).length!==phases.length+1)throw invalid();
  for(let i=0;i<phases.length;i++){const field=fields[String(i)];if(!field||!("value" in field)||field.value!==expected[i])throw invalid();captured.push(field.value);}
  return {schemaVersion:"functional-local-artifact-host-v1",...identity,scenario,status:!failed&&captured.length===expected.length?"passed":"failed",phases:captured,nextPhase:expected[captured.length]??"complete",parentQualificationGranted:false,providerOperationsQualified:false,modelQualityQualified:false,physicalSharedObjectOwnershipQualified:false,
    scope:"Local synthetic artifact UI and explicit LAN route denial only. Workspace separation does not qualify physical shared-file ownership, private publication, native workers, TLS, managed provider-use policy or parent completion. Accepted model accuracy stays closed."};
}
