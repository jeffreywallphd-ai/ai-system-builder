import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import test from "node:test";
import {HEADLESS_CONTRACT_VERSION, readHeadlessDatasetTaskReviewRequest, readHeadlessDatasetTaskReviewValue} from "../index";

const host = randomUUID(), taskId = randomUUID();
const selection = {kind: "task" as const, taskId};
const input = {hostIncarnationId: host, workspaceId: "workspace.synthetic", selection};
const request = {version: HEADLESS_CONTRACT_VERSION, operation: "data.dataset-task-review", input};
const review = {taskId, reportFingerprint: "a".repeat(64), policyFingerprint: "sha256:" + "b".repeat(64), status: "needs-attention",
  counts: {inputRows: 2, acceptedRows: 1, quarantinedRows: 1}, reasonCounts: {"schema-invalid": 1},
  splits: {trainRows: 1, validationRows: 0, testRows: 0}, approvalAllowed: true, saveAvailable: true};
const value = {taskId, state: "review-required", review};

test("dataset review accepts only the exact finite task or known plan-step selector", () => {
  assert.deepEqual(readHeadlessDatasetTaskReviewRequest(request, host), {ok: true, request});
  const planned = {...request, input: {...input, selection: {kind: "plan-step", fingerprint: "c".repeat(64), step: 1}}};
  assert.deepEqual(readHeadlessDatasetTaskReviewRequest(planned, host), {ok: true, request: planned});
  assert.equal(readHeadlessDatasetTaskReviewRequest({...request, input: {...input, path: "private"}}, host).ok, false);
  assert.equal(readHeadlessDatasetTaskReviewRequest({...request, input: {...input, selection: {...selection, fingerprint: "c".repeat(64)}}}, host).ok, false);
  assert.deepEqual(readHeadlessDatasetTaskReviewRequest(request, randomUUID()), {ok: false, code: "headless.host-changed"});
});

test("review metadata is detached and cannot carry rows, samples, source paths or a different task", () => {
  const decoded = readHeadlessDatasetTaskReviewValue(value, selection);
  assert.deepEqual(decoded, value); assert.notEqual(decoded?.review, review);
  decoded!.review!.counts.acceptedRows = 0; assert.equal(review.counts.acceptedRows, 1);
  for (const changed of [{...value, taskId: randomUUID()}, {...value, review: {...review, taskId: randomUUID()}},
    {...value, rows: []}, {...value, review: {...review, samples: []}}, {...value, review: {...review, outputPath: "private"}},
    {...value, review: {...review, reportFingerprint: "not-a-fingerprint"}}, {...value, review: {...review, policyFingerprint: "private"}}])
    assert.equal(readHeadlessDatasetTaskReviewValue(changed, selection), undefined);
});

test("quality counts, reasons, split totals and approval state remain finite and consistent", () => {
  for (const changed of [{...review, counts: {...review.counts, inputRows: 16 * 1024 * 1024 + 1}},
    {...review, counts: {inputRows: 5000, acceptedRows: 4001, quarantinedRows: 0}},
    {...review, counts: {...review.counts, acceptedRows: 1.5}}, {...review, reasonCounts: {unknown: 1}},
    {...review, reasonCounts: {"schema-invalid": 3}}, {...review, splits: {...review.splits, testRows: 1}},
    {...review, approvalAllowed: false}, {...review, status: "blocked"}])
    assert.equal(readHeadlessDatasetTaskReviewValue({...value, review: changed}, selection), undefined);
  assert.equal(readHeadlessDatasetTaskReviewValue({...value, review: null}, selection), undefined);
  assert.equal(readHeadlessDatasetTaskReviewValue({...value, state: "running"}, selection), undefined);
  assert.deepEqual(readHeadlessDatasetTaskReviewValue({taskId, state: "running", review: null}, selection), {taskId, state: "running", review: null});
  const setAside = {...review, counts: {inputRows: 5000, acceptedRows: 1000, quarantinedRows: 4000},
    reasonCounts: {"source-row-limit": 4000}, splits: {trainRows: 1000, validationRows: 0, testRows: 0},
    status: "blocked", approvalAllowed: false, saveAvailable: false};
  assert.deepEqual(readHeadlessDatasetTaskReviewValue({...value, review: setAside}, selection), {...value, review: setAside});
});

test("review parsers reject active properties without evaluating them", () => {
  let evaluated = false;
  const active = {taskId, state: "review-required", get review() {evaluated = true; throw new Error("Must not run.");}};
  assert.equal(readHeadlessDatasetTaskReviewValue(active, selection), undefined); assert.equal(evaluated, false);
});
