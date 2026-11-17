import {expect,test} from "@playwright/test";
import {_electron as electron} from "playwright";
import {prepareIsolatedDesktopCase} from "./isolated-desktop-case";
import {qualifyOwnedTaskJourney} from "./owned-task-journey";
import {closeDesktopAndQualifyOwnedWorkers} from "./desktop-task-cleanup";
test("packaged desktop observes and cancels owned background tasks",async()=>{
  test.setTimeout(360000);
  const isolated=prepareIsolatedDesktopCase("tasks");
  const app=await electron.launch({executablePath:process.env.VISUAL_COMPOSER_DESKTOP_EXECUTABLE!,args:[`--user-data-dir=${isolated.dataRoot}`,"--disable-gpu"],env:{...isolated.env,PYTHON_RUNTIME_QUALIFICATION_SCENARIO:"observed-download"},timeout:60000});
  try {
    const page=await app.firstWindow({timeout:60000});
    await expect(page.getByRole("heading",{name:"Create a Workspace",exact:true})).toBeVisible();
    await page.getByRole("button",{name:"Create new workspace",exact:true}).click();
    await page.locator('input[name="workspaceName"]').fill("Desktop owned task workspace");
    await page.getByRole("button",{name:"Create workspace",exact:true}).click();
    await expect(page.getByLabel("Select current workspace")).toHaveValue(/^workspace\./);
    await qualifyOwnedTaskJourney(page,test.info(),{samples:process.env.QUALIFICATION_TASK_DIAGNOSTIC==="1"?1:30,transport:"desktop-ipc"});
  }finally{await closeDesktopAndQualifyOwnedWorkers(app,isolated.env.HF_HUB_CACHE,test.info());}
});
