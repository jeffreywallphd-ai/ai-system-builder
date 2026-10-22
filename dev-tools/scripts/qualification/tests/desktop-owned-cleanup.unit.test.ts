import test from "node:test";
import assert from "node:assert/strict";
import {mkdtemp,rm,writeFile} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {closeDesktopAndQualifyOwnedWorkers} from "../visual-composer/e2e/desktop-task-cleanup";

test("a previously crashed host cannot qualify shutdown, and cleanup is still attempted",async()=>{
  const cache=await mkdtemp(path.join(os.tmpdir(),"crashed-desktop-cleanup-"));
  let attempted=false;const evidence:Array<Record<string,unknown>>=[];
  const app={evaluate:async()=>{throw new Error("Main connection already closed");},close:async()=>{attempted=true;},process:()=>{assert.equal(attempted,false,"Capture launch identity before closing the app");return {pid:123,exitCode:23,signalCode:null};}};
  try{
    await assert.rejects(()=>closeDesktopAndQualifyOwnedWorkers(app as never,cache,{attach:async(_name:string,attachment:{body:string})=>{evidence.push(JSON.parse(attachment.body));}} as never),/shutdown qualification failed/);
    assert.equal(attempted,true);assert.equal(evidence.length,1);
    assert.equal(evidence[0]!.status,"failed");assert.equal(evidence[0]!.willQuitAcknowledged,false);
    assert.notEqual(evidence[0]!.physicalWorkersAlive,0);
  }finally{await rm(cache,{recursive:true,force:true});}
});

test("a previous will-quit file is rejected before main-process admission",async()=>{
  const cache=await mkdtemp(path.join(os.tmpdir(),"stale-desktop-ack-"));
  let evaluated=false,closed=false;
  const app={evaluate:async()=>{evaluated=true;throw new Error("Must not admit stale acknowledgment");},close:async()=>{closed=true;},process:()=>({pid:123})};
  try{
    await writeFile(path.join(cache,"qualification-will-quit.json"),JSON.stringify({pid:123,event:"will-quit"}));
    await assert.rejects(()=>closeDesktopAndQualifyOwnedWorkers(app as never,cache,{attach:async()=>{}} as never),/shutdown qualification failed/);
    assert.equal(evaluated,false);assert.equal(closed,true);
  }finally{await rm(cache,{recursive:true,force:true});}
});
