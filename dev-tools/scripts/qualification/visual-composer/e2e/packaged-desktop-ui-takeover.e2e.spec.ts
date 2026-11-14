import { randomUUID } from "node:crypto";
import { lstat, mkdir, realpath, writeFile } from "node:fs/promises";
import { cpus, release as osRelease, totalmem } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { expect, test, type Page } from "@playwright/test";
import { _electron as electron, type ElectronApplication } from "playwright";
import { DESKTOP_UI_CONTROL_CHANNELS, readHeadlessWindowResult } from "../../../../../modules/contracts/headless";
import { resolveLocalSqliteDatabasePolicy } from "../../../../../modules/adapters/persistence/sqlite/local-sqlite-database-policy";
import { assetApplicationLifetime } from "../asset-experience-oracles";
import { createFormWorkspace } from "./form-composer-authoring-journey";
import {
  connectMcp, exchangePairing, installPairingDialogDriver, prepareHeadlessDesktopProfile, takePairingCode,
} from "./headless-desktop-fixture";

test.use({ screenshot: "off", trace: "off", video: "off" });
type Client = Awaited<ReturnType<typeof connectMcp>>;

async function call(client: Client, tool: string, input: Record<string, unknown>) {
  const response = await client.callTool({ name: tool, arguments: input }, { timeout: 6500 });
  const block = response.content?.[0];
  if (response.content?.length !== 1 || block?.type !== "text" || block.text.length > 128 * 1024) {
    throw new Error("Unexpected response from the owned fixture connector.");
  }
  return JSON.parse(block.text) as unknown;
}

function distribution(samples: readonly number[]) {
  const sorted = [...samples].sort((a, b) => a - b);
  return { count: sorted.length, p50Ms: sorted[Math.ceil(sorted.length * 0.5) - 1],
    p95Ms: sorted[Math.ceil(sorted.length * 0.95) - 1], maxMs: sorted.at(-1) };
}

async function saveTimingObservation(value: object) {
  const run = process.env.VISUAL_COMPOSER_QUALIFICATION_RUN_ID;
  const source = process.env.VISUAL_COMPOSER_QUALIFICATION_SOURCE_REVISION;
  if (!run || !/^[a-z0-9-]{20,80}$/.test(run) || !source || !/^source\.[a-f0-9]{64}$/.test(source)) {
    throw new Error("The owned window test has no observation identity.");
  }
  const parent = path.resolve("artifacts", "qualification", "visual-composer", "runs");
  const directory = path.join(parent, run);
  for (const target of [parent, directory]) {
    await mkdir(target, { recursive: true });
    if (await realpath(target) !== target) throw new Error("The observation directory redirected.");
  }
  const body = JSON.stringify({ schema: "headless-desktop-takeover-observation-v1", run, source, value }) + "\n";
  if (Buffer.byteLength(body) > 4096) throw new Error("The observation exceeds its bound.");
  await writeFile(path.join(directory, "headless-window-timing.json"), body, { flag: "wx" });
}

