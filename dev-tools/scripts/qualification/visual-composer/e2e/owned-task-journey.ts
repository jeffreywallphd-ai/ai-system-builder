import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { expect, type Page, type TestInfo } from "@playwright/test";
import {types as nodeTypes} from "node:util";
import {finalizeQualificationEvidence} from "../qualification-reporting";
import { captureInitialProgress, progressVisibilityDelay, terminalVisibilityDelay } from "../task-visibility-measurement";

type Operation="start"|"read"|"list"|"cancel"|"complete";

export interface OwnedTaskQualificationProfile {
  readonly samples: 1 | 30;
  readonly transport: "thin-http" | "desktop-ipc";
  readonly successfulStatus: "passed" | "diagnostic-passed";
  readonly qualificationComplete: boolean;
}

export function readOwnedTaskQualificationProfile(value: unknown): OwnedTaskQualificationProfile {
  const refuse = () => { throw new Error("Unsupported owned task qualification profile."); };
  if (typeof value !== "object" || value === null || nodeTypes.isProxy(value) || Object.getPrototypeOf(value) !== Object.prototype) return refuse();
  const keys = Reflect.ownKeys(value);
  if (keys.length !== 2 || !keys.every(key => key === "samples" || key === "transport")) return refuse();
  const samples = Object.getOwnPropertyDescriptor(value, "samples"), transport = Object.getOwnPropertyDescriptor(value, "transport");
  if (!samples || !("value" in samples) || (samples.value !== 1 && samples.value !== 30) ||
      !transport || !("value" in transport) || (transport.value !== "thin-http" && transport.value !== "desktop-ipc")) return refuse();
  return Object.freeze({samples: samples.value, transport: transport.value,
    successfulStatus: samples.value === 30 ? "passed" : "diagnostic-passed", qualificationComplete: samples.value === 30});
}
export async function taskOperation(page:Page,operation:Operation,input:Record<string,unknown>) {
  if (!["start", "read", "list", "cancel", "complete"].includes(operation)) throw new Error("Unsupported owned task operation.");
  const response=await page.evaluate(async({operation,input})=>{
    const failed = (reason: string) => ({ ok: false as const, reason });
    const maximumBytes = 256 * 1024;
    try {
    const names={start:"startModelDownload",read:"readModelDownload",list:"listModelDownloads",cancel:"cancelModelDownload",complete:"completeModelDownload"};
    const api=(window as unknown as {desktopApi?:Record<string,(input:unknown)=>Promise<unknown>>}).desktopApi;
    let envelope: unknown;
    if (api) envelope = await api[names[operation]]!(input);
    else {
      const token=localStorage.getItem("ai-system-builder.paired-device-token");
      if (!token) return failed("pairing-unavailable");
      const controller = new AbortController();
      const deadline = setTimeout(() => controller.abort(), 30_000);
      try {
        const result = await fetch(`/api/model/download/${operation}`,{method:"POST",redirect:"error",signal:controller.signal,headers:{"content-type":"application/json",authorization:`Bearer ${token}`},body:JSON.stringify(input)});
        if (!result.ok || !/^application\/json(?:\s*;|$)/i.test(result.headers.get("content-type") ?? "") || !result.body) {
          await result.body?.cancel(); return failed("http-refused");
        }
        const reader = result.body.getReader(), chunks: Uint8Array[] = []; let size = 0;
        try {
          while (true) {
            const next = await reader.read(); if (next.done) break;
            size += next.value.byteLength; if (size > maximumBytes) return failed("response-too-large");
            chunks.push(next.value);
          }
        } finally { try { await reader.cancel(); } finally { reader.releaseLock(); } }
        const bytes = new Uint8Array(size); let offset = 0;
        for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
        envelope = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
      } finally { clearTimeout(deadline); }
    }
    if (!envelope || typeof envelope !== "object" || Array.isArray(envelope)) return failed("invalid-response");
    const candidate = envelope as { ok?: unknown; value?: unknown };
    if (candidate.ok !== true || !candidate.value || typeof candidate.value !== "object" || Array.isArray(candidate.value)) return failed("invalid-response");
    const serialized = JSON.stringify(candidate.value);
    if (typeof serialized !== "string") return failed("invalid-response");
    if (new TextEncoder().encode(serialized).byteLength > maximumBytes) return failed("response-too-large");
    return { ok: true as const, value: JSON.parse(serialized) };
    } catch { return failed("transport-unavailable"); }
  },{operation,input}).catch(() => ({ ok: false as const, reason: "page-unavailable" }));
  const reason = "reason" in response && ["pairing-unavailable", "http-refused", "invalid-response", "response-too-large", "transport-unavailable", "page-unavailable"].includes(response.reason) ? response.reason : "invalid-response";
  expect(response.ok, `Owned ${operation} failed. ${reason}.`).toBe(true);
  return "value" in response ? response.value : undefined;
}

