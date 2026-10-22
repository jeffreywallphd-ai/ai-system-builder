import {expect,test} from "@playwright/test";
import {_electron as electron} from "playwright";
import {mkdir,readFile,writeFile} from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {prepareIsolatedDesktopCase} from "./isolated-desktop-case";

test("packaged desktop fresh profiles qualify first Canvas readiness",async()=>{
  test.setTimeout(600000);
  const profile=JSON.parse(await readFile("dev-tools/config/technical-reference-profiles.json","utf8"));
  expect(process.platform).toBe(profile.platform);expect(process.arch).toBe(profile.architecture);
  expect(os.cpus().length).toBe(profile.logicalProcessors);expect(Math.abs(os.totalmem()/(1024**3)-profile.installedMemoryGiB)).toBeLessThan(1);
  expect(profile.performance.warmups+profile.performance.samples).toBe(35);
  const run=process.env.VISUAL_COMPOSER_QUALIFICATION_RUN_ID!;expect(run).toMatch(/^[a-z0-9-]{20,80}$/);
  const folder=path.resolve("artifacts/qualification/visual-composer/runs",run,"cold-canvas");await mkdir(folder,{recursive:true});
  const report={schemaVersion:"cold-canvas-reference-v1",sourceRevision:process.env.VISUAL_COMPOSER_QUALIFICATION_SOURCE_REVISION,profile:profile.environmentId,status:"running",warmups:5,samples:30,canvasReadyMilliseconds:[] as number[],allAttemptsMilliseconds:[] as number[],p95:0,budgetMilliseconds:profile.performance.maximumColdCanvasMilliseconds,boundary:"First system name entry/Create through visible Canvas with ready draft and initial layout in each newly seeded desktop profile. Host launch/workspace creation excluded, matching the retained observation; OS/model caches uncontrolled."};
  const save=()=>writeFile(path.join(folder,"evidence.json"),JSON.stringify(report,null,2)+"\n");await save();
  try {
    for(let i=0;i<35;i++) {
      const isolated=prepareIsolatedDesktopCase("cold",i);
      const app=await electron.launch({executablePath:process.env.VISUAL_COMPOSER_DESKTOP_EXECUTABLE!,args:[`--user-data-dir=${isolated.dataRoot}`,"--disable-gpu"],env:isolated.env,timeout:60000});
      try {
        const page=await app.firstWindow({timeout:60000});
        await page.setViewportSize({width:1440,height:1000});expect(await page.evaluate(()=>devicePixelRatio)).toBe(1);
        await page.getByRole("button",{name:"Create new workspace",exact:true}).click();
        await page.locator('input[name="workspaceName"]').fill("Fresh Canvas reference");
        await page.getByRole("button",{name:"Create workspace",exact:true}).click();
        await expect(page.getByLabel("Select current workspace")).toHaveValue(/^workspace\./);
        await page.getByRole("button",{name:"Systems",exact:true}).click();
        const started=performance.now();
        await page.getByLabel("New system name").fill("Fresh reference system");
        await page.getByRole("button",{name:"Create system",exact:true}).click();
        await expect(page.getByRole("heading",{name:"Canvas",exact:true})).toBeVisible({timeout:30000});
        await page.waitForFunction(()=>{const editor=document.querySelector<HTMLFieldSetElement>('[aria-label="System draft editor"]');return editor?.getAttribute("aria-busy")==="false" && !editor.disabled && editor.querySelectorAll(".system-composer__canvas-node").length>=2;},undefined,{polling:"raf"});
        const elapsed=performance.now()-started;report.allAttemptsMilliseconds.push(elapsed);
        if(i>=5)report.canvasReadyMilliseconds.push(elapsed);
      }finally{await app.close();}
      await save();
    }
    report.p95=[...report.canvasReadyMilliseconds].sort((a,b)=>a-b)[28]!;
    expect(report.canvasReadyMilliseconds).toHaveLength(30);
    expect(report.p95).toBeLessThanOrEqual(report.budgetMilliseconds);
    report.status="passed";
    await test.info().attach("cold-canvas-reference",{body:JSON.stringify(report),contentType:"application/json"});
  }finally{if(report.status==="running")report.status="failed";await save();}
});