async function checkStoredAudit(profileRoot: string) {
  const { databaseFilePath } = resolveLocalSqliteDatabasePolicy({ dataRootDirectory: profileRoot });
  if (!path.relative(profileRoot, databaseFilePath).startsWith(`persistence${path.sep}`) ||
      await realpath(databaseFilePath) !== databaseFilePath || !(await lstat(databaseFilePath)).isFile()) {
    throw new Error("The isolated audit database is unavailable.");
  }
  const db = new DatabaseSync(databaseFilePath, { readOnly: true, allowExtension: false });
  try {
    const entries = db.prepare(`SELECT document_key,
      CASE WHEN length(CAST(payload_json AS BLOB)) <= 2048 THEN payload_json END AS payload_json
      FROM organization_documents
      WHERE namespace = 'headless-security-audit' LIMIT 4098`).all();
    if (entries.some(row => typeof row.payload_json !== "string")) throw new Error("The isolated audit exceeds its byte bound.");
    const counter = entries.find(row => row.document_key === "count");
    const events = entries.filter(row => row.document_key !== "count");
    if (!counter || JSON.parse(String(counter.payload_json)) !== events.length || events.length > 4096) {
      throw new Error("The isolated audit count is invalid.");
    }
    const operations = new Map<string, number>();
    const identifier = /^[a-z0-9][a-z0-9._:-]{0,127}$/i;
    const uuid = /^[a-f0-9-]{36}$/;
    const windowOperations = new Map([
      ["requested", "success"], ["accepted", "success"], ["activated", "success"],
      ["local-revoke-received", "success"], ["host-revoke-applied", "success"],
      ["command-delivered", "success"], ["command-applied", "success"], ["command-conflict", "denied"],
      ["command-rejected", "failure"], ["command-discarded", "failure"], ["command-unconfirmed", "failure"],
    ]);
    const backendOperations = new Map([
      ["committed", "success"], ["replayed", "success"], ["previewed", "success"], ["handle-observed", "success"],
      ["denied", "denied"], ["refused", "denied"], ["conflict", "denied"], ["unconfirmed", "failure"],
    ]);
    for (const row of events) {
      const payload = String(row.payload_json);
      const { eventId, occurredAt, principalId, organizationId, operation, kind, outcome, resource,
        requestId, correlationId, details, ...extra } = JSON.parse(payload);
      const invalid = () => { throw new Error("The isolated audit contains an out-of-policy field."); };
      if (!/^event-[1-9][0-9]{0,3}$/.test(String(row.document_key)) || Object.keys(extra).length ||
          !uuid.test(eventId) || typeof occurredAt !== "string" || !Number.isFinite(Date.parse(occurredAt)) ||
          !identifier.test(principalId) || !identifier.test(organizationId) || typeof operation !== "string" ||
          !resource || !identifier.test(resource.workspaceId) || resource.organizationId !== organizationId) invalid();
      if (kind === "headless.presentation") {
        const name = operation.slice("headless.window.".length);
        const { hostIncarnationId, uiIncarnationId, generation, actionId, sequence, ...unexpected } = details ?? {};
        if (resource.kind !== "desktop-window" || !uuid.test(resource.id) || Object.keys(resource).length !== 4 ||
            !operation.startsWith("headless.window.") || !windowOperations.has(name) || outcome !== windowOperations.get(name) ||
            !uuid.test(requestId) || !uuid.test(correlationId) || Object.keys(unexpected).length ||
            !uuid.test(hostIncarnationId) || !uuid.test(uiIncarnationId) ||
            (generation !== undefined && (!Number.isSafeInteger(generation) || generation < 1)) ||
            (name.startsWith("command-") ? !uuid.test(actionId) || !Number.isSafeInteger(sequence) || sequence < 1 || sequence > 256 :
              actionId !== undefined || sequence !== undefined)) invalid();
      } else if (kind === "headless.backend") {
        const name = /^headless\.(system-authoring|approved-conversation)\.([a-z-]+)$/.exec(operation)?.[2];
        if (resource.kind !== "workspace" || Object.keys(resource).length !== 3 ||
            !name || !backendOperations.has(name) || outcome !== backendOperations.get(name) ||
            requestId !== undefined || correlationId !== undefined || details !== undefined) invalid();
      } else {
        throw new Error("The isolated audit contains an out-of-policy field.");
      }
      operations.set(operation, (operations.get(operation) ?? 0) + 1);
    }
    for (const required of ["window.requested", "window.accepted", "window.activated", "window.local-revoke-received",
      "window.host-revoke-applied", "window.command-delivered", "window.command-applied", "window.command-conflict",
      "system-authoring.committed"]) {
      expect(operations.has(`headless.${required}`), `Missing audit operation ${required}`).toBe(true);
    }
  } finally { db.close(); }
}

function measureRevocation(page: Page, dialog: boolean) {
  return page.evaluate(async (inDialog) => {
    const area = inDialog ? '[role="dialog"]' : '[aria-label="Automation takeover"]';
    const revoke = [...document.querySelectorAll<HTMLButtonElement>(area + " button")]
      .find(button => button.textContent?.trim() === "Revoke automation takeover");
    const control = document.querySelector<HTMLButtonElement>('button[aria-label="Settings"]');
    if (!revoke || !control?.disabled) throw new Error("The fixture does not have an active attached control.");
    let start = 0;
    return new Promise<number>((resolve, reject) => {
      const observer = new MutationObserver(() => {
        if (!start || control.disabled || revoke.isConnected) return;
        observer.disconnect();
        clearTimeout(deadline);
        resolve(performance.now() - start);
      });
      const deadline = setTimeout(() => { observer.disconnect(); reject(new Error("Manual control was not restored.")); }, 3000);
      observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["disabled"] });
      revoke.addEventListener("click", () => { start = performance.now(); }, { capture: true, once: true });
      revoke.focus();
      revoke.click();
    });
  }, dialog);
}

async function withModelsPageLoading(app: ElectronApplication, page: Page, exercise: () => Promise<void>) {
  const owner = await app.browserWindow(page);
  try {
    const gate = await owner.evaluateHandle(window => {
      const contents = window.webContents;
      const requests = contents.session.webRequest;
      const entry = new URL(contents.getURL());
      const assetPrefix = new URL("assets/", entry).href;
      if (entry.protocol !== "file:" || !entry.pathname.endsWith("/main_window/index.html")) {
        throw new Error("The loading probe requires the packaged renderer entry.");
      }
      let resume: ((response: Electron.CallbackResponse) => void) | undefined;
      let deadline: ReturnType<typeof setTimeout>;
      let released = false;
      const release = () => {
        if (released) return;
        released = true;
        clearTimeout(deadline);
        requests.onBeforeRequest(null);
        resume?.({ cancel: false });
        resume = undefined;
      };
      deadline = setTimeout(release, 15_000);
      requests.onBeforeRequest({ urls: ["file:///*"] }, (details, callback) => {
        if (details.webContentsId === contents.id && details.url.startsWith(assetPrefix) &&
            /^ModelsPage-[a-zA-Z0-9_-]+\.js$/.test(details.url.slice(assetPrefix.length)) && !resume) {
          resume = callback;
        } else callback({ cancel: false });
      });
      return { release, held: () => Boolean(resume) };
    });
    try {
      await page.getByRole("button", { name: "Models", exact: true }).click();
      await expect.poll(() => gate.evaluate(probe => probe.held())).toBe(true);
      await expect(page.getByRole("status", { name: "Page loading", exact: true })).toBeVisible();
      await exercise();
      expect(await gate.evaluate(probe => probe.held()), "The module stayed held through the measured revokes.").toBe(true);
    } finally {
      try { await gate.evaluate(probe => probe.release()); }
      finally { await gate.dispose(); }
    }
    await expect(page.getByRole("heading", { name: "Model Management", exact: true })).toBeVisible();
  } finally { await owner.dispose(); }
}

