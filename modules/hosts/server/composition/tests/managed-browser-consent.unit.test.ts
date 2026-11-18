import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import { UI_CONTROL_VERSION, readUiControlObservation, viewForUiPresentationIntent, type HeadlessHostIncarnationId, type HeadlessWindowRequest } from "../../../../contracts/headless";
import { createOrganizationId } from "../../../../contracts/organization";
import { createWorkspaceId } from "../../../../contracts/workspace";
import { composeManagedBrowserConsent } from "../composeManagedBrowserConsent";

const hostIncarnationId = randomUUID() as HeadlessHostIncarnationId;
const workspaceId = createWorkspaceId("fixture-workspace");
const organizationId = createOrganizationId("fixture-org");
const principalId = "fixture-principal";
const binding = {sameCredential(other: unknown) { return binding === other; }};
const browser = {purpose: "browser" as const, organizationId, principalId, registeredClientId: randomUUID(),
  isCurrent: () => true, credentialBinding: binding};
const agent = {purpose: "agent" as const, organizationId, principalId, registeredClientId: randomUUID(),
  isCurrent: () => true, agentSessionId: randomUUID()};
const active = () => true;

test("only observations use the passive workspace authorizer and its denial retires the document", async () => {
  let normalReads = 0;
  let passiveReads = 0;
  let observePermitted = true;
  const service = composeManagedBrowserConsent({hostIncarnationId, async authorize() {normalReads++; return true;},
    async authorizeObservation() {passiveReads++; return observePermitted;}});
  try {
    const registered = await service.register(browser, workspaceId, active);
    assert.ok(registered && "target" in registered);
    const document = {...registered, identity:browser};
    assert.deepEqual(await service.observe(document, active), {status:"ready"});
    assert.deepEqual([normalReads, passiveReads], [1,1]);
    const request = {version:UI_CONTROL_VERSION, operation:"window.request",
      input:{target:registered.target,taskId:randomUUID(),requestKey:randomUUID()}} as const;
    const result = await service.execute(request, agent, active);
    assert.ok(result.ok && result.value.kind === "request");
    assert.ok(await service.consent(document, result.value.request.target, "accept", active));
    assert.ok(normalReads > 1);
    assert.equal(passiveReads, 1);
    observePermitted = false;
    assert.deepEqual(await service.observe(document, active), {status:"unavailable"});
    assert.equal(passiveReads, 2);
    assert.equal(await service.consent(document, result.value.request.target, "accept", active), undefined);
  } finally {service.close();}
});

