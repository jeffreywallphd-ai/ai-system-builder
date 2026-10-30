import { expect, test, type Page } from "@playwright/test";
import { _electron as electron, type ElectronApplication } from "playwright";
import { prepareIsolatedDesktopCase } from "./isolated-desktop-case";
import { closeDesktopAndQualifyOwnedWorkers } from "./desktop-task-cleanup";
import { qualifyOperationalUiJourney } from "./operational-ui-journey";
import { OPERATIONAL_HOST_TIMEOUT_MS } from "../operational-ui-oracles";
import { applyOwnedDesktopNativeZoom } from "./native-desktop-zoom";
import { readCriticalAccessibilityMode, type CriticalAccessibilityMode } from "../technical-accessibility-observation";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { createTrainingCaseEnvironment } from "../training-host-launch-plan.mjs";
import { captureTrainingHostFixture, TRAINING_HOST_TIMEOUT_MS } from "../model-training-oracles";
import { qualifyDesktopTrainingJourney } from "./model-training-journey";
import { runOwnedRestartPhase } from "../asset-authoring-oracles";
import {createImageCaseEnvironment,captureImageInspection} from "../image-host-launch-plan.mjs";
import {captureImageHostFixture,IMAGE_HOST_TIMEOUT_MS} from "../image-generation-host-oracles";
import {qualifyImageHostJourney} from "./image-generation-host-journey";
import {closeImageGenerationDesktop,type ImageCleanupStage} from "./desktop-main-cleanup";

test.use({ screenshot: "off", trace: "off", video: "off" });
async function runOperationalDesktop(mode: CriticalAccessibilityMode = "standard") {
  readCriticalAccessibilityMode(mode);
  if (test.info().project.name !== "packaged-desktop") throw new Error("Unsupported operational desktop host.");
  const isolated = prepareIsolatedDesktopCase(mode === "native400" ? "operational-native400" : "operational");
  const app = await electron.launch({ executablePath: process.env.VISUAL_COMPOSER_DESKTOP_EXECUTABLE!, args: [`--user-data-dir=${isolated.dataRoot}`, "--disable-gpu"], env: { ...isolated.env, PYTHON_RUNTIME_QUALIFICATION_SCENARIO: "observed-download" }, timeout: 60_000 });
  try {
    const page = await app.firstWindow({ timeout: 60_000 });
    await expect(page.getByRole("heading", { name: "Create a Workspace", exact: true })).toBeVisible({ timeout: 60_000 });
    await page.getByRole("button", { name: "Create new workspace", exact: true }).click();
    await page.locator('input[name="workspaceName"]').fill("Operational desktop fixture");
    await page.getByRole("button", { name: "Create workspace", exact: true }).click();
    await expect(page.getByLabel("Select current workspace")).toHaveValue(/^workspace\./);
    if (mode === "native400") {
      const factor = await applyOwnedDesktopNativeZoom(app, page);
      await test.info().attach("native-desktop-zoom-setup", {body:JSON.stringify({schemaVersion:"native-desktop-zoom-setup-v1",factor}),contentType:"application/json"});
    }
    await qualifyOperationalUiJourney(page, test.info(), "packaged-desktop", mode);
  } finally { await closeDesktopAndQualifyOwnedWorkers(app, isolated.env.HF_HUB_CACHE, test.info()); }
}

test("packaged desktop preserves operational runtime controls and shell recovery", async () => {
  test.setTimeout(OPERATIONAL_HOST_TIMEOUT_MS);
  await runOperationalDesktop();
});

test("packaged desktop preserves operational controls at native 400 percent zoom", async () => {
  test.setTimeout(OPERATIONAL_HOST_TIMEOUT_MS);
  await runOperationalDesktop("native400");
});

