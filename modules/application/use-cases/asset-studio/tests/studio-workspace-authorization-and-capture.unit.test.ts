import assert from "node:assert/strict";
import test from "node:test";
import { StartAssetStudioUseCase, ProposeAssetStudioChangeUseCase, ReviewAssetStudioProposalUseCase, ReadAssetStudioProposalUseCase, ListAssetStudioWorkflowsUseCase, AssetStudioAssetDraftWorkflowUseCase } from "..";
import * as capture from "../../../services/asset-studio/capture-studio-requests";

const owner = "workspace.studio-test";
const reference = () => ({kind: "asset-definition-version", id: "asset.test", version: "1.0.0", label: "Original", metadata: {nested: ["original"]}});
const proposal = () => ({summary: "Original proposal", plan: ["Add view"], files: [{path: "src/view.ts", content: "export const view = true;"}], dependencies: ["approved"], requestedCapabilities: ["read"], model: {provider: "fixture", modelId: "original"}});
function command(): any { return {workspaceId: owner, workflowId: "workflow.original", implementationDraftId: "implementation.original", definitionRef: reference(), displayName: "Original", actorId: "author.original", mode: "manual", intent: "Add a useful view", context: [{id: "context.original", kind: "source", content: "Original source"}], allowedDependencies: ["approved"], allowedCapabilities: ["read"], manualProposal: proposal(), expectedRevision: 3, decision: "approve", approvedDependencies: ["approved"], approvedCapabilities: ["read"], draftId: "draft.original", semanticDefinition: {assetType: "tool", assetFamily: "behavioral", displayName: "Original", description: "Original definition", metadata: {nested: ["original"]}}, resources: [{path: "backend/logic.ts", role: "backend-logic", mediaType: "text/typescript", content: "export const value = 1;"}], status: "draft", unpublishedOnly: true, text: "original", limit: 5, cursor: "cursor.original"}; }
const entries = ["start", "propose", "review", "read", "list", "draftCreate", "draftUpdate", "draftRead", "draftList", "draftReview", "draftPublish", "draftAbandon"] as const;
type Entry = typeof entries[number];
const operation = (name: Entry) => name.startsWith("draft") ? `asset-studio.asset-draft.${name.slice(5).toLowerCase()}` : `asset-studio.${name}`;
const readOnly = (name: Entry) => ["read", "list", "draftRead", "draftList"].includes(name);
function make(name: Entry, access: any, effect: (...args: any[]) => any, overrides: any = {}): (input: any) => Promise<any> {
  const port = new Proxy({}, {get: () => effect});
  const dependencies: any = {workspaceAccess: access, workflows: port, implementations: port, artifacts: port, drafts: port, definitions: port, createDraft: port, snapshotSource: port, nextSnapshotId: effect, nextDraftId: effect, digestText: effect, now: effect, ...overrides};
  if (name === "start") return (input: any) => new StartAssetStudioUseCase({execute: effect} as any, effect, access).execute(input);
  if (name === "propose") return (input: any) => new ProposeAssetStudioChangeUseCase(dependencies).execute(input);
  if (name === "review") return (input: any) => new ReviewAssetStudioProposalUseCase(dependencies).execute(input);
  if (name === "read") return () => new ReadAssetStudioProposalUseCase(port as any, port as any, access).execute(owner as any, "workflow.original");
  if (name === "list") return () => new ListAssetStudioWorkflowsUseCase(port as any, access).execute(owner as any);
  const workflow = new AssetStudioAssetDraftWorkflowUseCase(dependencies);
  const method = name.slice(5).toLowerCase() as "create" | "update" | "read" | "list" | "review" | "publish" | "abandon";
  return (input: any) => workflow[method](input);
}

for (const name of entries) for (const mode of ["absent", "throwing", "denied"] as const) test(`${name}: ${mode} authority precedes every protected effect`, {timeout: 5_000}, async () => {
  let effects = 0, admissions = 0;
  const effect = () => {effects++; throw Error("Protected effect reached");};
  const access = mode === "absent" ? undefined : {async authorize(workspaceId: string, op: string, scope: string) {
    admissions++; assert.equal(workspaceId, owner); assert.equal(op, operation(name)); assert.equal(scope, readOnly(name) ? "asset:read" : "asset:write");
    throw Error("private authorization detail");
  }};
  const run = make(name, access, effect);
  if (name === "list") await assert.rejects(run(command()), /Workspace asset access is unavailable or forbidden/);
  else { const result = await run(command()); assert.equal(result.ok, false); assert.ok(!JSON.stringify(result).includes("private authorization detail")); }
  assert.equal(effects, 0); assert.equal(admissions, mode === "absent" ? 0 : 1);
});

