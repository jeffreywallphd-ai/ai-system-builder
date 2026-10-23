import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import assert from "node:assert/strict";

import {
  describe,
  expect,
  it,
  testDouble,
} from "../../../../testing/node-test";
import { createPythonRuntimeAdapterFoundation } from "../createPythonRuntimePort";

const TOKENS = [
  "initial-runtime-token-0123456789abcdef",
  "first-launch-token-0123456789abcdefghi",
  "second-launch-token-0123456789abcdefgh",
];

function response(status: number, payload: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => payload,
  } as Response;
}

describe("createPythonRuntimeAdapterFoundation", () => {
  for (const operation of ["read", "cancel"] as const) {
    it(`rejects a stale initially unowned ${operation} without releasing a newer Dataset admission`, async () => {
      const fixture = ownedTaskFixture();
      await fixture.foundation.supervisor.start();
      await fixture.start("sibling", "train-model", 1000);
      let deliverObservation!: (result: Response) => void;
      const observation = () => new Promise<Response>(resolve => { deliverObservation = resolve; });
      if (operation === "read") fixture.read = observation;
      else fixture.cancel = observation;
      const oldObservation = operation === "read"
        ? fixture.foundation.runtimePort.readTaskStatus("next")
        : fixture.foundation.runtimePort.cancelTask("next");
      let deliverAdmission!: (result: Response) => void;
      fixture.admission = () => new Promise(resolve => { deliverAdmission = resolve; });
      const pending = fixture.start("next", "prepare-training-dataset");
      try {
        deliverObservation(response(200, {
          requestId: "next", taskType: "prepare-training-dataset",
          status: operation === "read" ? "succeeded" : "cancelled",
          ...(operation === "cancel" ? { cancelled: true } : {}),
        }));
        await assert.rejects(() => oldObservation, /no longer current/);
        fixture.read = undefined;
        fixture.cancel = undefined;
        const clock = testDouble.spyOn(Date, "now").mockReturnValue(Date.now() + 5000);
        try {
          assert.equal((await fixture.foundation.runtimePort.readTaskStatus("sibling")).status, "running");
          assert.equal(fixture.children.length, 1);
        } finally { clock.mockRestore(); }
      } finally {
        deliverAdmission(response(200, { requestId: "next", taskType: "prepare-training-dataset", accepted: true, status: "queued" }));
        await pending;
        await fixture.foundation.supervisor.stop();
      }
    });
  }

  it("rejects locally invalid Dataset identifiers before reserving ownership or dispatching", async () => {
    const fixture = ownedTaskFixture();
    await fixture.foundation.supervisor.start();
    try {
      for (const requestId of ["", "invalid/id", "white space", "\u03bc-model"]) {
        await assert.rejects(() => fixture.start(requestId, "prepare-training-dataset"), /identifier is invalid/);
      }
      assert.equal(fixture.posted.length, 0);
      await fixture.start("valid._:-ID", "train-model", 1000);
      const clock = testDouble.spyOn(Date, "now").mockReturnValue(Date.now() + 5000);
      try {
        assert.equal((await fixture.foundation.runtimePort.readTaskStatus("valid._:-ID")).status, "failed");
        assert.equal(fixture.children.length, 2);
      } finally { clock.mockRestore(); }
    } finally { await fixture.foundation.supervisor.stop(); }
  });

  it("protects pending admission from sibling cancellation and never resurrects it after an exact terminal read", async () => {
    const fixture = ownedTaskFixture(); await fixture.foundation.supervisor.start();
    await fixture.start("sibling", "train-model", 1000);
    let deliver!: (result: Response) => void;
    fixture.admission = async () => new Promise(resolve => { deliver = resolve; });
    const pending = fixture.start("dataset", "prepare-training-dataset");
    fixture.cancelStatus = "running";
    try {
      assert.equal((await fixture.foundation.runtimePort.cancelTask("sibling")).cancelled, false);
      assert.equal(fixture.children.length, 1);
      fixture.statuses.set("dataset", "succeeded");
      assert.equal((await fixture.foundation.runtimePort.readTaskStatus("dataset")).status, "succeeded");
      deliver(response(200, { requestId: "dataset", taskType: "prepare-training-dataset", accepted: true, status: "queued" }));
      await pending;
      const clock = testDouble.spyOn(Date, "now").mockReturnValue(Date.now() + 5000);
      try { assert.equal((await fixture.foundation.runtimePort.readTaskStatus("sibling")).status, "failed"); }
      finally { clock.mockRestore(); }
      assert.equal(fixture.children.length, 2);
      assert.equal((await fixture.foundation.runtimePort.readTaskStatus("dataset")).status, "succeeded");
    } finally { await fixture.foundation.supervisor.stop(); }
  });

  for (const mismatch of ["request", "type", "malformed"]) {
    it(`retains ambiguous Dataset ownership after a ${mismatch} admission response`, async () => {
      const fixture = ownedTaskFixture(); await fixture.foundation.supervisor.start();
      await fixture.start("sibling", "train-model", 1000);
      fixture.admission = async () => response(200, mismatch === "malformed" ? {} : {
        requestId: mismatch === "request" ? "foreign" : "dataset",
        taskType: mismatch === "type" ? "train-model" : "prepare-training-dataset", accepted: true, status: "queued",
      });
      await assert.rejects(() => fixture.start("dataset", "prepare-training-dataset"));
      const clock = testDouble.spyOn(Date, "now").mockReturnValue(Date.now() + 5000);
      try {
        fixture.read = async requestId => response(200, { requestId, status: "succeeded" });
        await assert.rejects(() => fixture.foundation.runtimePort.readTaskStatus("dataset"), /identity/);
        fixture.read = undefined; fixture.statuses.set("dataset", "unknown");
        assert.equal((await fixture.foundation.runtimePort.readTaskStatus("dataset")).status, "unknown");
        assert.equal((await fixture.foundation.runtimePort.readTaskStatus("sibling")).status, "running");
        assert.equal(fixture.children.length, 1);
        const count = fixture.posted.length;
        await assert.rejects(() => fixture.start("dataset", "prepare-training-dataset"), /already known/);
        assert.equal(fixture.posted.length, count);
        fixture.statuses.set("dataset", "failed");
        assert.equal((await fixture.foundation.runtimePort.readTaskStatus("dataset")).status, "failed");
        assert.equal((await fixture.foundation.runtimePort.readTaskStatus("sibling")).status, "failed");
        assert.equal(fixture.children.length, 2);
      } finally { clock.mockRestore(); await fixture.foundation.supervisor.stop(); }
    });
  }

  for (const pendingAdmission of [false, true]) {
    it(`does not restart protected Dataset work on direct download timeout (pending=${pendingAdmission})`, async () => {
      const fixture = ownedTaskFixture(); await fixture.foundation.supervisor.start();
      let deliver!: (result: Response) => void;
      if (pendingAdmission) fixture.admission = async request => request.taskType === "prepare-training-dataset"
        ? new Promise(resolve => { deliver = resolve; })
        : response(200, { requestId: request.requestId, taskType: request.taskType, accepted: true, status: "queued" });
      const dataset = fixture.start("dataset", "prepare-training-dataset");
      if (!pendingAdmission) await dataset;
      let now = Date.now();
      const clock = testDouble.spyOn(Date, "now").mockImplementation(() => now);
      fixture.read = async requestId => {
        if (fixture.types.get(requestId) === "ensure-model-download") now += 2000;
        return response(200, { requestId, taskType: fixture.types.get(requestId), status: "running" });
      };
      fixture.cancelStatus = "running";
      try {
        await assert.rejects(() => fixture.foundation.runtimePort.ensureModelDownloaded!({ modelId: "fixture/model" }), /model download timed out/);
        assert.equal(fixture.children.length, 1);
        assert.equal((await fixture.foundation.runtimePort.readTaskStatus("dataset")).status, "running");
      } finally {
        clock.mockRestore();
        if (pendingAdmission) deliver(response(200, { requestId: "dataset", taskType: "prepare-training-dataset", accepted: true, status: "queued" }));
        await dataset; await fixture.foundation.supervisor.stop();
      }
    });
  }

  it("fences new task/download dispatch during shared recovery and preserves the first recovery outcome", async () => {
    const fixture = ownedTaskFixture(); await fixture.foundation.supervisor.start();
    await fixture.start("first", "train-model", 1000); await fixture.start("second");
    const restart = fixture.foundation.supervisor.restart.bind(fixture.foundation.supervisor);
    let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
    let restarts = 0;
    fixture.foundation.supervisor.restart = async () => { restarts++; await gate; await restart(); };
    const clock = testDouble.spyOn(Date, "now").mockReturnValue(Date.now() + 5000);
    fixture.cancelStatus = "running";
    const first = fixture.foundation.runtimePort.readTaskStatus("first");
    try {
      await Promise.resolve();
      const count = fixture.posted.length;
      await assert.rejects(() => fixture.start("new-dataset", "prepare-training-dataset"), /recovery/);
      await assert.rejects(() => fixture.foundation.runtimePort.ensureModelDownloaded!({ modelId: "fixture/model" }), /recovery/);
      assert.equal(fixture.posted.length, count);
      const second = fixture.foundation.runtimePort.cancelTask("second");
      await Promise.resolve(); release();
      assert.equal((await first).error?.code, "python_runtime_task_timeout");
      assert.equal((await second).cancelled, false);
      assert.equal(restarts, 1);
      await fixture.start("new-dataset", "prepare-training-dataset");
    } finally { release(); clock.mockRestore(); await first.catch(() => undefined); await fixture.foundation.supervisor.stop(); }
  });

  it("keeps failed recovery fenced until actual owned exit and a new owned startup", async () => {
    const fixture = ownedTaskFixture(); await fixture.foundation.supervisor.start(); await fixture.start("running");
    fixture.cancelStatus = "running";
    fixture.foundation.supervisor.restart = async () => { throw new Error("Synthetic unconfirmed recovery"); };
    try {
      await assert.rejects(() => fixture.foundation.runtimePort.cancelTask("running"));
      const count = fixture.posted.length;
      await fixture.foundation.runtimePort.getHealthStatus();
      assert.equal((await fixture.foundation.runtimePort.readTaskStatus("running")).status, "running");
      fixture.children[0]!.emit("error", new Error("Synthetic process error without exit"));
      await assert.rejects(() => fixture.start("new-dataset", "prepare-training-dataset"), /recovery/);
      await assert.rejects(() => fixture.foundation.runtimePort.ensureModelDownloaded!({ modelId: "fixture/model" }), /recovery/);
      assert.equal(fixture.posted.length, count);
      fixture.children[0]!.emit("exit", 1, null);
      await fixture.foundation.supervisor.start();
      await fixture.start("new-dataset", "prepare-training-dataset");
    } finally { await fixture.foundation.supervisor.stop(); }
  });

  it("retains direct-download timeout recovery when no Dataset work is protected", async () => {
    const fixture = ownedTaskFixture(); await fixture.foundation.supervisor.start(); await fixture.start("sibling");
    let now = Date.now(); const clock = testDouble.spyOn(Date, "now").mockImplementation(() => now);
    fixture.read = async requestId => {
      if (fixture.types.get(requestId) === "ensure-model-download") now += 2000;
      return response(200, { requestId, taskType: fixture.types.get(requestId), status: "running" });
    };
    fixture.cancelStatus = "running";
    try {
      await assert.rejects(() => fixture.foundation.runtimePort.ensureModelDownloaded!({ modelId: "fixture/model" }), /model download timed out/);
      assert.equal(fixture.children.length, 2);
      assert.equal((await fixture.foundation.runtimePort.readTaskStatus("sibling")).error?.code, "python_runtime_worker_restarted");
      fixture.read = undefined; await fixture.start("new-dataset", "prepare-training-dataset");
    } finally { clock.mockRestore(); await fixture.foundation.supervisor.stop(); }
  });

  it("does not release Dataset ownership on contradictory cancellation replies", async () => {
    const fixture = ownedTaskFixture(); await fixture.foundation.supervisor.start();
    await fixture.start("dataset", "prepare-training-dataset"); await fixture.start("sibling", "train-model", 1000);
    const clock = testDouble.spyOn(Date, "now").mockReturnValue(Date.now() + 5000);
    try {
      for (const reply of [{ cancelled: true, status: "running" }, { cancelled: false, status: "cancelled" }]) {
        fixture.cancelReply = reply;
        await assert.rejects(() => fixture.foundation.runtimePort.cancelTask("dataset"), /inconsistent/);
        assert.equal((await fixture.foundation.runtimePort.readTaskStatus("sibling")).status, "running");
        assert.equal(fixture.children.length, 1);
      }
      fixture.cancelReply = { cancelled: true, status: "cancelled" };
      assert.equal((await fixture.foundation.runtimePort.cancelTask("dataset")).cancelled, true);
      assert.equal((await fixture.foundation.runtimePort.readTaskStatus("sibling")).status, "failed");
    } finally { clock.mockRestore(); await fixture.foundation.supervisor.stop(); }
  });

  it("bounds uncertain Dataset admissions without evicting live ownership", async () => {
    const fixture = ownedTaskFixture(); await fixture.foundation.supervisor.start();
    fixture.admission = async () => { throw new Error("Synthetic disconnected admission"); };
    try {
      for (let index = 0; index < 257; index++) await assert.rejects(() => fixture.start("x".repeat(129), "prepare-training-dataset"), /retention bound/);
      assert.equal(fixture.posted.length, 0);
      for (let index = 0; index < 256; index++) await assert.rejects(() => fixture.start(`uncertain-${index}`, "prepare-training-dataset"));
      assert.equal(fixture.posted.length, 256);
      await assert.rejects(() => fixture.start("overflow", "prepare-training-dataset"), /capacity/);
      assert.equal(fixture.posted.length, 256);
      fixture.children[0]!.emit("exit", 1, null);
      await fixture.foundation.supervisor.start(); fixture.admission = undefined;
      await fixture.start("after-exit", "prepare-training-dataset");
    } finally { await fixture.foundation.supervisor.stop(); }
  });
 it("protects an already-delivered Dataset POST while its acknowledgement is delayed",async()=>{
  const f=ownedTaskFixture();await f.foundation.supervisor.start();await f.start("sibling","train-model",1000);
  let deliver!:(r:Response)=>void;let entered!:()=>void;const admissionEntered=new Promise<void>(resolve=>entered=resolve);
  f.admission=async request=>{entered();return new Promise<Response>(resolve=>deliver=resolve);};
  const pending=f.start("dataset","prepare-training-dataset",1000);await admissionEntered;
  const clock=testDouble.spyOn(Date,"now").mockReturnValue(Date.now()+5000);
  try{const observed=await f.foundation.runtimePort.readTaskStatus("sibling");assert.equal(observed.status,"running");assert.equal(f.children.length,1);}
  finally{clock.mockRestore();deliver(response(200,{requestId:"dataset",taskType:"prepare-training-dataset",accepted:true,status:"queued"}));await pending;await f.foundation.supervisor.stop();}
 });
 it("retains Dataset ownership when a delivered POST loses its response",async()=>{
  const f=ownedTaskFixture();await f.foundation.supervisor.start();await f.start("sibling","train-model",1000);
  f.admission=async()=>{throw new Error("Synthetic transport disconnected after delivery");};
  await assert.rejects(()=>f.start("uncertain-dataset","prepare-training-dataset"));
  const clock=testDouble.spyOn(Date,"now").mockReturnValue(Date.now()+5000);
  try{assert.equal((await f.foundation.runtimePort.readTaskStatus("sibling")).status,"running");assert.equal(f.children.length,1);}
  finally{clock.mockRestore();await f.foundation.supervisor.stop();}
 });

  it("keeps running Dataset Preparation and its shared worker observed through cancellation and sibling deadlines", async () => {
    const fixture = ownedTaskFixture();
    await fixture.foundation.supervisor.start();
    await fixture.start("dataset-active", "prepare-training-dataset", 1000);
    await fixture.start("sibling-active", "train-model", 1000);
    fixture.cancelStatus = "running";
    assert.equal((await fixture.foundation.runtimePort.cancelTask("dataset-active")).cancelled, false);
    assert.equal((await fixture.foundation.runtimePort.cancelTask("sibling-active")).cancelled, false);
    const clock = testDouble.spyOn(Date, "now").mockReturnValue(Date.now() + 5000);
    try {
      assert.equal((await fixture.foundation.runtimePort.readTaskStatus("dataset-active")).status, "running");
      assert.equal((await fixture.foundation.runtimePort.readTaskStatus("sibling-active")).status, "running");
      assert.equal(fixture.children.length, 1);
      fixture.statuses.set("dataset-active", "succeeded");
      assert.equal((await fixture.foundation.runtimePort.readTaskStatus("dataset-active")).status, "succeeded");
      assert.equal((await fixture.foundation.runtimePort.readTaskStatus("sibling-active")).status, "failed");
      assert.equal(fixture.children.length, 2);
    } finally { clock.mockRestore(); await fixture.foundation.supervisor.stop(); }
  });

  it("retains confirmed queued Dataset Preparation cancellation without restarting its worker", async () => {
    const fixture = ownedTaskFixture();
    await fixture.foundation.supervisor.start();
    try {
      await fixture.start("dataset-queued", "prepare-training-dataset");
      assert.equal((await fixture.foundation.runtimePort.cancelTask("dataset-queued")).cancelled, true);
      assert.equal((await fixture.foundation.runtimePort.readTaskStatus("dataset-queued")).status, "cancelled");
      assert.equal(fixture.children.length, 1);
    } finally { await fixture.foundation.supervisor.stop(); }
  });
  it("rejects mismatched start, read and cancel identities before retaining terminal state", async () => {
    const fixture = ownedTaskFixture();
    await fixture.foundation.supervisor.start();
    fixture.replyRequestId = "foreign-task";
    await assert.rejects(() => fixture.start("owned-task"), /identity/);
    fixture.replyRequestId = undefined;
    await fixture.start("owned-task");
    for (const mismatch of ["request", "type"]) {
      if(mismatch === "request") fixture.replyRequestId = "foreign-task";
      else fixture.replyTaskType = "prepare-training-dataset";
      await assert.rejects(() => fixture.foundation.runtimePort.cancelTask("owned-task"), /identity/);
      await assert.rejects(() => fixture.foundation.runtimePort.readTaskStatus("owned-task"), /identity/);
      fixture.replyRequestId = undefined; fixture.replyTaskType = undefined;
      assert.equal((await fixture.foundation.runtimePort.readTaskStatus("owned-task")).status, "running");
    }
    fixture.children[0]!.emit("exit", 23, null);
    assert.equal((await fixture.foundation.runtimePort.readTaskStatus("owned-task")).error?.code, "python_runtime_worker_exited");
  });
  it("fails accepted unfinished work only after an owned exit, preserves observed terminals, and fences late replies", async () => {
    const fixture = ownedTaskFixture();
    await fixture.foundation.supervisor.start();
    await fixture.start("unfinished");
    await fixture.start("finished");
    fixture.statuses.set("finished", "succeeded");
    assert.equal((await fixture.foundation.runtimePort.readTaskStatus("finished")).status, "succeeded");
    fixture.transportFailure = true;
    await assert.rejects(() => fixture.foundation.runtimePort.readTaskStatus("unfinished"));
    fixture.transportFailure = false;
    assert.equal((await fixture.foundation.runtimePort.readTaskStatus("unfinished")).status, "running");
    let deliver!: (response: Response) => void;
    fixture.read = () => new Promise<Response>(resolve => { deliver = resolve; });
    const late = fixture.foundation.runtimePort.readTaskStatus("unfinished");
    fixture.children[0]!.emit("exit", 23, null);
    deliver(response(200, { requestId: "unfinished", taskType: "train-model", status: "succeeded" }));
    assert.equal((await late).error?.code, "python_runtime_worker_exited");
    assert.equal((await fixture.foundation.runtimePort.readTaskStatus("finished")).status, "succeeded");
    fixture.read = undefined;
    fixture.transportFailure = true;
    await assert.rejects(() => fixture.foundation.runtimePort.readTaskStatus("unknown"));
    fixture.transportFailure = false;
    await fixture.foundation.supervisor.start();
    await fixture.start("new-generation");
    fixture.children[0]!.emit("close", 23, null);
    assert.equal((await fixture.foundation.runtimePort.readTaskStatus("new-generation")).status, "running");
    await fixture.foundation.supervisor.stop();
    assert.equal((await fixture.foundation.runtimePort.readTaskStatus("new-generation")).status, "failed");
  });

  it("retains terminal failure when the owned worker exits during task admission", async () => {
    const fixture = ownedTaskFixture();
    await fixture.foundation.supervisor.start();
    fixture.duringAdmission = () => fixture.children[0]!.emit("exit", 23, null);
    await fixture.start("admission-race");
    assert.equal((await fixture.foundation.runtimePort.readTaskStatus("admission-race")).error?.code, "python_runtime_worker_exited");
  });

  it("retains the accepted type when a cooperative cancellation omits it", async () => {
    const fixture = ownedTaskFixture();
    await fixture.foundation.supervisor.start();
    await fixture.start("cooperative-cancel");
    assert.equal((await fixture.foundation.runtimePort.cancelTask("cooperative-cancel")).cancelled, true);
    fixture.children[0]!.emit("exit", 23, null);
    assert.deepEqual(await fixture.foundation.runtimePort.readTaskStatus("cooperative-cancel"), {
      requestId: "cooperative-cancel", taskType: "train-model", status: "cancelled",
      completedAt: (await fixture.foundation.runtimePort.readTaskStatus("cooperative-cancel")).completedAt,
      metadata: undefined,
    });
  });
  it("rotates a private bearer token for every spawned launch and does not attach to an ambient service", async () => {
    const generatedTokens = [...TOKENS];
    let activeLaunchToken: string | undefined;
    let processAlive = false;
    const observedAuthorization: string[] = [];
    const spawnedTokens: string[] = [];
    const fetchImplementation = testDouble.fn(
      async (_url: string, init?: RequestInit) => {
        const authorization =
          (init?.headers as Record<string, string> | undefined)
            ?.authorization ?? "";
        observedAuthorization.push(authorization);
        if (!processAlive || authorization !== `Bearer ${activeLaunchToken}`) {
          return response(401, { error: { code: "runtime_auth_required" } });
        }
        return response(200, {
          healthy: true,
          status: { runtimeId: "python-sidecar", status: "ready" },
        });
      },
    );
    const spawnImplementation = testDouble.fn(
      (
        _command: string,
        _args: readonly string[],
        options: { env?: NodeJS.ProcessEnv },
      ) => {
        activeLaunchToken = options.env?.PYTHON_RUNTIME_AUTH_TOKEN;
        spawnedTokens.push(activeLaunchToken ?? "");
        processAlive = true;
        const child = new EventEmitter() as EventEmitter & {
          stdout: PassThrough;
          stderr: PassThrough;
          kill(signal?: string): boolean;
        };
        child.stdout = new PassThrough();
        child.stderr = new PassThrough();
        child.kill = (signal) => {
          processAlive = false;
          queueMicrotask(() => child.emit("exit", 0, signal ?? "SIGTERM"));
          return true;
        };
        return child;
      },
    );
    const events: unknown[] = [];
    const foundation = createPythonRuntimeAdapterFoundation({
      client: {
        baseUrl: "http://127.0.0.1:43111",
        fetchImplementation: fetchImplementation as never,
      },
      supervisor: {
        command: "python",
        args: ["main.py"],
        env: { SAFE_SETTING: "retained" },
        spawnImplementation: spawnImplementation as never,
        startupTimeoutMs: 100,
        healthCheckIntervalMs: 1,
        onEvent: (event) => events.push(event),
      },
      generateAuthorizationToken: () => {
        const token = generatedTokens.shift();
        if (!token) throw new Error("Unexpected token request.");
        return token;
      },
    });

    await foundation.supervisor.start();
    await foundation.supervisor.stop();
    await foundation.supervisor.start();

    expect(spawnedTokens).toEqual([TOKENS[1], TOKENS[2]]);
    expect(spawnedTokens[0]).not.toBe(spawnedTokens[1]);
    expect(observedAuthorization).toContain(`Bearer ${TOKENS[0]}`);
    expect(observedAuthorization).toContain(`Bearer ${TOKENS[1]}`);
    expect(observedAuthorization).toContain(`Bearer ${TOKENS[2]}`);
    expect(JSON.stringify(events)).not.toContain("launch-token");
  });

  it("restarts the sole worker to cancel running work and preserves idempotent status", async () => {
    const generatedTokens = [
      "cancel-initial-token-0123456789abcdef",
      "cancel-launch-token-0123456789abcdefg",
      "cancel-recovery-token-0123456789abcdef",
    ];
    let activeLaunchToken: string | undefined;
    let processAlive = false;
    const spawnImplementation = testDouble.fn(
      (
        _command: string,
        _args: readonly string[],
        options: { env?: NodeJS.ProcessEnv },
      ) => {
        activeLaunchToken = options.env?.PYTHON_RUNTIME_AUTH_TOKEN;
        processAlive = true;
        const child = new EventEmitter() as EventEmitter & {
          stdout: PassThrough;
          stderr: PassThrough;
          kill(signal?: string): boolean;
        };
        child.stdout = new PassThrough();
        child.stderr = new PassThrough();
        child.kill = (signal) => {
          processAlive = false;
          queueMicrotask(() => child.emit("exit", 0, signal ?? "SIGTERM"));
          return true;
        };
        return child;
      },
    );
    const fetchImplementation = testDouble.fn(
      async (url: string, init?: RequestInit) => {
        const authorization = (
          init?.headers as Record<string, string> | undefined
        )?.authorization;
        if (!processAlive || authorization !== `Bearer ${activeLaunchToken}`) {
          return response(401, { error: { code: "runtime_auth_required" } });
        }
        if (url.endsWith("/health")) {
          return response(200, {
            healthy: true,
            status: { runtimeId: "python-sidecar", status: "ready" },
          });
        }
        if (url.endsWith("/tasks/start")) {
          return response(200, {
            requestId: "running-task",
            taskType: "train-model",
            accepted: true,
            status: "queued",
          });
        }
        if (url.endsWith("/tasks/running-task/cancel")) {
          return response(200, {
            requestId: "running-task",
            taskType: "train-model",
            status: "running",
            cancelled: false,
          });
        }
        throw new Error("Unexpected runtime request.");
      },
    );
    const foundation = createPythonRuntimeAdapterFoundation({
      client: {
        baseUrl: "http://127.0.0.1:43111",
        fetchImplementation: fetchImplementation as never,
      },
      supervisor: {
        command: "python",
        args: ["main.py"],
        spawnImplementation: spawnImplementation as never,
        startupTimeoutMs: 100,
        healthCheckIntervalMs: 1,
      },
      generateAuthorizationToken: () => generatedTokens.shift()!,
    });

    await foundation.supervisor.start();
    await foundation.runtimePort.startTask({
      requestId: "running-task",
      taskType: "train-model",
      payload: {},
    });
    const cancelled = await foundation.runtimePort.cancelTask("running-task");
    const status = await foundation.runtimePort.readTaskStatus("running-task");
    const cancelledAgain =
      await foundation.runtimePort.cancelTask("running-task");

    expect(spawnImplementation).toHaveBeenCalledTimes(2);
    expect(cancelled).toMatchObject({ cancelled: true, status: "cancelled" });
    expect(status).toMatchObject({ status: "cancelled" });
    expect(cancelledAgain).toMatchObject({
      cancelled: true,
      status: "cancelled",
    });
  });
});

