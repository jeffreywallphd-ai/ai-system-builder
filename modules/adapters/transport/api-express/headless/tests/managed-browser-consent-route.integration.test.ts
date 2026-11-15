import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { once } from "node:events";
import test from "node:test";
import express from "express";

import { MANAGED_BROWSER_CONSENT_PATH, MANAGED_BROWSER_DOCUMENT_HEADER, MANAGED_BROWSER_OBSERVE_PATH,
  parseHeadlessBuildPlanProposal, type HeadlessHostIncarnationId } from "../../../../../contracts/headless";
import { createOrganizationId } from "../../../../../contracts/organization";
import { normalizeIngestionTaskFileId, normalizeIngestionTaskId } from "../../../../../contracts/ingestion";
import { MANAGED_BROWSER_ACKNOWLEDGE_PATH, MANAGED_BROWSER_CONTEXT_PATH, MANAGED_BROWSER_DELIVERY_PATH,
  MANAGED_BROWSER_PUBLISH_CONTEXT_PATH } from "../../../../../contracts/headless/managed-browser-presentation";
import { MANAGED_BROWSER_PLAN_APPROVAL_PATH, MANAGED_BROWSER_PLAN_CHAT_PATH } from "../../../../../contracts/headless/managed-browser-plan-approval";
import { createWorkspaceId } from "../../../../../contracts/workspace";
import { resolveApiRoutePolicy } from "../../security/apiRouteSecurityPolicy";
import { setExpressAuthContext } from "../../security/expressAuthContext";
import { setExpressOrganizationContext } from "../../security/expressOrganizationContext";
import { registerManagedBrowserConsentRoute } from "../registerManagedBrowserConsentRoute";

const configuredOrigin = "https://fixture.invalid";
const organizationId = createOrganizationId("fixture-org");
const workspaceId = createWorkspaceId("fixture-workspace");
const target = {hostIncarnationId: randomUUID() as HeadlessHostIncarnationId, windowId: randomUUID(),
  uiIncarnationId: randomUUID(), workspaceId};
const attempt = {...target, requestId: randomUUID(), attemptId: randomUUID()};
const proof = "a".repeat(43);

test("only the exact POST has a central non-public policy", () => {
  for (const path of [MANAGED_BROWSER_CONSENT_PATH, MANAGED_BROWSER_OBSERVE_PATH, MANAGED_BROWSER_DELIVERY_PATH,
    MANAGED_BROWSER_ACKNOWLEDGE_PATH, MANAGED_BROWSER_CONTEXT_PATH, MANAGED_BROWSER_PUBLISH_CONTEXT_PATH, MANAGED_BROWSER_PLAN_APPROVAL_PATH]) {
    assert.deepEqual(resolveApiRoutePolicy("POST", path), {public:false,
      scopes:["workspace:read", "asset:read", ...(path === MANAGED_BROWSER_PLAN_APPROVAL_PATH ? ["asset:write"] : [])]});
    for (const [method, variant] of [["GET", path], ["POST", `${path}/`], ["POST", path.toUpperCase()], ["OPTIONS", path]] as const) {
      assert.equal(resolveApiRoutePolicy(method, variant).deny, true);
    }
  }
});

