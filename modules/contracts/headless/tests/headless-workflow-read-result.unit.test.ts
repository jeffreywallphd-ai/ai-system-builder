import assert from "node:assert/strict";
import test from "node:test";
import {HEADLESS_CONTRACT_VERSION, parseHeadlessReadRequest, readHeadlessWorkflowReadResult,
  type HeadlessHostIncarnationId} from "..";
import {createWorkspaceId} from "../../workspace";

const host = "7603d780-e2c6-4f5b-b121-582abeb14b97" as HeadlessHostIncarnationId;
const workspaceId = createWorkspaceId("workflow-result-workspace");
export const syntheticWorkflowProfile = {profileId: "builtin.workflow.conversation@1.0.0",
  source: {kind: "reviewed-execution-plan" as const, sourceId: "plan.one", sourceRevision: "revision.one"},
  title: "Controlled conversation", availability: "available", blockers: []};
const unavailable = {ok: false, code: "headless.unavailable"};
function request(operation: "workflows.list" | "workflows.prepare" | "conversation-tasks.read") {
  const parsed = parseHeadlessReadRequest({version: HEADLESS_CONTRACT_VERSION, operation, input: {hostIncarnationId: host, workspaceId,
    ...(operation === "workflows.list" ? {sourceKind: "reviewed-execution-plan"} : operation === "workflows.prepare"
      ? {profileId: syntheticWorkflowProfile.profileId, source: syntheticWorkflowProfile.source} : {sessionId: "session.one", turnId: "turn.one"})}}, host);
  assert.ok(parsed.ok); if (!parsed.ok) throw new Error("Invalid test request."); return parsed.request;
}
function prepared() {return {ok: true, operation: "workflows.prepare", value: {profile: structuredClone(syntheticWorkflowProfile),
  snapshotRevision: "snapshot.one", actions: [{actionId: "refresh", intent: "read", enabled: true, requiresConfirmation: false, fields: []}]}};}
test("workflow result projection preserves finite metadata and exact source correlation", () => {
  const input = prepared(), output = readHeadlessWorkflowReadResult(input, request("workflows.prepare"));
  assert.deepEqual(output, input);
  input.value.profile.title = "Changed after projection";
  assert.equal(output.ok && output.operation === "workflows.prepare" && output.value.profile.title, "Controlled conversation");
  assert.deepEqual(readHeadlessWorkflowReadResult({ok: true, operation: "workflows.list", value: [syntheticWorkflowProfile]}, request("workflows.list")),
    {ok: true, operation: "workflows.list", value: [syntheticWorkflowProfile]});
});
test("mismatched operation, profile and source cannot pass the exact request", () => {
  for (const change of [(raw: ReturnType<typeof prepared>) => {raw.operation = "workflows.list";},
    (raw: ReturnType<typeof prepared>) => {raw.value.profile.source.sourceId = "plan.other";},
    (raw: ReturnType<typeof prepared>) => {raw.value.profile.source.sourceRevision = "revision.other";},
    (raw: ReturnType<typeof prepared>) => {raw.value.profile.profileId = "unrecognized.profile";}]) {
    const raw = prepared(); change(raw); assert.deepEqual(readHeadlessWorkflowReadResult(raw, request("workflows.prepare")), unavailable);
  }
});
test("separate approved-session handles need the trusted grant and exact conversation profile", () => {
  const raw = {...prepared(), value: {...prepared().value, approvedSessionIds: ["session.one"]}};
  assert.deepEqual(readHeadlessWorkflowReadResult(raw, request("workflows.prepare")), unavailable);
  assert.deepEqual(readHeadlessWorkflowReadResult(raw, request("workflows.prepare"), {allowApprovedSessionIds: true}), raw);
  raw.value.approvedSessionIds.push("session.one");
  assert.deepEqual(readHeadlessWorkflowReadResult(raw, request("workflows.prepare"), {allowApprovedSessionIds: true}), unavailable);
});
test("private, unknown, accessor and oversized metadata is denied without copying it", () => {
  const raw = prepared(); let getterCalls = 0;
  const active = {...raw}; Object.defineProperty(active, "value", {get() {getterCalls++; return raw.value;}, enumerable: true});
  for (const value of [{...raw, privatePrompt: "private"}, {...raw, value: {...raw.value, transcript: "private"}}, active,
    {...raw, value: {...raw.value, actions: [{...raw.value.actions[0], fields: [{fieldId: "secret", kind: "secret-reference", required: true}]}]}}])
    assert.deepEqual(readHeadlessWorkflowReadResult(value, request("workflows.prepare")), unavailable);
  assert.equal(getterCalls, 0);
  assert.deepEqual(readHeadlessWorkflowReadResult({ok: true, operation: "workflows.list", value: Array(65).fill(syntheticWorkflowProfile)}, request("workflows.list")), unavailable);
});
test("fields retain bounded nonsecret primitive descriptions and reject invalid numeric metadata", () => {
  const raw = {...prepared(), value: {...prepared().value, actions: [{...prepared().value.actions[0], fields: [
    {fieldId: "row-count", kind: "integer", required: false, minimum: 1, maximum: 20},
  ]}]}};
  assert.deepEqual(readHeadlessWorkflowReadResult(raw, request("workflows.prepare")), raw);
  raw.value.actions[0].fields[0].maximum = Infinity;
  assert.deepEqual(readHeadlessWorkflowReadResult(raw, request("workflows.prepare")), unavailable);
});
test("saved conversation status must match both target IDs and known states", () => {
  const raw = {ok: true, operation: "conversation-tasks.read", value: {sessionId: "session.one", turnId: "turn.one",
    turnStatus: "succeeded", run: {runId: "run.one", status: "succeeded"}}};
  assert.deepEqual(readHeadlessWorkflowReadResult(raw, request("conversation-tasks.read")), raw);
  for (const value of [{...raw.value, turnId: "turn.other"}, {...raw.value, sessionId: "session.other"},
    {...raw.value, turnStatus: "unknown"}, {...raw.value, run: {...raw.value.run, status: "unknown"}},
    {...raw.value, responseText: "private"}])
    assert.deepEqual(readHeadlessWorkflowReadResult({...raw, value}, request("conversation-tasks.read")), unavailable);
});
