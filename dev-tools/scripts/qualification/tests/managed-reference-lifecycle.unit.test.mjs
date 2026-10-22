import assert from "node:assert/strict";
import {EventEmitter} from "node:events";
import {test} from "node:test";
import {openManagedReferenceListener,assertIsolatedPostgresInspection,assertOwnedWorkerObservation} from "../visual-composer/managed-reference-lifecycle.mjs";

function resources(failure) {
  const calls=[];
  const listener=new EventEmitter(); listener.listening=false;
  listener.listen=(_port,_host,ready)=>{if(failure==="bind")queueMicrotask(()=>listener.emit("error",new Error("occupied")));else{listener.listening=true;ready();}};
  listener.close=done=>{calls.push("listener");listener.listening=false;done();};
  return {calls,dependencies:{
    openDatabase:async()=>({close:async()=>{calls.push("database");}}),
    prepareEnvironment:()=>{if(failure==="prepare")throw new Error("unsafe launch");return {};},
    createHost:async()=>({config:{port:12345},shutdownBackgroundTasks:async()=>{calls.push("tasks");if(failure==="tasks")throw new Error("drain failure");},closePersistence:async()=>{calls.push("host");}}),
    createListener:()=>listener,
  }};
}

test("owned-task cleanup cannot pass vacuously without a physical worker observation",()=>{
  assert.doesNotThrow(()=>assertOwnedWorkerObservation("immediate",0),"browse-only startup need not launch a worker");
  for(const scenario of ["observed-download","worker-failure-download","disconnect-download"]) {
    assert.throws(()=>assertOwnedWorkerObservation(scenario,0),/actual bounded worker/);
    assert.doesNotThrow(()=>assertOwnedWorkerObservation(scenario,1));
  }
  for(const count of [-1,65,NaN,Infinity,1.5,"1"]) assert.throws(()=>assertOwnedWorkerObservation("immediate",count),/actual bounded worker/);
  assert.throws(()=>assertOwnedWorkerObservation("unknown",1),/actual bounded worker/);
});
test("managed listener closes acquired database when preparation fails before host creation",async()=>{
  const {calls,dependencies}=resources("prepare");await assert.rejects(openManagedReferenceListener(dependencies),/unsafe launch/);assert.deepEqual(calls,["database"]);
});
test("managed listener bind failure drains and closes host and database",async()=>{
  const {calls,dependencies}=resources("bind");await assert.rejects(openManagedReferenceListener(dependencies),/occupied/);assert.deepEqual(calls,["tasks","host","database"]);
});
test("managed listener cleanup attempts all resources on task failure and preserves idempotent rejection",async()=>{
  const {calls,dependencies}=resources("tasks");const owned=await openManagedReferenceListener(dependencies);
  await assert.rejects(owned.close(),/cleanup failed/);await assert.rejects(owned.close(),/cleanup failed/);
  assert.deepEqual(calls,["tasks","listener","host","database"]);
});
test("managed listener graceful close drains before persistence and runs once",async()=>{
  const {calls,dependencies}=resources();const owned=await openManagedReferenceListener(dependencies);await owned.close();await owned.close();assert.deepEqual(calls,["tasks","listener","host","database"]);
});
test("database fixture refuses foreign ownership and every additional/public listener",()=>{
  const fixture={id:"a".repeat(16),port:54321};const image="postgres@sha256:"+"b".repeat(64);
  const valid={Config:{Labels:{"ai-system-builder.qualification":"true","ai-system-builder.run":fixture.id},Image:image},NetworkSettings:{Ports:{"5432/tcp":[{HostIp:"127.0.0.1",HostPort:"54321"}]}}};
  assert.doesNotThrow(()=>assertIsolatedPostgresInspection(valid,fixture,image));
  for(const mutate of [x=>x.Config.Labels["ai-system-builder.qualification"]="false",x=>x.Config.Labels["ai-system-builder.run"]="foreign",x=>x.Config.Image="foreign",x=>x.NetworkSettings.Ports["5432/tcp"].push({HostIp:"0.0.0.0",HostPort:"54321"}),x=>x.NetworkSettings.Ports["1234/tcp"]=[],x=>x.NetworkSettings.Ports["5432/tcp"][0].HostIp="0.0.0.0",x=>x.NetworkSettings.Ports["5432/tcp"][0].HostPort="54322"]) {const value=structuredClone(valid);mutate(value);assert.throws(()=>assertIsolatedPostgresInspection(value,fixture,image));}
});
