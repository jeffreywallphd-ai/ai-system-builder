import { randomUUID } from "node:crypto";
import { mkdir, realpath, writeFile } from "node:fs/promises";
import { cpus, totalmem } from "node:os";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { _electron as electron, type ElectronApplication } from "playwright";
import { assetApplicationLifetime } from "../asset-experience-oracles";
import { createFormWorkspace } from "./form-composer-authoring-journey";
import { connectMcp, exchangePairing, installPairingDialogDriver, prepareHeadlessDesktopProfile, takePairingCode } from "./headless-desktop-fixture";

test.use({ trace: "off", screenshot: "off", video: "off" });
type Client = Awaited<ReturnType<typeof connectMcp>>;
type WireValue = { ok?: boolean; operation?: string; code?: string; value?: unknown };

async function call(client: Client, name: string, args: Record<string, unknown>) {
  const result = await client.callTool({ name, arguments: args });
  const block = result.content?.[0];
  if (block?.type !== "text") throw new Error("The owned MCP response was not a fixed result.");
  return JSON.parse(block.text) as WireValue;
}

async function connectorSettings(page: Page) {
  await page.getByRole("button", { name: "Settings", exact: true, description: "Settings" }).click();
  await page.getByRole("button", { name: "Local chat clients", exact: true }).click();
  return page.getByRole("region", { name: "Local chat clients", exact: true });
}

async function runningAddress(region: Awaited<ReturnType<typeof connectorSettings>>) {
  await expect(region.getByText("The local connector is on.", { exact: true })).toBeVisible();
  const address = await region.getByText("Local address:", { exact: false }).locator("code").innerText();
  const fingerprint = await region.getByText("Certificate fingerprint:", { exact: false }).locator("code").innerText();
  return { address, fingerprint };
}

async function hostId(client: Client) {
  const described = await call(client, "aisb_host_describe", {});
  const id = (described.value as { hostIncarnationId?: string } | undefined)?.hostIncarnationId;
  if (!described.ok || !id) throw new Error("The owning desktop host was not identified.");
  return id;
}

function timings(samples: readonly number[]) {
  const sorted = [...samples].sort((left, right) => left - right);
  const at = (percentile: number) => Math.round(sorted[Math.ceil(sorted.length * percentile) - 1] ?? 0);
  return { count: sorted.length, p50Ms: at(0.5), p95Ms: at(0.95), maxMs: at(1) };
}

async function saveObservation(value: object) {
  const run = process.env.VISUAL_COMPOSER_QUALIFICATION_RUN_ID;
  const source = process.env.VISUAL_COMPOSER_QUALIFICATION_SOURCE_REVISION;
  if (!run || !/^[a-z0-9-]{20,80}$/.test(run) || !source || !/^source\.[a-f0-9]{64}$/.test(source))
    throw new Error("The owned timing observation identity is unavailable.");
  const body = JSON.stringify({ schema: "headless-desktop-observation-v1", run, source, value }) + "\n";
  if (Buffer.byteLength(body) > 4096) throw new Error("The owned timing observation exceeds its bound.");
  const parent = path.resolve("artifacts", "qualification", "visual-composer", "runs");
  await mkdir(parent, { recursive: true });
  if (await realpath(parent) !== parent) throw new Error("The observation directory redirected.");
  const directory = path.join(parent, run);
  await mkdir(directory, { recursive: true });
  if (await realpath(directory) !== directory) throw new Error("The observation run directory redirected.");
  await writeFile(path.join(directory, "headless-desktop-observation.json"), body, { flag: "wx" });
}

