import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import test from "node:test";
import {createInMemoryStructuredDocumentStore} from "../../../../adapters/persistence/shared";
import {createOrganizationId} from "../../../../contracts/organization";
import {createWorkspaceId} from "../../../../contracts/workspace";
import {HEADLESS_CONTRACT_VERSION} from "../../../../contracts/headless";
import {createOriginalHeadlessTrainingTaskOwner} from "../headlessModelTrainingTasks";

test("training task retention configuration is closed, finite and inert", () => {
  for (const maximumRetainedTasks of [0, -1, 257, 1.5, NaN, Infinity])
    assert.throws(() => createOriginalHeadlessTrainingTaskOwner({maximumRetainedTasks}));
  assert.ok(createOriginalHeadlessTrainingTaskOwner()); assert.ok(createOriginalHeadlessTrainingTaskOwner({maximumRetainedTasks: 1}));
  let reads = 0; const configuration = Object.defineProperty({}, "maximumRetainedTasks", {enumerable: true, get() {reads++; throw Error("PRIVATE");}});
  assert.throws(() => createOriginalHeadlessTrainingTaskOwner(configuration)); assert.equal(reads, 0);
  assert.throws(() => createOriginalHeadlessTrainingTaskOwner({unlimited: true} as never));
});
test("missing accepted training lineage cannot be turned into a generic task lookup or cancellation", async () => {
  const book = createOriginalHeadlessTrainingTaskOwner(), host = randomUUID();
  const scope = {organizationId: createOrganizationId("org.training-controls"), workspaceId: createWorkspaceId("workspace.training-controls"),
    principalId: "principal.synthetic", registeredClientId: randomUUID()};
  let authorizations = 0;
  const base = {documents: createInMemoryStructuredDocumentStore(), hostIncarnationId: host, scope, isCurrent: () => true,
    authorize: async () => {authorizations++; return true;}};
  const request = {version: HEADLESS_CONTRACT_VERSION, operation: "models.training-task", input: {hostIncarnationId: host,
    workspaceId: scope.workspaceId, selection: {kind: "task", taskId: randomUUID()}}};
  assert.deepEqual(await book.read({...base, request}), {ok: false, code: "headless.forbidden"});
  assert.deepEqual(await book.reviewCompletion({...base, request}), {ok: false, code: "headless.forbidden"});
  assert.deepEqual(await book.reviewCandidate({...base, request}), {ok: false, code: "headless.forbidden"});
  assert.deepEqual(await book.cancel({...base, request: {...request, operation: "models.cancel-training"}}), {ok: false, code: "headless.forbidden"});
  assert.equal(authorizations, 4);
  const count = authorizations;
  assert.deepEqual(await book.read({...base, request: {...request, operation: "models.task"}}), {ok: false, code: "headless.invalid-request"});
  assert.equal(authorizations, count);
});
test("malformed original runner inputs have no effect or task authority", async () => {
  const book = createOriginalHeadlessTrainingTaskOwner();
  assert.deepEqual(await book.runPrepared({prepared: new Proxy({}, {get() {assert.fail("No proxy getter.");}})} as never),
    {result: {ok: false, code: "headless.operation-unconfirmed"}});
});

test("current candidate readers cannot be injected through task-book configuration", () => {
  let calls = 0;
  assert.throws(() => createOriginalHeadlessTrainingTaskOwner({maximumRetainedTasks: 1,
    reviewCandidate: async () => {calls++; return {kind: "not-ready"};}} as never));
  const getter = Object.defineProperty({maximumRetainedTasks: 1}, "reviewCandidate", {enumerable: true,
    get() {calls++; throw Error("must not execute");}});
  assert.throws(() => createOriginalHeadlessTrainingTaskOwner(getter)); assert.equal(calls, 0);
});
