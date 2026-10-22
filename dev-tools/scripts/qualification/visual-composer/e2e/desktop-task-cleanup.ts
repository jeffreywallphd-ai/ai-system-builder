import {expect,type TestInfo} from "@playwright/test";
import type {ElectronApplication} from "playwright";
import {readFile,readdir,lstat,writeFile,realpath,mkdir} from "node:fs/promises";
import {createHash} from "node:crypto";
import path from "node:path";
import {observeOwnedNativeProcessExit} from "../owned-native-process-exit.mjs";

export async function persistOwnedHostReport(kind:"cleanup"|"worker-recovery",report:Record<string,unknown>,info:TestInfo) {
  const run=process.env.VISUAL_COMPOSER_QUALIFICATION_RUN_ID;
  expect(run).toMatch(/^[a-z0-9-]{20,80}$/);
  expect(report.sourceRevision).toMatch(/^source\.[a-f0-9]{64}$/);
  const allowed=kind==="cleanup"
    ? ["sourceRevision","status","mainPid","launchedPid","mainExitCode","willQuitAcknowledged","cleanupMilliseconds","physicalWorkersObserved","physicalWorkersAlive","failures","failureTypes"]
    : ["sourceRevision","scenario","transport","terminal","cleanupMilliseconds","physicalWorkersObserved","listenerRefusalObserved","transientConnectionResets"];
  expect(Object.keys(report).every(key=>allowed.includes(key))).toBe(true);
  if(kind==="worker-recovery"){
    expect(typeof report.listenerRefusalObserved).toBe("boolean");
    expect(typeof report.transientConnectionResets==="number" && Number.isSafeInteger(report.transientConnectionResets) && report.transientConnectionResets>=0).toBe(true);
  }
  const bytes=JSON.stringify({schemaVersion:"owned-host-outcome-v1",kind,...report},null,2)+"\n";
  expect(Buffer.byteLength(bytes)).toBeLessThanOrEqual(8192);
  const folder=path.resolve("artifacts/qualification/visual-composer/runs",run!,"owned-host");
  await mkdir(folder,{recursive:true});expect(await realpath(folder)).toBe(folder);
  const key=createHash("sha256").update(`${info.project.name}\0${info.title}`).digest("hex").slice(0,16);
  await writeFile(path.join(folder,`${kind}-${key}.json`),bytes,{flag:"wx"});
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

export async function closeDesktopAndQualifyOwnedWorkers(app:ElectronApplication,cache:string,info:TestInfo) {
  const started=performance.now(),errors:unknown[]=[];let parentPid:number|undefined,observer:Awaited<ReturnType<typeof observeOwnedNativeProcessExit>>|undefined;
  let mainExitCode:number|undefined,physicalWorkersObserved=0,launchedPid:number|undefined,willQuitAcknowledged=false;
  const ack=path.join(cache,"qualification-will-quit.json");
  try {
    launchedPid=app.process().pid;
    expect(await realpath(cache)).toBe(cache);
    const exists=await lstat(ack).then(()=>true,error=>{if(error.code==="ENOENT")return false;throw error;});
    expect(exists,"A previous acknowledgment cannot qualify this shutdown").toBe(false);
    const identity=await app.evaluate(()=>({pid:process.pid,ppid:process.ppid}));parentPid=identity.pid;
    expect(identity.ppid).toBe(launchedPid);
    observer=await observeOwnedNativeProcessExit(parentPid);
    const rechecked=await app.evaluate(({app},file)=>{
      const {writeFileSync}=process.getBuiltinModule("fs");
      app.once("will-quit",()=>writeFileSync(file,JSON.stringify({pid:process.pid,event:"will-quit"}),{flag:"wx"}));
      return process.pid;
    },ack);
    expect(rechecked).toBe(parentPid);
  }catch(error){errors.push(error);}
  try{await app.close();}catch(error){errors.push(error);}
  try{
    if(!observer)throw new Error("Owned main process was not admitted.");
    mainExitCode=(await observer.outcome).exitCode;expect(mainExitCode).toBe(0);
    const stat=await lstat(ack);expect(stat.isSymbolicLink()).toBe(false);expect(stat.size).toBeLessThanOrEqual(1024);
    expect(JSON.parse(await readFile(ack,"utf8"))).toEqual({pid:parentPid,event:"will-quit"});
    willQuitAcknowledged=true;
  }catch(error){errors.push(error);}finally{await observer?.close();}
  try{
    const names=(await readdir(cache)).filter(name=>/^qualification-worker-identity-[0-9]+\.json$/.test(name));
    physicalWorkersObserved=names.length;expect(names.length).toBeGreaterThan(0);expect(names.length).toBeLessThanOrEqual(4);
    for(const name of names)try {
      const file=path.join(cache,name);const stat=await lstat(file);
      expect(stat.isSymbolicLink()).toBe(false);expect(stat.size).toBeLessThanOrEqual(1024);
      const identity=JSON.parse(await readFile(file,"utf8"));
      expect(Number.isInteger(identity.pid)&&identity.pid>0).toBe(true);
      expect(identity.parentPid).toBe(parentPid);expect(name).toBe(`qualification-worker-identity-${identity.pid}.json`);
      await expect.poll(()=>{try {process.kill(identity.pid,0);return true;}catch(error){if((error as NodeJS.ErrnoException).code!=="ESRCH")throw error;return false;}},{timeout:5000}).toBe(false);
    }catch(error){errors.push(error);}
  }catch(error){errors.push(error);}
  const report={sourceRevision:process.env.VISUAL_COMPOSER_QUALIFICATION_SOURCE_REVISION,status:errors.length?"failed":"passed",mainPid:parentPid,launchedPid,mainExitCode,willQuitAcknowledged,cleanupMilliseconds:performance.now()-started,physicalWorkersObserved,physicalWorkersAlive:errors.length?null:0,failures:errors.length,failureTypes:errors.map(error=>error instanceof Error?error.name:"Unknown")};
  await info.attach("desktop-owned-worker-cleanup",{body:JSON.stringify(report),contentType:"application/json"});
  if(process.env.VISUAL_COMPOSER_QUALIFICATION_RUN_ID || !errors.length)await persistOwnedHostReport("cleanup",report,info);
  if(errors.length)throw new AggregateError(errors,"Desktop owned shutdown qualification failed.");
  return report;
}
