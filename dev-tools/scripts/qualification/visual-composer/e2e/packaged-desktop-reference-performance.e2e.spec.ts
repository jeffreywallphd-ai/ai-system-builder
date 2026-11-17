import {expect,test} from "@playwright/test";
import {_electron as electron} from "playwright";
import {prepareIsolatedDesktopCase} from "./isolated-desktop-case";
import {qualifyReferenceBrowsePerformance} from "./reference-browse-performance";
test("packaged desktop reference browse budgets retain exact large and sparse results",async()=>{
  test.setTimeout(240000);
  const isolated=prepareIsolatedDesktopCase("reference");
  const app=await electron.launch({executablePath:process.env.VISUAL_COMPOSER_DESKTOP_EXECUTABLE!,args:[`--user-data-dir=${isolated.dataRoot}`,"--disable-gpu"],env:isolated.env,timeout:60000});
  try {
    const page=await app.firstWindow({timeout:60000});
    await expect(page.getByLabel("Select current workspace")).toHaveValue("workspace.reference.performance");
    await qualifyReferenceBrowsePerformance(page,test.info());
  }finally{await app.close();}
});
