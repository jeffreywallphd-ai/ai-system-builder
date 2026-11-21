import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import test from "node:test";
import {createWorkspaceId} from "../../workspace";
import {readHeadlessPlanStepResult, type HeadlessPlanStepTarget} from "../headless-plan-step-wire";
import type {HeadlessHostIncarnationId} from "../headless-protocol";

const exact: HeadlessPlanStepTarget = {hostIncarnationId: randomUUID() as HeadlessHostIncarnationId,
  workspaceId: createWorkspaceId("workspace.model-result"), fingerprint: "a".repeat(64), approvalRevision: 2, step: 1};
const caps = {allowLocalFileSave: false, allowModelDownload: true};
const result = () => ({ok: true, value: {kind: "started", operation: "models.download", fingerprint: exact.fingerprint,
  approvalRevision: 2, step: 1, expiresAt: 10000, reference: {workspaceId: exact.workspaceId, taskId: randomUUID()}}});

test("finite Model start/replay results need explicit support and exact source plan identity", () => {
  for (const kind of ["started", "replayed"]) {
    const value = result(); value.value.kind = kind;
    assert.deepEqual(readHeadlessPlanStepResult(value, exact, caps), value);
    assert.equal(readHeadlessPlanStepResult(value, exact).ok, false);
    assert.equal(readHeadlessPlanStepResult(value, exact, {...caps, allowModelDownload: false}).ok, false);
    for (const patch of [{step: 2}, {approvalRevision: 3}, {fingerprint: "b".repeat(64)}, {kind: "committed"},
      {localPath: "private/cache"}, {operation: "models.save"}, {expiresAt: 0}])
      assert.equal(readHeadlessPlanStepResult({...value, value: {...value.value, ...patch}}, exact, caps).ok, false);
    for (const patch of [{taskId: "foreign"}, {workspaceId: createWorkspaceId("foreign.workspace")}, {localPath: "private/cache"}])
      assert.equal(readHeadlessPlanStepResult({...value, value: {...value.value, reference: {...value.value.reference, ...patch}}}, exact, caps).ok, false);
  }
});

test("known Model non-start is finite capability-bound metadata and rejects extra private facts", () => {
  assert.deepEqual(readHeadlessPlanStepResult({ok: false, code: "headless.not-started"}, exact, caps), {ok: false, code: "headless.not-started"});
  assert.notDeepEqual(readHeadlessPlanStepResult({ok: false, code: "headless.not-started"}, exact), {ok: false, code: "headless.not-started"});
  assert.notDeepEqual(readHeadlessPlanStepResult({ok: false, code: "headless.not-started", error: "private"}, exact, caps), {ok: false, code: "headless.not-started"});
});
