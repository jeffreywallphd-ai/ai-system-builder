import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { AssetDerivedCustomizationWorkflowUseCase } from "..";
import { AssetDerivedCustomizationTargetCatalogService } from "../../../services/asset";
import { composeAssetDerivedCustomization } from "../../../../hosts/shared/composition/composeAssetDerivedCustomization";
import * as capture from "../../../services/asset/capture-derived-customization-requests";

const owner = "workspace.derived-test";
const ref = (id: string) => ({kind: "asset-definition-version", id, version: "1.0.0"});
function input(): any {return {workspaceId: owner, baseDefinitionRef: ref("asset.base"), derivedDefinitionRef: ref("asset.derived"), definitionRef: ref("asset.base"), baseImplementationReleaseId: "release.base.1", implementationReleaseId: "release.base.1", semanticPatch: {"display-name": "Original", "default-configuration": {value: "original"}, tags: ["original"]}, sourceChanges: [{operation: "upsert", path: "src/view.ts", role: "frontend-structure", mediaType: "text/typescript", content: "export const view = true;"}], customizationId: "customization.original", expectedRevision: 1, actorId: "author.original", text: "original", limit: 5};}
const signal = () => {let resolve!: () => void; return {promise: new Promise<void>(done => {resolve = done;}), resolve: () => resolve()};};
const entries = ["create", "update", "review", "publish", "abandon", "read", "list"] as const;
type Entry = typeof entries[number] | "listTargets" | "readTarget";
type Layer = "workflow" | "catalog" | "service";
const readOnly = (name: Entry) => ["read", "list", "listTargets", "readTarget"].includes(name);
function make(layer: Layer, name: Entry, workspaceAccess: any, effect: (...args: any[]) => any, ready?: () => Promise<void>): (value: any) => Promise<any> {
  const port = new Proxy({}, {get: () => effect});
  const dependencies: any = {workspaceAccess, customizations: port, targets: port, definitions: port, implementations: port, artifacts: port, backingResources: port, nextCustomizationId: effect, now: effect, digestText: effect};
  let target: any;
  if (layer === "workflow") target = new AssetDerivedCustomizationWorkflowUseCase(dependencies);
  if (layer === "catalog") target = new AssetDerivedCustomizationTargetCatalogService(dependencies);
  if (layer === "service") target = composeAssetDerivedCustomization({workspaceAccess, documents: port, definitions: port, implementations: {repository: port, backingResources: port}, artifacts: port, ensureReady: ready ?? effect, now: effect} as any).service;
  const method = layer === "catalog" ? name === "listTargets" ? "list" : "read" : name;
  return name === "read" ? () => target[method](owner, "customization.original") : value => target[method](value);
}

for (const layer of ["workflow", "catalog", "service"] as const) {
  const names: readonly Entry[] = layer === "catalog" ? ["listTargets", "readTarget"] : layer === "workflow" ? entries : [...entries, "listTargets", "readTarget"];
  for (const name of names) for (const mode of ["absent", "throwing", "denied"] as const) test(`${layer}/${name}: ${mode} authority precedes protected effects`, {timeout: 5_000}, async () => {
    let effects = 0, admissions = 0;
    const effect = () => {effects++; throw Error("Protected effect reached");};
    const access = mode === "absent" ? undefined : {async authorize(workspaceId: string, operation: string, scope: string) {
      admissions++; assert.equal(workspaceId, owner); assert.equal(operation, layer === "catalog" ? `asset-authoring.customization-target.${name === "listTargets" ? "list" : "read"}` : `asset-authoring.customization.${name}`); assert.equal(scope, readOnly(name) ? "asset:read" : "asset:write"); throw Error("private policy detail");
    }};
    const run = make(layer, name, access, effect);
    if (layer !== "workflow" || name === "read" || name === "list") await assert.rejects(run(input()), /Workspace asset access is unavailable or forbidden/);
    else {const result = await run(input()); assert.equal(result.kind, "failure"); assert.ok(!JSON.stringify(result).includes("private policy detail"));}
    assert.equal(effects, 0); assert.equal(admissions, mode === "absent" ? 0 : 1);
  });
}

