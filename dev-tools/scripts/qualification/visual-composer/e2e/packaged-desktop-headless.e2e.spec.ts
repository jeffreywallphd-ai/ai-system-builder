import { randomUUID } from "node:crypto";
import { lstat, mkdir, readdir, readFile, realpath, rename, writeFile } from "node:fs/promises";
import { cpus, totalmem } from "node:os";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { _electron as electron, type ElectronApplication } from "playwright";
import { parseHeadlessChangeCursor } from "../../../../../modules/contracts/headless";
import { assetApplicationLifetime } from "../asset-experience-oracles";
import { createFormWorkspace } from "./form-composer-authoring-journey";
import { closeDesktopAndQualifyOwnedWorkers } from "./desktop-task-cleanup";
import { connectMcp, exchangePairing, installPairingDialogDriver, prepareHeadlessDesktopProfile, seedApprovedHeadlessConversation, takePairingCode } from "./headless-desktop-fixture";

test.use({ trace: "off", screenshot: "off", video: "off" });
type Client = Awaited<ReturnType<typeof connectMcp>>;
type WireValue = { ok?: boolean; operation?: string; code?: string; value?: unknown };

async function call(client: Client, name: string, args: Record<string, unknown>) {
  const result = await client.callTool({ name, arguments: args });
  const block = result.content?.[0];
  if (block?.type !== "text") throw new Error("The owned MCP response was not a fixed result.");
  return JSON.parse(block.text) as WireValue;
}

