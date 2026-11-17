import assert from "node:assert/strict";
import {createHash, randomUUID} from "node:crypto";
import {lstat, mkdir, open, realpath, writeFile} from "node:fs/promises";
import path from "node:path";
import {setTimeout as delay} from "node:timers/promises";
import {chromium, expect, type Browser, type Locator} from "@playwright/test";
import {Client} from "@modelcontextprotocol/client";
import {StdioClientTransport} from "@modelcontextprotocol/client/stdio";

import {HEADLESS_CONTRACT_VERSION, isHeadlessHostIncarnationId,
  parseHeadlessBuildPlanProposal} from "../../../../modules/contracts/headless";
import {
  createApiHuggingFaceDatasetParquetFilesBrowseSuccessResponse,
  createApiHuggingFaceNamespaceDatasetsBrowseSuccessResponse,
} from "../../../../modules/contracts/api";
import {copyBoundedPassiveData, normalizePassiveText, readStrictPassiveRecord} from "../../../../modules/contracts/shared";
import {MANAGED_HEADLESS_AGENT_PATHS, MANAGED_SAVED_STATE_PATHS} from "../../../../modules/adapters/transport/api-express/security/apiRouteSecurityPolicy";
import {startManagedReferenceHost} from "./managed-reference-host";

const FRONTIER_TASK = "Create one saved system named Facilities requests from the Secured Data Review template in the configured local test workspace.";
const FRONTIER_NAME = "Facilities requests";
const FRONTIER_TEMPLATE = "reference.secured-data-review@1.0.0";
const FRONTIER_DURATION_MS = 240_000;
const FRONTIER_INPUT_MAX_BYTES = 4_096;