for (const layer of ["workflow", "catalog"] as const) {
  const names: readonly Entry[] = layer === "catalog" ? ["listTargets", "readTarget"] : entries.filter(name => name !== "read");
  for (const name of names) test(`${layer}/${name}: first protected lookup keeps captured values`, {timeout: 5_000}, async () => {
    const entered = signal(), release = signal(); const used: any[][] = [];
    const access = {async authorize(workspaceId: string) {assert.equal(workspaceId, owner); entered.resolve(); await release.promise;}};
    const value = input(); const effect = (...args: any[]) => {used.push(args); throw Error("finite captured lookup stop");};
    const pending = make(layer, name, access, effect)(value).catch(() => undefined);
    try {
      await entered.promise; value.workspaceId = "workspace.foreign"; value.customizationId = "customization.changed"; value.baseDefinitionRef.id = "asset.changed"; value.definitionRef.id = "asset.changed"; value.baseImplementationReleaseId = "release.changed"; value.implementationReleaseId = "release.changed"; value.text = "changed"; value.expectedRevision = 99;
      release.resolve(); await pending; assert.ok(used.length > 0);
      if (name === "create") assert.deepEqual(used[0], [{workspaceId: owner, definitionRef: ref("asset.base"), implementationReleaseId: "release.base.1"}]);
      else if (name === "list" && layer === "workflow") assert.equal(used[0][0].workspaceId, owner);
      else if (layer === "catalog") assert.equal(used[0][0], name === "listTargets" ? owner : "release.base.1");
      else assert.deepEqual(used[0], [owner, "customization.original"]);
    } finally {release.resolve(); await pending;}
  });
}

for (const name of [...entries.filter(name => name !== "read"), "listTargets", "readTarget"] as const) test(`service/${name}: ready wait retains admitted workspace`, {timeout: 5_000}, async () => {
  const entered = signal(), release = signal(); const admissions: any[][] = [], effects: any[][] = [];
  const value = input();
  const run = make("service", name, {async authorize(...args: any[]) {admissions.push(args);}}, (...args: any[]) => {effects.push(args); throw Error("finite stop");}, async () => {entered.resolve(); await release.promise;});
  const pending = run(value).catch(() => undefined);
  try {await entered.promise; value.workspaceId = "workspace.foreign"; value.customizationId = "customization.changed"; value.baseDefinitionRef.id = "asset.changed"; value.definitionRef.id = "asset.changed"; value.text = "changed"; value.semanticPatch["default-configuration"].value = "changed"; value.sourceChanges[0].content = "changed"; release.resolve(); await pending;
    assert.ok(admissions.length >= 2); assert.ok(admissions.every(args => args[0] === owner)); assert.ok(effects.length > 0);
    if (name === "create") assert.equal(effects[0][0], "release.base.1");
    if (name === "list") assert.equal(effects[0][0], "asset-authoring/derived-customizations");
  } finally {release.resolve(); await pending;}
});

test("semantic normalizers are followed by owned copies of structural, list and source fields", () => {
  const value = input(); const created = capture.captureDerivedCreate(value), updated = capture.captureDerivedUpdate(value);
  const listed = capture.captureDerivedList(value); value.text = "changed"; value.limit = 99; assert.equal(listed.text, "original"); assert.equal(listed.limit, 5);
  value.semanticPatch["default-configuration"].value = "changed"; value.semanticPatch.tags[0] = "changed"; value.sourceChanges[0].content = "changed"; value.actorId = "changed";
  for (const command of [created, updated]) {
    assert.deepEqual(command.semanticPatch["default-configuration"], {value: "original"}); assert.deepEqual(command.semanticPatch.tags, ["original"]); assert.equal(command.sourceChanges?.[0].operation, "upsert"); assert.equal((command.sourceChanges?.[0] as any).content, "export const view = true;"); assert.equal(command.actorId, "author.original");
  }
});

test("malformed nested input settles without policy or protected effects", async () => {
  for (const mutate of [(v: any) => {v.sourceChanges = new Array(65);}, (v: any) => {v.sourceChanges[0].path = "../outside.ts";}, (v: any) => {v.semanticPatch["default-configuration"].secret = "private";}, (v: any) => {v.sourceChanges[0].content = "x".repeat(200_001);}]) {
    const value = input(); mutate(value); let effects = 0; const effect = () => {effects++; throw Error("protected");};
    const result = await make("workflow", "create", {async authorize() {effects++;}}, effect)(value); assert.equal(result.kind, "failure"); assert.equal(effects, 0);
  }
});

for (const name of ["create", "listTargets"] as const) test(`service/${name}: revocation during readiness prevents later protected effects`, {timeout: 5_000}, async () => {
  const entered = signal(), release = signal(); let allowed = true, effects = 0;
  const admissions: string[] = [];
  const run = make("service", name, {async authorize(workspaceId: string, operation: string) {
    assert.equal(workspaceId, owner); admissions.push(operation);
    if (!allowed) throw Error("private revoked membership detail");
  }}, () => {effects++; throw Error("Protected effect reached");}, async () => {entered.resolve(); await release.promise;});
  // Observe rejection immediately so a failing implementation cannot leak an
  // unhandled rejection while the finite readiness barrier is held.
  const pending = run(input()).then(value => ({value}), error => ({error}));
  try {
    await entered.promise; allowed = false; release.resolve(); const result = await pending;
    if (name === "create") {assert.ok("value" in result); assert.equal(result.value.kind, "failure");}
    else {assert.ok("error" in result); assert.match(String(result.error), /Workspace asset access is unavailable or forbidden/);}
    assert.equal(effects, 0); assert.equal(admissions.length, 2);
    assert.equal(admissions[0], `asset-authoring.customization.${name}`);
    assert.equal(admissions[1], name === "create" ? "asset-authoring.customization.create" : "asset-authoring.customization-target.list");
    assert.ok(!JSON.stringify(result).includes("private revoked membership detail"));
  } finally {release.resolve(); await pending;}
});