async function connectorSettings(app: ElectronApplication, page: Page) {
  // The native pairing path admits only this app's exact focused window.
  // A freshly restarted window can be painted before it acquires focus.
  const owner = await app.browserWindow(page);
  await owner.evaluate(window => { if (!window.isVisible()) throw new Error("The test window is not shown."); window.focus(); });
  try {
    await expect.poll(() => owner.evaluate(window => window.isFocused()), { timeout: 5_000 }).toBe(true);
  } finally { await owner.dispose(); }
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

function readVisibleSystemFeed(page: Page, workspaceId: string) {
  return page.evaluate(async (id) => {
    const api = (window as unknown as {
      desktopApi: { readSystemBuilderChangeWatermark(workspaceId: string): Promise<unknown> };
    }).desktopApi;
    return { visible: !document.hidden, watermark: await api.readSystemBuilderChangeWatermark(id) };
  }, workspaceId);
}

async function canvasCompetition(page: Page, mcp: Client, workspace: { workspaceId: string; hostIncarnationId: string },
  systemId: string, name: string, restartCursor: NonNullable<ReturnType<typeof parseHeadlessChangeCursor>>) {
  type Ref = { systemId: string; revisionId: string; recordRevision: number };
  const target = { ...workspace, systemId };
  const current = async () => {
    const result = await call(mcp, "aisb_read_system", target);
    const row = result.value as { revision?: number; currentRevisionId?: string } | undefined;
    if (!result.ok || !row?.revision || !row.currentRevisionId) throw new Error("No current composition revision was found.");
    return { baseRecordRevision: row.revision, baseRevisionId: row.currentRevisionId };
  };
  await page.getByRole("tab", { name: "Compose", exact: true }).click();
  await page.getByRole("combobox", { name: "System", exact: true }).selectOption({ label: name });
  await page.getByRole("button", { name: "Edit system", exact: true }).click();
  const editor = page.getByRole("group", { name: "System draft editor", exact: true });
  await expect(editor).toHaveAttribute("aria-busy", "false");
  await expect(editor).not.toHaveAttribute("disabled");
  const tableId = systemId + ".table";
  const table = page.locator(".system-composer__canvas-node").filter({ has: page.getByText("Artifact results", { exact: true }) });
  const select = page.locator(`.system-composer__canvas-node[data-instance-id="${tableId}"] > .system-composer__canvas-node-heading > button`);
  await expect(table.last()).toBeVisible();
  await select.first().click();
  const inspector = page.getByRole("complementary", { name: "Composer details" });
  await inspector.getByRole("tab", { name: "Properties", exact: true }).click();
  const title = inspector.locator('[id="title"]');
  for (const tab of ["Design", "Data", "Events"]) {
    await inspector.getByRole("tab", { name: tab, exact: true }).click();
    if (await title.isVisible()) break;
  }
  await expect(title).toHaveValue("Authorized artifacts");

  async function apply(title: string) {
    const input = { ...target, ...await current(), edits: [{ kind: "configure", instanceId: tableId, values: { title } }] };
    const preview = await call(mcp, "aisb_preview_edits", input);
    const previewDigest = (preview.value as { previewDigest?: string } | undefined)?.previewDigest;
    if (!preview.ok || !previewDigest) throw new Error("The owned composition edit did not preview.");
    const result = await call(mcp, "aisb_apply_edits", { ...input, previewDigest, idempotencyKey: randomUUID() });
    const reference = (result.value as { reference?: Ref } | undefined)?.reference;
    if (!result.ok || !reference) throw new Error("The owned composition edit did not commit.");
    return reference;
  }

  const firstEdit = await apply("Saved external title");
  const resumed = await call(mcp, "aisb_saved_system_changes", { ...workspace, cursor: restartCursor });
  expect(resumed).toMatchObject({ ok: true, operation: "systems.changes", value: {
    kind: "changes", events: [{ ...firstEdit, sequence: restartCursor.sequence + 1 }], more: false,
  } });
  await expect(title).toHaveValue("Saved external title", { timeout: 10_000 });
  await title.fill("My unsaved local title");
  const save = page.getByRole("button", { name: "Save and validate revision", exact: true });
  await expect(save).toBeEnabled();
  const winner = await apply("Newer saved external title");
  await expect(page.getByText("A newer saved version exists. Your unsaved changes are still here.", { exact: true })).toBeVisible();
  await expect(title).toHaveValue("My unsaved local title");
  await save.click();
  await page.getByRole("button", { name: /^Notifications(?:,|$)/ }).click();
  const notifications = page.getByRole("dialog", { name: "Notifications", exact: true });
  await expect(notifications.getByText("This system changed. Reload it before saving again.", { exact: true })).toBeVisible();
  await notifications.press("Escape");
  await expect(title).toHaveValue("My unsaved local title");
  expect(await current()).toEqual({ baseRevisionId: winner.revisionId, baseRecordRevision: winner.recordRevision });
}

function timings(samples: readonly number[]) {
  const sorted = [...samples].sort((left, right) => left - right);
  const at = (percentile: number) => sorted[Math.ceil(sorted.length * percentile) - 1] ?? 0;
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
    const region = await connectorSettings(first, page);
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
    const createdSystem = management.getByText(systemName, { exact: true });
    await expect(management.getByRole("heading", { name: "No systems found", exact: true })).toBeVisible();
    await expect(createdSystem).toHaveCount(0);
    let droppedCommittedCreate = 0;
    const lossyClient = await connectMcp(address, fingerprint, credential, () => { droppedCommittedCreate++; });
    try {
      await expect.poll(() => readVisibleSystemFeed(page, workspaceId), { timeout: 5_000 })
        .toEqual({ visible: true, watermark: { status: "ready", sequence: 0 } });
      const observedAt = performance.now();
      const [lostReply, visible] = await Promise.allSettled([
        lossyClient.callTool({ name: "aisb_create_system", arguments: { hostIncarnationId, ...create } }, { timeout: 5_000 }),
        expect(createdSystem).toBeVisible({ timeout: 5_000 }).then(() => performance.now() - observedAt),
      ]);
      expect({ replyLost: lostReply.status === "rejected", droppedCommittedCreate })
        .toEqual({ replyLost: true, droppedCommittedCreate: 1 });
      if (visible.status === "rejected") {
        const current = await readVisibleSystemFeed(page, workspaceId).catch(() => undefined);
        const watermark = current?.watermark as { status?: string; sequence?: number } | undefined;
        const committed = watermark?.status === "ready" && watermark.sequence === 1;
        throw new Error(`The autosave feed did not render the committed create. Window visible: ${current?.visible === true}. Exact commit watermark visible: ${committed}.`);
      }
      expect(visible.value).toBeLessThanOrEqual(5_000);
      await expect(manage).toHaveAttribute("aria-selected", "true");
    } finally { await lossyClient.close(); }
    const created = await call(mcp, "aisb_create_system", { hostIncarnationId, ...create });
    const createdValue = created.value as { kind?: string; reference?: { systemId: string; revisionId: string; recordRevision: number } };
    expect(created.ok && createdValue?.kind === "replayed" && Boolean(createdValue.reference)).toBe(true);
    const saved = createdValue.reference!;
    await expect(createdSystem).toBeVisible({ timeout: 5_000 });
    await expect(manage).toHaveAttribute("aria-selected", "true");

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
    const memorySamples: number[] = [];
    const sampleMainMemory = () => first.evaluate(() => Math.round(process.memoryUsage().rss / 1024 ** 2));
    const fixture = {
      cpuThreads: cpus().length, ramGiB: Math.round(totalmem() / 1024 ** 3),
      runnerNodeVersion: process.versions.node,
      desktop: await first.evaluate(() => ({ electronVersion: process.versions.electron, nodeVersion: process.versions.node })),
      fixtureSystems: 1, plannedSamples: 100, maximumOutstandingWrites: 1,
      documentVisibleBeforeMeasurement: await page.evaluate(() => document.visibilityState === "visible"),
    };
    memorySamples.push(await sampleMainMemory());
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
        if (index % 20 === 0) memorySamples.push(await sampleMainMemory());
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
    const recoveryMs = performance.now() - reconnectStart;
    const aggregate = timings(samples);
    await saveObservation({
      ...fixture, timingStartsBeforeDispatch: true,
      electronMainSampledRssMiB: { baseline: memorySamples[0], peak: Math.max(...memorySamples), samples: memorySamples.length },
      ...aggregate, failures, recoveryMs, delivered,
    });
    expect({ failures, samples: aggregate.count, delivered, more }).toEqual({ failures: 0, samples: 100, delivered: 100, more: false });
    expect(memorySamples.every(sample => Number.isSafeInteger(sample) && sample > 0)).toBe(true);
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
    const persistedCursor = parseHeadlessChangeCursor((ordinaryChanges.value as { cursor?: unknown }).cursor);
    if (!persistedCursor || persistedCursor.sequence <= 0) throw new Error("The committed journal has no durable watermark.");
    await expect(management.getByText(desktopName, { exact: true })).toBeVisible({ timeout: 5_000 });
    finalName = desktopName;
    await mcp.close();
    mcp = undefined;
    await lifetime.retire();

    const restarted = await lifetime.launch(launch);
    const next = await restarted.firstWindow({ timeout: 60_000 });
    await expect(next.getByLabel("Select current workspace")).toHaveValue(workspaceId, { timeout: 30_000 });
    const restartRegion = await connectorSettings(restarted, next);
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
    expect(await readVisibleSystemFeed(next, workspaceId)).toEqual({
      visible: true, watermark: { status: "ready", sequence: persistedCursor.sequence },
    });
    const rebuilt = await call(mcp, "aisb_saved_system_snapshot", { hostIncarnationId: newHost, workspaceId });
    expect(rebuilt).toMatchObject({ ok: true, operation: "systems.snapshot", value: {
      systems: [{ systemId: saved.systemId, recordRevision: expected.recordRevision + 1, revisionId: expected.revisionId }],
      cursor: { hostIncarnationId: newHost, sequence: persistedCursor.sequence },
    } });
    const restartCursor = parseHeadlessChangeCursor((rebuilt.value as { cursor?: unknown }).cursor);
    if (!restartCursor) throw new Error("The restarted journal did not return an authorized cursor.");
    await next.getByRole("button", { name: "Systems", exact: true }).click();
    await canvasCompetition(next, mcp, { hostIncarnationId: newHost, workspaceId }, saved.systemId, finalName, restartCursor);
  } finally {
    try { await mcp?.close(); }
    finally { await lifetime.retire(); }
  }
});

