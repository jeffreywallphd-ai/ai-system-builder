import assert from "node:assert/strict";
import {createHash, randomUUID} from "node:crypto";
import test from "node:test";
import {createWorkspaceId} from "../../workspace";
import {HEADLESS_CONTRACT_VERSION as version, type HeadlessHostIncarnationId} from "../headless-protocol";
import {readHeadlessContextQueryPlanRequest, readHeadlessContextQuerySummary} from "../headless-context-query-plan";
import {parseHeadlessBuildPlanProposal, serializeHeadlessMutationInput} from "../headless-system-management";
import {readHeadlessPlanStepRequest, readHeadlessPlanStepResult} from "../headless-plan-step-wire";
import {readHeadlessContextTaskValue} from "../headless-context-task";
import {readDesktopPlanApprovalView} from "../desktop-headless-plan-approval";
import {readManagedBrowserPlanApprovalValue} from "../managed-browser-plan-approval";

function fixture() {
  const host = randomUUID() as HeadlessHostIncarnationId, workspaceId = createWorkspaceId("workspace.query");
  const query = "Synthetic private question café 📄", queryDigest = "sha256:" + createHash("sha256").update(query).digest("hex");
  const reference = {workspaceId, contextId: randomUUID(), taskId: randomUUID(), kind: "rag-database" as const, artifactDigest: "sha256:" + "a".repeat(64)};
  const wire = {version, operation: "context.query" as const, input: {hostIncarnationId: host, workspaceId, idempotencyKey: randomUUID(), reference,
    queryDigest, modelRecordId: "model.synthetic", modelUpdatedAt: "2026-11-18T00:00:00.000Z", maximumResults: 3, embeddingDevice: "cpu" as const}};
  const {hostIncarnationId: _host, workspaceId: _workspace, ...input} = wire.input;
  const proposal = {hostIncarnationId: host, workspaceId, steps: [{operation: "context.query", ...input}]};
  const capabilities = {allowLocalFileSave: true, allowContextQuery: true};
  const target = {hostIncarnationId: host, workspaceId, fingerprint: "f".repeat(64), approvalRevision: 2, step: 1};
  const summary = {queryDigest, maximumResults: 3, embeddingDevice: "cpu" as const,
    sources: [{reference: {kind: "ingestion-file", taskId: "task.synthetic", fileId: "file.synthetic", taskRevision: 1}, digest: "sha256:" + "b".repeat(64)}],
    matches: [{rank: 1, score: 0.9, sourceOrdinal: 1, chunkIndex: 0, rowIndex: 2, normalizedStart: 0, normalizedEnd: 12, pageNumber: 1}], cleanupPending: false};
  return {host, workspaceId, query, queryDigest, wire, proposal, capabilities, target, summary};
}

test("query plans explicitly opt into v10, bind exact metadata and never save the question", () => {
  const f = fixture(), parsed = readHeadlessContextQueryPlanRequest(f.wire, f.host); assert.ok(parsed.ok);
  assert.deepEqual(parsed.request, f.wire); assert.notEqual(parsed.request.input.reference, f.wire.input.reference);
  assert.equal(parseHeadlessBuildPlanProposal(f.proposal, f.host).ok, false);
  assert.equal(parseHeadlessBuildPlanProposal(f.proposal, f.host, {...f.capabilities, allowContextQuery: false}).ok, false);
  const plan = parseHeadlessBuildPlanProposal(f.proposal, f.host, f.capabilities); assert.ok(plan.ok);
  assert.equal(plan.preview.version, "aisb-build-plan-preview-v10");
  const {operation, ...input} = f.proposal.steps[0];
  assert.deepEqual(plan.preview.steps[0], {operation, input, effect: "query-saved-context", externalProviderCalls: 0, modelCalls: "required",
    maximumArtifactBytes: 64 * 1024 * 1024, maximumQueryCharacters: 2000, outputFormat: "citation-summary", writesSavedData: false});
  assert.doesNotMatch(JSON.stringify(plan), /Synthetic private|café|📄/);
});

test("query plan descriptors reject raw questions, foreign context, changed model, extras and invalid bounds", () => {
  const f = fixture();
  for (const patch of [{query: f.query}, {rawText: f.query}, {modelUpdatedAt: "yesterday"}, {maximumResults: 21}, {embeddingDevice: "auto"},
    {queryDigest: "wrong"}, {reference: {...f.wire.input.reference, workspaceId: "workspace.other"}},
    {reference: {...f.wire.input.reference, kind: "markdown-context-pack"}}])
    assert.equal(readHeadlessContextQueryPlanRequest({...f.wire, input: {...f.wire.input, ...patch}}, f.host).ok, false);
  const request = readHeadlessContextQueryPlanRequest(f.wire, f.host); assert.ok(request.ok);
  assert.doesNotMatch(serializeHeadlessMutationInput(request.request), /Synthetic private|café|📄/);
});