for (const name of ["create", "update"] as const) for (const stage of ["target", "repository", "artifact"] as const) test(`workflow/${name}: ${stage} wait cannot change persisted nested request values`, {timeout: 5_000}, async () => {
  const entered = signal(), release = signal(); let gated = false;
  const hold = async (current: typeof stage) => {if (gated && current === stage) {entered.resolve(); await release.promise;}};
  const artifact = (content: string, mediaType: string) => ({artifactId: "artifact.derived-fixture", kind: "source", digest: `sha256:${createHash("sha256").update(content).digest("hex")}`, mediaType, sizeBytes: Buffer.byteLength(content)});
  const target = {eligibility: {eligible: true}, definition: {}, definitionRef: ref("asset.base"), implementationReleaseId: "release.base.1", baseSourceSnapshotId: "source-snapshot.base.1", baseSourceArtifact: artifact("base source", "text/typescript"), sourceKind: "workspace-local-asset"};
  let stored: any; const overlays: any[] = [], targetQueries: any[] = [], reads: any[][] = [], definitions: any[] = [], revisions: number[] = [];
  const workflow = new AssetDerivedCustomizationWorkflowUseCase({
    workspaceAccess: {async authorize(workspaceId: string) {assert.equal(workspaceId, owner);}},
    targets: {async read(query: any) {targetQueries.push(structuredClone(query)); await hold("target"); return target;}},
    definitions: {async getDefinition(reference: any) {definitions.push(structuredClone(reference)); await hold("repository"); return undefined;}},
    customizations: {
      async read(...args: any[]) {reads.push(args); await hold("repository"); return stored;},
      async create(record: any) {stored = structuredClone(record); return structuredClone(stored);},
      async update(record: any, expectedRevision: number) {revisions.push(expectedRevision); stored = structuredClone(record); return structuredClone(stored);},
    },
    artifacts: {async putImmutable(request: any) {overlays.push(structuredClone(request)); await hold("artifact"); return artifact(request.content, request.mediaType);}},
    implementations: {}, now: () => "2026-10-27T12:00:00.000Z", nextCustomizationId: () => "customization.original", digestText: (text: string) => `sha256:${createHash("sha256").update(text).digest("hex")}`,
  } as any);
  if (name === "update") {const seeded = await workflow.create(input()); assert.equal(seeded.kind, "success");}
  overlays.length = 0; targetQueries.length = 0; reads.length = 0; definitions.length = 0; gated = true;
  const value = input(); const pending = workflow[name](value);
  try {
    await entered.promise;
    value.workspaceId = "workspace.foreign"; value.customizationId = "customization.changed"; value.expectedRevision = 99; value.actorId = "author.changed";
    value.baseDefinitionRef.id = "asset.changed"; value.derivedDefinitionRef.id = "asset.changed"; value.baseImplementationReleaseId = "release.changed";
    value.semanticPatch["display-name"] = "Changed"; value.semanticPatch["default-configuration"].value = "changed"; value.semanticPatch.tags[0] = "changed";
    value.sourceChanges[0].content = "export const changed = true;"; value.sourceChanges[0].path = "src/changed.ts"; value.clearSourceOverlay = true;
    release.resolve(); const result = await pending; assert.equal(result.kind, "success");
    assert.equal(stored.workspaceId, owner); assert.equal(stored.customizationId, "customization.original");
    assert.equal(stored.revision, name === "create" ? 1 : 2); assert.equal(stored.createdBy, "author.original"); assert.equal(stored.provenance.derivedBy, "author.original");
    assert.deepEqual(stored.derivedDefinitionRef, ref("asset.derived")); assert.deepEqual(stored.semanticPatch, input().semanticPatch);
    assert.deepEqual(targetQueries, [{workspaceId: owner, definitionRef: ref("asset.base"), implementationReleaseId: "release.base.1"}]);
    if (name === "create") {assert.deepEqual(definitions, [ref("asset.derived")]); assert.deepEqual(revisions, []);}
    else {assert.deepEqual(reads, [[owner, "customization.original"]]); assert.deepEqual(revisions, [1]);}
    assert.equal(overlays.length, 1); assert.equal(overlays[0].workspaceId, owner);
    assert.deepEqual(JSON.parse(overlays[0].content), {formatVersion: "1.0", changes: input().sourceChanges});
    assert.deepEqual(stored.sourceOverlay.artifact, artifact(overlays[0].content, overlays[0].mediaType));
  } finally {release.resolve(); await pending;}
});
