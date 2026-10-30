import { expect, type Page, type TestInfo, type Response } from "@playwright/test";
import { captureImageHostFixture, captureImageFinalization, imageArtifactId, imageStorageKey, imageHostReport, imagePublicId, imageTaskStorageKey,
  IMAGE_HOST_PHASES, IMAGE_HOST_PHASE_TIMEOUT_MS, IMAGE_HOST_WORKSPACE_NAME, type ImageJourney } from "../image-generation-host-oracles";

/** Runs inside the actual renderer. Return only dimensions, size and digest. */
export async function readRenderedImageBytes(element: HTMLImageElement) {
  const invalid = () => new Error("The rendered image bytes could not be confirmed.");
  if (!(element instanceof HTMLImageElement) || !element.complete || element.naturalWidth !== 256 || element.naturalHeight !== 256) throw invalid();
  await element.decode();
  // Both production preview clients create a private blob from admitted media.
  // Never let a test helper fetch a caller-selected file or external URL.
  if (!element.currentSrc.startsWith("blob:")) throw invalid();
  const response = await fetch(element.currentSrc, { redirect:"error", credentials:"omit", cache:"no-store" });
  if (!response.ok || response.headers.get("content-type")?.split(";")[0] !== "image/png" || !response.body) throw invalid();
  const reader = response.body.getReader(), chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const value = await reader.read();
      if (value.done) break;
      total += value.value.byteLength;
      if (total > 1024 * 1024) throw invalid();
      chunks.push(value.value);
    }
  } finally { await reader.cancel(); }
  if (total < 8) throw invalid();
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  if ([137,80,78,71,13,10,26,10].some((byte,index) => bytes[index] !== byte)) throw invalid();
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return { width:256, height:256, bytes:total, sha256:Array.from(new Uint8Array(digest), value=>value.toString(16).padStart(2,"0")).join("") };
}

export async function publishImageHostOutcome(info:Pick<TestInfo,"attach">,report:ReturnType<typeof imageHostReport>){
  const body=JSON.stringify(report);
  if(Buffer.byteLength(body)>4096)throw new Error("The image host test report exceeds its fixed bound.");
  try{await info.attach("image-host-ui",{body,contentType:"application/json"});}catch{
    const errors=report.status!=="passed"?[new Error(`The image host phase did not complete: ${report.nextPhase}.`)]:[];
    errors.push(new Error("The image host evidence attachment did not complete."));
    throw new AggregateError(errors,"Image host verification or evidence publication failed.");
  }
  if(report.status!=="passed")throw new Error(`The image host phase did not complete: ${report.nextPhase}.`);
}

