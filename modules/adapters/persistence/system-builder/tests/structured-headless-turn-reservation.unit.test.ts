import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { HeadlessApprovedConversationDispatchUseCase } from "../../../../application/use-cases/system-run-workflow/headless-approved-conversation-dispatch.use-case";
import { createOrganizationId } from "../../../../contracts/organization";
import { createWorkspaceId } from "../../../../contracts/workspace";
import { createInMemoryStructuredDocumentStore } from "../../shared";
import { openLocalSqliteDatabase, resolveLocalSqliteDatabasePolicy } from "../../sqlite";
import { createStructuredHeadlessTurnReservation } from "../createStructuredHeadlessTurnReservation";
import { HEADLESS_RECEIPT_TTL_MS } from "../createStructuredHeadlessOperationStore";

const scope = {
  organizationId: createOrganizationId("fixture-org"), workspaceId: createWorkspaceId("fixture-workspace"), principalId: "fixture-actor",
  registeredClientId: "69df3242-d9ce-4249-8f34-3c44f7a97889",
};
const request = {
  workspaceId: scope.workspaceId, planId: "fixture.plan", planRevision: "2026-11-13T10:00:00Z",
  sessionId: "fixture.session", snapshotRevision: "fixture.snapshot.1",
  key: "67dd00fa-c443-4b7f-8d12-f03c787a36dc", text: "Private synthetic conversation input",
};
const reference = { turnId: "fixture.turn", runId: "fixture.run" };

test("reserves once across concurrent callers, persists only the handle, and replays after reconstruction", async () => {
  const documents = createInMemoryStructuredDocumentStore();
  let invoked = 0;
  let allowed = true;
  let started!: () => void;
  let finish!: () => void;
  const entered = new Promise<void>(resolve => { started = resolve; });
  const held = new Promise<void>(resolve => { finish = resolve; });
  const make = () => new HeadlessApprovedConversationDispatchUseCase({
    reservations: createStructuredHeadlessTurnReservation({ documents, authorize: async () => allowed }),
    fingerprint: input => createHmac("sha256", "synthetic-key").update(input).digest("hex"),
    async submit({ workspaceId, conversationSessionId, operationId }) {
      invoked++;
      assert.equal(workspaceId, request.workspaceId);
      assert.equal(conversationSessionId, request.sessionId);
      assert.match(operationId, /^headless\.[a-f0-9]{64}$/);
      started();
      await held;
      return { kind: "success", value: { conversationTurnId: reference.turnId, executionRunId: reference.runId, assistantResponseText: "private" } };
    },
  });
  const grant = { scope, isCurrent: () => allowed, canObserve: async () => allowed, canDispatch: async () => allowed };
  const first = make().execute(request, grant);
  await entered;
  assert.deepEqual(await make().execute(request, grant), { kind: "unconfirmed" });
  assert.deepEqual(await make().execute({ ...request, text: "Changed input" }, grant), { kind: "conflict" });
  finish();
  assert.deepEqual(await first, { kind: "observed", reference });
  assert.deepEqual(await make().execute(request, { ...grant, canDispatch: async () => assert.fail("Replay cannot dispatch") }),
    { kind: "observed", reference });
  const store = documents.forOrganization(scope.organizationId);
  for (const name of await store.listNamespaces()) {
    const serialized = JSON.stringify(await store.listDocuments(name));
    assert.equal(serialized.includes(request.text) || serialized.includes("assistantResponseText"), false);
  }
  allowed = false;
  assert.deepEqual(await make().execute(request, grant), { kind: "denied" });
  assert.equal(invoked, 1);
});

