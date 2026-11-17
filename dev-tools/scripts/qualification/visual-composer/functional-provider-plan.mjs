import {types} from "node:util";

/** Fixed contributor fixture declarations. Import and plan have no I/O effects. */
export const FUNCTIONAL_PROVIDER_REPOSITORY="OpenFinAL/ai-system-builder-test";
export const FUNCTIONAL_PROVIDER_MANIFEST_BYTES=8192;
export const FUNCTIONAL_PROVIDER_OBJECT_BYTES=4096;
export const FUNCTIONAL_PROVIDER_METADATA_BYTES=64*1024;
export const FUNCTIONAL_PROVIDER_TIMEOUT_MS=15_000;
export const FUNCTIONAL_PROVIDER_SAMPLE_NAME="qualification-inventory.json";
const bad=()=>new Error("The provider fixture declaration is invalid.");

function fields(value,required,optional=[]){
  if(!value||typeof value!=="object"||types.isProxy(value)||Array.isArray(value)||![Object.prototype,null].includes(Object.getPrototypeOf(value)))throw bad();
  const keys=Reflect.ownKeys(value);if(keys.length>required.length+optional.length||keys.some(k=>typeof k!=="string"||!required.includes(k)&&!optional.includes(k))||required.some(k=>!keys.includes(k)))throw bad();
  const descriptors=Object.getOwnPropertyDescriptors(value),result=Object.create(null);
  for(const key of keys){if(!("value" in descriptors[key]))throw bad();result[key]=descriptors[key].value;}
  return result;
}
function relative(value,maximum){
  if(typeof value!=="string"||Buffer.byteLength(value)>maximum||!value||!/^[A-Za-z0-9._/-]+$/.test(value)||value.startsWith("/")||value.split("/").some(s=>!s||s==="."||s===".."||s.endsWith(".")||/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(s)))throw bad();return value;
}
export function providerFixtureReference(value){
  const name=relative(value,240);if(!name.startsWith(".local-codex/")||!name.endsWith(".json"))throw bad();return name;
}
export function providerImmutableRevision(value){
  if(typeof value!=="string"||!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(value))throw bad();return value;
}
export function validateProviderFixtureManifest(value){
  const v=fields(value,["schema_version","repository","credential_file"],["source_file"]);
  if(v.schema_version!=="functional-private-provider-v1"||v.repository!==FUNCTIONAL_PROVIDER_REPOSITORY)throw bad();
  const result={schema_version:v.schema_version,repository:FUNCTIONAL_PROVIDER_REPOSITORY,credential_file:providerFixtureReference(v.credential_file)};
  if(Object.hasOwn(v,"source_file")){
    const source=fields(v.source_file,["path","revision","size_bytes","sha256","localize"]),name=relative(source.path,128);
    if(!name.endsWith(".parquet")||!Number.isInteger(source.size_bytes)||source.size_bytes<8||source.size_bytes>FUNCTIONAL_PROVIDER_OBJECT_BYTES||typeof source.sha256!=="string"||!/^[a-f0-9]{64}$/.test(source.sha256)||typeof source.localize!=="boolean")throw bad();
    result.source_file=Object.freeze({path:name,revision:providerImmutableRevision(source.revision),size_bytes:source.size_bytes,sha256:source.sha256,localize:source.localize});
  }
  return Object.freeze(result);
}
export function parseProviderFixtureManifest(bytes){
  try{
    if(types.isProxy(bytes)||!(bytes instanceof Uint8Array)||!bytes.byteLength||bytes.byteLength>FUNCTIONAL_PROVIDER_MANIFEST_BYTES)throw bad();
    return validateProviderFixtureManifest(JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(bytes)));
  }catch{throw bad();}
}
export function providerFixtureIdentity(runId,sourceRevision,host,purpose){
  if(typeof runId!=="string"||!/^[a-z0-9-]{20,80}$/.test(runId)||typeof sourceRevision!=="string"||!/^source\.[a-f0-9]{64}$/.test(sourceRevision)||!["packaged-desktop","thin-chrome"].includes(host)||!["provider-source","provider-publication"].includes(purpose)||host==="thin-chrome"&&purpose!=="provider-source")throw bad();
  return Object.freeze({runId,sourceRevision,host,purpose});
}
export function providerFixturePlan(manifest,identity){
  const v=validateProviderFixtureManifest(manifest),i=fields(identity,["runId","sourceRevision","host","purpose"]);
  const bound=providerFixtureIdentity(i.runId,i.sourceRevision,i.host,i.purpose);
  if(bound.purpose==="provider-source"&&!v.source_file)throw bad();
  return Object.freeze({manifest:v,identity:bound,sourceReferenceOnly:bound.purpose==="provider-source"&&!v.source_file.localize,publicationPath:bound.purpose==="provider-publication"?providerPublicationPath(bound.runId):undefined});
}
export function safeProviderFixturePlan(plan){
  const value=fields(plan,["manifest","identity","sourceReferenceOnly","publicationPath"]),p=providerFixturePlan(value.manifest,value.identity);
  if(value.sourceReferenceOnly!==p.sourceReferenceOnly||value.publicationPath!==p.publicationPath)throw bad();
  return Object.freeze({purpose:p.identity.purpose,host:p.identity.host,requiresExplicitTestCredential:true,sourceReferenceOnly:p.sourceReferenceOnly,localizationRequested:p.identity.purpose==="provider-source"&&p.manifest.source_file.localize,repositoryCreation:false,remoteDeletion:false,credentialRead:false,networkRun:false,qualificationGranted:false});
}
export function providerPublicationPath(runId){
  providerFixtureIdentity(runId,`source.${"0".repeat(64)}`,"packaged-desktop","provider-publication");
  return `qualification/functional-host/${runId}/${FUNCTIONAL_PROVIDER_SAMPLE_NAME}`;
}
export function providerRepositoryInfoUrl(){return `https://huggingface.co/api/datasets/${FUNCTIONAL_PROVIDER_REPOSITORY}`;}
export function providerPublicationObjectUrl(runId,revision){
  const path=providerPublicationPath(runId).split("/").map(encodeURIComponent).join("/");
  return `https://huggingface.co/datasets/${FUNCTIONAL_PROVIDER_REPOSITORY}/resolve/${providerImmutableRevision(revision)}/${path}`;
}
