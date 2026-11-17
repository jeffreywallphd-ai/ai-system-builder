import assert from "node:assert/strict";
import test from "node:test";
import {spawn} from "node:child_process";
import {once} from "node:events";
import {createOwnedNativeExitProtocol,observeOwnedNativeProcessExit} from "../visual-composer/owned-native-process-exit.mjs";

const ready={phase:"ready",pid:300,rootPid:100,parentPid:200,chain:[300,200,100]};
const exited={phase:"exited",pid:300,rootPid:100,exitCode:0,retired:[{pid:300,exitCode:0},{pid:200,exitCode:0}]};
const send=(protocol,record)=>protocol.accept(JSON.stringify(record));
test("old PID-only frames keep their result shape",()=>{
  const p=createOwnedNativeExitProtocol(300);assert.equal(send(p,{phase:"ready",pid:300}),"ready");
  send(p,{phase:"exited",pid:300,exitCode:23});assert.deepEqual(p.finish(),{phase:"exited",pid:300,exitCode:23});
  assert.deepEqual(p.admission,{pid:300});
});
test("root-bound frames retain the immediate launcher and both real exit facts",()=>{
  const p=createOwnedNativeExitProtocol(300,{rootPid:100});send(p,ready);send(p,exited);
  assert.deepEqual(p.admission,{pid:300,rootPid:100,parentPid:200,chain:[300,200,100]});assert.deepEqual(p.finish(),exited);
  assert(Object.isFrozen(p.admission.chain));assert(Object.isFrozen(p.finish().retired[0]));
});
test("same-process root is itself the sole retirement target",()=>{
  const p=createOwnedNativeExitProtocol(300,{rootPid:300});send(p,{...ready,rootPid:300,chain:[300]});
  send(p,{...exited,rootPid:300,retired:[{pid:300,exitCode:0}]});assert.equal(p.finish().retired.length,1);
});
for(const root of [undefined,null,false,0,-1,0x100000000,"100",1.5])test(`explicit invalid root cannot fall back: ${String(root)}`,()=>{
  assert.throws(()=>createOwnedNativeExitProtocol(300,{rootPid:root}));
});
test("options are copied once without invoking getters or proxy traps",()=>{
  let calls=0;
  for(const options of [{},Object.create(null),new Proxy({},{get(){calls++;throw 0;},ownKeys(){calls++;throw 0;}}),Object.defineProperty({},"rootPid",{get(){calls++;return 100;}}),{rootPid:100,other:true}])assert.throws(()=>createOwnedNativeExitProtocol(300,options));
  assert.equal(calls,0);const options={rootPid:100},p=createOwnedNativeExitProtocol(300,options);options.rootPid=1;send(p,ready);send(p,exited);assert.equal(p.finish().rootPid,100);
});
for(const change of [{pid:301},{rootPid:101},{parentPid:100},{chain:[300,200,100,50]},{chain:[300,300,100]},{chain:[300,100]},{chain:[300,null,100]},{extra:true}])test(`invalid root admission is permanently denied: ${JSON.stringify(change)}`,()=>{
  const p=createOwnedNativeExitProtocol(300,{rootPid:100});assert.throws(()=>send(p,{...ready,...change}));assert.throws(()=>send(p,ready));assert.throws(()=>p.finish());
});
for(const change of [{rootPid:101},{pid:301},{exitCode:-1},{exitCode:0x100000000},{exitCode:false},{retired:[{pid:300,exitCode:0}]},{retired:[{pid:200,exitCode:0},{pid:300,exitCode:0}]},{retired:[{pid:300,exitCode:1},{pid:200,exitCode:0}]},{retired:[{pid:300,exitCode:0},{pid:200,exitCode:0},{pid:100,exitCode:0}]},{extra:true}])test(`incomplete or mismatched retirement cannot pass: ${JSON.stringify(change)}`,()=>{
  const p=createOwnedNativeExitProtocol(300,{rootPid:100});send(p,ready);assert.throws(()=>send(p,{...exited,...change}));assert.throws(()=>p.finish());
});
test("duplicate, out-of-order, unknown, oversized and incomplete frames cannot pass",()=>{
  for(const frames of [[exited],[ready,ready],[ready,exited,exited],[{phase:"unknown",pid:300}],[ready]]) {
    const p=createOwnedNativeExitProtocol(300,{rootPid:100});assert.throws(()=>{for(const record of frames)send(p,record);p.finish();});
  }
  for(const line of ["{",null,"x".repeat(4097)])assert.throws(()=>createOwnedNativeExitProtocol(300).accept(line));
  for(const pid of [false,0,-1,0x100000000,"300"])assert.throws(()=>createOwnedNativeExitProtocol(pid));
});
test("old mode refuses root fields and arbitrary exit facts",()=>{
  const p=createOwnedNativeExitProtocol(300);assert.throws(()=>send(p,ready));
  const other=createOwnedNativeExitProtocol(300);send(other,{phase:"ready",pid:300});assert.throws(()=>send(other,{phase:"exited",pid:300,exitCode:0,extra:true}));
});
test("Windows wrapper admits and observes its own fresh inert Python child",{skip:process.platform!=="win32"||process.arch!=="x64",timeout:45000},async()=>{
  const child=spawn("python",["-I","-B","-u","-c","import os,sys,json; print(json.dumps({'pid':os.getpid(),'parentPid':os.getppid()}),flush=True); sys.stdin.read(1)"],{windowsHide:true,stdio:["pipe","pipe","ignore"]});
  const closed=once(child,"close");let observer;
  const timer=setTimeout(()=>child.stdin.end("x"),15000);
  try {
    const identity=await new Promise((resolve,reject)=>{
      let text="";child.once("error",reject);child.once("close",()=>reject(Error("Inert child ended before identity.")));
      child.stdout.on("data",bytes=>{
        text+=String(bytes);if(text.length>512){reject(Error("Inert identity bound exceeded."));return;}
        if(text.includes("\n")){try{resolve(JSON.parse(text));}catch{reject(Error("Invalid inert identity."));}}
      });
    });
    observer=await observeOwnedNativeProcessExit(identity.pid,{rootPid:process.pid});
    assert.equal(observer.admission.parentPid,identity.parentPid);
    assert.equal(observer.admission.chain[0],identity.pid);assert.equal(observer.admission.chain.at(-1),process.pid);
    child.stdin.end("x");assert.deepEqual(await closed,[0,null]);
    const result=await observer.outcome;assert.equal(result.exitCode,0);
    assert.deepEqual(result.retired.map(row=>row.pid),observer.admission.chain.slice(0,-1));
  }finally{clearTimeout(timer);if(!child.stdin.destroyed)child.stdin.end("x");await closed;await observer?.close();}
});
