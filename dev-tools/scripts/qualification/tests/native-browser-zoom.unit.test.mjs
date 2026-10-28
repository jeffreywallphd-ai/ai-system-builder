import fs from "node:fs/promises";
import path from "node:path";
import {syncBuiltinESMExports} from "node:module";
import {chromium} from "@playwright/test";
import {launchOwnedNativeZoomContext} from "../visual-composer/native-browser-zoom.mjs";
import assert from "node:assert/strict";
import test from "node:test";
import { nativeZoomPreferences, assertNative400PercentZoom } from "../visual-composer/native-browser-zoom.mjs";

test("native zoom admits only predeclared factors before profile effects", () => {
  for (const value of [undefined, null, "4", 0, -1, 1.5, Infinity, {}, 100]) assert.throws(() => nativeZoomPreferences(value));
  assert.equal(nativeZoomPreferences(1).partition.default_zoom_level.x, 0);
  assert.ok(Math.abs(nativeZoomPreferences(4).partition.default_zoom_level.x - 7.6035680338478615) < 1e-10);
});
test("400 percent observation rejects narrow viewport, pinch zoom and CSS/device emulation substitutes", () => {
  const valid = {dpr: 4, cssZoom: "1", visualScale: 1, outerWidth: 1440, innerWidth: 356};
  assertNative400PercentZoom(valid);
  assertNative400PercentZoom({...valid, dpr: 3.9999999999999996});
  for (const change of [{dpr: 1}, {dpr: 3.9999}, {dpr: "4"}, {dpr: NaN}, {dpr: Infinity}, {cssZoom: "4"}, {visualScale: 4}, {innerWidth: 1440}, {outerWidth: 360}]) assert.throws(() => assertNative400PercentZoom({...valid, ...change}));
});

