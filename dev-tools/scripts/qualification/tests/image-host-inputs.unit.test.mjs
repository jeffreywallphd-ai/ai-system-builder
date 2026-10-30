import assert from "node:assert/strict";
import test from "node:test";
import {mkdtemp,mkdir,writeFile,readFile,realpath,lstat,rm,link,symlink,unlink} from "node:fs/promises";
import path from "node:path";
import {createHash} from "node:crypto";
import {inspectImageHostInputBytes,IMAGE_INPUT_LIMITS} from "../visual-composer/image-host-inputs.mjs";
import {imageHostLayout} from "../visual-composer/image-host-launch-plan.mjs";
const run="image-input-tests-run-20261029",sha=bytes=>createHash("sha256").update(bytes).digest("hex");
const smallWeights=()=>{
  let text=JSON.stringify({weight:{dtype:"F32",shape:[1],data_offsets:[0,4]},__metadata__:{format:"pt"}});text+=" ".repeat((8-Buffer.byteLength(text)%8)%8);
  const header=Buffer.from(text),prefix=Buffer.alloc(8);prefix.writeBigUInt64LE(BigInt(header.length));return Buffer.concat([prefix,header,Buffer.alloc(4)]);
};
async function fixture(action) {
  const parent=path.resolve(".local-codex/t");await mkdir(parent,{recursive:true});const root=await mkdtemp(path.join(parent,"image-inputs-"));assert.equal(await realpath(root),root);
  const layout=imageHostLayout(root,run),bytes=smallWeights(),file=path.join(layout.checkpointRoot,"input.safetensors");
  const declared={schemaVersion:"image-host-input-manifest-v1",runId:run,checkpointFileName:"input.safetensors",checkpointSha256:sha(bytes),checkpointBytes:bytes.length,comfyCommitSha:"a".repeat(40)};
  await mkdir(layout.checkpointRoot,{recursive:true});await writeFile(file,bytes,{flag:"wx"});await writeFile(layout.manifestPath,JSON.stringify(declared),{flag:"wx"});
  try{await action({root,layout,bytes,file,declared});}
  finally{assert.equal(path.dirname(root),parent);assert.equal(await realpath(root),root);assert(!(await lstat(root)).isSymbolicLink());await rm(root,{recursive:true});}
}
test("reads exact declared regular bytes without granting model or native authority",()=>fixture(async({root,layout,bytes})=>{
  const before=await readFile(layout.manifestPath),result=await inspectImageHostInputBytes(root,run);
  assert(Object.isFrozen(result));assert.equal(result.checkpointSha256,sha(bytes));assert.equal(result.checkpointBytes,bytes.length);assert.equal(result.authorityGranted,false);
  assert.match(result.scope,/No model compatibility/);assert.deepEqual(await readFile(layout.manifestPath),before);
  assert(!JSON.stringify(result).includes(root));
}));
test("missing files, foreign scope, malformed declarations and unknown fields deny",()=>fixture(async({root,layout,declared})=>{
  for(const extra of [{runId:"another-image-input-run-20261029"},{checkpointFileName:"../private.safetensors"},{checkpointFileName:"CON.safetensors"},{checkpointSha256:[declared.checkpointSha256]},{checkpointSha256:"0".repeat(64)},{checkpointBytes:declared.checkpointBytes+1},{checkpointBytes:IMAGE_INPUT_LIMITS.checkpointBytes+1},{comfyCommitSha:"main"},{approved:true}]) {
    await writeFile(layout.manifestPath,JSON.stringify({...declared,...extra}));await assert.rejects(inspectImageHostInputBytes(root,run),{message:"The fixed local image inputs could not be verified."});
  }
  for(const text of ["{","[]"," ".repeat(IMAGE_INPUT_LIMITS.manifestBytes+1)]){await writeFile(layout.manifestPath,text);await assert.rejects(inspectImageHostInputBytes(root,run));}
  await unlink(layout.manifestPath);await assert.rejects(inspectImageHostInputBytes(root,run));
}));
test("invalid or unbounded safetensors headers and data offsets deny before a model is loaded",()=>fixture(async({root,layout,declared,file})=>{
  const huge=Buffer.alloc(16);huge.writeBigUInt64LE(BigInt(IMAGE_INPUT_LIMITS.headerBytes+1));
  const invalidHeader=(value)=>{const header=Buffer.from(JSON.stringify(value)),size=Buffer.alloc(8);size.writeBigUInt64LE(BigInt(header.length));return Buffer.concat([size,header,Buffer.alloc(4)]);};
  for(const bytes of [Buffer.alloc(8),huge,invalidHeader([]),invalidHeader({}),invalidHeader({weight:{dtype:"F32",shape:[1],data_offsets:[0,99]}}),invalidHeader({weight:{dtype:"F32",shape:[-1],data_offsets:[0,4]}}),invalidHeader({weight:{dtype:"F32",shape:[1],data_offsets:[0,4],extra:true}})]) {
    await writeFile(file,bytes);await writeFile(layout.manifestPath,JSON.stringify({...declared,checkpointBytes:bytes.length,checkpointSha256:sha(bytes)}));await assert.rejects(inspectImageHostInputBytes(root,run));
  }
}));
test("hard-linked inputs are not accepted as isolated regular snapshots",()=>fixture(async({root,file})=>{
  const alias=path.join(root,"alias.safetensors");await link(file,alias);await assert.rejects(inspectImageHostInputBytes(root,run));await unlink(alias);
  assert.equal((await inspectImageHostInputBytes(root,run)).authorityGranted,false);
}));
test("a linked declared file is denied without reading the linked payload",async context=>fixture(async({root,file,bytes})=>{
  const target=path.join(root,"other-input.safetensors");await writeFile(target,bytes);await unlink(file);
  try{await symlink(target,file,"file");}catch(error){if(["EPERM","EACCES"].includes(error.code)){context.skip("The host does not permit creating this owned symlink fixture.");return;}throw error;}
  await assert.rejects(inspectImageHostInputBytes(root,run));assert.deepEqual(await readFile(target),bytes);
}));
