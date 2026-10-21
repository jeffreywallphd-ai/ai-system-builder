import assert from "node:assert/strict";
import { describe, it } from "../../../testing/node-test";
import { normalizeAssetId, normalizeAssetReferenceKind } from "../../asset";
import { createWorkspaceId } from "../../workspace";
import * as contracts from "..";

describe("effective-asset-projection contracts", () => {
  const workspaceId = createWorkspaceId("workspace.alpha");
  const assetRef = { kind: normalizeAssetReferenceKind("asset-definition"), id: normalizeAssetId("asset.alpha"), version: "1.0.0" };

  it("normalizes valid IDs and rejects unsafe IDs without echoing raw values", () => {
    assert.equal(contracts.normalizeEffectiveAssetProjectionId(" projection.alpha "), "projection.alpha");
    for (const invalid of ["", " ", "../x", "https://x", "ghp_secret", "path/x"]) {
      assert.throws(() => contracts.normalizeEffectiveAssetProjectionId(invalid), (e: unknown) => {
        assert.ok(e instanceof Error);
        if (invalid.trim().length > 0) {
          assert.equal(e.message.includes(invalid), false);
        }
        return true;
      });
    }
  });

  it("normalizes supported status/policy/source and rejects unsupported runtime-like values", () => {
    assert.equal(contracts.normalizeEffectiveAssetProjectionStatus(" READY "), "ready");
    assert.equal(contracts.normalizeEffectiveAssetProjectionPolicy("safe-fields-only"), "safe-fields-only");
    assert.equal(contracts.normalizeEffectiveAssetProjectionSourceKind("workspace-authored"), "workspace-authored");
    assert.throws(() => contracts.normalizeEffectiveAssetProjectionStatus("auto-sync"));
    assert.throws(() => contracts.normalizeEffectiveAssetProjectionPolicy("provider-payload-materialization"));
    assert.throws(() => contracts.normalizeEffectiveAssetProjectionSourceKind("workspace-live-link"));
  });

  it("accepts only safe projected fields and safe nested metadata", () => {
    assert.equal(contracts.normalizeSafeEffectiveAssetProjectedField("display-name"), "display-name");
    assert.throws(() => contracts.normalizeSafeEffectiveAssetProjectedField("prompt-text"));
    assert.throws(() => contracts.normalizeSafeEffectiveAssetProjectedField("workflow-json"));
    assert.throws(() => contracts.normalizeSafeEffectiveAssetProjectedFieldPatch({ "safe-metadata": { "token.secret": "x" } as any }));
  });

  it("requires explicit workspace ids on commands and normalizes projection records", () => {
    const cmd = contracts.normalizeCreateEffectiveAssetProjectionCommand({
      targetWorkspaceId: workspaceId,
      source: { sourceKind: "workspace-authored", targetWorkspaceId: workspaceId, effectiveAssetReference: assetRef },
      target: { targetWorkspaceId: workspaceId, effectiveAssetReference: assetRef, intendedPolicy: "safe-fields-only" },
      policy: "safe-fields-only",
    });
    assert.equal(cmd.targetWorkspaceId, workspaceId);

    const record = contracts.normalizeEffectiveAssetProjectionRecord({
      projectionId: "projection.alpha" as any,
      targetWorkspaceId: workspaceId,
      source: { sourceKind: "workspace-authored-draft", targetWorkspaceId: workspaceId, effectiveAssetReference: assetRef },
      target: { targetWorkspaceId: workspaceId, effectiveAssetReference: assetRef, intendedPolicy: "draft-preview-only" },
      effectiveAssetReference: assetRef,
      sourceKind: "workspace-authored-draft",
      status: "draft-only",
      policy: "draft-preview-only",
      projectedFields: { "display-name": "Draft" },
      diagnostics: [], blockers: [], provenance: { kind: "projected-from-authored-draft-preview", targetWorkspaceId: workspaceId, operationAt: "2026-05-20T00:00:00.000Z" },
      createdAt: "2026-05-20T00:00:00.000Z", updatedAt: "2026-05-20T00:00:00.000Z",
    });
    assert.equal(record.status, "draft-only");
  });

  it("result shapes are discriminated and diagnostics are sanitized", () => {
    const failure: contracts.CreateEffectiveAssetProjectionResult = { status: "failure", failure: { kind: "validation", code: "effective-projection-source-required", diagnostics: [{ code: "effective-projection-source-required", message: "raw /tmp/x" }] } };
    assert.equal(failure.status, "failure");
    assert.equal(contracts.normalizeEffectiveAssetProjectionDiagnostic(failure.failure.diagnostics[0]).message.includes("/tmp"), false);
  });

  it("exports from family and root barrel", async () => {
    assert.equal(typeof contracts.normalizeEffectiveAssetProjectionId, "function");
    const root = await import("../../index");
    assert.equal(typeof root.effectiveAssetProjections.normalizeEffectiveAssetProjectionId, "function");
  });
});

