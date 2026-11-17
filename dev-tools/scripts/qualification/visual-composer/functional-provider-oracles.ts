import {types} from "node:util";
import {artifactKey,artifactWorkspace,ARTIFACT_SAMPLE_NAME,ARTIFACT_SAMPLE_BYTES,ARTIFACT_SAMPLE_SHA256} from "./functional-artifact-oracles";
import {functionalHostIdentity,type FunctionalHost} from "./functional-host-oracles";
import {FUNCTIONAL_PROVIDER_REPOSITORY,providerImmutableRevision,providerPublicationPath,type ProviderSourceFile} from "./functional-provider-plan.mjs";
const bad=()=>new Error("The provider host observation is invalid.");
function record(value:unknown){
  if(!value||typeof value!=="object"||types.isProxy(value)||Array.isArray(value)||![Object.prototype,null].includes(Object.getPrototypeOf(value)))throw bad();
  const fields=Object.getOwnPropertyDescriptors(value),keys=Reflect.ownKeys(fields);if(keys.length>12||keys.some(k=>typeof k!=="string"))throw bad();
  const result=Object.create(null) as Record<string,unknown>;for(const key of keys as string[]){if(!("value" in fields[key]!))throw bad();result[key]=fields[key]!.value;}return result;
}
function exact(value:Record<string,unknown>,keys:string[]){if(Object.keys(value).sort().join("|")!==keys.slice().sort().join("|"))throw bad();}
export function captureProviderBacking(value:unknown,workspace:string,key:string,expected:ProviderSourceFile|{publicationRun:string},local:boolean){
  artifactWorkspace(workspace);artifactKey(key);const v=record(value);exact(v,["requestedWorkspaceId","storageKey","originalName","sourceKind","contentAvailable","importedSourceBacking","publishedBacking"]);
  if(v.requestedWorkspaceId!==workspace||v.storageKey!==key||v.sourceKind!=="upload"||v.contentAvailable!==local)throw bad();
  const publication="publicationRun" in expected,backing=record(publication?v.publishedBacking:v.importedSourceBacking);exact(backing,["provider","repository","path","revision","exists"]);
  if(backing.provider!=="huggingface"||backing.repository!==FUNCTIONAL_PROVIDER_REPOSITORY||backing.exists!==true)throw bad();
  if(publication){if(v.originalName!==ARTIFACT_SAMPLE_NAME||backing.path!==providerPublicationPath(expected.publicationRun)||backing.revision!=="main"||v.importedSourceBacking!==null)throw bad();}
  else if(v.originalName!==expected.path||backing.path!==expected.path||backing.revision!==providerImmutableRevision(expected.revision)||v.publishedBacking!==null)throw bad();
  return Object.freeze({workspaceId:workspace,storageKey:key,local,role:publication?"published":"imported-source",revisionKind:publication?"branch":"immutable"});
}
export function captureProviderBytes(value:unknown,workspace:string,key:string,expected:Pick<ProviderSourceFile,"size_bytes"|"sha256">|"local-inventory"){
  artifactWorkspace(workspace);artifactKey(key);const v=record(value);exact(v,["requestedWorkspaceId","storageKey","sizeBytes","sha256"]);
  const declaration=expected==="local-inventory"?{size_bytes:ARTIFACT_SAMPLE_BYTES,sha256:ARTIFACT_SAMPLE_SHA256}:record(expected),bytes=declaration.size_bytes,hash=declaration.sha256;
  if(!Number.isInteger(bytes)||(bytes as number)<1||(bytes as number)>4096||typeof hash!=="string"||!/^[a-f0-9]{64}$/.test(hash))throw bad();
  if(v.requestedWorkspaceId!==workspace||v.storageKey!==key||v.sizeBytes!==bytes||v.sha256!==hash)throw bad();return Object.freeze({workspaceId:workspace,storageKey:key,bytesVerified:true});
}
export type ProviderHostCase="provider-source"|"provider-publication";
export function capturePrivatePublicationWitness(value:unknown){
  const v=record(value);exact(v,["privateVerified","remoteRevision","sizeBytes","sha256","localBackingRevisionKind"]);
  if(v.privateVerified!==true||v.localBackingRevisionKind!=="branch"||v.sizeBytes!==ARTIFACT_SAMPLE_BYTES||v.sha256!==ARTIFACT_SAMPLE_SHA256)throw bad();
  return Object.freeze({privateVerified:true as const,remoteRevision:providerImmutableRevision(v.remoteRevision),sizeBytes:ARTIFACT_SAMPLE_BYTES,sha256:ARTIFACT_SAMPLE_SHA256,localBackingRevisionKind:"branch" as const});
}
export function providerHostPhases(host:FunctionalHost,purpose:ProviderHostCase,localize:boolean){
  if(typeof localize!=="boolean")throw bad();
  if(purpose==="provider-publication"){if(host!=="packaged-desktop"||localize)throw bad();return Object.freeze(["owned-local-file-imported","local-bytes-confirmed","private-target-admitted","actual-publication-confirmed","local-branch-confirmed","remote-commit-bytes-confirmed","reload-keeps-published-backing"]);}
  if(purpose!=="provider-source"||!["packaged-desktop","thin-chrome"].includes(host)||typeof localize!=="boolean")throw bad();
  return Object.freeze(["fresh-provider-workspace","exact-provider-file-selected","reference-task-completed","remote-reference-confirmed","reload-keeps-reference",...(localize?["explicit-localization-completed","localized-bytes-confirmed","reload-keeps-localized-reference"]:[]),"second-workspace-empty","cross-workspace-reference-denied","original-reference-retained"]);
}
export function providerHostReport(run:unknown,source:unknown,host:unknown,purpose:ProviderHostCase,localize:boolean,phases:string[],failed:boolean){
  const identity=functionalHostIdentity(run,source,host),expected=providerHostPhases(identity.host,purpose,localize);
  if(typeof failed!=="boolean"||types.isProxy(phases)||!Array.isArray(phases)||phases.length>expected.length||Reflect.ownKeys(phases).length!==phases.length+1||!failed&&phases.length!==expected.length)throw bad();
  const captured:string[]=[];for(let i=0;i<phases.length;i++){const field=Object.getOwnPropertyDescriptor(phases,String(i));if(!field||!("value" in field)||field.value!==expected[i])throw bad();captured.push(field.value);}
  return Object.freeze({schemaVersion:"functional-provider-host-v1",...identity,purpose,localizationRequested:localize,status:failed?"failed":"passed",phases:Object.freeze(captured),declaredPhases:expected.length,providerReferenceRegistration:purpose==="provider-source",rawReadablePairCreated:false,localPublishedRevisionKind:purpose==="provider-publication"?"branch":null,remoteRevisionWitness:purpose==="provider-publication"&&!failed,fullWorkerShutdownQualified:false,managedAuthorizationQualified:false,nativeOwnershipQualified:false,parentQualificationGranted:false});
}