test("an owned invocation returns and replays its durable handle while the runtime is still running", async () => {
  const documents = createInMemoryStructuredDocumentStore();
  let release!: () => void;
  const waitForRuntime = new Promise<void>(resolve => { release = resolve; });
  let task: Promise<void> | undefined;
  let calls = 0;
  const make = () => new HeadlessApprovedConversationDispatchUseCase({
    reservations: createStructuredHeadlessTurnReservation({ documents, authorize: async () => true }),
    fingerprint: input => createHmac("sha256", "synthetic-key").update(input).digest("hex"),
    runOwned(work) { task = work(); return true; },
    async submit(_command, authority) {
      calls++;
      assert.equal(await authority.onAdmitted?.(reference), true);
      await waitForRuntime;
      return { kind: "success", value: { conversationTurnId: reference.turnId, executionRunId: reference.runId } };
    },
  });
  const grant = { scope, isCurrent: () => true, canObserve: async () => true, canDispatch: async () => true };
  try {
    const expected = { kind: "observed", reference };
    assert.deepEqual(await make().execute(request, grant), expected);
    assert.deepEqual(await make().execute(request, grant), expected);
    assert.equal(calls, 1);
  } finally { release(); await task; }
});

test("the owned path refuses a saved handle if authority closes before it can be returned", async () => {
  const documents = createInMemoryStructuredDocumentStore();
  let current = true;
  let starts = 0;
  let task: Promise<void> | undefined;
  const useCase = new HeadlessApprovedConversationDispatchUseCase({
    reservations: createStructuredHeadlessTurnReservation({ documents, authorize: async () => true }),
    fingerprint: input => createHmac("sha256", "synthetic-key").update(input).digest("hex"),
    runOwned(work) { task = work(); return true; },
    async submit(_command, authority) {
      current = false;
      if (await authority.onAdmitted?.(reference)) starts++;
    },
  });
  const grant = { scope, isCurrent: () => current, canObserve: async () => current, canDispatch: async () => current };
  assert.deepEqual(await useCase.execute(request, grant), { kind: "unconfirmed" });
  await task;
  assert.equal(starts, 0);
  assert.deepEqual(await useCase.execute(request, grant), { kind: "denied" });
});

test("refused scheduling and an escaped callback cannot admit a delegated task", async () => {
  const documents = createInMemoryStructuredDocumentStore();
  let delayed: (() => Promise<void>) | undefined;
  let escaped: ((value: typeof reference) => Promise<boolean>) | undefined;
  let calls = 0;
  const reservations = createStructuredHeadlessTurnReservation({ documents, authorize: async () => true });
  let confirmations = 0;
  const run = (runOwned: (task: () => Promise<void>) => boolean) => new HeadlessApprovedConversationDispatchUseCase({
    reservations: { ...reservations, async confirm(input) { confirmations++; return reservations.confirm(input); } },
    fingerprint: input => createHmac("sha256", "synthetic-key").update(input).digest("hex"),
    runOwned,
    async submit(_command, { onAdmitted }) { calls++; escaped = onAdmitted; },
  });
  const grant = { scope, isCurrent: () => true, canObserve: async () => true, canDispatch: async () => true };
  assert.deepEqual(await run(work => { delayed = work; return false; }).execute(request, grant), { kind: "unconfirmed" });
  assert.ok(delayed);
  await delayed();
  assert.equal(calls, 0);
  let accepted: Promise<void> | undefined;
  const newRequest = { ...request, key: "07dd00fa-c443-4b7f-8d12-f03c787a36dc" };
  assert.deepEqual(await run(work => { accepted = work(); return true; }).execute(newRequest, grant), { kind: "unconfirmed" });
  await accepted;
  assert.equal(calls, 1);
  assert.ok(escaped);
  assert.equal(await escaped(reference), false);
  assert.equal(confirmations, 0);
});

test("an uncertain persisted reservation does not start again, including after receipt expiry", async () => {
  const documents = createInMemoryStructuredDocumentStore();
  let clock = 1000;
  let submitted = 0;
  const make = () => new HeadlessApprovedConversationDispatchUseCase({
    reservations: createStructuredHeadlessTurnReservation({ documents, authorize: async () => true, now: () => clock }),
    fingerprint: input => createHmac("sha256", "synthetic-key").update(input).digest("hex"),
    async submit() { submitted++; throw new Error("Private runtime failure detail"); },
  });
  const grant = { scope, isCurrent: () => true, canObserve: async () => true, canDispatch: async () => true };
  assert.deepEqual(await make().execute(request, grant), { kind: "unconfirmed" });
  assert.deepEqual(await make().execute(request, grant), { kind: "unconfirmed" });
  clock += HEADLESS_RECEIPT_TTL_MS;
  assert.deepEqual(await make().execute(request, grant), { kind: "expired" });
  assert.equal(submitted, 1);
});

