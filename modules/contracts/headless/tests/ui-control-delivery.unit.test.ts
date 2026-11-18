import assert from "node:assert/strict";
import { test } from "node:test";
import { readUiPresentationIntent, readUiPresentationDelivery, readUiPresentationContext, viewForUiPresentationIntent } from "..";

test("admits only exact saved resource identifiers to the fixed presentation family", () => {
  assert.deepEqual(readUiPresentationIntent({ action: "show-run", runId: "run.1" }), { action: "show-run", runId: "run.1" });
  assert.deepEqual(readUiPresentationIntent({ action: "open-system", systemId: "system.1", revisionId: "revision.1" }),
    { action: "open-system", systemId: "system.1", revisionId: "revision.1" });
  assert.equal(readUiPresentationIntent({ action: "show-run", runId: "x", artifactId: "y" }), undefined);
  assert.equal(readUiPresentationIntent({ action: "show-run", runId: "a".repeat(161) }), undefined);
  assert.equal(readUiPresentationIntent({ action: "show-artifact", artifactId: "https://example.com" }), undefined);
  assert.equal(readUiPresentationIntent({ action: "show-artifact", artifactId: '"../fixture"' }), undefined);
  assert.deepEqual(readUiPresentationIntent({ action: "show-artifact", artifactId: "uploads/fixture.png" }),
    { action: "show-artifact", artifactId: "uploads/fixture.png" });
  assert.equal(readUiPresentationIntent({ action: "show-artifact", artifactId: "uploads/../fixture.png" }), undefined);
  assert.equal(readUiPresentationIntent({ action: "select-component", systemId: "system.1", revisionId: "r1" }), undefined);
  assert.equal(readUiPresentationIntent({ action: "show-validation", systemId: "system.1", revisionId: "r1", path: "external" }), undefined);
  assert.equal(readUiPresentationIntent({ action: "run-system", systemId: "system.1" }), undefined);
  assert.equal(readUiPresentationIntent(Object.create({ action: "show-run", runId: "run.1" })), undefined);
  assert.equal(readUiPresentationIntent({ action: "show-run", get runId() { throw new Error("no access"); } }), undefined);
  assert.equal(readUiPresentationDelivery({ remainingMs: 100, sequence: 1, commandId: "x" }), undefined);
});

test("Data presentation carries only exact opaque source, immutable version or accepted-task identifiers", () => {
  const intents = [
    {action: "show-data-source", taskId: "source.task", fileId: "source.file", taskRevision: 3},
    {action: "show-dataset-version", datasetId: "dataset.1", versionId: "version.1", versionDigest: `sha256:${"a".repeat(64)}`},
    {action: "show-dataset-task", taskId: "ca353bdd-7793-44c6-8c36-c470be8c537c"},
  ];
  for (const intent of intents) {
    const decoded = readUiPresentationIntent(intent); assert.deepEqual(decoded, intent); assert.ok(decoded);
    const context = {view: viewForUiPresentationIntent(decoded), ready: true, dirtyNavigationBlocked: false, selection: intent};
    assert.deepEqual(readUiPresentationContext(context), context);
    assert.equal(readUiPresentationContext({...context, view: "artifact"}), undefined);
    assert.equal(readUiPresentationContext({...context, ready: false}), undefined);
    for (const extra of [{path: "private/source.csv"}, {rows: []}, {principalId: "other"}, {artifactId: "uploads/x"}])
      assert.equal(readUiPresentationIntent({...intent, ...extra}), undefined);
    assert.equal(readUiPresentationIntent(Object.create(intent)), undefined);
    assert.equal(readUiPresentationIntent(Object.defineProperty({...intent}, "taskId", {get() {throw new Error("Untrusted accessor");}})), undefined);
  }
  for (const taskRevision of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, "3"])
    assert.equal(readUiPresentationIntent({...intents[0], taskRevision}), undefined);
  for (const taskId of ["../task", " task", "a".repeat(129), "https://example.test"])
    assert.equal(readUiPresentationIntent({...intents[0], taskId}), undefined);
  for (const versionDigest of ["a".repeat(64), `sha256:${"A".repeat(64)}`, `sha256:${"a".repeat(63)}`])
    assert.equal(readUiPresentationIntent({...intents[1], versionDigest}), undefined);
  assert.equal(readUiPresentationIntent({...intents[2], taskId: "task.synthetic"}), undefined);
});
