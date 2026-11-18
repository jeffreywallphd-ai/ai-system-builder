import assert from "node:assert/strict";
import {createHash, randomUUID} from "node:crypto";
import test from "node:test";
import {ContextBrowserUseCases} from "../context-browser.use-cases";
import {CONTEXT_RAG_DATABASE_MEDIA_TYPE} from "../../../../contracts/context-management";
import {createOrganizationId} from "../../../../contracts/organization";
import {createWorkspaceId} from "../../../../contracts/workspace";
import type {ApprovedContextQueryAdmission, ApprovedContextQueryOwnerAdmission} from "../../../ports/context-management";

const hash = (value: string | Uint8Array) => "sha256:" + createHash("sha256").update(value).digest("hex");
const flush = () => new Promise<void>(resolve => setImmediate(resolve));
function deferred<T>() {let resolve!: (value: T) => void; const promise = new Promise<T>(done => {resolve = done;}); return {promise, resolve};}

function fixture() {
  const context = {organizationId: createOrganizationId("org.synthetic"), principalId: "principal.synthetic", workspaceId: createWorkspaceId("workspace.synthetic")};
  const artifactId = "workspaces/workspace.synthetic/artifacts/context/synthetic", content = new TextEncoder().encode("Synthetic archive fixture");
  const source = {artifactId: "data/synthetic-source", digest: "sha256:" + "a".repeat(64)};
  const command = {artifactId, query: "Synthetic private question", maximumResults: 3, embeddingDevice: "cpu" as const};
  const model = {modelRecordId: "model.synthetic", modelUpdatedAt: "2026-11-18T00:00:00.000Z", modelId: "synthetic/embedding", recordDigest: "sha256:" + "b".repeat(64)};
  const finish = deferred<void>();
  const calls = {model: 0, catalog: 0, binding: 0, bytes: 0, admitted: 0, ordinary: 0, issue: 0, accept: 0};
  const state = {allowed: true, accepting: true, autoRetire: true, issueResult: "issued" as "issued" | "denied" | "unconfirmed",
    policy: async () => true, resolveModel: async () => ({localModelReference: "C:/synthetic/approved-model"}),
    accept: async () => true,
    result: {kind: "succeeded", cleanupPending: false, matches: [{id: "private/worker-id", excerpt: "Private source excerpt",
      score: 0.9, citation: {...source, sourceArtifactId: source.artifactId, sourceDigest: source.digest, chunkIndex: 0,
        rowIndex: 2, normalizedStart: 0, normalizedEnd: 12, pageNumber: 1, field: "private_field", regionKind: "paragraph"}}]} as any};
  // Only the canonical citation keys are returned by the runtime fixture.
  delete state.result.matches[0].citation.artifactId; delete state.result.matches[0].citation.digest;
  const saved = {workspaceId: context.workspaceId, storageKey: artifactId, artifactFamily: "binary", sourceKind: "generated",
    mediaType: CONTEXT_RAG_DATABASE_MEDIA_TYPE, sizeBytes: content.byteLength, checksum: {algorithm: "sha256", value: hash(content).slice(7)}};
  const binding = {workspaceId: context.workspaceId, artifactId, role: "primary", backing: {kind: "artifact-object", provider: "local-filesystem", locator: artifactId}};
  const admissions: ApprovedContextQueryAdmission[] = [], inputs: any[] = [];
  const deps: any = {
    isAcceptingQueries: () => state.accepting,
    embeddingModels: {async resolveExistingModel(witness: unknown, actor: unknown) {
      calls.model++; assert.deepEqual(witness, model); assert.deepEqual(actor, context); return state.resolveModel();
    }},
    catalog: {async readArtifactCatalogRecord(request: any, actor: unknown) {
      calls.catalog++; assert.deepEqual(actor, context); assert.equal(request.storageKey, artifactId); return {ok: true, value: {record: saved}};
    }},
    storageBindings: {async readArtifactStorageBindings(request: any) {
      calls.binding++; assert.equal(request.artifactId, artifactId); return {ok: true, value: {bindings: [binding]}};
    }},
    storage: {async retrieveArtifact(request: any) {
      calls.bytes++; assert.equal(request.key, artifactId); return {ok: true, value: {content,
        descriptor: {key: artifactId, mediaType: CONTEXT_RAG_DATABASE_MEDIA_TYPE, sizeBytes: content.byteLength}}};
    }},
    runtime: {
      async query() {calls.ordinary++; throw new Error("Ordinary query must not be used.");},
      async inspectArtifact() {throw new Error("Ordinary inspection must not be used.");},
      async queryAdmitted(input: any, admission: ApprovedContextQueryAdmission) {
        calls.admitted++; inputs.push(input); admissions.push(admission);
        const issued = await admission.issue();
        if (issued !== "issued") return issued === "denied" ? {kind: "not-started"} : {kind: "unconfirmed", cleanupPending: true};
        if (!await admission.accept(admission.taskId)) return {kind: "unconfirmed", cleanupPending: true};
        await finish.promise;
        if (state.autoRetire) admission.cleanupRetired?.(admission.taskId);
        return state.result;
      },
    },
    generation: {async start() {throw new Error("Query cannot start generation.");}},
    deleteArtifact: {async execute() {throw new Error("Query cannot delete.");}},
  };
  const app = new ContextBrowserUseCases(deps);
  const admission = (): ApprovedContextQueryOwnerAdmission => ({taskId: randomUUID(), ...context, artifactId, artifactDigest: hash(content),
    artifactSizeBytes: content.byteLength, queryDigest: hash(command.query), maximumResults: command.maximumResults, embeddingDevice: command.embeddingDevice,
    embeddingModel: {...model}, sources: [{...source}], isCurrent: () => state.allowed, stillAllowed: () => state.policy(),
    issue: async () => {calls.issue++; return state.issueResult;}, accept: async () => {calls.accept++; return state.accept();}});
  return {app, deps, context, command, admission, state, calls, content, saved, binding, source, model, admissions, inputs, finish};
}

