import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, readdir, rm, symlink, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createControlledConversationRuntimeWorker } from "../visual-composer/controlled-conversation-runtime-worker.mjs";

test("structured output fixture declares controls readiness without performing dataset generation", async () => {
  const token = "qualification-token-0123456789abcdef";
  assert.throws(() => createControlledConversationRuntimeWorker({ port: 0, token, scenario: "unknown-controls" }));
  for (const scenario of ["immediate", "structured-output-controls"]) {
    const worker = createControlledConversationRuntimeWorker({ port: 0, token, scenario });
    const { port } = await worker.start();
    try {
      const origin = `http://127.0.0.1:${port}`;
      const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };
      assert.equal((await fetch(`${origin}/capabilities`)).status, 401);
      const capabilities = await (await fetch(`${origin}/capabilities`, { headers })).json();
      assert.equal(capabilities.capabilities.includes("dataset-preparation.constrained-json"), scenario === "structured-output-controls");
      assert.equal(capabilities.totalAcceleratorMemoryBytes, scenario === "structured-output-controls" ? 8 * 1024 ** 3 : undefined);
      assert.equal(capabilities.capabilities.includes("dataset-preparation.offload-v1"), false);
      const refused = await fetch(`${origin}/tasks/start`, { method: "POST", headers,
        body: JSON.stringify({ requestId: "dataset.controls-only", taskType: "prepare-training-dataset", payload: {} }) });
      assert.equal(refused.status, 400);
      assert.equal((await refused.json()).error.message, "The runtime request is invalid.");
      assert.deepEqual((await (await fetch(`${origin}/models/status`, { headers })).json()).loadedModels, []);
    } finally { await worker.stop(); }
  }
});

test("controlled conversation worker authenticates, bounds, and completes synthetic turns", async () => {
  const token = "qualification-token-0123456789abcdef";
  const worker = createControlledConversationRuntimeWorker({
    host: "127.0.0.1",
    port: 0,
    token,
  });
  const address = await worker.start();
  const origin = `http://${address.host}:${address.port}`;
  try {
    assert.equal((await fetch(`${origin}/health`)).status, 401);

    const headers = { authorization: `Bearer ${token}` };
    const health = await fetch(`${origin}/health`, { headers });
    assert.equal(health.status, 200);
    assert.equal((await health.json()).status.status, "ready");

    const started = await fetch(`${origin}/tasks/start`, {
      method: "POST",
      headers: { ...headers, "content-type": "application/json" },
      body: JSON.stringify({
        requestId: "conversation-text-generation.synthetic",
        taskType: "conversation-text-generation",
        payload: {
          selectedModelId: "qualification/controlled-chat",
          messages: [{ role: "user", content: "Hello qualification" }],
        },
      }),
    });
    assert.equal(started.status, 200);
    const status = await fetch(
      `${origin}/tasks/conversation-text-generation.synthetic`,
      { headers },
    );
    assert.deepEqual((await status.json()).data, {
      assistantResponseText: "Controlled response to: Hello qualification",
    });

    const oversized = await fetch(`${origin}/tasks/start`, {
      method: "POST",
      headers: { ...headers, "content-type": "application/json" },
      body: "x".repeat(65 * 1024),
    });
    assert.equal(oversized.status, 413);
    assert.equal(
      (await oversized.json()).error.code,
      "runtime.request-too-large",
    );
  } finally {
    await worker.stop();
  }
});

test("controlled conversation worker rejects non-loopback and weak launch identity", () => {
  assert.throws(
    () =>
      createControlledConversationRuntimeWorker({
        host: "0.0.0.0",
        port: 43172,
        token: "qualification-token-0123456789abcdef",
      }),
    /loopback/,
  );
  assert.throws(
    () =>
      createControlledConversationRuntimeWorker({
        host: "127.0.0.1",
        port: 43172,
        token: "short",
      }),
    /authentication/,
  );
});

