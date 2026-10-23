import { timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";
import { mkdir, lstat, open, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createControlledDatasetResult, validateControlledDatasetRequest } from "./controlled-dataset-preparation.mjs";

const LOOPBACK_HOST = "127.0.0.1";
const MAX_REQUEST_BYTES = 64 * 1024;
const MAX_TASKS = 64;
const SAFE_REQUEST_ID = /^[A-Za-z0-9._:-]{1,128}$/;
const CONTROLLED_MODEL_ID = "qualification/controlled-chat";
const CONTROLLED_MODEL_HANDLE = "models--qualification--controlled-chat/snapshots/controlled-fixture";
const CONTROLLED_MODEL_MARKER = "Synthetic transport fixture; contains no model weights and does not qualify inference.\n";
const FAULT_TRIGGER = "trigger-owned-qualification-fault-v1\n";

export function createControlledConversationRuntimeWorker(options) {
  const host = options.host ?? LOOPBACK_HOST;
  const port = Number(options.port);
  const token = String(options.token ?? "").trim();
  const scenario = options.scenario ?? "immediate";
  if (!["immediate", "observed-download", "worker-failure-download", "disconnect-download", "dataset-profile"].includes(scenario)) throw new Error("Unsupported fixed qualification scenario.");
  if (host !== LOOPBACK_HOST) {
    throw new Error(
      "Controlled runtime qualification must remain on loopback.",
    );
  }
  if (!Number.isInteger(port) || port < 0 || port > 65_535) {
    throw new Error("Controlled runtime qualification port is invalid.");
  }
  if (token.length < 32) {
    throw new Error(
      "Controlled runtime qualification authentication is unavailable.",
    );
  }
  if (options.modelCacheRoot && !path.isAbsolute(options.modelCacheRoot)) {
    throw new Error("Controlled model cache must use an absolute isolated path.");
  }

  const tasks = new Map();
  const pending = new Map();
  const datasetAdmissions = new Set();
  const admissionCompletions = new Map();
  const datasetExecutions = new Set();
  let stopped = false;
  const server = createServer(async (request, response) => {
    try {
      if (!isAuthorized(request.headers.authorization, token)) {
        return sendJson(response, 401, {
          error: {
            code: "runtime.unauthorized",
            message: "Runtime authentication is required.",
          },
        });
      }
      const url = new URL(request.url ?? "/", `http://${host}`);
      if (request.method === "GET" && url.pathname === "/health") {
        return sendJson(response, 200, {
          healthy: true,
          status: {
            runtimeId: "python-sidecar",
            status: "ready",
            version: "qualification-1",
          },
        });
      }
      if (request.method === "GET" && url.pathname === "/capabilities") {
        return sendJson(response, 200, {
          runtimeId: "python-sidecar",
          capabilities: [
            "prepare-training-dataset",
            "dataset-preparation.auto-inference-mode",
            "conversation-text-generation",
            "model-status",
            "unload-model",
            ...(options.modelCacheRoot ? ["ensure-model-download"] : []),
            ...(scenario === "dataset-profile" ? ["dataset-preparation.offload-v1"] : []),
          ],
        });
      }
      if (request.method === "GET" && url.pathname === "/models/status") {
        return sendJson(response, 200, {
          loadedModels: [],
          activeTaskCount: pending.size,
        });
      }
      if (request.method === "POST" && url.pathname === "/models/unload") {
        if (pending.size || datasetAdmissions.size || datasetExecutions.size) return sendJson(response, 409, { error: { code: "model_unload_blocked", message: "Owned tasks are active; unload is unavailable." } });
        return sendJson(response, 200, {
          unloadedModels: [],
          activeTaskCount: 0,
        });
      }
      if (request.method === "POST" && url.pathname === "/tasks/start") {
        if (stopped) return sendJson(response, 503, { error: { code: "runtime.stopping", message: "Runtime admission is closed." } });
        const body = await readJsonBody(request);
        if (stopped) return sendJson(response, 503, { error: { code: "runtime.stopping", message: "Runtime admission is closed." } });
        if (!SAFE_REQUEST_ID.test(body?.requestId ?? "")) throw new Error("invalid bounded task identity");
        if (tasks.has(body.requestId) || datasetAdmissions.has(body.requestId) || tasks.size + datasetAdmissions.size >= MAX_TASKS) return sendJson(response, 409, {error:{code:"runtime.duplicate-task",message:"The task identity is already owned or capacity is full."}});
        datasetAdmissions.add(body.requestId);
        let admissionDone;
        admissionCompletions.set(body.requestId, new Promise(resolve => { admissionDone = resolve; }));
        try {
        if (scenario === "dataset-profile" && body?.taskType === "prepare-training-dataset") {
          await validateControlledDatasetRequest(body.payload);
          if (stopped || tasks.has(body.requestId)) throw new Error("dataset admission closed");
          const attempt = [...tasks.values()].filter(task => task.taskType === "prepare-training-dataset").length + 1;
          const now = new Date().toISOString();
          const task = { requestId: body.requestId, taskType: body.taskType, status: attempt === 3 ? "queued" : "running", ...(attempt === 3 ? {} : { progress: { stage: "generation", message: "Synthetic dataset execution is running." } }), startedAt: now, updatedAt: now };
          tasks.set(body.requestId, task);
          const timer = setTimeout(() => {
            // Establish noncancellable execution before the first awaited I/O.
            task.status = "running";
            const execution = (async () => {
            try {
              if (attempt === 1) tasks.set(body.requestId, { ...task, status: "failed", error: { code: "generation_insufficient_resources", message: "Synthetic resource denial: insufficient available memory for the selected profile.", details: { stage: "generation", reasonCode: "generation_insufficient_resources", memoryShortfall: { resource: "ram", requiredBytes: 3758096384, availableBytes: 3503902720, allowedOverflowBytes: 0 } } }, completedAt: new Date().toISOString() });
              else tasks.set(body.requestId, { ...task, status: "succeeded", data: await createControlledDatasetResult(body.payload), completedAt: new Date().toISOString() });
            } catch { tasks.set(body.requestId, { ...task, status: "failed", error: { code: "controlled_dataset_failed", message: "Synthetic dataset fixture validation failed." }, completedAt: new Date().toISOString() }); }
            finally { pending.delete(body.requestId); }
            })();
            datasetExecutions.add(execution);
            void execution.finally(() => datasetExecutions.delete(execution));
          }, attempt === 1 ? 250 : 6000);
          pending.set(body.requestId, [timer]);
          return sendJson(response, 200, { requestId: body.requestId, taskType: body.taskType, accepted: true, status: task.status, startedAt: now, updatedAt: now });
        }
        if (["observed-download", "worker-failure-download", "disconnect-download"].includes(scenario) && body?.taskType === "ensure-model-download") {
          validateControlledDownload(body.payload, options.modelCacheRoot);
          if (!SAFE_REQUEST_ID.test(body.requestId ?? "") || tasks.size >= MAX_TASKS) throw new Error("invalid bounded task identity");
          const now = new Date().toISOString();
          const task = {requestId:body.requestId,taskType:body.taskType,status:"running",progress:{stage:"downloading",downloadPercent:10,progressUnit:"files",completedFileCount:10,totalFileCount:100,message:"Synthetic download in progress."},startedAt:now,updatedAt:now};
          tasks.set(body.requestId, task);
          const timers = [];
          const schedule = () => {
          if (scenario === "disconnect-download") {
            const boundPort = server.address().port;
            timers.push(setTimeout(() => {
              if (stopped) return;
              server.closeAllConnections();
              server.close(() => options.onTransportEvent?.("disconnected"));
            }, 250));
            timers.push(setTimeout(() => {
              if (!stopped) server.listen(boundPort, host, () => options.onTransportEvent?.("reconnected"));
            }, 4250));
          }
          for (const [delay,percent] of [[500,25],[1500,50],[2500,75],[3500,90]]) timers.push(setTimeout(()=>{task.progress={stage:"downloading",downloadPercent:percent,progressUnit:"files",completedFileCount:percent,totalFileCount:100,message:"Synthetic download in progress."};task.updatedAt=new Date().toISOString();},delay));
          timers.push(setTimeout(async()=>{
            if (scenario === "worker-failure-download") {options.onOwnedFailure?.();return;}
            try {tasks.set(body.requestId,await createCompletedTask(body,options.modelCacheRoot));}
            catch {tasks.set(body.requestId,{...task,status:"failed",error:{code:"controlled_task_failed",message:"Controlled fixture failed."},updatedAt:new Date().toISOString(),completedAt:new Date().toISOString()});}
            finally {for(const timer of timers) clearTimeout(timer);pending.delete(body.requestId);}
          },scenario === "worker-failure-download" ? 1200 : scenario === "disconnect-download" ? 6500 : 4500));
          };
          if(options.waitForOwnedFaultTrigger) {
            let checking=false;const deadline=Date.now()+30000;
            const poll=setInterval(async()=>{
              if(checking || stopped || !pending.has(body.requestId))return;checking=true;
              try {
                if(await options.waitForOwnedFaultTrigger()) {clearInterval(poll);if(!stopped && pending.has(body.requestId))schedule();}
                else if(Date.now()>deadline)throw new Error("Qualification fault was not triggered.");
              }catch{
                clearInterval(poll);if(pending.has(body.requestId))tasks.set(body.requestId,{...task,status:"failed",error:{code:"qualification_gate_failed",message:"Qualification fault trigger failed."},updatedAt:new Date().toISOString(),completedAt:new Date().toISOString()});pending.delete(body.requestId);
              }finally{checking=false;}
            },50);
            timers.push(poll);
          } else schedule();
          pending.set(body.requestId,timers);
          return sendJson(response,200,{requestId:body.requestId,taskType:body.taskType,accepted:true,status:"running",startedAt:now,updatedAt:now});
        }
        const task = await createCompletedTask(body, options.modelCacheRoot);
        if (stopped) throw new Error("runtime admission closed");
        if (tasks.size >= MAX_TASKS) tasks.delete(tasks.keys().next().value);
        tasks.set(task.requestId, task);
        return sendJson(response, 200, {
          requestId: task.requestId,
          taskType: task.taskType,
          accepted: true,
          status: "queued",
          startedAt: task.startedAt,
          updatedAt: task.updatedAt,
        });
        } finally {
          datasetAdmissions.delete(body.requestId); admissionCompletions.delete(body.requestId); admissionDone();
        }
      }
      const taskMatch = /^\/tasks\/([A-Za-z0-9._:-]{1,128})$/.exec(
        url.pathname,
      );
      const cancelMatch = /^\/tasks\/([A-Za-z0-9._:-]{1,128})\/cancel$/.exec(url.pathname);
      if(request.method === "POST" && cancelMatch) {
        const id=cancelMatch[1]; const task=tasks.get(id);
        if(!task) return sendJson(response,404,{error:{code:"runtime.task-not-found",message:"The runtime task is unavailable."}});
        const timers=pending.get(id);
        if (scenario === "dataset-profile" && task.taskType === "prepare-training-dataset" && task.status === "running") {
          return sendJson(response,200,{requestId:id,cancelled:false,status:"running",message:"Running dataset preparation is not cancellable; continue observing."});
        }
        if(timers) {
          for(const timer of timers) clearTimeout(timer);pending.delete(id);
          tasks.set(id,{...task,status:"cancelled",progress:undefined,updatedAt:new Date().toISOString(),completedAt:new Date().toISOString()});
        }
        const status=tasks.get(id).status;
        return sendJson(response,200,{requestId:id,cancelled:status==="cancelled",status,message:status==="cancelled"?"Task cancelled.":"Task is already terminal."});
      }
      if (request.method === "GET" && taskMatch) {
        const task = tasks.get(taskMatch[1]);
        if (!task) {
          return sendJson(response, 404, {
            error: {
              code: "runtime.task-not-found",
              message: "The runtime task is unavailable.",
            },
          });
        }
        return sendJson(response, 200, task);
      }
      return sendJson(response, 404, {
        error: {
          code: "runtime.endpoint-not-found",
          message: "The runtime endpoint is unavailable.",
        },
      });
    } catch (error) {
      const status = error?.code === "request-too-large" ? 413 : 400;
      return sendJson(response, status, {
        error: {
          code:
            status === 413
              ? "runtime.request-too-large"
              : "runtime.invalid-request",
          message:
            status === 413
              ? "The runtime request is too large."
              : "The runtime request is invalid.",
        },
      });
    }
  });

  return {
    async start() {
      await new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(port, host, () => {
          server.off("error", reject);
          resolve();
        });
      });
      const address = server.address();
      if (!address || typeof address === "string") {
        throw new Error("Controlled runtime qualification failed to bind.");
      }
      return { host, port: address.port };
    },
    async stop() {
      stopped = true;
      for(const timers of pending.values()) for(const timer of timers) clearTimeout(timer);
      pending.clear();
      server.closeAllConnections();
      await Promise.allSettled([...admissionCompletions.values(), ...datasetExecutions]);
      if (!server.listening) return;
      server.closeAllConnections();
      await new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    },
  };
}

