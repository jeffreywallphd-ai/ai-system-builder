import assert from "node:assert/strict";
import { test } from "node:test";
import { readDatasetVersionReplaySources } from "../readDatasetVersionReplaySources";
const ref = (key = "uploads/source.csv") => ({ artifactId: key, storageKey: key });
const detail = (key: string) => ({ locator: { storageKey: key }, originalName: "source.csv", mediaType: "text/csv" });
const message = "Saved source files could not be confirmed in this workspace.";
test("copies exact returned workspace metadata and exposes no supplier-owned aliases", async () => {
  const raw = detail(ref().storageKey); const calls: unknown[] = [];
  const result = await readDatasetVersionReplaySources("workspace-a", [ref()], () => true, async (...args) => { calls.push(args); return raw; });
  raw.originalName = "changed.csv";
  assert.deepEqual(calls, [["workspace-a", "uploads/source.csv"]]);
  assert.deepEqual(result, [{ ...ref(), label: "source.csv", mediaType: "text/csv" }]);
  assert.equal(Object.isFrozen(result[0]), true);
});
test("captures all references and reads sequentially with a maximum of100", async () => {
  const sources = Array.from({ length: 100 }, (_, i) => ref(`uploads/${i}.csv`));
  let inflight=0, peak=0, count=0;
  const result = await readDatasetVersionReplaySources("workspace-a", sources, () => true, async (_scope,key) => {
    ++inflight; peak=Math.max(peak,inflight); ++count;
    sources[99].storageKey="mutated.csv";
    await Promise.resolve(); --inflight; return detail(key);
  });
  assert.equal(peak,1); assert.equal(count,100); assert.equal(result[99].storageKey,"uploads/99.csv");
});
for (const [name,sources] of [
  ["empty",[]], ["over100",Array.from({length:101},(_,i)=>ref(`uploads/${i}.csv`))],
  ["duplicate",[ref(),ref()]], ["non-key ID",[{...ref(),artifactId:"legacy"}]],
  ["noncanonical",[ref(" uploads/source.csv")]], ["sparse",new Array(1)],
  ["control key",[ref("uploads/source\n.csv")]], ["oversized key",[ref("x".repeat(513))]],
] as const) test(`rejects ${name} references before reading`, async () => {
  let calls=0;
  await assert.rejects(readDatasetVersionReplaySources("workspace-a",sources as any,()=>true,async()=>{++calls;return detail(ref().storageKey);}),{message});
  assert.equal(calls,0);
});
test("does not invoke reference or result accessors", async () => {
  let invoked=0;
  const malicious={artifactId:ref().artifactId,get storageKey(){++invoked;return ref().storageKey;}};
  await assert.rejects(readDatasetVersionReplaySources("workspace-a",[malicious],()=>true,async()=>detail(ref().storageKey)),{message});
  await assert.rejects(readDatasetVersionReplaySources("workspace-a",[ref()],()=>true,async()=>({get locator(){++invoked;return {storageKey:ref().storageKey};}})),{message});
  assert.equal(invoked,0);
});
for (const value of [null, [], {}, {locator:{storageKey:"other.csv"}}, {...detail(ref().storageKey),originalName:"x".repeat(513)}, {...detail(ref().storageKey),mediaType:"secret\nvalue"}]) {
  test("denies malformed or mismatched returned metadata without supplier details", async () => {
    await assert.rejects(readDatasetVersionReplaySources("workspace-a",[ref()],()=>true,async()=>value),{message});
  });
}
test("a stale request cannot read another source or return partial results", async () => {
  let active=true,calls=0;
  await assert.rejects(readDatasetVersionReplaySources("workspace-a",[ref(),ref("uploads/second.csv")],()=>active,async(_scope,key)=>{++calls;active=false;return detail(key);}),{message});
  assert.equal(calls,1);
});
test("stale admission and supplier rejection are safe failures", async () => {
  let calls=0;
  await assert.rejects(readDatasetVersionReplaySources("workspace-a",[ref()],()=>false,async()=>{++calls;return detail(ref().storageKey);}),{message});
  await assert.rejects(readDatasetVersionReplaySources("workspace-a",[ref()],()=>true,async()=>{throw new Error("private supplier detail");}),{message});
  assert.equal(calls,0);
});
test("whole-batch deadline stops subsequent reads without claiming transport cancellation", async context => {
  context.mock.timers.enable({apis:["setTimeout"]});
  let calls=0;
  const pending=readDatasetVersionReplaySources("workspace-a",[ref(),ref("uploads/second.csv")],()=>true,async()=>{++calls;return new Promise(()=>{});});
  const rejected=assert.rejects(pending,{message});
  context.mock.timers.tick(15_000);
  await rejected;
  assert.equal(calls,1);
});