test("observed download preserves active identity and cancellation releases timers without materializing a model", async () => {
  const directory=await mkdtemp(path.join(os.tmpdir(),"observed-download-"));
  const modelCacheRoot=path.join(directory,"cache");
  const token="qualification-token-0123456789abcdef";
  const worker=createControlledConversationRuntimeWorker({port:0,token,modelCacheRoot,scenario:"observed-download"});
  const {port}=await worker.start();
  const origin=`http://127.0.0.1:${port}`;
  const headers={authorization:`Bearer ${token}`,"content-type":"application/json"};
  const body={requestId:"observed.synthetic",taskType:"ensure-model-download",payload:{provider:"transformers",modelId:"qualification/controlled-chat"}};
  try {
    assert.throws(()=>createControlledConversationRuntimeWorker({port:0,token,scenario:"arbitrary"}),/fixed qualification/);
    const start=()=>fetch(`${origin}/tasks/start`,{method:"POST",headers,body:JSON.stringify(body)});
    assert.equal((await start()).status,200);
    assert.equal((await start()).status,409);
    const running=await (await fetch(`${origin}/tasks/observed.synthetic`,{headers})).json();
    assert.equal(running.status,"running");assert.equal(running.progress.downloadPercent,10);
    assert.equal((await (await fetch(`${origin}/models/status`,{headers})).json()).activeTaskCount,1);
    const cancelled=await (await fetch(`${origin}/tasks/observed.synthetic/cancel`,{method:"POST",headers})).json();
    assert.equal(cancelled.cancelled,true);assert.equal(cancelled.status,"cancelled");
    assert.equal((await (await fetch(`${origin}/tasks/observed.synthetic`,{headers})).json()).status,"cancelled");
    assert.equal((await (await fetch(`${origin}/models/status`,{headers})).json()).activeTaskCount,0);
    assert.deepEqual(await readdir(directory),[]);
    assert.equal((await fetch(`${origin}/tasks/unknown/cancel`,{method:"POST",headers})).status,404);
    assert.equal((await fetch(`${origin}/tasks/observed.synthetic/cancel`,{method:"POST"})).status,401);
  } finally {await worker.stop();await rm(directory,{recursive:true,force:true});}
});

test("fixed disconnect closes the real listener and resumes the same accepted task", {timeout:10000}, async () => {
  const directory=await mkdtemp(path.join(os.tmpdir(),"disconnect-download-"));
  const token="qualification-token-0123456789abcdef";
  let disconnected, reconnected;
  const down=new Promise(resolve=>{disconnected=resolve;});
  const up=new Promise(resolve=>{reconnected=resolve;});
  const worker=createControlledConversationRuntimeWorker({port:0,token,modelCacheRoot:path.join(directory,"cache"),scenario:"disconnect-download",onTransportEvent:event=>{if(event==="disconnected")disconnected();else reconnected();}});
  const {port}=await worker.start();const origin=`http://127.0.0.1:${port}`;
  const headers={authorization:`Bearer ${token}`,"content-type":"application/json"};
  try {
    assert.equal((await fetch(`${origin}/tasks/start`,{method:"POST",headers,body:JSON.stringify({requestId:"disconnect.synthetic",taskType:"ensure-model-download",payload:{provider:"transformers",modelId:"qualification/controlled-chat"}})})).status,200);
    await down;
    await assert.rejects(()=>fetch(`${origin}/tasks/disconnect.synthetic`,{headers}));
    await up;
    const restored=await(await fetch(`${origin}/tasks/disconnect.synthetic`,{headers})).json();
    assert.equal(restored.requestId,"disconnect.synthetic");assert.equal(restored.status,"running");
    assert.equal((await fetch(`${origin}/tasks/disconnect.synthetic/cancel`,{method:"POST",headers})).status,200);
  }finally{await worker.stop();await rm(directory,{recursive:true,force:true});}
});

test("cancellation fences an in-flight owned fault gate without scheduling later work", {timeout:5000}, async()=>{
  const directory=await mkdtemp(path.join(os.tmpdir(),"gated-download-"));
  let release, entered;const waiting=new Promise(resolve=>{entered=resolve;});
  const gate=new Promise(resolve=>{release=resolve;});let failures=0;
  const token="qualification-token-0123456789abcdef";
  const worker=createControlledConversationRuntimeWorker({port:0,token,modelCacheRoot:path.join(directory,"cache"),scenario:"worker-failure-download",waitForOwnedFaultTrigger:()=>{entered();return gate;},onOwnedFailure:()=>{failures++;}});
  const {port}=await worker.start();const origin=`http://127.0.0.1:${port}`;
  const headers={authorization:`Bearer ${token}`,"content-type":"application/json"};
  try{
    await fetch(`${origin}/tasks/start`,{method:"POST",headers,body:JSON.stringify({requestId:"gated.synthetic",taskType:"ensure-model-download",payload:{provider:"transformers",modelId:"qualification/controlled-chat"}})});
    await waiting;
    assert.equal((await(await fetch(`${origin}/tasks/gated.synthetic/cancel`,{method:"POST",headers})).json()).cancelled,true);
    release(true);await new Promise(resolve=>setTimeout(resolve,1300));
    assert.equal(failures,0);assert.equal((await(await fetch(`${origin}/tasks/gated.synthetic`,{headers})).json()).status,"cancelled");
    assert.deepEqual(await readdir(directory),[]);
  }finally{await worker.stop();await rm(directory,{recursive:true,force:true});}
});

