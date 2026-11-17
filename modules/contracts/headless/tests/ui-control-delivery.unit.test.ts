import assert from "node:assert/strict";
import { test } from "node:test";
import { readUiPresentationIntent, readUiPresentationDelivery } from "..";

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
