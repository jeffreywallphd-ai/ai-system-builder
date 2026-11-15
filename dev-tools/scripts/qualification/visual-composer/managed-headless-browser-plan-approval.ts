import assert from "node:assert/strict";
import {createHash, randomUUID} from "node:crypto";
import {writeFile} from "node:fs/promises";
import path from "node:path";
import {chromium, type Browser} from "@playwright/test";

import {HEADLESS_CONTRACT_VERSION, isHeadlessHostIncarnationId,
  parseHeadlessBuildPlanProposal} from "../../../../modules/contracts/headless";
import {MANAGED_HEADLESS_AGENT_PATHS, MANAGED_SAVED_STATE_PATHS} from "../../../../modules/adapters/transport/api-express/security/apiRouteSecurityPolicy";
import {startManagedReferenceHost} from "./managed-reference-host";

async function main() {
  const fixture = await startManagedReferenceHost(process.env.MANAGED_REFERENCE_DATABASE ?? "",
    {headlessAgent:true, headlessBrowser:true, headlessPlanReview:true});
  const checks: Record<string, boolean | number> = {};
  let browser: Browser | undefined;
  let stage = "load";
  let passed = false;
  try {
    const {agent, serverOrigin, organizationId} = fixture;
    assert.ok(agent?.planReview && "browserPin" in fixture && fixture.browserPin);
    assert.match(fixture.browserPin,/^[A-Za-z0-9+/]{43}=$/);
    stage = "workspace-selection";
    const select = await fixture.request("/api/workspaces", {method:"POST", token:agent.browser, organizationId,
      body:{command:{displayName:"Synthetic plan review workspace"}, selectAfterCreate:true}});
    assert.equal(select.status,201);
    const workspaceId = select.body.value.workspace.workspaceId;
    const {read, "plan-review":review} = MANAGED_HEADLESS_AGENT_PATHS;
    const send = (route:string, body:object) => fixture.request(route,{method:"POST", token:agent.planReview, organizationId, body});
    const described = await send(read,{version:HEADLESS_CONTRACT_VERSION,operation:"host.describe",input:{}});
    checks.host_describe_status = described.status;
    assert.equal(described.status,200);
    const hostIncarnationId = described.body.value.hostIncarnationId;
    assert.ok(isHeadlessHostIncarnationId(hostIncarnationId));
    const scope = {hostIncarnationId,workspaceId};
    const snapshot = () => fixture.request(MANAGED_SAVED_STATE_PATHS.snapshot,{method:"POST", token:agent.browser, organizationId, body:{workspaceId}});
    const before = await snapshot();
    checks.baseline_snapshot_status = before.status;
    assert.equal(before.status,200);
    stage = "chrome-startup";
    browser = await chromium.launch({channel:"chrome", headless:true,
      args:[`--ignore-certificate-errors-spki-list=${fixture.browserPin}`]});
    const context = await browser.newContext({viewport:{width:1280,height:900}, acceptDownloads:false, serviceWorkers:"block"});
    await context.route("**/*", route => new URL(route.request().url()).origin === serverOrigin ? route.continue() : route.abort());
    await context.addInitScript(({origin, bearer}) => {
      if (location.origin === origin) localStorage.setItem("ai-system-builder.paired-device-token",bearer);
    },{origin:serverOrigin,bearer:agent.browser});
    const page = await context.newPage();
    page.setDefaultTimeout(15_000);
    stage = "load-systems";
    await page.goto(serverOrigin + "/systems",{waitUntil:"domcontentloaded"});
    await page.getByRole("heading",{name:"Systems",exact:true}).waitFor();
    stage = "navigate-to-settings";
    await page.locator('button.ui-shell__settings-button[aria-label="Settings"]').click();
    const settings = page.getByRole("heading",{name:"Settings",exact:true});
    await settings.waitFor();
    const trigger = page.getByRole("button",{name:"Review plan requests",exact:true});
    const dialog = page.getByRole("dialog",{name:"Review plan requests",exact:true});
    stage = "wait-for-approval-button";
    await trigger.waitFor();
    stage = "modal-layout";
    const initial = await settings.boundingBox();
    await trigger.click();
    await dialog.waitFor();
    const shown = await settings.boundingBox();
    assert.ok(initial && shown);
    checks.heading_movement_px = Math.max(Math.abs(shown.x-initial.x), Math.abs(shown.y-initial.y),
      Math.abs(shown.width-initial.width), Math.abs(shown.height-initial.height));
    assert.equal(checks.heading_movement_px,0);
    stage = "keyboard-close";
    await page.keyboard.press("Escape");
    await dialog.waitFor({state:"hidden"});
    assert.equal(await trigger.evaluate(button => button === document.activeElement),true);
    checks.modal_layout_and_keyboard = true;

    async function propose(name:string) {
      const steps = [1,2].map(index => ({operation:"systems.create",name:`Synthetic ${name} ${index}`,
        templateId:"reference.secured-data-review@1.0.0",idempotencyKey:randomUUID()}));
      const parsed = parseHeadlessBuildPlanProposal({...scope,steps},hostIncarnationId);
      assert.ok(parsed.ok);
      const fingerprint = createHash("sha256").update(JSON.stringify(parsed.preview)).digest("hex");
      const reply = await send(review,{version:HEADLESS_CONTRACT_VERSION,operation:"plan.submit",input:{...scope,fingerprint,steps}});
      assert.equal(reply.status,200);
      assert.equal(reply.body.value.status,"pending");
      await trigger.click();
      await dialog.getByRole("button",{name:new RegExp("^Review request " + fingerprint.slice(0,8) + " from Client ")}).click();
      await dialog.getByRole("list",{name:"Requested changes"}).waitFor();
      for (const step of steps) await dialog.getByText(step.name,{exact:false}).waitFor();
      return fingerprint;
    }
    async function status(fingerprint:string, expected:string, steps:number) {
      const response = await send(review,{version:HEADLESS_CONTRACT_VERSION,operation:"plan.status",input:{...scope,fingerprint}});
      assert.equal(response.status,200);
      assert.equal(response.body.value.status,expected);
      assert.equal(response.body.value.approvedSteps,steps);
    }
    stage = "whole-plan";
    const whole = await propose("whole plan");
    await dialog.getByRole("radio",{name:"Approve all listed changes"}).check();
    await dialog.getByRole("button",{name:"Approve all changes",exact:true}).click();
    await dialog.getByText("All 2 changes are approved.",{exact:true}).waitFor();
    await status(whole,"approved",2);
    await dialog.getByRole("button",{name:"Withdraw approval",exact:true}).click();
    await dialog.getByText("Approval withdrawn.",{exact:true}).waitFor();
    await status(whole,"revoked",2);
    await page.keyboard.press("Escape");
    await dialog.waitFor({state:"hidden"});
    checks.whole_plan_and_withdrawal = true;

    stage = "per-change";
    const individual = await propose("individual step");
    await dialog.getByRole("button",{name:"Approve change 1",exact:true}).click();
    await dialog.getByText("1 of 2 changes approved.",{exact:true}).waitFor();
    await status(individual,"pending",1);
    await dialog.getByRole("button",{name:"Approve change 2",exact:true}).click();
    await dialog.getByText("All 2 changes are approved.",{exact:true}).waitFor();
    await status(individual,"approved",2);
    checks.individual_choices = true;
    assert.deepEqual((await snapshot()).body,before.body);
    checks.saved_systems_unchanged = true;
    passed = true;
  } catch {
    // Report only fixed stages and check outcomes.
  } finally {
    if (passed) stage = "cleanup";
    await browser?.close().catch(() => {passed=false;});
    await fixture.stop().catch(() => {passed=false;});
    const evidence = {schema_version:"managed-browser-plan-popup-v1",source_revision:fixture.sourceRevision,
      status:passed ? "passed" : "failed",stage:passed ? "complete" : stage,checks};
    await writeFile(path.join(fixture.runRoot,"managed-headless-plan-popup-evidence.json"),JSON.stringify(evidence,null,2)+"\n",{flag:"wx"});
    process.stdout.write(JSON.stringify(evidence)+"\n");
  }
  if (!passed) process.exitCode = 1;
}

void main().catch(() => {
  process.stderr.write('{"status":"failed","code":"managed-headless.plan-popup-unqualified"}\n');
  process.exitCode = 1;
});
