import {finalizeQualificationEvidence} from "../qualification-reporting";
import {runOwnedRestartPhase} from "../asset-authoring-oracles";
import {expect,test} from "@playwright/test";
import {_electron as electron} from "playwright";
import {mkdir,readFile,writeFile} from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import {prepareIsolatedDesktopCase} from "./isolated-desktop-case";
import {readDesktopStartupObservation,type DesktopStartupObservation} from "../meaningful-system-oracles";

test("packaged desktop fresh profiles qualify first Canvas readiness",async()=>{
  test.setTimeout(600000);
  const profile=JSON.parse(await readFile("dev-tools/config/technical-reference-profiles.json","utf8"));
  expect(process.platform).toBe(profile.platform);expect(process.arch).toBe(profile.architecture);
  expect(os.cpus().length).toBe(profile.logicalProcessors);expect(Math.abs(os.totalmem()/(1024**3)-profile.installedMemoryGiB)).toBeLessThan(1);
  expect(profile.performance.warmups+profile.performance.samples).toBe(35);
  const run=process.env.VISUAL_COMPOSER_QUALIFICATION_RUN_ID!;expect(run).toMatch(/^[a-z0-9-]{20,80}$/);
  const folder=path.resolve("artifacts/qualification/visual-composer/runs",run,"cold-canvas");await mkdir(folder,{recursive:true});
  const report={schemaVersion:"cold-canvas-reference-v1",sourceRevision:process.env.VISUAL_COMPOSER_QUALIFICATION_SOURCE_REVISION,profile:profile.environmentId,status:"running",warmups:5,samples:30,canvasReadyMilliseconds:[] as number[],allAttemptsMilliseconds:[] as number[],startupObservations:[] as (DesktopStartupObservation & {attempt:number;warmup:boolean})[],startupBoundary:"Owned Electron launch to first Page handle and interactive first-run shell. Includes test-driver observation overhead and the styled loading screen. Handle availability is not first paint. Profile seeding/workspace creation/inference excluded; OS/model caches uncontrolled. No startup speed verdict.",p95:0,budgetMilliseconds:profile.performance.maximumColdCanvasMilliseconds,boundary:"First system name entry/Create through visible Canvas with ready draft and initial layout in each newly seeded desktop profile. Host launch/workspace creation excluded, matching the retained observation; OS/model caches uncontrolled."};
  const save=()=>writeFile(path.join(folder,"evidence.json"),JSON.stringify(report,null,2)+"\n");await save();
  const failures: unknown[] = [];
  try {
    for(let i=0;i<35;i++) {
      const isolated=prepareIsolatedDesktopCase("cold",i);
      const launchStarted=performance.now();
      const app=await electron.launch({executablePath:process.env.VISUAL_COMPOSER_DESKTOP_EXECUTABLE!,args:[`--user-data-dir=${isolated.dataRoot}`,"--disable-gpu"],env:isolated.env,timeout:60000});
      await runOwnedRestartPhase(async () => {
        const page=await app.firstWindow({timeout:60000});
        const firstWindowMilliseconds=performance.now()-launchStarted;
        await page.setViewportSize({width:1440,height:1000});expect(await page.evaluate(()=>devicePixelRatio)).toBe(1);
        const startup=page.locator("#desktop-startup");
        await expect(startup).toHaveCount(1);
        await expect(startup).toBeHidden({timeout:60000});
        await expect(page.locator("#root")).toHaveJSProperty("inert",false);
        await expect(page.locator("#root")).not.toHaveAttribute("aria-hidden","true");
        const createWorkspace=page.getByRole("button",{name:"Create new workspace",exact:true});
        await expect(createWorkspace).toBeVisible({timeout:60000});await expect(createWorkspace).toBeEnabled();
        const observed=readDesktopStartupObservation({schemaVersion:"desktop-startup-observation-v1",firstWindowMilliseconds,interactiveShellMilliseconds:performance.now()-launchStarted});
        report.startupObservations.push({attempt:i,warmup:i<5,...observed});await save();
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
      }, () => app.close());
      await save();
    }
    report.p95=[...report.canvasReadyMilliseconds].sort((a,b)=>a-b)[28]!;
    expect(report.startupObservations).toHaveLength(35);
    expect(report.canvasReadyMilliseconds).toHaveLength(30);
    expect(report.p95).toBeLessThanOrEqual(report.budgetMilliseconds);
    report.status="passed";
  } catch (error) { failures.push(error); }
  finally {
    await finalizeQualificationEvidence(report, failures, save,
      () => test.info().attach("cold-canvas-reference", {body:JSON.stringify(report), contentType:"application/json"}));
  }
});
