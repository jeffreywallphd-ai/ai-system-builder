import { randomUUID } from "node:crypto";
import { mkdir, realpath, writeFile } from "node:fs/promises";
import { cpus, release as osRelease, totalmem } from "node:os";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { _electron as electron, type ElectronApplication } from "playwright";
import { readHeadlessWindowResult } from "../../../../../modules/contracts/headless";
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
    await page.getByRole("tab", { name: "Compose", exact: true }).click();
    await page.getByRole("combobox", { name: "System", exact: true }).selectOption({ label: "Saved before takeover" });
    await page.getByRole("button", { name: "Edit system", exact: true }).click();
    await expect(page.getByRole("button", { name: "Preview UI", exact: true })).toBeEnabled();

    const revealTimes: number[] = [];
    const revokeTimes: number[] = [];
    const modalRevokeTimes: number[] = [];
    const warmEffect = { action: "open-system", systemId: saved!.systemId, revisionId: saved!.revisionId };
    const windowTarget = listed.value.windows[0];
    const mainLayout = () => page.locator(".ui-shell__main").evaluate(element => {
      const { x, y, width, height } = element.getBoundingClientRect();
      return { x, y, width, height };
    });
    for (let index = 0; index < 100; index++) {
      // The renderer deliberately retains the last 32 revoked attempts
      // through the 60-second retry window. Exercise normal admission
      // without bypassing retention or extending the workload's time limit.
      if (index > 0 && index % 30 === 0) await new Promise(resolve => setTimeout(resolve, 61_000));
      const modalSample = index % 5 === 0;
      const preview = page.getByRole("dialog", { name: "Saved before takeover UI preview", exact: true });
      if (modalSample) {
        await page.getByRole("button", { name: "Preview UI", exact: true }).click();
        await expect(preview).toBeVisible();
      }
      const preRequestLayout = index < 2 ? await mainLayout() : undefined;
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
      revealTimes.push(performance.now() - started);
      const restored = await measureRevocation(page, modalSample);
      revokeTimes.push(restored);
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
    const delivery = distribution(revealTimes);
    const release = distribution(revokeTimes);
    await saveTimingObservation({ delivery, release, dialogRelease: distribution(modalRevokeTimes),
      ordinaryRevokes: 100 - modalRevokeTimes.length, dialogRevokes: modalRevokeTimes.length, windows: 1, warm: true,
      osRelease: osRelease(), cpuThreads: cpus().length, ramGiB: Math.round(totalmem() / 1024 ** 3),
      desktop: await app.evaluate(() => ({ electron: process.versions.electron, chrome: process.versions.chrome })),
      visible: await page.evaluate(() => document.visibilityState === "visible"),
    });
    expect(delivery.count).toBe(100);
    expect(delivery.p95Ms).toBeLessThanOrEqual(500);
    expect(release.count).toBe(100);
    expect(modalRevokeTimes.length).toBe(20);
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
