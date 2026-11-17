import assert from "node:assert/strict";
import { describe, it } from "../../../testing/node-test";
import { createWorkspaceId } from "../../workspace";
import * as contracts from "..";

describe("asset composition contracts", () => {
  const ws = createWorkspaceId("workspace.alpha");
  it("normalizes identities/statuses/roles/kinds", () => {
    assert.equal(contracts.normalizeAssetCompositionPlanId("plan.alpha"), "plan.alpha");
    assert.equal(contracts.normalizeAssetCompositionPlanStatus("valid"), "valid");
    assert.equal(contracts.normalizeAssetCompositionNodeStatus("planned"), "planned");
    assert.equal(contracts.normalizeAssetCompositionCompatibilityStatus("compatible"), "compatible");
    assert.equal(contracts.normalizeAssetCompositionNodeRole("model"), "model");
    assert.equal(contracts.normalizeAssetCompositionRelationshipKind("depends-on"), "depends-on");
    assert.throws(() => contracts.normalizeAssetCompositionPlanStatus("execution-ready"));
  });
  it("supports non-throwing helpers without echoing unsafe values", () => {
    const result = contracts.tryNormalizeSelectedAssetProjectionReference({ targetWorkspaceId: ws, projectionId: "projection.a" as never, displayLabel: "prompt text" });
    assert.equal(result.status, "failure");
    if (result.status === "failure") assert.equal(result.diagnostics[0]?.message.includes("prompt text"), false);
  });
  it("normalizes plan/provenance/diagnostics safely", () => {
    const d = contracts.normalizeAssetCompositionDiagnostic({ code: "asset-composition-workspace-required", severity: "error", message: "/tmp/path", safeDetails: { reason: "bad" } });
    assert.equal(d.message.includes("/tmp"), false);
    const p = contracts.normalizeAssetCompositionProvenanceEvent({ kind: "plan-created", targetWorkspaceId: ws, operationAt: "2026-05-20T00:00:00.000Z", planId: "plan.alpha" as never });
    assert.equal(p.kind, "plan-created");
    assert.throws(() => contracts.normalizeAssetCompositionProvenanceEvent({ kind: "plan-created", targetWorkspaceId: ws, operationAt: "bad", actor: { actorType: "user", actorId: "a" } as never }));
  });
});


it("accepts the declared prompt-template capability while rejecting protected metadata", () => {
  assert.deepEqual(contracts.normalizeAssetCompositionCapability({kind: "prompt-template", key: "prompt-template", label: "Prompt template"}), {kind: "prompt-template", key: "prompt-template", label: "Prompt template"});
  for (const safeMetadata of [{prompt: "protected"}, {nested: {token: "protected"}}, {label: "prompt payload"}]) {
    assert.throws(() => contracts.normalizeAssetCompositionCapability({kind: "prompt-template", key: "prompt-template", safeMetadata}));
  }
});


it("redacts real filesystem paths and rejects undeclared or unsafe composition diagnostic details", () => {
 const diagnostic={code:"asset-composition-workspace-required" as const,severity:"error" as const,message:"Workspace required"};
 for(const message of ["/srv/private","See /opt/private","at(/private/example)","C:\\private\\example","\\\\host\\share"]) {
  assert.equal(contracts.normalizeAssetCompositionDiagnostic({...diagnostic,message}).message,"Sanitized diagnostic detail.");
  assert.equal(contracts.normalizeAssetCompositionBlocker({code:diagnostic.code,message}).message,"Sanitized diagnostic detail.");
 }
 const safe={count:0,enabled:false,absent:null,nested:{labels:["Ready",0,false,null]}};
 assert.deepEqual(contracts.normalizeAssetCompositionDiagnostic({...diagnostic,safeDetails:safe}).safeDetails,safe);
 for(const value of [{...diagnostic,extra:{rawResponse:"synthetic"}},{...diagnostic,safeDetails:{accessToken:"synthetic"}},{...diagnostic,safeDetails:{nested:{label:"/srv/private"}}},{...diagnostic,safeDetails:{count:Infinity}},{...diagnostic,message:1}]) assert.throws(()=>contracts.normalizeAssetCompositionDiagnostic(value as never));
 assert.throws(()=>contracts.normalizeAssetCompositionBlocker({code:diagnostic.code,message:"Safe",extra:"synthetic"} as never));
});


it("requires primitive diagnostic fields without invoking nested trim getters", () => {
 let calls=0;
 const supplied=(result:string)=>Object.defineProperty({},"trim",{get:()=>{calls++;return()=>result;}});
 const diagnostic={code:"asset-composition-workspace-required" as const,severity:"error" as const,message:"Safe summary"};
 const blocker={code:diagnostic.code,message:diagnostic.message};
 for(const [field,text] of [["code",diagnostic.code],["severity","error"],["diagnosticId","diagnostic.a"],["message","Safe summary"]]) {
  assert.throws(()=>contracts.normalizeAssetCompositionDiagnostic({...diagnostic,[field!]:supplied(text!)} as never));
 }
 for(const [field,text] of [["code",diagnostic.code],["blockerId","blocker.a"],["message","Safe summary"]]) {
  assert.throws(()=>contracts.normalizeAssetCompositionBlocker({...blocker,[field!]:supplied(text!)} as never));
 }
 assert.equal(calls,0);
});

it("redacts Windows rooted and drive-relative diagnostic messages",()=>{
 for(const message of [String.raw`\Users\synthetic\private.txt`,String.raw`C:synthetic.txt`,String.raw`C: `,String.raw`C: private.txt`,String.raw`see C: private.txt`]) {
  assert.equal(contracts.normalizeAssetCompositionDiagnostic({code:"asset-composition-workspace-required",severity:"error",message}).message,"Sanitized diagnostic detail.");
  assert.equal(contracts.normalizeAssetCompositionBlocker({code:"asset-composition-workspace-required",message}).message,"Sanitized diagnostic detail.");
 }
});
