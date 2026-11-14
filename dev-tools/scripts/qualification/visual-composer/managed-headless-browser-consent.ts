import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { arch, platform, release, totalmem } from "node:os";
import path from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { chromium, type Browser } from "@playwright/test";

import { MANAGED_BROWSER_CONSENT_PATH } from "../../../../modules/contracts/headless/managed-browser-consent";
import { startManagedReferenceHost } from "./managed-reference-host";

async function until<T>(observe: () => Promise<T | undefined>, attempts = 30) {
  for (let count = 0; count < attempts; count++) {
    const value = await observe();
    if (value !== undefined) return value;
    await sleep(200);
  }
  throw new Error("The expected state did not become visible.");
}

async function main() {
  const fixture = await startManagedReferenceHost(process.env.MANAGED_REFERENCE_DATABASE ?? "", {headlessAgent:true, headlessBrowser:true});
  const client = new Client({name: "managed-browser-consent-qualification", version: "1.0.0"});
  const evidence: Record<string, boolean | number | string> = {
    os: platform(), architecture: arch(), os_release: release(), ram_gib: Math.round(totalmem() / 2**30),
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
    await client.connect(new StdioClientTransport({command: process.execPath,
      args: ["--import", "tsx", path.resolve("modules/adapters/transport/headless-mcp/serveHeadlessMcpReadAdapter.mts")],
      env: {AISB_HEADLESS_MODE: "managed", AISB_HEADLESS_MANAGED_ORIGIN: serverOrigin, AISB_HEADLESS_MANAGED_CREDENTIAL: access,
        AISB_HEADLESS_MANAGED_ORGANIZATION_ID: organizationId, AISB_HEADLESS_MANAGED_WORKSPACE_ID: activeWorkspaceId,
        AISB_HEADLESS_ENABLE_MANAGED_CONSENT: "1", NODE_EXTRA_CA_CERTS: caFile, TSX_DISABLE_CACHE: "1"},
      stderr: "ignore", maxBufferSize: 256 * 1024,
    }));
    const call = async (name: string, args: Record<string, unknown> = {}) => {
      const reply = await client.callTool({name, arguments: args}, undefined, {timeout: 5_000});
      assert.ok(Array.isArray(reply.content) && reply.content.length === 1 && reply.content[0].type === "text");
      return JSON.parse(reply.content[0].text);
    };
    const described = await call("aisb_host_describe");
    assert.equal(described.ok, true);
    const scope = {hostIncarnationId: described.value.hostIncarnationId, workspaceId: activeWorkspaceId};
    browser = await chromium.launch({channel: "chrome", headless: true,
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
    await page.goto(`${trusted}/systems`, {waitUntil:"domcontentloaded"});
    const systems = page.getByRole("heading", {name: "Systems", exact: true});
    await systems.waitFor({timeout: 20_000});
    await page.getByRole("tab", {name: "Compose", exact: true}).waitFor({timeout: 20_000});
    stage = "identify-tab";
    const getTab = () => until(async () => {
      const result = await call("aisb_list_windows", scope);
      assert.equal(result.ok, true);
      return result.value.windows.length === 1 ? result.value.windows[0] : undefined;
    });
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
    await until(async () => {
      const status = await call("aisb_window_status", {target:attempt});
      return status.ok && status.value.request?.status === "active" && status.value.lease ? true : undefined;
    });
    evidence.exact_document_active = true;

    stage = "revoke";
    await revoke.click();
    await revoke.waitFor({state:"detached", timeout:5_000});
    await until(async () => {
      const status = await call("aisb_window_status", {target:attempt});
      return status.ok && status.value.kind === "ended" ? true : undefined;
    });
    assert.deepEqual(await call("aisb_request_window", ask), {ok:true, value:{kind:"ended"}});
    evidence.revoke_disables_retry = true;

    stage = "reload";
    await page.reload({waitUntil:"domcontentloaded"});
    await systems.waitFor({timeout: 20_000});
    const next = await getTab();
    assert.notEqual(next.uiIncarnationId, tab.uiIncarnationId);
    assert.equal(await modal.count(), 0);
    evidence.reload_requires_fresh_document = true;
    passed = true;
  } finally {
    if (passed) stage = "cleanup";
    await browser?.close().catch(() => {passed = false;});
    await client.close().catch(() => {passed = false;});
    await fixture.stop().catch(() => {passed = false;});
    await writeFile(path.join(fixture.runRoot, "managed-headless-browser-consent-evidence.json"), JSON.stringify({
      schema_version:"managed-headless-browser-consent-v1", source_revision:fixture.sourceRevision, status:passed ? "passed" : "failed", stage, evidence,
    }, null, 2) + "\n", {flag:"wx"});
  }
  assert.equal(passed, true);
  process.stdout.write(JSON.stringify({status: "passed", evidence}) + "\n");
}

void main().catch(() => {
  process.stderr.write('{"status":"failed","code":"managed-headless.browser-consent-unqualified"}\n');
  process.exitCode = 1;
});
