import {finalizeQualificationEvidence} from "../qualification-reporting";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, type Page, type TestInfo } from "@playwright/test";

const p95 = (values: number[]) => [...values].sort((a,b)=>a-b)[Math.ceil(values.length*.95)-1]!;
export async function qualifyReferenceBrowsePerformance(page: Page, info: TestInfo) {
  const bytes = await readFile("dev-tools/config/technical-reference-profiles.json");
  const profile = JSON.parse(bytes.toString("utf8"));
  expect(process.platform).toBe(profile.platform); expect(process.arch).toBe(profile.architecture);
  expect(os.cpus().length).toBe(profile.logicalProcessors);
  expect(Math.abs(os.totalmem()/(1024**3)-profile.installedMemoryGiB)).toBeLessThan(1);
  const run = process.env.VISUAL_COMPOSER_QUALIFICATION_RUN_ID!;
  expect(run).toMatch(/^[a-z0-9-]{20,80}$/);
  const folder = path.resolve("artifacts/qualification/visual-composer/runs", run, "browse-performance", info.project.name);
  await mkdir(folder,{recursive:true});
  const report = {schemaVersion:"reference-browse-performance-v1", sourceRevision:process.env.VISUAL_COMPOSER_QUALIFICATION_SOURCE_REVISION, profile:profile.environmentId, profileSha256:createHash("sha256").update(bytes).digest("hex"), host:info.project.name, warmups:profile.performance.warmups, samples:profile.performance.samples, summaryMilliseconds:[] as number[], firstCompatiblePageMilliseconds:[] as number[], summaryP95:0, firstCompatiblePageP95:0, status:"running", fixture:{systems:1000,releases:10000,models:10000,customAssets:10000,sparseCandidates:1000,compatible:100,actualUiPageSize:48}, boundary:"User navigation/search action through exact usable rendered results; includes API/IPC and rendering. Setup, prior-page work and explicit warmups excluded; OS caches uncontrolled.", completedChecks:[] as string[]};
  const save=()=>writeFile(path.join(folder,"evidence.json"),JSON.stringify(report,null,2)+"\n");
  await save();
  const failures: unknown[] = [];
  try {
    await page.setViewportSize({width:1440,height:1000});
    expect(await page.evaluate(()=>devicePixelRatio)).toBe(1);
    for (let i=0; i<report.warmups+report.samples; i++) {
      await page.getByRole("button",{name:"Context",exact:true}).click();
      await expect(page.getByRole("heading",{name:"Context",exact:true})).toBeVisible();
      const started=performance.now();
      await page.getByRole("button",{name:"Home",exact:true}).click();
      const summary=page.getByRole("region",{name:"Page summary"});
      await page.waitForFunction(() => {
        const root=document.querySelector('[aria-label="Page summary"]');
        if(!root || root.getAttribute("aria-busy")==="true" || !root.getBoundingClientRect().width)return false;
        return [["Systems Published","1000"],["Custom Models Trained","2500"],["Custom Assets Created","10000"]].every(([label,value]) =>
          [...root.querySelectorAll(".page-dashboard__metric")].some(metric=>metric.querySelector("dt")?.textContent===label && metric.querySelector("dd")?.textContent===value));
      },undefined,{polling:"raf",timeout:10000});
      const elapsed=performance.now()-started;
      for (const [label,value] of [["Systems Published","1000"],["Custom Models Trained","2500"],["Custom Assets Created","10000"]]) {
        await expect(summary.locator(".page-dashboard__metric").filter({has:page.getByText(label!,{exact:true})}).locator("dd")).toHaveText(value!);
      }
      await expect(summary).not.toHaveAttribute("aria-busy","true");
      if(i>=report.warmups) report.summaryMilliseconds.push(elapsed);
    }
    report.summaryP95=p95(report.summaryMilliseconds); report.completedChecks.push("exact-large-summary"); await save();
    await page.getByRole("button",{name:"Systems",exact:true}).click();
    await page.getByLabel("New system name").fill("Reference sparse picker");
    await page.getByRole("button",{name:"Create system",exact:true}).click();
    await expect(page.getByRole("heading",{name:"Canvas",exact:true})).toBeVisible();
    const editor=page.getByRole("group",{name:"System draft editor",exact:true});
    await expect(editor).toHaveAttribute("aria-busy","false");
    await expect(editor).not.toHaveAttribute("disabled");
    const mainAdd=page.getByRole("button",{name:"Add an element inside Main page",exact:true});
    await expect(mainAdd).toBeEnabled();await mainAdd.click({timeout:10000});
    let dialog=page.getByRole("dialog",{name:/^Add an element to /});
    await dialog.getByLabel("Search compatible elements").fill("page shell");
    const shell=dialog.locator(".system-composer__asset-picker-card").filter({has:page.getByText("Page Shell",{exact:true})}).first();
    await expect(shell).toBeVisible();await shell.click({timeout:10000});
    await expect(dialog).toBeHidden();
    const add=()=>page.getByRole("button",{name:"Add an element inside Page Shell",exact:true});
    await expect(add()).toBeEnabled();
    for (let i=0; i<report.warmups+report.samples; i++) {
      const started=performance.now();
      await add().click(); dialog=page.getByRole("dialog",{name:/^Add an element to /});
      await dialog.getByLabel("Search compatible elements").fill("Reference candidate");
      await page.waitForFunction(() => {
        const dialog=document.querySelector(".system-composer__asset-picker-dialog");
        const cards=dialog?.querySelectorAll<HTMLButtonElement>(".system-composer__asset-picker-card");
        return cards?.length===48 && cards[0]?.querySelector("strong")?.textContent==="Reference candidate 0000" &&
          cards[47]?.querySelector("strong")?.textContent==="Reference candidate 0470" && [...cards].every(card=>!card.disabled);
      },undefined,{polling:"raf",timeout:10000});
      const elapsed=performance.now()-started;
      const cards=dialog.locator(".system-composer__asset-picker-card");
      await expect(cards).toHaveCount(48);
      await expect(cards.first().locator("strong")).toHaveText("Reference candidate 0000");
      await expect(cards.last().locator("strong")).toHaveText("Reference candidate 0470");
      await expect(cards.last()).toBeEnabled();
      if(i>=report.warmups) report.firstCompatiblePageMilliseconds.push(elapsed);
      await save();
      if(i<report.warmups+report.samples-1) {await dialog.press("Escape");await expect(dialog).toBeHidden();}
    }
    report.firstCompatiblePageP95=p95(report.firstCompatiblePageMilliseconds); await save();
    const more=dialog.getByRole("button",{name:"Load more",exact:true});
    let pages=1;
    while(await more.count()) {expect(pages).toBeLessThan(5); await more.click(); pages++; await expect(dialog.locator(".system-composer__asset-picker-card")).toHaveCount(Math.min(100,pages*48));}
    const names=await dialog.locator(".system-composer__asset-picker-card strong").allTextContents();
    expect(names).toEqual(Array.from({length:100},(_,i)=>`Reference candidate ${String(i*10).padStart(4,"0")}`));
    expect(new Set(names).size).toBe(100);
    expect(await dialog.locator(".system-composer__asset-picker-card").count()).toBe(100);
    report.completedChecks.push("sparse-first-page-usable","complete-no-duplicate-no-skipped-continuation");
    expect(report.summaryMilliseconds).toHaveLength(30); expect(report.firstCompatiblePageMilliseconds).toHaveLength(30);
    expect(report.summaryP95).toBeLessThanOrEqual(profile.performance.maximumSummaryPageMilliseconds);
    expect(report.firstCompatiblePageP95).toBeLessThanOrEqual(profile.performance.maximumFirstCompatiblePageMilliseconds);
    report.status="passed";
  } catch (error) { failures.push(error); }
  finally {
    await finalizeQualificationEvidence(report, failures, save,
      () => info.attach("reference-browse-performance", {body:JSON.stringify(report), contentType:"application/json"}));
  }
  return report;
}
