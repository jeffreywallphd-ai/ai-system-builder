import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {lstatSync, realpathSync} from "node:fs";
import {writeFile} from "node:fs/promises";
import path from "node:path";
import {spawnSync} from "node:child_process";
import {isDeepStrictEqual, types} from "node:util";
import {setTimeout as pause} from "node:timers/promises";
import {Client} from "@modelcontextprotocol/client";
import {StdioClientTransport} from "@modelcontextprotocol/client/stdio";
import {chromium, type Browser} from "@playwright/test";
import {readUiPresentationIntent} from "../../../../modules/contracts/headless";
import {startManagedReferenceHost} from "./managed-reference-host";

let stage = "not-started"; // Assigned only fixed literals; safe before a host/evidence directory exists.

/** Project only the recorded selector; never execute accessors or copy other Model fields. */
export function savedModelWindowIntent(raw: unknown) {
  assert.ok(raw && typeof raw === "object" && !Array.isArray(raw) && !types.isProxy(raw));
  assert.ok([Object.prototype, null].includes(Object.getPrototypeOf(raw)));
  const field = (key: string) => {
    const descriptor = Object.getOwnPropertyDescriptor(raw, key);
    if (descriptor) assert.ok("value" in descriptor);
    return descriptor?.value;
  };
  const id = field("modelRecordId"), updated = field("updatedAt"), created = field("createdAt");
  const intent = readUiPresentationIntent({action: "show-model", modelRecordId: id, modelUpdatedAt: updated ?? created});
  assert.ok(intent?.action === "show-model");
  return Object.freeze(intent);
}

async function observe<T>(read: () => Promise<T | undefined>) {
  for (let attempt = 0; attempt < 30; attempt++) {
    const value = await read();
    if (value !== undefined) return value;
    await pause(200);
  }
  throw new Error("The fixed Managed Model state did not become visible.");
}

function buildCurrentThinClient() {
  const candidates = [process.env.npm_execpath,
    path.join(path.dirname(process.execPath), "node_modules/npm/bin/npm-cli.js"),
    process.env.ProgramFiles ? path.join(process.env.ProgramFiles, "nodejs/node_modules/npm/bin/npm-cli.js") : undefined];
  const npm = candidates.find(value => {
    if (!value || !path.isAbsolute(value) || path.basename(value) !== "npm-cli.js") return false;
    try {return lstatSync(value).isFile() && realpathSync(value) === path.resolve(value);} catch {return false;}
  });
  assert.ok(npm);
  const built = spawnSync(process.execPath, [npm, "run", "build:thin-client"], {
    cwd: process.cwd(), env: process.env, windowsHide: true, stdio: "ignore", timeout: 180_000,
  });
  assert.ok(!built.error && built.status === 0, "The current thin-client build did not pass.");
}