function ownedTaskFixture() {
  let processAlive = false;
  const children: Array<EventEmitter & { stdout: PassThrough; stderr: PassThrough; kill(signal?: string): boolean }> = [];
  const statuses = new Map<string, string>();
  const types = new Map<string, string>();
  const fixture = {
    children, statuses, types, posted: [] as string[], transportFailure: false,
    read: undefined as undefined | ((requestId: string) => Promise<Response>),
    cancel: undefined as undefined | (() => Promise<Response>),
    duringAdmission: undefined as undefined | (() => void),
    admission: undefined as undefined | ((request: any) => Promise<Response>),
    cancelReply: undefined as undefined | { cancelled: boolean; status: string; taskType?: string },
    replyRequestId: undefined as string | undefined,
    replyTaskType: undefined as string | undefined,
    cancelStatus: "cancelled" as "cancelled" | "running",
    foundation: undefined as unknown as ReturnType<typeof createPythonRuntimeAdapterFoundation>,
    start: (requestId: string, taskType = "train-model", timeoutMs?: number) => fixture.foundation.runtimePort.startTask({ requestId, taskType, payload: {}, timeoutMs }),
  };
  fixture.foundation = createPythonRuntimeAdapterFoundation({
    client: { baseUrl: "http://127.0.0.1:43111", modelDownloadTimeoutMs: 1000, modelDownloadPollIntervalMs: 10, fetchImplementation: (async (url: string, init?: RequestInit) => {
      if (fixture.transportFailure) throw new Error("Synthetic transport unavailable");
      if (url.endsWith("/health")) return processAlive
        ? response(200, { healthy: true, status: { runtimeId: "python-sidecar", status: "ready" } })
        : response(401, { error: { code: "runtime_auth_required" } });
      if (url.endsWith("/tasks/start")) {
        const request = JSON.parse(String(init?.body));
        types.set(request.requestId, request.taskType);
        fixture.posted.push(request.requestId);
        fixture.duringAdmission?.();
        if (fixture.admission) return fixture.admission(request);
        return response(200, { requestId: fixture.replyRequestId ?? request.requestId, taskType: fixture.replyTaskType ?? request.taskType, accepted: true, status: "queued" });
      }
      if (url.endsWith("/cancel") && fixture.cancel) return fixture.cancel();
      if (url.endsWith("/cancel") && fixture.cancelReply) return response(200, { requestId: url.split("/").at(-2), ...fixture.cancelReply });
      if (url.endsWith("/cancel")) return response(200, { requestId: fixture.replyRequestId ?? url.split("/").at(-2), taskType: fixture.replyTaskType, status: fixture.cancelStatus, cancelled: fixture.cancelStatus === "cancelled" });
      if (fixture.read) return fixture.read(decodeURIComponent(url.split("/").at(-1)!));
      const requestId = decodeURIComponent(url.split("/").at(-1)!);
      return response(200, { requestId: fixture.replyRequestId ?? requestId, taskType: fixture.replyTaskType ?? types.get(requestId) ?? "train-model", status: statuses.get(requestId) ?? "running" });
    }) as never },
    supervisor: { command: "python", args: ["main.py"], startupTimeoutMs: 100, healthCheckIntervalMs: 1,
      spawnImplementation: (() => {
        const child = new EventEmitter() as typeof children[number];
        processAlive = true;
        child.once("exit", () => { processAlive = false; });
        child.stdout = new PassThrough(); child.stderr = new PassThrough();
        child.kill = signal => { queueMicrotask(() => child.emit("exit", 0, signal ?? "SIGTERM")); return true; };
        children.push(child); return child;
      }) as never },
  });
  return fixture;
}