test("approved query accepts asynchronously and exposes only source-checked numeric citation summaries", async () => {
  const f = fixture(), proof = f.admission();
  assert.deepEqual(await f.app.startAdmittedContextQuery(f.command, f.context, proof), {kind: "accepted", taskId: proof.taskId});
  const running = await f.app.readAdmittedContextQueryTask(proof.taskId, f.context);
  assert.equal(running?.state, "running"); assert.equal(running?.cleanupPending, true);
  f.finish.resolve(); await flush();
  const result = await f.app.readAdmittedContextQueryTask(proof.taskId, f.context);
  assert.deepEqual(result, {taskId: proof.taskId, state: "succeeded", cleanupPending: false,
    matches: [{rank: 1, score: 0.9, sourceOrdinal: 1, chunkIndex: 0, rowIndex: 2, normalizedStart: 0, normalizedEnd: 12, pageNumber: 1}]});
  assert.doesNotMatch(JSON.stringify(result), /Private|private|question|sourceArtifactId|sourceDigest|excerpt|field|regionKind|localModelReference/);
  assert.ok(Object.isFrozen(result)); assert.ok(Object.isFrozen(result!.matches)); assert.ok(Object.isFrozen(result!.matches[0]));
  assert.deepEqual(f.calls, {model: 1, catalog: 1, binding: 1, bytes: 1, admitted: 1, ordinary: 0, issue: 1, accept: 1});
});

test("strict admission denies extra/accessor/proxy, foreign scope, wrong hash/model/source and text before model or bytes", async () => {
  let getterReads = 0;
  for (const change of ["foreign", "extra", "query", "hash", "device", "limit", "source", "model", "getter", "proxy", "source-proxy"]) {
    const f = fixture(); let command: any = {...f.command}, proof: any = f.admission();
    if (change === "foreign") proof.workspaceId = "workspace.other";
    if (change === "extra") proof.untrusted = "ignored?";
    if (change === "query") command.query = "\ud800";
    if (change === "hash") proof.queryDigest = "sha256:" + "f".repeat(64);
    if (change === "device") command.embeddingDevice = "auto";
    if (change === "limit") command.maximumResults = 21;
    if (change === "source") proof.sources = [proof.sources[0], proof.sources[0]];
    if (change === "model") proof.embeddingModel.localModelReference = "C:/untrusted";
    if (change === "getter") Object.defineProperty(command, "query", {enumerable: true, get() {getterReads++; return f.command.query;}});
    if (change === "proxy") command = new Proxy(command, {getPrototypeOf() {getterReads++; return Object.prototype;}});
    if (change === "source-proxy") proof.sources[0] = new Proxy(proof.sources[0], {getPrototypeOf() {getterReads++; return Object.prototype;}});
    assert.deepEqual(await f.app.startAdmittedContextQuery(command, f.context, proof), {kind: "unavailable"}, change);
    assert.equal(f.calls.model + f.calls.bytes + f.calls.admitted, 0, change);
  }
  assert.equal(getterReads, 0);
});

