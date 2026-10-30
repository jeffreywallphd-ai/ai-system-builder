import {createHash} from "node:crypto";
import {types} from "node:util";

export type SettingsHost="packaged-desktop"|"thin-chrome";
export type SettingsHostCase="public-values"|"secret-defaults";
export const SETTINGS_HOST_TIMEOUT_MS=120_000;
export const SETTINGS_PASSIVE_MODEL=Object.freeze({provider:"transformers",modelId:"Qwen/Qwen2.5-0.5B-Instruct",inferenceMode:"chat",device:"cpu",torchDtype:"float32"});
const invalid=()=>new Error("The Settings host observation is invalid.");
/** Match the panel's unfiltered read, never a dashboard's keyed summary read. */
export function isSettingsPanelReadBody(text:unknown):boolean{
  if(typeof text!=="string"||text.length>4096||Buffer.byteLength(text)>4096)return false;
  try{
    const value:unknown=JSON.parse(text);
    return value!==null&&typeof value==="object"&&!Array.isArray(value)&&Object.keys(value).length===0;
  }catch{return false;}
}
export function settingsHostIdentity(run:unknown,source:unknown,target:unknown,scenario:unknown){
  if(typeof run!=="string"||!/^[a-z0-9-]{20,80}$/.test(run)||typeof source!=="string"||!/^source\.[a-f0-9]{64}$/.test(source)||
    target!=="packaged-desktop"&&target!=="thin-chrome"||scenario!=="public-values"&&scenario!=="secret-defaults")throw invalid();
  return Object.freeze({runId:run,sourceRevision:source,host:target,scenario});
}
export function settingsHostNamespace(run:unknown,source:unknown,target:unknown){
  const identity=settingsHostIdentity(run,source,target,"public-values");
  return "settings-test-"+createHash("sha256").update(`${identity.runId}\0${identity.host}`).digest("hex").slice(0,16);
}
export function settingsHostPhases(target:SettingsHost,scenario:SettingsHostCase):readonly string[]{
  settingsHostIdentity("settings-phase-fixture-v1","source."+"a".repeat(64),target,scenario);
  return Object.freeze(scenario==="public-values"?[
    "settings-opened","fresh-value-confirmed",...(target==="thin-chrome"?["failed-read-denies-write","explicit-refresh-recovers"]:[]),
    "public-save-confirmed","public-reload-confirmed","public-clear-confirmed","clear-reload-confirmed",
  ]:["settings-opened","fresh-values-confirmed","secret-save-confirmed","secret-reload-masked","model-default-save-confirmed","model-default-reload-confirmed","secret-clear-confirmed","model-default-clear-confirmed","clear-reload-confirmed"]);
}
/** Only completed UI assertions supply phases. This never qualifies its parent. */
export function settingsHostReport(run:unknown,source:unknown,target:unknown,scenario:unknown,phases:unknown,failed:unknown){
  const identity=settingsHostIdentity(run,source,target,scenario),expected=settingsHostPhases(identity.host,identity.scenario);
  if(typeof failed!=="boolean"||types.isProxy(phases)||!Array.isArray(phases)||Object.getPrototypeOf(phases)!==Array.prototype||phases.length>expected.length)throw invalid();
  const fields=Object.getOwnPropertyDescriptors(phases),captured:string[]=[];
  if(Reflect.ownKeys(fields).length!==phases.length+1)throw invalid();
  for(let i=0;i<phases.length;i++){const field=fields[String(i)];if(!field||!("value" in field)||field.value!==expected[i])throw invalid();captured.push(field.value);}
  return {schemaVersion:"settings-functional-host-outcome-v1",...identity,status:!failed&&captured.length===expected.length?"passed":"failed",phases:captured,
    nextPhase:expected[captured.length]??"complete",parentQualificationGranted:false,modelLoadingQualified:false,providerOperationsQualified:false,
    scope:"Passive Settings UI save/readback/reload/clear only. No provider publication, model quality, physical app restart, complete worker retirement or parent qualification."};
}
