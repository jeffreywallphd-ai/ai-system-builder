import {expect,test} from "@playwright/test";
import {_electron as electron} from "playwright";
import {prepareIsolatedDesktopCase} from "./isolated-desktop-case";
import {taskOperation} from "./owned-task-journey";
import {closeDesktopAndQualifyOwnedWorkers,triggerObservedOwnedWorkerFault,persistOwnedHostReport} from "./desktop-task-cleanup";

for(const scenario of ["worker-failure-download","disconnect-download"] as const) {
  test(`packaged desktop reconciles actual owned ${scenario}`,async()=>{
    test.setTimeout(90000);
    const isolated=prepareIsolatedDesktopCase(scenario==="worker-failure-download"?"worker-exit":"worker-disconnect");
    const app=await electron.launch({executablePath:process.env.VISUAL_COMPOSER_DESKTOP_EXECUTABLE!,args:[`--user-data-dir=${isolated.dataRoot}`,"--disable-gpu"],env:{...isolated.env,PYTHON_RUNTIME_QUALIFICATION_SCENARIO:scenario,PYTHON_RUNTIME_QUALIFICATION_FAULT_GATE:"owned-file-v1"},timeout:60000});
    const report={sourceRevision:process.env.VISUAL_COMPOSER_QUALIFICATION_SOURCE_REVISION,scenario,transport:"desktop-ipc-owned-worker-http",terminal:"pending",cleanupMilliseconds:0,physicalWorkersObserved:0,listenerRefusalObserved:false,transientConnectionResets:0};
    try {
      const page=await app.firstWindow({timeout:60000});
      await page.getByRole("button",{name:"Create new workspace",exact:true}).click();
      await page.locator('input[name="workspaceName"]').fill("Desktop worker recovery");
      await page.getByRole("button",{name:"Create workspace",exact:true}).click();
      await expect(page.getByLabel("Select current workspace")).toHaveValue(/^workspace\./);
      const workspaceId=await page.getByLabel("Select current workspace").inputValue();
      const started=await taskOperation(page,"start",{workspaceId,provider:"huggingface",modelId:"qualification/controlled-chat",displayName:"Desktop worker recovery",inferenceMode:"chat",taskTags:["text-generation"],artifactForm:"full-model"});
      await page.reload();
      await page.getByRole("button",{name:/^Notifications/}).click();
      const panel=page.getByRole("dialog",{name:"Notifications",exact:true});
      const row=panel.locator(".ui-notification__item").filter({has:page.getByText("Desktop worker recovery",{exact:true})});
      await expect(row).toHaveCount(1);
      await triggerObservedOwnedWorkerFault(isolated.env.HF_HUB_CACHE,await app.evaluate(()=>process.pid));
      if(scenario==="worker-failure-download") {
        await expect(row).toContainText("Python runtime worker stopped before the task completed.");
        expect((await taskOperation(page,"read",{workspaceId,requestId:started.activity.requestId})).activity.status).toBe("failed");
        report.terminal="failed";
      } else {
        // The actual worker closes its authenticated loopback listener for four
        // seconds, while retaining the process and accepted task. IPC stays up.
        const origin=`http://127.0.0.1:${Number(isolated.env.PYTHON_RUNTIME_PORT)}`;
        await expect.poll(async()=>{
          try {await fetch(`${origin}/health`);return false;}
          catch(error){
            const code=(error as {cause?:{code?:string}}).cause?.code;
            if(code==="ECONNREFUSED"){report.listenerRefusalObserved=true;return true;}
            // Closing the owned listener can first reset a connected probe.
            // Retry within the same budget; a reset is never refusal proof.
            if(code==="ECONNRESET"){report.transientConnectionResets++;return false;}
            throw error;
          }
        },{timeout:3000,intervals:[50]}).toBe(true);
        const retained=await taskOperation(page,"list",{workspaceId,includeCompleted:true,limit:100});
        expect(retained.activities.find((activity:{requestId:string})=>activity.requestId===started.activity.requestId)?.status).toMatch(/queued|running/);
        await expect(row).not.toContainText("Python runtime worker stopped");
        await expect(row).toContainText("Model download completed.",{timeout:10000});
        expect((await taskOperation(page,"read",{workspaceId,requestId:started.activity.requestId})).activity.status).toBe("succeeded");
        report.terminal="succeeded-after-real-http-disconnect";
      }
    }finally{
      const cleanup=await closeDesktopAndQualifyOwnedWorkers(app,isolated.env.HF_HUB_CACHE,test.info());
      report.cleanupMilliseconds=cleanup.cleanupMilliseconds;report.physicalWorkersObserved=cleanup.physicalWorkersObserved;
      await persistOwnedHostReport("worker-recovery",report,test.info());
      await test.info().attach("desktop-worker-recovery",{body:JSON.stringify(report),contentType:"application/json"});
    }
  });
}
