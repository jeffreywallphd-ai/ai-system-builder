import {spawn} from "node:child_process";
import path from "node:path";

export async function observeOwnedNativeProcessExit(pid) {
  if(process.platform!=="win32" || !Number.isInteger(pid) || pid<1 || pid>0xffffffff)throw new Error("Invalid owned native process identity.");
  const child=spawn("python",["-s","-B",path.resolve("dev-tools/scripts/qualification/observe_windows_process_exit.py"),String(pid)],{windowsHide:true,stdio:["ignore","pipe","ignore"]});
  let readyResolve,readyReject,exitResolve,exitReject;
  const ready=new Promise((resolve,reject)=>{readyResolve=resolve;readyReject=reject;});
  const outcome=new Promise((resolve,reject)=>{exitResolve=resolve;exitReject=reject;});
  // Observe rejection immediately even while waiting for the admission handshake.
  outcome.catch(()=>{});
  let buffer="",result,admitted=false;
  const reject=()=>{const error=new Error("Owned native process exit observation failed.");readyReject(error);exitReject(error);};
  const timer=setTimeout(()=>{child.kill();reject();},35000);
  child.on("error",reject);
  child.stdout.on("data",bytes=>{
    buffer+=String(bytes);if(buffer.length>4096){child.kill();reject();return;}
    while(buffer.includes("\n")) {
      const index=buffer.indexOf("\n"),line=buffer.slice(0,index);buffer=buffer.slice(index+1);
      try {const record=JSON.parse(line);if(record.pid!==pid)throw new Error();
        if(record.phase==="ready" && !admitted){admitted=true;readyResolve();}
        else if(record.phase==="exited" && admitted && !result && Number.isInteger(record.exitCode))result=record;
        else throw new Error();
      }catch{child.kill();reject();}
    }
  });
  child.once("close",(code,signal)=>{clearTimeout(timer);if(code===0 && signal===null && admitted && result)exitResolve(result);else reject();});
  await ready;
  return {outcome,async close(){if(child.exitCode===null && child.signalCode===null)child.kill();await outcome.catch(()=>{});}};
}
