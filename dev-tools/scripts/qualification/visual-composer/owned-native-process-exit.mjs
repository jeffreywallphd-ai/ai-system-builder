import {spawn} from "node:child_process";
import path from "node:path";
import {types} from "node:util";

const invalid=()=>new Error("Owned native process exit observation failed.");
const pidValue=value=>Number.isInteger(value)&&value>=1&&value<=0xffffffff;
const exitValue=value=>Number.isInteger(value)&&value>=0&&value<=0xffffffff;
function rootOption(options) {
  if(options===undefined)return undefined;
  if(!options||typeof options!=="object"||types.isProxy(options)||![Object.prototype,null].includes(Object.getPrototypeOf(options)))throw invalid();
  const keys=Reflect.ownKeys(options);
  if(keys.length!==1||keys[0]!=="rootPid")throw invalid();
  const field=Object.getOwnPropertyDescriptor(options,"rootPid");
  if(!field||!("value" in field)||!pidValue(field.value))throw invalid();
  return field.value;
}
const exact=(record,keys)=>record&&typeof record==="object"&&!Array.isArray(record)&&Object.keys(record).length===keys.length&&keys.every(key=>Object.hasOwn(record,key));

/** Data-only framing oracle. It cannot launch, inspect or stop a process. */
export function createOwnedNativeExitProtocol(pid,options) {
  if(!pidValue(pid))throw invalid();
  const rootPid=rootOption(options);let admission,result,failed=false;
  return Object.freeze({
    accept(line) {
      try {
        if(failed||typeof line!=="string"||Buffer.byteLength(line)>4096)throw invalid();
        const record=JSON.parse(line);
        if(record?.phase==="ready"&&!admission&&!result) {
          if(rootPid===undefined) {
            if(!exact(record,["phase","pid"])||record.pid!==pid)throw invalid();
            admission=Object.freeze({pid});
          }else {
            if(!exact(record,["phase","pid","rootPid","parentPid","chain"])||record.pid!==pid||record.rootPid!==rootPid||!pidValue(record.parentPid))throw invalid();
            const chain=record.chain;
            if(!Array.isArray(chain)||chain.length<1||chain.length>3||!chain.every(pidValue)||new Set(chain).size!==chain.length||chain[0]!==pid||chain.at(-1)!==rootPid||(chain.length>1?chain[1]!==record.parentPid:pid!==rootPid))throw invalid();
            admission=Object.freeze({pid,rootPid,parentPid:record.parentPid,chain:Object.freeze([...chain])});
          }
          return "ready";
        }
        if(record?.phase!=="exited"||!admission||result||record.pid!==pid||!exitValue(record.exitCode))throw invalid();
        if(rootPid===undefined) {
          if(!exact(record,["phase","pid","exitCode"]))throw invalid();
          result=Object.freeze({...record});
        }else {
          if(!exact(record,["phase","pid","exitCode","rootPid","retired"])||record.rootPid!==rootPid)throw invalid();
          const targets=admission.chain.length===1?admission.chain:admission.chain.slice(0,-1);
          if(!Array.isArray(record.retired)||record.retired.length!==targets.length||!record.retired.every((entry,index)=>exact(entry,["pid","exitCode"])&&entry.pid===targets[index]&&exitValue(entry.exitCode))||record.retired[0].exitCode!==record.exitCode)throw invalid();
          result=Object.freeze({...record,retired:Object.freeze(record.retired.map(entry=>Object.freeze({...entry})))});
        }
        return "exited";
      }catch {failed=true;throw invalid();}
    },
    finish(){if(failed||!admission||!result)throw invalid();return result;},
    get admission(){return admission;},
  });
}

export async function observeOwnedNativeProcessExit(pid,options) {
  const rootPid=rootOption(options),protocol=createOwnedNativeExitProtocol(pid,rootPid===undefined?undefined:{rootPid});
  if(process.platform!=="win32")throw invalid();
  const args=["-s","-B",path.resolve("dev-tools/scripts/qualification/observe_windows_process_exit.py"),String(pid)];
  if(rootPid!==undefined)args.push("--root-pid",String(rootPid));
  const child=spawn("python",args,{windowsHide:true,stdio:["ignore","pipe","ignore"]});
  let readyResolve,readyReject,exitResolve,exitReject;
  const ready=new Promise((resolve,reject)=>{readyResolve=resolve;readyReject=reject;});
  const outcome=new Promise((resolve,reject)=>{exitResolve=resolve;exitReject=reject;});
  ready.catch(()=>{});outcome.catch(()=>{});
  let buffer="",totalBytes=0,failed=false;
  const reject=()=>{failed=true;const error=invalid();readyReject(error);exitReject(error);};
  // This stops only the helper we just spawned, never the observed target.
  const abort=()=>{child.kill();reject();};
  const timer=setTimeout(abort,35000);
  child.on("error",reject);
  child.stdout.on("data",bytes=>{
    totalBytes+=bytes.length;if(totalBytes>4096){abort();return;}
    buffer+=String(bytes);
    while(!failed&&buffer.includes("\n")) {
      const index=buffer.indexOf("\n"),line=buffer.slice(0,index);buffer=buffer.slice(index+1);
      try {if(protocol.accept(line)==="ready")readyResolve();}catch{abort();}
    }
  });
  child.once("close",(code,signal)=>{
    clearTimeout(timer);
    try {if(failed||code!==0||signal!==null||buffer!=="")throw invalid();exitResolve(protocol.finish());}catch{reject();}
  });
  await ready;
  return Object.freeze({admission:protocol.admission,outcome,async close(){if(child.exitCode===null&&child.signalCode===null)child.kill();await outcome.catch(()=>{});}});
}