/** Actual public UI assertions. Setup supplies inspected inputs, never a task or result. */
export async function qualifyImageHostJourney(page: Page, info: TestInfo, declaration: unknown, scenario: ImageJourney) {
  const captured = captureImageHostFixture(declaration, process.env.VISUAL_COMPOSER_QUALIFICATION_RUN_ID,
    process.env.VISUAL_COMPOSER_QUALIFICATION_SOURCE_REVISION, info.project.name, scenario);
  if (!captured) throw new Error("The image host prerequisites are unavailable.");
  const fixture=captured;
  const phases: string[] = [];
  let failed = false, paused = false, requestId = "";
  let generated: Awaited<ReturnType<typeof readRenderedImageBytes>> | undefined;
  let saved:{assetId:string;artifactId:string;storageKey:string}|undefined,witnessFailed=false;
  const witnesses:ReturnType<typeof captureImageFinalization>[]=[],reads=new Set<Promise<void>>();
  const serverOrigin=process.env.VISUAL_COMPOSER_SERVER_ORIGIN;
  function observe(response:Response){
    if(fixture.host!=="thin-chrome")return;
    const url=new URL(response.url());
    if(![serverOrigin,process.env.VISUAL_COMPOSER_THIN_CLIENT_ORIGIN].includes(url.origin)||url.pathname!=="/api/image-generation/finalize"||response.status()!==200)return;
    const work=(async()=>{try{
      const body=await response.body();if(body.byteLength>16384)throw new Error("Bounded image witness required.");
      const value=JSON.parse(body.toString("utf8"));if(value?.ok!==true||value.value?.finalized!==true)return;
      if(witnesses.length>=8)throw new Error("Bounded image witness count required.");
      witnesses.push(captureImageFinalization(response.request().postData(),body.toString("utf8"),fixture.workspaceId));
    }catch{witnessFailed=true;}})();reads.add(work);void work.finally(()=>reads.delete(work));
  }
  page.on("response",observe);
  const expected = IMAGE_HOST_PHASES[scenario], prompt = "A blue square on a plain white background.";
  const taskKey = imageTaskStorageKey(fixture.host, fixture.workspaceId);
  async function step(phase: string, action: () => Promise<void>) {
    if (expected[phases.length] !== phase) throw new Error("Unexpected image test phase.");
    await action(); phases.push(phase);
  }
  const model = page.getByRole("combobox", {name:/^Model\b/});
  const text = page.getByLabel(/^Prompt\b/);
  async function openImagePage() {
    await page.getByRole("button", { name:"Image Generation", exact:true }).click();
    await expect(text).toBeVisible({timeout:IMAGE_HOST_PHASE_TIMEOUT_MS});
  }
  try {
    await step("input-checkpoint-visible", async () => {
      await expect(page.getByLabel("Select current workspace", {exact:true})).toHaveValue(fixture.workspaceId, {timeout:IMAGE_HOST_PHASE_TIMEOUT_MS});
      await page.getByRole("button", {name:"Home",exact:true}).click();
      await expect(page.getByRole("heading", {name:IMAGE_HOST_WORKSPACE_NAME,exact:true})).toBeVisible();
      await openImagePage();
      const option = model.locator("option").filter({hasText:"Image qualification checkpoint"});
      await expect(option).toHaveCount(1, {timeout:IMAGE_HOST_PHASE_TIMEOUT_MS});
      const value = await option.getAttribute("value");
      expect(value).toBe(fixture.modelRecordId);
      await model.selectOption(value!);
      const face = page.getByRole("checkbox", {name:/FaceID/i});
      if (await face.count()) await expect(face).not.toBeChecked();
    });
    await step("bounded-request-entered", async () => {
      await text.fill(prompt);
      await page.getByLabel(/^Negative Prompt\b/i).fill("letters, watermarks");
      for (const [name,value] of [[/^Seed\b/,"7"],[/^Width\b/,"256"],[/^Height\b/,"256"],[/^Steps\b/,"1"],
        [/^CFG\b/,"1"],[/^Sampler\b/,"euler"],[/^Scheduler\b/,"normal"],[/^Number of Images\b/i,"1"]] as const) {
        await page.getByLabel(name).fill(value);
      }
      await expect(page.getByRole("button", {name:"Generate",exact:true})).toBeEnabled();
    });
    if (scenario === "task-recovery") {
      await step("navigation-preserves-draft", async () => {
        await page.getByRole("button", {name:"Home",exact:true}).click();
        await expect(page.getByRole("heading", {name:IMAGE_HOST_WORKSPACE_NAME,exact:true})).toBeVisible();
        await openImagePage();
        await expect(text).toHaveValue(prompt);
        await expect(model).toHaveValue(fixture.modelRecordId);
      });
      // Pause renderer polling only. ComfyUI and the host keep real clocks and
      // produce real output. This variation supplies no performance evidence.
      await page.clock.install({time:new Date()});
      await page.clock.pauseAt(new Date(Date.now()+100)); paused = true;
    }
    await step("request-accepted", async () => {
      await page.getByRole("button", {name:"Generate",exact:true}).click({force:paused});
      await expect.poll(async () => {
        const value = await page.evaluate(key=>sessionStorage.getItem(key), taskKey);
        try { requestId = imagePublicId(value); return true; } catch { return false; }
      }, {timeout:IMAGE_HOST_PHASE_TIMEOUT_MS}).toBe(true);
    });
    if (scenario === "task-recovery") {
      await step("reload-restores-task", async () => {
        // Observe the actual cached task at document start. Do not inject task
        // state, task success, a provider response or a generated artifact.
        await page.addInitScript(key => Object.defineProperty(window, "__imageHostObservedTask", {value:sessionStorage.getItem(key),configurable:true}), taskKey);
        await page.reload({waitUntil:"domcontentloaded"});
        await page.clock.resume(); paused = false;
        await expect(page.getByLabel("Select current workspace", {exact:true})).toHaveValue(fixture.workspaceId, {timeout:IMAGE_HOST_PHASE_TIMEOUT_MS});
        expect(await page.evaluate(()=>Reflect.get(window,"__imageHostObservedTask"))).toBe(requestId);
        await openImagePage();
        await expect(page.getByText(`${fixture.host==="packaged-desktop"?"Request:":"Request ID:"} ${requestId}`,{exact:true})).toBeVisible({timeout:IMAGE_HOST_PHASE_TIMEOUT_MS});
      });
    }
    await step("real-output-decoded", async () => {
      const image = page.getByRole("img", {name:/^Generated image(?:\s|$)/});
      await expect(image).toHaveCount(1, {timeout:IMAGE_HOST_PHASE_TIMEOUT_MS});
      await expect.poll(async () => {
        try { generated = await image.evaluate(readRenderedImageBytes); return true; } catch { return false; }
      }, {timeout:IMAGE_HOST_PHASE_TIMEOUT_MS}).toBe(true);
      expect(generated?.sha256).toMatch(/^[a-f0-9]{64}$/);
    });
    await step("registration-confirmed", async () => {
      if (fixture.host === "packaged-desktop") {
        const current = page.locator("figure").filter({has:page.getByRole("img", {name:"Generated image",exact:true})});
        await expect(current).toHaveCount(1);
        await current.getByText("Developer details", {exact:true}).click();
        saved={assetId:imagePublicId((await current.getByText(/^Asset ID:/).innerText()).replace(/^Asset ID:\s*/,"")),
          artifactId:imageArtifactId((await current.getByText(/^Artifact ID:/).innerText()).replace(/^Artifact ID:\s*/,"")),
          storageKey:imageStorageKey((await current.getByText(/^Storage key:/).innerText()).replace(/^Storage key:\s*/,""))};
      } else {
        const label = await page.getByRole("img", {name:/^Generated image\s/}).getAttribute("alt");
        const assetId=imagePublicId(label?.replace(/^Generated image\s/,""));
        await expect.poll(()=>witnesses.some(item=>item.requestId===requestId&&item.assetId===assetId),{timeout:IMAGE_HOST_PHASE_TIMEOUT_MS}).toBe(true);
        await Promise.all([...reads]);expect(witnessFailed).toBe(false);
        const witness=witnesses.find(item=>item.requestId===requestId&&item.assetId===assetId)!;
        saved={assetId:witness.assetId,artifactId:witness.artifactId,storageKey:witness.storageKey};
      }
      await expect(page.getByText(`${fixture.host==="packaged-desktop"?"Request:":"Request ID:"} ${requestId}`,{exact:true})).toBeVisible();
    });
    async function reopenExact() {
      await page.getByRole("button", {name:"Artifacts",exact:true}).click();
      await page.getByRole("tab", {name:"Artifact Browser",exact:true}).click();
      const browser = page.getByRole("tabpanel", {name:"Artifact Browser",exact:true});
      if (fixture.host === "packaged-desktop") {
        const card = browser.locator("article").filter({has:page.getByRole("heading", {name:/\.png$/i})});
        await expect(card).toHaveCount(1, {timeout:IMAGE_HOST_PHASE_TIMEOUT_MS});
        await card.getByRole("button", {name:"View Details",exact:true}).click();
      } else {
        const row = browser.getByRole("button", {name:/\.png$/i});
        await expect(row).toHaveCount(1, {timeout:IMAGE_HOST_PHASE_TIMEOUT_MS});
        await row.click();
        // Existing authenticated read-only contract binds the observed result's
        // artifact ID to the exact key selected in the public browser UI.
        if(serverOrigin!=="http://127.0.0.1:43170")throw new Error("Fixed image Server origin is required.");
        const token=process.env.VISUAL_COMPOSER_THIN_CLIENT_BEARER_TOKEN;
        if(!token)throw new Error("Owned image test credential is unavailable.");
        const response=await page.request.post(serverOrigin+"/api/artifact/browse",{headers:{authorization:`Bearer ${token}`},data:{workspaceId:fixture.workspaceId,source:"image-host-qualification"},timeout:IMAGE_HOST_PHASE_TIMEOUT_MS});
        try{expect(response.ok()).toBe(true);const bytes=await response.body();expect(bytes.byteLength).toBeLessThanOrEqual(16384);
          const value=JSON.parse(bytes.toString("utf8"));expect(value.ok).toBe(true);
          const items=value.value.items;expect(Array.isArray(items)).toBe(true);
          const imageItems=items.filter((item:{storageKey?:unknown})=>typeof item.storageKey==="string"&&item.storageKey.endsWith(".png"));
          expect(imageItems).toHaveLength(1);expect(imageItems[0].artifactId).toBe(saved!.storageKey);expect(imageItems[0].storageKey).toBe(saved!.storageKey);
        }finally{await response.dispose();}
      }
      const selectedKey=page.locator("dt").filter({hasText:"Selected key"}).locator("xpath=following-sibling::dd[1]");
      await expect(selectedKey).toHaveCount(1);await expect(selectedKey).toHaveText(saved!.storageKey);
      const image = page.getByRole("region", {name:"Artifact preview",exact:true}).getByRole("img");
      await expect.poll(async () => {
        try { return await image.evaluate(readRenderedImageBytes); } catch { return null; }
      }, {timeout:IMAGE_HOST_PHASE_TIMEOUT_MS}).toEqual(generated);
    }
    await step("exact-artifact-reopened", reopenExact);
    await step(scenario === "task-recovery" ? "no-duplicate-registration" : "reload-preserves-artifact", async () => {
      await page.reload();
      await expect(page.getByLabel("Select current workspace", {exact:true})).toHaveValue(fixture.workspaceId, {timeout:IMAGE_HOST_PHASE_TIMEOUT_MS});
      await reopenExact();
    });
  } catch { failed = true; }
  finally { page.off("response",observe);await Promise.all([...reads]);if(witnessFailed)failed=true;
    if (paused) { try { await page.clock.resume(); } catch { failed = true; } } }
  await publishImageHostOutcome(info,imageHostReport(fixture.host,scenario,phases,failed));
}
