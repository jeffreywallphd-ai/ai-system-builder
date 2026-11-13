import assert from "node:assert/strict";
import { test } from "node:test";
import {
  HEADLESS_CONTRACT_VERSION,
  HEADLESS_READ_OPERATIONS,
  isHeadlessHostIncarnationId,
  parseHeadlessReadRequest,
} from "../index";

const host = "914adbca-10b9-4033-85af-7ba9011180a1";
const previousHost = "b78003cb-a4c0-4982-886b-c219c511b3f2";
assert.ok(isHeadlessHostIncarnationId(host));
const version = HEADLESS_CONTRACT_VERSION;
const scope = { hostIncarnationId: host, workspaceId: "workspace-1" };
const target = { ...scope, systemId: "system-1" };
const invalid = { ok: false, code: "headless.invalid-request" };
const stale = { ok: false, code: "headless.host-changed" };

test("accepts only the declared finite read inputs and returns a detached request", () => {
  const inputs = {
    "host.describe": {},
    "workspaces.list": { hostIncarnationId: host },
    "systems.list": scope,
    "systems.read": target,
    "templates.list": scope,
  };
  assert.deepEqual([...HEADLESS_READ_OPERATIONS].sort(), Object.keys(inputs).sort());
  for (const operation of HEADLESS_READ_OPERATIONS) {
    const original = { version, operation, input: { ...inputs[operation] } };
    const result = parseHeadlessReadRequest(original, host);
    assert.deepEqual(result, { ok: true, request: original });
    if (result.ok) {
      assert.notStrictEqual(result.request, original);
      assert.notStrictEqual(result.request.input, original.input);
    }
  }
});

test("denies capability expansion, identity spoofing and incomplete resource targets", () => {
  const envelope = { version, operation: "systems.read", input: target };
  assert.deepEqual(parseHeadlessReadRequest({ ...envelope, principalId: "local" }, host), invalid);
  for (const extra of ["organizationId", "principalId", "clientId", "token", "uiLeaseId", "activeWorkspace"]) {
    assert.deepEqual(parseHeadlessReadRequest({ ...envelope, input: { ...target, [extra]: "value" } }, host), invalid);
  }
  for (const input of [scope, {}, [], null, { ...target, workspaceId: "." }, { ...target, systemId: ["system-1"] },
    { ...target, systemId: "x".repeat(97) }]) {
    assert.deepEqual(parseHeadlessReadRequest({ ...envelope, input }, host), invalid);
  }
  assert.deepEqual(parseHeadlessReadRequest({ ...envelope, version: "later-version" }, host), {
    ok: false, code: "headless.unsupported-version",
  });
  for (const operation of ["systems.run", "systems.publish", "tasks.cancel", "ui.accept", "http.execute", "shell", "toString"]) {
    assert.deepEqual(parseHeadlessReadRequest({ ...envelope, operation }, host), {
      ok: false, code: "headless.unsupported-operation",
    });
  }
});

test("requires the exact current host and returns only fixed error codes", () => {
  assert.deepEqual(parseHeadlessReadRequest({
    version, operation: "templates.list", input: { ...scope, hostIncarnationId: previousHost },
  }, host), stale);
  for (const hostIncarnationId of ["", host.toUpperCase(), host + "\n", "4b6ca55e-6a24-1230-b9e9-09a51141e35a"]) {
    assert.deepEqual(parseHeadlessReadRequest({
      version, operation: "workspaces.list", input: { hostIncarnationId },
    }, host), invalid);
  }
  assert.deepEqual(parseHeadlessReadRequest({ version, operation: "host.describe", input: scope }, host), invalid);
});

test("rejects non-data records without evaluating properties or reflecting values", () => {
  let read = false;
  const input = {
    ...target,
    get systemId() { read = true; return "system-1"; },
  };
  const envelope = { version, operation: "systems.read", input };
  assert.deepEqual(parseHeadlessReadRequest(envelope, host), invalid);
  assert.equal(read, false);
  assert.deepEqual(parseHeadlessReadRequest({ ...envelope, input: Object.create(target) }, host), invalid);
  const extra = { ...target, [Symbol("hidden")]: true };
  assert.deepEqual(parseHeadlessReadRequest({ ...envelope, input: extra }, host), invalid);
  const revoked = Proxy.revocable(target, {});
  revoked.revoke();
  assert.deepEqual(parseHeadlessReadRequest({ ...envelope, input: revoked.proxy }, host), invalid);
});