async function suppressFixtureRevoke(app: ElectronApplication, page: Page) {
  const window = await app.browserWindow(page);
  let ownedContents: number;
  try { ownedContents = await window.evaluate(window => window.webContents.id); }
  finally { await window.dispose(); }
  return app.evaluateHandle(({ ipcMain }, { channel, ownedContents }) => {
    type Handler = (event: Electron.IpcMainInvokeEvent, input: unknown) => unknown;
    const handler = (ipcMain as unknown as { _invokeHandlers?: Map<string, Handler> })._invokeHandlers?.get(channel);
    if (typeof handler !== "function") throw new Error("The packaged revoke handler is unavailable to the fixture.");
    let missed = 0;
    ipcMain.removeHandler(channel);
    ipcMain.handle(channel, (event, input) => {
      if (event.sender.id !== ownedContents) return handler(event, input);
      missed++;
      return false;
    });
    return {
      missed: () => missed,
      restore() { ipcMain.removeHandler(channel); ipcMain.handle(channel, handler); },
    };
  }, { channel: DESKTOP_UI_CONTROL_CHANNELS.revoke, ownedContents });
}

test("a real paired client presents a saved Windows resource and the user revokes before continuing saved work", async () => {
  test.setTimeout(430_000);
  const lifetime = assetApplicationLifetime<ElectronApplication>();
  const clients: Client[] = [];
  try {
    const profile = prepareHeadlessDesktopProfile("presentation");
    const launch = () => electron.launch({
      executablePath: profile.executablePath, env: profile.env,
      args: [`--user-data-dir=${profile.dataRoot}`, "--disable-gpu"], timeout: 60_000,
    });
    const app = await lifetime.launch(launch);
    const page = await app.firstWindow({ timeout: 60_000 });
    await expect(page.getByRole("heading", { name: "Create a Workspace", exact: true })).toBeVisible({ timeout: 60_000 });
    const workspaceId = await createFormWorkspace(page, "Desktop window qualification");
    const owner = await app.browserWindow(page);
    try {
      await owner.evaluate(window => window.focus());
      await expect.poll(() => owner.evaluate(window => window.isFocused())).toBe(true);
    } finally { await owner.dispose(); }
    await page.getByRole("button", { name: "Settings", exact: true, description: "Settings" }).click();
    await page.getByRole("button", { name: "Local chat clients", exact: true }).click();
    const settings = page.getByRole("region", { name: "Local chat clients", exact: true });
    const pair = async (mode: "author" | "presentation") => {
      await installPairingDialogDriver(app, true, mode);
      await settings.getByRole("button", { name: mode === "author" ? "Pair a client that can edit" :
        "Pair a client that can request window control", exact: true }).click();
      await expect(settings.getByText("The local connector is on.", { exact: true })).toBeVisible();
      const address = await settings.getByText("Local address:", { exact: false }).locator("code").innerText();
      const fingerprint = await settings.getByText("Certificate fingerprint:", { exact: false }).locator("code").innerText();
      const credential = await exchangePairing(address, fingerprint, await takePairingCode(app));
      const client = await connectMcp(address, fingerprint, credential, undefined, mode);
      clients.push(client);
      return { client, credential };
    };
    const { client: author, credential: authorCredential } = await pair("author");
    const { client: agent, credential: presentationCredential } = await pair("presentation");
    const { client: secondAgent } = await pair("presentation");
    const { value: described } = await call(author, "aisb_host_describe", {}) as { value?: { hostIncarnationId: string } };
    expect(described?.hostIncarnationId).toMatch(/^[a-f0-9-]{36}$/);
    const base = { hostIncarnationId: described!.hostIncarnationId, workspaceId };
    const create = (name: string) => call(author, "aisb_create_system", { ...base, name, idempotencyKey: randomUUID(),
      templateId: "reference.secured-data-review@1.0.0" });
    const created = await create("Saved before takeover") as { ok?: boolean; value?: { reference?: { systemId: string; revisionId: string } } };
    expect(created.ok).toBe(true);
    const saved = created.value?.reference;
    expect(saved?.systemId).toBeTruthy();
    expect(saved?.revisionId).toBeTruthy();
    const listed = readHeadlessWindowResult(await call(agent, "aisb_list_windows", base));
    expect(listed.ok && listed.value.kind === "windows" && listed.value.windows.length).toBe(1);
    if (!listed.ok || listed.value.kind !== "windows" || !listed.value.windows[0]) throw new Error("No exact fixture window.");
    const requested = readHeadlessWindowResult(await call(agent, "aisb_request_window", {
      target: listed.value.windows[0], requestKey: randomUUID(), taskId: randomUUID(),
    }));
    if (!requested.ok || requested.value.kind !== "request") throw new Error("The desktop did not admit the fixture request.");
    const attempt = requested.value.request.target;
    await page.getByRole("button", { name: "Accept automation takeover", exact: true }).click();
    const status = () => call(agent, "aisb_window_status", { target: attempt }).then(readHeadlessWindowResult);
    let lease: unknown;
    await expect.poll(async () => {
      const live = await status();
      lease = live.ok && live.value.kind === "request" ? live.value.lease : undefined;
      return !!lease;
    }).toBe(true);
    const contested = readHeadlessWindowResult(await call(secondAgent, "aisb_request_window", {
      target: listed.value.windows[0], requestKey: randomUUID(), taskId: randomUUID(),
    }));
    expect(contested).toEqual({ ok: false, code: "headless.operation-capacity" });
    expect(readHeadlessWindowResult(await call(secondAgent, "aisb_window_context", { target: lease })))
      .toEqual({ ok: false, code: "headless.forbidden" });
    const panel = page.getByRole("region", { name: "Resource shown by automation", exact: true });
    const effect = { target: lease, commandId: randomUUID(), intent: {
      action: "open-system", systemId: saved!.systemId, revisionId: saved!.revisionId,
    } };
    const submit = () => call(agent, "aisb_present_in_window", effect).then(readHeadlessWindowResult);
    expect((await submit()).ok).toBe(true);
    await expect(panel.getByRole("heading", { name: "Saved before takeover", exact: true })).toBeVisible();
    await expect.poll(async () => {
      const result = await submit();
      return result.ok && result.value.kind === "command" ? result.value.receipt.status : undefined;
    }).toBe("applied");
    expect(readHeadlessWindowResult(await call(agent, "aisb_present_in_window", {
      ...effect, intent: { ...effect.intent, action: "show-validation" },
    }))).toEqual({ ok: false, code: "headless.idempotency-conflict" });
    await expect.poll(async () => {
      const result = readHeadlessWindowResult(await call(agent, "aisb_window_context", { target: lease }));
      return result.ok && result.value.kind === "context" ? result.value.context?.selection : undefined;
    }).toEqual(effect.intent);
    await page.getByRole("button", { name: "Revoke automation takeover", exact: true }).click();
    await expect(page.getByText("You have control of this window. Chat tasks can continue.", { exact: true })).toBeVisible();
    await expect(panel).toHaveCount(0);
    await expect.poll(async () => {
      const latest = await status();
      return latest.ok && latest.value.kind;
    }).toBe("ended");
    expect(readHeadlessWindowResult(await call(agent, "aisb_window_context", { target: lease }))).toEqual({
      ok: false, code: "headless.forbidden",
    });
    expect(await create("Saved after takeover")).toMatchObject({ ok: true });
    await page.getByRole("button", { name: "Systems", exact: true }).click();
    await page.getByRole("tab", { name: "Manage", exact: true }).click();
    await expect(page.getByRole("region", { name: "Manage systems", exact: true })
      .getByText("Saved after takeover", { exact: true })).toBeVisible();
    const revealTimes: number[] = [];
    const loadingRevealTimes: number[] = [];
    const revokeTimes: number[] = [];
    const modalRevokeTimes: number[] = [];
    const loadingRevokeTimes: number[] = [];
    const warmEffect = { action: "open-system", systemId: saved!.systemId, revisionId: saved!.revisionId };
    const windowTarget = listed.value.windows[0];
    const mainLayout = () => page.locator(".ui-shell__main").evaluate(element => {
      const { x, y, width, height } = element.getBoundingClientRect();
      return { x, y, width, height };
    });
    async function sample(index: number, mode: "normal" | "loading" | "dialog") {
      // The renderer deliberately retains the last 32 revoked attempts
      // through the 60-second retry window. Exercise normal admission
      // without bypassing retention or extending the workload's time limit.
      if (index > 0 && index % 30 === 0) await new Promise(resolve => setTimeout(resolve, 61_000));
      const modalSample = mode === "dialog";
      const preview = page.getByRole("dialog", { name: "Saved before takeover UI preview", exact: true });
      if (modalSample) {
        await page.getByRole("button", { name: "Preview UI", exact: true }).click();
        await expect(preview).toBeVisible();
      }
      const preRequestLayout = [0, 5, 80].includes(index) ? await mainLayout() : undefined;
      const next = readHeadlessWindowResult(await call(agent, "aisb_request_window", {
        target: windowTarget, requestKey: randomUUID(), taskId: randomUUID(),
      }));
      if (!next.ok || next.value.kind !== "request") throw new Error("The warm test could not request the current window.");
      const currentAttempt = next.value.request.target;
      const consent = page.getByRole("dialog", { name: "Automation takeover request", exact: true });
      await expect(consent).toBeVisible();
      if (preRequestLayout) {
        await expect(consent.getByRole("button", { name: "Decline", exact: true })).toBeFocused();
        expect(await mainLayout()).toEqual(preRequestLayout);
      }
      await consent.getByRole("button", { name: "Accept automation takeover", exact: true }).click();
      await expect(consent).toHaveCount(0);
      let active: unknown;
      await expect.poll(async () => {
        const result = readHeadlessWindowResult(await call(agent, "aisb_window_status", { target: currentAttempt }));
        active = result.ok && result.value.kind === "request" ? result.value.lease : undefined;
        return !!active;
      }, { intervals: [25, 50, 100] }).toBe(true);
      await expect(panel).toHaveCount(0);
      const started = performance.now();
      const command = readHeadlessWindowResult(await call(agent, "aisb_present_in_window", {
        target: active, commandId: randomUUID(), intent: warmEffect,
      }));
      expect(command.ok).toBe(true);
      await expect(panel.getByRole("heading", { name: "Saved before takeover", exact: true })).toBeVisible();
      (mode === "loading" ? loadingRevealTimes : revealTimes).push(performance.now() - started);
      if (mode === "loading") await expect(page.getByRole("status", { name: "Page loading", exact: true })).toBeVisible();
      const restored = await measureRevocation(page, modalSample);
      revokeTimes.push(restored);
      if (mode === "loading") loadingRevokeTimes.push(restored);
      await expect(panel).toHaveCount(0);
      if (modalSample) {
        modalRevokeTimes.push(restored);
        await expect(preview.getByRole("button", { name: "Close system UI preview", exact: true })).toBeFocused();
        await preview.press("Escape");
        await expect(preview).toHaveCount(0);
      }
      await expect.poll(async () => {
        const ended = readHeadlessWindowResult(await call(agent, "aisb_window_status", { target: currentAttempt }));
        return ended.ok && ended.value.kind;
      }, { intervals: [25, 50, 100] }).toBe("ended");
    }
    await withModelsPageLoading(app, page, async () => {
      for (let index = 0; index < 5; index++) await sample(index, "loading");
    });
    await page.getByRole("button", { name: "Systems", exact: true }).click();
    await page.getByRole("tab", { name: "Compose", exact: true }).click();
    await page.getByRole("combobox", { name: "System", exact: true }).selectOption({ label: "Saved before takeover" });
    await page.getByRole("button", { name: "Edit system", exact: true }).click();
    await expect(page.getByRole("button", { name: "Preview UI", exact: true })).toBeEnabled();
    for (let index = 5; index < 100; index++) await sample(index, index < 80 ? "normal" : "dialog");

    const delivery = distribution(revealTimes);
    const release = distribution(revokeTimes);
    await saveTimingObservation({ delivery, release, dialogRelease: distribution(modalRevokeTimes),
      loadingDelivery: distribution(loadingRevealTimes), loadingRelease: distribution(loadingRevokeTimes),
      ordinaryRevokes: 75, windows: 1, warm: true,
      osRelease: osRelease(), cpuThreads: cpus().length, ramGiB: Math.round(totalmem() / 1024 ** 3),
      desktop: await app.evaluate(() => ({ electron: process.versions.electron, chrome: process.versions.chrome })),
      visible: await page.evaluate(() => document.visibilityState === "visible"),
    });
    expect(delivery.count).toBe(95);
    expect(delivery.p95Ms).toBeLessThanOrEqual(500);
    expect(release.count).toBe(100);
    expect(modalRevokeTimes.length).toBe(20);
    expect(loadingRevokeTimes.length).toBe(5);
    expect(release.p95Ms).toBeLessThanOrEqual(100);
    expect(release.maxMs).toBeLessThanOrEqual(250);

    const latest = readHeadlessWindowResult(await call(agent, "aisb_request_window", {
      target: windowTarget, requestKey: randomUUID(), taskId: randomUUID(),
    }));
    if (!latest.ok || latest.value.kind !== "request") throw new Error("No request for the reload scenario.");
    const reloadingAttempt = latest.value.request.target;
    await page.getByRole("button", { name: "Accept automation takeover", exact: true }).click();
    await expect(page.getByRole("button", { name: "Revoke automation takeover", exact: true })).toBeVisible();
    await expect.poll(async () => {
      const reading = readHeadlessWindowResult(await call(agent, "aisb_window_status", { target: reloadingAttempt }));
      return reading.ok && reading.value.kind === "request" && Boolean(reading.value.lease);
    }).toBe(true);
    await page.reload();
    await expect(page.getByLabel("Select current workspace")).toHaveValue(workspaceId);
    await expect(page.getByRole("button", { name: "Settings", exact: true, description: "Settings" })).toBeEnabled();
    await expect(page.getByRole("button", { name: "Revoke automation takeover", exact: true })).toHaveCount(0);
    const reloadedWindows = () => call(agent, "aisb_list_windows", base).then(readHeadlessWindowResult);
    await expect.poll(async () => {
      const windowList = await reloadedWindows();
      return windowList.ok && windowList.value.kind === "windows" && windowList.value.windows.length === 1 &&
        windowList.value.windows[0]?.windowId === windowTarget.windowId &&
        windowList.value.windows[0]?.uiIncarnationId !== windowTarget.uiIncarnationId;
    }).toBe(true);
    expect(readHeadlessWindowResult(await call(agent, "aisb_request_window", {
      target: windowTarget, requestKey: randomUUID(), taskId: randomUUID(),
    }))).toEqual({ ok: false, code: "headless.forbidden" });

    await Promise.all(clients.map(client => client.close()));
    clients.length = 0;
    await lifetime.retire();
    await checkStoredAudit(profile.dataRoot);
    const restarted = await lifetime.launch(launch);
    const returned = await restarted.firstWindow({ timeout: 60_000 });
    await expect(returned.getByLabel("Select current workspace")).toHaveValue(workspaceId);
    await returned.getByRole("button", { name: "Settings", exact: true, description: "Settings" }).click();
    await returned.getByRole("button", { name: "Local chat clients", exact: true }).click();
    const restartedSettings = returned.getByRole("region", { name: "Local chat clients", exact: true });
    await installPairingDialogDriver(restarted, true);
    await restartedSettings.getByRole("button", { name: "Turn on for paired clients", exact: true }).click();
    await expect(restartedSettings.getByText("The local connector is on.", { exact: true })).toBeVisible();
    const address = await restartedSettings.getByText("Local address:", { exact: false }).locator("code").innerText();
    const fingerprint = await restartedSettings.getByText("Certificate fingerprint:", { exact: false }).locator("code").innerText();
    const newAuthor = await connectMcp(address, fingerprint, authorCredential);
    clients.push(newAuthor);
    const newAgent = await connectMcp(address, fingerprint, presentationCredential, undefined, "presentation");
    clients.push(newAgent);
    const restartedHost = await call(newAuthor, "aisb_host_describe", {}) as { value?: { hostIncarnationId: string } };
    expect(restartedHost.value?.hostIncarnationId).toMatch(/^[a-f0-9-]{36}$/);
    expect(restartedHost.value?.hostIncarnationId).not.toBe(base.hostIncarnationId);
    expect(readHeadlessWindowResult(await call(newAgent, "aisb_window_status", { target: reloadingAttempt })))
      .toEqual({ ok: false, code: "headless.host-changed" });
    await returned.getByRole("button", { name: "Systems", exact: true }).click();
    await returned.getByRole("tab", { name: "Manage", exact: true }).click();
    const list = returned.getByRole("region", { name: "Manage systems", exact: true });
    await expect(list.getByText("Saved before takeover", { exact: true })).toBeVisible();
    await expect(list.getByText("Saved after takeover", { exact: true })).toBeVisible();
    await expect(returned.getByRole("button", { name: "Revoke automation takeover", exact: true })).toHaveCount(0);
  } finally {
    try {
      const outcomes = await Promise.allSettled(clients.map(client => client.close()));
      if (outcomes.some(result => result.status === "rejected")) throw new Error("An owned fixture client did not close.");
    } finally { await lifetime.retire(); }
  }
});