test("transient step questions are exact bounded request data, with unchanged targets and query-only receipt authority", () => {
  const f = fixture(), wire = {version, operation: "plan.run-step", input: f.target, transient: {contextQuery: f.query}};
  const parsed = readHeadlessPlanStepRequest(wire, f.host); assert.ok(parsed.ok); assert.deepEqual(parsed.request, wire);
  assert.deepEqual(readHeadlessPlanStepRequest({version, operation: "plan.run-step", input: f.target}, f.host),
    {ok: true, request: {version, operation: "plan.run-step", input: f.target}});
  for (const transient of [{contextQuery: "x".repeat(2001)}, {contextQuery: "\ud800"}, {contextQuery: " x"},
    {contextQuery: "x\u0000"}, {contextQuery: f.query, extra: true}, {}, null])
    assert.equal(readHeadlessPlanStepRequest({...wire, transient}, f.host).ok, false);
  const result = {ok: true, value: {kind: "started", operation: "context.query", reference: {workspaceId: f.workspaceId, taskId: randomUUID()},
    fingerprint: f.target.fingerprint, approvalRevision: f.target.approvalRevision, step: 1, expiresAt: Date.now() + 60000}};
  assert.deepEqual(readHeadlessPlanStepResult(result, f.target, f.capabilities), result);
  assert.equal(readHeadlessPlanStepResult(result, f.target, {allowLocalFileSave: true}).ok, false);
});

test("both approval channels reconstruct exact query permissions and reject hidden or changed limits", () => {
  const f = fixture(), built = parseHeadlessBuildPlanProposal(f.proposal, f.host, f.capabilities); assert.ok(built.ok);
  const selection = {workspaceId: f.workspaceId, fingerprint: "f".repeat(64), registeredClientId: randomUUID()};
  const view = {selection, viewId: randomUUID(), preview: built.preview, state: {fingerprint: selection.fingerprint,
    revision: 1, stepCount: 1, approvedSteps: 0, expiresAt: Date.now() + 60000, status: "pending"}};
  assert.deepEqual(readDesktopPlanApprovalView(view, selection, f.capabilities), view);
  const request = {operation: "open" as const, document: {hostIncarnationId: f.host, workspaceId: f.workspaceId, windowId: randomUUID(), documentId: randomUUID()}, selection};
  assert.deepEqual(readManagedBrowserPlanApprovalValue(request as never, view, f.capabilities), view);
  for (const [field, value] of [["maximumArtifactBytes", 1], ["maximumQueryCharacters", 4000], ["modelCalls", 0],
    ["writesSavedData", true], ["outputFormat", "excerpts"], ["externalProviderCalls", "required"]] as const) {
    const changed = structuredClone(view); Object.assign(changed.preview.steps[0], {[field]: value});
    assert.equal(readDesktopPlanApprovalView(changed, selection, f.capabilities), undefined, field);
  }
  assert.equal(readDesktopPlanApprovalView({...view, preview: {...view.preview, version: "aisb-build-plan-preview-v9"}}, selection, f.capabilities), undefined);
});

test("query status is a separate citation-only family and cannot masquerade as generation review or saved output", () => {
  const f = fixture(), taskId = randomUUID(), task = {taskId, state: "succeeded", review: null, query: f.summary};
  assert.deepEqual(readHeadlessContextQuerySummary(f.summary), f.summary);
  assert.deepEqual(readHeadlessContextTaskValue(task, {kind: "task", taskId}), task);
  for (const change of [{state: "review-required"}, {state: "saved"}, {review: {requiresExplicitSave: true}},
    {query: {...f.summary, rawQuery: f.query}}, {query: {...f.summary, matches: [{...f.summary.matches[0], excerpt: "private"}]}},
    {query: {...f.summary, matches: [{...f.summary.matches[0], sourceOrdinal: 2}]}},
    {query: {...f.summary, matches: [{...f.summary.matches[0], normalizedEnd: 0}]}},
    {query: {...f.summary, matches: [f.summary.matches[0], {...f.summary.matches[0], rank: 2}]}},
    {state: "running"}, {state: "failed"}])
    assert.equal(readHeadlessContextTaskValue({...task, ...change}, {kind: "task", taskId}), undefined);
  assert.ok(readHeadlessContextTaskValue({...task, state: "running", query: {...f.summary, matches: [], cleanupPending: true}}, {kind: "task", taskId}));
});

test("query status preserves distinct structured rows and document locations sharing a per-row chunk index", () => {
  const f = fixture(), taskId = randomUUID(), first = f.summary.matches[0];
  for (const location of [{rowIndex: first.rowIndex + 1}, {pageNumber: first.pageNumber + 1},
    {normalizedStart: 12, normalizedEnd: 24}]) {
    const summary = {...f.summary, matches: [first, {...first, ...location, rank: 2, score: 0.8}]};
    assert.deepEqual(readHeadlessContextQuerySummary(summary), summary);
    const task = {taskId, state: "succeeded", review: null, query: summary};
    assert.deepEqual(readHeadlessContextTaskValue(task, {kind: "task", taskId}), task);
  }
  // Changing ranking or score does not make the same location a new citation.
  for (const location of [{}, {rowIndex: first.rowIndex}, {pageNumber: first.pageNumber}]) {
    assert.equal(readHeadlessContextQuerySummary({...f.summary,
      matches: [first, {...first, ...location, rank: 2, score: 0.7}]}), undefined);
  }
  for (const invalid of [{rowIndex: -1}, {rowIndex: 0.5}, {pageNumber: 0}, {sourceOrdinal: 2},
    {normalizedStart: 12, normalizedEnd: 12}, {excerpt: "private"}, {field: "untrusted"}]) {
    assert.equal(readHeadlessContextQuerySummary({...f.summary,
      matches: [first, {...first, rowIndex: 3, ...invalid, rank: 2}]}), undefined);
  }
});
