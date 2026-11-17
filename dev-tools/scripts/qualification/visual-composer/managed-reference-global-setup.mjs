import assert from "node:assert/strict";
import { fork } from "node:child_process";
import path from "node:path";
import { stopVisualComposerOwnedProcess } from "./visual-composer-host-lifecycle.mjs";

export default async function setup() {
  const reference = process.env.MANAGED_REFERENCE_DATABASE;
  if (!reference) throw new Error("A separately owned isolated database reference is required.");
  if(process.env.PYTHON_RUNTIME_QUALIFICATION_SCENARIO==="worker-failure-download")process.env.PYTHON_RUNTIME_QUALIFICATION_FAULT_GATE="owned-file-v1";
  const child = fork(path.resolve("dev-tools/scripts/qualification/visual-composer/managed-reference-coordinator.ts"), [], {execArgv: ["--import", "tsx"], env: process.env, silent: true, windowsHide: true});
  try {
    const host = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Managed coordinator startup timed out.")), 90000);
      child.once("exit", () => {clearTimeout(timer); reject(new Error("Managed coordinator startup failed."));});
      child.on("message", message => {if (message?.type === "ready") {clearTimeout(timer); resolve(message);}});
    });
    assert.match(host.runId, /^managed-[a-f0-9]{32}$/);
    process.env.VISUAL_COMPOSER_QUALIFICATION_RUN_ID = host.runId;
    process.env.VISUAL_COMPOSER_QUALIFICATION_SOURCE_REVISION = host.sourceRevision;
    process.env.VISUAL_COMPOSER_QUALIFICATION_ENVIRONMENT_ID = host.profile;
    process.env.VISUAL_COMPOSER_THIN_CLIENT_ORIGIN = host.frontendOrigin;
    process.env.VISUAL_COMPOSER_THIN_CLIENT_BEARER_TOKEN = host.token;
    process.env.VISUAL_COMPOSER_QUALIFICATION_WORKER_CACHE = host.workerCacheRoot;
    process.env.VISUAL_COMPOSER_QUALIFICATION_HOST_PID = String(host.ownedHostPid);
    if (host.fixtureWorkspaceId) process.env.MANAGED_REFERENCE_WORKSPACE_ID = host.fixtureWorkspaceId;
    return async () => {
      try {
        await new Promise((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error("Managed coordinator shutdown timed out.")), 25000);
          child.on("message", message => {if (message?.type === "closed") {clearTimeout(timer); resolve();}});
          child.send({type: "shutdown"});
        });
      } finally {delete process.env.VISUAL_COMPOSER_THIN_CLIENT_BEARER_TOKEN; await stopVisualComposerOwnedProcess(child);}
    };
  } catch (error) {await stopVisualComposerOwnedProcess(child); throw error;}
}