test("an observer cannot use a fresh dispatch key or its capacity", async () => {
  const documents = createInMemoryStructuredDocumentStore();
  let submitted = 0;
  const useCase = new HeadlessApprovedConversationDispatchUseCase({
    reservations: createStructuredHeadlessTurnReservation({ documents, authorize: async () => true }),
    fingerprint: input => createHmac("sha256", "synthetic-key").update(input).digest("hex"),
    async submit() {
      submitted++;
      return { kind: "success", value: { conversationTurnId: reference.turnId, executionRunId: reference.runId } };
    },
  });
  const grant = { scope, isCurrent: () => true, canObserve: async () => true, canDispatch: async () => false };
  assert.deepEqual(await useCase.execute(request, grant), { kind: "denied" });
  assert.deepEqual(await documents.forOrganization(scope.organizationId).listNamespaces(), []);
  assert.equal(submitted, 0);
  assert.deepEqual(await useCase.execute(request, { ...grant, canDispatch: async () => true }), { kind: "observed", reference });
  let replayChecks = 0;
  assert.deepEqual(await useCase.execute(request, {
    ...grant, async canDispatch() { replayChecks++; return false; },
  }), { kind: "observed", reference });
  assert.equal(replayChecks, 0);
  assert.equal(submitted, 1);
});

test("trusted submit receives the detached exact prepared target and a live fence", async () => {
  const documents = createInMemoryStructuredDocumentStore();
  const mutable = { ...request };
  let captured: unknown;
  let live = true;
  const useCase = new HeadlessApprovedConversationDispatchUseCase({
    reservations: createStructuredHeadlessTurnReservation({ documents, authorize: async () => true }),
    fingerprint: input => createHmac("sha256", "synthetic-key").update(input).digest("hex"),
    async submit(_command, authority) {
      captured = authority?.target;
      assert.equal(authority.isCurrent(), true);
      live = false;
      assert.equal(authority.isCurrent(), false);
      return { kind: "success", value: { conversationTurnId: reference.turnId, executionRunId: reference.runId } };
    },
  });
  assert.deepEqual(await useCase.execute(mutable, {
    scope, isCurrent: () => live, canObserve: async () => true,
    async canDispatch() {
      mutable.planRevision = "changed";
      mutable.snapshotRevision = "changed";
      return true;
    },
  }), { kind: "unconfirmed" });
  assert.deepEqual(captured, {
    workspaceId: request.workspaceId, planId: request.planId, planRevision: request.planRevision,
    sessionId: request.sessionId, snapshotRevision: request.snapshotRevision,
  });
  assert.equal(Object.isFrozen(captured), true);
});

test("a grant revoked between awaited policy and the submit call cannot dispatch", async () => {
  const documents = createInMemoryStructuredDocumentStore();
  let live = true;
  let dispatched = 0;
  let dispatchChecks = 0;
  let revokeAfterCheck = false;
  const useCase = new HeadlessApprovedConversationDispatchUseCase({
    reservations: createStructuredHeadlessTurnReservation({ documents, authorize: async () => true }),
    fingerprint: input => createHmac("sha256", "synthetic-key").update(input).digest("hex"),
    async submit() { dispatched++; throw new Error("The dispatch must not start."); },
  });
  assert.deepEqual(await useCase.execute(request, {
    scope, canObserve: async () => true,
    canDispatch: async () => { revokeAfterCheck = ++dispatchChecks === 2; return true; },
    isCurrent: () => {
      if (revokeAfterCheck) {
        revokeAfterCheck = false;
        queueMicrotask(() => { live = false; });
      }
      return live;
    },
  }), { kind: "unconfirmed" });
  assert.equal(dispatchChecks, 2);
  assert.equal(dispatched, 0);
  assert.equal((await documents.forOrganization(scope.organizationId).listDocuments("headless/conversation/reservations")).length, 1);
});

