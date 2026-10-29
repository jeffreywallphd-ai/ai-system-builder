// @vitest-environment node
import {beforeEach,afterEach,describe,it,expect,vi} from "vitest";
import type {ElectronApplication} from "playwright";
import type {TestInfo} from "@playwright/test";
import path from "node:path";

const io=vi.hoisted(()=>({files:new Map<string,string>(),directories:new Set<string>(),writes:[] as string[],closeErrors:[] as unknown[],observerErrors:[] as unknown[],attachErrors:[] as unknown[],writeErrors:[] as unknown[],nativeErrors:[] as unknown[],workerOutcomeErrors:[] as unknown[],nativeCalls:[] as {pid:number;rootPid:number;closed:boolean}[],nativeWorkerParent:401,sameMainRoot:false,ack:"",closed:false,closes:0,disposed:0,evaluations:0,reads:0}));
vi.mock("node:fs/promises",()=>({
  mkdir:async()=>undefined,
  realpath:async(value:string)=>value,
  lstat:async(value:string)=>{
    io.reads++;if(io.directories.has(value))return {size:0,isSymbolicLink:()=>false};
    const contents=io.files.get(value);
    if(contents===undefined)throw Object.assign(new Error("Synthetic absent file."),{code:"ENOENT"});
    return {size:Buffer.byteLength(contents),isSymbolicLink:()=>false};
  },
  readFile:async(value:string)=>{io.reads++;const contents=io.files.get(value);if(contents===undefined)throw new Error("Synthetic file missing.");return contents;},
  readdir:async()=>["qualification-worker-identity-501.json"],
  writeFile:async(value:string,body:string,options:{flag:string})=>{
    expect(options.flag).toBe("wx");io.writes.push(body);
    if(io.writeErrors.length)throw io.writeErrors.shift();
    if(io.files.has(value))throw Object.assign(new Error("Synthetic exclusive-create refusal."),{code:"EEXIST"});
    io.files.set(value,body);
  },
}));
vi.mock("../visual-composer/owned-native-process-exit.mjs",()=>({observeOwnedNativeProcessExit:async(pid:number,{rootPid}:{rootPid:number})=>{
  io.nativeCalls.push({pid,rootPid,closed:io.closed});if(io.nativeErrors.length)throw io.nativeErrors.shift();
  const parentPid=pid===401?301:io.nativeWorkerParent;
  const outcome=pid===501&&io.workerOutcomeErrors.length?Promise.reject(io.workerOutcomeErrors.shift()):Promise.resolve({exitCode:0});outcome.catch(()=>{});
  return {admission:{pid,rootPid,parentPid,chain:pid===rootPid?[pid]:parentPid===rootPid?[pid,rootPid]:[pid,parentPid,rootPid]},
    outcome,close:async()=>{io.disposed++;if(io.observerErrors.length)throw io.observerErrors.shift();}};
}}));