test("controlled download uses one opaque fixture handle and refuses caller paths before writes", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "controlled-download-"));
  const modelCacheRoot = path.join(directory, "cache");
  const token = "qualification-token-0123456789abcdef";
  const worker = createControlledConversationRuntimeWorker({ port: 0, token, modelCacheRoot });
  const { port } = await worker.start();
  const origin = `http://127.0.0.1:${port}`;
  const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };
  const start = (payload, requestId = "download.synthetic") => fetch(`${origin}/tasks/start`, { method: "POST", headers,
    body: JSON.stringify({ requestId, taskType: "ensure-model-download", payload }) });
  try {
    const capabilities = await (await fetch(`${origin}/capabilities`, { headers })).json();
    assert.ok(capabilities.capabilities.includes("ensure-model-download"));
    for (const payload of [
      { provider: "transformers", modelId: "unapproved/model" },
      { provider: "transformers", modelId: "qualification/controlled-chat", localPath: directory },
      { provider: "transformers", modelId: "qualification/controlled-chat", modelHandle: "../escape" },
    ]) assert.equal((await start(payload)).status, 400);
    assert.deepEqual(await readdir(directory), []);
    const payload = { provider: "transformers", modelId: "qualification/controlled-chat" };
    assert.equal((await start(payload)).status, 200);
    const status = await (await fetch(`${origin}/tasks/download.synthetic`, { headers })).json();
    assert.equal(status.status, "succeeded");
    assert.deepEqual(status.data, { ...payload,
      modelHandle: "models--qualification--controlled-chat/snapshots/controlled-fixture",
      downloaded: true, fromCache: false });
    assert.ok(!JSON.stringify(status).includes(directory));
    const snapshot = path.join(modelCacheRoot, status.data.modelHandle);
    assert.deepEqual(await readdir(snapshot), ["QUALIFICATION-ONLY.txt"]);
    assert.match(await readFile(path.join(snapshot, "QUALIFICATION-ONLY.txt"), "utf8"), /contains no model weights and does not qualify inference/);
    assert.equal((await start(payload)).status, 409, "an existing task identity cannot be reused");
    assert.equal((await start(payload, "download.repeat")).status, 200, "a new task retains the exact controlled fixture");
    await writeFile(path.join(snapshot, "QUALIFICATION-ONLY.txt"), "x".repeat(128 * 1024));
    assert.equal((await start(payload, "download.invalid-marker")).status, 400, "unexpected marker size is denied before bounded content read");
  } finally { await worker.stop(); await rm(directory, { recursive: true, force: true }); }
});

test("controlled download denies unavailable capability and redirected cache ancestors", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "controlled-denial-"));
  const token = "qualification-token-0123456789abcdef";
  const target = path.join(directory, "target");
  const link = path.join(directory, "redirect");
  await mkdir(target);
  await symlink(target, link, process.platform === "win32" ? "junction" : "dir");
  try {
    for (const modelCacheRoot of [undefined, path.join(link, "cache")]) {
      const worker = createControlledConversationRuntimeWorker({ port: 0, token, modelCacheRoot });
      const { port } = await worker.start();
      try {
        const origin = `http://127.0.0.1:${port}`;
        const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };
        const result = await fetch(`${origin}/tasks/start`, { method: "POST", headers,
          body: JSON.stringify({ requestId: "download.denied", taskType: "ensure-model-download",
            payload: { provider: "transformers", modelId: "qualification/controlled-chat" } }) });
        assert.equal(result.status, 400);
        assert.equal((await result.json()).error.message, "The runtime request is invalid.");
        assert.deepEqual(await readdir(target), []);
        if (!modelCacheRoot) {
          const capabilities = await (await fetch(`${origin}/capabilities`, { headers })).json();
          assert.ok(!capabilities.capabilities.includes("ensure-model-download"));
        }
      } finally { await worker.stop(); }
    }
  } finally { await rm(directory, { recursive: true, force: true }); }
});