const signal = () => {let resolve!: () => void; return {promise: new Promise<void>(done => {resolve = done;}), resolve: () => resolve()};};
for (const name of entries.filter(name => name !== "read" && name !== "list")) test(`${name}: original workspace and lookup fields survive policy wait`, {timeout: 5_000}, async () => {
  const entered = signal(), release = signal(); const used: any[][] = [];
  const access = {async authorize(workspaceId: string) {assert.equal(workspaceId, owner); entered.resolve(); await release.promise;}};
  const effect = (...args: any[]) => {used.push(args); throw Error("finite stop after captured lookup");};
  const input = command(), original = structuredClone(input);
  const pending = make(name, access, effect)(input).catch(() => undefined);
  try {
    await entered.promise;
    input.workspaceId = "workspace.foreign"; input.workflowId = "workflow.changed"; input.implementationDraftId = "implementation.changed"; input.draftId = "draft.changed"; input.expectedRevision = 99; input.actorId = "changed"; input.definitionRef.id = "asset.changed";
    input.text = "changed"; input.status = "published"; input.limit = 99; input.cursor = "changed";
    release.resolve(); await pending; assert.ok(used.length > 0);
    if (name === "start") { /* nextDraftId runs first; full values tested below */ }
    else if (name === "draftCreate") assert.deepEqual(used[0], [{kind: "asset-definition-version", id: original.definitionRef.id, version: original.definitionRef.version}]);
    else if (name === "draftList") assert.deepEqual(used[0], [{workspaceId: owner, status: "draft", unpublishedOnly: true, text: "original", limit: 5, cursor: "cursor.original"}]);
    else assert.deepEqual(used[0], [owner, name === "propose" ? original.implementationDraftId : name === "review" ? original.workflowId : original.draftId]);
  } finally { release.resolve(); await pending; }
});

test("start owns general references, metadata, actor and display name without requiring a version", {timeout: 5_000}, async () => {
  const entered = signal(), release = signal(); const used: any[] = []; const input = command(); input.definitionRef.kind = "asset-definition"; delete input.definitionRef.version;
  const original = structuredClone(input.definitionRef);
  const useCase = new StartAssetStudioUseCase({async execute(value: any) {used.push(value); return {ok: true, value} as any;}} as any, () => "implementation.original" as any, {async authorize() {entered.resolve(); await release.promise;}});
  const pending = useCase.execute(input); await entered.promise;
  input.definitionRef.metadata.nested[0] = "changed"; input.definitionRef.label = "Changed"; input.displayName = "Changed"; input.actorId = "changed"; release.resolve();
  assert.equal((await pending).ok, true); assert.deepEqual(used[0].definitionRef, original); assert.equal(used[0].displayName, "Original"); assert.equal(used[0].actorId, "author.original");
});

test("manual proposal owns nested source, context, allowlists and provenance through repository and artifact waits", {timeout: 5_000}, async () => {
  const reading = signal(), releaseRead = signal(), storing = signal(), releaseStore = signal(); const input = command(); const saved: any[] = [], content: any[] = [];
  const original = structuredClone(input);
  const run = make("propose", {async authorize() {}}, () => {throw Error("unexpected");}, {
    implementations: {async readDraft() {reading.resolve(); await releaseRead.promise; return {definitionRef: original.definitionRef};}}, workflows: {async read() {}, async create(value: any) {saved.push(value); return value;}},
    artifacts: {async putImmutable(value: any) {content.push(JSON.parse(value.content)); storing.resolve(); await releaseStore.promise; return {digest: "sha256:fixture"};}}, digestText: (text: string) => text, now: () => "2026-10-27T00:00:00.000Z",
  });
  const pending = run(input);
  try {
    await reading.promise; input.manualProposal.files[0].content = "changed"; input.manualProposal.plan[0] = "changed"; input.manualProposal.model.modelId = "changed"; input.manualProposal.dependencies[0] = "changed"; input.allowedDependencies.length = 0; input.allowedCapabilities.length = 0; input.context[0].content = "changed"; input.definitionRef.metadata.nested[0] = "changed";
    releaseRead.resolve(); await storing.promise; input.actorId = "changed"; input.intent = "changed"; input.workflowId = "changed"; input.workspaceId = "workspace.foreign"; input.manualProposal.requestedCapabilities.length = 0; releaseStore.resolve();
    const result = await pending; assert.equal(result.ok, true, JSON.stringify(result)); assert.deepEqual(content, [original.manualProposal]); assert.deepEqual(result.value.proposal, original.manualProposal);
    assert.equal(saved[0].createdBy, original.actorId); assert.equal(saved[0].workspaceId, owner); assert.equal(saved[0].workflowId, original.workflowId); assert.equal(saved[0].intentDigest, original.intent); assert.deepEqual(saved[0].definitionRef, original.definitionRef);
  } finally {releaseRead.resolve(); releaseStore.resolve(); await pending;}
});