for (const query of [false, true]) test(`only the active managed lease receives ${query ? "query" : "saved"} presentation and fresh minimal context`, async () => {
  const intent = query ? {action: "show-context-query", taskId: randomUUID()} as const : {action:"open-system", systemId:"fixture.saved", revisionId:"revision-1"} as const;
  let resourceAllowed = true;
  const resourcePolicyModes: boolean[] = [];
  let now = 0;
  const service = composeManagedBrowserConsent({hostIncarnationId, authorize:async () => true, now:() => now,
    async resolvePresentation(principal, workspace, input, {passive}) {
      assert.equal(principal.organizationId, organizationId);
      assert.equal(principal.principalId, principalId);
      assert.equal(workspace, workspaceId);
      resourcePolicyModes.push(passive);
      return resourceAllowed && JSON.stringify(input) === JSON.stringify(intent) ? {title:"Saved metadata"} : undefined;
    }});
  try {
    const registered = await service.register(browser, workspaceId, active);
    const foreign = await service.register(browser, workspaceId, active);
    assert.ok(registered && "target" in registered && foreign && "target" in foreign);
    const tab = {...registered, identity:browser};
    const request = await service.execute({version:UI_CONTROL_VERSION, operation:"window.request", input:{target:registered.target,
      taskId:randomUUID(),requestKey:randomUUID()}}, agent, active);
    assert.ok(request.ok && request.value.kind === "request");
    const reserved = await service.consent(tab, request.value.request.target,"accept",active);
    assert.ok(reserved);
    const {target} = reserved;
    const present = {version:UI_CONTROL_VERSION,operation:"window.present",input:{target,intent,commandId:randomUUID()}} as const;
    assert.deepEqual(await service.execute(present,agent,active),{ok:false,code:"headless.forbidden"});
    assert.ok(await service.consent(tab,target,"ready",active));
    const queued = await service.execute(present,agent,active);
    assert.ok(queued.ok && queued.value.kind === "command" && queued.value.receipt.status === "accepted");
    assert.equal(service.canPublish(present,queued,agent),true);
    const pull = {target,sequence:1};
    assert.equal(await service.pullPresentation({...foreign,identity:browser},pull,active),undefined);
    const delivered = await service.pullPresentation(tab,pull,active);
    assert.ok(delivered?.result.status === "command" && delivered.result.detail.title === "Saved metadata");
    assert.equal(delivered.canPublish(), true);
    const repeated = await service.pullPresentation(tab, pull, active);
    assert.ok(repeated?.canPublish());
    assert.deepEqual(resourcePolicyModes,[false,true,true]);
    now = 5_001;
    const unconfirmed = await service.pullPresentation(tab, pull, active);
    assert.ok(unconfirmed?.result.status === "terminal" && unconfirmed.result.receipt.status === "unconfirmed");
    assert.equal(unconfirmed.canPublish(), true);
    assert.equal((await service.acknowledgePresentation(tab,{target,receipt:{...queued.value.receipt,status:"applied"}},active))?.result,true);
    assert.equal(delivered.canPublish(), false);
    assert.equal(unconfirmed.canPublish(), false);
    const confirmed = await service.pullPresentation(tab, pull, active);
    assert.ok(confirmed?.result.status === "terminal" && confirmed.result.receipt.status === "applied");
    assert.equal(confirmed.canPublish(), true);
    const read = {version:UI_CONTROL_VERSION,operation:"window.context",input:{target}} as const;
    const openContext = service.execute(read,agent,active);
    const challengeResponse = await service.readContextChallenge(tab,target,active);
    const challenge = challengeResponse?.result;
    assert.ok(challenge && challengeResponse.canPublish());
    const context = {view:viewForUiPresentationIntent(intent),ready:true,dirtyNavigationBlocked:false,selection:intent};
    assert.equal((await service.publishContext(tab,{target,challenge,context},active))?.result,true);
    assert.equal(challengeResponse.canPublish(), false);
    const response = await openContext;
    assert.deepEqual(response,{ok:true,value:{kind:"context",context}});
    assert.equal(service.canPublish(read,response,agent),true);
    if (query) {
      resourceAllowed = false;
      const deniedRead = service.execute(read, agent, active);
      const deniedChallenge = await service.readContextChallenge(tab, target, active);
      assert.ok(deniedChallenge?.result);
      assert.equal((await service.publishContext(tab, {target, challenge: deniedChallenge.result, context}, active))?.result, true);
      assert.deepEqual(await deniedRead, {ok: false, code: "headless.forbidden"}, "Resource policy withdrawal must deny fresh query context after an earlier successful display.");
      resourceAllowed = true;
    }

    const pending = service.execute(read,agent,active);
    const pendingChallenge = await service.readContextChallenge(tab,target,active);
    assert.ok(pendingChallenge?.result && pendingChallenge.canPublish());
    assert.equal(await service.revoke(tab,target,active),true);
    assert.equal(pendingChallenge.canPublish(), false);
    assert.deepEqual(await pending,{ok:false,code:"headless.unavailable"});
    assert.equal(service.canPublish(read,response,agent),false);
    assert.equal(await service.pullPresentation(tab,pull,active),undefined);

    const replacement = await service.execute({version:UI_CONTROL_VERSION, operation:"window.request",
      input:{target:registered.target, taskId:randomUUID(), requestKey:randomUUID()}}, agent, active);
    assert.ok(replacement.ok && replacement.value.kind === "request");
    const next = await service.consent(tab, replacement.value.request.target, "accept", active);
    assert.ok(next && await service.consent(tab, next.target, "ready", active));
    const nextCommand = {...present, input:{target:next.target, intent, commandId:randomUUID()}};
    const nextReceipt = await service.execute(nextCommand, agent, active);
    assert.ok(nextReceipt.ok && nextReceipt.value.kind === "command");
    const nextRead = service.execute({...read, input:{target:next.target}}, agent, active);
    const nextChallenge = (await service.readContextChallenge(tab, next.target, active))?.result;
    assert.ok(nextChallenge);
    assert.equal(await service.revoke(tab, request.value.request.target, active), true);
    const nextDelivery = await service.pullPresentation(tab, {target:next.target, sequence:1}, active);
    assert.ok(nextDelivery?.result.status === "command" && nextDelivery.result.command.commandId === nextCommand.input.commandId);
    assert.equal((await service.publishContext(tab, {target:next.target, challenge:nextChallenge, context}, active))?.result, true);
    assert.deepEqual(await nextRead, {ok:true,value:{kind:"context",context}});
  } finally {service.close();}
});