/** An explicit one-plan fixture. Its mailbox accepts only the expected synthetic action at each step. */
async function runFrontierCase(options: {
  readonly runRoot: string;
  readonly tools: readonly { readonly name: string; readonly inputSchema: object }[];
  readonly scope: { readonly hostIncarnationId: import("../../../../modules/contracts/headless").HeadlessHostIncarnationId;
    readonly workspaceId: string };
  readonly call: (name: string, input?: Record<string, unknown>) => Promise<any>;
  readonly snapshot: () => Promise<any>;
  readonly trigger: Locator;
  readonly dialog: Locator;
  readonly reportStage: (stage: string) => void;
}) {
  const {runRoot, tools, scope, call, snapshot, trigger, dialog, reportStage} = options;
  const mailbox = path.join(runRoot, "frontier-choices");
  await mkdir(mailbox);
  const started = performance.now();
  const before = await snapshot();
  assert.equal(before.status, 200);
  const trace: object[] = [];
  let index = 0;
  let toolCalls = 0;
  function emit(event: object) {
    trace.push(event);
    process.stdout.write(JSON.stringify(event) + "\n");
  }
  emit({
    kind: "frontier-ready",
    inbox: path.relative(process.cwd(), mailbox).replaceAll(path.sep, "/"),
    request: FRONTIER_TASK,
    configuredWorkspaceId: scope.workspaceId,
    tools: tools.map(({ name, inputSchema }) => ({ name, inputSchema })),
    limits: { maximumToolCalls: 10, deadlineMs: FRONTIER_DURATION_MS },
  });

  async function choice(expected: string) {
    const current = ++index;
    reportStage("frontier-" + expected);
    emit({kind: "frontier-await", index: current});
    const file = path.join(mailbox, `choice-${current}.json`);
    while (performance.now() - started < FRONTIER_DURATION_MS) {
      const info = await lstat(file).catch(error => {
        if (error.code === "ENOENT") return undefined;
        throw error;
      });
      if (!info) {
        await delay(200);
        continue;
      }
      assert.ok(info.isFile() && !info.isSymbolicLink() && info.size > 0 && info.size <= FRONTIER_INPUT_MAX_BYTES);
      assert.equal(await realpath(file), file);
      const fileHandle = await open(file, "r");
      const bytes = Buffer.alloc(info.size + 1);
      try {
        const opened = await fileHandle.stat();
        assert.ok(opened.isFile() && opened.size === info.size && opened.ino === info.ino && opened.dev === info.dev);
        const {bytesRead} = await fileHandle.read(bytes, 0, bytes.length, 0);
        assert.equal(bytesRead, info.size);
      } finally {
        await fileHandle.close();
      }
      const {tool, arguments: input} = readStrictPassiveRecord(
        JSON.parse(bytes.subarray(0, info.size).toString("utf8")), ["tool", "arguments"]);
      assert.equal(tool, expected);
      return copyBoundedPassiveData(input);
    }
    throw new Error("The synthetic frontier case exceeded its qualification deadline.");
  }
  async function invoke(name: string, validate: (input: Record<string, unknown>) => void) {
    const proposed = await choice(name);
    assert.ok(proposed && typeof proposed === "object" && !Array.isArray(proposed));
    const input = proposed as Record<string, unknown>;
    validate(input);
    assert.ok(++toolCalls <= 10);
    const result = await call(name, input);
    assert.equal(result.ok, true);
    emit({kind: "frontier-tool-result", index, tool: name, result});
    return result.value;
  }
  function requireScope(input: Record<string, unknown>): void {
    assert.deepEqual(input, scope);
  }
  const described = await invoke("aisb_host_describe", (input) => {
    assert.deepEqual(input, {});
  });
  assert.equal(described.hostIncarnationId, scope.hostIncarnationId);
  const capabilities = await invoke("aisb_plan_capabilities", requireScope);
  assert.ok(capabilities.actions.includes("systems.create"));
  await invoke("aisb_list_templates", requireScope);

  let agreedSteps: unknown;
  const preview = await invoke("aisb_preview_build_plan", (input) => {
    const parsed = parseHeadlessBuildPlanProposal(input, scope.hostIncarnationId);
    assert.ok(parsed.ok && parsed.scope.workspaceId === scope.workspaceId && parsed.requests.length === 1);
    const [request] = parsed.requests;
    assert.ok(request?.operation === "systems.create" && request.input.name === FRONTIER_NAME &&
      request.input.templateId === FRONTIER_TEMPLATE);
    agreedSteps = input.steps;
  });
  assert.match(preview.fingerprint, /^[a-f0-9]{64}$/);
  const target = {...scope, fingerprint: preview.fingerprint};
  const submitted = await invoke("aisb_request_build_plan_approval", (input) => {
    assert.deepEqual(input, {...target, steps:agreedSteps});
  });
  assert.equal(submitted.status, "pending");
  assert.equal(submitted.approvedSteps, 0);
  const inspectApproval = (input: Record<string, unknown>): void => assert.deepEqual(input, target);
  const pending = await invoke("aisb_build_plan_approval_status", inspectApproval);
  assert.equal(pending.status, "pending");
  assert.equal(pending.revision, submitted.revision);
  assert.deepEqual((await snapshot()).body, before.body);

  const message = readStrictPassiveRecord(await choice("await-app-approval"), ["fingerprint", "userMessage"]);
  assert.equal(message.fingerprint, target.fingerprint);
  const approvalMessage = normalizePassiveText(message.userMessage);
  assert.ok(approvalMessage.length >= 8 && approvalMessage.length <= 500);
  await trigger.click();
  await dialog.getByRole("button", {name:new RegExp("^Review request " + target.fingerprint.slice(0,8) + " from Client ")}).click();
  await dialog.getByRole("list", {name:"Permissions and limits"}).getByText("Limit of 1 saved change for this plan.").waitFor();
  await dialog.getByRole("list", {name:"Requested changes"}).getByText("Create " + FRONTIER_NAME, {exact:false}).waitFor();
  await dialog.getByRole("radio", {name:"Approve all listed changes"}).check();
  await dialog.getByRole("button", {name:"Approve all changes", exact:true}).click();
  await dialog.getByText("The change is approved.", {exact:true}).waitFor();
  emit({kind:"frontier-app-decision", outcome:"approved-in-popup"});
  const approved = await invoke("aisb_build_plan_approval_status", inspectApproval);
  assert.equal(approved.status, "approved");
  assert.equal(approved.approvedSteps, 1);
  assert.equal(approved.expiresAt, submitted.expiresAt);
  const saved = await invoke("aisb_run_approved_build_step", (input) => {
    assert.deepEqual(input, {...target, approvalRevision: approved.revision, step:1});
  });
  assert.equal(saved.kind, "committed");
  const reference = saved.reference;
  const checked = await invoke("aisb_read_system", (input) => {
    assert.deepEqual(input, {...scope, systemId: reference.systemId});
  });
  assert.equal(checked.name, FRONTIER_NAME);
  assert.equal(checked.currentRevisionId, reference.revisionId);
  assert.equal(checked.revision, reference.recordRevision);
  const after = await snapshot();
  assert.equal(after.status, 200);
  assert.equal(after.body.value.systems.length, before.body.value.systems.length + 1);
  const summary = readStrictPassiveRecord(await choice("report-saved"), ["systemId", "revisionId", "recordRevision", "userMessage"]);
  assert.equal(summary.systemId, reference.systemId);
  assert.equal(summary.revisionId, reference.revisionId);
  assert.equal(summary.recordRevision, reference.recordRevision);
  const savedMessage = normalizePassiveText(summary.userMessage);
  assert.ok(savedMessage.length >= 8 && savedMessage.length <= 500);
  const elapsedMs = Math.round(performance.now() - started);
  assert.ok(elapsedMs <= FRONTIER_DURATION_MS);
  await writeFile(path.join(runRoot,"frontier-plan-report.json"), JSON.stringify({
    schema_version:"headless-frontier-plan-v1", status:"passed", tool_calls:toolCalls,
    elapsed_ms:elapsedMs, synthetic_results:1, events:trace,
    approval_message_validated:true, saved_message_validated:true,
  },null,2) + "\n",{flag:"wx"});
}