test("exact browser origin, purposeful authentication, framing and live request are required for consent", async () => {
  const app = express();
  app.use((request, _response, next) => {
    const client = request.headers.authorization;
    if (client) setExpressAuthContext(request, {authenticated: true, authMethod: "oidc-bearer", oidcAccessTokenClientId: client,
      principal: {principalId: "fixture-user", kind: "user", roles: [], scopes: []}});
    setExpressOrganizationContext(request, {organizationId, principalId: "fixture-user"});
    next();
  });
  let admitted = true;
  let registrationRetired = false;
  let observed = 0;
  let registerReply: unknown = {target, proof};
  let observeReply: Awaited<ReturnType<import("../registerManagedBrowserConsentRoute").ManagedBrowserConsentHandlers<unknown>["observe"]>> | undefined;
  const grant = {target: {...attempt, leaseId: randomUUID(), generation: 1}, remainingMs: 10_000};
  const command = {target:grant.target,commandId:randomUUID(),intent:{action:"open-system",systemId:"fixture.system",revisionId:"revision-1"},sequence:1,remainingMs:1_000};
  const challenge = randomUUID();
  let pullResult: unknown = {status:"command", command, detail:{title:"Saved example"}};
  let deliveryCurrent = true;
  let deliveryEnabled = false;
  let planEnabled = false;
  let planReplyCurrent = true;
  let stableFileRead = true;
  let fileSelectionCalls = 0;
  let hasFilePlanAccess = true;
  let enableFilePlanPublication = true;
  let filePlanHold: {entered:PromiseWithResolvers<void>; release:PromiseWithResolvers<void>} | undefined;
  let planApprovalCalls = 0;
  const approvalChannels: string[] = [];
  const planReference = {workspaceId, registeredClientId:randomUUID(), fingerprint:"b".repeat(64), expiresAt:Date.now() + 60_000};
  const file = { workspaceId, registeredClientId:planReference.registeredClientId, expectedSelectionRevision:0,
    taskId:normalizeIngestionTaskId("ingestion.browser-fixture"), fileId:normalizeIngestionTaskFileId("file.browser-fixture"), taskRevision:3 };
  const fileReceipt = {workspaceId, taskId:file.taskId, fileId:file.fileId, taskRevision:3, selectionRevision:1};
  const mixed = parseHeadlessBuildPlanProposal({hostIncarnationId:target.hostIncarnationId, workspaceId, steps:[{
    operation:"data.save-local-source",taskId:file.taskId,fileId:file.fileId,taskRevision:file.taskRevision,idempotencyKey:randomUUID(),
  }]},target.hostIncarnationId,{allowLocalFileSave:true});
  assert.ok(mixed.ok);
  const filePlanFingerprint = createHash("sha256").update(JSON.stringify(mixed.preview)).digest("hex");
  const filePlanSelection = {workspaceId, registeredClientId:file.registeredClientId, fingerprint:filePlanFingerprint};
  const filePlanState = {fingerprint:filePlanFingerprint,revision:1,stepCount:1,expiresAt:planReference.expiresAt,
    status:"pending" as const,approvedSteps:0};
  const filePlanView = {selection:filePlanSelection,viewId:randomUUID(),preview:mixed.preview,state:filePlanState};
  const filePlanDecision = {...filePlanState,revision:2,status:"approved" as const,mode:"whole-plan" as const,approvedSteps:1};
  let consentReply: typeof grant | undefined;
  const entered = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const retire = registerManagedBrowserConsentRoute(app, configuredOrigin, () => ({
    hostIncarnationId: target.hostIncarnationId,
    deliveryEnabled,
    identify({auth, organization, organizationHeader}) {
      if (auth?.oidcAccessTokenClientId === "fixture-browser" && organization?.organizationId === organizationId &&
        organizationHeader === organizationId) return {isCurrent: () => admitted};
    },
    isCurrent(identity) { return identity.isCurrent(); },
    async register(_identity, workspace) { return workspace === workspaceId ? registerReply : undefined; },
    async observe(document) {
      observed++;
      return observeReply ?? {status: document.proof === proof ? "ready" : "unavailable"};
    },
    async consent(_document, _target, _phase, current) {
      if (consentReply) return consentReply;
      entered.resolve();
      await release.promise;
      assert.equal(current(), false);
      return {target: {...attempt, leaseId: randomUUID(), generation: 1}, remainingMs: 10_000};
    },
    async revoke() { return false; },
    disconnect() { registrationRetired = true; return true; },
    ...(planEnabled ? {async planApproval(document, input, _current, channel) {
      planApprovalCalls++;
      if (document.proof === proof && (input.operation === "open" || input.operation === "decide")) {
        return {
          value:input.operation === "open" ? filePlanView : filePlanDecision,
          canPublish:() => planReplyCurrent,
          publishIfCurrent:enableFilePlanPublication ? async (send:() => boolean) => {
            const hold = filePlanHold;
            hold?.entered.resolve();
            await hold?.release.promise;
            return hasFilePlanAccess && send();
          } : undefined,
        };
      }
      if (input.operation === "list-file-clients" || input.operation === "select-file" || input.operation === "select-provider-file") {
        fileSelectionCalls++;
        if (document.proof !== proof || (input.operation !== "list-file-clients" &&
          input.file.registeredClientId !== file.registeredClientId)) return;
        return {
          value:input.operation === "list-file-clients" ? [file.registeredClientId] : fileReceipt,
          canPublish:() => planReplyCurrent,
          publishIfCurrent:stableFileRead ? async (send:() => boolean) => send() : undefined,
        };
      }
      approvalChannels.push(channel);
      if (document.proof !== proof || input.operation !== "list") return;
      return {value:[planReference], canPublish:() => planReplyCurrent};
    }} : {}),
    async pullPresentation() { return {result: pullResult, canPublish: () => deliveryCurrent}; },
    async acknowledgePresentation() { return {result: true, canPublish: () => deliveryCurrent}; },
    async readContextChallenge() { return {result: challenge, canPublish: () => deliveryCurrent}; },
    async publishContext() { return {result: true, canPublish: () => deliveryCurrent}; },
  }));
  const server = app.listen(0, "127.0.0.1");
  try {
    await once(server, "listening");
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const url = `http://127.0.0.1:${address.port}`;
    const post = (body: unknown, headers: Record<string, string> = {}, query = "",
      route = typeof body === "object" && body && "operation" in body && body.operation === "observe" ? MANAGED_BROWSER_OBSERVE_PATH : MANAGED_BROWSER_CONSENT_PATH) => fetch(url + route + query, {method: "POST", headers: {
      origin: configuredOrigin, "sec-fetch-site": "same-origin", authorization: "fixture-browser",
      "x-organization-id": organizationId, "content-type": "application/json", ...headers,
    }, body: typeof body === "string" ? body : JSON.stringify(body)});
    const register = {operation: "register", workspaceId};
    for (const headers of [{origin: "null"}, {origin: "https://other.invalid"}, {"sec-fetch-site": "cross-site"},
      {authorization: "fixture-agent"}, {"x-organization-id": "other-org"}]) assert.equal((await post(register, headers)).status, 403);
    assert.equal((await post(register, {"content-type": "text/plain"})).status, 415);
    assert.equal((await post(register, {}, "?ignored=yes")).status, 400);
    assert.equal((await post(register, {[MANAGED_BROWSER_DOCUMENT_HEADER]: proof})).status, 400);
    assert.equal((await post(` {"operation":"register","workspaceId":"${workspaceId}"}`)).status, 400);
    assert.equal((await post({operation: "register", workspaceId, extra: "x".repeat(5_000)})).status, 413);
    registerReply = {status: "busy"};
    assert.equal((await post(register)).status, 503);
    registerReply = undefined;
    assert.equal((await post(register)).status, 403);
    for (const foreign of [{...target, hostIncarnationId: randomUUID()}, {...target, workspaceId: "foreign-workspace"}]) {
      registerReply = {target: foreign, proof};
      const refused = await post(register);
      assert.equal(refused.status, 503);
      assert.equal(JSON.stringify(await refused.json()).includes(proof), false);
    }
    registerReply = {target, proof};
    const registration = await post(register);
    assert.equal(registration.status, 200);
    assert.equal(registration.headers.get("cache-control"), "no-store");
    assert.equal(registration.headers.get("access-control-allow-origin"), null);
    assert.deepEqual(await registration.json(), {target, proof});
    assert.equal((await post(register, {}, "", MANAGED_BROWSER_OBSERVE_PATH)).status, 400);
    assert.equal((await post({operation: "observe", document: target}, {[MANAGED_BROWSER_DOCUMENT_HEADER]: proof}, "", MANAGED_BROWSER_CONSENT_PATH)).status, 400);
    assert.equal((await post({operation: "observe", document: target})).status, 403);
    assert.equal((await post({operation: "accept", document: target, target: {...attempt, uiIncarnationId: randomUUID()}},
      {[MANAGED_BROWSER_DOCUMENT_HEADER]: proof})).status, 400);
    assert.equal(observed, 0);
    assert.deepEqual(await (await post({operation: "observe", document: target}, {[MANAGED_BROWSER_DOCUMENT_HEADER]: proof})).json(), {status: "ready"});
    assert.equal(observed, 1);
    const descriptor = {target: attempt, agentSessionId: randomUUID(), taskId: randomUUID(), expiresAt: 50_000};
    const proofHeader = {[MANAGED_BROWSER_DOCUMENT_HEADER]: proof};
    const plans = {operation:"list", document:target};
    const planPost = (body:unknown, headers:Record<string,string> = proofHeader) =>
      post(body, headers, "", MANAGED_BROWSER_PLAN_APPROVAL_PATH);
    const chatPost = (body:unknown, headers:Record<string,string> = proofHeader) =>
      post(body, headers, "", MANAGED_BROWSER_PLAN_CHAT_PATH);
    assert.equal((await planPost(plans)).status, 404);
    assert.equal((await chatPost(plans)).status, 404);
    planEnabled = true;
    assert.equal((await planPost(plans, {...proofHeader, origin:"https://other.invalid"})).status, 403);
    assert.equal((await planPost(plans, {...proofHeader, authorization:"fixture-agent"})).status, 403);
    assert.equal((await planPost(plans, {})).status, 403);
    assert.equal((await planPost({...plans, decision:"approve"})).status, 400);
    assert.equal((await planPost({...plans, document:{...target, hostIncarnationId:randomUUID()}})).status, 403);
    assert.equal(planApprovalCalls, 0);
    const readyForPlans = await post({operation:"observe", document:target}, proofHeader);
    assert.equal(readyForPlans.headers.get("x-aisb-headless-plan-approvals"), "1");
    assert.equal(readyForPlans.headers.get("x-aisb-headless-plan-chat"), "1");
    assert.deepEqual(await (await planPost(plans)).json(), [planReference]);
    assert.equal((await chatPost(plans, {...proofHeader, authorization:"fixture-agent"})).status, 403);
    assert.equal((await chatPost(plans, {})).status, 403);
    assert.equal((await chatPost({...plans, channel:"app-popup"})).status, 400);
    assert.deepEqual(await (await chatPost(plans)).json(), [planReference]);
    assert.deepEqual(approvalChannels, ["app-popup", "authenticated-chat"]);
    const listFileClients = {operation:"list-file-clients", document:target};
    const selectFile = {operation:"select-file", document:target, file};
    const selectProviderFile = {...selectFile, operation:"select-provider-file"};
    assert.equal((await chatPost(listFileClients)).status, 403);
    assert.equal((await chatPost(selectFile)).status, 403);
    assert.equal((await chatPost(selectProviderFile)).status, 403);
    assert.equal((await planPost(selectFile, {})).status, 403);
    assert.equal((await planPost(selectFile, {...proofHeader, origin:"https://other.invalid"})).status, 403);
    assert.equal((await planPost({...selectFile, file:{...file, hostIncarnationId:target.hostIncarnationId}})).status, 400);
    assert.equal((await planPost({...selectFile, file:{...file, workspaceId:"other-workspace"}})).status, 400);
    assert.equal((await planPost({...selectFile, file:{...file, path:"synthetic.csv"}})).status, 400);
    assert.equal((await planPost({...selectProviderFile, file:{...file, path:"synthetic/private.parquet"}})).status, 400);
    assert.equal((await planPost(selectProviderFile, {})).status, 403);
    assert.equal(fileSelectionCalls, 0);
    assert.equal((await planPost({...selectFile, file:{...file, registeredClientId:randomUUID()}})).status, 403);
    assert.deepEqual(await (await planPost(listFileClients)).json(), [file.registeredClientId]);
    assert.deepEqual(await (await planPost(selectFile)).json(), fileReceipt);
    assert.deepEqual(await (await planPost(selectProviderFile)).json(), fileReceipt);
    stableFileRead = false;
    assert.equal((await planPost(selectFile)).status, 403);
    assert.equal((await planPost(selectProviderFile)).status, 403);
    stableFileRead = true;
    const openFilePlan = {operation:"open",document:target,selection:filePlanSelection};
    const decideFilePlan = {operation:"decide",document:target,decision:{selection:filePlanSelection,viewId:filePlanView.viewId,
      expectedRevision:1,decision:{kind:"approve",mode:"whole-plan"}}};
    enableFilePlanPublication = false;
    assert.equal((await planPost(openFilePlan)).status,503);
    enableFilePlanPublication = true;
    for (const [input, expected] of [[openFilePlan,filePlanView],[decideFilePlan,filePlanDecision]] as const) {
      assert.deepEqual(await (await planPost(input)).json(),expected);
      const hold = {entered:Promise.withResolvers<void>(),release:Promise.withResolvers<void>()};
      filePlanHold = hold;
      const pending = planPost(input);
      await hold.entered.promise;
      hasFilePlanAccess = false;
      hold.release.resolve();
      const denied = await pending;
      assert.equal(denied.status,403);
      assert.deepEqual(await denied.json(),{error:"headless.browser-consent-unavailable"});
      filePlanHold = undefined;
      hasFilePlanAccess = true;
    }
    planReplyCurrent = false;
    assert.equal((await planPost(selectFile)).status, 403);
    const retiredPlanReply = await planPost(plans);
    assert.equal(retiredPlanReply.status, 403);
    assert.equal(JSON.stringify(await retiredPlanReply.json()).includes(planReference.fingerprint), false);
    assert.equal((await post({operation: "revoke", document: target, target: attempt}, proofHeader, "", MANAGED_BROWSER_OBSERVE_PATH)).status, 400);
    const pull = {operation:"pull",document:target,input:{target:grant.target,sequence:1}};
    assert.equal((await post(pull,proofHeader,"",MANAGED_BROWSER_DELIVERY_PATH)).status,404);
    const off = await post({operation:"observe", document:target}, proofHeader);
    assert.equal(off.headers.get("x-aisb-headless-presentation"),null);
    deliveryEnabled = true;
    const on = await post({operation:"observe", document:target}, proofHeader);
    assert.equal(on.headers.get("x-aisb-headless-presentation"),"1");
    assert.equal((await post(pull,proofHeader,"",MANAGED_BROWSER_CONTEXT_PATH)).status,400);
    assert.equal((await post(pull,{},"",MANAGED_BROWSER_DELIVERY_PATH)).status,403);
    assert.equal((await post({...pull,input:{...pull.input,target:{...grant.target,uiIncarnationId:randomUUID()}}},proofHeader,"",MANAGED_BROWSER_DELIVERY_PATH)).status,400);
    assert.deepEqual(await (await post(pull,proofHeader,"",MANAGED_BROWSER_DELIVERY_PATH)).json(),pullResult);
    const challengeRequest = {operation:"challenge",document:target,input:{target:grant.target}};
    deliveryCurrent = false;
    for (const [request, path] of [[pull, MANAGED_BROWSER_DELIVERY_PATH], [challengeRequest, MANAGED_BROWSER_CONTEXT_PATH]] as const) {
      const response = await post(request, proofHeader, "", path);
      assert.equal(response.status, 403);
      assert.deepEqual(await response.json(), {error:"headless.browser-consent-unavailable"});
    }
    deliveryCurrent = true;
    pullResult = {status:"command",command:{...command,target:{...grant.target,generation:2}},detail:{title:"Foreign metadata"}};
    assert.equal((await post(pull,proofHeader,"",MANAGED_BROWSER_DELIVERY_PATH)).status,503);
    assert.deepEqual(await (await post(challengeRequest,proofHeader,"",MANAGED_BROWSER_CONTEXT_PATH)).json(),{challenge});
    const ack = {operation:"acknowledge",document:target,input:{target:grant.target,
      receipt:{commandId:command.commandId,sequence:1,status:"applied"}}};
    const publish = {operation:"publish",document:target,input:{target:grant.target, challenge,
      context:{view:"other",ready:true,dirtyNavigationBlocked:false}}};
    assert.equal((await post(ack,proofHeader,"",MANAGED_BROWSER_DELIVERY_PATH)).status,400);
    assert.equal((await post(publish,proofHeader,"",MANAGED_BROWSER_CONTEXT_PATH)).status,400);
    assert.equal((await post(ack,proofHeader,"",MANAGED_BROWSER_ACKNOWLEDGE_PATH)).status,200);
    assert.equal((await post(publish,proofHeader,"",MANAGED_BROWSER_PUBLISH_CONTEXT_PATH)).status,200);
    assert.equal((await post({...challengeRequest,input:{...challengeRequest.input,untrusted:"x".repeat(8_193)}},proofHeader,"",MANAGED_BROWSER_CONTEXT_PATH)).status,413);
    observeReply = {status: "ready", request: {...descriptor, status: "pending", target: {...attempt, windowId: randomUUID()}}};
    assert.equal((await post({operation: "observe", document: target}, proofHeader)).status, 503);
    observeReply = {status: "ready", request: {...descriptor, status: "active"}, lease: grant, contextChallenge: randomUUID()};
    assert.equal((await post({operation: "observe", document: target}, proofHeader)).status, 503);
    observeReply = {status: "ready", request: {...descriptor, status: "active"}, lease: grant};
    assert.equal((await post({operation: "observe", document: target}, proofHeader)).status, 200);
    consentReply = {...grant, target: {...grant.target, attemptId: randomUUID()}};
    assert.equal((await post({operation: "accept", document: target, target: attempt}, proofHeader)).status, 503);
    consentReply = {...grant, target: {...grant.target, generation: grant.target.generation + 1}};
    assert.equal((await post({operation: "ready", document: target, target: grant.target}, proofHeader)).status, 503);
    consentReply = grant;
    assert.deepEqual(await (await post({operation: "ready", document: target, target: grant.target}, proofHeader)).json(), grant);
    consentReply = undefined;
    const stale = post({operation: "accept", document: target, target: attempt}, {[MANAGED_BROWSER_DOCUMENT_HEADER]: proof});
    await entered.promise;
    admitted = false;
    release.resolve();
    assert.equal((await stale).status, 403);
    assert.equal(registrationRetired, false);
    admitted = true;
    assert.deepEqual(await (await post({operation: "disconnect", document: target}, {[MANAGED_BROWSER_DOCUMENT_HEADER]: proof})).json(), {ok: true});
    assert.equal(registrationRetired, true);
    retire();
    assert.equal((await post(register)).status, 404);
  } finally { filePlanHold?.release.resolve(); release.resolve(); retire(); server.close(); await once(server, "close"); }
});
