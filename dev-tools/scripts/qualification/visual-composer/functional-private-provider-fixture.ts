import {ChildProcess} from "node:child_process";
import {createHash} from "node:crypto";
import {closeSync,fstatSync,lstatSync,mkdirSync,openSync,readSync,realpathSync,unlinkSync,type Stats} from "node:fs";
import path from "node:path";
import {types} from "node:util";
import {createHuggingFaceTokenConfigStore} from "../../../../modules/hosts/shared/huggingFaceTokenConfigStore";
import {functionalHostLayout} from "./functional-host-launch-plan.mjs";
import {ARTIFACT_SAMPLE_BYTES,ARTIFACT_SAMPLE_SHA256} from "./functional-artifact-oracles";
import {FUNCTIONAL_PROVIDER_METADATA_BYTES,FUNCTIONAL_PROVIDER_OBJECT_BYTES,FUNCTIONAL_PROVIDER_TIMEOUT_MS,parseProviderFixtureManifest,providerFixtureIdentity,providerFixturePlan,providerFixtureReference,providerImmutableRevision,providerPublicationObjectUrl,providerPublicationPath,providerRepositoryInfoUrl,safeProviderFixturePlan,type ProviderFixtureIdentity,type ProviderFixturePlan,type ProviderSourceFile} from "./functional-provider-plan.mjs";