async function createCompletedTask(value, modelCacheRoot) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("invalid task");
  }
  const requestId = String(value.requestId ?? "").trim();
  if (!SAFE_REQUEST_ID.test(requestId)) throw new Error("invalid request id");
  const payload = value.payload;
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw new Error("invalid payload");
  }
  if (value.taskType === "ensure-model-download") {
    validateControlledDownload(payload,modelCacheRoot);
    const root = await createUnlinkedDirectoryTree(modelCacheRoot);
    let directory = root;
    for (const segment of CONTROLLED_MODEL_HANDLE.split("/")) {
      directory = path.join(directory, segment);
      await mkdir(directory, { recursive: false }).catch(error => { if (error.code !== "EEXIST") throw error; });
      const stats = await lstat(directory);
      if (stats.isSymbolicLink() || !stats.isDirectory() || path.relative(root, await realpath(directory)).startsWith("..")) throw new Error("invalid controlled cache");
    }
    const marker = path.join(directory, "QUALIFICATION-ONLY.txt");
    await writeFile(marker, CONTROLLED_MODEL_MARKER, { flag: "wx" }).catch(async error => {
      if (error.code !== "EEXIST") throw error;
      const stats = await lstat(marker);
      const expected = Buffer.from(CONTROLLED_MODEL_MARKER);
      if (!stats.isFile() || stats.isSymbolicLink() || stats.size !== expected.length) throw new Error("invalid controlled fixture");
      const file = await open(marker, "r");
      try {
        const opened = await file.stat();
        if (!opened.isFile() || opened.size !== expected.length) throw new Error("invalid controlled fixture");
        const buffer = Buffer.alloc(expected.length + 1);
        const { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
        if (bytesRead !== expected.length || !buffer.subarray(0, bytesRead).equals(expected)) throw new Error("invalid controlled fixture");
      } finally { await file.close(); }
    });
    const now = new Date().toISOString();
    return { requestId, taskType: value.taskType, status: "succeeded", data: {
      provider: "transformers", modelId: CONTROLLED_MODEL_ID, modelHandle: CONTROLLED_MODEL_HANDLE, downloaded: true, fromCache: false,
    }, startedAt: now, updatedAt: now, completedAt: now };
  }
  if (value.taskType !== "conversation-text-generation") throw new Error("unsupported task");
  if (
    typeof payload.selectedModelId !== "string" ||
    !/^[A-Za-z0-9][A-Za-z0-9._-]{0,95}\/[A-Za-z0-9][A-Za-z0-9._-]{0,95}$/.test(
      payload.selectedModelId,
    )
  ) {
    throw new Error("invalid model");
  }
  if (
    !Array.isArray(payload.messages) ||
    payload.messages.length < 1 ||
    payload.messages.length > 64
  ) {
    throw new Error("invalid messages");
  }
  const last = payload.messages[payload.messages.length - 1];
  if (
    !last ||
    typeof last !== "object" ||
    last.role !== "user" ||
    typeof last.content !== "string" ||
    last.content.trim().length < 1 ||
    last.content.length > 8_000
  ) {
    throw new Error("invalid user message");
  }
  const now = new Date().toISOString();
  return {
    requestId,
    taskType: value.taskType,
    status: "succeeded",
    data: {
      assistantResponseText: `Controlled response to: ${last.content.trim()}`,
    },
    startedAt: now,
    updatedAt: now,
    completedAt: now,
  };
}

