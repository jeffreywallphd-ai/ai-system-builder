import assert from "node:assert/strict";
import test from "node:test";
import { captureInitialProgress, progressVisibilityDelay, terminalVisibilityDelay } from "../visual-composer/task-visibility-measurement";

const activity = () => ({requestId:"task.synthetic",status:"running",progress:{percent:10},updatedAt:"2026-10-21T00:00:01.000Z"});
const start = Date.parse("2026-10-21T00:00:01.000Z");

test("stale visible progress cannot borrow a newer authoritative timestamp", () => {
  const current = activity();
  const captured = captureInitialProgress(current,"task.synthetic");
  current.progress.percent=90;current.updatedAt="2026-10-21T00:00:03.500Z";
  // A later API read would incorrectly report100ms; the captured transition
  // correctly retains2600ms, including the slow navigation/recovery.
  assert.equal(progressVisibilityDelay(captured,50,start+2600),2600);
  assert.equal(captured.percent,10);assert.equal(captured.emittedAt,start);
  assert.equal(Object.isFrozen(captured),true);
});

test("the fixed initial milestone cannot be replaced by a later easier sample", () => {
  for (const percent of [undefined,0,25,50,75,90,NaN,Infinity,"10"]) {
    assert.throws(()=>captureInitialProgress({...activity(),progress:{percent}},"task.synthetic"),/fixed initial/);
  }
  for (const patch of [{requestId:"foreign"},{status:"queued"},{status:"succeeded"}]) {
    assert.throws(()=>captureInitialProgress({...activity(),...patch},"task.synthetic"),/fixed initial/);
  }
});

test("a rendered current or newer value qualifies only with a finite nonnegative delay", () => {
  const captured=captureInitialProgress(activity(),"task.synthetic");
  assert.equal(progressVisibilityDelay(captured,10,start+300),300);
  assert.equal(progressVisibilityDelay(captured,90,start+2200),2200,"slow samples are retained, never clamped");
  for(const value of [9,101,NaN,Infinity]) assert.throws(()=>progressVisibilityDelay(captured,value,start+100),/Rendered progress/);
  for(const value of [start-1,NaN,Infinity]) assert.throws(()=>progressVisibilityDelay(captured,10,value),/delay/);
});

test("invalid progress and terminal timestamps and negative terminal delays fail closed", () => {
  for(const value of [undefined,"","invalid","2026-99-99T00:00:00.000Z","2026-02-31T00:00:00.000Z",1000]) {
    assert.throws(()=>captureInitialProgress({...activity(),updatedAt:value},"task.synthetic"),/timestamp/);
    assert.throws(()=>terminalVisibilityDelay(value,start+100),/timestamp/);
  }
  assert.equal(terminalVisibilityDelay(activity().updatedAt,start+200),200);
  for(const value of [start-1,NaN,Infinity]) assert.throws(()=>terminalVisibilityDelay(activity().updatedAt,value),/delay/);
});