test("packaged desktop trains one local adapter, reviews privately, saves and reopens it", async () => {
  test.setTimeout(TRAINING_HOST_TIMEOUT_MS);
  test.skip(process.env.VISUAL_COMPOSER_TRAINING_READY !== "1" || process.env.PYTHON_RUNTIME_QUALIFICATION_SCENARIO !== "training-model-host", "Pending the dedicated offline training profile and its real local prerequisite checks.");
  if (test.info().project.name !== "packaged-desktop") throw new Error("Training requires its fixed Desktop project.");
  const isolated = prepareIsolatedDesktopCase("training");
  const env = createTrainingCaseEnvironment(isolated.env, process.cwd(), isolated.dataRoot, process.env.VISUAL_COMPOSER_TRAINING_MODEL_ACQUISITION);
  // Seed before the app opens SQLite; no live database edits or fake results.
  // The seed creates its private temporary directories, so do not use the new
  // temporary root until that seed has completed.
  const seed = spawnSync(process.env.VISUAL_COMPOSER_ELECTRON_NODE_EXECUTABLE!, ["--preserve-symlinks", "--preserve-symlinks-main", "--import", "tsx", path.resolve("dev-tools/scripts/qualification/visual-composer/training-host-fixture.ts"), "--seed-inputs"], {
    cwd: process.cwd(), env: { ...env, TEMP: process.env.TEMP, TMP: process.env.TMP, ELECTRON_RUN_AS_NODE: "1" }, encoding: "utf8", windowsHide: true, timeout: 120_000, maxBuffer: 8192,
  });
  const fixture = seed.status === 0 && !seed.error ? captureTrainingHostFixture(seed.stdout.trim(), process.env.VISUAL_COMPOSER_QUALIFICATION_RUN_ID, process.env.VISUAL_COMPOSER_QUALIFICATION_SOURCE_REVISION) : undefined;
  if (!fixture) throw new Error("Training qualification input seed is unavailable.");
  env.VISUAL_COMPOSER_TRAINING_FIXTURE = JSON.stringify(fixture);
  const app = await electron.launch({ executablePath: process.env.VISUAL_COMPOSER_DESKTOP_EXECUTABLE!, args: [`--user-data-dir=${isolated.dataRoot}`, "--disable-gpu"], env, timeout: 60_000 });
  await runOwnedRestartPhase(async () => {
    const page = await app.firstWindow({ timeout: 60_000 });
    await qualifyDesktopTrainingJourney(page, test.info(), JSON.stringify(fixture));
  }, () => closeDesktopAndQualifyOwnedWorkers(app, env.HF_HUB_CACHE, test.info()));
});

for(const scenario of ["create-register","task-recovery"] as const)test(`packaged desktop image ${scenario} uses real output and saved artifacts`,async()=>{
  test.setTimeout(IMAGE_HOST_TIMEOUT_MS);
  test.skip(process.env.VISUAL_COMPOSER_IMAGE_READY!=="1","Pending the dedicated image profile and approved installed local inputs.");
  if(test.info().project.name!=="packaged-desktop")throw new Error("Unsupported image host.");
  const run=process.env.VISUAL_COMPOSER_QUALIFICATION_RUN_ID!,source=process.env.VISUAL_COMPOSER_QUALIFICATION_SOURCE_REVISION!;
  const inspection=captureImageInspection(process.env.VISUAL_COMPOSER_IMAGE_INSPECTION,run,source);
  const isolated=prepareIsolatedDesktopCase(scenario==="create-register"?"image-create-register":"image-task-recovery");
  const env=createImageCaseEnvironment(isolated.env,process.cwd(),run,"packaged-desktop",scenario,inspection);
  if(env.VISUAL_COMPOSER_DESKTOP_DATA_ROOT!==isolated.dataRoot)throw new Error("Image input case root mismatch.");
  const seed=spawnSync(process.env.VISUAL_COMPOSER_ELECTRON_NODE_EXECUTABLE!,["--preserve-symlinks","--preserve-symlinks-main","--import","tsx",path.resolve("dev-tools/scripts/qualification/visual-composer/image-host-fixture.ts"),"--seed-inputs"],
    {cwd:process.cwd(),env:{...env,TEMP:process.env.TEMP,TMP:process.env.TMP,ELECTRON_RUN_AS_NODE:"1"},encoding:"utf8",windowsHide:true,timeout:120_000,maxBuffer:8192});
  const fixture=!seed.error&&seed.status===0?captureImageHostFixture(seed.stdout.trim(),run,source,"packaged-desktop",scenario):undefined;
  if(!fixture)throw new Error("The image input seed is unavailable.");
  const app=await electron.launch({executablePath:process.env.VISUAL_COMPOSER_DESKTOP_EXECUTABLE!,args:[`--user-data-dir=${isolated.dataRoot}`,"--disable-gpu"],env,timeout:60_000});
  let stage:ImageCleanupStage="startup";
  await runOwnedRestartPhase(async()=>{const page=await app.firstWindow({timeout:60_000});stage="generation";
    await qualifyImageHostJourney(page,test.info(),JSON.stringify(fixture),scenario);stage="complete";
  },()=>closeImageGenerationDesktop(app,isolated.dataRoot,test.info(),stage));
});