function validateControlledDownload(payload, modelCacheRoot) {
  if (!payload || typeof payload!=="object" || Array.isArray(payload) || !modelCacheRoot || !path.isAbsolute(modelCacheRoot) ||
      payload.provider !== "transformers" || payload.modelId !== CONTROLLED_MODEL_ID ||
      Object.keys(payload).some(key => !["provider", "modelId", "inferenceMode", "taskTags", "artifactForm"].includes(key))) throw new Error("unsupported controlled model request");
}

// Reject redirected ancestors before creating anything below them. This fixture
// owns only its configured disposable cache; payloads never choose filesystem paths.
async function createUnlinkedDirectoryTree(absolutePath) {
  const resolved = path.resolve(absolutePath);
  const { root } = path.parse(resolved);
  let directory = root;
  for (const segment of path.relative(root, resolved).split(path.sep)) {
    directory = path.join(directory, segment);
    await mkdir(directory).catch(error => { if (error.code !== "EEXIST") throw error; });
    const stats = await lstat(directory);
    if (stats.isSymbolicLink() || !stats.isDirectory()) throw new Error("invalid controlled cache ancestor");
  }
  return realpath(directory);
}

async function readJsonBody(request) {
  const chunks = [];
  let total = 0;
  for await (const chunk of request) {
    total += chunk.length;
    if (total > MAX_REQUEST_BYTES) {
      const error = new Error("request too large");
      error.code = "request-too-large";
      throw error;
    }
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function isAuthorized(header, token) {
  const presented =
    typeof header === "string" && header.startsWith("Bearer ")
      ? header.slice("Bearer ".length)
      : "";
  const expectedBytes = Buffer.from(token);
  const presentedBytes = Buffer.from(presented);
  return (
    expectedBytes.length === presentedBytes.length &&
    timingSafeEqual(expectedBytes, presentedBytes)
  );
}

function sendJson(response, status, payload) {
  const body = JSON.stringify(payload);
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    "cache-control": "no-store",
  });
  response.end(body);
}