test("missing installed/private/model/shutdown capability and pending limit refuse before model or byte work", async () => {
  for (const missing of ["runtime", "model", "fence", "closed"]) {
    const f = fixture();
    if (missing === "runtime") delete f.deps.runtime.queryAdmitted;
    if (missing === "model") delete f.deps.embeddingModels;
    if (missing === "fence") delete f.deps.isAcceptingQueries;
    if (missing === "closed") f.state.accepting = false;
    assert.deepEqual(await f.app.startAdmittedContextQuery(f.command, f.context, f.admission()), {kind: "not-started"});
    assert.equal(f.calls.model + f.calls.bytes, 0);
  }
  const f = fixture(), held = deferred<{localModelReference: string}>();
  f.state.resolveModel = () => held.promise;
  const pending = Array.from({length: 4}, () => f.app.startAdmittedContextQuery(f.command, f.context, f.admission()));
  assert.deepEqual(await f.app.startAdmittedContextQuery(f.command, f.context, f.admission()), {kind: "not-started"});
  await flush(); assert.equal(f.calls.model, 4); assert.equal(f.calls.bytes, 0);
  f.state.allowed = false; held.resolve({localModelReference: "C:/synthetic/approved-model"});
  assert.ok((await Promise.all(pending)).every(value => value.kind === "not-started"));
  assert.equal(f.calls.bytes, 0);
});

test("copies command, actor/model/source proof before held policy and exact bytes before later policy", async () => {
  const f = fixture(), proof: any = f.admission(), context = {...f.context}, command: any = {...f.command};
  const gate = deferred<void>(); let first = true;
  f.state.policy = async () => {if (first) {first = false; await gate.promise;} return true;};
  const started = f.app.startAdmittedContextQuery(command, context, proof);
  command.query = "changed"; command.maximumResults = 20; context.principalId = "other";
  proof.embeddingModel.modelId = "changed/model"; proof.sources[0].digest = "sha256:" + "f".repeat(64);
  gate.resolve(); assert.equal((await started).kind, "accepted");
  assert.equal(f.inputs[0].query, f.command.query); assert.equal(f.inputs[0].maximumResults, 3);
  f.finish.resolve(); await flush(); assert.equal((await f.app.readAdmittedContextQueryTask(proof.taskId, f.context))?.state, "succeeded");
  const bytes = fixture(), bytesProof = bytes.admission(); let changed = false;
  bytes.state.policy = async () => {if (bytes.calls.bytes && !changed) {changed = true; bytes.content.fill(0);} return true;};
  assert.equal((await bytes.app.startAdmittedContextQuery(bytes.command, bytes.context, bytesProof)).kind, "accepted");
  assert.equal(hash(bytes.inputs[0].content), bytesProof.artifactDigest);
  bytes.finish.resolve(); await flush();
});

test("admitted reads require exact generated catalog checksum and primary local binding without fallback", async () => {
  for (const change of ["catalog-workspace", "checksum", "size", "kind", "binding-workspace", "binding-id", "replica", "provider", "locator", "changed-bytes", "duplicate-primary", "descriptor-mime"]) {
    const f = fixture(), proof = f.admission();
    if (change === "catalog-workspace") f.saved.workspaceId = createWorkspaceId("workspace.other");
    if (change === "checksum") delete (f.saved as any).checksum;
    if (change === "size") f.saved.sizeBytes++;
    if (change === "kind") f.saved.mediaType = "application/zip" as never;
    if (change === "binding-workspace") f.binding.workspaceId = createWorkspaceId("workspace.other");
    if (change === "binding-id") f.binding.artifactId = "other";
    if (change === "replica") f.binding.role = "replica";
    if (change === "provider") f.binding.backing.provider = "remote";
    if (change === "locator") f.binding.backing.locator = "other";
    if (change === "changed-bytes") f.content.fill(0);
    if (change === "duplicate-primary") f.deps.storageBindings.readArtifactStorageBindings = async () => ({ok: true, value: {bindings: [f.binding, {...f.binding}]}});
    if (change === "descriptor-mime") {
      const retrieve = f.deps.storage.retrieveArtifact;
      f.deps.storage.retrieveArtifact = async (...args: unknown[]) => {
        const value = await retrieve(...args); value.value.descriptor.mediaType = "application/zip"; return value;
      };
    }
    assert.deepEqual(await f.app.startAdmittedContextQuery(f.command, f.context, proof), {kind: "not-started"}, change);
    assert.equal(f.calls.admitted + f.calls.ordinary, 0, change);
  }
});

