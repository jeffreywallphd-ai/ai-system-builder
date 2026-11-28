import assert from "node:assert/strict";
import test from "node:test";
import {savedModelWindowIntent} from "../visual-composer/managed-headless-model-window";

const at = "2026-11-28T00:00:00.000Z";
test("Model window proof projects only the exact saved record and timestamp", () => {
  const raw = {modelRecordId: "model.saved", updatedAt: at, displayName: "Synthetic model", localPath: "private-ignored"};
  assert.deepEqual(savedModelWindowIntent(raw), {action: "show-model", modelRecordId: "model.saved", modelUpdatedAt: at});
  assert.ok(Object.isFrozen(savedModelWindowIntent(raw)));
  assert.deepEqual(savedModelWindowIntent({modelRecordId: "model.saved", createdAt: at}),
    {action: "show-model", modelRecordId: "model.saved", modelUpdatedAt: at});
});
test("malformed or active Model selectors cannot become display evidence", () => {
  let reads = 0;
  for (const value of [undefined, null, [], {}, {modelRecordId: "../model", updatedAt: at},
    {modelRecordId: "model.saved", updatedAt: "not-a-time"},
    {get modelRecordId() {reads++; return "model.saved";}, updatedAt: at},
    new Proxy({modelRecordId: "model.saved", updatedAt: at}, {get() {reads++; throw new Error("Do not read.");}})])
    assert.throws(() => savedModelWindowIntent(value));
  assert.equal(reads, 0);
});