type FileIdentity={dev:number;ino:number;size:number;mtimeMs:number;nlink:number};
type AdmissionState={repo:string;root:string;parent:string;parentIdentity:FileIdentity;identity:ProviderFixtureIdentity;used:boolean};
export type ProviderAdmission=Readonly<Record<never,never>>;
const admissions=new WeakMap<ProviderAdmission,AdmissionState>();
const safeErrors=new WeakSet<object>();
const refused=(stage:string)=>{const error=Object.freeze(Object.assign(new Error("The private provider test could not complete."),{name:"ProviderFixtureError",stage}));safeErrors.add(error);return error;};
const safeAggregate=(errors:Error[],message:string)=>{const error=new AggregateError(errors,message);Object.freeze(error.errors);Object.freeze(error);safeErrors.add(error);return error;};
const retainSafe=(error:unknown,stage:string):Error=>safeErrors.has(error as object)?error as Error:refused(stage);
export function privateProviderFailureStage(value:unknown):string{
  if(!safeErrors.has(value as object))return "provider-test-failed";
  if(value instanceof AggregateError)return "provider-test-and-cleanup-failed";
  return (value as Error&{stage:string}).stage;
}
function record(value:unknown,maximum=16){
  if(!value||typeof value!=="object"||types.isProxy(value)||Array.isArray(value)||![Object.prototype,null].includes(Object.getPrototypeOf(value)))throw refused("invalid-input");
  const keys=Reflect.ownKeys(value);if(keys.length>maximum||keys.some(k=>typeof k!=="string"))throw refused("invalid-input");
  const fields=Object.getOwnPropertyDescriptors(value),result=Object.create(null) as Record<string,unknown>;
  for(const key of keys as string[]){if(!("value" in fields[key]!))throw refused("invalid-input");result[key]=fields[key]!.value;}
  return result;
}
function snapshot(stat:Stats):FileIdentity{return{dev:stat.dev,ino:stat.ino,size:stat.size,mtimeMs:stat.mtimeMs,nlink:stat.nlink};}
function same(a:FileIdentity,b:FileIdentity){return a.dev===b.dev&&a.ino===b.ino&&a.size===b.size&&a.mtimeMs===b.mtimeMs&&a.nlink===b.nlink;}
function directoryIdentity(name:string){const s=lstatSync(name);if(!s.isDirectory()||s.isSymbolicLink()||realpathSync(name)!==name)throw refused("physical-directory-required");return snapshot(s);}
function rootPath(value:string){if(typeof value!=="string"||!path.isAbsolute(value))throw refused("physical-root-required");const root=path.resolve(value);directoryIdentity(root);return root;}
function contained(repo:string,name:string){const rel=path.relative(repo,name);if(!rel||rel===".."||rel.startsWith(`..${path.sep}`)||path.isAbsolute(rel))throw refused("path-not-contained");return rel.split(path.sep);}
function physicalParents(repo:string,name:string){let current=repo;for(const segment of contained(repo,path.dirname(name))){current=path.join(current,segment);directoryIdentity(current);}}
function boundedFile(repo:string,name:string,maximum:number){
  physicalParents(repo,name);const before=lstatSync(name);if(!before.isFile()||before.isSymbolicLink()||before.nlink!==1||before.size<1||before.size>maximum||realpathSync(name)!==name)throw refused("bounded-regular-file-required");
  const id=snapshot(before),fd=openSync(name,"r");
  try{
    if(!same(id,snapshot(fstatSync(fd))))throw refused("input-identity-changed");
    const bytes=Buffer.alloc(id.size);let used=0;
    while(used<bytes.length){const count=readSync(fd,bytes,used,bytes.length-used,used);if(count<=0)throw refused("incomplete-input");used+=count;}
    if(!same(id,snapshot(fstatSync(fd)))||!same(id,snapshot(lstatSync(name))))throw refused("input-identity-changed");
    return{bytes,identity:id};
  }finally{closeSync(fd);}
}
function derivedRoot(repo:string,identity:ProviderFixtureIdentity){
  const layout=functionalHostLayout(repo,identity.runId,identity.sourceRevision);
  return identity.host==="packaged-desktop"?path.join(layout.desktopDataRoot,`functional-${identity.purpose}`):layout.serverStorageRoot;
}
function desktopStopReport(repo:string,identity:ProviderFixtureIdentity){return path.join(repo,"artifacts/qualification/visual-composer/runs",identity.runId,"functional-source",`functional-${identity.purpose}`,"desktop-shutdown.json");}
function requireAbsentPhysicalTarget(repo:string,name:string){
  let current=repo;const parts=contained(repo,name);
  for(let i=0;i<parts.length;i++){current=path.join(current,parts[i]!);const value=lstatSync(current,{throwIfNoEntry:false});if(!value)return;if(i===parts.length-1)throw refused("prior-evidence-present");directoryIdentity(current);}
}
/** Cooperative capability: create before the existing identity seed, while the exact root is absent. */
export function beginProviderFixtureAdmission(repoRoot:string,input:ProviderFixtureIdentity):ProviderAdmission{
  try{
    const v=record(input);if(Object.keys(v).length!==4)throw refused("invalid-input");
    const identity=providerFixtureIdentity(v.runId,v.sourceRevision,v.host,v.purpose),repo=rootPath(repoRoot),root=derivedRoot(repo,identity);
    let current=repo,parent=repo,parentIdentity=directoryIdentity(repo),missing=false;
    for(const segment of contained(repo,root)){
      current=path.join(current,segment);const stat=lstatSync(current,{throwIfNoEntry:false});
      if(!stat){missing=true;break;}parentIdentity=directoryIdentity(current);parent=current;
    }
    if(!missing)throw refused("fresh-root-required");
    const lease=Object.freeze(Object.create(null)) as ProviderAdmission;
    admissions.set(lease,{repo,root,parent,parentIdentity,identity,used:false});return lease;
  }catch(error){throw retainSafe(error,"fresh-root-admission-failed");}
}
function tokenValue(bytes:Buffer){
  try{const v=record(JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(bytes)));if(Object.keys(v).length!==1||typeof v.token!=="string")throw refused("invalid-test-credential");const token=v.token.trim();if(!/^[!-~]{1,512}$/.test(token))throw refused("invalid-test-credential");return token;}
  catch{throw refused("invalid-test-credential");}
}
export interface PrivateRepositoryObservation{readonly private:true;readonly revision:string;}
export interface ProviderCredentialFixture{
  markConsumerLaunch():void;
  bindConsumer(child:ChildProcess):void;
  retireBeforeLaunch():void;
  retireDesktopAfterStop():void;
  retireServerAfterStop(ack:unknown):void;
}
export interface ExecutingProviderFixture{
  readonly identity:ProviderFixtureIdentity;
  readonly sourceFile:ProviderSourceFile|undefined;
  readonly declaredScope:Readonly<{purpose:ProviderFixtureIdentity["purpose"];host:ProviderFixtureIdentity["host"];sourceReferenceOnly:boolean;localizationRequested:boolean;repositoryCreation:false;remoteDeletion:false}>;
  seedCredential(admission:ProviderAdmission):ProviderCredentialFixture;
  observePrivateRepository():Promise<PrivateRepositoryObservation>;
  admitPublicationPath():Promise<Readonly<{privateVerified:true;pathAbsent:true;baseRevision:string}>>;
  observePublishedObject():Promise<Readonly<{privateVerified:true;remoteRevision:string;sizeBytes:number;sha256:string;localBackingRevisionKind:"branch"}>>;
}
/** Reads only the small declaration, never the credential named inside it. */
export function readProviderFixtureDeclaration(options:{repoRoot:string;manifestRef:string;identity:ProviderFixtureIdentity}):ProviderFixturePlan{
  try{
    const o=record(options);if(Object.keys(o).length!==3||["repoRoot","manifestRef","identity"].some(k=>!Object.prototype.hasOwnProperty.call(o,k)))throw refused("invalid-input");
    const v=record(o.identity);if(Object.keys(v).length!==4)throw refused("invalid-input");
    const identity=providerFixtureIdentity(v.runId,v.sourceRevision,v.host,v.purpose),repo=rootPath(o.repoRoot as string),reference=providerFixtureReference(o.manifestRef);
    return providerFixturePlan(parseProviderFixtureManifest(boundedFile(repo,path.join(repo,...reference.split("/")),8192).bytes),identity);
  }catch(error){throw retainSafe(error,"provider-declaration-unavailable");}
}
/** Calling code must derive executing from the explicit opt-in, never from a manifest field. */
export function openExecutingProviderFixture(options:{repoRoot:string;manifestRef:string;identity:ProviderFixtureIdentity;executing:boolean}):ExecutingProviderFixture{
  try{
    const o=record(options);if(Object.keys(o).length!==4||["repoRoot","manifestRef","identity","executing"].some(k=>!Object.prototype.hasOwnProperty.call(o,k))||o.executing!==true)throw refused("execution-not-admitted");
    const v=record(o.identity);if(Object.keys(v).length!==4)throw refused("invalid-input");
    const identity=providerFixtureIdentity(v.runId,v.sourceRevision,v.host,v.purpose);
    const repo=rootPath(o.repoRoot as string),config=providerFixtureReference(o.manifestRef),parsed=boundedFile(repo,path.join(repo,...config.split("/")),8192);
    const plan=providerFixturePlan(parseProviderFixtureManifest(parsed.bytes),identity),inputPath=path.join(repo,...plan.manifest.credential_file.split("/"));
    const input=boundedFile(repo,inputPath,8192),token=tokenValue(input.bytes);
    return createExecutingFixture(repo,plan,inputPath,input,token);
  }catch(error){throw retainSafe(error,"explicit-test-input-unavailable");}
}
function createExecutingFixture(repo:string,plan:ProviderFixturePlan,inputPath:string,input:ReturnType<typeof boundedFile>,token:string):ExecutingProviderFixture{
  let requests=0,totalBytes=0,publicationBase:string|undefined;
  function inputUnchanged(){const current=boundedFile(repo,inputPath,8192);if(!same(current.identity,input.identity)||!current.bytes.equals(input.bytes))throw refused("test-input-changed");}
  async function request(url:string,maximum:number,missing=false){
    if(++requests>8)throw refused("provider-request-budget");inputUnchanged();
    const controller=new AbortController();let rejectDeadline:(reason:unknown)=>void=()=>{};
    const deadline=new Promise<never>((_,reject)=>{rejectDeadline=reject;});
    const timer=setTimeout(()=>{rejectDeadline(refused("provider-read-timed-out"));controller.abort();},FUNCTIONAL_PROVIDER_TIMEOUT_MS);
    let response:Response|undefined,reader:ReadableStreamDefaultReader<Uint8Array>|undefined,primary:Error|undefined;
    try{
      response=await Promise.race([fetch(url,{method:"GET",redirect:"error",signal:controller.signal,headers:{Authorization:`Bearer ${token}`,Accept:maximum===FUNCTIONAL_PROVIDER_METADATA_BYTES?"application/json":"application/octet-stream"}}),deadline]);
      if(response.redirected||response.url&&response.url!==url)throw refused("provider-redirect-refused");
      if(missing&&response.status===404&&response.headers.get("x-error-code")==="EntryNotFound"){if(response.body)await Promise.race([response.body.cancel(),deadline]);return undefined;}
      if(response.status!==200||!response.body)throw refused("provider-read-refused");
      const length=response.headers.get("content-length");if(length!==null&&(!/^\d+$/.test(length)||Number(length)>maximum))throw refused("provider-response-bound");
      reader=response.body.getReader();const chunks:Uint8Array[]=[];let used=0,count=0;
      for(;;){const next=await Promise.race([reader.read(),deadline]);if(next.done)break;if(!(next.value instanceof Uint8Array)||++count>4096||next.value.byteLength>maximum-used)throw refused("provider-response-bound");used+=next.value.byteLength;totalBytes+=next.value.byteLength;if(totalBytes>256*1024)throw refused("provider-total-byte-budget");chunks.push(next.value);}
      inputUnchanged();return Buffer.concat(chunks,used);
    }catch(error){
      controller.abort();primary=retainSafe(error,"provider-witness-unavailable");
      try{const canceled=reader?reader.cancel():response?.body?.cancel();if(canceled)await Promise.race([canceled,deadline]);}catch{primary=safeAggregate([primary,refused("provider-stream-cancel-failed")],"Private provider read and cleanup failed.");}
      throw primary;
    }finally{
      clearTimeout(timer);try{reader?.releaseLock();}catch{const cleanup=refused("provider-stream-release-failed");throw primary?safeAggregate([primary,cleanup],"Private provider read and cleanup failed."):cleanup;}
    }
  }
  async function observePrivateRepository():Promise<PrivateRepositoryObservation>{
    try{
      const bytes=await request(providerRepositoryInfoUrl(),FUNCTIONAL_PROVIDER_METADATA_BYTES);if(!bytes)throw refused("private-state-unconfirmed");
      const data=record(JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(bytes)),128);
      if(data.id!==plan.manifest.repository||data.private!==true)throw refused("private-state-unconfirmed");
      return Object.freeze({private:true,revision:providerImmutableRevision(data.sha)});
    }catch(error){throw retainSafe(error,"private-state-unconfirmed");}
  }
  function seedCredential(admission:ProviderAdmission):ProviderCredentialFixture{
    let destination="",expected:Buffer|undefined,owned:FileIdentity|undefined,child:ChildProcess|undefined,closed=false,launch=false,retired=false;
    try{
      const a=admissions.get(admission);if(!a||a.used||a.repo!==repo||JSON.stringify(a.identity)!==JSON.stringify(plan.identity))throw refused("fixture-admission-mismatch");
      const parent=directoryIdentity(a.parent);if(parent.dev!==a.parentIdentity.dev||parent.ino!==a.parentIdentity.ino)throw refused("fixture-admission-mismatch");
      a.used=true;physicalParents(repo,path.join(a.root,"owned-leaf"));directoryIdentity(a.root);inputUnchanged();
      if(plan.identity.host==="packaged-desktop")requireAbsentPhysicalTarget(repo,desktopStopReport(repo,plan.identity));
      let folder=a.root;for(const segment of plan.identity.host==="packaged-desktop"?["artifacts","config"]:["config"]){folder=path.join(folder,segment);if(!lstatSync(folder,{throwIfNoEntry:false}))mkdirSync(folder,{mode:0o700});directoryIdentity(folder);}
      destination=path.join(folder,"hugging-face-token.json");if(lstatSync(destination,{throwIfNoEntry:false}))throw refused("credential-target-exists");
      const store=createHuggingFaceTokenConfigStore({filePath:destination});void store.setToken(token);if(store.getToken()!==token)throw refused("credential-readback-failed");
      expected=Buffer.from(JSON.stringify({token}));const current=boundedFile(repo,destination,8192);if(!current.bytes.equals(expected))throw refused("credential-format-mismatch");owned=current.identity;inputUnchanged();
    }catch(error){
      const primary=retainSafe(error,"credential-seed-refused");
      if(owned&&expected){try{const current=boundedFile(repo,destination,8192);if(!same(current.identity,owned)||!current.bytes.equals(expected))throw refused("credential-retained");unlinkSync(destination);expected.fill(0);}catch{throw safeAggregate([primary,refused("credential-retained")],"Private provider seed and cleanup failed.");}}
      throw primary;
    }
    function retire(){
      if(retired||!owned||!expected)throw refused("credential-retirement-unavailable");const errors:Error[]=[];
      try{inputUnchanged();}catch{errors.push(refused("test-input-changed"));}
      try{const current=boundedFile(repo,destination,8192);if(!same(current.identity,owned)||!current.bytes.equals(expected))throw refused("credential-identity-changed");unlinkSync(destination);retired=true;expected.fill(0);}
      catch{errors.push(refused("credential-retained"));}
      if(errors.length)throw safeAggregate(errors,"Private provider fixture cleanup failed.");
    }
    function consumerStopped(){if(!launch||!child||!closed||child.exitCode!==0||child.signalCode!==null)throw refused("consumer-stop-unconfirmed");}
    return Object.freeze({
      markConsumerLaunch(){if(launch||retired)throw refused("consumer-launch-state");launch=true;},
      bindConsumer(value:ChildProcess){if(!launch||child||!(value instanceof ChildProcess)||!Number.isInteger(value.pid)||value.pid!<=0||value.signalCode!==null||value.exitCode!==null&&!(plan.identity.host==="packaged-desktop"&&value.exitCode===0))throw refused("consumer-identity-unavailable");child=value;closed=value.exitCode===0;value.once("close",(code,signal)=>{closed=code===0&&signal===null;});},
      retireBeforeLaunch(){if(launch)throw refused("consumer-stop-unconfirmed");retire();},
      retireDesktopAfterStop(){
        consumerStopped();if(plan.identity.host!=="packaged-desktop")throw refused("consumer-kind-mismatch");
        try{
          const ack=record(JSON.parse(boundedFile(repo,path.join(derivedRoot(repo,plan.identity),"qualification-functional-will-quit.json"),1024).bytes.toString("utf8"))),report=record(JSON.parse(boundedFile(repo,desktopStopReport(repo,plan.identity),8192).bytes.toString("utf8")));
          if(Object.keys(ack).length!==2||ack.event!=="will-quit"||!Number.isInteger(ack.pid)||report.schemaVersion!=="real-functional-desktop-main-shutdown-v1"||report.sourceRevision!==plan.identity.sourceRevision||report.launchedPid!==child!.pid||report.mainPid!==ack.pid||report.mainExitCode!==0||report.willQuitAcknowledged!==true||report.modelWorkers!=="not-qualified")throw refused("consumer-stop-unconfirmed");
        }
        catch{throw refused("consumer-stop-unconfirmed");}retire();
      },
      retireServerAfterStop(value:unknown){
        consumerStopped();const ack=record(value);
        if(plan.identity.host!=="thin-chrome"||Object.keys(ack).length!==8||ack.schemaVersion!=="functional-data-host-shutdown-v1"||ack.runId!==plan.identity.runId||ack.sourceRevision!==plan.identity.sourceRevision||ack.pid!==child!.pid||ack.status!=="stopped"||ack.backgroundTasksStopped!==true||ack.persistenceClosed!==true||ack.fullJobQualified!==false)throw refused("consumer-stop-unconfirmed");retire();
      },
    });
  }
  const pure=safeProviderFixturePlan(plan),declaredScope=Object.freeze({purpose:pure.purpose,host:pure.host,sourceReferenceOnly:pure.sourceReferenceOnly,localizationRequested:pure.localizationRequested,repositoryCreation:false as const,remoteDeletion:false as const});
  return Object.freeze({identity:plan.identity,sourceFile:plan.manifest.source_file,declaredScope,seedCredential,observePrivateRepository,
    async admitPublicationPath(){
      if(plan.identity.purpose!=="provider-publication"||publicationBase)throw refused("publication-admission-state");
      const current=await observePrivateRepository();if(await request(providerPublicationObjectUrl(plan.identity.runId,current.revision),FUNCTIONAL_PROVIDER_OBJECT_BYTES,true)!==undefined)throw refused("publication-target-exists");
      publicationBase=current.revision;return Object.freeze({privateVerified:true as const,pathAbsent:true as const,baseRevision:current.revision});
    },
    async observePublishedObject(){
      if(!publicationBase)throw refused("publication-not-admitted");const current=await observePrivateRepository();if(current.revision===publicationBase)throw refused("publication-commit-unchanged");
      const bytes=await request(providerPublicationObjectUrl(plan.identity.runId,current.revision),FUNCTIONAL_PROVIDER_OBJECT_BYTES),sha256=bytes?createHash("sha256").update(bytes).digest("hex"):"";
      if(!bytes||bytes.length!==ARTIFACT_SAMPLE_BYTES||sha256!==ARTIFACT_SAMPLE_SHA256)throw refused("publication-bytes-mismatch");await observePrivateRepository();
      return Object.freeze({privateVerified:true as const,remoteRevision:current.revision,sizeBytes:bytes.length,sha256,localBackingRevisionKind:"branch" as const});
    },
  });
}
