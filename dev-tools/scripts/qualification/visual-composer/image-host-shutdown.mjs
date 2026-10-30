import {ChildProcess} from "node:child_process";

export const IMAGE_STOP_COMMAND="stop-image-host-v1\n";
export const IMAGE_STOP_PREFIX="AISB_IMAGE_HOST_SHUTDOWN ";
export const IMAGE_STOP_TIMEOUT_MS=45_000;
const invalid=()=>new Error("The owned image server shutdown was not confirmed.");
function identity(runId,sourceRevision){
  if(typeof runId!=="string"||!/^[a-z0-9-]{20,80}$/.test(runId)||typeof sourceRevision!=="string"||!/^source\.[a-f0-9]{64}$/.test(sourceRevision))throw invalid();
}
export function readImageShutdownAck(line,runId,sourceRevision,pid){
  identity(runId,sourceRevision);
  if(typeof line!=="string"||Buffer.byteLength(line)>4096||!line.startsWith(IMAGE_STOP_PREFIX)||!Number.isInteger(pid)||pid<1||pid>0xffffffff)throw invalid();
  let value;try{value=JSON.parse(line.slice(IMAGE_STOP_PREFIX.length));}catch{throw invalid();}
  const keys=["schemaVersion","runId","sourceRevision","pid","status","backgroundTasksStopped","persistenceClosed","fullJobQualified"];
  if(!value||typeof value!=="object"||Array.isArray(value)||Object.keys(value).length!==keys.length||keys.some(key=>!Object.hasOwn(value,key))||
    value.schemaVersion!=="image-host-shutdown-v1"||value.runId!==runId||value.sourceRevision!==sourceRevision||value.pid!==pid||value.status!=="stopped"||
    value.backgroundTasksStopped!==true||value.persistenceClosed!==true||value.fullJobQualified!==false)throw invalid();
  return Object.freeze({...value});
}
/** Only the actual child returned by the fixed Server spawn can be observed. */
export function observeImageHostShutdown(child,runId,sourceRevision){
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
      if(line.startsWith(IMAGE_STOP_PREFIX)){
        if(!requested||ack)return failed();
        try{ack=readImageShutdownAck(line,runId,sourceRevision,child.pid);}catch{return failed();}
      }
    }
    if(Buffer.byteLength(buffer)>64*1024)failed();
  }
  function exited(code,signal){finish(!requested||!ack||code!==0||signal!==null||buffer.startsWith(IMAGE_STOP_PREFIX));}
  child.stdout.on("data",data);child.stdout.on("error",failed);child.once("close",exited);child.once("error",failed);child.stdin.on("error",failed);
  return Object.freeze({stop(){
    if(!requested){requested=true;if(child.exitCode!==null||child.signalCode!==null)failed();
      if(!settled){timer=setTimeout(failed,IMAGE_STOP_TIMEOUT_MS);child.stdin.end(IMAGE_STOP_COMMAND,error=>{if(error)failed();});}}
    return outcome;
  }});
}
/** Fixed stdin protocol, not an HTTP route. Callbacks are trusted composition. */
export function installImageHostShutdown({input,output,runId,sourceRevision,shutdown,onSettled}){
  identity(runId,sourceRevision);
  let bytes="",invalidInput=false,started=false;
  async function stop(valid=false){
    if(started){if(!valid)invalidInput=true;return;}started=true;
    let closed=false;try{await shutdown();closed=true;}catch{invalidInput=true;}
    const passed=valid&&!invalidInput&&closed;
    output.write(IMAGE_STOP_PREFIX+JSON.stringify({schemaVersion:"image-host-shutdown-v1",runId,sourceRevision,pid:process.pid,
      status:passed?"stopped":"failed",backgroundTasksStopped:closed,persistenceClosed:closed,fullJobQualified:false})+"\n");
    input.off("data",data);input.off("end",ended);input.off("error",ended);input.pause();onSettled(passed);
  }
  function data(chunk){
    if(started){invalidInput=true;return;}
    bytes+=chunk.toString("utf8");
    if(bytes.length>IMAGE_STOP_COMMAND.length||!IMAGE_STOP_COMMAND.startsWith(bytes)){invalidInput=true;void stop(false);}
    else if(bytes===IMAGE_STOP_COMMAND)void stop(true);
  }
  function ended(){if(!started){invalidInput=true;void stop(false);}}
  input.on("data",data);input.once("end",ended);input.once("error",ended);input.resume();
  return Object.freeze({stop:()=>stop(false)});
}
