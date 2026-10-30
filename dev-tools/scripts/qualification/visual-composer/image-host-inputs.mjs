import path from "node:path";
import {lstat,open,realpath} from "node:fs/promises";
import {createHash} from "node:crypto";
import {imageHostLayout,imageCheckpointName} from "./image-host-launch-plan.mjs";

export const IMAGE_INPUT_LIMITS=Object.freeze({manifestBytes:8192,checkpointBytes:4*1024**3,headerBytes:16*1024**2,readBytes:64*1024,tensors:100000});
const invalid=()=>new Error("The fixed local image inputs could not be verified.");
function requireValue(value){if(!value)throw invalid();}
function sameFile(a,b){return a.dev===b.dev&&a.ino===b.ino&&a.size===b.size&&a.mtimeMs===b.mtimeMs&&a.ctimeMs===b.ctimeMs&&b.nlink===1&&b.isFile()&&!b.isSymbolicLink();}
async function physicalParents(repoRoot,file) {
  const relative=path.relative(repoRoot,file);requireValue(relative&&!path.isAbsolute(relative)&&relative!==".."&&!relative.startsWith(`..${path.sep}`));
  const parts=path.dirname(relative).split(path.sep);
  for(let i=0;i<=parts.length;i++) {
    const current=path.join(repoRoot,...parts.slice(0,i)),info=await lstat(current);
    requireValue(info.isDirectory()&&!info.isSymbolicLink()&&await realpath(current)===current);
  }
}
async function readExactly(handle,bytes,position) {
  const result=Buffer.alloc(bytes);let offset=0;
  while(offset<bytes){const read=await handle.read(result,offset,bytes-offset,position+offset);requireValue(read.bytesRead>0);offset+=read.bytesRead;}
  return result;
}
async function readRegular(repoRoot,file,maximum,consume) {
  await physicalParents(repoRoot,file);
  const before=await lstat(file);requireValue(before.isFile()&&!before.isSymbolicLink()&&before.nlink===1&&Number.isSafeInteger(before.size)&&before.size>0&&before.size<=maximum&&await realpath(file)===file);
  const handle=await open(file,"r");
  try {
    const opened=await handle.stat();requireValue(sameFile(before,opened));
    const result=await consume(handle,opened.size);
    const tail=Buffer.alloc(1);requireValue((await handle.read(tail,0,1,opened.size)).bytesRead===0);
    requireValue(sameFile(opened,await handle.stat())&&sameFile(opened,await lstat(file))&&await realpath(file)===file);
    return result;
  }finally{await handle.close();}
}
function record(value,keys) {
  requireValue(value&&typeof value==="object"&&!Array.isArray(value)&&Object.keys(value).length===keys.length&&keys.every(key=>Object.hasOwn(value,key)));
}
function manifest(text,runId) {
  const value=JSON.parse(text);
  record(value,["schemaVersion","runId","checkpointFileName","checkpointSha256","checkpointBytes","comfyCommitSha"]);
  requireValue(value.schemaVersion==="image-host-input-manifest-v1"&&value.runId===runId&&imageCheckpointName(value.checkpointFileName)&&
    typeof value.checkpointSha256==="string"&&/^[a-f0-9]{64}$/.test(value.checkpointSha256)&&
    typeof value.comfyCommitSha==="string"&&/^[a-f0-9]{40}$/.test(value.comfyCommitSha)&&
    Number.isSafeInteger(value.checkpointBytes)&&value.checkpointBytes>=9&&value.checkpointBytes<=IMAGE_INPUT_LIMITS.checkpointBytes);
  return Object.freeze({...value});
}
function headerFields(header,payloadBytes) {
  requireValue(header&&typeof header==="object"&&!Array.isArray(header));
  const entries=Object.entries(header),tensors=entries.filter(([key])=>key!=="__metadata__");
  requireValue(tensors.length>0&&tensors.length<=IMAGE_INPUT_LIMITS.tensors);
  for(const [key,tensor] of tensors) {
    requireValue(key.length>0&&key.length<=4096);record(tensor,["dtype","shape","data_offsets"]);
    requireValue(typeof tensor.dtype==="string"&&/^[A-Z][A-Z0-9_]{0,15}$/.test(tensor.dtype)&&
      Array.isArray(tensor.shape)&&tensor.shape.length<=16&&tensor.shape.every(n=>Number.isSafeInteger(n)&&n>=0)&&
      Array.isArray(tensor.data_offsets)&&tensor.data_offsets.length===2&&tensor.data_offsets.every(n=>Number.isSafeInteger(n)&&n>=0&&n<=payloadBytes)&&tensor.data_offsets[0]<=tensor.data_offsets[1]);
  }
  if(Object.hasOwn(header,"__metadata__")) {
    const value=header.__metadata__;requireValue(value&&typeof value==="object"&&!Array.isArray(value)&&Object.keys(value).length<=1024&&Object.entries(value).every(([key,text])=>key.length<=4096&&typeof text==="string"&&Buffer.byteLength(text)<=1024**2));
  }
}
/** Read-only cooperative input snapshots. These are not native file/lease or supplier-integrity capabilities. */
export async function inspectImageHostInputBytes(repoRoot,runId) {
  try {
    const layout=imageHostLayout(repoRoot,runId);
    const declared=await readRegular(repoRoot,layout.manifestPath,IMAGE_INPUT_LIMITS.manifestBytes,async(handle,size)=>
      manifest(new TextDecoder("utf-8",{fatal:true}).decode(await readExactly(handle,size,0)),runId));
    const result=await readRegular(repoRoot,path.join(layout.checkpointRoot,declared.checkpointFileName),IMAGE_INPUT_LIMITS.checkpointBytes,async(handle,size)=>{
      requireValue(size===declared.checkpointBytes&&size>=9);
      const length=(await readExactly(handle,8,0)).readBigUInt64LE();
      requireValue(length>=2n&&length<=BigInt(IMAGE_INPUT_LIMITS.headerBytes)&&length<=BigInt(size-8));
      const headerSize=Number(length),header=JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(await readExactly(handle,headerSize,8)));
      headerFields(header,size-8-headerSize);
      const hash=createHash("sha256"),buffer=Buffer.alloc(IMAGE_INPUT_LIMITS.readBytes);let position=0;
      while(position<size){const read=await handle.read(buffer,0,Math.min(buffer.length,size-position),position);requireValue(read.bytesRead>0);hash.update(buffer.subarray(0,read.bytesRead));position+=read.bytesRead;}
      requireValue(hash.digest("hex")===declared.checkpointSha256);return {bytes:size};
    });
    return Object.freeze({schemaVersion:"image-host-file-inputs-v1",status:"bytes-match-declaration",runId,
      checkpointFileName:declared.checkpointFileName,checkpointSha256:declared.checkpointSha256,checkpointBytes:result.bytes,
      comfyCommitSha:declared.comfyCommitSha,authorityGranted:false,
      scope:"Bounded regular-file, safetensors header and hash snapshot only. No model compatibility, supplier integrity, native protection or launch qualification."});
  }catch{throw invalid();}
}
