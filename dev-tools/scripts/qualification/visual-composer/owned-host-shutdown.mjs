import {ChildProcess} from "node:child_process";

const protocols=Object.freeze({
  image:Object.freeze({command:"stop-image-host-v1\n",prefix:"AISB_IMAGE_HOST_SHUTDOWN ",schemaVersion:"image-host-shutdown-v1"}),
  settings:Object.freeze({command:"stop-settings-host-v1\n",prefix:"AISB_SETTINGS_HOST_SHUTDOWN ",schemaVersion:"settings-host-shutdown-v1"}),
});
export const OWNED_HOST_STOP_TIMEOUT_MS=45_000;
export function ownedHostShutdownProtocol(purpose){
  if(typeof purpose!=="string"||!Object.hasOwn(protocols,purpose))throw new Error("Unsupported owned host shutdown purpose.");
  return protocols[purpose];
}
const invalid=()=>new Error("The owned server shutdown was not confirmed.");
function identity(runId,sourceRevision){
  if(typeof runId!=="string"||!/^[a-z0-9-]{20,80}$/.test(runId)||typeof sourceRevision!=="string"||!/^source\.[a-f0-9]{64}$/.test(sourceRevision))throw invalid();
}
export function readOwnedHostShutdownAck(purpose,line,runId,sourceRevision,pid){
  const protocol=ownedHostShutdownProtocol(purpose);
  identity(runId,sourceRevision);
  if(typeof line!=="string"||Buffer.byteLength(line)>4096||!line.startsWith(protocol.prefix)||!Number.isInteger(pid)||pid<1||pid>0xffffffff)throw invalid();
  let value;try{value=JSON.parse(line.slice(protocol.prefix.length));}catch{throw invalid();}
  const keys=["schemaVersion","runId","sourceRevision","pid","status","backgroundTasksStopped","persistenceClosed","fullJobQualified"];
  if(!value||typeof value!=="object"||Array.isArray(value)||Object.keys(value).length!==keys.length||keys.some(key=>!Object.hasOwn(value,key))||
    value.schemaVersion!==protocol.schemaVersion||value.runId!==runId||value.sourceRevision!==sourceRevision||value.pid!==pid||value.status!=="stopped"||
    value.backgroundTasksStopped!==true||value.persistenceClosed!==true||value.fullJobQualified!==false)throw invalid();
  return Object.freeze({...value});
}
/** Only the actual child returned by the fixed Server spawn can be observed. */
export function observeOwnedHostShutdown(purpose,child,runId,sourceRevision){
  const protocol=ownedHostShutdownProtocol(purpose);
  identity(runId,sourceRevision);
  if(!(child instanceof ChildProcess)||!Number.isInteger(child.pid)||!child.stdin||!child.stdout)throw invalid();
  let requested=false,ack,buffer="",total=0,settled=false,timer,resolve,reject;
  const outcome=new Promise((yes,no)=>{resolve=yes;reject=no;});outcome.catch(()=>{});
  function finish(error){
    if(settled)return;settled=true;clearTimeout(timer);
    child.stdout.off("data",data);child.stdout.off("error",failed);child.off("close",exited);child.off("error",failed);child.stdin.off("error",failed);
    if(error)reject(invalid());else resolve(ack);
  }
  function failed(){finish(true);}
  function data(chunk){
    total+=chunk.length;if(total>8*1024**2)return failed();
    buffer+=chunk.toString("utf8");
    for(;;){const index=buffer.indexOf("\n");if(index<0)break;
      const line=buffer.slice(0,index).replace(/\r$/,"" );buffer=buffer.slice(index+1);
      if(line.startsWith(protocol.prefix)){
        if(!requested||ack)return failed();
        try{ack=readOwnedHostShutdownAck(purpose,line,runId,sourceRevision,child.pid);}catch{return failed();}
      }
    }
    if(Buffer.byteLength(buffer)>64*1024)failed();
  }
  function exited(code,signal){finish(!requested||!ack||code!==0||signal!==null||buffer.startsWith(protocol.prefix));}
  child.stdout.on("data",data);child.stdout.on("error",failed);child.once("close",exited);child.once("error",failed);child.stdin.on("error",failed);
  return Object.freeze({stop(){
    if(!requested){requested=true;if(child.exitCode!==null||child.signalCode!==null)failed();
      if(!settled){timer=setTimeout(failed,OWNED_HOST_STOP_TIMEOUT_MS);child.stdin.end(protocol.command,error=>{if(error)failed();});}}
    return outcome;
  }});
}
/** Fixed stdin protocol, not an HTTP route. Callbacks are trusted composition. */
export function installOwnedHostShutdown(purpose,{input,output,runId,sourceRevision,shutdown,onSettled}){
  const protocol=ownedHostShutdownProtocol(purpose);
  identity(runId,sourceRevision);
  let bytes="",invalidInput=false,started=false;
  async function stop(valid=false){
    if(started){if(!valid)invalidInput=true;return;}started=true;
    let closed=false;try{await shutdown();closed=true;}catch{invalidInput=true;}
    const passed=valid&&!invalidInput&&closed;
    output.write(protocol.prefix+JSON.stringify({schemaVersion:protocol.schemaVersion,runId,sourceRevision,pid:process.pid,
      status:passed?"stopped":"failed",backgroundTasksStopped:closed,persistenceClosed:closed,fullJobQualified:false})+"\n");
    input.off("data",data);input.off("end",ended);input.off("error",ended);input.pause();onSettled(passed);
  }
  function data(chunk){
    if(started){invalidInput=true;return;}
    bytes+=chunk.toString("utf8");
    if(bytes.length>protocol.command.length||!protocol.command.startsWith(bytes)){invalidInput=true;void stop(false);}
    else if(bytes===protocol.command)void stop(true);
  }
  function ended(){if(!started){invalidInput=true;void stop(false);}}
  input.on("data",data);input.once("end",ended);input.once("error",ended);input.resume();
  return Object.freeze({stop:()=>stop(false)});
}
