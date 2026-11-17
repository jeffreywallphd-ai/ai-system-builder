import test from "node:test";
import assert from "node:assert/strict";
import {createHmac} from "node:crypto";
import path from "node:path";
import {tmpdir} from "node:os";
import {mkdtemp,readFile,rm,mkdir,writeFile} from "node:fs/promises";
import {prepareThinClientQualificationIdentity} from "../visual-composer/visual-composer-global-setup.mjs";

const publicScopes=["settings:read","settings:write","workspace:read","workspace:write"];
const standardScopes=["artifact:read","artifact:write","asset:read","asset:write","model:read","model:write","workspace:read","workspace:write"];
async function fixture(t){
  const root=await mkdtemp(path.join(tmpdir(),"settings-public-identity-"));
  t.after(()=>rm(root,{recursive:true}));
  return root;
}
function plan(root,name){return {runId:"settings-public-synthetic",paths:{thinStorageRoot:path.join(root,name)},server:{env:{}}};}

test("public Settings identity has only its four scopes and a verifiable, expiring hashed token",async t=>{
  const root=await fixture(t),before=Date.now(),launch=plan(root,"public");
  const identity=prepareThinClientQualificationIdentity(launch,"settings-public-values");
  const bytes=await readFile(identity.credentialPath,"utf8"),document=JSON.parse(bytes);
  assert.equal(identity.credentialPath,path.join(launch.paths.thinStorageRoot,"config/security/device-credentials.json"));
  assert.deepEqual(Object.keys(document),["records"]);assert.equal(document.records.length,1);
  const record=document.records[0],secret=launch.server.env.SERVER_TOKEN_HASH_SECRET;
  assert.deepEqual(record.scopes,publicScopes);
  assert.match(identity.bearerToken,/^[A-Za-z0-9_-]{43}$/);assert.match(secret,/^[A-Za-z0-9_-]{43}$/);
  assert.notEqual(secret,identity.bearerToken);
  assert.equal(record.tokenHashAlgorithm,"sha256");
  assert.equal(record.tokenHash,createHmac("sha256",secret).update(identity.bearerToken).digest("hex"));
  assert.equal(bytes.includes(identity.bearerToken),false);assert.equal(bytes.includes(secret),false);
  assert.equal(Date.parse(record.expiresAt)-Date.parse(record.createdAt),30*60*1000);
  assert.ok(Date.parse(record.createdAt)>=before&&Date.parse(record.createdAt)<=Date.now());
  assert.equal(record.deviceId,"qualification-settings-public-synthetic");
  const secondPlan=plan(root,"second"),second=prepareThinClientQualificationIdentity(secondPlan,"settings-public-values");
  assert.notEqual(second.bearerToken,identity.bearerToken);assert.notEqual(secondPlan.server.env.SERVER_TOKEN_HASH_SECRET,secret);
});

test("all original qualification purposes retain their exact scopes",async t=>{
  const root=await fixture(t);
  for(const [purpose,extra]of [
    ["standard",[]],
    ["image-generation",["image-generation:read","image-generation:write"]],
    ["settings",["settings:read","settings:write","provider-credential:read","provider-credential:write"]],
    ["functional-data",["provider-credential:use"]],
  ]){
    const launch=plan(root,purpose),identity=prepareThinClientQualificationIdentity(launch,purpose);
    const {records}=JSON.parse(await readFile(identity.credentialPath,"utf8"));
    assert.deepEqual(records[0].scopes,[...extra,...standardScopes],purpose);
  }
  const identity=prepareThinClientQualificationIdentity(plan(root,"default"));
  assert.deepEqual(JSON.parse(await readFile(identity.credentialPath,"utf8")).records[0].scopes,standardScopes);
});

test("unknown purposes fail before accessing the plan or coercing caller objects",()=>{
  let accesses=0;
  const hostile=new Proxy({},{get(){accesses++;throw new Error("Unexpected plan access.");}});
  const coercion={toString(){accesses++;return "settings-public-values";}};
  for(const purpose of ["",null,false,0,{},[],["settings-public-values"],coercion,Symbol("purpose"),"SETTINGS-PUBLIC-VALUES","settings-public-values ","__proto__","all"]){
    assert.throws(()=>prepareThinClientQualificationIdentity(hostile,purpose),/Unsupported qualification credential purpose/);
  }
  assert.equal(accesses,0);
});

test("an occupied identity file is preserved and no new hash secret is published",async t=>{
  const root=await fixture(t),launch=plan(root,"occupied"),file=path.join(launch.paths.thinStorageRoot,"config/security/device-credentials.json");
  await mkdir(path.dirname(file),{recursive:true});const original=Buffer.from("owned synthetic prior identity\n");
  await writeFile(file,original,{flag:"wx"});
  launch.server.env.SERVER_TOKEN_HASH_SECRET="existing-synthetic-secret";
  assert.throws(()=>prepareThinClientQualificationIdentity(launch,"settings-public-values"),error=>error.code==="EEXIST");
  assert.deepEqual(await readFile(file),original);assert.equal(launch.server.env.SERVER_TOKEN_HASH_SECRET,"existing-synthetic-secret");
});