test("review owns exact approval arrays, actor and revision through artifact and snapshot waits", {timeout: 5_000}, async () => {
  const reading = signal(), releaseRead = signal(), snapshotting = signal(), releaseSnapshot = signal(); const input = command(); const stored: any[] = [], snap: any[] = [];
  const current = {workspaceId: owner, workflowId: input.workflowId, implementationDraftId: input.implementationDraftId, revision: 3, status: "proposed", proposalArtifact: {}};
  const run = make("review", {async authorize() {}}, () => {throw Error("unexpected");}, {
    workflows: {async read() {return current;}, async update(value: any, expected: number) {stored.push({value, expected}); return value;}},
    artifacts: {async readVerified() {reading.resolve(); await releaseRead.promise; return new TextEncoder().encode(JSON.stringify(proposal()));}},
    snapshotSource: {async execute(value: any) {snap.push(value); snapshotting.resolve(); await releaseSnapshot.promise; return {ok: true, value: {snapshotId: "snapshot.original"}};}}, nextSnapshotId: () => "snapshot.original", now: () => "2026-10-27T00:00:00.000Z",
  });
  const pending = run(input);
  try {await reading.promise; input.approvedDependencies[0] = "changed"; input.approvedCapabilities.length = 0; input.expectedRevision = 99; input.decision = "reject"; releaseRead.resolve(); await snapshotting.promise; input.actorId = "changed"; input.workspaceId = "workspace.foreign"; releaseSnapshot.resolve();
    const result = await pending; assert.equal(result.ok, true, JSON.stringify(result)); assert.equal(snap[0].actorId, "author.original"); assert.equal(snap[0].workspaceId, owner); assert.equal(stored[0].expected, 3); assert.equal(stored[0].value.reviewedBy, "author.original"); assert.equal(stored[0].value.status, "snapshotted");
  } finally {releaseRead.resolve(); releaseSnapshot.resolve(); await pending;}
});

test("coding provider input and output cannot mutate the owned request or stored proposal", {timeout: 5_000}, async () => {
  const storing = signal(), release = signal(); const input = command(); input.mode = "coding-model";
  const output = proposal(); const saved: any[] = [], stored: any[] = [];
  const run = make("propose", {async authorize() {}}, () => {throw Error("unexpected");}, {
    implementations: {async readDraft() {return {definitionRef: reference()};}},
    workflows: {async read() {}, async create(value: any) {saved.push(value); return value;}},
    codingModel: {async propose(request: any) {
      assert.equal(request.context[0].content, "Original source");
      request.context[0].content = "provider mutation"; request.allowedDependencies.length = 0; request.allowedCapabilities.length = 0; request.definitionRef.metadata.nested[0] = "provider mutation";
      return output;
    }},
    artifacts: {async putImmutable(value: any) {stored.push(JSON.parse(value.content)); storing.resolve(); await release.promise; return {digest: "sha256:fixture"};}},
    digestText: (value: string) => value, now: () => "2026-10-27T00:00:00.000Z",
  });
  const original = structuredClone(output); const pending = run(input);
  try {await storing.promise; output.files[0].content = "changed"; output.requestedCapabilities.length = 0; output.model.modelId = "changed"; release.resolve();
    const result = await pending; assert.equal(result.ok, true, JSON.stringify(result)); assert.deepEqual(stored, [original]); assert.deepEqual(result.value.proposal, original); assert.deepEqual(saved[0].requestedCapabilities, ["read"]); assert.deepEqual(saved[0].definitionRef.metadata, {nested: ["original"]});
  } finally {release.resolve(); await pending;}
});

