import assert from "node:assert/strict";
import test from "node:test";
import {createWorkspaceId} from "../../workspace";
import {HEADLESS_CONTRACT_VERSION as version, type HeadlessHostIncarnationId} from "../headless-protocol";
import {HEADLESS_READ_OPERATIONS, parseHeadlessReadRequest} from "../headless-read-request";
import {readHeadlessModelMetadataRequest, readHeadlessModelInventory, readHeadlessModelRecord} from "../headless-model-metadata";

const hostIncarnationId = "06f5a599-0c24-4444-926a-fc2c5da9f062" as HeadlessHostIncarnationId;
const workspaceId = createWorkspaceId("workspace.synthetic"), target = {hostIncarnationId, workspaceId};
const model = {modelRecordId: "model.synthetic", updatedAt: "2026-11-19T00:00:00.000Z", source: "local",
  lifecycleStatus: "downloaded", artifactForm: "full-model", provider: "huggingface", modelId: "Qwen/Qwen2.5-0.5B-Instruct",
  taskTags: ["chat"], serializationFormat: "safetensors", parameterCount: 500_000_000, sizeBytes: 1_000_000_000};
const observed = {runtimeReadiness: "not-checked", supplyVerification: "not-checked"};
const inventory = () => ({workspaceId, models: [structuredClone(model)], ...observed});

test("private preparation does not advertise or admit a public model operation", () => {
  for (const operation of ["models.inventory", "models.record"] as const) {
    assert.equal((HEADLESS_READ_OPERATIONS as readonly string[]).includes(operation), false);
    assert.deepEqual(parseHeadlessReadRequest({version, operation, input: target}, hostIncarnationId),
      {ok: false, code: "headless.unsupported-operation"});
  }
});

test("requests are finite copied metadata selectors, never paths or task effects", () => {
  for (const operation of ["models.inventory", "models.record"] as const) {
    const input = operation === "models.record" ? {...target, modelRecordId: model.modelRecordId} : {...target};
    const request = {version, operation, input};
    const result = readHeadlessModelMetadataRequest(request, hostIncarnationId);
    assert.equal(result.ok, true); input.workspaceId = createWorkspaceId("workspace.other");
    if (result.ok) assert.equal(result.request.input.workspaceId, workspaceId);
  }
  for (const input of [{...target, localPath: "C:/private/model"}, {...target, limit: true}, {...target, limit: 33},
    {...target, limit: 1.5}, {...target, cursor: "../foreign"}, {...target, modelRecordId: "model.synthetic"}]) {
    assert.deepEqual(readHeadlessModelMetadataRequest({version, operation: "models.inventory", input}, hostIncarnationId),
      {ok: false, code: "headless.invalid-request"});
  }
  let evaluated = false;
  const input = {...target}; Object.defineProperty(input, "cursor", {enumerable: true, get() {evaluated = true; return "private";}});
  assert.equal(readHeadlessModelMetadataRequest({version, operation: "models.inventory", input}, hostIncarnationId).ok, false);
  assert.equal(evaluated, false);
});

test("recorded facts cannot assert readiness or admit private/provider payloads", () => {
  assert.deepEqual(readHeadlessModelInventory(inventory(), target), inventory());
  const singleName = inventory(); singleName.models[0]!.modelId = "gpt2";
  assert.ok(readHeadlessModelInventory(singleName, target));
  for (const field of ["localPath", "metadata", "cardMarkdown", "rawOutput", "credential"]) {
    const value = inventory(); Object.assign(value.models[0]!, {[field]: "private"});
    assert.equal(readHeadlessModelInventory(value, target), undefined);
  }
  for (const changes of [{runtimeReadiness: "ready"}, {supplyVerification: "verified"}, {workspaceId: "workspace.foreign"}, {secret: "private"}])
    assert.equal(readHeadlessModelInventory({...inventory(), ...changes}, target), undefined);
  for (const changes of [{sizeBytes: Infinity}, {parameterCount: true}, {taskTags: ["chat", "chat"]},
    {updatedAt: "2026-02-31T00:00:00.000Z"}, {modelId: "https://untrusted.invalid/model"}]) {
    const value = inventory(); Object.assign(value.models[0]!, changes);
    assert.equal(readHeadlessModelInventory(value, target), undefined);
  }
});

test("page and exact record correlation reject repeated, foreign or partial identities", () => {
  const raw = inventory();
  assert.ok(readHeadlessModelInventory({...raw, nextCursor: "model.next"}, {...target, limit: 1}));
  assert.equal(readHeadlessModelInventory({...raw, nextCursor: model.modelRecordId}, {...target, limit: 1}), undefined);
  assert.equal(readHeadlessModelInventory({...raw, nextCursor: "model.next"}, {...target, limit: 1, cursor: "model.next"}), undefined);
  assert.equal(readHeadlessModelInventory({...raw, nextCursor: "model.next"}, {...target, limit: 2}), undefined);
  assert.equal(readHeadlessModelInventory({...raw, models: [model, model]}, target), undefined);
  const exact = {workspaceId, model, ...observed};
  assert.ok(readHeadlessModelRecord(exact, {...target, modelRecordId: model.modelRecordId}));
  assert.equal(readHeadlessModelRecord(exact, {...target, modelRecordId: "model.other"}), undefined);
  assert.equal(readHeadlessModelRecord({...exact, rawOutput: "private"}, {...target, modelRecordId: model.modelRecordId}), undefined);
});
