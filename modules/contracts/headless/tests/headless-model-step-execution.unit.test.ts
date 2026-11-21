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

test("saved Model references are separately capability-bound, correlated and path-free", () => {
  const saved = {ok: true, value: {...result().value, kind: "committed", operation: "models.save-download",
    reference: {workspaceId: exact.workspaceId, modelRecordId: "model_headless_" + "b".repeat(32), taskId: randomUUID(),
      manifestDigest: "sha256:" + "c".repeat(64), storageAuthority: "reference-only", runtimeReadiness: "not-checked"}}};
  const options = {allowLocalFileSave: false, allowModelReferenceSave: true};
  assert.deepEqual(readHeadlessPlanStepResult(saved, exact, options), saved);
  assert.equal(readHeadlessPlanStepResult(saved, exact, caps).ok, false);
  for (const patch of [{kind: "started"}, {step: 2}, {approvalRevision: 3}, {fingerprint: "b".repeat(64)}, {expiresAt: 0}])
    assert.equal(readHeadlessPlanStepResult({...saved, value: {...saved.value, ...patch}}, exact, options).ok, false);
  for (const patch of [{localPath: "private/cache"}, {storageAuthority: "owned"}, {runtimeReadiness: "ready"}, {taskId: "shared-history"},
    {workspaceId: createWorkspaceId("foreign.workspace")}, {modelRecordId: "ordinary-model"}])
    assert.equal(readHeadlessPlanStepResult({...saved, value: {...saved.value, reference: {...saved.value.reference, ...patch}}}, exact, options).ok, false);
});

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