describe('strict complete projection records',()=>{
 const at='2026-05-20T00:00:00.000Z';
 const ref={kind:'asset-definition-version',id:'asset.alpha',version:'1.0.0',label:'Prompt template',metadata:{count:0}};
 const base:any={projectionId:'projection.alpha',targetWorkspaceId:'ws-1',source:{sourceKind:'workspace-local',targetWorkspaceId:'ws-1',effectiveAssetReference:ref},target:{targetWorkspaceId:'ws-1',effectiveAssetReference:ref,intendedPolicy:'safe-fields-only'},effectiveAssetReference:ref,sourceKind:'workspace-local',status:'ready',policy:'safe-fields-only',projectedFields:{'display-name':'Prompt template','safe-metadata':{count:0,enabled:false,items:[null,'Ready']}},diagnostics:[],blockers:[],provenance:{kind:'projected-from-workspace-local-asset',targetWorkspaceId:'ws-1',operationAt:at},sourceGraphSummary:{sourceCount:0,hasOverrides:false,hasMissingSource:false,hasConflict:false},createdAt:at,updatedAt:at};
 it('preserves declared references, labels, zero/false metadata and required snapshot identity',()=>{
  assert.deepEqual(contracts.normalizeEffectiveAssetProjectionRecord(base),base);
  assert.throws(()=>contracts.normalizeEffectiveAssetProjectionSnapshotRecord(base));
  const snapshot={...base,projectionSnapshotId:'snapshot.alpha'};
  assert.deepEqual(contracts.normalizeEffectiveAssetProjectionSnapshotRecord(snapshot),snapshot);
 });
 it('rejects undeclared nested fields, unsafe reference labels/metadata and invalid scalar/provenance shapes',()=>{
  for(const value of [
   {...base,payload:'private'}, {...base,createdAt:'2026-02-30T00:00:00.000Z'},
   {...base,projectionRevisionId:'../private'}, {...base,sourceGraphSummary:{...base.sourceGraphSummary,sourceCount:NaN}},
   {...base,sourceGraphSummary:{...base.sourceGraphSummary,hasConflict:'false'}},
   {...base,provenance:{...base.provenance,kind:'invented'}}, {...base,provenance:{...base.provenance,rawPayload:'private'}},
   {...base,effectiveAssetReference:{...ref,label:'https://private.test'}},
   {...base,effectiveAssetReference:{...ref,metadata:{accessToken:'private'}}},
   {...base,source:{...base.source,command:'private'}},
   {...base,target:{...base.target,command:'private'}},
   {...base,diagnostics:[{code:'effective-projection-source-missing',message:'Failed',payload:'private'}]},
  ]) assert.throws(()=>contracts.normalizeEffectiveAssetProjectionRecord(value));
 });
 it('rejects accessors/cycles and exhausted metadata bounds without evaluation or echo',()=>{
  let calls=0;
  const reference={...ref};Object.defineProperty(reference,'label',{enumerable:true,get(){calls++;return'private';}});
  assert.throws(()=>contracts.normalizeEffectiveAssetProjectionRecord({...base,effectiveAssetReference:reference}));
  const cycle:any={};cycle.self=cycle;
  for(const metadata of [cycle,{value:Infinity},{refreshToken:'private'},{value:'C: private'},new Array(129).fill(false),{value:'ghp_'+'syntheticvalue'.repeat(3)}])
   assert.throws(()=>contracts.normalizeSafeEffectiveAssetProjectedFieldPatch({'safe-metadata':metadata}));
  assert.equal(calls,0);
  assert.throws(()=>contracts.normalizeSafeEffectiveAssetProjectedFieldPatch({'display-name':'A',' DISPLAY-NAME ':'B'}));
  assert.throws(()=>contracts.normalizeListEffectiveAssetProjectionsCommand({targetWorkspaceId:'ws-1',limit:'25'} as any));
 });
 it('retains projection-family metadata restrictions in diagnostics, blockers and references',()=>{
  const metadata={detail:'echo synthetic; bash'};
  const diagnostic={code:'effective-projection-source-missing',message:'Failed',metadata} as const;
  assert.throws(()=>contracts.normalizeSafeEffectiveAssetProjectedFieldPatch({'safe-metadata':metadata}));
  assert.throws(()=>contracts.normalizeEffectiveAssetProjectionDiagnostic(diagnostic));
  assert.throws(()=>contracts.normalizeEffectiveAssetProjectionBlocker(diagnostic));
  assert.throws(()=>contracts.normalizeEffectiveAssetProjectionRecord({...base,diagnostics:[diagnostic]}));
  assert.throws(()=>contracts.normalizeEffectiveAssetProjectionRecord({...base,effectiveAssetReference:{...ref,metadata}}));
 });
 it('requires duplicated target workspace and effective identities to agree, preserving cross-workspace source provenance',()=>{
  for(const value of [
   {...base,source:{...base.source,targetWorkspaceId:'ws-other'}},
   {...base,target:{...base.target,targetWorkspaceId:'ws-other'}},
   {...base,provenance:{...base.provenance,targetWorkspaceId:'ws-other'}},
   {...base,target:{...base.target,effectiveAssetReference:{...ref,id:'asset.other'}}},
   {...base,target:{...base.target,effectiveAssetReference:{...ref,version:'2.0.0'}}},
   {...base,target:{...base.target,projectionId:'projection.other'}},
  ]){
   assert.throws(()=>contracts.normalizeEffectiveAssetProjectionRecord(value));
   assert.throws(()=>contracts.normalizeEffectiveAssetProjectionSnapshotRecord({...value,projectionSnapshotId:'snapshot.alpha'}));
  }
  const crossSource={...base,status:'blocked',policy:'blocked',source:{...base.source,sourceWorkspaceId:'ws-library'},provenance:{...base.provenance,sourceWorkspaceId:'ws-library'}};
  assert.equal(contracts.normalizeEffectiveAssetProjectionRecord(crossSource).source.sourceWorkspaceId,'ws-library');
 });
});
