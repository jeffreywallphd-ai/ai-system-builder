import {finalizeQualificationEvidence, safeQualificationFailureType, isQualificationFailureType, isOwnedCleanupFailureStage, type OwnedCleanupFailureStage} from "../qualification-reporting";
import {expect,type TestInfo} from "@playwright/test";
import type {ElectronApplication} from "playwright";
import {readFile,readdir,lstat,writeFile,realpath,mkdir} from "node:fs/promises";
import {createHash} from "node:crypto";
import path from "node:path";
import {observeOwnedNativeProcessExit} from "../owned-native-process-exit.mjs";

export type DesktopRestartPhase = "before-restart" | "after-restart";
export function ownedDesktopCleanupIdentity(project: string, title: string, phase?: DesktopRestartPhase) {
  if (phase !== undefined && phase !== "before-restart" && phase !== "after-restart") throw new Error("Unknown owned restart phase.");
  const identity = `${project}\0${title}${phase === undefined ? "" : `\0${phase}`}`;
  return { key: createHash("sha256").update(identity).digest("hex").slice(0,16),
    acknowledgment: phase === undefined ? "qualification-will-quit.json" : `qualification-will-quit-${phase}.json` };
}

export async function persistOwnedHostReport(kind:"cleanup"|"worker-recovery",report:Record<string,unknown>,info:TestInfo,phase?:DesktopRestartPhase) {
  const identity = ownedDesktopCleanupIdentity(info.project.name, info.title, phase);
  const run=process.env.VISUAL_COMPOSER_QUALIFICATION_RUN_ID;
  expect(run).toMatch(/^[a-z0-9-]{20,80}$/);
  expect(report.sourceRevision).toMatch(/^source\.[a-f0-9]{64}$/);
  const allowed=kind==="cleanup"
    ? ["sourceRevision","status","mainPid","launchedPid","mainExitCode","willQuitAcknowledged","cleanupMilliseconds","physicalWorkersObserved","physicalWorkersAlive","failures","failureTypes","failureStages","failureStage","finalizationStage"]
    : ["sourceRevision","scenario","transport","terminal","cleanupMilliseconds","physicalWorkersObserved","listenerRefusalObserved","transientConnectionResets"];
  expect(Object.keys(report).every(key=>allowed.includes(key))).toBe(true);
  if(kind==="cleanup") {
    expect(Array.isArray(report.failureTypes) && report.failureTypes.length <= 32 && report.failureTypes.every(isQualificationFailureType)).toBe(true);
    if (report.failureStages !== undefined) expect(Array.isArray(report.failureStages) && report.failureStages.length === report.failures && report.failureStages.length <= 32 && report.failureStages.every(isOwnedCleanupFailureStage)).toBe(true);
    if (report.failureStage !== undefined) expect(["journey","evidence-attach","evidence-save"].includes(report.failureStage as string)).toBe(true);
    if (report.finalizationStage !== undefined) expect(["evidence-attach","evidence-save"].includes(report.finalizationStage as string)).toBe(true);
  }
  if(kind==="worker-recovery"){
    expect(typeof report.listenerRefusalObserved).toBe("boolean");
    expect(typeof report.transientConnectionResets==="number" && Number.isSafeInteger(report.transientConnectionResets) && report.transientConnectionResets>=0).toBe(true);
  }
  const bytes=JSON.stringify({schemaVersion:"owned-host-outcome-v1",kind,...report},null,2)+"\n";
  expect(Buffer.byteLength(bytes)).toBeLessThanOrEqual(8192);
  const folder=path.resolve("artifacts/qualification/visual-composer/runs",run!,"owned-host");
  await mkdir(folder,{recursive:true});expect(await realpath(folder)).toBe(folder);
  await writeFile(path.join(folder,`${kind}-${identity.key}.json`),bytes,{flag:"wx"});
}

