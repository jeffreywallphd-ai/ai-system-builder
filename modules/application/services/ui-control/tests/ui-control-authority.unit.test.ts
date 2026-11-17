import assert from "node:assert/strict";
import { test } from "node:test";
import { createOrganizationId } from "../../../../contracts/organization";
import { isHeadlessHostIncarnationId, UI_CONTROL_VERSION } from "../../../../contracts/headless";
import { createWorkspaceId } from "../../../../contracts/workspace";
import {
  createUiControlAuthority, UI_CONTROL_AUTHORITY_LIMITS as limits,
  type UiControlAgent, type UiControlDecision, type UiControlInteractiveOwner,
} from "../ui-control-authority.service";

const id = (index: number) => `e38b2781-e605-4de3-83e1-${String(index).padStart(12, "0")}`;
const hostIncarnationId = (() => {
  const value = id(1);
  assert.ok(isHeadlessHostIncarnationId(value));
  return value;
})();
const actor = { organizationId: createOrganizationId("fixture-org"), principalId: "fixture-member" };
const workspaceId = createWorkspaceId("fixture-workspace");
const target = { hostIncarnationId, workspaceId, windowId: id(2), uiIncarnationId: id(3) };
const other = { ...target, windowId: id(4), uiIncarnationId: id(5) };
const input = (task: number, window = target) => ({
  version: UI_CONTROL_VERSION, target: window, taskId: id(task), requestKey: id(task + 1000),
});
const expectOk = <T>(result: UiControlDecision<T>): T => {
  assert.ok(result.status === "ok", "Expected an allowed exact presentation operation.");
  return result.value;
};

function fixture() {
  let now = 4000;
  let nextId = 5000;
  let authorize = async (): Promise<boolean> => true;
  let interactiveCurrent = true;
  let agentCurrent = true;
  const owner: UiControlInteractiveOwner = { ...actor, isCurrent: () => interactiveCurrent };
  const otherOwner = { ...actor, isCurrent: () => true };
  const agent: UiControlAgent = { ...actor, registeredClientId: id(12), agentSessionId: id(14), isCurrent: () => agentCurrent };
  const otherAgent: UiControlAgent = { ...agent, registeredClientId: id(13) };
  const authority = createUiControlAuthority({ hostIncarnationId, now: () => now, issueId: () => id(nextId++),
    authorize: () => authorize(),
  });
  assert.equal(authority.registerWindow(target, owner), true);
  return { authority, owner, otherOwner, agent, otherAgent,
    elapse: (ms: number) => { now += ms; },
    authorize: (check: () => Promise<boolean>) => { authorize = check; },
    detach: () => { interactiveCurrent = false; },
    removeAgent: () => { agentCurrent = false; },
  };
}

test("only the current interactive owner can reserve and activate an exact displayed request", async () => {
  const { authority, owner, otherOwner, agent, otherAgent } = fixture();
  const pending = expectOk(await authority.request(input(20), agent));
  assert.equal(pending.status, "pending");
  assert.deepEqual(authority.readPending(target, owner), pending);
  assert.equal(authority.readPending(target, otherOwner), undefined);
  assert.equal((await authority.accept(pending.target, agent)).status, "denied");
  assert.equal((await authority.accept(pending.target, otherOwner)).status, "denied");
  assert.equal((await authority.accept({ ...pending.target, uiIncarnationId: other.uiIncarnationId }, owner)).status, "denied");
  const [a, b] = await Promise.all([authority.accept(pending.target, owner), authority.accept(pending.target, owner)]);
  assert.deepEqual(expectOk(a), expectOk(b));
  const granted = expectOk(a);
  assert.equal(authority.readPending(target, owner)?.status, "awaiting-readiness");
  assert.equal((await authority.request(input(21), otherAgent)).status, "busy");
  assert.equal((await authority.ready({ ...granted.target, generation: granted.target.generation + 1 }, owner)).status, "denied");
  assert.equal((await authority.ready(granted.target, otherOwner)).status, "denied");
  assert.deepEqual(expectOk(await authority.ready(granted.target, owner)).target, granted.target);
  assert.equal(authority.readPending(target, owner)?.status, "active");
  assert.equal((await authority.agentStatus(pending.target, otherAgent)).status, "denied");
  assert.equal((await authority.request(input(20), { ...agent, organizationId: createOrganizationId("other-org") })).status, "denied");
});

test("cancel during authorization invalidates old accept and only the exact attempt is ended", async () => {
  const { authority, owner, agent, authorize } = fixture();
  const first = expectOk(await authority.request(input(20), agent));
  let resolve!: (allowed: boolean) => void;
  authorize(() => new Promise(value => { resolve = value; }));
  const delayed = authority.accept(first.target, owner);
  assert.equal(authority.revoke({ ...first.target, leaseId: id(19) }, owner).status, "denied");
  expectOk(authority.revoke(first.target, owner));
  resolve(true);
  assert.equal((await delayed).status, "ended");
  authorize(async () => true);
  assert.equal((await authority.request(input(20), agent)).status, "ended");
  assert.equal((await authority.request({ ...input(21), requestKey: input(20).requestKey }, agent)).status, "denied");
  const second = expectOk(await authority.request(input(21), agent));
  const newLease = expectOk(await authority.accept(second.target, owner));
  expectOk(await authority.ready(newLease.target, owner));
  expectOk(authority.revoke(first.target, owner));
  assert.equal(authority.readPending(target, owner)?.status, "active");
  assert.equal((await authority.accept(first.target, owner)).status, "ended");
});

