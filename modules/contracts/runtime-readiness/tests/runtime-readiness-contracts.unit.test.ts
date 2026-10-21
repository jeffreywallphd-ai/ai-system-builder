import assert from "node:assert/strict";
import { describe, it } from "../../../testing/node-test";
import { createWorkspaceId } from "../../workspace";
import * as rr from "..";

describe("runtime readiness contracts",()=>{
 const ws=createWorkspaceId("workspace.alpha");
 it("normalizes ids and rejects unsafe ids",()=>{assert.equal(rr.normalizeRuntimeReadinessBindingId("bind.alpha"),"bind.alpha");assert.throws(()=>rr.normalizeRuntimeReadinessBindingId(" /tmp/x "));assert.throws(()=>rr.normalizeRuntimeProviderId("https://x"));assert.throws(()=>rr.normalizeRuntimeProviderId("sk-abc"));});
 it("normalizes statuses and kinds and rejects execution states",()=>{assert.equal(rr.normalizeRuntimeReadinessStatus("ready-for-setup"),"ready-for-setup");assert.equal(rr.normalizeRuntimeProviderAvailabilityStatus("available"),"available");assert.equal(rr.normalizeRuntimeBindingStatus("bound"),"bound");assert.equal(rr.normalizeRuntimeCapabilityKind("python-runtime"),"python-runtime");assert.equal(rr.normalizeRuntimeProviderKind("manual"),"manual");assert.throws(()=>rr.normalizeRuntimeReadinessStatus("ready-to-run"));});
 it("normalizes requirement/provider/inventory/binding shapes safely",()=>{const req=rr.normalizeRuntimeRequirement({requirementId:"req.a" as never,targetWorkspaceId:ws,compositionPlanId:"plan.a" as never,capabilityKind:"python-runtime",capabilityKey:"python.3.11",isRequired:true,label:"Python",diagnostics:[],blockers:[]}); assert.equal(req.capabilityKey,"python.3.11"); assert.throws(()=>rr.normalizeRuntimeRequirement({...req,label:"prompt text"}));
 const pc=rr.normalizeRuntimeProviderCandidate({providerCandidateId:"pc.a" as never,providerKind:"python",inventorySourceId:"src.a" as never,capabilities:[],availabilityStatus:"available",displayLabel:"Python Host",diagnostics:[],blockers:[]}); assert.equal(pc.providerKind,"python");
 const inv=rr.normalizeRuntimeInventory({targetWorkspaceId:ws,inventorySourceId:"src.a" as never,inventorySourceKind:"desktop-host",discoveredProviderCandidates:[pc],discoveredCapabilities:[],inventoryStatus:"checked",diagnostics:[],blockers:[],checkedAt:"2026-05-21T00:00:00.000Z"}); assert.equal(inv.inventorySourceKind,"desktop-host");
 assert.throws(()=>rr.normalizeRuntimeInventory({...inv,discoveredCapabilities:[{capabilityId:"cap.a" as never,capabilityKind:"file-access",capabilityKey:"path:/tmp",label:"x",availabilityStatus:"available",diagnostics:[],blockers:[]}]}));
 });
 it("normalizes readiness binding and sanitizes non-throwing failure",()=>{const record={readinessBindingId:"rb.a" as never,targetWorkspaceId:ws,compositionPlanId:"plan.a" as never,status:"draft",requirements:[],providerCandidates:[],bindingCandidates:[],bindings:[],blockers:[],diagnostics:[],provenance:[],createdAt:"2026-05-21T00:00:00.000Z",updatedAt:"2026-05-21T00:00:00.000Z"};
 assert.equal(rr.normalizeRuntimeReadinessBinding(record).status,"draft");
 const result=rr.tryNormalizeRuntimeReadinessBinding({...record,createdAt:"bad secret token"}); assert.equal(result.status,"failure"); if(result.status==="failure") assert.equal(result.diagnostics[0]?.message.includes("secret"),false);
 });
 it("normalizes commands with explicit workspace+composition scope",()=>{assert.equal(rr.normalizeCreateRuntimeReadinessBindingCommand({targetWorkspaceId:ws,compositionPlanId:"plan.a" as never}).compositionPlanId,"plan.a");assert.equal(rr.normalizeSelectRuntimeBindingCandidateCommand({targetWorkspaceId:ws,readinessBindingId:"rb.a" as never,bindingCandidateId:"bc.a" as never}).bindingCandidateId,"bc.a");});
 it("result unions separate success/failure payloads",()=>{const ok:rr.CreateRuntimeReadinessBindingResult={status:"success",value:{readinessBindingId:"rb.a" as never,targetWorkspaceId:ws,compositionPlanId:"plan.a" as never,status:"draft",requirements:[],providerCandidates:[],bindingCandidates:[],bindings:[],blockers:[],diagnostics:[],provenance:[],createdAt:"2026-05-21T00:00:00.000Z",updatedAt:"2026-05-21T00:00:00.000Z"}}; assert.equal(ok.status,"success"); const fail=rr.createRuntimeReadinessFailure("validation","runtime-readiness-workspace-required",[]); assert.equal(fail.status,"failure");});
});