export async function triggerObservedOwnedWorkerFault(cache:string,parentPid:number) {
  expect(path.isAbsolute(cache)).toBe(true);
  expect(path.resolve(cache).replaceAll("\\","/")).toContain("/artifacts/qualification/visual-composer/d/");
  expect(await realpath(cache)).toBe(cache);
  const names=(await readdir(cache)).filter(name=>/^qualification-worker-identity-[0-9]+\.json$/.test(name));
  expect(names).toHaveLength(1);
  const file=path.join(cache,names[0]!);const stat=await lstat(file);
  expect(stat.isSymbolicLink()).toBe(false);expect(stat.size).toBeLessThanOrEqual(1024);
  const identity=JSON.parse(await readFile(file,"utf8"));
  expect(identity.parentPid).toBe(parentPid);expect(Number.isInteger(identity.pid)&&identity.pid>0).toBe(true);
  expect(names[0]).toBe(`qualification-worker-identity-${identity.pid}.json`);
  await writeFile(path.join(cache,`qualification-fault-trigger-${identity.pid}.txt`),"trigger-owned-qualification-fault-v1\n",{flag:"wx"});
}

export async function closeDesktopAndQualifyOwnedWorkers(app:ElectronApplication,cache:string,info:TestInfo,phase?:DesktopRestartPhase) {
  const cleanupIdentity = ownedDesktopCleanupIdentity(info.project.name, info.title, phase);
  const started=performance.now(),errors:unknown[]=[];let parentPid:number|undefined,observer:Awaited<ReturnType<typeof observeOwnedNativeProcessExit>>|undefined;
  let mainExitCode:number|undefined,physicalWorkersObserved=0,launchedPid:number|undefined,willQuitAcknowledged=false;
  const failureStages: OwnedCleanupFailureStage[] = [];
  const recordFailure = (stage: OwnedCleanupFailureStage, error: unknown) => {failureStages.push(stage);errors.push(error);};
  const ack=path.join(cache,cleanupIdentity.acknowledgment);
  type Worker = {pid:number;parentPid:number;name:string;observer?:Awaited<ReturnType<typeof observeOwnedNativeProcessExit>>;admitted:boolean};
  const workers:Worker[]=[];let workerNames:string[]|undefined;
  const validPid=(value:unknown):value is number=>typeof value==="number"&&Number.isInteger(value)&&value>0&&value<=0xffffffff;
  const names=async()=>(await readdir(cache)).filter(name=>/^qualification-worker-identity-[0-9]+\.json$/.test(name)).sort();
  const readIdentity=async(name:string)=>{
    const file=path.join(cache,name),stat=await lstat(file);
    expect(stat.isSymbolicLink()).toBe(false);expect(stat.size).toBeLessThanOrEqual(1024);
    const identity=JSON.parse(await readFile(file,"utf8"));
    expect(validPid(identity.pid)&&validPid(identity.parentPid)).toBe(true);
    expect(name).toBe(`qualification-worker-identity-${identity.pid}.json`);
    return {pid:identity.pid as number,parentPid:identity.parentPid as number};
  };
  const alive=(pid:number)=>{try{process.kill(pid,0);return true;}catch(error){if((error as NodeJS.ErrnoException).code!=="ESRCH")throw error;return false;}};
  try {
    launchedPid=app.process().pid;
    expect(validPid(launchedPid)).toBe(true);
    expect(path.isAbsolute(cache)).toBe(true);
    expect(path.resolve(cache).replaceAll("\\","/")).toContain("/artifacts/qualification/visual-composer/d/");
    expect(await realpath(cache)).toBe(cache);
    const exists=await lstat(ack).then(()=>true,error=>{if(error.code==="ENOENT")return false;throw error;});
    expect(exists,"A previous acknowledgment cannot qualify this shutdown").toBe(false);
    const identity=await app.evaluate(()=>({pid:process.pid,ppid:process.ppid}));parentPid=identity.pid;
    expect(validPid(parentPid)&&validPid(identity.ppid)).toBe(true);
    expect(parentPid===launchedPid||identity.ppid===launchedPid).toBe(true);
    observer=await observeOwnedNativeProcessExit(parentPid!,{rootPid:launchedPid!});
    expect(observer.admission.parentPid).toBe(identity.ppid);
    const rechecked=await app.evaluate(({app},file)=>{
      const {writeFileSync}=process.getBuiltinModule("fs");
      app.once("will-quit",()=>writeFileSync(file,JSON.stringify({pid:process.pid,event:"will-quit"}),{flag:"wx"}));
      return process.pid;
    },ack);
    expect(rechecked).toBe(parentPid);
  }catch(error){recordFailure("admission",error);}
  // Freeze the known markers and acquire native handles while the app is alive.
  // An already-exited direct fixture retains only the older PID-absence evidence.
  try {
    expect(validPid(parentPid)).toBe(true);
    workerNames=await names();physicalWorkersObserved=workerNames.length;
    expect(workerNames.length).toBeGreaterThan(0);expect(workerNames.length).toBeLessThanOrEqual(4);
    for(const name of workerNames) {
      let worker:Worker|undefined;
      try {
        worker={...await readIdentity(name),name,admitted:false};workers.push(worker);
        if(alive(worker.pid)) {
          worker.observer=await observeOwnedNativeProcessExit(worker.pid,{rootPid:parentPid!});
          expect(worker.observer.admission.parentPid).toBe(worker.parentPid);
        }else expect(worker.parentPid).toBe(parentPid);
        worker.admitted=true;
      }catch(error){recordFailure("worker-admission",error);}
    }
  }catch(error){recordFailure("worker-list",error);}
  try{await app.close();}catch(error){recordFailure("app-close",error);}
  try{
    if(!observer)throw new Error("Owned main process was not admitted.");
    mainExitCode=(await observer.outcome).exitCode;expect(mainExitCode).toBe(0);
    const stat=await lstat(ack);expect(stat.isSymbolicLink()).toBe(false);expect(stat.size).toBeLessThanOrEqual(1024);
    expect(JSON.parse(await readFile(ack,"utf8"))).toEqual({pid:parentPid,event:"will-quit"});
    willQuitAcknowledged=true;
  }catch(error){recordFailure("main-exit",error);}finally{try {await observer?.close();} catch(error) {recordFailure("observer-close",error);}}
  for(const worker of workers) {
    try {
      if(!worker.admitted)continue;
      if(worker.observer)await worker.observer.outcome;
      expect(await readIdentity(worker.name)).toEqual({pid:worker.pid,parentPid:worker.parentPid});
      // A held native handle identifies the original process object. A later
      // numeric-PID probe could instead find an unrelated replacement process.
      if(!worker.observer)await expect.poll(()=>alive(worker.pid),{timeout:5000}).toBe(false);
    }catch(error){recordFailure("worker-exit",error);}
    finally{try{await worker.observer?.close();}catch(error){recordFailure("observer-close",error);}}
  }
  try{expect(await names()).toEqual(workerNames);}catch(error){recordFailure("worker-list",error);}
  const report={sourceRevision:process.env.VISUAL_COMPOSER_QUALIFICATION_SOURCE_REVISION,status:errors.length?"failed":"passed",mainPid:parentPid,launchedPid,mainExitCode,willQuitAcknowledged,cleanupMilliseconds:performance.now()-started,physicalWorkersObserved,physicalWorkersAlive:errors.length?null:0,failures:errors.length,failureTypes:errors.map(safeQualificationFailureType),failureStages};
  try {
    await finalizeQualificationEvidence(report, errors, async () => {
      if(process.env.VISUAL_COMPOSER_QUALIFICATION_RUN_ID || !errors.length) await persistOwnedHostReport("cleanup",report,info,phase);
    }, () => info.attach("desktop-owned-worker-cleanup",{body:JSON.stringify(report),contentType:"application/json"}));
  } catch (error) {
    throw new AggregateError(error instanceof AggregateError ? error.errors : [error], "Desktop owned shutdown qualification failed.");
  }
  return report;
}
