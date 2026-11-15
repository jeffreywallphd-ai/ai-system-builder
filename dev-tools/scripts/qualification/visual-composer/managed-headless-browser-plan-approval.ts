import assert from "node:assert/strict";
import {createHash, randomUUID} from "node:crypto";
import {writeFile} from "node:fs/promises";
import path from "node:path";
import {chromium, type Browser} from "@playwright/test";
import {Client} from "@modelcontextprotocol/client";
import {StdioClientTransport} from "@modelcontextprotocol/client/stdio";

import {HEADLESS_CONTRACT_VERSION, isHeadlessHostIncarnationId,
  parseHeadlessBuildPlanProposal} from "../../../../modules/contracts/headless";
import {MANAGED_HEADLESS_AGENT_PATHS, MANAGED_SAVED_STATE_PATHS} from "../../../../modules/adapters/transport/api-express/security/apiRouteSecurityPolicy";
import {startManagedReferenceHost} from "./managed-reference-host";

async function main() {
  const fixture = await startManagedReferenceHost(process.env.MANAGED_REFERENCE_DATABASE ?? "",
    {headlessAgent:true, headlessBrowser:true, headlessPlanReview:true});
  const checks: Record<string, boolean | number> = {};
  const client = new Client({name:"managed-approved-step-qualification",version:"1.0.0"});
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
    const planRoute = MANAGED_HEADLESS_AGENT_PATHS["plan-step"];
    await client.connect(new StdioClientTransport({command:process.execPath,
      args:["--import","tsx",path.resolve("modules/adapters/transport/headless-mcp/serveHeadlessMcpReadAdapter.mts")],
      stderr:"ignore", maxBufferSize:256 * 1024, env:{
        AISB_HEADLESS_MODE:"managed", AISB_HEADLESS_ENABLE_PLAN_REVIEW:"1",
        AISB_HEADLESS_ENABLE_AUTHORING:"1", AISB_HEADLESS_ENABLE_CONVERSATION:"1",
        AISB_HEADLESS_ENABLE_MANAGED_CONSENT:"1", AISB_HEADLESS_ENABLE_MANAGED_PRESENTATION:"1",
        AISB_HEADLESS_MANAGED_ORIGIN:serverOrigin, AISB_HEADLESS_MANAGED_WORKSPACE_ID:workspaceId,
        AISB_HEADLESS_MANAGED_ORGANIZATION_ID:organizationId, AISB_HEADLESS_MANAGED_CREDENTIAL:agent.planReview,
        NODE_EXTRA_CA_CERTS:agent.caFile, TSX_DISABLE_CACHE:"1",
      }}), {timeout:10_000});
    const toolList = await client.listTools();
    assert.deepEqual(toolList.tools.map(tool => tool.name).sort(), [
      "aisb_build_plan_approval_status", "aisb_host_describe", "aisb_list_templates", "aisb_plan_capabilities",
      "aisb_preview_build_plan", "aisb_read_system", "aisb_request_build_plan_approval", "aisb_run_approved_build_step",
    ]);
    async function call(name:string, input:Record<string, unknown> = {}) {
      const reply = await client.callTool({name,arguments:input},undefined,{timeout:8_000});
      assert.ok(Array.isArray(reply.content) && reply.content.length === 1 && reply.content[0].type === "text");
      return JSON.parse(reply.content[0].text);
    }
    const described = await call("aisb_host_describe");
    assert.equal(described.ok,true);
    const hostIncarnationId = described.value.hostIncarnationId;
    assert.ok(isHeadlessHostIncarnationId(hostIncarnationId));
    const scope = {hostIncarnationId,workspaceId};
    checks.plan_only_stdio_catalog = true;
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
      const preview = await call("aisb_preview_build_plan",{...scope,steps});
      assert.equal(preview.ok,true);
      assert.equal(preview.value.fingerprint,fingerprint);
      const reply = await call("aisb_request_build_plan_approval",{...scope,fingerprint,steps});
      assert.equal(reply.ok,true);
      assert.equal(reply.value.status,"pending");
      await trigger.click();
      await dialog.getByRole("button",{name:new RegExp("^Review request " + fingerprint.slice(0,8) + " from Client ")}).click();
      await dialog.getByRole("list",{name:"Requested changes"}).waitFor();
      for (const step of steps) await dialog.getByText(step.name,{exact:false}).waitFor();
      return fingerprint;
    }
    async function status(fingerprint:string, expected:string, steps:number) {
      const response = await call("aisb_build_plan_approval_status",{...scope,fingerprint});
      assert.equal(response.ok,true);
      assert.equal(response.value.status,expected);
      assert.equal(response.value.approvedSteps,steps);
      return response.value;
    }
    const uncertain = {ok:false,code:"headless.operation-unconfirmed"};
    const run = (fingerprint:string, approvalRevision:number, step:number) =>
      call("aisb_run_approved_build_step",{...scope,fingerprint,approvalRevision,step});
    stage = "whole-plan";
    const whole = await propose("whole plan");
    assert.deepEqual(await run(whole,1,1),uncertain);
    await dialog.getByRole("radio",{name:"Approve all listed changes"}).check();
    await dialog.getByRole("button",{name:"Approve all changes",exact:true}).click();
    await dialog.getByText("All 2 changes are approved.",{exact:true}).waitFor();
    const wholeDecision = await status(whole,"approved",2);
    await dialog.getByRole("button",{name:"Withdraw approval",exact:true}).click();
    await dialog.getByText("Approval withdrawn.",{exact:true}).waitFor();
    await status(whole,"revoked",2);
    assert.deepEqual(await run(whole,wholeDecision.revision,1),uncertain);
    await page.keyboard.press("Escape");
    await dialog.waitFor({state:"hidden"});
    checks.whole_plan_and_withdrawal = true;

    stage = "per-change";
    const individual = await propose("individual step");
    await dialog.getByRole("button",{name:"Approve change 1",exact:true}).click();
    await dialog.getByText("1 of 2 changes approved.",{exact:true}).waitFor();
    const partial = await status(individual,"pending",1);
    assert.deepEqual(await run(individual,partial.revision,2),uncertain);
    await dialog.getByRole("button",{name:"Approve change 2",exact:true}).click();
    await dialog.getByText("All 2 changes are approved.",{exact:true}).waitFor();
    const approved = await status(individual,"approved",2);
    checks.individual_choices = true;
    assert.deepEqual((await snapshot()).body,before.body);
    checks.approval_leaves_saved_systems_unchanged = true;

    stage = "exact-step-scope";
    const input = {...scope,fingerprint:individual,approvalRevision:approved.revision,step:1};
    const wire = {version:HEADLESS_CONTRACT_VERSION,operation:"plan.run-step",input};
    for (const token of [agent.browser,agent.access,...(agent.ordinaryPlanCredentials ?? [])])
      assert.equal((await fixture.request(planRoute,{method:"POST",token,organizationId,body:wire})).status,403);
    assert.equal((await fixture.request(planRoute,{method:"POST",token:agent.planReview,organizationId,
      body:{...wire,input:{...input,workspaceId:agent.workspaceId}}})).status,403);
    assert.deepEqual(await run(individual,partial.revision,1),uncertain);
    assert.deepEqual(await run(individual,approved.revision,2),uncertain);
    assert.deepEqual((await snapshot()).body,before.body);
    checks.wrong_client_workspace_revision_and_order_leave_no_effects = true;

    stage = "first-commit-and-replay";
    const first = await run(individual,approved.revision,1);
    assert.equal(first.ok,true);
    assert.equal(first.value.kind,"committed");
    assert.equal(first.value.expiresAt,approved.expiresAt);
    assert.deepEqual(await run(individual,approved.revision,1),{ok:true,value:{...first.value,kind:"replayed"}});
    const second = await run(individual,approved.revision,2);
    assert.equal(second.ok,true);
    assert.equal(second.value.kind,"committed");
    assert.notEqual(first.value.reference.systemId,second.value.reference.systemId);
    const after = await snapshot();
    assert.equal(after.status,200);
    assert.equal(after.body.value.systems.length,before.body.value.systems.length + 2);
    for (const [index, effect] of [first,second].entries()) {
      const reference = effect.value.reference;
      const loaded = await call("aisb_read_system",{...scope,systemId:reference.systemId});
      assert.equal(loaded.ok,true);
      assert.equal(loaded.value.name,`Synthetic individual step ${index + 1}`);
      assert.equal(loaded.value.currentRevisionId,reference.revisionId);
      assert.equal(loaded.value.revision,reference.recordRevision);
    }
    checks.ordered_effects_and_exact_replay = true;

    stage = "withdraw-after-save";
    await dialog.getByRole("button",{name:"Withdraw approval",exact:true}).click();
    await dialog.getByText("Approval withdrawn.",{exact:true}).waitFor();
    await status(individual,"revoked",2);
    assert.deepEqual(await run(individual,approved.revision,1),uncertain);
    assert.deepEqual((await snapshot()).body,after.body);
    checks.withdrawal_preserves_saves_and_closes_replay = true;
    passed = true;
  } catch {
    // Report only fixed stages and check outcomes.
  } finally {
    if (passed) stage = "cleanup";
    await browser?.close().catch(() => {passed=false;});
    await client.close().catch(() => {passed=false;});
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
