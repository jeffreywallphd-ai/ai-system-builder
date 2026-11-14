import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { UI_PRESENTATION_LIMITS, type HeadlessHostIncarnationId } from "../../../../contracts/headless";
import { createWorkspaceId } from "../../../../contracts/workspace";
import { createManagedBrowserPresentation } from "../createManagedBrowserPresentation";

const target = {hostIncarnationId: randomUUID() as HeadlessHostIncarnationId, windowId: randomUUID(), uiIncarnationId: randomUUID(),
  workspaceId: createWorkspaceId("fixture-workspace"), requestId: randomUUID(), attemptId: randomUUID(), leaseId: randomUUID(), generation: 1};
const intent = {action:"open-system", systemId:"fixture.system", revisionId:"revision-1"} as const;
const current = () => true;

test("bounded delivery keeps one ordered position, reports outcomes and rejects a held pull after retirement", async () => {
  const owner = createManagedBrowserPresentation({now:() => 1_000});
  const command = {target, commandId:randomUUID(), intent};
  let requestIsCurrent = true;
  const held = Promise.withResolvers<{title:string}>();
  try {
    const submitted = await owner.submit(command, current, current, async () => true);
    assert.deepEqual(submitted, {status:"accepted", receipt:{commandId:command.commandId, sequence:1,status:"accepted"}});
    assert.equal((await owner.submit(command, current, current, async () => true)).status, "duplicate");
    assert.equal((await owner.submit({...command,intent:{...intent, revisionId:"revision-2"}}, current, current, async () => true)).status, "conflict");
    for (let sequence = 2; sequence <= UI_PRESENTATION_LIMITS.queued; sequence++) {
      assert.equal((await owner.submit({...command, commandId:randomUUID()}, current, current, async () => true)).status, "accepted");
    }
    assert.equal((await owner.submit({...command, commandId:randomUUID()}, current, current, async () => true)).status, "busy");
    assert.deepEqual(await owner.pull({target,sequence:2}, current, async () => ({title:"Saved"})), {status:"unavailable"});
    const inFlight = owner.pull({target,sequence:1}, () => requestIsCurrent, () => held.promise);
    let duplicateReads = 0;
    assert.deepEqual(await owner.pull({target,sequence:1}, current, async () => {
      duplicateReads++;
      return {title:"Unexpected duplicate read"};
    }), {status:"unavailable"});
    assert.equal(duplicateReads, 0);
    requestIsCurrent = false;
    held.resolve({title:"Saved"});
    assert.deepEqual(await inFlight, {status:"unavailable"});
    assert.equal(owner.acknowledge({target, receipt:{commandId:command.commandId, sequence:1,status:"applied"}},current), false);
    const delivered = await owner.pull({target,sequence:1}, current, async () => ({title:"Saved"}));
    assert.ok(delivered.status === "command" && delivered.command.commandId === command.commandId);
    const receipt = {commandId:command.commandId, sequence:1,status:"applied"};
    assert.equal(owner.acknowledge({target:{...target,generation:2}, receipt},current), false);
    assert.equal(owner.acknowledge({target, receipt},current), true);
    assert.deepEqual(await owner.pull({target,sequence:1}, current, async () => ({title:"Saved"})), {status:"terminal",receipt});
  } finally {owner.close();}
});

test("context must answer the current exact challenge once and is discarded after revoke or expiry", async () => {
  let clock = 1_000;
  let live = true;
  const alive = () => live;
  const owner = createManagedBrowserPresentation({now:() => clock});
  const context = {view:"system", ready:true, dirtyNavigationBlocked:false, selection:intent};
  try {
    const request = owner.readFreshContext(target, alive);
    const challenge = owner.contextChallenge(target, current);
    assert.ok(challenge);
    assert.equal(owner.publishContext({target, challenge:randomUUID(), context}, current), false);
    assert.equal(owner.publishContext({target:{...target,generation:2}, challenge, context}, current), false);
    assert.equal(owner.publishContext({target, challenge, context:{...context, rawText:"ignored"}}, current), false);
    assert.equal(owner.publishContext({target, challenge, context}, current), true);
    assert.equal(owner.publishContext({target, challenge, context}, current), false);
    assert.deepEqual(await request, {snapshot:context,deadline:1_750});
    const second = owner.readFreshContext(target, alive);
    const secondChallenge = owner.contextChallenge(target, alive);
    assert.ok(secondChallenge);
    live = false;
    owner.retireLease(target);
    assert.equal(owner.publishContext({target, challenge:secondChallenge, context}, current), false);
    assert.equal(await second, undefined);
    live = true;
    const third = owner.readFreshContext(target, alive);
    const thirdChallenge = owner.contextChallenge(target, alive);
    clock += 750;
    assert.equal(owner.publishContext({target, challenge:thirdChallenge, context}, current), false);
    owner.retireLease(target);
    assert.equal(await third, undefined);
    const last = owner.readFreshContext(target, alive);
    const lastChallenge = owner.contextChallenge(target, current);
    assert.ok(lastChallenge);
    live = false;
    assert.equal(owner.publishContext({target, challenge:lastChallenge, context}, current), false);
    assert.equal(owner.contextChallenge(target, current), undefined);
    assert.equal(await last, undefined);
  } finally {owner.close();}
});

test("keeps resource policy reads within the fixed limit while requests are held", async () => {
  const owner = createManagedBrowserPresentation({now:() => 1_000});
  const release = Promise.withResolvers<boolean>();
  let calls = 0;
  const submit = () => owner.submit({target, commandId:randomUUID(),intent}, current, current, () => {
    calls++;
    return release.promise;
  });
  const pending = Array.from({length:16}, submit);
  try {
    assert.equal(calls,16);
    assert.deepEqual(await submit(),{status:"busy"});
    assert.equal(calls,16);
    release.resolve(true);
    assert.ok((await Promise.all(pending)).every(result=>result.status === "accepted"));
    assert.equal((await submit()).status,"accepted");
    assert.equal(calls,17);
  } finally {release.resolve(false); owner.close();}
});