test("the owned reservation applies observation and dispatch policy separately", async () => {
  const documents = createInMemoryStructuredDocumentStore();
  let submitted = 0;
  const policyChecks: string[] = [];
  const useCase = new HeadlessApprovedConversationDispatchUseCase({
    reservations: createStructuredHeadlessTurnReservation({ documents, async authorize(_owner, selected, mode) {
      assert.deepEqual(selected, scope);
      policyChecks.push(mode);
      return mode === "observe";
    } }),
    fingerprint: input => createHmac("sha256", "synthetic-key").update(input).digest("hex"),
    async submit() { submitted++; throw new Error("The dispatch must not start."); },
  });
  assert.deepEqual(await useCase.execute(request, {
    scope, isCurrent: () => true, canObserve: async () => true, canDispatch: async () => true,
  }), { kind: "denied" });
  assert.deepEqual(policyChecks, ["observe", "observe", "dispatch"]);
  assert.deepEqual(await documents.forOrganization(scope.organizationId).listNamespaces(), []);
  assert.equal(submitted, 0);
});

test("a grant revoked before the final observation cannot publish the saved handle", async () => {
  const documents = createInMemoryStructuredDocumentStore();
  let live = true;
  let observations = 0;
  let revokeAfterCheck = false;
  const useCase = new HeadlessApprovedConversationDispatchUseCase({
    reservations: createStructuredHeadlessTurnReservation({ documents, authorize: async () => true }),
    fingerprint: input => createHmac("sha256", "synthetic-key").update(input).digest("hex"),
    async submit() {
      return { kind: "success", value: { conversationTurnId: reference.turnId, executionRunId: reference.runId } };
    },
  });
  const grant = { scope, isCurrent: () => {
    if (revokeAfterCheck) {
      revokeAfterCheck = false;
      queueMicrotask(() => { live = false; });
    }
    return live;
  }, canObserve: async () => {
    revokeAfterCheck = ++observations === 2;
    return true;
  }, canDispatch: async () => true };
  assert.deepEqual(await useCase.execute(request, grant), { kind: "unconfirmed" });
  assert.equal(observations, 2);
  live = true;
  observations = 0;
  assert.deepEqual(await useCase.execute(request, grant), { kind: "denied" });
  assert.equal(observations, 2);
  live = true;
  assert.deepEqual(await useCase.execute(request, { ...grant, canObserve: async () => true }), { kind: "observed", reference });
});

test("actual SQLite reopen preserves both the observed and the uncertain reservation", async () => {
  const directory = await realpath(await mkdtemp(path.join(await realpath(tmpdir()), "headless-turn-reservation-")));
  const policy = resolveLocalSqliteDatabasePolicy({ dataRootDirectory: directory });
  let db: Awaited<ReturnType<typeof openLocalSqliteDatabase>> | undefined;
  let submits = 0;
  const uncertain = { ...request, key: "a6f56324-2051-462c-b45b-d9b49bf6dd4a", text: "Synthetic uncertain turn" };
  const make = (database: Awaited<ReturnType<typeof openLocalSqliteDatabase>>) => new HeadlessApprovedConversationDispatchUseCase({
    reservations: createStructuredHeadlessTurnReservation({ documents: database.documents, authorize: async () => true }),
    fingerprint: input => createHmac("sha256", "synthetic-key").update(input).digest("hex"),
    async submit({ text }) {
      submits++;
      if (text === uncertain.text) throw new Error("Synthetic uncertain dispatch");
      return { kind: "success", value: { conversationTurnId: reference.turnId, executionRunId: reference.runId } };
    },
  });
  const grant = { scope, isCurrent: () => true, canObserve: async () => true, canDispatch: async () => true };
  try {
    db = await openLocalSqliteDatabase({ policy });
    const first = make(db);
    assert.deepEqual(await first.execute(request, grant), { kind: "observed", reference });
    assert.deepEqual(await first.execute(uncertain, grant), { kind: "unconfirmed" });
    await db.close();
    db = undefined;
    db = await openLocalSqliteDatabase({ policy });
    const reopened = make(db);
    assert.deepEqual(await reopened.execute(request, grant), { kind: "observed", reference });
    assert.deepEqual(await reopened.execute(uncertain, grant), { kind: "unconfirmed" });
    assert.equal(submits, 2);
  } finally {
    await db?.close();
    await rm(directory, { recursive: true, force: true });
  }
});
