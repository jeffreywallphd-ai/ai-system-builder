import test from "node:test";
import assert from "node:assert/strict";
import {PassThrough} from "node:stream";
import {spawn} from "node:child_process";
import {ownedHostShutdownProtocol,readOwnedHostShutdownAck,observeOwnedHostShutdown,installOwnedHostShutdown,OWNED_HOST_STOP_TIMEOUT_MS} from "../visual-composer/owned-host-shutdown.mjs";
import {IMAGE_STOP_COMMAND,IMAGE_STOP_PREFIX,IMAGE_STOP_TIMEOUT_MS} from "../visual-composer/image-host-shutdown.mjs";
const run="settings-shutdown-fixture-20261029",source="source."+"a".repeat(64),p=ownedHostShutdownProtocol("settings");
const record=()=>({schemaVersion:p.schemaVersion,runId:run,sourceRevision:source,pid:123,status:"stopped",backgroundTasksStopped:true,persistenceClosed:true,fullJobQualified:false});
test("finite purposes preserve every image wire byte and bound",()=>{
  assert.equal(IMAGE_STOP_COMMAND,"stop-image-host-v1\n");assert.equal(IMAGE_STOP_PREFIX,"AISB_IMAGE_HOST_SHUTDOWN ");assert.equal(IMAGE_STOP_TIMEOUT_MS,45000);assert.equal(OWNED_HOST_STOP_TIMEOUT_MS,45000);
  for(const v of ["all","__proto__","toString",null,{},["settings"]])assert.throws(()=>ownedHostShutdownProtocol(v));
});
test("Settings acknowledgment binds actual child identity and cannot be substituted with an image or full-job pass",()=>{
  assert.equal(readOwnedHostShutdownAck("settings",p.prefix+JSON.stringify(record()),run,source,123).fullJobQualified,false);
  for(const patch of [{schemaVersion:"image-host-shutdown-v1"},{runId:run+"x"},{sourceRevision:"source."+"b".repeat(64)},{pid:124},{status:"failed"},{backgroundTasksStopped:false},{persistenceClosed:false},{fullJobQualified:true},{extra:true}])
    assert.throws(()=>readOwnedHostShutdownAck("settings",p.prefix+JSON.stringify({...record(),...patch}),run,source,123));
  assert.throws(()=>observeOwnedHostShutdown("settings",{pid:123},run,source));
});
async function protocol(chunks,failure=false){
  const input=new PassThrough(),output=new PassThrough();let body="",calls=0,settle;output.on("data",c=>body+=c);const done=new Promise(resolve=>settle=resolve);
  installOwnedHostShutdown("settings",{input,output,runId:run,sourceRevision:source,shutdown:async()=>{calls++;if(failure)throw false;},onSettled:settle});
  for(const c of chunks)input.write(c);input.end();return {passed:await done,calls,value:JSON.parse(body.trim().slice(p.prefix.length))};
}
test("only the exact Settings command acknowledges one successful canonical drain",async()=>{
  const good=await protocol([p.command.slice(0,5),p.command.slice(5)]);assert.equal(good.passed,true);assert.equal(good.calls,1);assert.equal(good.value.status,"stopped");
  for(const chunks of [[],["stop"],[IMAGE_STOP_COMMAND],[p.command+p.command],["arbitrary\n"]]){const bad=await protocol(chunks);assert.equal(bad.passed,false);assert.equal(bad.calls,1);assert.equal(bad.value.status,"failed");}
  const bad=await protocol([p.command],true);assert.equal(bad.passed,false);assert.equal(bad.value.persistenceClosed,false);
});
test("a real inert owned Settings child must acknowledge the fixed command and close cleanly",async()=>{
  const url=new URL("../visual-composer/owned-host-shutdown.mjs",import.meta.url).href;
  const program=`import {installOwnedHostShutdown} from ${JSON.stringify(url)};installOwnedHostShutdown("settings",{input:process.stdin,output:process.stdout,runId:${JSON.stringify(run)},sourceRevision:${JSON.stringify(source)},shutdown:async()=>{},onSettled:passed=>{process.exitCode=passed?0:1;}});`;
  const child=spawn(process.execPath,["--input-type=module","-e",program],{stdio:["pipe","pipe","pipe"],windowsHide:true});child.stderr.resume();
  const result=await observeOwnedHostShutdown("settings",child,run,source).stop();assert.equal(result.pid,child.pid);assert.equal(result.schemaVersion,"settings-host-shutdown-v1");assert.equal(result.fullJobQualified,false);
});

test("functional-data shutdown has its own bounded protocol and actual inert child proof",async()=>{
  const protocol=ownedHostShutdownProtocol("functional-data");
  assert.equal(protocol.command,"stop-functional-data-host-v1\n");assert.equal(protocol.prefix,"AISB_FUNCTIONAL_DATA_HOST_SHUTDOWN ");
  const value={...record(),schemaVersion:protocol.schemaVersion};
  assert.equal(readOwnedHostShutdownAck("functional-data",protocol.prefix+JSON.stringify(value),run,source,123).fullJobQualified,false);
  assert.throws(()=>readOwnedHostShutdownAck("functional-data",p.prefix+JSON.stringify(record()),run,source,123));
  const url=new URL("../visual-composer/owned-host-shutdown.mjs",import.meta.url).href;
  const program=`import {installOwnedHostShutdown} from ${JSON.stringify(url)};installOwnedHostShutdown("functional-data",{input:process.stdin,output:process.stdout,runId:${JSON.stringify(run)},sourceRevision:${JSON.stringify(source)},shutdown:async()=>{},onSettled:passed=>{process.exitCode=passed?0:1;}});`;
  const child=spawn(process.execPath,["--input-type=module","-e",program],{stdio:["pipe","pipe","pipe"],windowsHide:true});child.stderr.resume();
  const result=await observeOwnedHostShutdown("functional-data",child,run,source).stop();assert.equal(result.pid,child.pid);assert.equal(result.schemaVersion,protocol.schemaVersion);assert.equal(result.fullJobQualified,false);
});
