import assert from "node:assert/strict";
import test from "node:test";
import { captureImageHostFixture, captureImageFinalization, imageArtifactId, imageStorageKey, imageHostWorkspace, imageHostModelRecord, imageHostReport, imagePublicId, imageTaskStorageKey, IMAGE_HOST_PHASES } from "../visual-composer/image-generation-host-oracles";

import {ArtifactId} from "../../../../modules/domain/artifact/ArtifactId";
const run = "image-qualification-run-0001", source = `source.${"a".repeat(64)}`;
test("real-response witnesses retain the exact scoped task, asset, artifact and storage identity",()=>{
  const request={workspaceId:"workspace.synthetic",requestId:"request.synthetic"},asset={assetId:"asset.synthetic",artifactId:ArtifactId.generate({now:()=>new Date("2026-10-29T00:00:00Z"),randomSuffix:()=>"synthetic"}).toString(),storageKey:"workspaces/workspace.synthetic/generated/images/result.png",mediaType:"image/png"};
  const response={ok:true,value:{finalized:true,assets:[asset]}};
  const capture=(q:unknown,r:unknown)=>captureImageFinalization(JSON.stringify(q),JSON.stringify(r),request.workspaceId);
  assert.deepEqual(capture(request,response),{requestId:request.requestId,assetId:asset.assetId,artifactId:asset.artifactId,storageKey:asset.storageKey});
  for(const requestPatch of [{workspaceId:"workspace.other"},{requestId:""},{extra:true}])assert.throws(()=>capture({...request,...requestPatch},response));
  for(const assetPatch of [{artifactId:""},{assetId:""},{storageKey:"../private.png"},{storageKey:"https://example.invalid/x.png"},{mediaType:"text/plain"}])assert.throws(()=>capture(request,{ok:true,value:{finalized:true,assets:[{...asset,...assetPatch}]}}));
  for(const r of [{ok:false,value:response.value},{ok:true,value:{...response.value,finalized:false}},{ok:true,value:{finalized:true,assets:[asset,asset]}}])assert.throws(()=>capture(request,r));
  assert.throws(()=>captureImageFinalization(" ".repeat(4097),JSON.stringify(response),request.workspaceId));assert.throws(()=>captureImageFinalization(JSON.stringify(request)," ".repeat(16385),request.workspaceId));
  for(const key of ["", "file:///private.png","workspaces/../private.png","workspaces//x.png","x.jpg"])assert.throws(()=>imageStorageKey(key));
});
function declaration(target: "packaged-desktop" | "thin-chrome" = "packaged-desktop", journey: "create-register" | "task-recovery" = "create-register") {
  return { schemaVersion: "image-host-fixture-v1", runId: run, sourceRevision: source, host: target, journey,
    workspaceId: imageHostWorkspace(run, target, journey), modelRecordId: imageHostModelRecord(run,target,journey),
    checkpointFileName: "qualified-image.safetensors", checkpointSha256: "b".repeat(64) };
}
test("image input declarations are detached, frozen and bound to each host and journey", () => {
  const identities = new Set<string>();
  for (const target of ["packaged-desktop", "thin-chrome"] as const) for (const journey of ["create-register", "task-recovery"] as const) {
    const original = declaration(target, journey);
    const accepted = captureImageHostFixture(JSON.stringify(original), run, source, target, journey);
    assert.deepEqual(accepted, original);
    assert.ok(Object.isFrozen(accepted));
    original.modelRecordId = "model.changed";
    assert.equal(accepted!.modelRecordId, imageHostModelRecord(run,target,journey));
    identities.add(accepted!.workspaceId);
  }
  assert.equal(identities.size, 4);
});
test("absent image prerequisites are absent declarations and never a pass", () => {
  assert.equal(captureImageHostFixture(undefined, run, source, "packaged-desktop", "create-register"), undefined);
  assert.equal(captureImageHostFixture("", run, source, "packaged-desktop", "create-register"), undefined);
  assert.equal(imageHostReport("packaged-desktop", "create-register", [], false).status, "failed");
});
test("foreign run, source, host, journey, workspace and unknown payload fields deny", () => {
  const value = declaration();
  for (const changed of [
    { ...value, runId: "other-qualification-run-0002" }, { ...value, sourceRevision: `source.${"c".repeat(64)}` },
    { ...value, host: "thin-chrome" }, { ...value, journey: "task-recovery" },
    { ...value, workspaceId: "workspace.foreign" }, { ...value, prompt: "private synthetic text" },
    { ...value, modelRecordId: imageHostModelRecord(run,"thin-chrome","task-recovery") },
    { ...value, schemaVersion: "image-host-result-v1" },
  ]) assert.throws(() => captureImageHostFixture(JSON.stringify(changed), run, source, "packaged-desktop", "create-register"));
});
test("shared checkpoint bytes keep four distinct scoped model records",()=>{
  const records=new Set<string>();
  for(const target of ["packaged-desktop","thin-chrome"] as const)for(const journey of ["create-register","task-recovery"] as const){
    const value=declaration(target,journey);records.add(value.modelRecordId);
    assert.equal(value.checkpointFileName,"qualified-image.safetensors");
    assert.equal(value.modelRecordId,imageHostModelRecord(run,target,journey));
  }
  assert.equal(records.size,4);
});
test("malformed, oversized and nonrecord image declarations deny without disclosure", () => {
  for (const value of [null, {}, [], "{", "null", "[]", " ".repeat(4097), JSON.stringify({ ...declaration(), modelRecordId: "private\npayload" })]) {
    assert.throws(() => captureImageHostFixture(value, run, source, "packaged-desktop", "create-register"), {
      message: "The fixed image host test declaration is unavailable or invalid.",
    });
  }
});
test("only a safe checkpoint basename and exact hash enter the public declaration", () => {
  for (const name of ["../private.safetensors", "C:\\private.safetensors", "/private.safetensors", "https://example.invalid/model.safetensors", "model.bin", "model.pkl", "model.safetensors\n", "a".repeat(121) + ".safetensors"]) {
    assert.throws(() => captureImageHostFixture(JSON.stringify({ ...declaration(), checkpointFileName: name }), run, source, "packaged-desktop", "create-register"));
  }
  for (const hash of ["", "b".repeat(63), "B".repeat(64), "private"]) {
    assert.throws(() => captureImageHostFixture(JSON.stringify({ ...declaration(), checkpointSha256: hash }), run, source, "packaged-desktop", "create-register"));
  }
});
test("image task keys use only the actual host namespace and fixed owned workspace", () => {
  for (const target of ["packaged-desktop", "thin-chrome"] as const) {
    const workspace = imageHostWorkspace(run, target, "task-recovery");
    const expected = target === "packaged-desktop" ? "ai-system-builder.image-task.v1:" : "ai-system-builder.thin-image-task.v1:";
    assert.equal(imageTaskStorageKey(target, workspace), expected + workspace);
  }
  for (const target of ["desktop", "unknown", {}]) assert.throws(() => imageTaskStorageKey(target, "workspace.foreign"));
  for (const id of ["", "/private/path", "model\nprivate", {}]) assert.throws(() => imagePublicId(id));
});
test("only the exact complete phase sequence can produce a passed image UI outcome", () => {
  for (const scenario of ["create-register", "task-recovery"] as const) {
    const phases = IMAGE_HOST_PHASES[scenario];
    for (let count = 0; count <= phases.length; count++) {
      const report = imageHostReport("packaged-desktop", scenario, phases.slice(0, count), false);
      assert.equal(report.status, count === phases.length ? "passed" : "failed");
      assert.equal(report.parentQualificationGranted, false);
    }
    assert.equal(imageHostReport("thin-chrome", scenario, [...phases], true).status, "failed");
    assert.throws(() => imageHostReport("thin-chrome", scenario, [...phases].reverse(), false));
  }
});
test("phase admission rejects holes, accessors, proxies and extra fields without executing them", () => {
  let effects = 0;
  const accessor = [] as unknown as string[];
  Object.defineProperty(accessor, "0", { get() { effects++; throw new Error("must not execute"); }, enumerable: true });
  const extra = [IMAGE_HOST_PHASES["create-register"][0]];
  Object.assign(extra, { payload: "private" });
  for (const phases of [new Array(1), accessor, extra, new Proxy([], { ownKeys() { effects++; return []; } }), ["private"]]) {
    assert.throws(() => imageHostReport("thin-chrome", "create-register", phases, false));
  }
  assert.equal(effects, 0);
});

test("semantic artifact IDs retain exact canonical slash identities and reject normalization or traversal",()=>{
  const id=ArtifactId.generate({now:()=>new Date("2026-10-29T00:00:00Z"),randomSuffix:()=>"synthetic"}).toString();
  assert.equal(imageArtifactId(id),"artifacts/20261029000000-synthetic");
  for(const value of ["",null,{},"ARTIFACTS/20261029000000-synthetic"," artifacts/20261029000000-synthetic ","artifacts//item","artifacts/../item","artifacts/./item","/artifacts/item","C:/private","x".repeat(193)])assert.throws(()=>imageArtifactId(value));
});
