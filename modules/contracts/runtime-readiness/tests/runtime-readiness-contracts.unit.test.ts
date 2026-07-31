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
