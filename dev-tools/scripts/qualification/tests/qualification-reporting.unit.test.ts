import assert from "node:assert/strict";
import test from "node:test";
import { finalizeQualificationEvidence, safeQualificationFailureType, isQualificationFailureType, isOwnedCleanupFailureStage, type QualificationEvidenceReport } from "../visual-composer/qualification-reporting";

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

test("explicit diagnostic success stays diagnostic and cannot acquire qualification", async () => {
  const report = {status:"diagnostic-passed", qualificationComplete:false}, saved: unknown[] = [];
  await finalizeQualificationEvidence(report, [], async () => {saved.push(structuredClone(report));}, async () => undefined, "diagnostic-passed");
  assert.deepEqual(saved, [{status:"diagnostic-passed", qualificationComplete:false}]);
  const error = await caught(() => finalizeQualificationEvidence({...report}, [], async () => undefined, async () => undefined));
  assert(error instanceof AggregateError);
});
test("a qualified report cannot borrow the diagnostic success channel", async () => {
  const report = {status:"passed"};
  const error = await caught(() => finalizeQualificationEvidence(report, [], async () => undefined, async () => undefined, "diagnostic-passed"));
  assert(error instanceof AggregateError); assert.equal(report.status, "failed");
});
for (const failure of rejectedValues) test(`diagnostic attachment rejection remains a failure: ${rejectedValues.indexOf(failure)}`, async () => {
  const report = {status:"diagnostic-passed", qualificationComplete:false}; let saved: unknown;
  const error = await caught(() => finalizeQualificationEvidence(report, [], async () => {saved=structuredClone(report);}, async () => {throw failure;}, "diagnostic-passed"));
  assert(error instanceof AggregateError); assert.deepEqual(error.errors,[failure]);
  assert.equal((saved as typeof report).status,"failed"); assert.equal((saved as typeof report).qualificationComplete,false);
});
for (const invalid of [null, undefined, {}, false, "diagnostic", Symbol("status")]) test(`unknown success channel is rejected before report or callbacks: ${typeof invalid}`, async () => {
  let reads=0, effects=0;
  const report=new Proxy({}, {get(){reads++;throw new Error("Unexpected report read.");}}) as QualificationEvidenceReport;
  const error=await caught(()=>finalizeQualificationEvidence(report,[],async()=>{effects++;},async()=>{effects++;},invalid as never));
  // Undefined deliberately selects the established default argument.
  if(invalid===undefined) {assert.equal(reads,1);assert.equal(effects,0);}
  else {assert(error instanceof Error);assert.equal(error.message,"Unsupported qualification success status.");assert.equal(reads,0);assert.equal(effects,0);}
});
for (const [value,label] of [[new Error("synthetic-private"),"Error"],[new TypeError("synthetic-private"),"TypeError"],
  [new RangeError("synthetic-private"),"RangeError"],[new SyntaxError("synthetic-private"),"SyntaxError"],
  [new ReferenceError("synthetic-private"),"ReferenceError"],[new AggregateError([],"synthetic-private"),"AggregateError"],
  [null,"Unknown"],[undefined,"Unknown"],[false,"Unknown"],[Symbol("synthetic-private"),"Unknown"]] as const) test(`failure type uses fixed label ${label}`,()=>{
  assert.equal(safeQualificationFailureType(value),label);
});
test("error name getters and proxy traps are never invoked",()=>{
  let calls=0;
  const native=new Error("synthetic-private");Object.defineProperty(native,"name",{get(){calls++;throw new Error("synthetic-private-name");}});
  assert.equal(safeQualificationFailureType(native),"Unknown");
  const proxy=new Proxy(new Error("synthetic-private"),{get(){calls++;throw 0;},getPrototypeOf(){calls++;throw 0;},ownKeys(){calls++;throw 0;},getOwnPropertyDescriptor(){calls++;throw 0;}});
  assert.equal(safeQualificationFailureType(proxy),"Unknown");
  const ordinary=Object.defineProperty({},"name",{get(){calls++;throw 0;}});assert.equal(safeQualificationFailureType(ordinary),"Unknown");
  assert.equal(calls,0);
});
test("only fixed own error names survive classification",()=>{
  for(const label of ["TimeoutError","AssertionError"]) {const value=new Error("synthetic-private");value.name=label;assert.equal(safeQualificationFailureType(value),label);}
  for(const label of ["synthetic-private-detail","x".repeat(65536),""]) {const value=new Error();value.name=label;assert.equal(safeQualificationFailureType(value),"Unknown");}
  const value=new Error();let calls=0;
  Object.setPrototypeOf(value,new Proxy({}, {get(){calls++;throw 0;},getPrototypeOf(){calls++;throw 0;}}));
  assert.equal(safeQualificationFailureType(value),"Error");assert.equal(calls,0);
});
test("public cleanup type and stage vocabularies are finite and non-coercing",()=>{
  for(const label of ["Error","TimeoutError","Unknown"])assert.equal(isQualificationFailureType(label),true);
  for(const stage of ["admission","worker-admission","app-close","main-exit","observer-close","worker-exit","worker-list"])assert.equal(isOwnedCleanupFailureStage(stage),true);
  let calls=0;const value=new Proxy({}, {get(){calls++;throw 0;},getPrototypeOf(){calls++;throw 0;},ownKeys(){calls++;throw 0;}});
  for(const candidate of ["synthetic-private",null,undefined,false,Symbol("stage"),value]){
    assert.equal(isQualificationFailureType(candidate),false);assert.equal(isOwnedCleanupFailureStage(candidate),false);
  }
  assert.equal(calls,0);
});