// These fixed fixtures run only this owned helper. No browser/process is started.
function lifecycleFixture(t, options = {}) {
  const parent = path.resolve("artifacts/qualification/visual-composer/zoom");
  const profile = path.join(parent, "native-synthetic-owned");
  const events = [], writes = [];
  const failure = new Error("synthetic setup failure");
  const detachFailure = new Error("synthetic detach failure");
  const cleanupFailure = new Error("synthetic cleanup failure");
  let parentStats = 0, profileStats = 0, connected = true;
  const stats = (ino, symbolic = false, directory = true) => ({dev: 7, ino, isSymbolicLink: () => symbolic, isDirectory: () => directory});
  const session = {
    async send(name) {events.push("inspect");assert.equal(name,"SystemInfo.getProcessInfo");if(options.sendFails)throw Object.hasOwn(options,"queryReason") ? options.queryReason : failure;return {processInfo:options.owners ?? [{type:"browser",id:9101}]};},
    async detach() {events.push("detach");if(options.detachFails)throw detachFailure;},
  };
  const browser = {
    isConnected() {return connected;},
    async newBrowserCDPSession() {events.push("session");if(options.sessionFails)throw failure;return session;},
  };
  const context = {
    browser() {return options.noBrowser ? null : browser;},
    async close() {events.push("close");if(options.closeWait)await options.closeWait;if(options.closeFails)throw cleanupFailure;if(!options.stillConnected)connected=false;},
  };
  const replace=(target,name,implementation)=>t.mock.method(target,name,implementation);
  replace(fs,"mkdir",async name=>{events.push("mkdir");assert.ok(name===parent || name===path.join(profile,"Default"));});
  replace(fs,"mkdtemp",async prefix=>{events.push("mkdtemp");assert.equal(prefix,path.join(parent,"native-"));return profile;});
  replace(fs,"lstat",async name=>{
    if(name===parent){parentStats++;return stats(parentStats>1 && options.parentChanged ? 99 : 10,options.parentLink===true,!options.parentNotDirectory);}
    assert.equal(name,profile);profileStats++;return stats(profileStats>1 && options.profileChanged ? 99 : 20,options.initialProfileLink===true || profileStats>1 && options.profileLink===true,!options.profileNotDirectory);
  });
  replace(fs,"realpath",async name=>{assert.ok(name===parent || name===profile);return options.parentRedirect && name===parent ? parent+"-foreign" : name;});
  replace(fs,"writeFile",async(name,body,config)=>{events.push("write");assert.equal(name,path.join(profile,"Default","Preferences"));assert.deepEqual(config,{flag:"wx",mode:0o600});writes.push(JSON.parse(body));if(options.writeFails)throw failure;});
  replace(fs,"rm",async(name,config)=>{events.push("remove");assert.equal(name,profile);assert.deepEqual(config,{recursive:true,force:false});if(options.removeFails)throw cleanupFailure;});
  replace(chromium,"launchPersistentContext",async(name,config)=>{events.push("launch");assert.equal(name,profile);assert.deepEqual(config,{channel:"chrome",headless:true,viewport:null,deviceScaleFactor:undefined,args:["--window-size=1440,1000"]});if(options.launchFails)throw failure;return context;});
  replace(process,"kill",(pid,signal)=>{events.push("exit-check");assert.equal(pid,9101);assert.equal(signal,0);if(options.exitDenied)throw Object.assign(new Error("synthetic process-query denial"),{code:"EPERM"});if(options.live)return true;throw Object.assign(new Error("synthetic exited process"),{code:"ESRCH"});});
  if(options.live){let call=0;replace(Date,"now",()=>call++<2 ? 0 : (call-2)*3001);}
  syncBuiltinESMExports();
  t.after(()=>{t.mock.restoreAll();syncBuiltinESMExports();});
  return {events,writes,failure,detachFailure,cleanupFailure,context};
}
function hasFailure(error, expected) {
  return error===expected || error instanceof AggregateError && error.errors.some(item=>hasFailure(item,expected));
}
test("owned zoom cleanup follows exact native exit and ownership checks",async t=>{
  const f=lifecycleFixture(t);const owned=await launchOwnedNativeZoomContext(4);
  assert.equal(owned.context,f.context);assert.deepEqual(f.writes,[nativeZoomPreferences(4)]);
  assert.deepEqual(await owned.close(),{nativeExitObserved:true,profileRemoved:true});
  assert.ok(f.events.indexOf("detach")<f.events.indexOf("close"));assert.ok(f.events.indexOf("close")<f.events.indexOf("exit-check"));assert.ok(f.events.indexOf("exit-check")<f.events.indexOf("remove"));
  await assert.rejects(owned.close());assert.equal(f.events.filter(x=>x==="close").length,1);assert.equal(f.events.filter(x=>x==="remove").length,1);
});
test("invalid zoom refuses before any fixture filesystem or browser effect",async t=>{
  const f=lifecycleFixture(t);await assert.rejects(launchOwnedNativeZoomContext(2));assert.deepEqual(f.events,[]);
});
for(const scenario of [{sessionFails:true},{sendFails:true},{noBrowser:true},{owners:[]},{owners:[{type:"browser",id:0}]},{owners:[{type:"browser",id:9101},{type:"browser",id:9102}]}])test(`failed zoom setup retires its returned context: ${Object.keys(scenario)[0]} ${JSON.stringify(scenario.owners??"")}`,async t=>{
  const f=lifecycleFixture(t,scenario);await assert.rejects(launchOwnedNativeZoomContext(4));assert.equal(f.events.filter(x=>x==="close").length,1);assert.equal(f.events.includes("remove"),false);
  if(scenario.sendFails)assert.ok(f.events.includes("detach"));
});
test("failed session detach retains the setup failure after proven safe retirement",async t=>{
  const f=lifecycleFixture(t,{detachFails:true});await assert.rejects(launchOwnedNativeZoomContext(4),error=>hasFailure(error,f.detachFailure));assert.equal(f.events.filter(x=>x==="close").length,1);assert.ok(f.events.includes("exit-check"));assert.ok(f.events.includes("remove"));
});
test("setup and retirement failures are both preserved without profile deletion",async t=>{
  const f=lifecycleFixture(t,{sendFails:true,closeFails:true});await assert.rejects(launchOwnedNativeZoomContext(4),error=>hasFailure(error,f.failure)&&hasFailure(error,f.cleanupFailure));assert.equal(f.events.includes("remove"),false);assert.ok(f.events.includes("detach"));
});
test("inspection, detach and retirement failures all remain inspectable",async t=>{
  const f=lifecycleFixture(t,{sendFails:true,detachFails:true,closeFails:true});await assert.rejects(launchOwnedNativeZoomContext(4),error=>hasFailure(error,f.failure)&&hasFailure(error,f.detachFailure)&&hasFailure(error,f.cleanupFailure));assert.equal(f.events.filter(x=>x==="detach").length,1);assert.equal(f.events.filter(x=>x==="close").length,1);assert.equal(f.events.includes("remove"),false);
});
for(const queryReason of [undefined,null,false,0,""])test(`falsy inspection reason survives distinct detach and close failures: ${String(queryReason)}`,async t=>{
  const f=lifecycleFixture(t,{sendFails:true,queryReason,detachFails:true,closeFails:true});
  await assert.rejects(launchOwnedNativeZoomContext(4),error=>hasFailure(error,queryReason)&&hasFailure(error,f.detachFailure)&&hasFailure(error,f.cleanupFailure));
  assert.equal(f.events.filter(x=>x==="detach").length,1);assert.equal(f.events.filter(x=>x==="close").length,1);assert.equal(f.events.includes("remove"),false);assert.equal(f.events.includes("exit-check"),false);
});
test("rejected browser launch retains uncertain files and never queries an unknown process",async t=>{
  const f=lifecycleFixture(t,{launchFails:true});await assert.rejects(launchOwnedNativeZoomContext(4),error=>hasFailure(error,f.failure));assert.equal(f.events.includes("remove"),false);assert.equal(f.events.includes("exit-check"),false);assert.equal(f.events.includes("close"),false);
});
test("prelaunch preference failure removes only the newly verified profile",async t=>{
  const f=lifecycleFixture(t,{writeFails:true});await assert.rejects(launchOwnedNativeZoomContext(4),error=>hasFailure(error,f.failure));assert.ok(f.events.includes("remove"));assert.equal(f.events.includes("launch"),false);assert.equal(f.events.includes("exit-check"),false);
});
for(const scenario of [{parentChanged:true},{profileChanged:true},{profileLink:true},{stillConnected:true},{exitDenied:true},{live:true},{closeFails:true}])test(`uncertain zoom retirement retains profile: ${Object.keys(scenario)[0]}`,async t=>{
  const f=lifecycleFixture(t,scenario);const owned=await launchOwnedNativeZoomContext(4);await assert.rejects(owned.close());assert.equal(f.events.includes("remove"),false);await assert.rejects(owned.close());assert.equal(f.events.filter(x=>x==="close").length,1);
});
for(const scenario of [{parentLink:true},{parentRedirect:true},{parentNotDirectory:true}])test(`foreign zoom parent refuses before profile allocation: ${Object.keys(scenario)[0]}`,async t=>{
  const f=lifecycleFixture(t,scenario);await assert.rejects(launchOwnedNativeZoomContext(4));assert.equal(f.events.includes("mkdtemp"),false);assert.equal(f.events.includes("remove"),false);assert.equal(f.events.includes("launch"),false);
});
for(const scenario of [{initialProfileLink:true},{profileNotDirectory:true}])test(`unverified zoom profile is retained before launch: ${Object.keys(scenario)[0]}`,async t=>{
  const f=lifecycleFixture(t,scenario);await assert.rejects(launchOwnedNativeZoomContext(4));assert.equal(f.events.includes("launch"),false);assert.equal(f.events.includes("remove"),false);
});
test("failed removal refuses another destructive cleanup attempt",async t=>{
  const f=lifecycleFixture(t,{removeFails:true});const owned=await launchOwnedNativeZoomContext(4);await assert.rejects(owned.close(),error=>error===f.cleanupFailure);await assert.rejects(owned.close());assert.equal(f.events.filter(x=>x==="close").length,1);assert.equal(f.events.filter(x=>x==="remove").length,1);
});
test("simultaneous zoom cleanup cannot close or remove twice",async t=>{
  let release;const closeWait=new Promise(resolve=>{release=resolve;});const f=lifecycleFixture(t,{closeWait});const owned=await launchOwnedNativeZoomContext(4);const first=owned.close();
  const second=owned.close();release();await assert.rejects(second);await first;assert.equal(f.events.filter(x=>x==="close").length,1);assert.equal(f.events.filter(x=>x==="remove").length,1);
});