test("packaged Desktop observes a running approved turn from a separately paired MCP client", async () => {
  test.setTimeout(240_000);
  const profile = prepareHeadlessDesktopProfile("conversation");
  const launch = () => electron.launch({ executablePath: profile.executablePath, env: profile.env,
    args: [`--user-data-dir=${profile.dataRoot}`, "--disable-gpu"], timeout: 60_000 });
  let client: Client | undefined;
  let activeApp: ElectronApplication | undefined;
  let phase: "before-restart" | "after-restart" = "before-restart";
  let runtimeStarted = false;
  const retire = async () => {
    if (!activeApp) return;
    const app = activeApp;
    activeApp = undefined;
    if (runtimeStarted) {
      const cache = profile.env.HF_HUB_CACHE;
      const outcome = await closeDesktopAndQualifyOwnedWorkers(app, cache, test.info(), phase);
      if (phase === "before-restart") {
        // Retain the confirmed first worker identity, but keep it distinct from
        // the second launch's fresh markers. The synthetic model cache stays put.
        const names = (await readdir(cache)).filter(name => /^qualification-worker-identity-[0-9]+\.json$/.test(name));
        if (names.length !== outcome.physicalWorkersObserved) throw new Error("Unexpected qualification worker count.");
        for (const name of names) {
          const original = path.join(cache, name);
          const stats = await lstat(original);
          const prior = path.join(cache, "retired-" + name);
          if (!stats.isFile() || stats.isSymbolicLink() || stats.size > 1024 || await realpath(original) !== original ||
              await lstat(prior).then(() => true, error => { if (error.code === "ENOENT") return false; throw error; }))
            throw new Error("The retired worker marker cannot be preserved.");
          const marker = JSON.parse(await readFile(original, "utf8"));
          if (marker.parentPid !== outcome.mainPid || name !== `qualification-worker-identity-${marker.pid}.json`)
            throw new Error("The retired worker marker does not match the owned launch.");
          await rename(original, prior);
        }
      }
    } else await app.close();
    runtimeStarted = false;
  };
  const startRuntime = async (page: Page) => {
    // A lost startup response may still leave a worker to account for.
    runtimeStarted = true;
    const started = await page.evaluate(async () => {
      const api = (window as unknown as { desktopApi?: { controlPythonRuntime: (input: { action: string }) => Promise<{ ok: boolean }> } }).desktopApi;
      return (await api?.controlPythonRuntime({ action: "start" }))?.ok === true;
    });
    expect(started).toBe(true);
  };
  try {
    const first = activeApp = await launch();
    const firstPage = await first.firstWindow({ timeout: 60_000 });
    await expect(firstPage.getByRole("heading", { name: "Create a Workspace", exact: true })).toBeVisible({ timeout: 60_000 });
    const workspaceId = await createFormWorkspace(firstPage, "Approved chat qualification");
    await startRuntime(firstPage);
    const modelRecordId = await firstPage.evaluate(async workspaceId => {
      const api = (window as unknown as { desktopApi?: {
        saveModelReference(input: object): Promise<{ ok: boolean; value?: { model?: { modelRecordId?: string } } }>;
        downloadModel(input: object): Promise<{ ok: boolean }>;
        listModels(input: object): Promise<{ ok: boolean; value?: unknown }>;
      } }).desktopApi;
      const target = { workspaceId, provider: "huggingface", modelId: "qualification/controlled-chat",
        displayName: "Controlled chat fixture", inferenceMode: "chat", taskTags: ["text-generation"], artifactForm: "full-model" };
      const saved = await api?.saveModelReference(target);
      const modelRecordId = saved?.value?.model?.modelRecordId;
      if (!saved?.ok || !modelRecordId || !(await api?.downloadModel({ ...target, modelRecordId }))?.ok) return undefined;
      return modelRecordId;
    }, workspaceId);
    expect(typeof modelRecordId).toBe("string");
    await retire();
    seedApprovedHeadlessConversation(profile, workspaceId, modelRecordId!);
    phase = "after-restart";
    const app = activeApp = await launch();
    const page = await app.firstWindow({ timeout: 60_000 });
    await startRuntime(page);
    const region = await connectorSettings(app, page);
    await installPairingDialogDriver(app, true, "conversation");
    await region.getByRole("button", { name: "Pair a client that can run approved conversations", exact: true }).click();
    const { address, fingerprint } = await runningAddress(region);
    const credential = await exchangePairing(address, fingerprint, await takePairingCode(app));
    client = await connectMcp(address, fingerprint, credential, undefined, "conversation");
    expect((await client.listTools()).tools.some(tool => tool.name === "aisb_create_system")).toBe(false);
    const hostIncarnationId = await hostId(client);
    const workspace = { hostIncarnationId, workspaceId };
    const list = await call(client, "aisb_list_workflows", { ...workspace, sourceKind: "reviewed-execution-plan" });
    const rows = list.value as { profileId: string; source: { sourceId: string; sourceRevision: string } }[] | undefined;
    const workflow = rows?.find(row => row.profileId === "builtin.workflow.conversation@1.0.0");
    if (!list.ok || !workflow) throw new Error("The owned approved plan was not found.");
    const prepare = await call(client, "aisb_prepare_workflow", { ...workspace, profileId: workflow.profileId, source: workflow.source });
    const prepared = prepare.value as { snapshotRevision: string; approvedSessionIds?: string[] } | undefined;
    expect(prepare.ok && prepared?.approvedSessionIds?.length).toBe(1);
    const sessionId = prepared!.approvedSessionIds![0]!;
    const input = { ...workspace, planId: workflow.source.sourceId, planRevision: workflow.source.sourceRevision,
      sessionId, snapshotRevision: prepared!.snapshotRevision, key: randomUUID(), text: "Synthetic approved chat request" };
    const refused = await call(client, "aisb_send_approved_turn", { ...input, snapshotRevision: "wrong-revision" });
    expect(refused.ok).toBe(false);
    const admitted = await call(client, "aisb_send_approved_turn", input);
    const handle = admitted.value as { turnId: string; runId: string } | undefined;
    if (!admitted.ok || !handle?.turnId || !handle.runId) throw new Error("No durable task handle was returned.");
    const query = { ...workspace, sessionId, turnId: handle.turnId };
    const read = () => call(client!, "aisb_read_conversation_task", query);
    expect(await read()).toEqual({ ok: true, operation: "conversation-tasks.read",
      value: { sessionId, turnId: handle.turnId, turnStatus: "generating", run: { runId: handle.runId, status: "running" } } });
    const activity = region.getByRole("region", { name: "Recent chat tasks", exact: true });
    const row = activity.getByRole("listitem").filter({ hasText: handle.runId });
    await expect(row).toContainText("Running");
    // A separate stdio process recovers the same handle while the worker continues.
    await client.close();
    client = await connectMcp(address, fingerprint, credential, undefined, "conversation");
    expect(await call(client, "aisb_send_approved_turn", input)).toEqual(admitted);
    await expect.poll(read, { timeout: 12_000, intervals: [100, 250, 500] }).toEqual({
      ok: true, operation: "conversation-tasks.read",
      value: { sessionId, turnId: handle.turnId, turnStatus: "succeeded", run: { runId: handle.runId, status: "succeeded" } },
    });
    await expect(row).toHaveCount(1);
    await expect(row).toContainText("Completed");
    await expect(activity.getByText(input.text, { exact: false })).toHaveCount(0);
    expect(await call(client, "aisb_send_approved_turn", { ...input, text: "Different synthetic request" }))
      .toEqual({ ok: false, code: "headless.idempotency-conflict" });
  } finally {
    try { await client?.close(); }
    finally { await retire(); }
  }
});
