import assert from "node:assert/strict";
import test from "node:test";
import { finalizeQualificationEvidence, type QualificationEvidenceReport } from "../visual-composer/qualification-reporting";

async function caught(action: () => Promise<unknown>) {
  try { await action(); return undefined; } catch (error) { return error; }
}
const rejectedValues = [undefined, null, false, 0, "", new Error("synthetic-private-detail")];

test("successful publication attaches before the final passed write", async () => {
  const report = { status: "passed" }, calls: string[] = [];
  await finalizeQualificationEvidence(report, [], async () => { calls.push(`save:${report.status}`); }, async () => { calls.push(`attach:${report.status}`); });
  assert.deepEqual(calls, ["attach:passed", "save:passed"]);
  assert.deepEqual(report, { status: "passed" });
});
for (const [index, primary] of rejectedValues.entries()) {
  test(`primary failure ${index} remains authoritative after successful reporting`, async () => {
    const report: QualificationEvidenceReport = { status: "passed" }, saved: unknown[] = [];
    const error = await caught(() => finalizeQualificationEvidence(report, [primary], async () => { saved.push(structuredClone(report)); }, async () => undefined));
    assert(error instanceof AggregateError); assert.deepEqual(error.errors, [primary]);
    assert.deepEqual(saved, [{ status: "failed", failureStage: "journey" }]);
  });
  test(`attachment failure ${index} cannot publish passed storage`, async () => {
    const report: QualificationEvidenceReport = { status: "passed" }, saved: unknown[] = [];
    const error = await caught(() => finalizeQualificationEvidence(report, [], async () => { saved.push(structuredClone(report)); }, async () => { throw primary; }));
    assert(error instanceof AggregateError); assert.deepEqual(error.errors, [primary]);
    assert.deepEqual(saved, [{ status: "failed", failureStage: "evidence-attach", finalizationStage: "evidence-attach" }]);
  });
  test(`storage failure ${index} attempts one failed write without hiding the failure`, async () => {
    const report: QualificationEvidenceReport = { status: "passed" }, saved: unknown[] = []; let writes = 0, attachments = 0;
    const error = await caught(() => finalizeQualificationEvidence(report, [], async () => {
      if (++writes === 1) throw primary;
      saved.push(structuredClone(report));
    }, async () => { attachments++; }));
    assert(error instanceof AggregateError); assert.deepEqual(error.errors, [primary]);
    assert.equal(writes, 2); assert.equal(attachments, 1);
    assert.deepEqual(saved, [{ status: "failed", failureStage: "evidence-save", finalizationStage: "evidence-save" }]);
  });
}
test("journey, attachment, storage and refused recovery failures retain order and falsy values", async () => {
  const report: QualificationEvidenceReport = { status: "passed" }; let writes = 0, attachments = 0;
  const error = await caught(() => finalizeQualificationEvidence(report, [undefined], async () => {
    if (++writes === 1) throw false;
    throw 0;
  }, async () => { attachments++; throw null; }));
  assert(error instanceof AggregateError); assert.deepEqual(error.errors, [undefined, null, false, 0]);
  assert.equal(writes, 2); assert.equal(attachments, 1);
  assert.deepEqual(report, { status: "failed", failureStage: "journey", finalizationStage: "evidence-save" });
});
test("unavailable storage cannot become success or trigger an unbounded retry", async () => {
  const report: QualificationEvidenceReport = { status: "passed" }; let writes = 0;
  const denied = new Error("Synthetic exclusive-create refusal.");
  const error = await caught(() => finalizeQualificationEvidence(report, [], async () => { writes++; throw denied; }, async () => undefined));
  assert(error instanceof AggregateError); assert.deepEqual(error.errors, [denied, denied]);
  assert.equal(writes, 2); assert.equal(report.status, "failed");
});
for (const status of ["running", "failed", "unknown", ""]) test(`incomplete status ${JSON.stringify(status)} cannot pass without a primary exception`, async () => {
  const report: QualificationEvidenceReport = { status }, saved: string[] = [];
  const error = await caught(() => finalizeQualificationEvidence(report, [], async () => { saved.push(report.status); }, async () => undefined));
  assert(error instanceof AggregateError); assert.equal(error.errors.length, 1);
  assert.equal(error.errors[0].message, "Qualification did not complete."); assert.deepEqual(saved, ["failed"]);
});
test("public report facts never contain private exception text or arbitrary thrown objects", async () => {
  const report: QualificationEvidenceReport = { status: "passed" }, publicCopies: string[] = [];
  const privateFailure = { message: "synthetic-private-detail", token: "synthetic-not-a-credential" };
  const error = await caught(() => finalizeQualificationEvidence(report, [privateFailure], async () => { publicCopies.push(JSON.stringify(report)); }, async () => { publicCopies.push(JSON.stringify(report)); }));
  assert(error instanceof AggregateError); assert.equal(error.errors[0], privateFailure);
  for (const body of publicCopies) assert(!/synthetic-private-detail|synthetic-not-a-credential|message|token/.test(body));
  assert.deepEqual(Object.keys(report).sort(), ["failureStage", "status"]);
});
