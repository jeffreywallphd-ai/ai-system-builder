import assert from "node:assert/strict";
import path from "node:path";
import {writeFile} from "node:fs/promises";
import {chromium, type Browser} from "@playwright/test";
import {Client} from "@modelcontextprotocol/client";
import {StdioClientTransport} from "@modelcontextprotocol/client/stdio";
import {isHeadlessHostIncarnationId} from "../../../../modules/contracts/headless";
import {startManagedReferenceHost} from "./managed-reference-host";
import {safeQualificationFailureType} from "./qualification-reporting";
import {contextWorkflowFacts, runHeadlessContextWorkflow, type ContextCall} from "./e2e/headless-context-workflow";

/** One real Managed Context workflow, run separately from other host/model cases.
 * Browser capture is never enabled. Only synthetic inputs and finite facts leave
 * this process; private credentials and model/source/query bytes stay local. */
async function main() {
  const fixture = await startManagedReferenceHost(process.env.MANAGED_REFERENCE_DATABASE ?? "", {
    headlessAgent: true, headlessBrowser: true, headlessPlanReview: true,
    headlessProvidedDatasets: true, headlessBrowserPresentation: true, headlessContext: true,
  });
  const clients: Client[] = [];
  let browser: Browser | undefined;
  let phase = "workspace", journeyPassed = false, cleanupPassed = false, workerStarted = false;
  const failures: unknown[] = [], facts = contextWorkflowFacts();
  try {
    const {agent, serverOrigin, organizationId} = fixture;
    assert.ok(agent?.planReview && "browserPin" in fixture && fixture.browserPin && fixture.seedContextModel);
    assert.match(fixture.browserPin, /^[A-Za-z0-9+/]{43}=$/);
    const created = await fixture.request("/api/workspaces", {method: "POST", token: agent.browser, organizationId,
      body: {command: {displayName: "Synthetic Managed Context workspace"}, selectAfterCreate: true}});
    assert.equal(created.status, 201);
    const workspaceId = created.body.value.workspace.workspaceId;
    // Only an already installed input is seeded. All sources, tasks, approvals,
    // vectors and saved outputs below are created through the actual app.
    await fixture.seedContextModel(workspaceId);
    async function connect(presentation: boolean): Promise<ContextCall> {
      const client = new Client({name: presentation ? "managed-context-display" : "managed-context-plan", version: "1.0.0"});
      clients.push(client);
      await client.connect(new StdioClientTransport({command: process.execPath,
        args: ["--import", "tsx", path.resolve("modules/adapters/transport/headless-mcp/serveHeadlessMcpReadAdapter.mts")],
        stderr: "ignore", maxBufferSize: 256 * 1024, env: {
          AISB_HEADLESS_MODE: "managed",
          ...(presentation ? {AISB_HEADLESS_ENABLE_MANAGED_CONSENT: "1", AISB_HEADLESS_ENABLE_MANAGED_PRESENTATION: "1"}
            : {AISB_HEADLESS_ENABLE_PLAN_REVIEW: "1"}),
          AISB_HEADLESS_MANAGED_ORIGIN: serverOrigin, AISB_HEADLESS_MANAGED_WORKSPACE_ID: workspaceId,
          AISB_HEADLESS_MANAGED_ORGANIZATION_ID: organizationId,
          AISB_HEADLESS_MANAGED_CREDENTIAL: presentation ? agent!.access : agent!.planReview!,
          NODE_EXTRA_CA_CERTS: agent!.caFile, TSX_DISABLE_CACHE: "1",
        }}), {timeout: 10_000});
      const tools = (await client.listTools()).tools.map(tool => tool.name);
      if (presentation) {
        assert.ok(tools.includes("aisb_present_in_window") && !tools.includes("aisb_run_approved_build_step"));
      } else {
        assert.ok(tools.includes("aisb_preview_context_query") && tools.includes("aisb_run_approved_build_step") &&
          !tools.includes("aisb_present_in_window"));
      }
      return async (name, input) => {
        const reply = await client.callTool({name, arguments: input}, undefined, {timeout: 8_000});
        assert.ok(reply.content?.length === 1 && reply.content[0].type === "text" && reply.content[0].text.length <= 64 * 1024);
        return JSON.parse(reply.content[0].text);
      };
    }
    const call = await connect(false);
    const host = await call("aisb_host_describe", {});
    assert.ok(host.ok && isHeadlessHostIncarnationId(host.value.hostIncarnationId));
    const workspace = {workspaceId, hostIncarnationId: host.value.hostIncarnationId};
    phase = "browser";
    browser = await chromium.launch({channel: "chrome", headless: true,
      args: [`--ignore-certificate-errors-spki-list=${fixture.browserPin}`]});
    const context = await browser.newContext({viewport: {width: 1280, height: 900}, acceptDownloads: false, serviceWorkers: "block"});
    await context.route("**/*", route => new URL(route.request().url()).origin === serverOrigin ? route.continue() : route.abort());
    await context.addInitScript(({origin, bearer}) => {
      if (location.origin === origin) localStorage.setItem("ai-system-builder.paired-device-token", bearer);
    }, {origin: serverOrigin, bearer: agent.browser});
    const page = await context.newPage(); page.setDefaultTimeout(15_000);
    await page.goto(serverOrigin + "/systems", {waitUntil: "domcontentloaded"});
    await page.getByRole("heading", {name: "Systems", exact: true}).waitFor();
    await runHeadlessContextWorkflow({page, workspace, call, dataButtonLabel: "Artifacts", facts,
      revokedContextCodes: ["headless.forbidden", "headless.unavailable"],
      openSettings: async () => {
        await page.locator('button.ui-shell__settings-button[aria-label="Settings"]').click();
        await page.getByRole("heading", {name: "Settings", exact: true}).waitFor();
        return page.locator("body");
      },
      connectPresentation: () => connect(true), reportStage: value => {phase = value;},
      onWorkerStart: () => {workerStarted = true;},
    });
    journeyPassed = true;
  } catch (error) { failures.push(error); }
  finally {
    try { await browser?.close(); } catch (error) { failures.push(error); }
    for (const client of clients) { try { await client.close(); } catch (error) { failures.push(error); } }
    try { await fixture.stop(); cleanupPassed = true; } catch (error) { failures.push(error); }
    const evidence = {schema_version: "headless-context-managed-observation-v1", source_revision: fixture.sourceRevision,
      status: journeyPassed && cleanupPassed && !failures.length ? "passed" : "failed", phase, facts,
      journeyPassed, cleanupPassed, workerStarted, failures: failures.map(safeQualificationFailureType),
      failureLocations: failures.map(error => error instanceof Error ? [...error.stack?.matchAll(
        /(?:headless-context-workflow|managed-headless-context)\.ts:[0-9]+:[0-9]+/g) ?? []].map(match => match[0]).slice(0, 4) : []),
      model: "pinned-installed-MiniLM", worker: "unchanged-packaged-main", physicalFailedBuild: "pending", parentQualification: "pending"};
    const body = JSON.stringify(evidence, null, 2) + "\n"; assert.ok(Buffer.byteLength(body) <= 8192);
    await writeFile(path.join(fixture.runRoot, "headless-context-managed.json"), body, {flag: "wx"});
    process.stdout.write(body);
    if (evidence.status !== "passed") process.exitCode = 1;
  }
}

void main().catch(() => {
  process.stderr.write('{"status":"failed","code":"managed-headless.context-unqualified"}\n');
  process.exitCode = 1;
});