/** One local metadata UI feature. No provider or model work is requested. */
async function main() {
  assert.equal(process.argv.length, 2);
  assert.equal(process.platform, "win32");
  // The existing database operator is ESM with top-level await. Load it through
  // the native dynamic-import path, never the CommonJS test loader.
  const {acquireDatabase, stopDatabase} = await import("./managed-reference-database.mjs");
  for (const key of ["DOCKER_CONTEXT", "DOCKER_TLS_VERIFY", "DOCKER_CERT_PATH"]) delete process.env[key];
  process.env.DOCKER_HOST = "npipe:////./pipe/dockerDesktopLinuxEngine";
  const evidence: Record<string, boolean> = {};
  stage = "build";
  let passed = false, cleanupFailed = false;
  let database: {database_reference: string} | undefined;
  let fixture: Awaited<ReturnType<typeof startManagedReferenceHost>> | undefined;
  let browser: Browser | undefined, client: Client | undefined;
  try {
    buildCurrentThinClient();
    stage = "database";
    database = await acquireDatabase(process.cwd()); // Existing installed digest only; never pulls/adopts.
    stage = "host";
    fixture = await startManagedReferenceHost(database.database_reference,
      {headlessAgent: true, headlessBrowser: true, headlessBrowserPresentation: true});
    const {agent, organizationId, serverOrigin} = fixture;
    assert.ok(agent && fixture.frontendOrigin === serverOrigin && "browserPin" in fixture);
    assert.match(fixture.browserPin, /^[A-Za-z0-9+/]{43}=$/);
    const auth = {token: agent.browser, organizationId};
    stage = "workspace";
    const workspace = await fixture.request("/api/workspaces", {...auth, method: "POST",
      body: {command: {displayName: "Managed Model display qualification"}, selectAfterCreate: true}});
    assert.equal(workspace.status, 201);
    const workspaceId = workspace.body.value.workspace.workspaceId;
    stage = "saved-reference";
    const saved = await fixture.request("/api/model/reference/save", {...auth, method: "POST", body: {
      workspaceId, provider: "huggingface", modelId: "qualification/recorded-model", displayName: "Synthetic saved Model",
      inferenceMode: "chat", taskTags: ["text-generation"], artifactForm: "full-model",
    }});
    assert.equal(saved.status, 200); assert.equal(saved.body.ok, true);
    const intent = savedModelWindowIntent(saved.body.value.model);
    evidence.original_reference_saved = true;
    stage = "browser";
    browser = await chromium.launch({channel: "chrome", headless: true,
      args: [`--ignore-certificate-errors-spki-list=${fixture.browserPin}`]});
    const context = await browser.newContext({viewport: {width: 1280, height: 900}, acceptDownloads: false, serviceWorkers: "block"});
    const origin = new URL(serverOrigin).origin;
    await context.route("**/*", route => new URL(route.request().url()).origin === origin ? route.continue() : route.abort());
    await context.addInitScript(({origin, token}) => {
      if (location.origin === origin) localStorage.setItem("ai-system-builder.paired-device-token", token);
    }, {origin, token: agent.browser});
    const page = await context.newPage(); page.setDefaultTimeout(8_000);
    await page.goto(`${origin}/systems`, {waitUntil: "domcontentloaded", timeout: 20_000});
    await page.getByRole("heading", {name: "Systems", exact: true}).waitFor({timeout: 20_000});
    stage = "paired-client";
    client = new Client({name: "managed-model-window-qualification", version: "1.0.0"});
    await client.connect(new StdioClientTransport({command: process.execPath,
      args: ["--import", "tsx", path.resolve("modules/adapters/transport/headless-mcp/serveHeadlessMcpReadAdapter.mts")],
      env: {AISB_HEADLESS_MODE: "managed", AISB_HEADLESS_MANAGED_ORIGIN: origin,
        AISB_HEADLESS_MANAGED_CREDENTIAL: agent.access, AISB_HEADLESS_MANAGED_ORGANIZATION_ID: organizationId,
        AISB_HEADLESS_MANAGED_WORKSPACE_ID: workspaceId, AISB_HEADLESS_ENABLE_MANAGED_CONSENT: "1",
        AISB_HEADLESS_ENABLE_MANAGED_PRESENTATION: "1", NODE_EXTRA_CA_CERTS: agent.caFile, TSX_DISABLE_CACHE: "1"},
      stderr: "ignore", maxBufferSize: 256 * 1024}));
    const call = async (name: string, args: Record<string, unknown> = {}) => {
      const result = await client!.callTool({name, arguments: args}, undefined, {timeout: 5_000});
      assert.ok(result.content?.length === 1 && result.content[0].type === "text" && result.content[0].text.length <= 64 * 1024);
      return JSON.parse(result.content[0].text);
    };
    const described = await call("aisb_host_describe"); assert.equal(described.ok, true);
    const scope = {hostIncarnationId: described.value.hostIncarnationId, workspaceId};
    stage = "window-consent";
    const windows = await observe(async () => {
      const result = await call("aisb_list_windows", scope);
      return result.ok && result.value?.windows?.length === 1 ? result.value.windows : undefined;
    });
    const requested = await call("aisb_request_window", {target: windows[0], requestKey: randomUUID(), taskId: randomUUID()});
    assert.ok(requested.ok && requested.value.request.target);
    const target = requested.value.request.target;
    await page.getByRole("dialog", {name: "Automation takeover request", exact: true})
      .getByRole("button", {name: "Accept automation takeover", exact: true}).click();
    const lease = await observe(async () => {
      const result = await call("aisb_window_status", {target});
      return result.ok ? result.value.lease : undefined;
    });
    evidence.separate_window_consent = true;
    stage = "stale-reference";
    const stale = {...intent, modelUpdatedAt: "2000-01-01T00:00:00.000Z"};
    assert.notEqual(intent.modelUpdatedAt, stale.modelUpdatedAt);
    assert.deepEqual(await call("aisb_present_in_window", {target: lease, commandId: randomUUID(), intent: stale}),
      {ok: false, code: "headless.forbidden"});
    evidence.stale_reference_refused = true;
    stage = "exact-display";
    const command = {target: lease, commandId: randomUUID(), intent};
    const queued = await call("aisb_present_in_window", command);
    assert.ok(queued.ok && queued.value.receipt.commandId === command.commandId);
    const card = page.getByRole("region", {name: "Resource shown by automation", exact: true});
    await card.getByRole("heading", {name: "Saved model", exact: true}).waitFor();
    assert.equal(await card.locator("code").nth(0).innerText(), intent.modelRecordId);
    assert.equal(await card.locator("code").nth(1).innerText(), intent.modelUpdatedAt);
    assert.ok((await card.innerText()).includes("Runtime and supply checks: not checked."));
    assert.equal(await card.locator("button, input, form").count(), 0);
    evidence.exact_saved_model_displayed = true;
    stage = "replay-and-context";
    const replay = await call("aisb_present_in_window", command); assert.ok(replay.ok && replay.value.duplicate === true);
    await observe(async () => {
      const result = await call("aisb_window_context", {target: lease});
      const expected = {ok: true, value: {kind: "context", context: {view: "model", ready: true,
        dirtyNavigationBlocked: false, selection: intent}}};
      return isDeepStrictEqual(result, expected) ? true : undefined;
    });
    evidence.exact_replay_and_minimal_context = true;
    stage = "revoke";
    const revoke = page.getByRole("button", {name: "Revoke automation takeover", exact: true});
    await revoke.click();
    await revoke.waitFor({state: "detached"});
    await observe(async () => {
      const status = await call("aisb_window_status", {target});
      return status.ok && status.value.kind === "ended" ? true : undefined;
    });
    evidence.original_lease_ended = true;
    stage = "revoked-context";
    // Managed context deliberately does not distinguish an ended lease from
    // another unavailable live context. The positive ended proof is above.
    assert.deepEqual(await call("aisb_window_context", {target: lease}), {ok: false, code: "headless.unavailable"});
    evidence.revoked_context_refused = true;
    stage = "revoked-presentation";
    assert.deepEqual(await call("aisb_present_in_window", {...command, commandId: randomUUID()}), {ok: false, code: "headless.forbidden"});
    evidence.revoked_presentation_refused = true;
    stage = "manual-controls";
    const settings = page.getByRole("button", {name: "Settings", exact: true, description: "Settings"});
    await observe(async () => await settings.isEnabled() ? true : undefined);
    await settings.click();
    stage = "settings-page";
    await page.getByRole("heading", {name: "Settings", exact: true}).waitFor();
    evidence.revoke_restored_manual_controls = true;
    passed = true;
  } finally {
    try {await browser?.close(); evidence.browser_closed = !!browser;} catch {cleanupFailed = true;}
    try {await client?.close(); evidence.client_closed = !!client;} catch {cleanupFailed = true;}
    try {await fixture?.stop(); evidence.original_host_closed = !!fixture;} catch {cleanupFailed = true;}
    try {if (database) {stopDatabase(process.cwd(), database.database_reference); evidence.fresh_database_stopped = true;}}
    catch {cleanupFailed = true;}
    if (fixture) await writeFile(path.join(fixture.runRoot, "managed-model-window-evidence.json"), JSON.stringify({
      schema_version: "managed-model-window-v1", source_revision: fixture.sourceRevision,
      status: passed && !cleanupFailed ? "passed" : "failed", stage, evidence,
    }, null, 2) + "\n", {flag: "wx"});
  }
  assert.ok(passed && !cleanupFailed);
  process.stdout.write('{"status":"passed","feature":"managed-model-window"}\n');
}

if (require.main === module) void main().catch(() => {
  process.stderr.write(JSON.stringify({status: "failed", code: "managed-model-window.unqualified", stage}) + "\n");
  process.exitCode = 1;
});