test("draft capture owns semantic JSON and resources while preserving a larger policy universe", () => {
  const input = command(); const create = capture.captureStudioDraftCreate(input), update = capture.captureStudioDraftUpdate(input), transition = capture.captureStudioDraftTransition(input);
  input.semanticDefinition.metadata.nested[0] = "changed"; input.resources[0].content = "changed"; input.actorId = "changed"; input.expectedRevision = 99;
  assert.deepEqual(create.semanticDefinition.metadata, {nested: ["original"]}); assert.equal(create.resources[0].content, "export const value = 1;"); assert.equal(update.resources[0].content, "export const value = 1;"); assert.equal(update.actorId, "author.original"); assert.equal(transition.expectedRevision, 3);
  const largePolicy = command(); largePolicy.allowedDependencies = Array.from({length: 64}, (_, i) => `dependency.${i}`); assert.equal(capture.captureStudioPropose(largePolicy).allowedDependencies.length, 64);
});

for (const action of ["create", "update"] as const) test(`draft ${action} persists original nested input and revision after repository waits`, {timeout: 5_000}, async () => {
  const entered = signal(), release = signal(); const saved: any[] = [], artifacts: any[] = [], implementationDrafts: any[] = [];
  let current: any, pause = false;
  const at = "2026-10-27T00:00:00.000Z";
  const workflow = new AssetStudioAssetDraftWorkflowUseCase({
    workspaceAccess: {async authorize() {}},
    definitions: {async getDefinition() {if (pause && action === "create") {entered.resolve(); await release.promise;} return undefined;}} as any,
    implementations: {async createDraft(value: any) {implementationDrafts.push(value); return value;}} as any,
    drafts: {
      async create(value: any) {current = value; saved.push({value}); return value;},
      async read(workspaceId: string, draftId: string) {assert.equal(workspaceId, owner); assert.equal(draftId, current.draftId); if (pause && action === "update") {entered.resolve(); await release.promise;} return current;},
      async update(value: any, expected: number) {assert.equal(expected, current.revision); current = value; saved.push({value, expected}); return value;},
    } as any,
    artifacts: {async putImmutable(value: any) {artifacts.push({workspaceId: value.workspaceId, bundle: JSON.parse(value.content)}); return {artifactId: "artifact.fixture", kind: "source", digest: `sha256:${"a".repeat(64)}`, mediaType: value.mediaType, sizeBytes: value.content.length};}} as any,
    nextDraftId: () => "draft.original", now: () => at,
  });
  if (action === "update") {const initial = await workflow.create(command()); assert.equal(initial.ok, true, JSON.stringify(initial));}
  pause = true;
  const input = command(); input.expectedRevision = 1;
  const pending = workflow[action](input);
  try {
    await entered.promise;
    input.workspaceId = "workspace.foreign"; input.actorId = "changed"; input.expectedRevision = 99; input.draftId = "draft.changed"; input.semanticDefinition.metadata.nested[0] = "changed"; input.semanticDefinition.displayName = "Changed"; input.resources[0].content = "changed";
    release.resolve(); const result = await pending; assert.equal(result.ok, true, JSON.stringify(result));
    const record = saved[saved.length - 1].value; assert.equal(record.workspaceId, owner); assert.equal(record.semanticDefinition.displayName, "Original"); assert.deepEqual(record.semanticDefinition.metadata, {nested: ["original"]});
    assert.equal(artifacts[artifacts.length - 1].workspaceId, owner); assert.equal(artifacts[artifacts.length - 1].bundle.files[0].content, "export const value = 1;");
    if (action === "create") {assert.equal(record.createdBy, "author.original"); assert.equal(implementationDrafts[0].createdBy, "author.original");}
    else {assert.equal(saved[saved.length - 1].expected, 1); assert.equal(record.revision, 2);}
  } finally {release.resolve(); await pending;}
});

for (const mutate of [
  (v: any) => {v.context = new Array(25);},
  (v: any) => {v.manualProposal.files = new Array(65);},
  (v: any) => {v.resources = new Array(65);},
  (v: any) => {v.resources[0].path = "other/definition.json";},
  (v: any) => {v.resources[0].path = "../outside.ts";},
  (v: any) => {v.resources[0].content = "x".repeat(200_001);},
  (v: any) => {v.semanticDefinition.metadata = v.semanticDefinition;},
]) test(`malformed or oversized capture denies without protected effects: ${mutate.toString()}`, {timeout: 5_000}, async () => {
  const input = command(); mutate(input); let effects = 0; const effect = () => {effects++; throw Error("protected");};
  const name = input.context.length === 25 || input.manualProposal.files.length === 65 ? "propose" : "draftCreate";
  const result = await make(name, {async authorize() {effects++;}}, effect)(input);
  assert.equal(result.ok, false); assert.equal(effects, 0); assert.ok(!JSON.stringify(result).includes("protected"));
});