test("late model/source/policy or shutdown retirement prevents dispatch and unaccepted IDs cannot be observed", async () => {
  for (const stage of ["model", "bytes", "shutdown"]) {
    const f = fixture(), proof = f.admission();
    f.state.policy = async () => {
      if (stage === "model" && f.calls.model) f.state.allowed = false;
      if (stage === "bytes" && f.calls.bytes) f.state.allowed = false;
      if (stage === "shutdown" && f.calls.model) f.state.accepting = false;
      return true;
    };
    assert.equal((await f.app.startAdmittedContextQuery(f.command, f.context, proof)).kind, "not-started");
    assert.equal(f.calls.admitted, 0); assert.equal(await f.app.readAdmittedContextQueryTask(proof.taskId, f.context), undefined);
  }
  const f = fixture(); assert.equal(await f.app.readAdmittedContextQueryTask(randomUUID(), f.context), undefined);
});

test("query result citations must match the frozen sources; malformed/private output never becomes a summary", async () => {
  let coercions = 0;
  for (const change of ["source", "digest", "chunk", "row", "span", "score", "extra", "duplicate", "field-object", "accessor"]) {
    const f = fixture(), proof = f.admission(), match = f.state.result.matches[0];
    if (change === "source") match.citation.sourceArtifactId = "data/foreign";
    if (change === "digest") match.citation.sourceDigest = "sha256:" + "f".repeat(64);
    if (change === "chunk") match.citation.chunkIndex = 1000;
    if (change === "row") match.citation.rowIndex = -1;
    if (change === "span") delete match.citation.normalizedEnd;
    if (change === "score") match.score = Infinity;
    if (change === "extra") match.privateExtra = "sensitive";
    if (change === "duplicate") f.state.result.matches.push({...match});
    if (change === "field-object") match.citation.field = {toString() {coercions++; return "field";}};
    if (change === "accessor") Object.defineProperty(match.citation, "field", {enumerable: true, get() {coercions++; return "field";}});
    assert.equal((await f.app.startAdmittedContextQuery(f.command, f.context, proof)).kind, "accepted");
    f.finish.resolve(); await flush();
    const result = await f.app.readAdmittedContextQueryTask(proof.taskId, f.context);
    assert.equal(result?.state, "failed", change); assert.deepEqual(result?.matches, [], change);
  }
  assert.equal(coercions, 0);
});

test("business completion does not free cleanup-held capacity; exact late cleanup proof does", async () => {
  const f = fixture(); f.state.autoRetire = false; f.state.result.cleanupPending = true;
  const proofs = Array.from({length: 4}, () => f.admission());
  for (const proof of proofs) assert.equal((await f.app.startAdmittedContextQuery(f.command, f.context, proof)).kind, "accepted");
  f.finish.resolve(); await flush();
  for (const proof of proofs) assert.equal((await f.app.readAdmittedContextQueryTask(proof.taskId, f.context))?.cleanupPending, true);
  assert.equal((await f.app.startAdmittedContextQuery(f.command, f.context, f.admission())).kind, "not-started");
  f.admissions[0].cleanupRetired?.(randomUUID());
  assert.equal((await f.app.startAdmittedContextQuery(f.command, f.context, f.admission())).kind, "not-started");
  f.admissions[0].cleanupRetired?.(proofs[0].taskId);
  const result = await f.app.readAdmittedContextQueryTask(proofs[0].taskId, f.context);
  assert.equal(result?.state, "succeeded"); assert.equal(result?.cleanupPending, false);
  assert.equal((await f.app.startAdmittedContextQuery(f.command, f.context, f.admission())).kind, "accepted");
  assert.equal((await f.app.startAdmittedContextQuery(f.command, f.context, proofs[0])).kind, "unavailable");
});

test("a retirement callback alone cannot free a still-running promise slot", async () => {
  const f = fixture();
  for (let i = 0; i < 4; i++) assert.equal((await f.app.startAdmittedContextQuery(f.command, f.context, f.admission())).kind, "accepted");
  for (const proof of f.admissions) proof.cleanupRetired?.(proof.taskId);
  assert.equal((await f.app.startAdmittedContextQuery(f.command, f.context, f.admission())).kind, "not-started");
  f.finish.resolve(); await flush();
});