import {qualifySettingsHostJourney} from "./settings-host-journey";
import {SETTINGS_HOST_TIMEOUT_MS} from "../settings-host-oracles";
import {closeSettingsDesktop,type SettingsCleanupStage} from "./desktop-main-cleanup";

for(const scenario of ["public-values","secret-defaults"] as const)test(`packaged desktop settings ${scenario} saves, reloads and clears through the public UI`,async()=>{
  test.setTimeout(SETTINGS_HOST_TIMEOUT_MS);
  test.skip(process.env.VISUAL_COMPOSER_SETTINGS_READY!=="1","Pending the dedicated fresh isolated Settings profile.");
  if(test.info().project.name!=="packaged-desktop")throw new Error("Unsupported Settings host.");
  const isolated=prepareIsolatedDesktopCase(scenario==="public-values"?"settings-public-values":"settings-secret-defaults");
  const app=await electron.launch({executablePath:process.env.VISUAL_COMPOSER_DESKTOP_EXECUTABLE!,args:[`--user-data-dir=${isolated.dataRoot}`,"--disable-gpu"],env:isolated.env,timeout:60_000});
  let stage:SettingsCleanupStage="startup";
  await runOwnedRestartPhase(async()=>{
    const page=await app.firstWindow({timeout:60_000});
    await expect(page.getByLabel("Select current workspace")).toBeVisible({timeout:60_000});
    await page.getByRole("button",{name:"Create new workspace",exact:true}).click();
    await page.locator('input[name="workspaceName"]').fill(`Settings ${scenario} fixture`);
    await page.getByRole("button",{name:"Create workspace",exact:true}).click();
    await expect(page.locator(".workspace-create-form")).toHaveCount(0);
    await expect(page.getByLabel("Select current workspace")).toHaveValue(/^workspace\./);
    stage="settings";await qualifySettingsHostJourney(page,test.info(),"packaged-desktop",scenario);stage="complete";
  },()=>closeSettingsDesktop(app,isolated.dataRoot,test.info(),stage));
});

import {qualifyModelReferenceHostJourney} from "./model-reference-host-journey";
import {FUNCTIONAL_HOST_TIMEOUT_MS} from "../functional-host-oracles";
import {closeFunctionalDesktop,type FunctionalCleanupStage} from "./desktop-main-cleanup";

test("packaged desktop model reference searches, saves and survives reload and workspace changes",async()=>{
  test.setTimeout(FUNCTIONAL_HOST_TIMEOUT_MS);
  test.skip(process.env.VISUAL_COMPOSER_FUNCTIONAL_READY!=="1"||process.env.VISUAL_COMPOSER_FUNCTIONAL_METADATA!=="1","Pending the dedicated isolated model metadata profile.");
  if(test.info().project.name!=="packaged-desktop")throw new Error("Unsupported functional host.");
  const isolated=prepareIsolatedDesktopCase("functional-model-reference");
  const app=await electron.launch({acceptDownloads:false,executablePath:process.env.VISUAL_COMPOSER_DESKTOP_EXECUTABLE!,args:[`--user-data-dir=${isolated.dataRoot}`,"--disable-gpu"],env:isolated.env,timeout:60_000});
  let stage:FunctionalCleanupStage="startup";
  await runOwnedRestartPhase(async()=>{const page=await app.firstWindow({timeout:60_000});stage="models";await qualifyModelReferenceHostJourney(page,test.info(),"packaged-desktop");stage="complete";},()=>closeFunctionalDesktop(app,isolated.dataRoot,test.info(),stage));
});

import {qualifyArtifactLifecycleHostJourney} from "./artifact-lifecycle-host-journey";
import {ARTIFACT_HOST_TIMEOUT_MS} from "../functional-artifact-oracles";

