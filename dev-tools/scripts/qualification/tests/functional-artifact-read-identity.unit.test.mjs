import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import {mkdtemp,realpath,lstat,rm,readFile,writeFile,link,unlink} from "node:fs/promises";
import {createHmac} from "node:crypto";
import {functionalHostLayout} from "../visual-composer/functional-host-launch-plan.mjs";
import {prepareThinClientQualificationIdentity} from "../visual-composer/visual-composer-global-setup.mjs";
import {prepareFunctionalArtifactReadIdentity} from "../visual-composer/functional-artifact-read-identity.mjs";
const run="artifact-read-identity-fixture-20261029",source="source."+"a".repeat(64);
async function fixture(action){
  const parent=await realpath(path.resolve(".local-codex/t")),root=await mkdtemp(path.join(parent,"artifact-auth-")),owned=await lstat(root,{bigint:true});
  const layout=functionalHostLayout(root,run,source),plan={repoRoot:root,runId:run,paths:{thinStorageRoot:layout.serverStorageRoot},server:{env:{}}};
  const primary=prepareThinClientQualificationIdentity(plan,"functional-data");
  try{await action(plan,primary,root);}finally{
    const current=await lstat(root,{bigint:true});assert.equal(current.dev,owned.dev);assert.equal(current.ino,owned.ino);assert.equal(path.dirname(root),parent);assert.equal(await realpath(root),root);assert.equal(current.isSymbolicLink(),false);await rm(root,{recursive:true});
  }
}
test("a fresh secondary identity has only two read scopes while preserving primary hash, scopes and expiry",async()=>fixture(async(plan,primary)=>{
  const before=JSON.parse(await readFile(primary.credentialPath,"utf8")),secret=plan.server.env.SERVER_TOKEN_HASH_SECRET;
  const secondary=prepareFunctionalArtifactReadIdentity(plan,primary,source),raw=await readFile(primary.credentialPath,"utf8"),after=JSON.parse(raw);
  assert.equal(after.records.length,2);assert.deepEqual(after.records[0],before.records[0]);assert.equal(plan.server.env.SERVER_TOKEN_HASH_SECRET,secret);
  assert.deepEqual(after.records[1].scopes,["artifact:read","workspace:read"]);assert.equal(after.records[1].expiresAt,before.records[0].expiresAt);assert.notEqual(secondary.bearerToken,primary.bearerToken);
  assert.equal(after.records[1].tokenHash,createHmac("sha256",secret).update(secondary.bearerToken).digest("hex"));assert.equal(raw.includes(secondary.bearerToken),false);assert.equal(raw.includes(primary.bearerToken),false);
  assert.throws(()=>prepareFunctionalArtifactReadIdentity(plan,primary,source),/unavailable/);assert.equal(await readFile(primary.credentialPath,"utf8"),raw);
}));
test("wrong caller, changed role/expiry/store and oversized input refuse without replacing known data",async()=>fixture(async(plan,primary)=>{
  const before=await readFile(primary.credentialPath);
  for(const input of [{...primary,bearerToken:"x".repeat(43)},{...primary,credentialPath:primary.credentialPath+"-other"}]){assert.throws(()=>prepareFunctionalArtifactReadIdentity(plan,input,source));assert.deepEqual(await readFile(primary.credentialPath),before);}
  for(const patch of [{scopes:["artifact:write"]},{expiresAt:"2000-01-01T00:00:00.000Z"},{deviceId:"foreign-device"},{unexpected:true}]){
    const v=JSON.parse(before);Object.assign(v.records[0],patch);const changed=Buffer.from(JSON.stringify(v));await writeFile(primary.credentialPath,changed);assert.throws(()=>prepareFunctionalArtifactReadIdentity(plan,primary,source));assert.deepEqual(await readFile(primary.credentialPath),changed);
  }
  await writeFile(primary.credentialPath,Buffer.alloc(8193));assert.throws(()=>prepareFunctionalArtifactReadIdentity(plan,primary,source));assert.equal((await lstat(primary.credentialPath)).size,8193);
}));
test("linked credential bytes and redirected layout are denied before any store mutation",async()=>fixture(async(plan,primary,root)=>{
  const before=await readFile(primary.credentialPath),alias=path.join(root,"owned-link");await link(primary.credentialPath,alias);
  try{assert.throws(()=>prepareFunctionalArtifactReadIdentity(plan,primary,source));assert.deepEqual(await readFile(primary.credentialPath),before);}finally{await unlink(alias);}
  assert.throws(()=>prepareFunctionalArtifactReadIdentity({...plan,paths:{thinStorageRoot:path.join(root,"other")}},primary,source));assert.deepEqual(await readFile(primary.credentialPath),before);
}));