test("the agent requests, the exact browser consents and confirms readiness, and revoke returns to manual", async () => {
  const service = composeManagedBrowserConsent({hostIncarnationId, async authorize(principal, id) {
    return principal.organizationId === organizationId && id === workspaceId;
  }});
  try {
    const a = await service.register(browser, workspaceId, active);
    const b = await service.register(browser, workspaceId, active);
    assert.ok(a && b);
    const tabA = {...a, identity: browser};
    const tabB = {...b, identity: browser};
    const list = {version: UI_CONTROL_VERSION, operation: "window.list", input: {hostIncarnationId, workspaceId}} as const;
    assert.deepEqual(await service.execute(list, agent, active), {ok: true, value: {kind: "windows", windows: [a.target, b.target]}});
    assert.deepEqual(await service.execute(list, {...agent, principalId: "different-user"}, active), {ok: true, value: {kind: "windows", windows: []}});
    assert.deepEqual(await service.execute(list, {...agent, organizationId: createOrganizationId("other-org")}, active), {ok: false, code: "headless.forbidden"});
    const request = {version: UI_CONTROL_VERSION, operation: "window.request",
      input: {target: a.target, taskId: randomUUID(), requestKey: randomUUID()}} as const;
    const requested = await service.execute(request, agent, active);
    assert.ok(requested.ok && requested.value.kind === "request");
    const pending = requested.value.request;
    const status = {version: UI_CONTROL_VERSION, operation: "window.status", input: {target: pending.target}} as const;
    assert.equal(pending.status, "pending");
    assert.deepEqual(readUiControlObservation(await service.observe(tabA, active)), {status: "ready", request: pending});
    assert.deepEqual(await service.observe(tabB, active), {status: "ready"});
    assert.equal(await service.consent(tabB, pending.target, "accept", active), undefined);
    assert.equal(await service.consent(tabA, pending.target, "ready", active), undefined);
    const accepted = await service.consent(tabA, pending.target, "accept", active);
    assert.ok(accepted);
    const waiting = await service.execute(status, agent, active);
    assert.ok(waiting.ok && waiting.value.kind === "request" && waiting.value.request.status === "awaiting-readiness" && !waiting.value.lease);
    assert.deepEqual(await service.execute(status, {...agent, agentSessionId: randomUUID()}, active), {ok: false, code: "headless.forbidden"});
    const ready = await service.consent(tabA, accepted.target, "ready", active);
    assert.ok(ready && ready.remainingMs <= 15_000);
    const live = await service.execute(status, agent, active);
    assert.ok(live.ok && live.value.kind === "request" && live.value.request.status === "active");
    assert.deepEqual(live.value.lease, ready.target);
    assert.equal(service.canPublish(status, live, agent), true);
    for (const descriptor of [{agentSessionId: randomUUID()}, {taskId: randomUUID()}, {expiresAt: live.value.request.expiresAt + 5}]) {
      assert.equal(service.canPublish(status, {ok:true, value:{...live.value, request:{...live.value.request, ...descriptor}}}, agent), false);
    }
    assert.equal(service.canPublish(status, {ok:true, value:{kind:"request", request:live.value.request, lease:{...ready.target, leaseId:randomUUID()}}}, agent), false);
    assert.equal(service.canPublish(status, {ok:true, value:{kind:"request", request:live.value.request, lease:{...ready.target, generation:ready.target.generation + 1}}}, agent), false);
    assert.equal(service.canPublish(status, {ok:true, value:{kind:"request", request:live.value.request}}, agent), false);
    assert.equal(await service.revoke(tabB, ready.target, active), false);
    assert.equal(await service.revoke(tabA, {...ready.target, generation: ready.target.generation + 1}, active), false);
    assert.equal(await service.revoke(tabA, ready.target, active), true);
    assert.equal(service.canPublish(status, live, agent), false);
    assert.deepEqual(await service.execute(status, agent, active), {ok: true, value: {kind: "ended"}});
    assert.deepEqual(await service.execute(request, agent, active), {ok: true, value: {kind: "ended"}});
    assert.deepEqual(await service.observe(tabA, active), {status: "ready"});
    assert.equal(service.disconnect(tabA), true);
    assert.deepEqual(await service.execute(list, agent, active), {ok: true, value: {kind: "windows", windows: [b.target]}});
  } finally { service.close(); }
});