async function runFromEnvironment() {
  const modelCacheRoot = process.env.HF_HUB_CACHE?.trim();
  if (modelCacheRoot && (!path.isAbsolute(modelCacheRoot) || !path.resolve(modelCacheRoot).replaceAll("\\", "/").includes("/artifacts/qualification/visual-composer/d/"))) throw new Error("controlled model cache must be isolated");
  const gate=process.env.PYTHON_RUNTIME_QUALIFICATION_FAULT_GATE;
  if(gate && (gate!=="owned-file-v1" || !modelCacheRoot || !["worker-failure-download","disconnect-download"].includes(process.env.PYTHON_RUNTIME_QUALIFICATION_SCENARIO)))throw new Error("Invalid fixed fault gate.");
  const worker = createControlledConversationRuntimeWorker({
    host: process.env.PYTHON_RUNTIME_HOST,
    port: process.env.PYTHON_RUNTIME_PORT,
    token: process.env.PYTHON_RUNTIME_AUTH_TOKEN,
    modelCacheRoot,
    scenario: process.env.PYTHON_RUNTIME_QUALIFICATION_SCENARIO ?? "immediate",
    onOwnedFailure: ()=>process.exit(23),
    waitForOwnedFaultTrigger: gate ? async()=>{
      const file=path.join(modelCacheRoot,`qualification-fault-trigger-${process.pid}.txt`);
      const stat=await lstat(file).catch(error=>{if(error.code==="ENOENT")return undefined;throw error;});
      if(!stat)return false;
      if(!stat.isFile() || stat.isSymbolicLink() || stat.size!==Buffer.byteLength(FAULT_TRIGGER) || await realpath(file)!==file)throw new Error("Invalid fixed fault trigger.");
      const handle=await open(file,"r");
      try {const opened=await handle.stat();if(!opened.isFile() || opened.size!==Buffer.byteLength(FAULT_TRIGGER))throw new Error("Invalid fixed fault trigger.");
        const buffer=Buffer.alloc(Buffer.byteLength(FAULT_TRIGGER)+1);const result=await handle.read(buffer,0,buffer.length,0);
        return result.bytesRead===Buffer.byteLength(FAULT_TRIGGER) && buffer.subarray(0,result.bytesRead).toString("utf8")===FAULT_TRIGGER;
      }finally{await handle.close();}
    } : undefined,
  });
  if (process.env.PYTHON_RUNTIME_QUALIFICATION_SCENARIO && modelCacheRoot) {
    await createUnlinkedDirectoryTree(modelCacheRoot);
    await writeFile(path.join(modelCacheRoot,`qualification-worker-identity-${process.pid}.json`),JSON.stringify({pid:process.pid,parentPid:process.ppid,startedAt:new Date().toISOString(),scenario:process.env.PYTHON_RUNTIME_QUALIFICATION_SCENARIO}),{flag:"wx",mode:0o600});
  }
  await worker.start();
  const stop = async () => {
    await worker.stop();
    process.exit(0);
  };
  process.once("SIGINT", () => void stop());
  process.once("SIGTERM", () => void stop());
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  void runFromEnvironment().catch(() => {
    process.stderr.write("Controlled runtime qualification failed to start.\n");
    process.exitCode = 1;
  });
}