test("packaged desktop artifact local lifecycle preserves actual bytes and scope",async()=>{
  test.setTimeout(ARTIFACT_HOST_TIMEOUT_MS);
  test.skip(process.env.VISUAL_COMPOSER_FUNCTIONAL_READY!=="1"||process.env.VISUAL_COMPOSER_FUNCTIONAL_LOCAL_ARTIFACT!=="1","Pending the dedicated isolated local artifact profile.");
  if(test.info().project.name!=="packaged-desktop")throw new Error("Unsupported artifact host.");
  const isolated=prepareIsolatedDesktopCase("functional-artifact-local");
  // This sole explicit synthetic export case may accept a download. The model
  // reference case explicitly refuses downloads on its actual Electron context.
  const app=await electron.launch({acceptDownloads:true,executablePath:process.env.VISUAL_COMPOSER_DESKTOP_EXECUTABLE!,args:[`--user-data-dir=${isolated.dataRoot}`,"--disable-gpu"],env:isolated.env,timeout:60_000});
  let stage:FunctionalCleanupStage="startup";
  await runOwnedRestartPhase(async()=>{const page=await app.firstWindow({timeout:60_000});stage="artifacts";await qualifyArtifactLifecycleHostJourney(page,test.info(),"packaged-desktop","local-lifecycle");stage="complete";},()=>closeFunctionalDesktop(app,isolated.dataRoot,test.info(),stage));
});

import {qualifyProviderSourceHostJourney} from "./provider-source-host-journey";
import {prepareProviderDesktopCase,qualifyPrivatePublicationHostJourney} from "./private-publication-host-journey";
import type {ExecutingProviderFixture} from "../functional-private-provider-fixture";

async function runProviderDesktopCase(purpose:"provider-source"|"provider-publication",journey:(page:Page,capsule:ExecutingProviderFixture)=>ReturnType<typeof qualifyProviderSourceHostJourney>){
  if(test.info().project.name!=="packaged-desktop")throw new Error("Unsupported private provider host.");
  const prepared=await prepareProviderDesktopCase(purpose);let app:ElectronApplication|undefined,stage:FunctionalCleanupStage="startup",report:Awaited<ReturnType<typeof qualifyProviderSourceHostJourney>>|undefined;
  await runOwnedRestartPhase(async()=>{
    prepared.credential.markConsumerLaunch();
    app=await electron.launch({acceptDownloads:false,executablePath:process.env.VISUAL_COMPOSER_DESKTOP_EXECUTABLE!,args:[`--user-data-dir=${prepared.isolated.dataRoot}`,"--disable-gpu"],env:prepared.isolated.env,timeout:60_000});
    prepared.credential.bindConsumer(app.process());const page=await app.firstWindow({timeout:60_000});stage="artifacts";report=await journey(page,prepared.capsule);stage="complete";
  },()=>runOwnedRestartPhase(async()=>{if(app)await closeFunctionalDesktop(app,prepared.isolated.dataRoot,test.info(),stage);},async()=>{if(app)prepared.credential.retireDesktopAfterStop();else prepared.credential.retireBeforeLaunch();}));
  if(!report)throw new Error("The provider journey did not return evidence.");return report;
}

test("packaged desktop provider source registers an exact reference and optional localized bytes",async()=>{
  test.setTimeout(180_000);test.skip(process.env.VISUAL_COMPOSER_FUNCTIONAL_READY!=="1"||process.env.VISUAL_COMPOSER_FUNCTIONAL_PROVIDER_SOURCE!=="1","Pending the dedicated prepared private provider-source fixture.");
  const report=await runProviderDesktopCase("provider-source",async(page,capsule)=>{if(!capsule.sourceFile)throw new Error("The prepared provider source is missing.");return qualifyProviderSourceHostJourney(page,test.info(),"packaged-desktop",capsule.sourceFile);});expect(report.status).toBe("passed");
});

test("packaged desktop private artifact publication records local branch and remote commit",async()=>{
  test.setTimeout(180_000);test.skip(process.env.VISUAL_COMPOSER_FUNCTIONAL_READY!=="1"||process.env.VISUAL_COMPOSER_FUNCTIONAL_PROVIDER_PUBLICATION!=="1","Pending the dedicated existing-private-repository fixture.");
  const report=await runProviderDesktopCase("provider-publication",(page,capsule)=>qualifyPrivatePublicationHostJourney(page,test.info(),capsule));expect(report.status).toBe("passed");
});
