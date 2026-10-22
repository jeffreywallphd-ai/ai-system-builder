import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { expect, type Page, type TestInfo } from "@playwright/test";
import { captureInitialProgress, progressVisibilityDelay, terminalVisibilityDelay } from "../task-visibility-measurement";

type Operation="start"|"read"|"list"|"cancel"|"complete";
export async function taskOperation(page:Page,operation:Operation,input:Record<string,unknown>) {
  const response=await page.evaluate(async({operation,input})=>{
    const names={start:"startModelDownload",read:"readModelDownload",list:"listModelDownloads",cancel:"cancelModelDownload",complete:"completeModelDownload"};
    const api=(window as unknown as {desktopApi?:Record<string,(input:unknown)=>Promise<unknown>>}).desktopApi;
    if(api) return api[names[operation]]!(input);
    const token=localStorage.getItem("ai-system-builder.paired-device-token");
    return (await fetch(`/api/model/download/${operation}`,{method:"POST",headers:{"content-type":"application/json",authorization:`Bearer ${token}`},body:JSON.stringify(input)})).json();
  },{operation,input}) as any;
  expect(response.ok, `Owned ${operation} failed: ${String(response.error?.code ?? response.error?.kind ?? "unavailable")}`).toBe(true);
  return response.value;
}

async function showNotifications(page:Page) {
  const panel=page.getByRole("dialog",{name:"Notifications",exact:true});
  if(!await panel.isVisible()) await page.getByRole("button",{name:/^Notifications/}).click();
  await expect(panel).toBeVisible(); return panel;
}

/** Real host API/IPC tasks, real shared observers and rendered notifications.
 * The worker is a fixed synthetic transport fixture, never inference evidence. */
export async function qualifyOwnedTaskJourney(page:Page,info:TestInfo,options:{samples:number; transport:"thin-http"|"desktop-ipc"}) {
  const workspaceId=await page.getByLabel("Select current workspace").inputValue();
  expect(workspaceId).toMatch(/^workspace\./);
  const run=process.env.VISUAL_COMPOSER_QUALIFICATION_RUN_ID!; expect(run).toMatch(/^[a-z0-9-]{20,80}$/);
  const folder=path.resolve("artifacts/qualification/visual-composer/runs",run,"owned-tasks",info.project.name);
  await mkdir(folder,{recursive:true});
  const report={schemaVersion:"owned-task-host-journey-v1",sourceRevision:process.env.VISUAL_COMPOSER_QUALIFICATION_SOURCE_REVISION,host:info.project.name,transport:options.transport,fixture:"observed-download-4500ms-no-model-weights",samples:options.samples,progressVisibilityMilliseconds:[] as number[],terminalVisibilityMilliseconds:[] as number[],requestIds:[] as string[],checks:[] as string[],status:"running",qualificationComplete:options.samples===30};
  const save=()=>writeFile(path.join(folder,"evidence.json"),JSON.stringify(report,null,2)+"\n");
  await save();
  const start=(displayName:string)=>taskOperation(page,"start",{workspaceId,provider:"huggingface",modelId:"qualification/controlled-chat",displayName,inferenceMode:"chat",taskTags:["text-generation"],artifactForm:"full-model"});
  try {
    for(let i=0;i<options.samples;i++) {
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
    await expect(panel.locator(".ui-notification__item").filter({has:page.getByText("Reference workspace fencing",{exact:true})})).toContainText("Synthetic download in progress.");
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
    if(options.transport==="thin-http") {
      const reconnect=await start("Reference reconnect");
      await page.reload();
      panel=await showNotifications(page);
      await expect(panel.locator(".ui-notification__item").filter({has:page.getByText("Reference reconnect",{exact:true})})).toContainText("Synthetic download in progress.");
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
    report.status=options.samples===30?"passed":"diagnostic-passed";
    await info.attach("owned-task-journey",{body:JSON.stringify(report),contentType:"application/json"});
  } finally {if(report.status==="running")report.status="failed";await save();}
}
