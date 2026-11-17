import path from "node:path";
import {randomBytes,randomUUID,createHmac,timingSafeEqual} from "node:crypto";
import {lstatSync,realpathSync,readFileSync,writeFileSync,renameSync,unlinkSync} from "node:fs";
import {functionalHostLayout} from "./functional-host-launch-plan.mjs";

const invalid=()=>new Error("The isolated artifact read identity is unavailable.");
const primaryScopes=["provider-credential:use","artifact:read","artifact:write","asset:read","asset:write","model:read","model:write","workspace:read","workspace:write"];
/** Trusted prelaunch composition only. No provider credential or running store is read. */
export function prepareFunctionalArtifactReadIdentity(plan,identity,sourceRevision){
  const layout=functionalHostLayout(plan.repoRoot,plan.runId,sourceRevision),file=path.join(layout.serverStorageRoot,"config/security/device-credentials.json");
  if(plan.paths.thinStorageRoot!==layout.serverStorageRoot||identity.credentialPath!==file||typeof identity.bearerToken!=="string"||!/^[A-Za-z0-9_-]{43}$/.test(identity.bearerToken)||typeof plan.server.env.SERVER_TOKEN_HASH_SECRET!=="string"||!/^[A-Za-z0-9_-]{43}$/.test(plan.server.env.SERVER_TOKEN_HASH_SECRET))throw invalid();
  for(let current=file;;current=path.dirname(current)){
    const stat=lstatSync(current);if(stat.isSymbolicLink()||realpathSync(current)!==current||current!==file&&!stat.isDirectory())throw invalid();
    if(current===file&&(!stat.isFile()||stat.nlink!==1||stat.size>8192))throw invalid();
    if(current===plan.repoRoot)break;
    if(!current.startsWith(plan.repoRoot+path.sep))throw invalid();
  }
  const before=readFileSync(file);let value;try{value=JSON.parse(before);}catch{throw invalid();}
  if(!value||Object.keys(value).join()!=="records"||!Array.isArray(value.records)||value.records.length!==1)throw invalid();
  const primary=value.records[0],fields=["deviceId","deviceName","tokenHash","tokenHashAlgorithm","scopes","createdAt","expiresAt"];
  if(!primary||Object.keys(primary).sort().join()!==fields.sort().join()||primary.deviceId!==`qualification-${plan.runId}`||typeof primary.deviceName!=="string"||primary.deviceName.length<1||primary.deviceName.length>160||/[\0-\x1f\x7f]/.test(primary.deviceName)||primary.tokenHashAlgorithm!=="sha256"||JSON.stringify(primary.scopes)!==JSON.stringify(primaryScopes)||typeof primary.createdAt!=="string"||typeof primary.expiresAt!=="string"||!Number.isFinite(Date.parse(primary.createdAt))||!Number.isFinite(Date.parse(primary.expiresAt))||Date.parse(primary.expiresAt)<=Date.parse(primary.createdAt)||Date.parse(primary.expiresAt)<=Date.now()||typeof primary.tokenHash!=="string"||!/^[a-f0-9]{64}$/.test(primary.tokenHash))throw invalid();
  const hash=token=>createHmac("sha256",plan.server.env.SERVER_TOKEN_HASH_SECRET).update(token).digest("hex");
  if(!timingSafeEqual(Buffer.from(primary.tokenHash,"hex"),Buffer.from(hash(identity.bearerToken),"hex")))throw invalid();
  const bearerToken=randomBytes(32).toString("base64url"),record={...primary,deviceId:`qualification-${plan.runId}-artifact-read`,deviceName:"Controlled artifact read-only qualification",tokenHash:hash(bearerToken),scopes:["artifact:read","workspace:read"]};
  const body=Buffer.from(JSON.stringify({records:[primary,record]},null,2)+"\n"),temporary=file+"."+randomUUID()+".tmp";
  let created=false;
  try{
    writeFileSync(temporary,body,{flag:"wx",mode:0o600});created=true;
    const current=readFileSync(file),stat=lstatSync(file);
    if(stat.isSymbolicLink()||stat.nlink!==1||realpathSync(file)!==file||!current.equals(before))throw invalid();
    renameSync(temporary,file);created=false;
    const settled=lstatSync(file);if(settled.isSymbolicLink()||settled.nlink!==1||realpathSync(file)!==file||!readFileSync(file).equals(body))throw invalid();
  }catch{
    if(created){try{const stat=lstatSync(temporary);if(stat.isFile()&&!stat.isSymbolicLink()&&stat.nlink===1&&readFileSync(temporary).equals(body))unlinkSync(temporary);}catch{}}
    throw invalid();
  }
  return Object.freeze({bearerToken,credentialPath:file});
}