async function showNotifications(page:Page) {
  const panel=page.getByRole("dialog",{name:"Notifications",exact:true});
  if(!await panel.isVisible()) await page.getByRole("button",{name:/^Notifications/}).click();
  await expect(panel).toBeVisible(); return panel;
}

/** Real host API/IPC tasks, real shared observers and rendered notifications.
 * The worker is a fixed synthetic transport fixture, never inference evidence. */
export async function qualifyOwnedTaskJourney(page:Page,info:TestInfo,options:{samples:number; transport:"thin-http"|"desktop-ipc"}) {
  const profile = readOwnedTaskQualificationProfile(options);
  const workspaceId=await page.getByLabel("Select current workspace").inputValue();
  expect(workspaceId).toMatch(/^workspace\./);
  const run=process.env.VISUAL_COMPOSER_QUALIFICATION_RUN_ID!; expect(run).toMatch(/^[a-z0-9-]{20,80}$/);
  const folder=path.resolve("artifacts/qualification/visual-composer/runs",run,"owned-tasks",info.project.name);
  await mkdir(folder,{recursive:true});
  const report={schemaVersion:"owned-task-host-journey-v1",sourceRevision:process.env.VISUAL_COMPOSER_QUALIFICATION_SOURCE_REVISION,host:info.project.name,transport:profile.transport,fixture:"observed-download-4500ms-no-model-weights",samples:profile.samples,progressVisibilityMilliseconds:[] as number[],terminalVisibilityMilliseconds:[] as number[],requestIds:[] as string[],checks:[] as string[],status:"running",qualificationComplete:profile.qualificationComplete};
  const save=()=>writeFile(path.join(folder,"evidence.json"),JSON.stringify(report,null,2)+"\n");
  await save();
  const failures: unknown[] = [];
  const start=(displayName:string)=>taskOperation(page,"start",{workspaceId,provider:"huggingface",modelId:"qualification/controlled-chat",displayName,inferenceMode:"chat",taskTags:["text-generation"],artifactForm:"full-model"});
  try {
    for(let i=0;i<profile.samples;i++) {
      const title=`Reference owned task ${i}`;
      const started=await start(title); const requestId=started.activity.requestId;
      expect(started.activity.status).toMatch(/queued|running/); report.requestIds.push(requestId);
      const initial=await taskOperation(page,"read",{workspaceId,requestId});
      const transition=captureInitialProgress(initial.activity,requestId);
      // Reopen the actual application while work is active. Initial subscription
      // rediscovers owned tasks; subsequent transitions use the normal observer.
      await page.reload(); await expect(page.getByLabel("Select current workspace")).toHaveValue(workspaceId);
      await page.getByRole("button",{name:"Context",exact:true}).click();
      const panel=await showNotifications(page);
      const row=panel.locator(".ui-notification__item").filter({has:page.getByText(title,{exact:true})});
      await expect(row).toHaveCount(1);
      await expect.poll(async()=>Number(await row.locator("progress").getAttribute("value")),{timeout:4000,intervals:[50]}).toBeGreaterThanOrEqual(transition.percent);
      const visibleAt=Date.now();
      const visiblePercent=Number(await row.locator("progress").getAttribute("value"));
      report.progressVisibilityMilliseconds.push(progressVisibilityDelay(transition,visiblePercent,visibleAt));
      await save();
      await expect.poll(async()=>Number(await row.locator("progress").getAttribute("value")),{timeout:4000,intervals:[50]}).toBeGreaterThanOrEqual(50);
      await expect(row).toContainText("Model download completed.",{timeout:8000});
      const terminalVisibleAt=Date.now();
      const terminal=await taskOperation(page,"read",{workspaceId,requestId});
      expect(terminal.activity.status).toBe("succeeded"); expect(terminal.activity.requestId).toBe(requestId);
      report.terminalVisibilityMilliseconds.push(terminalVisibilityDelay(terminal.activity.completedAt,terminalVisibleAt));
      const first=await taskOperation(page,"complete",{workspaceId,requestId});
      const second=await taskOperation(page,"complete",{workspaceId,requestId});
      expect(first.activity.model.modelRecordId).toBe(second.activity.model.modelRecordId);
      await save();
    }
    report.checks.push("active-leave-reopen-same-task","no-duplicate-rendered-activity","idempotent-write-authorized-completion");
    const active=await start("Reference cancellation");
    const cancelled=await taskOperation(page,"cancel",{workspaceId,requestId:active.activity.requestId});
    expect(cancelled.cancelled).toBe(true);expect(cancelled.activity.status).toBe("cancelled");
    expect((await taskOperation(page,"read",{workspaceId,requestId:active.activity.requestId})).activity.status).toBe("cancelled");
    report.checks.push("authoritative-cancellation");
    const away=await start("Reference workspace fencing");
    await page.reload();
    let panel=await showNotifications(page);
    await expect(panel.locator(".ui-notification__item").filter({has:page.getByText("Reference workspace fencing",{exact:true})})).toContainText("Downloading model.");
    await page.getByRole("button",{name:"Home",exact:true}).click();
    await page.getByRole("button",{name:"Create new workspace",exact:true}).click();
    await page.locator('input[name="workspaceName"]').fill("Owned task destination workspace");
    await page.getByRole("button",{name:"Create workspace",exact:true}).click();
    await expect(page.getByLabel("Select current workspace")).not.toHaveValue(workspaceId);
    panel=await showNotifications(page);
    await expect(panel.locator(".ui-notification__item").filter({has:page.getByText("Reference workspace fencing",{exact:true})})).toHaveCount(0);
    // A fixed wait is the declared fixture's physical terminal deadline, not a
    // selector sleep used to hide a loading race. The destination remains active.
    await page.waitForTimeout(5000);
    await page.getByLabel("Select current workspace").selectOption(workspaceId);
    const change=page.getByRole("button",{name:"Change",exact:true});if(await change.isEnabled())await change.click();
    panel=await showNotifications(page);
    const awayResult=await taskOperation(page,"read",{workspaceId,requestId:away.activity.requestId});
    expect(awayResult.activity.status).toBe("succeeded");
    const restored=panel.locator(".ui-notification__item").filter({has:page.getByText("Reference workspace fencing",{exact:true})});
    // Reopening may suppress a historical toast, but an existing live activity
    // must never remain running after authoritative completion.
    await expect(restored).toHaveCount(1);
    await expect(restored).toContainText("Model download completed.");
    report.checks.push("workspace-change-fences-old-results","return-reconciles-authoritative-task");
    if(profile.transport==="thin-http") {
      const reconnect=await start("Reference reconnect");
      await page.reload();
      panel=await showNotifications(page);
      await expect(panel.locator(".ui-notification__item").filter({has:page.getByText("Reference reconnect",{exact:true})})).toContainText("Downloading model.");
      await page.context().setOffline(true);
      try {await page.waitForTimeout(2000);await expect(panel.locator(".ui-notification__item").filter({has:page.getByText("Reference reconnect",{exact:true})})).not.toContainText("Model download failed.");}
      finally {await page.context().setOffline(false);}
      const recovered=await taskOperation(page,"read",{workspaceId,requestId:reconnect.activity.requestId});
      expect(recovered.activity.requestId).toBe(reconnect.activity.requestId);
      await expect(panel.locator(".ui-notification__item").filter({has:page.getByText("Reference reconnect",{exact:true})})).toContainText("Model download completed.",{timeout:8000});
      report.checks.push("actual-browser-disconnect-reconnect-preserves-task");
    }
    // Leave a real task active for the outer host's graceful shutdown/physical
    // worker cleanup assertion. Teardown failure fails the entire runner.
    const shutdown=await start("Reference graceful shutdown");
    expect(shutdown.activity.status).toMatch(/queued|running/);
    report.checks.push("active-task-at-graceful-shutdown");
    const percentile=(values:number[])=>[...values].sort((a,b)=>a-b)[Math.ceil(values.length*.95)-1]!;
    expect(percentile(report.progressVisibilityMilliseconds)).toBeLessThanOrEqual(2000);
    expect(percentile(report.terminalVisibilityMilliseconds)).toBeLessThanOrEqual(2000);
    report.status=profile.successfulStatus;
  } catch (error) { failures.push(error); }
  finally {
    await finalizeQualificationEvidence(report, failures, save,
      () => info.attach("owned-task-journey", {body:JSON.stringify(report), contentType:"application/json"}), profile.successfulStatus);
  }
}