async function main() {
  const frontier = process.env.AISB_QUALIFY_FRONTIER_PLAN === "1";
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
      "aisb_build_plan_approval_status", "aisb_host_describe", "aisb_ingestion_status", "aisb_list_templates", "aisb_plan_capabilities",
      "aisb_preview_build_plan", "aisb_preview_selected_local_file", "aisb_preview_selected_provider_file", "aisb_read_system",
      "aisb_request_build_plan_approval", "aisb_run_approved_build_step",
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
    if (frontier) {
      await runFrontierCase({runRoot:fixture.runRoot, tools:toolList.tools, scope, call, snapshot, trigger, dialog,
        reportStage: value => { stage = value; }});
      checks.frontier_agent_approved_create_and_readback = true;
      passed = true;
      return;
    }
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

    async function openProposal(fingerprint:string, panel:Locator) {
      await panel.getByRole("button",{name:new RegExp("^Review request " + fingerprint.slice(0,8) + " from Client ")}).click();
      await panel.getByRole("list",{name:"Requested changes"}).waitFor();
      await panel.getByRole("list",{name:"Permissions and limits"}).getByText("Limit of 2 saved changes for this plan.").waitFor();
    }
    async function propose(name:string, panel = dialog, activate = () => trigger.click()) {
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
      await activate();
      await openProposal(fingerprint,panel);
      for (const step of steps) await panel.getByText(step.name,{exact:false}).waitFor();
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

    stage = "denied-plan";
    const denied = await propose("declined plan");
    await dialog.getByRole("button", { name: "Deny request", exact: true }).press("Enter");
    await dialog.getByText("Request denied.", { exact: true }).waitFor();
    const deniedState = await status(denied, "denied", 0);
    assert.deepEqual(await run(denied, deniedState.revision, 1), uncertain);
    assert.deepEqual((await snapshot()).body, before.body);
    await page.keyboard.press("Escape");
    await dialog.waitFor({ state: "hidden" });
    checks.denied_plan_has_no_effect = true;

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
    await page.keyboard.press("Escape");
    await dialog.waitFor({state:"hidden"});

    const chatTrigger = page.getByRole("button",{name:"Open plan approval chat",exact:true});
    const chat = page.getByRole("region",{name:"Plan approval chat",exact:true});
    const openChat = () => chatTrigger.click();
    stage = "chat-whole-plan-and-popup-withdrawal";
    const chatWhole = await propose("chat whole plan",chat,openChat);
    await chat.getByRole("radio",{name:"Approve all listed changes"}).check();
    await chat.getByRole("button",{name:"Approve all changes",exact:true}).click();
    await chat.getByText("All 2 changes are approved.",{exact:true}).waitFor();
    await status(chatWhole,"approved",2);
    await chat.getByRole("button",{name:"Close plan approval chat",exact:true}).click();
    assert.equal(await chatTrigger.evaluate(button => button === document.activeElement),true);
    await trigger.click();
    await openProposal(chatWhole,dialog);
    await dialog.getByRole("button",{name:"Withdraw approval",exact:true}).click();
    await dialog.getByText("Approval withdrawn.",{exact:true}).waitFor();
    await status(chatWhole,"revoked",2);
    await page.keyboard.press("Escape");
    await dialog.waitFor({state:"hidden"});
    checks.chat_whole_plan_and_popup_withdrawal = true;

    stage = "chat-individual-approval-and-stale-cross-channel-choice";
    const chatEach = await propose("chat individual change",chat,openChat);
    await chat.getByRole("button",{name:"Approve change 1",exact:true}).click();
    await chat.getByText("1 of 2 changes approved.",{exact:true}).waitFor();
    const chatPartial = await status(chatEach,"pending",1);
    assert.deepEqual(await run(chatEach,chatPartial.revision,2),uncertain);
    const firstFromChat = await run(chatEach,chatPartial.revision,1);
    assert.equal(firstFromChat.value.kind,"committed");
    await trigger.click();
    await openProposal(chatEach,dialog);
    await dialog.getByRole("button",{name:"Approve change 2",exact:true}).click();
    await dialog.getByText("All 2 changes are approved.",{exact:true}).waitFor();
    await page.keyboard.press("Escape");
    await dialog.waitFor({state:"hidden"});
    await chat.getByRole("button",{name:"Approve change 2",exact:true}).click();
    await chat.getByText("The app could not confirm your decision. Check the current request before trying again.",
      {exact:true}).waitFor();
    const chatApproved = await status(chatEach,"approved",2);
    assert.equal(chatApproved.revision,chatPartial.revision + 1);
    assert.equal((await run(chatEach,chatApproved.revision,2)).value.kind,"committed");
    assert.equal((await snapshot()).body.value.systems.length,after.body.value.systems.length + 2);
    checks.chat_individual_and_stale_cross_channel_no_duplicate = true;
    await chat.getByRole("button", { name: "Close plan approval chat", exact: true }).click();

    stage = "chat-individual-submit";
    const chatOnly = await propose("chat only approval", chat, openChat);
    stage = "chat-individual-first-change";
    await chat.getByRole("button", { name: "Approve change 1", exact: true }).click();
    await chat.getByText("1 of 2 changes approved.", { exact: true }).waitFor();
    const chatOnlyPartial = await status(chatOnly, "pending", 1);
    assert.deepEqual(await run(chatOnly, chatOnlyPartial.revision, 2), uncertain);
    const firstChatOnly = await run(chatOnly, chatOnlyPartial.revision, 1);
    assert.equal(firstChatOnly.ok, true);
    assert.equal(firstChatOnly.value.kind, "committed");
    stage = "chat-individual-second-change";
    await chat.getByRole("button", { name: "Approve change 2", exact: true }).click();
    await chat.getByText("All 2 changes are approved.", { exact: true }).waitFor();
    const chatOnlyApproved = await status(chatOnly, "approved", 2);
    assert.equal(chatOnlyApproved.revision, chatOnlyPartial.revision + 1);
    const secondChatOnly = await run(chatOnly, chatOnlyApproved.revision, 2);
    assert.equal(secondChatOnly.ok, true);
    assert.equal(secondChatOnly.value.kind, "committed");
    stage = "chat-individual-verify-saved-records";
    const afterChat = await snapshot();
    assert.equal(afterChat.status, 200);
    assert.equal(afterChat.body.value.systems.length, after.body.value.systems.length + 4);
    assert.notEqual(firstChatOnly.value.reference.systemId, secondChatOnly.value.reference.systemId);
    for (const [index, effect] of [firstChatOnly, secondChatOnly].entries()) {
      const reference = effect.value.reference;
      assert.ok(afterChat.body.value.systems.some((system: { systemId: string; recordRevision: number; revisionId: string }) =>
        system.systemId === reference.systemId && system.recordRevision === reference.recordRevision &&
        system.revisionId === reference.revisionId));
      const loaded = await call("aisb_read_system", { ...scope, systemId: reference.systemId });
      assert.equal(loaded.ok, true);
      assert.equal(loaded.value.name, `Synthetic chat only approval ${index + 1}`);
      assert.equal(loaded.value.currentRevisionId, reference.revisionId);
      assert.equal(loaded.value.revision, reference.recordRevision);
    }
    checks.chat_individual_all_changes_in_chat = true;

    stage = "prepare-local-file";
    await page.getByRole("button",{name:"Artifacts",exact:true}).click();
    await page.getByRole("tab",{name:"Artifact Ingestion",exact:true}).click();
    const workflow = page.getByRole("list",{name:"Add data workflow",exact:true});
    const fileInput = workflow.getByLabel("Choose one or more files",{exact:true});
    const sourceName = "synthetic-managed-preview.csv";
    const buffer = Buffer.from("name,amount\nSample,12\n");
    await fileInput.setInputFiles({name:sourceName,mimeType:"text/csv",buffer});
    await workflow.getByRole("region",{name:"Selected files",exact:true}).getByText("1 file selected",{exact:true}).waitFor();
    const clients = workflow.getByRole("combobox",{name:"Chat client",exact:true});
    await expect(clients.locator("option")).toHaveCount(2);
    await clients.selectOption({index:1});
    await workflow.getByRole("button",{name:"Prepare for chat",exact:true}).click();
    const referenceField = workflow.getByRole("textbox",{name:"File reference",exact:true});
    await expect(referenceField).toHaveValue(/^\{.+\}$/);
    const selectedFile = JSON.parse(await referenceField.inputValue());
    assert.deepEqual(Object.keys(selectedFile).sort(), ["fileId","taskId","taskRevision","workspaceId"]);
    assert.equal(selectedFile.workspaceId,workspaceId);
    checks.browser_prepared_exact_file_reference = true;

    stage = "preview-exact-managed-source";
    const preview = await call("aisb_preview_selected_local_file",{...scope,...selectedFile});
    assert.equal(preview.ok,true);
    assert.deepEqual(preview.value,{...selectedFile,mediaType:"text/csv",fileBytes:buffer.byteLength,
      checkpointExpiresAt:preview.value.checkpointExpiresAt,effect:"save-local-source",externalProviderCalls:0});
    assert.ok(Number.isSafeInteger(preview.value.checkpointExpiresAt) && preview.value.checkpointExpiresAt > Date.now());
    checks.managed_stdio_file_preview = true;
    stage = "deny-other-managed-credentials";
    const previewPath = MANAGED_HEADLESS_AGENT_PATHS["local-file-preview"];
    const wirePreview = {version:HEADLESS_CONTRACT_VERSION,operation:"data.prepare-local-file",input:{...scope,...selectedFile}};
    for (const token of [agent.browser, agent.access])
      assert.equal((await fixture.request(previewPath,{method:"POST",token,organizationId,body:wirePreview})).status,403);
    const foreign = await fixture.request(previewPath,{method:"POST",token:agent.planReview,organizationId,
      body:{...wirePreview,input:{...wirePreview.input,workspaceId:agent.workspaceId}}});
    assert.equal(foreign.status,403);
    assert.deepEqual(foreign.body,{ok:false,code:"headless.forbidden"});
    checks.selected_file_metadata_and_exact_plan_client = true;

    stage = "cancel-staged-local-file";
    await workflow.getByRole("button",{name:"Cancel",exact:true}).click();
    await expect(referenceField).toHaveCount(0);
    const add = workflow.getByRole("button",{name:"Add data",exact:true});
    await expect(add).toBeEnabled();
    const canceled = await call("aisb_preview_selected_local_file",{...scope,...selectedFile});
    assert.equal(canceled.ok,false);
    assert.ok(["headless.forbidden","headless.stale","headless.source-not-ready"].includes(canceled.code));
    checks.cancel_retires_preview = true;
    stage = "canceled-file-is-absent";
    await page.getByRole("tab",{name:"Artifact Browser",exact:true}).click();
    const savedSource = page.getByRole("button",{name:sourceName,exact:true});
    await expect(savedSource).toHaveCount(0);
    stage = "ordinary-add-local-file";
    await page.getByRole("tab",{name:"Artifact Ingestion",exact:true}).click();
    await fileInput.setInputFiles({name:sourceName,mimeType:"text/csv",buffer});
    await add.click();
    const notifications = page.getByRole("dialog",{name:"Notifications",exact:true});
    await expect(notifications.locator(".ui-notification__item").filter({hasText:"All files are ready."})).toHaveCount(1);
    await notifications.getByRole("button",{name:"Close notifications",exact:true}).click();
    await page.getByRole("tab",{name:"Artifact Browser",exact:true}).click();
    await expect(savedSource).toHaveCount(1);
    checks.cancel_retires_preview_and_ordinary_data_still_saves = true;

    stage = "stage-file-for-managed-save";
    await page.getByRole("tab",{name:"Artifact Ingestion",exact:true}).click();
    const managedSaveName = "synthetic-managed-approved.csv";
    const managedSaveBytes = Buffer.from("name,amount\nManaged save,17\n");
    await fileInput.setInputFiles({name:managedSaveName,mimeType:"text/csv",buffer:managedSaveBytes});
    await expect(clients.locator("option")).toHaveCount(2);
    await clients.selectOption({index:1});
    await workflow.getByRole("button",{name:"Prepare for chat",exact:true}).click();
    await expect(referenceField).toHaveValue(/^\{.+\}$/);
    const fileToSave = JSON.parse(await referenceField.inputValue());
    const {fileId,taskId,taskRevision} = fileToSave;
    const followUpName = "Synthetic system after the Managed file save";
    const fileStep = {operation:"data.save-local-source",fileId,taskId,taskRevision,idempotencyKey:randomUUID()};
    const steps = [fileStep, {operation:"systems.create",name:followUpName,
      templateId:"reference.secured-data-review@1.0.0",idempotencyKey:randomUUID()}];
    const parsed = parseHeadlessBuildPlanProposal({...scope,steps},hostIncarnationId,{allowLocalFileSave:true});
    assert.ok(parsed.ok);
    const saveFingerprint = createHash("sha256").update(JSON.stringify(parsed.preview)).digest("hex");
    stage = "refuse-altered-managed-save-reference";
    const altered = await call("aisb_preview_build_plan",{...scope,steps:[{...fileStep,taskRevision:taskRevision+1}]});
    assert.equal(altered.ok,false);
    stage = "preview-exact-managed-save";
    const savePreview = await call("aisb_preview_build_plan",{...scope,steps});
    checks.managed_save_preview_succeeded = savePreview.ok === true;
    assert.equal(savePreview.ok,true);
    assert.equal(savePreview.value.fingerprint,saveFingerprint);
    stage = "submit-exact-managed-save";
    const saveProposal = await call("aisb_request_build_plan_approval",{...scope,fingerprint:saveFingerprint,steps});
    checks.managed_save_proposal_succeeded = saveProposal.ok === true;
    if (!saveProposal.ok) {
      const direct = await fixture.request(MANAGED_HEADLESS_AGENT_PATHS["plan-review"], {method:"POST",
        token:agent.planReview,organizationId,body:{version:HEADLESS_CONTRACT_VERSION,
          operation:"plan.submit",input:{...scope,fingerprint:saveFingerprint,steps}}});
      checks.managed_save_proposal_http_status = direct.status;
      for (const [label, code] of [["invalid","headless.invalid-request"],["forbidden","headless.forbidden"],
        ["stale","headless.stale"],["unavailable","headless.unavailable"],
        ["capacity","headless.operation-capacity"]]) {
        if (direct.body?.code === code) checks["managed_save_proposal_" + label] = true;
      }
    }
    assert.equal(saveProposal.ok,true);
    assert.equal(saveProposal.value.status,"pending");
    stage = "refuse-unapproved-managed-save";
    assert.deepEqual(await run(saveFingerprint,saveProposal.value.revision,1),uncertain);
    const fileIsListed = async (surface:Locator) => {
      const list = surface.getByRole("list",{name:"Requested changes"});
      await list.getByText("Save the selected file in Data",{exact:true}).waitFor();
      await list.getByText("File reference " + fileId,{exact:true}).waitFor();
      await list.getByText(followUpName,{exact:false}).waitFor();
      await surface.getByRole("list",{name:"Permissions and limits"})
        .getByText("Save the listed files in this workspace’s Data area.",{exact:true}).waitFor();
    };
    stage = "show-managed-save-in-browser-chat";
    await page.locator('button.ui-shell__settings-button[aria-label="Settings"]').click();
    await openChat();
    await openProposal(saveFingerprint,chat);
    await fileIsListed(chat);
    await chat.getByRole("button",{name:"Close plan approval chat",exact:true}).click();
    stage = "approve-managed-save-in-popup";
    await trigger.click();
    await openProposal(saveFingerprint,dialog);
    await fileIsListed(dialog);
    await dialog.getByRole("radio",{name:"Approve all listed changes"}).check();
    await dialog.getByRole("button",{name:"Approve all changes",exact:true}).click();
    await dialog.getByText("All 2 changes are approved.",{exact:true}).waitFor();
    const approvedSave = await status(saveFingerprint,"approved",2);
    checks.both_managed_approval_surfaces_show_exact_file_and_access = true;

    stage = "run-ordered-managed-save";
    assert.deepEqual(await run(saveFingerprint,approvedSave.revision,2),uncertain);
    const committed = await run(saveFingerprint,approvedSave.revision,1);
    assert.equal(committed.ok,true);
    assert.equal(committed.value.kind,"committed");
    assert.equal(committed.value.operation,"data.save-local-source");
    assert.deepEqual(committed.value.reference,{workspaceId,taskId,fileId,taskRevision:taskRevision+2});
    const replay = await run(saveFingerprint,approvedSave.revision,1);
    assert.deepEqual(replay,{ok:true,value:{...committed.value,kind:"replayed"}});
    const followUp = await run(saveFingerprint,approvedSave.revision,2);
    assert.equal(followUp.ok,true);
    assert.equal(followUp.value.kind,"committed");
    const system = await call("aisb_read_system",{...scope,systemId:followUp.value.reference.systemId});
    assert.equal(system.ok,true);
    assert.equal(system.value.name,followUpName);
    checks.managed_file_save_commits_once_before_next_step = true;

    stage = "confirm-managed-saved-source";
    await page.keyboard.press("Escape");
    await page.getByRole("button",{name:"Artifacts",exact:true}).click();
    await page.getByRole("tab",{name:"Artifact Browser",exact:true}).click();
    await expect(page.getByRole("button",{name:managedSaveName,exact:true})).toHaveCount(1);
    checks.managed_approved_source_is_available_in_data = true;

    stage = "prepare-provider-file";
    const providerNamespace = "synthetic-fixture";
    const repository = providerNamespace + "/selected-dataset";
    const sourcePath = "data/synthetic-selected.parquet";
    const revision = "b".repeat(40);
    const browseRoutes = [
      { path:"/api/huggingface/namespace/datasets", verify:{namespace:providerNamespace},
        payload:createApiHuggingFaceNamespaceDatasetsBrowseSuccessResponse({namespace:providerNamespace,
          datasets:[{namespace:providerNamespace, repository}]}) },
      { path:"/api/huggingface/dataset/parquet-files", verify:{repository},
        payload:createApiHuggingFaceDatasetParquetFilesBrowseSuccessResponse({repository, revision,
          files:[{repository, path:sourcePath, revision, sizeBytes:32}]}) },
    ] as const;
    for (const expected of browseRoutes) await page.route(serverOrigin + expected.path, async route => {
      const request = route.request();
      if (request.method() !== "POST") { await route.abort(); return; }
      const payload = request.postDataJSON();
      if (!Object.entries(expected.verify).every(([key,value]) => payload?.[key] === value)) {
        await route.abort();
        return;
      }
      await route.fulfill({json:expected.payload});
    });
    await page.getByRole("tab",{name:"Artifact Ingestion",exact:true}).click();
    await workflow.getByRole("radio",{name:/Hugging Face dataset/}).check();
    await workflow.getByPlaceholder("Hugging Face name",{exact:true}).fill(providerNamespace);
    await workflow.getByRole("button",{name:"Find datasets",exact:true}).click();
    stage = "select-provider-dataset";
    await workflow.getByRole("checkbox",{name:repository,exact:true}).check();
    await workflow.getByRole("button",{name:"View files from selected datasets",exact:true}).click();
    stage = "select-provider-file";
    await workflow.getByRole("checkbox",{name:sourcePath,exact:true}).check();
    await expect(clients.locator("option")).toHaveCount(2);
    await clients.selectOption({index:1});
    stage = "stage-provider-file-in-managed-app";
    await workflow.getByRole("button",{name:"Prepare for chat",exact:true}).click();
    await expect(referenceField).toHaveValue(/^\{.+\}$/);
    const providerFile = JSON.parse(await referenceField.inputValue());
    assert.deepEqual(Object.keys(providerFile).sort(), ["fileId","taskId","taskRevision","workspaceId"]);
    assert.equal(providerFile.workspaceId, workspaceId);
    const providerTarget = {...scope,...providerFile};
    stage = "preview-provider-file-from-managed-mcp";
    const providerPreview = await call("aisb_preview_selected_provider_file",providerTarget);
    assert.equal(providerPreview.ok,true);
    const {selectionExpiresAt,...providerMetadata} = providerPreview.value;
    assert.equal(Number.isSafeInteger(selectionExpiresAt) && selectionExpiresAt > Date.now(),true);
    assert.deepEqual(providerMetadata,{...providerFile,provider:"huggingface",providerRevision:revision,
      mediaType:"application/vnd.apache.parquet",approvalRequired:true,externalProviderCalls:0});
    assert.equal((await call("aisb_preview_selected_local_file",providerTarget)).ok,false);
    checks.managed_provider_file_prepared_and_exact_revision_previewed = true;
    stage = "cancel-managed-provider-file";
    await workflow.getByRole("button",{name:"Cancel",exact:true}).click();
    await expect(referenceField).toHaveCount(0);
    assert.equal((await call("aisb_preview_selected_provider_file",providerTarget)).ok,false);
    checks.managed_provider_preview_retired_on_cancel = true;
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
    const reportName = frontier ? "managed-headless-frontier-host-evidence.json" : "managed-headless-plan-popup-evidence.json";
    await writeFile(path.join(fixture.runRoot,reportName),JSON.stringify(evidence,null,2)+"\n",{flag:"wx"});
    process.stdout.write(JSON.stringify(evidence)+"\n");
    if (!passed) process.exitCode = 1;
  }
}

void main().catch(() => {
  process.stderr.write('{"status":"failed","code":"managed-headless.plan-popup-unqualified"}\n');
  process.exitCode = 1;
});
