import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, stat, writeFile } from "node:fs/promises";
import { arch, availableParallelism, platform, release, totalmem } from "node:os";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { chromium, type Browser, type Frame, type Page, type Request as BrowserRequest, type Route } from "@playwright/test";

import { MANAGED_BROWSER_CONSENT_PATH, MANAGED_BROWSER_DOCUMENT_HEADER, MANAGED_BROWSER_OBSERVE_PATH } from "../../../../modules/contracts/headless/managed-browser-consent";
import { MANAGED_BROWSER_ACKNOWLEDGE_PATH, MANAGED_BROWSER_CONTEXT_PATH, MANAGED_BROWSER_DELIVERY_PATH, MANAGED_BROWSER_PUBLISH_CONTEXT_PATH } from "../../../../modules/contracts/headless/managed-browser-presentation";
import { HEADLESS_CONTRACT_VERSION } from "../../../../modules/contracts/headless";
import { MANAGED_HEADLESS_AGENT_PATHS, MANAGED_SAVED_STATE_PATHS } from "../../../../modules/adapters/transport/api-express/security/apiRouteSecurityPolicy";
import { readHeadlessAuthoringWireResult, readHeadlessWindowResult, type UiControlLeaseTarget } from "../../../../modules/contracts/headless";
import { startManagedReferenceHost } from "./managed-reference-host";
import { switchFunctionalWorkspace } from "./e2e/functional-host-common";

async function until<T>(observe: () => Promise<T | undefined>, attempts = 30) {
  for (let count = 0; count < attempts; count++) {
    const value = await observe();
    if (value !== undefined) return value;
    await sleep(200);
  }
  throw new Error("The expected state did not become visible.");
}

async function measureBrowserRevoke(page: Page): Promise<number> {
  return page.evaluate(() => {
    const scope = document.querySelector('[aria-label="Automation takeover"]');
    const revoke = [...(scope?.querySelectorAll("button") ?? [])]
      .find(button => button.textContent?.trim() === "Revoke automation takeover");
    const action = document.querySelector<HTMLButtonElement>('button[aria-label="Settings"]');
    if (!revoke || !action?.disabled) throw new Error("The fixture did not enter attached mode.");
    return new Promise<number>((resolve, reject) => {
      let started: number | undefined;
      const observer = new MutationObserver(() => {
        if (started === undefined || action.disabled || revoke.isConnected) return;
        observer.disconnect();
        clearTimeout(deadline);
        resolve(performance.now() - started);
      });
      const deadline = setTimeout(() => {
        observer.disconnect();
        reject(new Error("The browser did not restore manual controls."));
      }, 2_000);
      observer.observe(document.body, {subtree:true, childList:true, attributes:true, attributeFilter:["disabled"]});
      revoke.addEventListener("click", () => {started = performance.now();}, {capture:true, once:true});
      revoke.click();
    });
  });
}

function measurements(values: number[]) {
  assert.ok(values.length > 0 && values.every(value => Number.isFinite(value) && value >= 0));
  const sorted = [...values].sort((left, right) => left - right);
  const at = (ratio: number) => sorted[Math.ceil(sorted.length * ratio) - 1]!;
  return {samples:sorted.length, p50:at(.5), p95:at(.95), max:at(1)};
}

async function restoreNativeFocus(target: Page) {
  // On the pinned driver, only the primary session owns the focus override.
  const {_connection} = target as unknown as {_connection: {toImpl?(tab:Page): {delegate?: {_mainFrameSession?: {
    _client?: {send(method:"Emulation.setFocusEmulationEnabled", input:{enabled:boolean}):Promise<unknown>};
  }}} | undefined}};
  const driver = _connection.toImpl?.(target)?.delegate?._mainFrameSession?._client;
  assert.ok(driver, "The fixture cannot restore the Chrome focus policy.");
  await driver.send("Emulation.setFocusEmulationEnabled", {enabled:false});
}