it("rejects compound credential metadata and unsafe bounded diagnostic records", () => {
 const diagnostic={code:"runtime-readiness-provider-unavailable" as const,severity:"error" as const,message:"Capability unavailable"};
 const blocker={code:diagnostic.code,message:diagnostic.message};
 const safe={count:0,enabled:false,absent:null,nested:{reasonCode:"not-configured"}};
 assert.deepEqual(rr.normalizeRuntimeReadinessSafeMetadata(safe),safe);
 for(const value of [{accessToken:"synthetic"},{OPENAI_API_KEY:"synthetic"},{nested:{label:"/srv/private"}},{count:NaN},{array:[]}]) assert.throws(()=>rr.normalizeRuntimeReadinessSafeMetadata(value));
 for(const value of [{...diagnostic,extra:{rawResponse:"synthetic"}},{...diagnostic,severity:"critical"},{...diagnostic,code:"invented-code"},{...diagnostic,message:"See /srv/private"},{...diagnostic,safeDetails:{refreshToken:"synthetic"}}]) {
  const result=rr.tryNormalizeRuntimeReadinessDiagnostic(value as never); assert.equal(result.status,"failure");
  if(result.status==="failure") assert.equal(result.diagnostics[0]?.message,"Sanitized normalization failure.");
 }
 assert.throws(()=>rr.normalizeRuntimeReadinessBlocker({...blocker,extra:"synthetic"} as never));
 assert.deepEqual(rr.normalizeRuntimeReadinessDiagnostic({...diagnostic,safeDetails:safe}),{...diagnostic,safeDetails:safe});
 assert.deepEqual(rr.normalizeRuntimeReadinessBlocker({...blocker,safeDetails:safe}),{...blocker,safeDetails:safe});
 let evaluated=false; const accessor=Object.defineProperty({...diagnostic},"message",{enumerable:true,get:()=>{evaluated=true;return "private";}});
 assert.throws(()=>rr.normalizeRuntimeReadinessDiagnostic(accessor)); assert.equal(evaluated,false);
});


it("requires primitive diagnostic fields without invoking nested trim getters", () => {
 let calls=0;
 const supplied=(result:string)=>Object.defineProperty({},"trim",{get:()=>{calls++;return()=>result;}});
 const diagnostic={code:"runtime-readiness-provider-unavailable" as const,severity:"error" as const,message:"Safe summary"};
 const blocker={code:diagnostic.code,message:diagnostic.message};
 for(const [field,text] of [["code",diagnostic.code],["severity","error"],["diagnosticId","diagnostic.a"],["message","Safe summary"]]) {
  assert.throws(()=>rr.normalizeRuntimeReadinessDiagnostic({...diagnostic,[field!]:supplied(text!)} as never));
 }
 for(const [field,text] of [["code",diagnostic.code],["blockerId","blocker.a"],["message","Safe summary"]]) {
  assert.throws(()=>rr.normalizeRuntimeReadinessBlocker({...blocker,[field!]:supplied(text!)} as never));
 }
 assert.equal(calls,0);
});
