import assert from "node:assert/strict";
import { test } from "node:test";
import {
  UI_CONTROL_VERSION, readUiControlAttempt, readUiControlLeaseTarget, readUiControlRequest, readUiControlRevoke,
} from "..";

const id = (index: number) => `e38b2781-e605-4de3-83e1-${String(index).padStart(12, "0")}`;
const window = { hostIncarnationId: id(1), windowId: id(2), uiIncarnationId: id(3), workspaceId: "safe-workspace" };
const attempt = { ...window, requestId: id(4), attemptId: id(5) };
const lease = { ...attempt, leaseId: id(6), generation: 1 };

test("the wire shape separates agent request, interactive attempt, and live lease", () => {
  assert.deepEqual(readUiControlRequest({ version: UI_CONTROL_VERSION, target: window, taskId: id(7), requestKey: id(8) }),
    { version: UI_CONTROL_VERSION, target: window, taskId: id(7), requestKey: id(8) });
  assert.deepEqual(readUiControlAttempt(attempt), attempt);
  assert.deepEqual(readUiControlLeaseTarget(lease), lease);
  assert.deepEqual(readUiControlRevoke(lease), lease);
  assert.deepEqual(readUiControlRevoke(attempt), attempt);
  assert.equal(readUiControlAttempt(lease), undefined);
  assert.equal(readUiControlLeaseTarget(attempt), undefined);
  assert.equal(readUiControlRevoke({ ...attempt, leaseId: id(6) }), undefined);
  assert.equal(readUiControlRevoke({ ...attempt, generation: 1 }), undefined);
});

test("rejects supplied identities, executable or partial targets and accessor values", () => {
  const request = { version: UI_CONTROL_VERSION, target: window, taskId: id(7), requestKey: id(8) };
  assert.equal(readUiControlRequest({ ...request, principalId: "other" }), undefined);
  assert.equal(readUiControlRequest({ ...request, target: { ...window, windowId: "path/selector" } }), undefined);
  assert.equal(readUiControlRequest({ ...request, target: { ...window, workspaceId: "../other" } }), undefined);
  assert.equal(readUiControlRequest({ ...request, taskId: "run any command" }), undefined);
  assert.equal(readUiControlRequest({ ...request, version: "future" }), undefined);
  assert.equal(readUiControlLeaseTarget({ ...lease, generation: Number.MAX_SAFE_INTEGER + 1 }), undefined);
  const trap = { ...lease, get uiIncarnationId(): string { throw new Error("Getter must remain inert."); } };
  assert.equal(readUiControlLeaseTarget(trap), undefined);
});