test("the native File menu opens a separately controlled window", async () => {
  test.setTimeout(100_000);
  const lifetime = assetApplicationLifetime<ElectronApplication>();
  let firstAgent: Client | undefined;
  let secondAgent: Client | undefined;
  let reader: Client | undefined;
  try {
    const profile = prepareHeadlessDesktopProfile("window-isolation");
    const app = await lifetime.launch(() => electron.launch({
      executablePath: profile.executablePath, env: profile.env,
      args: [`--user-data-dir=${profile.dataRoot}`, "--disable-gpu"], timeout: 60_000,
    }));
    const first = await app.firstWindow({ timeout: 60_000 });
    await expect(first.getByRole("heading", { name: "Create a Workspace", exact: true })).toBeVisible();
    const workspaceId = await createFormWorkspace(first, "Independent desktop windows");
    const original = await app.browserWindow(first);
    try {
      await original.evaluate(window => window.focus());
      await expect.poll(() => original.evaluate(window => window.isFocused())).toBe(true);
      await first.getByRole("button", { name: "Settings", exact: true, description: "Settings" }).click();
      await first.getByRole("button", { name: "Local chat clients", exact: true }).click();
      const settings = first.getByRole("region", { name: "Local chat clients", exact: true });
      const pair = async (mode: "author" | "presentation") => {
        await installPairingDialogDriver(app, true, mode);
        await settings.getByRole("button", { name: mode === "author" ? "Pair a client that can edit" :
          "Pair a client that can request window control", exact: true }).click();
        await expect(settings.getByText("The local connector is on.", { exact: true })).toBeVisible();
        const address = await settings.getByText("Local address:", { exact: false }).locator("code").innerText();
        const fingerprint = await settings.getByText("Certificate fingerprint:", { exact: false }).locator("code").innerText();
        const credential = await exchangePairing(address, fingerprint, await takePairingCode(app));
        return connectMcp(address, fingerprint, credential, undefined, mode);
      };
      reader = await pair("author");
      const host = await call(reader, "aisb_host_describe", {}) as { ok?: boolean; code?: string; value?: { hostIncarnationId: string } };
      expect(host.ok, `The bounded host discovery code was ${host.code ?? "none"}.`).toBe(true);
      expect(host.value?.hostIncarnationId).toMatch(/^[a-f0-9-]{36}$/);
      const agent = firstAgent = await pair("presentation");
      const peer = secondAgent = await pair("presentation");
      const base = { workspaceId, hostIncarnationId: host.value!.hostIncarnationId };
      const created = await call(reader, "aisb_create_system", { ...base, name: "Held presentation resource",
        idempotencyKey: randomUUID(), templateId: "reference.secured-data-review@1.0.0" }) as {
          ok?: boolean; value?: { reference?: { systemId: string; revisionId: string } };
        };
      const saved = created.value?.reference;
      if (!created.ok || !saved?.systemId || !saved.revisionId) throw new Error("The owned test system was not saved.");
      const list = async () => {
        const result = readHeadlessWindowResult(await call(agent, "aisb_list_windows", base));
        return result.ok && result.value.kind === "windows" ? result.value.windows : [];
      };
      await expect.poll(async () => (await list()).length).toBe(1);
      const [firstTarget] = await list();
      const nextWindow = app.waitForEvent("window");
      await app.evaluate(({ Menu, BrowserWindow }) => {
        const focused = BrowserWindow.getFocusedWindow();
        const menu = Menu.getApplicationMenu();
        const item = menu?.getMenuItemById("desktop-new-window");
        if (!focused || !item) throw new Error("The native New Window command is missing.");
        item.click(item, focused, {});
      });
      const second = await nextWindow;
      await expect(second.getByLabel("Select current workspace")).toHaveValue(workspaceId);
      await expect.poll(async () => (await list()).length).toBe(2);
      const secondTarget = (await list()).find(row => row.windowId !== firstTarget?.windowId);
      const requestWindow = (client: Client, target: unknown) => call(client, "aisb_request_window", {
        target, requestKey: randomUUID(), taskId: randomUUID(),
      }).then(readHeadlessWindowResult);
      const attach = async (page: Page, client: Client, request: Awaited<ReturnType<typeof requestWindow>>) => {
        if (!request.ok || request.value.kind !== "request") throw new Error("The isolated window request was denied.");
        const attempt = request.value.request.target;
        await page.getByRole("dialog", { name: "Automation takeover request", exact: true })
          .getByRole("button", { name: "Accept automation takeover", exact: true }).click();
        const status = () => call(client, "aisb_window_status", { target: attempt }).then(readHeadlessWindowResult);
        await expect.poll(async () => {
          const result = await status();
          return result.ok && result.value.kind === "request" && Boolean(result.value.lease);
        }).toBe(true);
        return status;
      };
      const secondStatus = await attach(second, peer, await requestWindow(peer, secondTarget));
      await original.evaluate(window => window.focus());
      const firstStatus = await attach(first, agent, await requestWindow(agent, firstTarget));
      const active = await firstStatus();
      if (!active.ok || active.value.kind !== "request" || !active.value.lease) {
        throw new Error("The owned first window did not attach.");
      }
      const contentsId = await original.evaluate(window => window.webContents.id);
      const transportGate = await app.evaluateHandle(({ ipcMain }, { channel, contentsId }) => {
        type Handler = (event: Electron.IpcMainInvokeEvent, input: unknown) => Promise<{ status?: string }>;
        // Electron exposes removal but no public getter. Wrap just the existing
        // pull response in this owned process, after the real host verifies it.
        const handlers = (ipcMain as unknown as { _invokeHandlers?: Map<string, Handler> })._invokeHandlers;
        const handler = handlers?.get(channel);
        if (typeof handler !== "function") throw new Error("The packaged pull handler is unavailable to the fixture.");
        let held = false;
        let delivered = false;
        let finish!: () => void;
        const delay = new Promise<void>(resolve => { finish = resolve; });
        const timer = setTimeout(finish, 8_000);
        ipcMain.removeHandler(channel);
        ipcMain.handle(channel, async (event, input) => {
          const response = await handler(event, input);
          if (!held && event.sender.id === contentsId && response?.status === "command") {
            held = true;
            await delay;
            delivered = true;
          }
          return response;
        });
        return {
          held: () => held && !delivered,
          delivered: () => delivered,
          resume() {
            if (!held || delivered) return false;
            clearTimeout(timer);
            finish();
            return true;
          },
          restore() { clearTimeout(timer); finish(); ipcMain.removeHandler(channel); ipcMain.handle(channel, handler); },
        };
      }, { channel: DESKTOP_UI_CONTROL_CHANNELS.pull, contentsId });
      const latePresentation = await first.evaluateHandle(() => {
        const selector = 'section[aria-label="Resource shown by automation"]';
        const entered = (node: Node) => node instanceof Element && (node.matches(selector) || node.querySelector(selector));
        let appearances = 0;
        const observer = new MutationObserver(records => {
          for (const record of records) for (const node of record.addedNodes) if (entered(node)) appearances++;
        });
        observer.observe(document.body, { childList: true, subtree: true });
        return { appearances: () => appearances, stop: () => observer.disconnect() };
      });
      try {
        const queued = await call(agent, "aisb_present_in_window", { target: active.value.lease, commandId: randomUUID(),
          intent: { action: "open-system", systemId: saved.systemId, revisionId: saved.revisionId } });
        expect(readHeadlessWindowResult(queued).ok).toBe(true);
        await expect.poll(() => transportGate.evaluate(gate => gate.held())).toBe(true);
        await first.getByRole("region", { name: "Automation takeover", exact: true })
          .getByRole("button", { name: "Revoke automation takeover", exact: true }).click();
        await expect(first.getByRole("button", { name: "Settings", exact: true, description: "Settings" })).toBeEnabled();
        expect(await transportGate.evaluate(gate => gate.resume())).toBe(true);
        await expect.poll(() => transportGate.evaluate(gate => gate.delivered())).toBe(true);
        expect(readHeadlessWindowResult(await call(agent, "aisb_window_context", { target: active.value.lease })))
          .toEqual({ ok: false, code: "headless.forbidden" });
        await expect(first.getByRole("region", { name: "Resource shown by automation", exact: true })).toHaveCount(0);
        await first.getByRole("button", { name: "Systems", exact: true }).click();
        await expect(first.getByRole("tab", { name: "Manage", exact: true })).toBeVisible();
        expect(await latePresentation.evaluate(probe => probe.appearances())).toBe(0);
      } finally {
        try { await latePresentation.evaluate(probe => probe.stop()); }
        finally {
          try { await transportGate.evaluate(gate => gate.restore()); }
          finally { await Promise.all([transportGate.dispose(), latePresentation.dispose()]); }
        }
      }
      await expect.poll(async () => {
        const result = await firstStatus();
        return result.ok && result.value.kind;
      }).toBe("ended");
      const current = await secondStatus();
      expect(current.ok && current.value.kind === "request" && current.value.request.status).toBe("active");
      await expect(second.getByRole("button", { name: "Revoke automation takeover", exact: true })).toBeVisible();
      await original.evaluate(window => window.minimize());
      await expect.poll(() => original.evaluate(window => window.isMinimized())).toBe(true);
      const ownWindow = await app.browserWindow(second);
      try {
        const id = await ownWindow.evaluate(window => window.id);
        expect(await app.evaluate(({ Menu, BrowserWindow }, targetId) => {
          const focused = BrowserWindow.fromId(targetId);
          const item = Menu.getApplicationMenu()?.getMenuItemById("desktop-new-window");
          const before = BrowserWindow.getAllWindows().length;
          if (!focused || !item) throw new Error("The native action disappeared.");
          item.click(item, focused, {});
          return [before, BrowserWindow.getAllWindows().length];
        }, id)).toEqual([2, 2]);
      } finally { await ownWindow.dispose(); }
      await expect.poll(async () => (await list()).some(row => row.windowId === secondTarget?.windowId)).toBe(true);
      await original.evaluate(window => { window.restore(); window.focus(); });
      await expect(first.getByRole("button", { name: "Settings", exact: true, description: "Settings" })).toBeEnabled();
      const stillCurrent = await secondStatus();
      expect(stillCurrent.ok && stillCurrent.value.kind === "request" && stillCurrent.value.request.status).toBe("active");
      const fault = await suppressFixtureRevoke(app, second);
      try {
        await second.getByRole("region", { name: "Automation takeover", exact: true })
          .getByRole("button", { name: "Revoke automation takeover", exact: true }).click();
        await expect.poll(() => fault.evaluate(probe => probe.missed())).toBeGreaterThan(0);
        await expect(second.getByRole("button", { name: "Settings", exact: true, description: "Settings" })).toBeEnabled();
        const unreachedHost = await secondStatus();
        if (!unreachedHost.ok || unreachedHost.value.kind !== "request" || !unreachedHost.value.lease) {
          throw new Error("The failure fixture unexpectedly reached the host revoke handler.");
        }
        const blockedContext = readHeadlessWindowResult(await call(peer, "aisb_window_context", { target: unreachedHost.value.lease }));
        expect(blockedContext).toEqual({ ok: false, code: "headless.unavailable" });
        await second.close();
        await expect.poll(async () => (await list()).length).toBe(1);
      } finally {
        try { await fault.evaluate(probe => probe.restore()); }
        finally { await fault.dispose(); }
      }
      await original.evaluate(window => window.focus());
      await expect(first.getByRole("button", { name: "Settings", exact: true, description: "Settings" })).toBeEnabled();
      await expect(first.getByRole("region", { name: "Resource shown by automation", exact: true })).toHaveCount(0);
    } finally { await original.dispose(); }
  } finally {
    try { await Promise.all([firstAgent?.close(), secondAgent?.close(), reader?.close()]); }
    finally { await lifetime.retire(); }
  }
});
