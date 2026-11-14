import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import test from "node:test";

import {createUiControlAuthority} from "../../../../application/services/ui-control/ui-control-authority.service";
import {UI_CONTROL_VERSION, type HeadlessHostIncarnationId} from "../../../../contracts/headless";
import {createOrganizationId} from "../../../../contracts/organization";
import {createWorkspaceId} from "../../../../contracts/workspace";
import {createManagedHeadlessBrowserDocuments} from "../createManagedHeadlessBrowserDocuments";

test("browser control consent requires the same live document even when two tabs share a browser credential", async () => {
  const hostIncarnationId = randomUUID() as HeadlessHostIncarnationId;
  const workspaceId = createWorkspaceId("fixture-workspace");
  let clock = 5_000;
  let permitted = true;
  let credential = true;
  let policyReads = 0;
  const organizationId = createOrganizationId("fixture-org");
  const originalBinding = {sameCredential(other: unknown) { return other === originalBinding; }};
  const differentBinding = {sameCredential(other: unknown) { return other === differentBinding; }};
  const browser = {purpose: "browser" as const, organizationId, principalId: "fixture-user",
    registeredClientId: randomUUID(), credentialBinding: originalBinding, isCurrent: () => credential};
  const agent = {organizationId, principalId: browser.principalId, registeredClientId: randomUUID(),
    agentSessionId: randomUUID(), isCurrent: () => true};
  const authority = createUiControlAuthority({hostIncarnationId, now: () => clock,
    issueId: randomUUID, authorize: async () => permitted});
  let hold = false;
  const entered = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const documents = createManagedHeadlessBrowserDocuments({
    hostIncarnationId,
    now: () => clock,
    register: authority.registerWindow,
    retire: authority.retireWindow,
    async authorize(owner, target) {
      policyReads++;
      if (hold) {entered.resolve(); await release.promise;}
      return permitted && owner.organizationId === organizationId && target === workspaceId;
    },
  });
  try {
    assert.equal(await documents.register({...browser, purpose: "agent" as "browser"}, workspaceId), undefined);
    const first = await documents.register(browser, workspaceId);
    const second = await documents.register(browser, workspaceId);
    assert.ok(first && "target" in first && second && "target" in second && first.proof !== second.proof);
    const sameClientWithDifferentToken = {...browser, credentialBinding: differentBinding, isCurrent: () => true};
    const observedPolicyReads = policyReads;
    assert.equal(await documents.authenticate(sameClientWithDifferentToken, first.target, first.proof), undefined);
    assert.equal(documents.retire(sameClientWithDifferentToken, first.target, first.proof), false);
    assert.equal(policyReads, observedPolicyReads);
    const request = await authority.request({version: UI_CONTROL_VERSION, target: first.target, taskId: randomUUID(), requestKey: randomUUID()}, agent);
    assert.equal(request.status, "ok");
    if (request.status !== "ok") return;
    for (const denied of [
      documents.authenticate(browser, first.target, second.proof),
      documents.authenticate(browser, second.target, first.proof),
      documents.authenticate({...browser, principalId: "different-user"}, first.target, first.proof),
      documents.authenticate({...browser, organizationId: createOrganizationId("different-org")}, first.target, first.proof),
      documents.authenticate({...browser, registeredClientId: randomUUID()}, first.target, first.proof),
      documents.authenticate(browser, {...first.target, hostIncarnationId: randomUUID()}, first.proof),
      documents.authenticate(browser, {...first.target, workspaceId: createWorkspaceId("different-workspace")}, first.proof),
    ]) assert.equal(await denied, undefined);
    const ownership = await documents.authenticate(browser, first.target, first.proof);
    const other = await documents.authenticate(browser, second.target, second.proof);
    assert.ok(ownership && other);
    assert.equal((await authority.accept(request.value.target, other.owner)).status, "denied");
    const accepted = await authority.accept(request.value.target, ownership.owner);
    assert.equal(accepted.status, "ok");
    if (accepted.status !== "ok") return;
    assert.equal((await authority.ready(accepted.value.target, ownership.owner)).status, "ok");
    assert.equal(ownership.isCurrent(), true);
    assert.equal(documents.retire(browser, first.target, second.proof), false);
    assert.equal(documents.retire(browser, first.target, first.proof), true);
    assert.equal(ownership.isCurrent(), false);
    assert.equal(authority.readAgentLease(accepted.value.target, agent), undefined);
    assert.equal(other.isCurrent(), true);

    hold = true;
    const pending = documents.authenticate(browser, second.target, second.proof);
    await entered.promise;
    clock += 12_000;
    release.resolve();
    assert.equal(await pending, undefined);
    assert.equal(other.isCurrent(), false);
    hold = false;
    const replacement = await documents.register(browser, workspaceId);
    assert.ok(replacement && "target" in replacement);
    assert.notEqual(replacement.target.uiIncarnationId, second.target.uiIncarnationId);
    permitted = false;
    assert.equal(await documents.authenticate(browser, replacement.target, replacement.proof), undefined);
    credential = false;
    assert.equal(await documents.register(browser, workspaceId), undefined);
  } finally {
    release.resolve();
    documents.close();
    authority.close();
  }
});

test("real document slots become available again without changing the browser credential", async () => {
  const hostIncarnationId = randomUUID() as HeadlessHostIncarnationId;
  const organizationId = createOrganizationId("fixture-org");
  const workspaceId = createWorkspaceId("fixture-workspace");
  const binding = {sameCredential(other: unknown) { return binding === other; }};
  const browser = {purpose: "browser" as const, organizationId, principalId: "fixture-user",
    registeredClientId: randomUUID(), credentialBinding: binding, isCurrent: () => true};
  const documents = createManagedHeadlessBrowserDocuments({hostIncarnationId, now: () => 5_000,
    authorize: async () => true, register: () => true, retire: () => true});
  try {
    const first = await documents.register(browser, workspaceId);
    assert.ok(first && "target" in first);
    for (let index = 1; index < 32; index++) {
      const tab = await documents.register(browser, workspaceId);
      assert.ok(tab && "target" in tab);
    }
    assert.deepEqual(await documents.register(browser, workspaceId), {status: "busy"});
    assert.equal(documents.retire(browser, first.target, first.proof), true);
    const retried = await documents.register(browser, workspaceId);
    assert.ok(retried && "target" in retried);
    assert.ok(await documents.authenticate(browser, retried.target, retried.proof));
  } finally {documents.close();}
});