async function main() {
  const presentation = process.env.MANAGED_HEADLESS_PRESENTATION_TEST === "1";
  const measure = process.env.MANAGED_HEADLESS_BROWSER_MEASURE === "1";
  const isolation = process.env.MANAGED_HEADLESS_BROWSER_ISOLATION === "1";
  const draft = process.env.MANAGED_HEADLESS_BROWSER_DRAFT === "1";
  const loseReply = process.env.MANAGED_HEADLESS_BROWSER_LOST_REPLY === "1";
  const inFlightEdit = process.env.MANAGED_HEADLESS_BROWSER_IN_FLIGHT_EDIT === "1";
  const reverseRefetch = process.env.MANAGED_HEADLESS_BROWSER_REVERSE_REFETCH === "1";
  const membershipLoss = process.env.MANAGED_HEADLESS_BROWSER_MEMBERSHIP_LOSS === "1";
  const heldContext = process.env.MANAGED_HEADLESS_BROWSER_HELD_CONTEXT === "1";
  const leaseRaces = process.env.MANAGED_HEADLESS_BROWSER_LEASE_RACES === "1";
  const reconnect = process.env.MANAGED_HEADLESS_BROWSER_RECONNECT === "1";
  const rollback = process.env.MANAGED_HEADLESS_BROWSER_ROLLBACK === "1";
  const extended = measure || isolation || draft || loseReply || inFlightEdit || reverseRefetch || membershipLoss ||
    heldContext || leaseRaces || reconnect;
  assert.ok(!(extended || rollback) || presentation);
  assert.ok(!(extended && rollback), "Managed rollback requires its own isolated run.");
  const fixture = await startManagedReferenceHost(process.env.MANAGED_REFERENCE_DATABASE ?? "",
    {headlessAgent:true, headlessBrowser:true, headlessBrowserPresentation:presentation,
      headlessMembershipLoss:membershipLoss, headlessRollback:rollback});
  const client = new Client({name: "managed-browser-consent-qualification", version: "1.0.0"});
  const evidence: Record<string, boolean | number | string | ReturnType<typeof measurements>> = {
    os: platform(), architecture: arch(), os_release: release(), ram_gib: Math.round(totalmem() / 2**30),
    logical_cpus:availableParallelism(),
  };
  let browser: Browser | undefined;
  let passed = false;
  let stage = "browser-startup";
  try {
    const {agent, organizationId, serverOrigin} = fixture;
    assert.ok(agent && fixture.frontendOrigin === serverOrigin && "browserPin" in fixture && fixture.browserPin);
    assert.match(fixture.browserPin, /^[A-Za-z0-9+/]{43}=$/);
    const {caFile, browser: browserBearer, access, workspaceId} = agent;
    const selected = await fixture.request("/api/workspaces", {method: "POST", token: browserBearer, organizationId,
      body: {command: {displayName: "Managed consent test workspace"}, selectAfterCreate: true}});
    assert.equal(selected.status, 201);
    const activeWorkspaceId = selected.body.value.workspace.workspaceId;
    assert.notEqual(activeWorkspaceId, workspaceId);
    const makeTransport = () => new StdioClientTransport({command: process.execPath,
      args: ["--import", "tsx", path.resolve("modules/adapters/transport/headless-mcp/serveHeadlessMcpReadAdapter.mts")],
      env: {AISB_HEADLESS_MODE: "managed", AISB_HEADLESS_MANAGED_ORIGIN: serverOrigin, AISB_HEADLESS_MANAGED_CREDENTIAL: access,
        AISB_HEADLESS_MANAGED_ORGANIZATION_ID: organizationId, AISB_HEADLESS_MANAGED_WORKSPACE_ID: activeWorkspaceId,
        AISB_HEADLESS_ENABLE_MANAGED_CONSENT: "1", AISB_HEADLESS_ENABLE_MANAGED_PRESENTATION: presentation ? "1" : "0",
        AISB_HEADLESS_ENABLE_AUTHORING: presentation ? "1" : "0", NODE_EXTRA_CA_CERTS: caFile, TSX_DISABLE_CACHE: "1"},
      stderr: "ignore", maxBufferSize: 256 * 1024,
    });
    await client.connect(makeTransport());
    const call = async (name: string, args: Record<string, unknown> = {}) => {
      const reply = await client.callTool({name, arguments: args}, undefined,
        {timeout:name === "aisb_apply_edits" ? 14_000 : 5_000});
      assert.ok(Array.isArray(reply.content) && reply.content.length === 1 && reply.content[0].type === "text");
      return JSON.parse(reply.content[0].text);
    };
    const described = await call("aisb_host_describe");
    assert.equal(described.ok, true);
    const scope = {hostIncarnationId: described.value.hostIncarnationId, workspaceId: activeWorkspaceId};
    browser = await chromium.launch({channel: "chrome", headless: true,
      ...(isolation || leaseRaces ? {ignoreDefaultArgs:["--disable-background-timer-throttling", "--disable-backgrounding-occluded-windows",
        "--disable-renderer-backgrounding"]} : {}),
      args: [`--ignore-certificate-errors-spki-list=${fixture.browserPin}`]});
    const context = await browser.newContext({viewport: {width: 1280, height: 900}, acceptDownloads: false, serviceWorkers: "block"});
    const trusted = new URL(serverOrigin).origin;
    await context.route("**/*", route => new URL(route.request().url()).origin === trusted ? route.continue() : route.abort());
    await context.addInitScript(({origin, value}: {origin: string; value: string}) => {
      if (location.origin === origin) localStorage.setItem("ai-system-builder.paired-device-token", value);
    }, {origin: trusted, value: browserBearer});
    evidence.chrome = browser.version();
    evidence.node = process.versions.node;
    const page = await context.newPage();
    evidence.initial_document_visible = await page.evaluate(() => document.visibilityState === "visible");
    if (presentation) page.on("response", response => {
      const responsePath = new URL(response.url()).pathname;
      if (responsePath === "/api/headless/system-builder/snapshot") evidence.saved_state_snapshot_status = response.status();
      if (responsePath === "/api/headless/system-builder/stream") evidence.saved_state_stream_status = response.status();
      if (responsePath === "/api/systems/manage") {
        evidence.saved_manage_status = response.status();
        evidence.saved_manage_requests = Number(evidence.saved_manage_requests ?? 0) + 1;
      }
    });
    await page.goto(`${trusted}/systems`, {waitUntil:"domcontentloaded"});
    const systems = page.getByRole("heading", {name: "Systems", exact: true});
    await systems.waitFor({timeout: 20_000});
    await page.getByRole("tab", {name: "Compose", exact: true}).waitFor({timeout: 20_000});
    const manage = page.getByRole("tab", {name:"Manage", exact:true});
    const management = page.getByRole("region", {name:"Manage systems", exact:true});
    const panel = page.getByRole("region", {name:"Resource shown by automation", exact:true});
    async function openCanvasTitle(systemName: string, instanceId: string, target = page) {
      await target.getByRole("tab", {name:"Compose", exact:true}).click();
      await target.getByRole("combobox", {name:"System", exact:true}).selectOption({label:systemName});
      await target.getByRole("button", {name:"Edit system", exact:true}).click();
      const editor = target.getByRole("group", {name:"System draft editor", exact:true});
      await until(async () => await editor.getAttribute("aria-busy") === "false" ? true : undefined, 50);
      await target.locator(`.system-composer__canvas-node[data-instance-id="${instanceId}"] > .system-composer__canvas-node-heading > button`).first().click();
      const inspector = target.getByRole("complementary", {name:"Composer details", exact:true});
      await inspector.getByRole("tab", {name:"Properties", exact:true}).click();
      const title = inspector.locator('[id="title"]');
      for (const tabLabel of ["Design", "Data", "Events"]) {
        await inspector.getByRole("tab", {name:tabLabel, exact:true}).click();
        if (await title.isVisible()) return title;
      }
      throw new Error("The asset's title field was unavailable.");
    }
    stage = "identify-tab";
    const getTab = (maximumPolls = 30, previousUiIncarnation?: string) => until(async () => {
      const result = await call("aisb_list_windows", scope);
      assert.equal(result.ok, true);
      const [entry] = result.value.windows;
      return result.value.windows.length === 1 && entry?.uiIncarnationId !== previousUiIncarnation ? entry : undefined;
    }, maximumPolls);
    const tab = await getTab();
    assert.equal(tab.hostIncarnationId, scope.hostIncarnationId);
    evidence.same_running_host = true;
    const routeDenied = await page.evaluate(async ({path, workspace}) => {
      const bearer = localStorage.getItem("ai-system-builder.paired-device-token");
      const response = await fetch(`${path}?unexpected=yes`, {method:"POST", headers:{"Content-Type":"application/json", Authorization: `Bearer ${bearer}`},
        body: JSON.stringify({operation:"register", workspaceId:workspace})});
      return response.status;
    }, {path: MANAGED_BROWSER_CONSENT_PATH, workspace: activeWorkspaceId});
    assert.equal(routeDenied, 400);
    evidence.noncanonical_browser_route_denied = true;

    const templateId = "reference.secured-data-review@1.0.0";
    let saved: {systemId:string; revisionId:string; recordRevision:number} | undefined;
    if (presentation) {
      stage = "saved-authoring";
      const templates = await call("aisb_list_templates", scope);
      assert.equal(templates.ok, true);
      assert.ok(templates.value.some((template: {templateId:string}) => template.templateId === templateId));
      evidence.expected_template_discovered = true;
      stage = "open-management";
      await manage.click();
      const initialName = "Synthetic presentation start";
      const create = {...scope, templateId, name:initialName, idempotencyKey:randomUUID()};
      stage = "agent-create";
      const created = await call("aisb_create_system", create);
      assert.ok(created.ok && created.value.kind === "committed");
      evidence.agent_create_committed = true;
      stage = "see-created-system";
      const snapshot = await fixture.request("/api/headless/system-builder/snapshot", {method:"POST",
        token:browserBearer, organizationId, body:{workspaceId:activeWorkspaceId}});
      assert.equal(snapshot.status, 200);
      evidence.created_in_authorized_snapshot = snapshot.body.value.systems.some((system: {systemId:string}) =>
        system.systemId === created.value.reference.systemId);
      assert.equal(evidence.created_in_authorized_snapshot, true);
      const managedList = await fixture.request(`/api/systems/manage?workspaceId=${encodeURIComponent(activeWorkspaceId)}&view=active&sort=updated-desc&limit=25`,
        {token:browserBearer, organizationId});
      evidence.created_in_ordinary_listing = managedList.status === 200 && managedList.body.value.items
        .some((system: {systemId:string;name:string}) => system.systemId === created.value.reference.systemId && system.name === initialName);
      evidence.management_view_visible = await management.isVisible();
      await management.getByRole("cell", {name:new RegExp(initialName)}).waitFor({timeout:10_000});
      const original = created.value.reference;
      const rename = {...scope, systemId:original.systemId, baseRevisionId:original.revisionId,
        baseRecordRevision:original.recordRevision, name:"Synthetic saved presentation", idempotencyKey:randomUUID()};
      stage = "agent-rename";
      const committed = await call("aisb_rename_system", rename);
      assert.ok(committed.ok && committed.value.kind === "committed");
      saved = committed.value.reference;
      assert.ok(saved && saved.systemId === original.systemId && saved.recordRevision === original.recordRevision + 1);
      evidence.agent_rename_committed = true;
      stage = "see-renamed-system";
      await management.getByRole("cell", {name:new RegExp(rename.name)}).waitFor({timeout:10_000});
      stage = "agent-rename-replay";
      const replay = await call("aisb_rename_system", rename);
      assert.deepEqual(replay, {ok:true,value:{kind:"replayed",reference:saved}});
      evidence.managed_create_edit_refresh_and_retry = true;
    }

    stage = "consent";
    const before = await systems.boundingBox();
    assert.ok(before);
    const ask = {target: tab, taskId: randomUUID(), requestKey: randomUUID()};
    const requested = await call("aisb_request_window", ask);
    assert.equal(requested.ok, true);
    const attempt = requested.value.request.target;
    const modal = page.getByRole("dialog", {name: "Automation takeover request"});
    await modal.waitFor({timeout: 10_000});
    const after = await systems.boundingBox();
    assert.deepEqual(after, before);
    evidence.modal_keeps_layout = true;
    await modal.getByRole("button", {name: "Accept automation takeover", exact:true}).click();
    const revoke = page.getByRole("button", {name: "Revoke automation takeover", exact:true});
    await revoke.waitFor({timeout: 10_000});
    const lease = await until<UiControlLeaseTarget>(async () => {
      const status = readHeadlessWindowResult(await call("aisb_window_status", {target:attempt}));
      return status.ok && status.value.kind === "request" && status.value.request.status === "active" ? status.value.lease : undefined;
    });
    evidence.exact_document_active = true;

    const presentationRequest = saved ? {target:lease, commandId:randomUUID(),
      intent:{action:"open-system", systemId:saved.systemId, revisionId:saved.revisionId}} : undefined;
    if (presentationRequest) {
      stage = "saved-presentation";
      const beganAt = performance.now();
      const queued = readHeadlessWindowResult(await call("aisb_present_in_window", presentationRequest));
      assert.ok(queued.ok && queued.value.kind === "command" && !queued.value.duplicate &&
        queued.value.receipt.status === "accepted");
      evidence.command_accepted = true;
      stage = "panel-visible";
      await panel.waitFor({timeout:3_000});
      await panel.getByRole("heading", {name:"Synthetic presentation start", exact:true}).waitFor({timeout:3_000});
      assert.equal(await panel.locator("code").textContent(), presentationRequest.intent.systemId);
      evidence.first_visible_presentation_ms = performance.now() - beganAt;
      stage = "command-acknowledged";
      await until(async () => {
        const repeated = readHeadlessWindowResult(await call("aisb_present_in_window", presentationRequest));
        return repeated.ok && repeated.value.kind === "command" && repeated.value.duplicate && repeated.value.receipt.status === "applied" ? true : undefined;
      });
      assert.equal(await panel.count(), 1);
      stage = "fresh-context";
      const current = readHeadlessWindowResult(await call("aisb_window_context", {target:lease}));
      assert.deepEqual(current, {ok:true,value:{kind:"context",context:{view:"system", ready:true,
        dirtyNavigationBlocked:false, selection:presentationRequest.intent}}});
      const renewed = readHeadlessWindowResult(await call("aisb_renew_window", {target:lease}));
      assert.ok(renewed.ok && renewed.value.kind === "request" && renewed.value.lease);
      assert.deepEqual(renewed.value.lease, lease);
      evidence.command_confirmed_and_fresh_context_renewed = true;
    }
    const editedTitle = "Synthetic edit already running";
    const startEdit = async () => {
      assert.ok(saved);
      const original = saved;
      const input = {...scope, systemId:original.systemId, baseRevisionId:original.revisionId,
        baseRecordRevision:original.recordRevision, edits:[{kind:"configure",
          instanceId:`${original.systemId}.table`, values:{title:editedTitle}}]};
      stage = "in-flight-edit-preview";
      const preview = await call("aisb_preview_edits", input);
      assert.ok(preview.ok && typeof preview.value?.previewDigest === "string");
      const snapshot = await fixture.request("/api/headless/system-builder/snapshot", {method:"POST",
        token:browserBearer, organizationId, body:{workspaceId:activeWorkspaceId}});
      assert.equal(snapshot.status, 200);
      const exact = {...input, previewDigest:preview.value.previewDigest, idempotencyKey:randomUUID()};
      const audit = path.join(fixture.runRoot, "runtime", "security", "authorization-audit.jsonl");
      const after = (await stat(audit)).size;
      const beganAt = performance.now();
      let settled = false;
      const pending = call("aisb_apply_edits", exact).then(value => ({value}), () => ({})).finally(() => {settled = true;});
      stage = "in-flight-edit-authorized";
      await until(async () => {
        assert.equal(settled, false);
        const length = (await stat(audit)).size;
        assert.ok(length >= after && length <= 2 * 1024 * 1024);
        const rows = (await readFile(audit)).subarray(after).toString("utf8").split("\n").slice(0, -1);
        return rows.some(line => {
          const row = JSON.parse(line);
          return row.operation === "headless.systems.apply-edits" && row.kind === "authz.allowed" &&
            row.organizationId === organizationId && row.resource?.workspaceId === activeWorkspaceId;
        }) ? true : undefined;
      }, 20);
      evidence.in_flight_edit_authorized_before_revoke = true;
      return {original, snapshot, exact, pending, beganAt, isSettled:() => settled};
    };
    const editing = inFlightEdit ? await startEdit() : undefined;

    stage = "revoke";
    await revoke.click();
    await revoke.waitFor({state:"detached", timeout:5_000});
    stage = "revoke-old-request-retry";
    await until(async () => {
      const status = await call("aisb_window_status", {target:attempt});
      return status.ok && status.value.kind === "ended" ? true : undefined;
    });
    assert.deepEqual(await call("aisb_request_window", ask), {ok:true, value:{kind:"ended"}});
    evidence.revoke_disables_retry = true;
    if (editing) {
      assert.equal(editing.isSettled(), false);
      stage = "in-flight-edit-switch-workspace";
      await switchFunctionalWorkspace(page, workspaceId);
      assert.equal(editing.isSettled(), false);
      evidence.in_flight_edit_workspace_switch_ms = performance.now() - editing.beganAt;
      const readOriginalChanges = () => fixture.request("/api/headless/system-builder/changes", {method:"POST",
        token:browserBearer, organizationId, body:{workspaceId:activeWorkspaceId, cursor:editing.snapshot.body.value.cursor}});
      const beforeCommit = await readOriginalChanges();
      assert.equal(beforeCommit.status, 200);
      assert.deepEqual(beforeCommit.body.value.events, []);
      evidence.in_flight_edit_switch_precedes_journal_commit = true;
      stage = "in-flight-edit-original-workspace-save";
      const outcome = await editing.pending;
      assert.ok("value" in outcome);
      const result = readHeadlessAuthoringWireResult(outcome.value);
      assert.ok(result.ok && result.value.kind === "committed");
      const expected = result.value.reference;
      assert.equal(expected.systemId, editing.original.systemId);
      assert.equal(expected.recordRevision, editing.original.recordRevision + 1);
      assert.notEqual(expected.revisionId, editing.original.revisionId);
      assert.equal(await panel.count(), 0);
      const events = await readOriginalChanges();
      assert.equal(events.status, 200);
      assert.deepEqual(events.body.value.events, [{...expected, sequence:editing.snapshot.body.value.cursor.sequence + 1}]);
      const other = await fixture.request("/api/headless/system-builder/snapshot", {method:"POST",
        token:browserBearer, organizationId, body:{workspaceId}});
      assert.equal(other.status, 200);
      assert.ok(!other.body.value.systems.some((system: {systemId:string}) => system.systemId === expected.systemId));
      stage = "in-flight-edit-restore-original-workspace";
      await switchFunctionalWorkspace(page, activeWorkspaceId);
      const title = await openCanvasTitle("Synthetic saved presentation", `${expected.systemId}.table`);
      assert.equal(await title.inputValue(), editedTitle);
      await manage.click();
      assert.equal(await panel.count(), 0);
      assert.deepEqual(await call("aisb_apply_edits", editing.exact), {ok:true, value:{kind:"replayed", reference:expected}});
      saved = expected;
      evidence.in_flight_edit_one_durable_save_without_presentation = true;
    }
    if (presentationRequest) {
      stage = "revoke-old-presentation-and-context";
      await panel.waitFor({state:"hidden", timeout:3_000});
      const late = readHeadlessWindowResult(await call("aisb_window_context", {target:lease}));
      assert.ok(!late.ok);
      assert.ok(!readHeadlessWindowResult(await call("aisb_present_in_window", presentationRequest)).ok);
      stage = "post-revoke-separate-save";
      const name = "Synthetic saved after revoke";
      const committed = await call("aisb_create_system", {...scope, templateId, name, idempotencyKey:randomUUID()});
      assert.ok(committed.ok && committed.value.kind === "committed");
      await management.getByRole("cell", {name:new RegExp(name)}).waitFor({timeout:10_000});
      assert.equal(await panel.count(), 0);
      evidence.revoke_ends_presentation_only = true;
    }

    if (heldContext) {
      stage = "held-context-request-and-accept";
      const requested = readHeadlessWindowResult(await call("aisb_request_window", {
        target:await getTab(), taskId:randomUUID(), requestKey:randomUUID(),
      }));
      assert.ok(requested.ok && requested.value.kind === "request");
      const attempt = requested.value.request.target;
      const gate = await page.evaluateHandle(({contextPath, publishPath}) => {
        const original = window.fetch;
        const pause = Promise.withResolvers<void>();
        let held = false;
        let expired = false;
        let consumed = false;
        let publishes = 0;
        let challengeRequests = 0;
        let challengeStatus = 0;
        const deadline = setTimeout(() => {expired = true; pause.resolve();}, 10_000);
        const fetchHook = {async run(input:RequestInfo | URL, init?:RequestInit) {
          const url = new URL(input instanceof Request ? input.url : input, location.href);
          if (url.origin === location.origin && url.pathname === publishPath && init?.method === "POST") publishes++;
          const challenge = url.origin === location.origin && url.pathname === contextPath && init?.method === "POST";
          if (challenge) challengeRequests++;
          const response = await original.call(window, input, init);
          if (!challenge) return response;
          challengeStatus = response.status;
          if (held || !response.ok || response.url !== location.origin + contextPath) return response;
          const witness = await response.clone().json();
          if (held || typeof witness?.challenge !== "string" || !response.body) return response;
          held = true;
          await pause.promise;
          const body = response.body;
          const getReader = body.getReader.bind(body);
          const bodyHook = {getReader() {
            const reader = getReader();
            const read = reader.read.bind(reader);
            const readerHook = {async read() {
              const chunk = await read();
              if (chunk.done) consumed = true;
              return chunk;
            }};
            reader.read = readerHook.read;
            return reader;
          }};
          Object.defineProperty(body, "getReader", {value:bodyHook.getReader, configurable:true});
          return response;
        }};
        window.fetch = fetchHook.run;
        return {status() {return {held, expired, consumed, publishes};},
          requests() {return {challengeRequests, challengeStatus};},
          release() {clearTimeout(deadline); pause.resolve();},
          restore() {
            clearTimeout(deadline);
            pause.resolve();
            if (window.fetch === fetchHook.run) window.fetch = original;
          }};
      }, {contextPath: MANAGED_BROWSER_CONTEXT_PATH, publishPath: MANAGED_BROWSER_PUBLISH_CONTEXT_PATH});
      try {
        await modal.getByRole("button", {name:"Accept automation takeover",exact:true}).click();
        await revoke.waitFor({timeout:5_000});
        stage = "held-context-server-active";
        const active = await until<UiControlLeaseTarget>(async () => {
          const result = readHeadlessWindowResult(await call("aisb_window_status", {target:attempt}));
          return result.ok && result.value.kind === "request" && result.value.request.status === "active" ? result.value.lease : undefined;
        });
        stage = "held-context-positive-reply";
        const pendingRead = call("aisb_window_context", {target:active}).then(value => ({value}), () => ({}));
        await page.waitForFunction(state => state.status().held, gate, {timeout:3_000});
        assert.deepEqual(await gate.evaluate(value => value.status()), {held:true, expired:false, consumed:false, publishes:0});
        stage = "held-context-revoke-and-release";
        await revoke.click();
        await revoke.waitFor({state:"detached", timeout:3_000});
        await gate.evaluate(value => value.release());
        await until(async () => (await gate.evaluate(value => value.status())).consumed ? true : undefined, 15);
        await until(async () => {
          const result = readHeadlessWindowResult(await call("aisb_window_status", {target:attempt}));
          return result.ok && result.value.kind === "ended" ? true : undefined;
        });
        assert.ok(!readHeadlessWindowResult(await call("aisb_window_context", {target:active})).ok);
        const originalRead = await pendingRead;
        assert.ok("value" in originalRead && !readHeadlessWindowResult(originalRead.value).ok);
        assert.deepEqual(await gate.evaluate(value => value.status()), {held:true, expired:false, consumed:true, publishes:0});
        assert.equal(await page.locator("button.ui-shell__settings-button").isEnabled(), true);
        evidence.held_context_reply_consumed_after_revoke_with_zero_publications = true;
      } finally {
        const observed = await gate.evaluate(value => value.requests());
        evidence.held_context_challenge_requests = observed.challengeRequests;
        evidence.held_context_challenge_status = observed.challengeStatus;
        await gate.evaluate(value => value.restore());
        await gate.dispose();
      }
    }

    if (leaseRaces) {
      const requestCurrentTab = async () => {
        const result = readHeadlessWindowResult(await call("aisb_request_window", {
          target:await getTab(), taskId:randomUUID(), requestKey:randomUUID(),
        }));
        assert.ok(result.ok && result.value.kind === "request");
        return result.value.request.target;
      };
      const waitActive = (target: Awaited<ReturnType<typeof requestCurrentTab>>) => until<UiControlLeaseTarget>(async () => {
        const result = readHeadlessWindowResult(await call("aisb_window_status", {target}));
        return result.ok && result.value.kind === "request" && result.value.request.status === "active" ? result.value.lease : undefined;
      });
      const accept = () => modal.getByRole("button", {name:"Accept automation takeover",exact:true}).click();
      stage = "held-readiness-first-request";
      const oldAttempt = await requestCurrentTab();
      const heldReady = await page.evaluateHandle(({consentPath, requestId}) => {
        const nativeFetch = window.fetch;
        const pause = Promise.withResolvers<void>();
        let held = false;
        let consumed = false;
        let expired = false;
        const deadline = setTimeout(() => {expired = true; pause.resolve();}, 3_500);
        const hook = {async run(input:RequestInfo | URL, init?:RequestInit) {
          const result = await nativeFetch.call(window, input, init);
          if (held || !result.ok || result.url !== location.origin + consentPath || init?.method !== "POST" ||
            typeof init.body !== "string") return result;
          const submitted = JSON.parse(init.body);
          if (submitted.operation !== "ready" || submitted.target?.requestId !== requestId) return result;
          const witness = await result.clone().json();
          if (held || witness?.target?.requestId !== requestId || typeof witness?.target?.leaseId !== "string" || !result.body) return result;
          held = true;
          await pause.promise;
          const body = result.body;
          const getReader = body.getReader.bind(body);
          const bodyHook = {getReader() {
            const reader = getReader();
            const read = reader.read.bind(reader);
            const readerHook = {async read() {
              const chunk = await read();
              if (chunk.done) consumed = true;
              return chunk;
            }};
            reader.read = readerHook.read;
            return reader;
          }};
          Object.defineProperty(body, "getReader", {value:bodyHook.getReader, configurable:true});
          return result;
        }};
        window.fetch = hook.run;
        return {state() {return {held,consumed,expired};},
          release() {clearTimeout(deadline); pause.resolve();},
          restore() {
            clearTimeout(deadline);
            pause.resolve();
            if (window.fetch === hook.run) window.fetch = nativeFetch;
          }};
      }, {consentPath:MANAGED_BROWSER_CONSENT_PATH, requestId:oldAttempt.requestId});
      const attached = page.getByText("Automation controls this window.", {exact:true});
      try {
        await accept();
        stage = "held-readiness-positive-reply";
        await page.waitForFunction(value => value.state().held, heldReady, {timeout:2_500});
        await page.getByText("Preparing automation takeover.", {exact:true}).waitFor({timeout:1_500});
        const oldLease = await waitActive(oldAttempt);
        stage = "held-readiness-revoke-and-replace";
        await revoke.click();
        await revoke.waitFor({state:"detached",timeout:1_500});
        await until(async () => {
          const result = readHeadlessWindowResult(await call("aisb_window_status", {target:oldAttempt}));
          return result.ok && result.value.kind === "ended" ? true : undefined;
        }, 10);
        const newAttempt = await requestCurrentTab();
        await accept();
        await attached.waitFor({timeout:2_000});
        const newLease = await waitActive(newAttempt);
        assert.notEqual(newLease.leaseId, oldLease.leaseId);
        assert.ok(newLease.generation > oldLease.generation);
        assert.deepEqual(await heldReady.evaluate(value => value.state()), {held:true,consumed:false,expired:false});
        stage = "held-readiness-cannot-replace-active-lease";
        await heldReady.evaluate(value => value.release());
        await page.waitForFunction(value => value.state().consumed, heldReady, {timeout:1_000});
        assert.ok(!readHeadlessWindowResult(await call("aisb_window_context", {target:oldLease})).ok);
        assert.deepEqual(await waitActive(newAttempt), newLease);
        const currentContext = readHeadlessWindowResult(await call("aisb_window_context", {target:newLease}));
        assert.ok(currentContext.ok && currentContext.value.kind === "context" && currentContext.value.context.ready);
        assert.equal(await attached.isVisible(), true);
        await revoke.click();
        await revoke.waitFor({state:"detached",timeout:3_000});
        evidence.held_server_readiness_cannot_replace_newer_lease = true;
      } finally {
        await heldReady.evaluate(value => value.restore());
        await heldReady.dispose();
      }

      stage = "background-lease-native-visibility";
      const peer = await context.newPage();
      let droppedDisconnects = 0;
      let droppedRevokes = 0;
      let hiddenLease: UiControlLeaseTarget | undefined;
      const consentUrl = trusted + MANAGED_BROWSER_CONSENT_PATH;
      const interruptRetirement = async (route: Route) => {
        const request = route.request();
        const body = request.method() === "POST" ? request.postDataJSON() : undefined;
        const expected = hiddenLease;
        const owned = expected && body?.document?.windowId === expected.windowId &&
          body?.document?.uiIncarnationId === expected.uiIncarnationId;
        if (owned && body.operation === "disconnect") {droppedDisconnects++; await route.abort("failed"); return;}
        if (owned && body.operation === "revoke" && body.target?.requestId === expected.requestId) {
          droppedRevokes++; await route.abort("failed"); return;
        }
        await route.continue();
      };
      const timers = () => page.evaluate(async () => {
        const elapsed: number[] = [];
        for (let sample = 0; sample < 3; sample++) {
          const start = performance.now();
          await new Promise<void>(resolve => setTimeout(resolve, 50));
          elapsed.push(performance.now() - start);
        }
        return elapsed;
      });
      try {
        await restoreNativeFocus(page);
        await restoreNativeFocus(peer);
        await page.bringToFront();
        await page.waitForFunction(() => document.visibilityState === "visible");
        const foreground = measurements(await timers());
        const attempt = await requestCurrentTab();
        await accept();
        await attached.waitFor({timeout:3_000});
        const active = await waitActive(attempt);
        hiddenLease = active;
        const status = () => call("aisb_window_status", {target:attempt}).then(readHeadlessWindowResult);
        await page.route(consentUrl, interruptRetirement);
        const beginning = performance.now();
        await peer.bringToFront();
        await page.waitForFunction(() => document.visibilityState === "hidden", undefined, {timeout:3_000});
        stage = "background-lease-host-watchdog";
        const initial = await status();
        assert.ok(initial.ok && initial.value.kind === "request" && initial.value.request.status === "active");
        const [background, retiredMs] = await Promise.all([
          timers().then(measurements),
          until(async () => {
            const current = await status();
            return current.ok && current.value.kind === "ended" ? performance.now() - beginning : undefined;
          }, 75),
        ]);
        assert.ok(background.p50 >= 250 && background.p50 >= 3 * foreground.p50);
        assert.ok(droppedDisconnects + droppedRevokes > 0);
        assert.ok(retiredMs > 1_000 && retiredMs <= 15_000);
        assert.equal(await page.evaluate(() => document.visibilityState), "hidden");
        assert.ok(!readHeadlessWindowResult(await call("aisb_renew_window", {target:active})).ok);
        assert.ok(!readHeadlessWindowResult(await call("aisb_window_context", {target:active})).ok);
        stage = "background-lease-returns-with-fresh-document";
        await page.unroute(consentUrl, interruptRetirement);
        await page.bringToFront();
        const fresh = await getTab();
        assert.notEqual(fresh.uiIncarnationId, active.uiIncarnationId);
        assert.equal(await revoke.count(), 0);
        assert.equal(await panel.count(), 0);
        evidence.visible_tab_timer_ms = foreground;
        evidence.hidden_tab_timer_ms = background;
        evidence.managed_background_retired_ms = retiredMs;
        evidence.managed_background_dropped_retirements = droppedDisconnects + droppedRevokes;
      } finally {
        await page.unroute(consentUrl, interruptRetirement);
        await peer.close();
      }
    }

    if (reconnect && saved) {
      stage = "scoped-reconnect-prepare";
      const {systemId} = saved;
      const current = await call("aisb_read_system", {...scope, systemId});
      assert.ok(current.ok && typeof current.value?.name === "string");
      const publish = page.getByRole("tab", {name:"Publish", exact:true});
      await publish.click({timeout:5_000});
      assert.equal(await publish.getAttribute("aria-selected"), "true");
      const stream = await page.evaluateHandle(({workspaceId}) => {
        const original = window.fetch;
        const releaseReplay = Promise.withResolvers<void>();
        const deadline = setTimeout(releaseReplay.resolve, 10_000);
        const first = new AbortController();
        type Cursor = {hostIncarnationId:string; sequence:number; scopeTag:string};
        type Save = {systemId:string; recordRevision:number; revisionId:string};
        type Change = Save & {sequence:number};
        const cursorIdentity = {
          key(cursor:Cursor) {return JSON.stringify([cursor.hostIncarnationId, cursor.sequence, cursor.scopeTag]);},
        };
        let firstCursor: Cursor | undefined;
        let shouldInterrupt = false;
        let replayWaiting = false;
        let replayedSameCursor = false;
        let replayCursor: Cursor | undefined;
        let replayEvent: Change | undefined;
        let healthyStreams = 0;
        let successorCursor: Cursor | undefined;
        const proxy = {async run(input:RequestInfo | URL, init?:RequestInit) {
          const base = new URL(input instanceof Request ? input.url : input, location.href);
          if (base.origin !== location.origin || init?.method !== "POST" || typeof init.body !== "string" ||
              !["/api/headless/system-builder/stream", "/api/headless/system-builder/changes"].includes(base.pathname))
            return original.call(window, input, init);
          const request = JSON.parse(init.body);
          if (request.workspaceId !== workspaceId) return original.call(window, input, init);
          const cursor: Cursor = request.cursor;
          if (base.pathname.endsWith("/stream")) {
            const initial = firstCursor === undefined;
            if (initial) firstCursor = cursor;
            const signal = initial && init.signal ? AbortSignal.any([init.signal, first.signal]) : init.signal;
            const response = await original.call(window, input, {...init, signal});
            if (response.ok && response.headers.get("content-type")?.startsWith("text/event-stream")) {
              healthyStreams++;
              if (shouldInterrupt && !initial) successorCursor = cursor;
            }
            return response;
          }
          if (!shouldInterrupt || replayWaiting) return original.call(window, input, init);
          replayWaiting = true;
          replayedSameCursor = firstCursor !== undefined && cursorIdentity.key(cursor) === cursorIdentity.key(firstCursor);
          await releaseReplay.promise;
          const response = await original.call(window, input, init);
          const size = Number(response.headers.get("content-length"));
          if (response.ok && size > 0 && size <= 128 * 1024) {
            const reply = await response.clone().json();
            if (reply.ok === true && reply.value?.kind === "changes" && reply.value.more === false &&
                Array.isArray(reply.value.events) && reply.value.events.length === 1) {
              replayCursor = reply.value.cursor;
              replayEvent = reply.value.events[0];
            }
          }
          return response;
        }};
        window.fetch = proxy.run;
        return {state() {return {healthyStreams,replayWaiting};},
          verifiedReplay(save: Save) {
            return Boolean(replayedSameCursor && firstCursor && replayCursor && replayEvent && successorCursor &&
              replayCursor.hostIncarnationId === firstCursor.hostIncarnationId &&
              replayCursor.sequence === firstCursor.sequence + 1 && replayEvent.sequence === replayCursor.sequence &&
              replayEvent.systemId === save.systemId && replayEvent.recordRevision === save.recordRevision &&
              replayEvent.revisionId === save.revisionId && cursorIdentity.key(successorCursor) === cursorIdentity.key(replayCursor));
          },
          interrupt() {shouldInterrupt = true; first.abort();},
          continueReplay() {clearTimeout(deadline); releaseReplay.resolve();},
          restore() {
            clearTimeout(deadline);
            releaseReplay.resolve();
            if (window.fetch === proxy.run) window.fetch = original;
          }};
      }, {workspaceId:activeWorkspaceId});
      try {
        stage = "scoped-reconnect-open-management";
        await manage.click({timeout:5_000});
        const row = management.locator(`tr[data-saved-system="${systemId}"]`);
        await row.getByText(current.value.name, {exact:true}).waitFor({timeout:5_000});
        stage = "scoped-reconnect-initial-stream";
        await page.waitForFunction(value => value.state().healthyStreams === 1, stream, {timeout:5_000});
        stage = "scoped-reconnect-interrupt-and-commit";
        const began = performance.now();
        await stream.evaluate(value => value.interrupt());
        await page.waitForFunction(value => value.state().replayWaiting, stream, {timeout:2_000});
        const name = "Synthetic save recovered after stream interruption";
        const result = readHeadlessAuthoringWireResult(await call("aisb_rename_system", {...scope, systemId,
          baseRevisionId:current.value.currentRevisionId, baseRecordRevision:current.value.revision, name, idempotencyKey:randomUUID()}));
        assert.ok(result.ok && result.value.kind === "committed");
        stage = "scoped-reconnect-read-and-resume";
        await stream.evaluate(value => value.continueReplay());
        await row.getByText(name, {exact:true}).waitFor({timeout:5_000});
        assert.ok((await row.textContent())?.includes(`Revision ${result.value.reference.recordRevision}`));
        await page.waitForFunction(value => value.state().healthyStreams >= 2, stream, {timeout:5_000});
        evidence.managed_browser_reconnect_ms = performance.now() - began;
        assert.ok(result.value.reference.revisionId);
        assert.ok(await stream.evaluate((value, save) => value.verifiedReplay(save), {
          systemId, recordRevision:result.value.reference.recordRevision, revisionId:result.value.reference.revisionId,
        }));
        assert.ok(evidence.managed_browser_reconnect_ms <= 5_000);
        assert.equal(await panel.count(), 0);
        saved = result.value.reference;
        evidence.managed_browser_reconnect_replayed_exact_cursor = true;
      } finally {
        await stream.evaluate(value => value.restore());
        await stream.dispose();
      }
    }

    if (measure && saved && presentationRequest) {
      stage = "browser-timing";
      const timedTab = await getTab();
      const dispatchTimes: number[] = [];
      const replyTimes: number[] = [];
      const revealTimes: number[] = [];
      const revokeTimes: number[] = [];
      const settings = page.locator("button.ui-shell__settings-button");
      assert.equal(await settings.isEnabled(), true);
      let current = saved;
      for (let index = 0; index < 100; index++) {
        // The shared controller retains 32 local revokes for 60 seconds.
        if (index > 0 && index % 30 === 0) await sleep(61_000);
        const name = `Synthetic warm system ${index + 1}`;
        stage = "timed-commit";
        assert.equal(await page.evaluate(() => document.visibilityState), "visible");
        const dispatchedAt = performance.now();
        const change = await call("aisb_rename_system", {...scope, systemId:current.systemId,
          baseRevisionId:current.revisionId, baseRecordRevision:current.recordRevision, name, idempotencyKey:randomUUID()});
        const replyAt = performance.now();
        assert.ok(change.ok && change.value.kind === "committed");
        current = change.value.reference;
        stage = "timed-visible-save";
        const timedRow = management.getByRole("cell", {name:new RegExp(`^${name}\\b`)});
        await timedRow.waitFor({timeout:5_000});
        assert.ok((await timedRow.textContent())?.includes(`Revision ${current.recordRevision}`));
        const visibleAt = performance.now();
        dispatchTimes.push(visibleAt - dispatchedAt);
        replyTimes.push(visibleAt - replyAt);

        stage = "timed-consent";
        const request = readHeadlessWindowResult(await call("aisb_request_window", {target:timedTab, taskId:randomUUID(), requestKey:randomUUID()}));
        assert.ok(request.ok && request.value.kind === "request");
        await modal.getByRole("button", {name:"Accept automation takeover", exact:true}).click({timeout:5_000});
        await revoke.waitFor({timeout:5_000});
        const attempt = request.value.request.target;
        const active = await until<UiControlLeaseTarget>(async () => {
          const status = readHeadlessWindowResult(await call("aisb_window_status", {target:attempt}));
          return status.ok && status.value.kind === "request" ? status.value.lease : undefined;
        });
        assert.equal(await panel.count(), 0);
        const command = {target:active, commandId:randomUUID(),
          intent:{action:"open-system", systemId:current.systemId, revisionId:current.revisionId}};
        stage = "timed-reveal";
        const beganAt = performance.now();
        const accepted = readHeadlessWindowResult(await call("aisb_present_in_window", command));
        assert.ok(accepted.ok && accepted.value.kind === "command" && !accepted.value.duplicate &&
          accepted.value.receipt.commandId === command.commandId && accepted.value.receipt.status === "accepted");
        await panel.getByRole("heading", {name:"Synthetic presentation start", exact:true}).waitFor({timeout:3_000});
        assert.equal(await panel.locator("code").textContent(), current.systemId);
        assert.match((await panel.locator("p").textContent()) ?? "", /^Saved revision \d+ · \d+ components$/u);
        revealTimes.push(performance.now() - beganAt);
        stage = "timed-revoke";
        revokeTimes.push(await measureBrowserRevoke(page));
        evidence.completed_timing_samples = revokeTimes.length;
        assert.equal(await panel.count(), 0);
        assert.equal(await page.evaluate(() => document.visibilityState), "visible");
        await until(async () => {
          const status = readHeadlessWindowResult(await call("aisb_window_status", {target:attempt}));
          return status.ok && status.value.kind === "ended" ? true : undefined;
        });
      }
      const observed = {
        dispatch_to_visible_ms:measurements(dispatchTimes),
        mcp_reply_to_visible_ms:measurements(replyTimes),
        warm_presentation_ms:measurements(revealTimes),
        local_revoke_ms:measurements(revokeTimes),
      };
      Object.assign(evidence, observed);
      assert.ok(observed.dispatch_to_visible_ms.p95 <= 2_000);
      assert.ok(observed.warm_presentation_ms.p95 <= 1_000);
      assert.ok(observed.local_revoke_ms.p95 <= 100 && observed.local_revoke_ms.max <= 250);
    }

    if (isolation && saved && presentationRequest) {
      stage = "second-tab";
      const savedRecord = await call("aisb_read_system", {...scope, systemId:saved.systemId});
      assert.ok(savedRecord.ok && typeof savedRecord.value?.currentRevisionId === "string");
      const currentIntent = {...presentationRequest.intent, revisionId:savedRecord.value.currentRevisionId};
      const peer = await context.newPage();
      await restoreNativeFocus(page);
      await restoreNativeFocus(peer);
      try {
        await peer.goto(`${trusted}/systems`, {waitUntil:"domcontentloaded"});
        await peer.getByRole("heading", {name:"Systems", exact:true}).waitFor({timeout:20_000});
        await page.bringToFront();
        await until(async () => await page.evaluate(() => !document.hidden) ? true : undefined);
        const visibleTab = await getTab();
        stage = "held-delivery-and-capacity";
        const deliveryPath = `${trusted}${MANAGED_BROWSER_DELIVERY_PATH}`;
        const gate = await page.evaluateHandle(({deliveryPath}) => {
          const original = window.fetch;
          let held = false;
          let finished = false;
          const hold = Promise.withResolvers<void>();
          const deadline = setTimeout(hold.resolve, 8_000);
          const testFetch: {run:typeof fetch} = {async run(input, init) {
            const response = await original.call(window, input, init);
            if (held || !response.ok || response.url !== deliveryPath || init?.method !== "POST") return response;
            const entry = await response.clone().json() as {status?:string};
            if (entry.status !== "command" || held) return response;
            held = true;
            await hold.promise;
            finished = true;
            return response;
          }};
          window.fetch = testFetch.run;
          const selector = 'section[aria-label="Resource shown by automation"]';
          let staleAppearances = 0;
          let baselineFocus:Element | null = null;
          let baselineLocation = "";
          let focusEvents = 0;
          const focus = {record() {focusEvents++;}};
          const watcher = new MutationObserver(records => {
            for (const {addedNodes} of records) for (const node of addedNodes)
              if (node instanceof Element && (node.matches(selector) || node.querySelector(selector))) staleAppearances++;
          });
          return {held() {return held && !finished;}, finished() {return finished;}, release:hold.resolve,
            observePanel() {watcher.observe(document.body, {childList:true, subtree:true});},
            observeManualControls() {
              baselineFocus = document.activeElement;
              baselineLocation = location.href;
              document.addEventListener("focusin", focus.record, true);
            },
            readManualControls() {
              return {focusEvents, focusPreserved:document.activeElement === baselineFocus,
                routePreserved:location.href === baselineLocation};
            },
            staleAppearances() {return staleAppearances;},
            restore() {
              watcher.disconnect();
              document.removeEventListener("focusin", focus.record, true);
              clearTimeout(deadline);
              hold.resolve();
              if (window.fetch === testFetch.run) window.fetch = original;
            }};
        }, {deliveryPath});
        let active: UiControlLeaseTarget;
        let navigations = 0;
        const monitorNavigation = (frame: Frame) => {if(frame === page.mainFrame()) navigations++;};
        try {
          stage = "queue-exact-tab-consent";
          const request = readHeadlessWindowResult(await call("aisb_request_window", {target:visibleTab,
            taskId:randomUUID(), requestKey:randomUUID()}));
          assert.ok(request.ok && request.value.kind === "request");
          assert.equal(await peer.getByRole("dialog", {name:"Automation takeover request"}).count(), 0);
          const attempt = request.value.request.target;
          const peerDenial = await peer.evaluate(async ({path, proofHeader, workspaceId, organizationId, attempt}) => {
            const bearer = localStorage.getItem("ai-system-builder.paired-device-token");
            const headers = {"Content-Type":"application/json", Authorization:`Bearer ${bearer}`,
              "X-Organization-Id":organizationId, "X-Client-Source":"thin-client"};
            const registration = await fetch(path, {method:"POST", headers, signal:AbortSignal.timeout(3_000),
              body:JSON.stringify({operation:"register", workspaceId})});
            if (!registration.ok) return {registration:registration.status, denial:0, disconnect:0};
            const {target,proof} = await registration.json();
            const scoped = {...headers,[proofHeader]:proof};
            let denial = 0;
            let disconnect = 0;
            try {
              const response = await fetch(path, {method:"POST", headers:scoped, signal:AbortSignal.timeout(3_000),
                body:JSON.stringify({operation:"accept", document:{hostIncarnationId:attempt.hostIncarnationId,
                  windowId:attempt.windowId, uiIncarnationId:attempt.uiIncarnationId, workspaceId:attempt.workspaceId}, target:attempt})});
              denial = response.status;
              await response.body?.cancel();
            } finally {
              const response = await fetch(path, {method:"POST", headers:scoped, signal:AbortSignal.timeout(3_000),
                body:JSON.stringify({operation:"disconnect", document:target})});
              disconnect = response.status;
              await response.body?.cancel();
            }
            return {registration:registration.status, denial, disconnect};
          }, {path:MANAGED_BROWSER_CONSENT_PATH, proofHeader:MANAGED_BROWSER_DOCUMENT_HEADER, workspaceId:activeWorkspaceId,
            organizationId, attempt});
          assert.deepEqual(peerDenial, {registration:200, denial:403, disconnect:200});
          evidence.browser_cross_tab_consent_status = peerDenial.denial;
          await modal.getByRole("button", {name:"Accept automation takeover", exact:true}).click({timeout:8_000});
          await revoke.waitFor({timeout:5_000});
          active = await until<UiControlLeaseTarget>(async () => {
            const status = readHeadlessWindowResult(await call("aisb_window_status", {target:attempt}));
            return status.ok && status.value.kind === "request" ? status.value.lease : undefined;
          });
          const command = {...presentationRequest, intent:currentIntent, target:active, commandId:randomUUID()};
          const present = async (args: typeof command) => readHeadlessWindowResult(await call("aisb_present_in_window", args));
          stage = "queue-first-admission";
          const first = await present(command);
          assert.ok(first.ok && first.value.kind === "command" && first.value.receipt.sequence === 1);
          stage = "queue-hold-observed";
          await until(async () => await gate.evaluate(probe => probe.held()) ? true : undefined, 15);
          stage = "queue-capacity";
          let accepted = 1;
          let denied = 0;
          for (let index = 0; index < 32; index += 2) {
            const pair = await Promise.all([present({...command, commandId:randomUUID()}), present({...command, commandId:randomUUID()})]);
            for (const result of pair) {
              if (result.ok && result.value.kind === "command" && result.value.receipt.status === "accepted") accepted++;
              if (!result.ok && result.code === "headless.operation-capacity") denied++;
            }
          }
          evidence.browser_queue_peak = accepted;
          evidence.browser_queue_capacity_denials = denied;
          assert.equal(accepted, 32);
          assert.equal(denied, 1);
          assert.equal(await gate.evaluate(probe => probe.held()), true);
          stage = "queue-duplicate-and-conflict";
          const replay = await present(command);
          assert.ok(replay.ok && replay.value.kind === "command" && replay.value.duplicate && replay.value.receipt.sequence === 1);
          assert.deepEqual(await present({...command, intent:{...command.intent, action:"show-validation"}}),
            {ok:false, code:"headless.idempotency-conflict"});
          assert.equal(await panel.count(), 0);
          await gate.evaluate(probe => probe.observePanel());
          stage = "queue-revoke-before-release";
          await revoke.click();
          await revoke.waitFor({state:"detached", timeout:3_000});
          await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
          await gate.evaluate(probe => probe.observeManualControls());
          page.on("framenavigated", monitorNavigation);
          await gate.evaluate(probe => probe.release());
          await until(async () => await gate.evaluate(probe => probe.finished()) ? true : undefined);
          await until(async () => {
            const status = readHeadlessWindowResult(await call("aisb_window_status", {target:attempt}));
            return status.ok && status.value.kind === "ended" ? true : undefined;
          });
          assert.ok(!(await present(command)).ok);
          assert.equal(await panel.count(), 0);
          const staleAppearances = await gate.evaluate(probe => probe.staleAppearances());
          assert.equal(staleAppearances, 0);
          assert.equal(navigations, 0);
          assert.deepEqual(await gate.evaluate(probe => probe.readManualControls()), {
            focusEvents:0, focusPreserved:true, routePreserved:true,
          });
          evidence.browser_revoked_held_response_no_focus_or_navigation = true;
          evidence.browser_stale_panel_appearances = staleAppearances;
          evidence.browser_exact_duplicate_and_conflict = true;
          evidence.browser_revoked_held_response_no_display = true;
        } finally {
          page.off("framenavigated", monitorNavigation);
          try {await gate.evaluate(probe => probe.restore());}
          finally {await gate.dispose();}
        }

        stage = "actual-background-and-resume";
        await peer.bringToFront();
        await until(async () => await page.evaluate(() => document.hidden) ? true : undefined);
        assert.equal(await peer.evaluate(() => document.hidden), false);
        const peerTab = await getTab();
        assert.notEqual(peerTab.uiIncarnationId, visibleTab.uiIncarnationId);
        const name = "Synthetic saved while first tab is hidden";
        const changed = await call("aisb_create_system", {...scope, templateId, name, idempotencyKey:randomUUID()});
        assert.ok(changed.ok && changed.value.kind === "committed");
        assert.ok(!readHeadlessWindowResult(await call("aisb_request_window", {target:visibleTab,
          taskId:randomUUID(), requestKey:randomUUID()})).ok);
        await page.bringToFront();
        await until(async () => await page.evaluate(() => !document.hidden) ? true : undefined);
        await management.getByRole("cell", {name:new RegExp(name)}).waitFor({timeout:10_000});
        const refreshed = await getTab();
        assert.notEqual(refreshed.uiIncarnationId, visibleTab.uiIncarnationId);
        assert.notEqual(refreshed.uiIncarnationId, peerTab.uiIncarnationId);
        assert.equal(await panel.count(), 0);
        assert.equal(await modal.count(), 0);
        evidence.browser_second_tab_cannot_accept = true;
        evidence.hidden_tab_shows_current_save_with_fresh_registration = true;
      } finally {
        await peer.close();
      }
    }

    if (reverseRefetch && saved) {
      stage = "reverse-refetch-prepare";
      const {systemId} = saved;
      await manage.click();
      const record = await call("aisb_read_system", {...scope, systemId});
      assert.ok(record.ok && typeof record.value?.name === "string");
      const row = management.locator(`tr[data-saved-system="${systemId}"]`);
      await row.getByText(record.value.name, {exact:true}).waitFor();
      const olderName = "Synthetic earlier list result";
      const newerName = "Synthetic current list result";
      const gate = await page.evaluateHandle(({systemId, workspaceId, olderName, newerName}) => {
        const original = window.fetch;
        const delay = Promise.withResolvers<void>();
        let held = false;
        let expired = false;
        let released = false;
        const deadline = setTimeout(() => {expired = true; delay.resolve();}, 12_000);
        let consumed = false;
        let staleAppearances = 0;
        const read = {async run(input:RequestInfo | URL, init?:RequestInit) {
          const response = await original.call(window, input, init);
          if (held || !response.ok) return response;
          const url = new URL(response.url);
          if (url.origin !== location.origin || url.pathname !== "/api/systems/manage" ||
              url.searchParams.get("workspaceId") !== workspaceId) return response;
          const reply = await response.clone().json();
          if (held || reply?.ok !== true || !reply.value?.items?.some((item:{systemId:string;name:string}) =>
            item.systemId === systemId && item.name === olderName)) return response;
          held = true;
          await delay.promise;
          const json = response.json.bind(response);
          const reader = {async read() {
            const result = await json();
            consumed = true;
            return result;
          }};
          response.json = reader.read;
          return response;
        }};
        window.fetch = read.run;
        const table = {row() {
          return [...document.querySelectorAll<HTMLTableRowElement>("tr[data-saved-system]")]
            .find(element => element.dataset.savedSystem === systemId);
        }};
        const watcher = new MutationObserver(() => {
          if (table.row()?.textContent?.includes(olderName)) staleAppearances++;
        });
        return {held() {return held && !released && !expired;},
          check() {return {consumed, expired, staleAppearances, rendersNewer:table.row()?.textContent?.includes(newerName) === true};},
          watchAndRelease() {
            watcher.observe(document.body, {subtree:true, childList:true, characterData:true});
            clearTimeout(deadline);
            released = true;
            delay.resolve();
          },
          restore() {
            watcher.disconnect();
            clearTimeout(deadline);
            delay.resolve();
            if (window.fetch === read.run) window.fetch = original;
          }};
      }, {systemId, workspaceId:activeWorkspaceId, olderName, newerName});
      const rename = async (base: {revisionId:string;recordRevision:number}, name:string) => {
        const result = readHeadlessAuthoringWireResult(await call("aisb_rename_system", {...scope, systemId,
          baseRevisionId:base.revisionId, baseRecordRevision:base.recordRevision, name, idempotencyKey:randomUUID()}));
        assert.ok(result.ok && result.value.kind === "committed");
        return result.value.reference;
      };
      try {
        stage = "reverse-refetch-hold-old-live-reply";
        const earlier = await rename({revisionId:record.value.currentRevisionId, recordRevision:record.value.revision}, olderName);
        await until(async () => await gate.evaluate(value => value.held()) ? true : undefined, 25);
        stage = "reverse-refetch-render-new-live-reply";
        const current = await rename(earlier, newerName);
        await row.getByText(newerName, {exact:true}).waitFor({timeout:5_000});
        assert.equal(await gate.evaluate(value => value.held()), true);
        stage = "reverse-refetch-release-old-live-reply";
        await gate.evaluate(value => value.watchAndRelease());
        await until(async () => (await gate.evaluate(value => value.check())).consumed ? true : undefined, 20);
        await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
        assert.deepEqual(await gate.evaluate(value => value.check()), {consumed:true, expired:false, staleAppearances:0, rendersNewer:true});
        assert.equal(await row.getByText(olderName, {exact:true}).count(), 0);
        assert.equal(await panel.count(), 0);
        saved = current;
        evidence.reverse_managed_refetch_consumed_without_regression = true;
      } finally {
        await gate.evaluate(value => value.restore());
        await gate.dispose();
      }
    }

    if (draft && saved) {
      stage = "dirty-canvas-open";
      const target = {...scope, systemId:saved.systemId};
      const authoritative = async () => {
        const result = await call("aisb_read_system", target);
        assert.ok(result.ok && result.value?.currentRevisionId && Number.isSafeInteger(result.value.revision));
        return {baseRecordRevision:result.value.revision, baseRevisionId:result.value.currentRevisionId};
      };
      const readName = await call("aisb_read_system", target);
      assert.ok(readName.ok && typeof readName.value?.name === "string");
      const tableId = `${saved.systemId}.table`;
      const title = await openCanvasTitle(readName.value.name, tableId);
      assert.equal(await title.inputValue(), inFlightEdit ? editedTitle : "Authorized artifacts");
      const apply = async (text: string) => {
        const flow = stage;
        stage = `${flow}-read-base`;
        const input = {...target,...await authoritative(), edits:[{kind:"configure", instanceId:tableId, values:{title:text}}]};
        stage = `${flow}-preview`;
        const preview = await call("aisb_preview_edits", input);
        if (typeof preview.code === "string" && /^headless\.[a-z-]{1,40}$/.test(preview.code))
          evidence.last_safe_headless_code = preview.code;
        assert.ok(preview.ok && typeof preview.value?.previewDigest === "string");
        stage = `${flow}-apply`;
        const exact = {...input, previewDigest:preview.value.previewDigest, idempotencyKey:randomUUID()};
        const beganApply = performance.now();
        const result = await call("aisb_apply_edits", exact);
        evidence.last_apply_ms = performance.now() - beganApply;
        if (typeof result.code === "string" && /^headless\.[a-z-]{1,40}$/.test(result.code))
          evidence.last_safe_headless_code = result.code;
        if (!result.ok) {
          const decision = await fixture.request(MANAGED_HEADLESS_AGENT_PATHS.author, {method:"POST", token:access, organizationId,
            body:{version:HEADLESS_CONTRACT_VERSION, operation:"systems.apply-edits", input:exact}});
          evidence.same_key_status = decision.status;
          evidence.same_key_replayed = decision.body.value?.kind === "replayed";
          const code: unknown = decision.body.code;
          if (typeof code === "string" && /^headless\.[a-z-]{1,40}$/.test(code)) evidence.same_key_code = code;
          const observed = await authoritative();
          evidence.failed_call_changed_revision = observed.baseRecordRevision !== input.baseRecordRevision;
        }
        assert.ok(result.ok && result.value?.reference);
        stage = `${flow}-wait-for-ui`;
        return result.value.reference;
      };
      stage = "dirty-canvas-clean-remote-update";
      await apply("Synthetic first external version");
      await until(async () => await title.inputValue() === "Synthetic first external version" ? true : undefined, 50);
      await title.fill("Synthetic human draft, unsaved");
      const save = page.getByRole("button", {name:"Save and validate revision", exact:true});
      assert.equal(await save.isEnabled(), true);
      stage = "dirty-canvas-remote-conflict";
      const winner = await apply("Synthetic winning external version");
      await page.getByText("A newer saved version exists. Your unsaved changes are still here.", {exact:true}).waitFor({timeout:10_000});
      assert.equal(await title.inputValue(), "Synthetic human draft, unsaved");
      await save.click();
      const notification = page.getByRole("button", {name:/^Notifications(?:,|$)/});
      await notification.click();
      const notices = page.getByRole("dialog", {name:"Notifications", exact:true});
      await notices.getByText("This system changed. Reload it before saving again.", {exact:true}).waitFor({timeout:10_000});
      await notices.press("Escape");
      assert.equal(await title.inputValue(), "Synthetic human draft, unsaved");
      assert.deepEqual(await authoritative(), {baseRevisionId:winner.revisionId, baseRecordRevision:winner.recordRevision});
      evidence.dirty_user_values_and_winning_revision_preserved = true;

      stage = "dirty-canvas-takeover-request";
      const request = readHeadlessWindowResult(await call("aisb_request_window", {
        target:await getTab(), taskId:randomUUID(), requestKey:randomUUID(),
      }));
      assert.ok(request.ok && request.value.kind === "request");
      const attempt = request.value.request.target;
      let saveRequests = 0;
      let grantRequests = 0;
      const observe = (outgoing: BrowserRequest) => {
        if (outgoing.method() !== "POST") return;
        const url = new URL(outgoing.url());
        if (url.origin !== trusted) return;
        if (url.pathname === "/api/systems/revisions/save") saveRequests++;
        if (url.pathname === MANAGED_BROWSER_CONSENT_PATH) {
          const operation = outgoing.postDataJSON()?.operation;
          if (operation === "accept" || operation === "ready") grantRequests++;
        }
      };
      page.on("request", observe);
      try {
        await modal.getByRole("button", {name:"Accept automation takeover", exact:true}).click();
        const confirm = modal.getByRole("button", {name:"Save changes and accept takeover", exact:true});
        await confirm.waitFor({timeout:5_000});
        assert.equal(saveRequests, 0);
        assert.equal(grantRequests, 0);
        stage = "dirty-canvas-takeover-declines-stale-save";
        await confirm.click();
        await until(async () => {
          const result = readHeadlessWindowResult(await call("aisb_window_status", {target:attempt}));
          return result.ok && result.value.kind === "ended" ? true : undefined;
        }, 50);
        await revoke.waitFor({state:"detached",timeout:5_000});
        assert.equal(await panel.count(), 0);
        assert.equal(saveRequests, 1);
        assert.equal(grantRequests, 0);
        assert.equal(await title.inputValue(), "Synthetic human draft, unsaved");
        assert.equal(await save.isEnabled(), true);
        assert.deepEqual(await authoritative(), {baseRevisionId:winner.revisionId, baseRecordRevision:winner.recordRevision});
        evidence.stale_save_before_accept_keeps_draft_without_host_grant = true;
      } finally {
        page.off("request", observe);
      }
    }

    if (loseReply) {
      stage = "lost-committed-create-reply";
      await manage.click();
      const snapshot = await fixture.request("/api/headless/system-builder/snapshot", {method:"POST",
        token:browserBearer, organizationId, body:{workspaceId:activeWorkspaceId}});
      assert.equal(snapshot.status, 200);
      const lostClient = new Client({name:"managed-lost-write-fixture", version:"1.0.0"});
      const transport = makeTransport();
      let droppedReference: {systemId:string;revisionId:string;recordRevision:number} | undefined;
      const name = "Synthetic system with a lost reply";
      const args = {...scope, templateId, name, idempotencyKey:randomUUID()};
      try {
        await lostClient.connect(transport);
        let id: string | number | undefined;
        const send = transport.send.bind(transport);
        const receive = transport.onmessage;
        transport.send = message => {
          if ("id" in message && "method" in message && message.method === "tools/call" &&
              message.params?.name === "aisb_create_system") id = message.id;
          return send(message);
        };
        transport.onmessage = message => {
          if (id !== undefined && "id" in message && message.id === id && "result" in message) {
            const blocks = message.result.content;
            if (Array.isArray(blocks) && blocks.length === 1 && blocks[0]?.type === "text" && typeof blocks[0].text === "string") {
              try {
                const result = readHeadlessAuthoringWireResult(JSON.parse(blocks[0].text));
                if (result.ok && result.value.kind === "committed") {
                  droppedReference = result.value.reference;
                  transport.send = send;
                  transport.onmessage = receive;
                  void lostClient.close().catch(() => undefined);
                  return;
                }
              } catch { /* Bad or non-commit replies remain visible to the fixture. */ }
            }
          }
          receive?.(message);
        };
        await assert.rejects(lostClient.callTool({name:"aisb_create_system", arguments:args}, undefined, {timeout:5_000}));
        assert.ok(droppedReference);
      } finally {
        await lostClient.close();
      }
      await management.getByRole("cell", {name:new RegExp(name)}).waitFor({timeout:8_000});
      assert.deepEqual(await call("aisb_create_system", args), {ok:true,value:{kind:"replayed",reference:droppedReference}});
      const events = await fixture.request("/api/headless/system-builder/changes", {method:"POST", token:browserBearer,
        organizationId, body:{workspaceId:activeWorkspaceId,cursor:snapshot.body.value.cursor}});
      assert.equal(events.status, 200);
      assert.equal(events.body.value.events.length, 1);
      assert.deepEqual(events.body.value.events[0], {...droppedReference,sequence:snapshot.body.value.cursor.sequence + 1});
      assert.equal(await management.getByRole("cell", {name:new RegExp(name)}).count(), 1);
      evidence.lost_create_reply_replayed_one_durable_event = true;
    }

    stage = "reload-before-document";
    const beforeReload = await getTab();
    stage = "reload-visible-systems";
    await page.reload({waitUntil:"domcontentloaded"});
    await page.bringToFront();
    await systems.waitFor({timeout: 20_000});
    stage = "reload-fresh-registration";
    // A connection lost during reload can leave the old document registered
    // until the host's existing 12-second document watchdog expires.
    const next = await getTab(75, beforeReload.uiIncarnationId);
    assert.notEqual(next.uiIncarnationId, beforeReload.uiIncarnationId);
    assert.equal(await modal.count(), 0);
    evidence.reload_requires_fresh_document = true;

    if (membershipLoss) {
      stage = "membership-loss-positive-control";
      assert.ok(agent.setSyntheticMembershipSuspended);
      const browserPost = (route:string, body:Record<string, unknown>) => fixture.request(route, {
        method:"POST", token:browserBearer, organizationId, body});
      const snapshot = () => browserPost("/api/headless/system-builder/snapshot", {workspaceId:activeWorkspaceId});
      const before = await snapshot();
      assert.equal(before.status, 200);
      stage = "membership-loss-commit-authorized-save";
      const input = {...scope, templateId, name:"Synthetic save before membership loss", idempotencyKey:randomUUID()};
      const committed = readHeadlessAuthoringWireResult(await call("aisb_create_system", input));
      assert.ok(committed.ok && committed.value.kind === "committed");
      const reference = committed.value.reference;
      const changes = () => browserPost("/api/headless/system-builder/changes",
        {workspaceId:activeWorkspaceId,cursor:before.body.value.cursor});
      stage = "membership-loss-verify-authorized-feed";
      const allowed = await changes();
      assert.equal(allowed.status, 200);
      assert.deepEqual(allowed.body.value.events, [{...reference, sequence:before.body.value.cursor.sequence + 1}]);
      stage = "membership-loss-request-own-tab";
      const requested = readHeadlessWindowResult(await call("aisb_request_window", {target:await getTab(),
        taskId:randomUUID(), requestKey:randomUUID()}));
      assert.ok(requested.ok && requested.value.kind === "request");
      const attempt = requested.value.request.target;
      stage = "membership-loss-accept-and-activate";
      await modal.getByRole("button", {name:"Accept automation takeover", exact:true}).click();
      await revoke.waitFor({timeout:10_000});
      const lease = await until<UiControlLeaseTarget>(async () => {
        const result = readHeadlessWindowResult(await call("aisb_window_status", {target:attempt}));
        return result.ok && result.value.kind === "request" && result.value.request.status === "active" ? result.value.lease : undefined;
      });
      const show = {target:lease, commandId:randomUUID(), intent:{action:"open-system",
        systemId:reference.systemId, revisionId:reference.revisionId}};
      stage = "membership-loss-present-before-change";
      const accepted = readHeadlessWindowResult(await call("aisb_present_in_window", show));
      if (!accepted.ok) evidence.membership_presentation_safe_code = accepted.code;
      assert.ok(accepted.ok && accepted.value.kind === "command" && accepted.value.receipt.status === "accepted");
      await panel.waitFor({timeout:3_000});
      stage = "membership-loss-confirm-manual-gate";
      const settings = page.locator("button.ui-shell__settings-button");
      assert.equal(await settings.isEnabled(), false);
      stage = "membership-loss-detaches-presenting-browser";
      await agent.setSyntheticMembershipSuspended(true);
      try {
        await revoke.waitFor({state:"detached", timeout:10_000});
        await panel.waitFor({state:"hidden", timeout:5_000});
        await until(async () => await settings.isEnabled() ? true : undefined, 20);
        evidence.membership_loss_automatically_restored_manual_control = true;
        stage = "membership-loss-denies-existing-credentials";
        const [snapshotDenied, changesDenied] = await Promise.all([snapshot(), changes()]);
        assert.equal(snapshotDenied.status, 403);
        assert.equal(changesDenied.status, 403);
        assert.equal(snapshotDenied.body.value, undefined);
        assert.equal(changesDenied.body.value, undefined);
        const record = await call("aisb_read_system", {...scope, systemId:reference.systemId});
        assert.equal(record.ok, false);
        assert.equal(record.value, undefined);
        assert.ok(!readHeadlessWindowResult(await call("aisb_window_context", {target:lease})).ok);
        assert.ok(!readHeadlessWindowResult(await call("aisb_renew_window", {target:lease})).ok);
        assert.ok(!readHeadlessWindowResult(await call("aisb_present_in_window", {...show,commandId:randomUUID()})).ok);
        const rejectedWrites = [
          await call("aisb_create_system", input),
          await call("aisb_create_system", {...input, name:"Synthetic forbidden save", idempotencyKey:randomUUID()}),
        ];
        for (const write of rejectedWrites.map(readHeadlessAuthoringWireResult)) {
          assert.ok(!write.ok && (write.code === "headless.operation-unconfirmed" || write.code === "headless.forbidden"));
        }
        evidence.suspended_member_cannot_read_write_replay_or_present = true;
      } finally {
        await agent.setSyntheticMembershipSuspended(false);
      }
      stage = "membership-loss-restore-and-confirm-saved-state";
      const currentChanges = await changes();
      assert.equal(currentChanges.status, 200);
      assert.deepEqual(currentChanges.body.value.events, allowed.body.value.events);
      assert.deepEqual(await call("aisb_create_system", input), {ok:true, value:{kind:"replayed", reference}});
      assert.ok(!readHeadlessWindowResult(await call("aisb_window_context", {target:lease})).ok);
      assert.equal(await panel.count(), 0);
      assert.equal(await revoke.count(), 0);
      evidence.restored_member_sees_one_prior_save_and_no_old_lease = true;
    }

    if (rollback) {
      stage = "rollback-commit-before-restart";
      assert.ok(agent.restartHeadlessServer);
      const input = {...scope, templateId, name:"Synthetic saved before managed rollback", idempotencyKey:randomUUID()};
      const committed = readHeadlessAuthoringWireResult(await call("aisb_create_system", input));
      assert.ok(committed.ok && committed.value.kind === "committed");
      const reference = committed.value.reference;
      const registerTarget = await getTab();
      const draftContext = await browser.newContext({viewport:{width:1280, height:900}, acceptDownloads:false, serviceWorkers:"block"});
      try {
        stage = "rollback-create-ordinary-draft";
        await draftContext.route("**/*", route => {
          const destination = new URL(route.request().url());
          return destination.origin !== trusted || [MANAGED_BROWSER_CONSENT_PATH, MANAGED_BROWSER_OBSERVE_PATH]
            .some(pathname => destination.pathname === pathname) ? route.abort() : route.continue();
        });
        await draftContext.addInitScript(({origin, value}) => {
          if (location.origin === origin) localStorage.setItem("ai-system-builder.paired-device-token", value);
        }, {origin:trusted, value:browserBearer});
        const draftPage = await draftContext.newPage();
        await draftPage.goto(`${trusted}/systems`, {waitUntil:"domcontentloaded"});
        const field = await openCanvasTitle(input.name, `${reference.systemId}.table`, draftPage);
        const unsaved = "Synthetic draft retained across restart";
        assert.notEqual(await field.inputValue(), unsaved);
        await field.fill(unsaved);
        const dirty = draftPage.getByText("Unsaved changes", {exact:true});
        await dirty.waitFor({timeout:5_000});
        await page.bringToFront();
        const settings = page.locator("button.ui-shell__settings-button");
        stage = "rollback-activate-exact-browser";
        const request = readHeadlessWindowResult(await call("aisb_request_window", {target:await getTab(),
          requestKey:randomUUID(), taskId:randomUUID()}));
        assert.ok(request.ok && request.value.kind === "request");
        const target = request.value.request.target;
        assert.equal(target.workspaceId, registerTarget.workspaceId);
        await modal.getByRole("button", {name:"Accept automation takeover", exact:true}).click();
        await revoke.waitFor({timeout:10_000});
        const lease = await until<UiControlLeaseTarget>(async () => {
          const result = readHeadlessWindowResult(await call("aisb_window_status", {target}));
          return result.ok && result.value.kind === "request" && result.value.request.status === "active" ? result.value.lease : undefined;
        });
        const show = readHeadlessWindowResult(await call("aisb_present_in_window", {target:lease, commandId:randomUUID(),
          intent:{action:"open-system", systemId:reference.systemId, revisionId:reference.revisionId}}));
        assert.ok(show.ok && show.value.kind === "command" && show.value.receipt.status === "accepted");
        await panel.waitFor({timeout:5_000});
        assert.equal(await settings.isEnabled(), false);
        const ordinary = "/api/workspaces";
        const managePath = `/api/systems/manage?workspaceId=${encodeURIComponent(activeWorkspaceId)}&view=active&sort=updated-desc&limit=25`;
        const browserAuth = {token:browserBearer, organizationId};
        const audit = path.join(fixture.runRoot, "runtime", "security", "authorization-audit.jsonl");
        assert.equal((await fixture.request(ordinary, browserAuth)).status, 200);
        const beforeSize = (await stat(audit)).size;
        assert.ok(beforeSize > 0 && beforeSize <= 512 * 1024, "Synthetic audit has a bounded nonempty prefix.");
        const before = await readFile(audit);
        stage = "rollback-disable-and-retire";
        await agent.restartHeadlessServer(false);
        await revoke.waitFor({state:"detached", timeout:12_000});
        await panel.waitFor({state:"hidden", timeout:5_000});
        await until(async () => await settings.isEnabled() ? true : undefined, 20);
        assert.equal(await modal.count(), 0);
        assert.equal(await field.inputValue(), unsaved);
        assert.ok(await dirty.isVisible() && await field.isEnabled());
        evidence.rollback_restored_manual_controls_and_retained_draft = true;
        stage = "rollback-disabled-route-and-ordinary-api";
        const optional = [
          ...Object.values(MANAGED_SAVED_STATE_PATHS), MANAGED_BROWSER_CONSENT_PATH, MANAGED_BROWSER_OBSERVE_PATH,
          MANAGED_BROWSER_DELIVERY_PATH, MANAGED_BROWSER_ACKNOWLEDGE_PATH,
          MANAGED_BROWSER_CONTEXT_PATH, MANAGED_BROWSER_PUBLISH_CONTEXT_PATH,
        ];
        for (const route of optional) {
          const response = await fixture.request(route, {...browserAuth, method:"POST", body:{workspaceId:activeWorkspaceId}});
          assert.equal(response.status, 404);
        }
        for (const route of Object.values(MANAGED_HEADLESS_AGENT_PATHS)) {
          const response = await fixture.request(route, {token:access, organizationId, method:"POST", body:{workspaceId:activeWorkspaceId}});
          assert.equal(response.status, 404);
        }
        evidence.rollback_disabled_routes = optional.length + Object.keys(MANAGED_HEADLESS_AGENT_PATHS).length;
        assert.equal((await fixture.request(ordinary)).status, 401);
        assert.equal((await fixture.request(ordinary, {...browserAuth, organizationId:"qualification.foreign"})).status, 403);
        const managed = await fixture.request(managePath, browserAuth);
        assert.equal(managed.status, 200);
        const item = managed.body.value.items.find((value: {systemId:string}) => value.systemId === reference.systemId);
        assert.equal(item?.name, input.name);
        assert.equal(item?.recordRevision, reference.recordRevision);
        await manage.click();
        await management.getByRole("cell", {name:new RegExp(input.name)}).waitFor({timeout:7_000});
        const afterSize = (await stat(audit)).size;
        assert.ok(afterSize > before.length && afterSize <= 512 * 1024);
        assert.ok((await readFile(audit)).subarray(0, before.length).equals(before));
        evidence.rollback_removed_optional_routes_and_preserved_secured_api_and_audit = true;
        stage = "rollback-restore-to-verify-durable-receipt";
        await agent.restartHeadlessServer(true);
        const fresh = await call("aisb_host_describe");
        assert.ok(fresh.ok && fresh.value.hostIncarnationId !== scope.hostIncarnationId);
        const result = await call("aisb_create_system", {...input, hostIncarnationId:fresh.value.hostIncarnationId});
        assert.deepEqual(result, {ok:true, value:{kind:"replayed", reference}});
        assert.ok(!readHeadlessWindowResult(await call("aisb_window_context", {target:lease})).ok);
        assert.equal(await panel.count(), 0);
        assert.equal(await field.inputValue(), unsaved);
        evidence.rollback_retained_saved_receipt_without_restoring_old_lease = true;
      } finally {
        await draftContext.close();
      }
    }

    passed = true;
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    evidence.failure_category = /__name is not defined/.test(message) ? "driver-function-serialization" :
      /timeout|did not become visible/i.test(message) ? "fixture-timeout" :
      /closed|destroyed/i.test(message) ? "fixture-closed" : "fixture-assertion-or-infrastructure";
  } finally {
    if (passed) stage = "cleanup";
    await browser?.close().catch(() => {passed = false;});
    await client.close().catch(() => {passed = false;});
    await fixture.stop().catch(() => {passed = false;});
    const kind = presentation ? "managed-headless-browser-presentation" : "managed-headless-browser-consent";
    await writeFile(path.join(fixture.runRoot, `${kind}-evidence.json`), JSON.stringify({
      schema_version:`${kind}-v1`, source_revision:fixture.sourceRevision, status:passed ? "passed" : "failed", stage, evidence,
    }, null, 2) + "\n", {flag:"wx"});
  }
  assert.equal(passed, true);
  process.stdout.write(JSON.stringify({status: "passed", evidence}) + "\n");
}

void main().catch(() => {
  process.stderr.write('{"status":"failed","code":"managed-headless.browser-consent-unqualified"}\n');
  process.exitCode = 1;
});