test("retired transports cannot create a prompt or consent after a held application policy check", async () => {
  let authorityReads = 0;
  let holdAt = 0;
  let entered = Promise.withResolvers<void>();
  let release = Promise.withResolvers<void>();
  let requestIsCurrent = true;
  const service = composeManagedBrowserConsent({hostIncarnationId, async authorize() {
    if (++authorityReads === holdAt) {entered.resolve(); await release.promise;}
    return true;
  }});
  const current = () => requestIsCurrent;
  try {
    const a = await service.register(browser, workspaceId, active);
    assert.ok(a);
    const tab = {...a, identity: browser};
    const request: HeadlessWindowRequest = {version: UI_CONTROL_VERSION, operation: "window.request",
      input: {target: a.target, taskId: randomUUID(), requestKey: randomUUID()}};
    holdAt = authorityReads + 2;
    const staleRequest = service.execute(request, agent, current);
    await entered.promise;
    requestIsCurrent = false;
    release.resolve();
    assert.deepEqual(await staleRequest, {ok: false, code: "headless.forbidden"});
    assert.deepEqual(await service.observe(tab, active), {status: "ready"});

    requestIsCurrent = true;
    const requested = await service.execute(request, agent, current);
    assert.ok(requested.ok && requested.value.kind === "request");
    const {target} = requested.value.request;
    holdAt = authorityReads + 2;
    entered = Promise.withResolvers<void>();
    release = Promise.withResolvers<void>();
    const staleConsent = service.consent(tab, target, "accept", current);
    await entered.promise;
    requestIsCurrent = false;
    release.resolve();
    assert.equal(await staleConsent, undefined);
    const state = await service.observe(tab, active);
    assert.ok(state.status === "ready" && state.request?.status === "pending");
    assert.equal(service.disconnect(tab), true);
    assert.equal(await service.consent(tab, target, "accept", active), undefined);
  } finally { release.resolve(); service.close(); }
});

test("a retired observe cannot renew a document, and a retired status denial cannot end an active consent", async () => {
  let time = 5_000;
  let policyReads = 0;
  let holdAt = 0;
  let current = true;
  let resultWhenHeld = true;
  let entered = Promise.withResolvers<void>();
  let release = Promise.withResolvers<void>();
  const service = composeManagedBrowserConsent({hostIncarnationId, now: () => time, async authorize() {
    if (++policyReads !== holdAt) return true;
    entered.resolve();
    await release.promise;
    return resultWhenHeld;
  }});
  try {
    const first = await service.register(browser, workspaceId, active);
    assert.ok(first);
    time += 11_000;
    holdAt = policyReads + 1;
    const observe = service.observe({...first, identity: browser}, () => current);
    await entered.promise;
    current = false;
    release.resolve();
    assert.equal((await observe).status, "unavailable");
    time += 1_000;
    const list = {version: UI_CONTROL_VERSION, operation: "window.list", input: {hostIncarnationId, workspaceId}} as const;
    assert.deepEqual(await service.execute(list, agent, active), {ok: true, value: {kind: "windows", windows: []}});

    current = true;
    const second = await service.register(browser, workspaceId, active);
    assert.ok(second);
    const document = {...second, identity: browser};
    const requested = await service.execute({version: UI_CONTROL_VERSION, operation: "window.request",
      input: {target: second.target, taskId: randomUUID(), requestKey: randomUUID()}}, agent, active);
    assert.ok(requested.ok && requested.value.kind === "request");
    const accepted = await service.consent(document, requested.value.request.target, "accept", active);
    assert.ok(accepted);
    assert.ok(await service.consent(document, accepted.target, "ready", active));
    const status = {version: UI_CONTROL_VERSION, operation: "window.status", input: {target: requested.value.request.target}} as const;
    entered = Promise.withResolvers<void>();
    release = Promise.withResolvers<void>();
    holdAt = policyReads + 2;
    resultWhenHeld = false;
    const pendingStatus = service.execute(status, agent, () => current);
    await entered.promise;
    current = false;
    release.resolve();
    assert.deepEqual(await pendingStatus, {ok: false, code: "headless.forbidden"});
    const stillActive = await service.execute(status, agent, active);
    assert.ok(stillActive.ok && stillActive.value.kind === "request" && stillActive.value.request.status === "active");
  } finally { release.resolve(); service.close(); }
});
