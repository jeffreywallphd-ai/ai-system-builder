import test from "node:test";
import assert from "node:assert/strict";
import {PassThrough} from "node:stream";
import {spawn} from "node:child_process";
import {once} from "node:events";
import {IMAGE_STOP_COMMAND,IMAGE_STOP_PREFIX,readImageShutdownAck,observeImageHostShutdown,installImageHostShutdown} from "../visual-composer/image-host-shutdown.mjs";
const run="image-shutdown-synthetic-20261029",source="source."+"a".repeat(64);
const record=()=>({schemaVersion:"image-host-shutdown-v1",runId:run,sourceRevision:source,pid:123,status:"stopped",backgroundTasksStopped:true,persistenceClosed:true,fullJobQualified:false});
test("acknowledgment binds every field and supplies no full-job proof",()=>{
  const line=IMAGE_STOP_PREFIX+JSON.stringify(record());assert.equal(readImageShutdownAck(line,run,source,123).fullJobQualified,false);
  for(const patch of [{pid:124},{runId:run+"x"},{sourceRevision:"source."+"b".repeat(64)},{status:"failed"},{backgroundTasksStopped:false},{persistenceClosed:false},{fullJobQualified:true},{extra:true}])assert.throws(()=>readImageShutdownAck(IMAGE_STOP_PREFIX+JSON.stringify({...record(),...patch}),run,source,123));
  for(const value of ["",line+"x","x".repeat(4097),null,{},123])assert.throws(()=>readImageShutdownAck(value,run,source,123));
  assert.throws(()=>observeImageHostShutdown({pid:123},run,source));
});
async function protocol(chunks,{failure=false}={}){
  const input=new PassThrough(),output=new PassThrough();let text="",calls=0,settled;
  output.on("data",chunk=>{text+=chunk;});
  const done=new Promise(resolve=>{settled=resolve;});
  installImageHostShutdown({input,output,runId:run,sourceRevision:source,shutdown:async()=>{calls++;if(failure)throw false;},onSettled:settled});
  for(const chunk of chunks)input.write(chunk);input.end();
  const passed=await done;return {passed,calls,value:JSON.parse(text.trim().slice(IMAGE_STOP_PREFIX.length))};
}
test("only the exact split fixed command acknowledges drained persistence",async()=>{
  const result=await protocol([IMAGE_STOP_COMMAND.slice(0,5),IMAGE_STOP_COMMAND.slice(5)]);
  assert.equal(result.passed,true);assert.equal(result.calls,1);assert.equal(result.value.status,"stopped");assert.equal(result.value.fullJobQualified,false);
});
test("EOF, malformed, duplicate and falsy drain failures cannot acknowledge success",async()=>{
  for(const chunks of [[],["stop"],[IMAGE_STOP_COMMAND+IMAGE_STOP_COMMAND],["arbitrary-command\n"]]){
    const result=await protocol(chunks);assert.equal(result.passed,false);assert.equal(result.calls,1);assert.equal(result.value.status,"failed");
  }
  const failure=await protocol([IMAGE_STOP_COMMAND],{failure:true});assert.equal(failure.passed,false);assert.equal(failure.value.persistenceClosed,false);
});
test("actual inert owned Node child must acknowledge before clean exit",async()=>{
  // Only fixed code importing this protocol; no caller PID, executable, path or command.
  const url=new URL("../visual-composer/image-host-shutdown.mjs",import.meta.url).href;
  const program=`import {installImageHostShutdown} from ${JSON.stringify(url)}; installImageHostShutdown({input:process.stdin,output:process.stdout,runId:${JSON.stringify(run)},sourceRevision:${JSON.stringify(source)},shutdown:async()=>{},onSettled:passed=>{process.exitCode=passed?0:1;}});`;
  const child=spawn(process.execPath,["--input-type=module","-e",program],{stdio:["pipe","pipe","pipe"],windowsHide:true});
  child.stderr.resume();
  const observed=observeImageHostShutdown(child,run,source);
  const result=await observed.stop();assert.equal(result.pid,child.pid);assert.equal(result.fullJobQualified,false);
});
test("actual inert children with missing, foreign, duplicate acknowledgments or nonzero exit remain failed",async()=>{
  for(const mode of ["missing","foreign","duplicate","nonzero"]){
    const value={...record(),pid:0,runId:mode==="foreign"?run+"x":run};
    const program=`let b="";process.stdin.on("data",c=>b+=c);process.stdin.on("end",()=>{const v=${JSON.stringify(value)};v.pid=process.pid;const line=${JSON.stringify(IMAGE_STOP_PREFIX)}+JSON.stringify(v)+"\\n";if(${JSON.stringify(mode)}!=="missing")process.stdout.write(line);if(${JSON.stringify(mode)}==="duplicate")process.stdout.write(line);process.exitCode=${mode==="nonzero"?1:0};});`;
    const child=spawn(process.execPath,["-e",program],{stdio:["pipe","pipe","pipe"],windowsHide:true});child.stderr.resume();const closed=once(child,"close");
    await assert.rejects(observeImageHostShutdown(child,run,source).stop());await closed;
  }
});
