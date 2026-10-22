import {expect,test} from "@playwright/test";
import {triggerObservedOwnedWorkerFault} from "./desktop-task-cleanup";
test("managed reference reconciles an actually exited owned worker",async({page})=>{
  expect(process.env.PYTHON_RUNTIME_QUALIFICATION_SCENARIO).toBe("worker-failure-download");
  await page.addInitScript(token=>localStorage.setItem("ai-system-builder.paired-device-token",token),process.env.VISUAL_COMPOSER_THIN_CLIENT_BEARER_TOKEN!);
  await page.goto(new URL("/systems",process.env.VISUAL_COMPOSER_THIN_CLIENT_ORIGIN!).href);
  await page.locator('input[name="workspaceName"]').fill("Owned worker failure workspace");
  await page.getByRole("button",{name:"Create workspace",exact:true}).click();
  await expect(page.getByLabel("Select current workspace")).toHaveValue(/^workspace\./);
  await expect(page.getByRole("heading",{name:"Systems",exact:true})).toBeVisible();
  const workspaceId=await page.getByLabel("Select current workspace").inputValue();
  const identity=await page.evaluate(async workspaceId=>{
    const token=localStorage.getItem("ai-system-builder.paired-device-token");
    const result=await (await fetch("/api/model/download/start",{method:"POST",headers:{"content-type":"application/json",authorization:`Bearer ${token}`},body:JSON.stringify({workspaceId,provider:"huggingface",modelId:"qualification/controlled-chat",displayName:"Owned worker exit",inferenceMode:"chat",taskTags:["text-generation"],artifactForm:"full-model"})})).json();
    return {ok:result.ok,requestId:result.value?.activity?.requestId};
  },workspaceId);
  expect(identity.ok).toBe(true);expect(identity.requestId).toBeTruthy();
  await page.reload();
  await page.getByRole("button",{name:/^Notifications/}).click();
  const row=page.getByRole("dialog",{name:"Notifications",exact:true}).locator(".ui-notification__item").filter({has:page.getByText("Owned worker exit",{exact:true})});
  await expect(row).toHaveCount(1);
  await triggerObservedOwnedWorkerFault(process.env.VISUAL_COMPOSER_QUALIFICATION_WORKER_CACHE!,Number(process.env.VISUAL_COMPOSER_QUALIFICATION_HOST_PID));
  await expect.poll(()=>page.evaluate(async({workspaceId,requestId})=>{
    const token=localStorage.getItem("ai-system-builder.paired-device-token");
    const result=await(await fetch("/api/model/download/read",{method:"POST",headers:{"content-type":"application/json",authorization:`Bearer ${token}`},body:JSON.stringify({workspaceId,requestId})})).json();
    return result.ok?result.value?.activity?.status:"unavailable";
  },{workspaceId,requestId:identity.requestId}),{timeout:10000,intervals:[200]}).toBe("failed");
  await expect(row).toContainText("Python runtime worker stopped before the task completed.");
  await test.info().attach("owned-worker-exit",{body:JSON.stringify({sourceRevision:process.env.VISUAL_COMPOSER_QUALIFICATION_SOURCE_REVISION,fixture:"finite-owned-worker-exits-23-at-1200ms",authoritativeTerminal:"failed",renderedTerminal:"failed"}),contentType:"application/json"});
});
