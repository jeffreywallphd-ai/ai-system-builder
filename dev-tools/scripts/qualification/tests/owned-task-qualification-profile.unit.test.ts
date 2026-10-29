import assert from "node:assert/strict";
import test from "node:test";
import type {Page,TestInfo} from "@playwright/test";
import {readOwnedTaskQualificationProfile,qualifyOwnedTaskJourney} from "../visual-composer/e2e/owned-task-journey";

for(const samples of [1,30]) for(const transport of ["thin-http","desktop-ipc"]) test(`fixed ${samples} ${transport} profile preserves diagnostic meaning`,()=>{
  const input={samples,transport}, profile=readOwnedTaskQualificationProfile(input);
  assert.deepEqual(profile,{samples,transport,successfulStatus:samples===30?"passed":"diagnostic-passed",qualificationComplete:samples===30});
  assert(Object.isFrozen(profile)); input.samples=samples===1?30:1;input.transport="unknown";
  assert.equal(profile.samples,samples);assert.equal(profile.transport,transport);
});
const invalid=[undefined,null,false,1,[],{}, {samples:0,transport:"thin-http"},{samples:2,transport:"thin-http"},
  {samples:31,transport:"desktop-ipc"},{samples:Infinity,transport:"desktop-ipc"},{samples:NaN,transport:"thin-http"},
  {samples:"30",transport:"thin-http"},{samples:1,transport:"unknown"},{samples:30,transport:"thin-http",qualificationComplete:true},
  Object.assign(Object.create(null),{samples:1,transport:"thin-http"})];
for(const [index,input] of invalid.entries()) test(`unknown profile ${index} is refused before Page or metadata`,async()=>{
  let reads=0;const page=new Proxy({}, {get(){reads++;throw new Error("Unexpected Page effect.");}}) as Page;
  const info=new Proxy({}, {get(){reads++;throw new Error("Unexpected context read.");}}) as TestInfo;
  assert.throws(()=>readOwnedTaskQualificationProfile(input),/Unsupported owned task qualification profile/);
  await assert.rejects(qualifyOwnedTaskJourney(page,info,input as never),/Unsupported owned task qualification profile/);assert.equal(reads,0);
});
test("accessors, symbols and proxies cannot execute supplied code",()=>{
  let calls=0;
  const getter=Object.defineProperty({transport:"thin-http"},"samples",{enumerable:true,get(){calls++;throw new Error("synthetic-private");}});
  const proxy=new Proxy({samples:1,transport:"thin-http"},{get(){calls++;throw 0;},getPrototypeOf(){calls++;throw 0;},ownKeys(){calls++;throw 0;},getOwnPropertyDescriptor(){calls++;throw 0;}});
  const extra={samples:1,transport:"thin-http",[Symbol("synthetic-private")]:true};
  for(const input of [getter,proxy,extra]) assert.throws(()=>readOwnedTaskQualificationProfile(input),/Unsupported owned task qualification profile/);
  assert.equal(calls,0);
});
test("valid task profiles reach the original first UI action",async()=>{
  const marker=new Error("Synthetic first UI action.");
  const page={getByLabel:()=>{throw marker;}} as unknown as Page;
  let actual:unknown;try{await qualifyOwnedTaskJourney(page,{} as TestInfo,{samples:1,transport:"desktop-ipc"});}catch(error){actual=error;}
  assert.equal(actual,marker);
});