test("delayed readiness, old full revoke, other windows, reload and liveness are isolated", async () => {
  const { authority, owner, otherOwner, agent, otherAgent, authorize, elapse, detach } = fixture();
  assert.equal(authority.registerWindow(other, otherOwner), true);
  const first = expectOk(await authority.request(input(20), agent));
  assert.equal((await authority.request(input(20, other), agent)).status, "denied");
  const originalLease = expectOk(await authority.accept(first.target, owner));
  let unblock!: () => void;
  authorize(() => new Promise(resolve => { unblock = () => resolve(true); }));
  const delayed = authority.ready(originalLease.target, owner);
  expectOk(authority.revoke(originalLease.target, owner));
  unblock();
  assert.equal((await delayed).status, "ended");
  authorize(async () => true);
  const second = expectOk(await authority.request(input(21), agent));
  const secondGrant = expectOk(await authority.accept(second.target, owner));
  const independent = expectOk(await authority.request(input(22, other), otherAgent));
  const otherGrant = expectOk(await authority.accept(independent.target, otherOwner));
  expectOk(await authority.ready(secondGrant.target, owner));
  expectOk(await authority.ready(otherGrant.target, otherOwner));
  expectOk(authority.revoke(originalLease.target, owner));
  assert.equal(authority.readPending(target, owner)?.status, "active");
  detach();
  assert.equal(authority.readPending(target, owner), undefined);
  assert.equal(authority.readPending(other, otherOwner)?.status, "active");
  const reloaded = { ...target, uiIncarnationId: id(77) };
  assert.equal(authority.registerWindow(reloaded, otherOwner), true);
  assert.equal((await authority.request(input(20, reloaded), agent)).status, "denied");
  assert.equal((await authority.ready(secondGrant.target, owner)).status, "denied");
  elapse(limits.leaseMs + 1);
  assert.equal((await authority.agentStatus(otherGrant.target, otherAgent, true)).status, "ended");
  assert.equal(authority.readPending(other, otherOwner), undefined);
});

test("policy failure, elapsed readiness and host stop fail closed", async () => {
  const { authority, owner, agent, authorize, elapse } = fixture();
  const pending = expectOk(await authority.request(input(20), agent));
  const lease = expectOk(await authority.accept(pending.target, owner));
  elapse(limits.readinessMs + 1);
  assert.equal((await authority.ready(lease.target, owner)).status, "ended");
  const second = expectOk(await authority.request(input(21), agent));
  authorize(async () => { throw new Error("private backend failure"); });
  assert.deepEqual(await authority.accept(second.target, owner), { status: "denied" });
  assert.equal(authority.readPending(target, owner), undefined);
  authority.close();
  assert.equal((await authority.request(input(22), agent)).status, "denied");
  assert.equal(authority.registerWindow(target, owner), false);
});

test("caps in-flight policy reads and retains exact terminal references for bounded retry", async () => {
  const { authority, owner, agent, authorize, elapse } = fixture();
  const first = expectOk(await authority.request(input(20), agent));
  const grant = expectOk(await authority.accept(first.target, owner));
  expectOk(await authority.ready(grant.target, owner));
  const resolvers: Array<(allowed: boolean) => void> = [];
  authorize(() => new Promise(resolve => { resolvers.push(resolve); }));
  const queries = Array.from({ length: limits.policyReads }, () => authority.agentStatus(first.target, agent));
  assert.equal(resolvers.length, limits.policyReads);
  assert.equal((await authority.agentStatus(first.target, agent)).status, "busy");
  assert.equal(authority.readPending(target, owner)?.status, "active");
  expectOk(authority.revoke(grant.target, owner));
  resolvers.forEach(resolve => resolve(true));
  for (const query of queries) assert.equal((await query).status, "ended");
  expectOk(authority.revoke(grant.target, owner));
  elapse(limits.retryMs);
  assert.equal(authority.revoke(grant.target, owner).status, "denied");
});

test("a held request keeps its terminal retry outcome after the retention period", async () => {
  const { authority, owner, agent, authorize, elapse } = fixture();
  const requested = expectOk(await authority.request(input(20), agent));
  expectOk(authority.revoke(requested.target, owner));
  let unblock!: () => void;
  authorize(() => new Promise(resolve => { unblock = () => resolve(true); }));
  const retry = authority.request(input(20), agent);
  elapse(limits.retryMs);
  assert.equal(authority.readPending(target, owner), undefined);
  unblock();
  assert.equal((await retry).status, "ended");
  assert.equal(authority.readPending(target, owner), undefined);
});

test("a held first submission cannot allocate after the same request was admitted and retired", async () => {
  const { authority, owner, agent, authorize, elapse } = fixture();
  let unblock!: () => void;
  authorize(() => new Promise(resolve => { unblock = () => resolve(true); }));
  const original = authority.request(input(20), agent);
  authorize(async () => true);
  const concurrent = expectOk(await authority.request(input(20), agent));
  expectOk(authority.revoke(concurrent.target, owner));
  elapse(limits.retryMs);
  assert.equal(authority.readPending(target, owner), undefined);
  unblock();
  assert.equal((await original).status, "unavailable");
  assert.equal(authority.readPending(target, owner), undefined);
});