test("packaged Desktop pairs a real MCP client, observes its saved edit, and replays after restart", async () => {
  test.setTimeout(420_000);
  const lifetime = assetApplicationLifetime<ElectronApplication>();
  let mcp: Client | undefined;
  try {
    const profile = prepareHeadlessDesktopProfile();
    const launch = () => electron.launch({ executablePath: profile.executablePath, env: profile.env,
      args: [`--user-data-dir=${profile.dataRoot}`, "--disable-gpu"], timeout: 60_000 });
    const first = await lifetime.launch(launch);
    const page = await first.firstWindow({ timeout: 60_000 });
    await expect(page.getByRole("heading", { name: "Create a Workspace", exact: true })).toBeVisible({ timeout: 60_000 });
    const workspaceId = await createFormWorkspace(page, "Paired desktop qualification");
    const region = await connectorSettings(page);
    await expect(region.getByText("The local connector is off.", { exact: true })).toBeVisible();
    await installPairingDialogDriver(first, false);
    const pair = region.getByRole("button", { name: "Pair a client that can edit", exact: true });
    await pair.click();
    await expect.poll(() => first.evaluate(() => (globalThis as typeof globalThis & { headlessTestConfirmations?: number }).headlessTestConfirmations ?? 0))
      .toBe(1);
    await expect(pair).toBeEnabled();
    await expect(region.getByText("The local connector is off.", { exact: true })).toBeVisible();
    await installPairingDialogDriver(first, true);
    await pair.click();
    const { address, fingerprint } = await runningAddress(region);
    const credential = await exchangePairing(address, fingerprint, await takePairingCode(first));
    mcp = await connectMcp(address, fingerprint, credential);
    const hostIncarnationId = await hostId(mcp);
    const workspace = { hostIncarnationId, workspaceId };
    const catalog = await call(mcp, "aisb_list_templates", workspace);
    const templateId = "reference.secured-data-review@1.0.0";
    expect(catalog.ok && Array.isArray(catalog.value) && catalog.value.some(row => row.templateId === templateId)).toBe(true);

    await page.getByRole("button", { name: "Systems", exact: true }).click();
    const manage = page.getByRole("tab", { name: "Manage", exact: true });
    await manage.click();
    const management = page.getByRole("region", { name: "Manage systems", exact: true });
    const systemName = "System created by local client";
    const create = { workspaceId, templateId, name: systemName, idempotencyKey: randomUUID() };
    const observedAt = performance.now();
    const created = await call(mcp, "aisb_create_system", { hostIncarnationId, ...create });
    const createdValue = created.value as { kind?: string; reference?: { systemId: string; revisionId: string; recordRevision: number } };
    expect(created.ok && createdValue?.kind === "committed" && Boolean(createdValue.reference)).toBe(true);
    const saved = createdValue.reference!;
    await expect(management.getByText(systemName, { exact: true })).toBeVisible({ timeout: 5_000 });
    await expect(manage).toHaveAttribute("aria-selected", "true");
    expect(performance.now() - observedAt).toBeLessThanOrEqual(5_000);

    const nextName = "Renamed by local client";
    const renamed = await call(mcp, "aisb_rename_system", { ...workspace, systemId: saved.systemId,
      baseRevisionId: saved.revisionId, baseRecordRevision: saved.recordRevision, name: nextName, idempotencyKey: randomUUID() });
    expect(renamed.ok).toBe(true);
    await expect(management.getByText(nextName, { exact: true })).toBeVisible({ timeout: 5_000 });
    await expect(manage).toHaveAttribute("aria-selected", "true");
    let expected = (renamed.value as { reference: typeof saved }).reference;
    const snapshot = await call(mcp, "aisb_saved_system_snapshot", workspace);
    const cursor = (snapshot.value as { cursor?: unknown } | undefined)?.cursor;
    if (!snapshot.ok || !cursor) throw new Error("The owned client did not receive a snapshot cursor.");
    const samples: number[] = [];
    let failures = 0;
    let finalName = nextName;
    for (let index = 1; index <= 100; index++) {
      finalName = `Measured system ${index}`;
      const start = performance.now();
      try {
        const result = await call(mcp, "aisb_rename_system", { ...workspace, systemId: saved.systemId,
          baseRevisionId: expected.revisionId, baseRecordRevision: expected.recordRevision, name: finalName, idempotencyKey: randomUUID() });
        const reference = (result.value as { reference?: typeof saved } | undefined)?.reference;
        if (!result.ok || !reference || reference.recordRevision !== expected.recordRevision + 1)
          throw new Error("The measured save did not commit its next revision.");
        expected = reference;
        await expect(management.getByText(finalName, { exact: true })).toBeVisible({ timeout: 5_000 });
        samples.push(performance.now() - start);
      } catch { failures++; break; }
    }
    await mcp.close();
    mcp = undefined;
    const reconnectStart = performance.now();
    mcp = await connectMcp(address, fingerprint, credential);
    let nextCursor = cursor;
    let delivered = 0;
    let more = true;
    for (let index = 0; more && index < 3; index++) {
      const result = await call(mcp, "aisb_saved_system_changes", { ...workspace, cursor: nextCursor });
      const page = result.value as { kind?: string; events?: { systemId: string; recordRevision: number }[]; cursor?: unknown; more?: boolean };
      if (!result.ok || page.kind !== "changes" || !page.events || !page.cursor) throw new Error("Retained replay did not complete.");
      for (const event of page.events) {
        if (event.systemId !== saved.systemId || event.recordRevision !== saved.recordRevision + 2 + delivered)
          throw new Error("Retained replay returned a different saved revision.");
        delivered++;
      }
      nextCursor = page.cursor;
      more = page.more === true;
    }
    const recoveryMs = Math.round(performance.now() - reconnectStart);
    const aggregate = timings(samples);
    await saveObservation({
      cpuThreads: cpus().length, ramGiB: Math.round(totalmem() / 1024 ** 3),
      nodeVersion: process.versions.node, electronVersion: await first.evaluate(() => process.versions.electron),
      fixtureSystems: 1, timingStartsBeforeDispatch: true,
      ...aggregate, failures, recoveryMs, delivered,
    });
    expect({ failures, samples: aggregate.count, delivered, more }).toEqual({ failures: 0, samples: 100, delivered: 100, more: false });
    expect(aggregate.p95Ms).toBeLessThanOrEqual(1000);
    expect(recoveryMs).toBeLessThanOrEqual(5000);
    const desktopName = "Saved through the desktop bridge";
    const ordinary = await page.evaluate(async (target) => {
      const desktop = (window as unknown as { desktopApi: { renameSystemBuilderSystem(input: object): Promise<{ ok?: boolean }> } }).desktopApi;
      return (await desktop.renameSystemBuilderSystem(target)).ok === true;
    }, { workspaceId, systemId: saved.systemId, name: desktopName, expectedRevision: expected.recordRevision });
    expect(ordinary).toBe(true);
    const ordinaryChanges = await call(mcp, "aisb_saved_system_changes", { ...workspace, cursor: nextCursor });
    expect(ordinaryChanges.ok).toBe(true);
    expect(ordinaryChanges.value).toMatchObject({
      kind: "changes", events: [{ systemId: saved.systemId, recordRevision: expected.recordRevision + 1, revisionId: expected.revisionId }], more: false,
    });
    await expect(management.getByText(desktopName, { exact: true })).toBeVisible({ timeout: 5_000 });
    finalName = desktopName;
    await mcp.close();
    mcp = undefined;
    await lifetime.retire();

    const restarted = await lifetime.launch(launch);
    const next = await restarted.firstWindow({ timeout: 60_000 });
    await expect(next.getByLabel("Select current workspace")).toHaveValue(workspaceId, { timeout: 30_000 });
    const restartRegion = await connectorSettings(next);
    await installPairingDialogDriver(restarted, true);
    await restartRegion.getByRole("button", { name: "Turn on for paired clients", exact: true }).click();
    const after = await runningAddress(restartRegion);
    mcp = await connectMcp(after.address, after.fingerprint, credential);
    const newHost = await hostId(mcp);
    expect(newHost === hostIncarnationId).toBe(false);
    const repeated = await call(mcp, "aisb_create_system", { hostIncarnationId: newHost, ...create });
    const replay = repeated.value as { kind?: string; reference?: typeof saved } | undefined;
    expect(repeated.ok && replay?.kind === "replayed" && replay.reference?.systemId === saved.systemId).toBe(true);
    const current = await call(mcp, "aisb_list_systems", { hostIncarnationId: newHost, workspaceId });
    expect(current.ok && Array.isArray(current.value) && current.value.length === 1 && current.value[0]?.name === finalName).toBe(true);
    const oldFeed = await call(mcp, "aisb_saved_system_changes", { hostIncarnationId: newHost, workspaceId, cursor });
    expect(oldFeed).toEqual({ ok: true, operation: "systems.changes", value: { kind: "resync" } });
  } finally {
    try { await mcp?.close(); }
    finally { await lifetime.retire(); }
  }
});