import {closeDesktopAndQualifyOwnedWorkers,persistOwnedHostReport} from "../visual-composer/e2e/desktop-task-cleanup";
import {closeImportedFileDesktop} from "../visual-composer/e2e/desktop-import-cleanup";
const cache=path.resolve("artifacts/qualification/visual-composer/d/synthetic-cleanup-fixture");
const attachments:string[]=[];
function app():ElectronApplication {
  return {process:()=>({pid:io.sameMainRoot?401:301}),evaluate:async(_callback:unknown,argument?:unknown)=>{
    io.evaluations++;if(typeof argument==="string"){io.ack=argument;return 401;}return {pid:401,ppid:301};
  },close:async()=>{io.closes++;io.closed=true;if(io.ack)io.files.set(io.ack,JSON.stringify({pid:401,event:"will-quit"}));if(io.closeErrors.length)throw io.closeErrors.shift();}} as unknown as ElectronApplication;
}
function info():TestInfo {
  return {project:{name:"packaged-desktop"},title:"Synthetic owned cleanup",attach:async(_name:string,attachment:{body:string})=>{
    attachments.push(attachment.body);if(io.attachErrors.length)throw io.attachErrors.shift();
  }} as unknown as TestInfo;
}
async function caught(action:()=>Promise<unknown>){try{await action();return undefined;}catch(error){return error;}}
beforeEach(()=>{
  io.files.clear();io.directories.clear();io.directories.add(cache);io.writes=[];io.closeErrors=[];io.observerErrors=[];io.attachErrors=[];io.writeErrors=[];
  io.ack="";io.closed=false;io.closes=io.disposed=io.evaluations=io.reads=0;attachments.length=0;
  io.nativeErrors=[];io.workerOutcomeErrors=[];io.nativeCalls=[];io.nativeWorkerParent=401;io.sameMainRoot=false;
  io.files.set(path.join(cache,"qualification-worker-identity-501.json"),JSON.stringify({pid:501,parentPid:401}));
  vi.stubEnv("VISUAL_COMPOSER_QUALIFICATION_RUN_ID","synthetic-owned-cleanup-run-20261029");
  vi.stubEnv("VISUAL_COMPOSER_QUALIFICATION_SOURCE_REVISION","source."+"a".repeat(64));
  vi.spyOn(process,"kill").mockImplementation(()=>{throw Object.assign(new Error("Synthetic process already exited."),{code:"ESRCH"});});
});
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllEnvs();});
const variants=[
  {name:"worker cleanup",message:"Desktop owned shutdown qualification failed.",run:()=>closeDesktopAndQualifyOwnedWorkers(app(),cache,info())},
  {name:"file import cleanup",message:"Owned file-import desktop shutdown failed.",run:()=>closeImportedFileDesktop(app(),cache,info(),"complete")},
];
for(const variant of variants)describe(variant.name,()=>{
  it("retains the successful owned identity and disposal checks",async()=>{
    await variant.run();expect(io.closes).toBe(1);expect(io.disposed).toBe(1);
    expect(io.writes).toHaveLength(1);const report=JSON.parse(io.writes[0]!);
    expect(report.status).toBe("passed");expect(report.mainPid).toBe(401);expect(report.launchedPid).toBe(301);
    expect(report.willQuitAcknowledged).toBe(true);expect(report.failureTypes).toEqual([]);expect(report.failureStages).toEqual([]);
    if(variant.name==="worker cleanup")expect(process.kill).toHaveBeenCalledWith(501,0);
    else expect(process.kill).not.toHaveBeenCalled();
  });
  it("accepts the genuine same-process launch shape with root-bound native observation",async()=>{
    io.sameMainRoot=true;await variant.run();
    expect(io.nativeCalls[0]).toEqual({pid:401,rootPid:401,closed:false});
    expect(JSON.parse(io.writes[0]!).status).toBe("passed");
  });
  it.each([undefined,null,false,0,""])("retains a falsy app-close failure %#",async failure=>{
    io.closeErrors=[failure];const error=await caught(variant.run);
    expect(error).toBeInstanceOf(AggregateError);expect((error as AggregateError).message).toBe(variant.message);
    expect((error as AggregateError).errors).toEqual([failure]);expect(io.disposed).toBe(1);
    const report=JSON.parse(io.writes[0]!);expect(report.status).toBe("failed");expect(report.failureStages).toEqual(["app-close"]);
    expect(report.failureTypes).toEqual(["Unknown"]);
  });
  it("preserves close, observer disposal and attachment failures in order",async()=>{
    io.closeErrors=[false];io.observerErrors=[undefined];io.attachErrors=[null];
    const error=await caught(variant.run);expect(error).toBeInstanceOf(AggregateError);
    expect((error as AggregateError).errors).toEqual([false,undefined,null]);
    const report=JSON.parse(io.writes[0]!);expect(report.status).toBe("failed");expect(report.failureStages).toEqual(["app-close","observer-close"]);
    expect(report.finalizationStage).toBe("evidence-attach");expect(io.closes).toBe(1);expect(io.disposed).toBe(1);
  });
  it("retains both failed storage attempts without overwriting an unknown file",async()=>{
    io.writeErrors=[false,0];const error=await caught(variant.run);
    expect(error).toBeInstanceOf(AggregateError);expect((error as AggregateError).errors).toEqual([false,0]);
    expect(io.writes).toHaveLength(2);expect(JSON.parse(io.writes[1]!).status).toBe("failed");
    expect(JSON.parse(io.writes[1]!).finalizationStage).toBe("evidence-save");expect(io.disposed).toBe(1);
  });
  it("does not invoke or serialize exception name getters",async()=>{
    let reads=0;const privateFailure=new Error("synthetic-private-detail");
    Object.defineProperty(privateFailure,"name",{get(){reads++;throw new Error("synthetic-private-name");}});
    io.closeErrors=[privateFailure];const error=await caught(variant.run);expect(error).toBeInstanceOf(AggregateError);
    expect(reads).toBe(0);expect((error as AggregateError).errors[0]===privateFailure).toBe(true);
    for(const body of [...io.writes,...attachments])expect(body).not.toMatch(/synthetic-private-detail|synthetic-private-name/);
    expect(JSON.parse(io.writes[0]!).failureTypes).toEqual(["Unknown"]);
  });
});
function liveWorker(){
  vi.mocked(process.kill).mockImplementation(()=>{
    if(!io.closed)return true;
    throw Object.assign(new Error("Synthetic owned process exited."),{code:"ESRCH"});
  });
}
it("admits a live real-worker shape through its launcher before closing the app",async()=>{
  liveWorker();io.nativeWorkerParent=470;
  io.files.set(path.join(cache,"qualification-worker-identity-501.json"),JSON.stringify({pid:501,parentPid:470}));
  await closeDesktopAndQualifyOwnedWorkers(app(),cache,info());
  expect(io.nativeCalls).toEqual([{pid:401,rootPid:301,closed:false},{pid:501,rootPid:401,closed:false}]);
  expect(io.disposed).toBe(2);expect(JSON.parse(io.writes[0]!).status).toBe("passed");
});
it("a confirmed native exit is not overridden by an unrelated process reusing that number",async()=>{
  vi.mocked(process.kill).mockReturnValue(true);
  await closeDesktopAndQualifyOwnedWorkers(app(),cache,info());
  expect(vi.mocked(process.kill).mock.calls).toEqual([[501,0]]);
  expect(JSON.parse(io.writes[0]!).status).toBe("passed");expect(io.disposed).toBe(2);
},10_000);
it("a refused native exit remains failed without a numeric-PID polling fallback",async()=>{
  liveWorker();io.workerOutcomeErrors=[false];
  const error=await caught(()=>closeDesktopAndQualifyOwnedWorkers(app(),cache,info()));
  expect(error).toBeInstanceOf(AggregateError);expect((error as AggregateError).errors).toEqual([false]);
  expect(vi.mocked(process.kill).mock.calls).toEqual([[501,0]]);
  expect(JSON.parse(io.writes[0]!).failureStages).toEqual(["worker-exit"]);expect(io.disposed).toBe(2);expect(io.closes).toBe(1);
});
it("rejects a marker whose immediate parent disagrees with native observation, without rewriting it",async()=>{
  liveWorker();io.nativeWorkerParent=470;
  const error=await caught(()=>closeDesktopAndQualifyOwnedWorkers(app(),cache,info()));
  expect(error).toBeInstanceOf(AggregateError);expect(io.closes).toBe(1);expect(io.disposed).toBe(2);
  expect(JSON.parse(io.writes[0]!).failureStages).toEqual(["worker-admission"]);
  expect(JSON.parse(io.files.get(path.join(cache,"qualification-worker-identity-501.json"))!).parentPid).toBe(401);
});
it("does not downgrade refused live native admission to a PID-absence pass",async()=>{
  liveWorker();const original=app();
  // Admit the main first, then refuse precisely the worker observation.
  const close=original.close.bind(original);
  original.close=async()=>{await close();};
  const native=io.nativeCalls;
  vi.mocked(process.kill).mockImplementation(()=>{
    if(!io.closed&&native.length===1)io.nativeErrors.push(false);
    if(!io.closed)return true;
    throw Object.assign(new Error("Synthetic process exited."),{code:"ESRCH"});
  });
  const error=await caught(()=>closeDesktopAndQualifyOwnedWorkers(original,cache,info()));
  expect(error).toBeInstanceOf(AggregateError);expect((error as AggregateError).errors).toEqual([false]);
  expect(JSON.parse(io.writes[0]!).failureStages).toEqual(["worker-admission"]);expect(io.disposed).toBe(1);expect(io.closes).toBe(1);
});
it("keeps an already-exited nested worker unqualified because its ancestry cannot be observed",async()=>{
  io.files.set(path.join(cache,"qualification-worker-identity-501.json"),JSON.stringify({pid:501,parentPid:470}));
  const error=await caught(()=>closeDesktopAndQualifyOwnedWorkers(app(),cache,info()));
  expect(error).toBeInstanceOf(AggregateError);expect(io.nativeCalls).toHaveLength(1);
  expect(JSON.parse(io.writes[0]!).failureStages).toEqual(["worker-admission"]);
});
it("import cleanup rejects unsupported host, mode and stage before any app or file effects",async()=>{
  const poisoned=new Proxy({}, {get(){throw new Error("Unexpected app read.");}}) as ElectronApplication;
  for(const [mode,stage,project] of [["bad","complete","packaged-desktop"],["standard","private-stage","packaged-desktop"],["standard","complete","thin-chrome"]]){
    const error=await caught(()=>closeImportedFileDesktop(poisoned,cache,{project:{name:project}} as TestInfo,stage as never,mode as never));
    expect(error).toBeInstanceOf(Error);
  }
  expect(io.reads).toBe(0);expect(io.closes).toBe(0);expect(io.evaluations).toBe(0);expect(io.writes).toHaveLength(0);
});
it("cleanup persistence refuses private types and unknown stage values",async()=>{
  for(const extra of [{failureTypes:["synthetic-private-detail"]},{failureTypes:[],failureStages:["private-stage"],failures:1},{failureTypes:[],failureStage:"private-stage"}]){
    const error=await caught(()=>persistOwnedHostReport("cleanup",{sourceRevision:"source."+"a".repeat(64),status:"failed",failures:0,...extra},info()));
    expect(error).toBeInstanceOf(Error);
  }
  expect(io.writes).toHaveLength(0);
});
