import test from "node:test";
import assert from "node:assert/strict";
import {mkdir,mkdtemp,rmdir,unlink,writeFile,realpath,readdir} from "node:fs/promises";
import path from "node:path";
import {closeDesktopAndQualifyOwnedWorkers} from "../visual-composer/e2e/desktop-task-cleanup";

async function freshCache(prefix:string) {
  const root=path.resolve("artifacts/qualification/visual-composer/d");await mkdir(root,{recursive:true});
  const cache=await mkdtemp(path.join(root,prefix));assert.equal(await realpath(cache),cache);
  assert.equal(path.dirname(cache),root);return cache;
}
async function removeOwnedCache(cache:string) {
  assert.equal(path.dirname(cache),path.resolve("artifacts/qualification/visual-composer/d"));
  assert.equal(await realpath(cache),cache);
  for(const name of await readdir(cache)) {assert.equal(name,"qualification-will-quit.json");await unlink(path.join(cache,name));}
  await rmdir(cache);
}

test("a previously crashed host cannot qualify shutdown, and cleanup is still attempted",async()=>{
  const cache=await freshCache("crashed-desktop-cleanup-");
  let attempted=false,evaluated=false;const evidence:Array<Record<string,unknown>>=[];
  const app={evaluate:async()=>{evaluated=true;throw new Error("Main connection already closed");},close:async()=>{attempted=true;},process:()=>{assert.equal(attempted,false,"Capture launch identity before closing the app");return {pid:123,exitCode:23,signalCode:null};}};
  try{
    await assert.rejects(()=>closeDesktopAndQualifyOwnedWorkers(app as never,cache,{project:{name:"synthetic-desktop"},title:"crashed-host",attach:async(_name:string,attachment:{body:string})=>{evidence.push(JSON.parse(attachment.body));}} as never),/shutdown qualification failed/);
    assert.equal(attempted,true);assert.equal(evaluated,true);assert.equal(evidence.length,1);
    assert.equal(evidence[0]!.status,"failed");assert.equal(evidence[0]!.willQuitAcknowledged,false);
    assert.notEqual(evidence[0]!.physicalWorkersAlive,0);
  }finally{await removeOwnedCache(cache);}
});

test("a previous will-quit file is rejected before main-process admission",async()=>{
  const cache=await freshCache("stale-desktop-ack-");
  let evaluated=false,closed=false;
  const app={evaluate:async()=>{evaluated=true;throw new Error("Must not admit stale acknowledgment");},close:async()=>{closed=true;},process:()=>({pid:123})};
  try{
    await writeFile(path.join(cache,"qualification-will-quit.json"),JSON.stringify({pid:123,event:"will-quit"}));
    await assert.rejects(()=>closeDesktopAndQualifyOwnedWorkers(app as never,cache,{project:{name:"synthetic-desktop"},title:"stale-acknowledgment",attach:async()=>{}} as never),/shutdown qualification failed/);
    assert.equal(evaluated,false);assert.equal(closed,true);
  }finally{await removeOwnedCache(cache);}
});