test("unknown issue/ACK/accept and invented success never grant accepted task discovery or ordinary retry", async () => {
  for (const mode of ["unknown-issue", "accept-false", "port-throw", "invented-success", "wrong-ack"]) {
    const f = fixture(), proof = f.admission();
    if (mode === "unknown-issue") f.state.issueResult = "unconfirmed";
    if (mode === "accept-false") f.state.accept = async () => false;
    if (mode === "port-throw") f.deps.runtime.queryAdmitted = async () => {throw new Error("Private error must stay private.");};
    if (mode === "invented-success") f.deps.runtime.queryAdmitted = async () => f.state.result;
    if (mode === "wrong-ack") f.deps.runtime.queryAdmitted = async (_input: unknown, cap: ApprovedContextQueryAdmission) => {
      await cap.issue(); assert.equal(await cap.accept(randomUUID()), false); return {kind: "unconfirmed", cleanupPending: true};
    };
    assert.deepEqual(await f.app.startAdmittedContextQuery(f.command, f.context, proof), {kind: "unconfirmed"}, mode);
    assert.equal(await f.app.readAdmittedContextQueryTask(proof.taskId, f.context), undefined, mode);
    assert.equal((await f.app.startAdmittedContextQuery(f.command, f.context, proof)).kind, "unavailable", mode);
    assert.equal(f.calls.ordinary, 0);
  }
});

test("durable exact acceptance survives outward revocation while all task details remain withheld", async () => {
  const f = fixture(), proof = f.admission();
  f.state.accept = async () => {f.state.allowed = false; return true;};
  assert.deepEqual(await f.app.startAdmittedContextQuery(f.command, f.context, proof), {kind: "unconfirmed"});
  assert.equal(f.calls.accept, 1); assert.equal(await f.app.readAdmittedContextQueryTask(proof.taskId, f.context), undefined);
  f.finish.resolve(); await flush(); f.state.allowed = true;
  const result = await f.app.readAdmittedContextQueryTask(proof.taskId, f.context);
  assert.equal(result?.state, "failed"); assert.deepEqual(result?.matches, []);
  assert.equal(await f.app.readAdmittedContextQueryTask(proof.taskId, {...f.context, principalId: "another"}), undefined);
  assert.equal(await f.app.readAdmittedContextQueryTask(proof.taskId, {...f.context, workspaceId: "workspace.other"}), undefined);
});

test("retirement in the helper-Promise handoff cannot cross model, byte, issue or acceptance edges", async () => {
  for (const edge of ["model", "bytes", "issue", "accept"]) {
    const f = fixture(), proof = f.admission(); let retired = false;
    f.state.policy = async () => {
      const atEdge = edge === "model" && f.calls.model === 0 || edge === "bytes" && f.calls.binding > 0 && f.calls.bytes === 0 ||
        edge === "issue" && f.calls.admitted > 0 && f.calls.issue === 0 || edge === "accept" && f.calls.accept > 0;
      if (atEdge && !retired) {retired = true; queueMicrotask(() => queueMicrotask(() => {f.state.allowed = false;}));}
      return true;
    };
    const result = await f.app.startAdmittedContextQuery(f.command, f.context, proof);
    assert.equal(result.kind, edge === "accept" ? "unconfirmed" : "not-started", edge);
    if (edge === "model") assert.equal(f.calls.model, 0);
    if (edge === "bytes") assert.equal(f.calls.bytes, 0);
    if (edge === "issue") assert.equal(f.calls.issue, 0);
    if (edge === "accept") assert.equal(f.calls.accept, 1);
    assert.equal(await f.app.readAdmittedContextQueryTask(proof.taskId, f.context), undefined);
    f.finish.resolve(); await flush();
  }
});

test("task history is bounded without evicting or reusing previously consumed IDs", async () => {
  const f = fixture(); f.state.allowed = false;
  const first = f.admission();
  assert.equal((await f.app.startAdmittedContextQuery(f.command, f.context, first)).kind, "not-started");
  for (let i = 1; i < 256; i++) assert.equal((await f.app.startAdmittedContextQuery(f.command, f.context, f.admission())).kind, "not-started");
  f.state.allowed = true;
  assert.equal((await f.app.startAdmittedContextQuery(f.command, f.context, f.admission())).kind, "not-started");
  assert.equal((await f.app.startAdmittedContextQuery(f.command, f.context, first)).kind, "unavailable");
  assert.equal(f.calls.model + f.calls.bytes + f.calls.admitted, 0);
});
