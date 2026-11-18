import { createHash, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { mkdir, realpath, writeFile } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";
import { _electron as electron, type ElectronApplication } from "playwright";
import type { HeadlessSavedContextReference, HeadlessContextTaskValue } from "../../../../../modules/contracts/headless";
import { assetApplicationLifetime } from "../asset-experience-oracles";
import { CONTEXT_FIXTURE_MODEL_RECORD, installContextFixtureModel } from "../headless-context-fixture";
import { closeDesktopAndQualifyOwnedWorkers } from "./desktop-task-cleanup";
import { safeQualificationFailureType } from "../qualification-reporting";
import { createFormWorkspace } from "./form-composer-authoring-journey";
import { connectMcp, exchangePairing, installPairingDialogDriver, prepareHeadlessDesktopProfile, takePairingCode } from "./headless-desktop-fixture";

// Registered by the existing Headless spec, which disables all capture.
type Client = Awaited<ReturnType<typeof connectMcp>>;
type Wire = {ok?: boolean; code?: string; value?: any};
async function call(client: Client, name: string, args: Record<string, unknown>): Promise<Wire> {
  const result = await client.callTool({name, arguments: args});
  const block = result.content?.[0];
  if (result.content?.length !== 1 || block?.type !== "text" || block.text.length > 64 * 1024) throw new Error("Invalid bounded Context MCP reply.");
  return JSON.parse(block.text);
}
async function settings(app: ElectronApplication, page: Page) {
  const window = await app.browserWindow(page);
  try {
    await window.evaluate(owner => owner.focus());
    await expect.poll(() => window.evaluate(owner => owner.isFocused()), {timeout: 5000}).toBe(true);
  } finally { await window.dispose(); }
  await page.getByRole("button", {name: "Settings", exact: true, description: "Settings"}).click();
  const button = page.getByRole("button", {name: "Local chat clients", exact: true});
  if (await button.getAttribute("aria-expanded") !== "true") await button.click();
  const region = page.getByRole("region", {name: "Local chat clients", exact: true});
  await expect(region).toBeVisible(); return region;
}

export async function runHeadlessContextDesktopJourney() {
  test.setTimeout(240_000);
  const root = process.cwd(), profile = prepareHeadlessDesktopProfile("plan-review");
  const model = await installContextFixtureModel(root, profile.dataRoot, process.env.VISUAL_COMPOSER_CONTEXT_MODEL_ACQUISITION);
  const python = process.env.PYTHON;
  expect(typeof python === "string" && path.isAbsolute(python)).toBe(true);
  // The existing wrapper records its own PID, then runs unchanged packaged main.py.
  // It does not replace handlers, vectors, model loading, results or authorization.
  const env = {...profile.env, NODE_ENV: "test", PYTHON_RUNTIME_COMMAND: python!,
    PYTHON_RUNTIME_ARGS: "-u " + path.join(root, "dev-tools/scripts/qualification/visual-composer/headless-dataset-runtime-worker.py"),
    PYTHON_RUNTIME_WORKER_DIR: path.join(root, "out/ai-system-builder-win32-x64/resources/worker"),
    AISB_HEADLESS_DATASET_QUALIFICATION: "1", HF_HUB_OFFLINE: "1", TRANSFORMERS_OFFLINE: "1", HF_DATASETS_OFFLINE: "1", PIP_NO_INDEX: "1"};
  const lifetime = assetApplicationLifetime<ElectronApplication>();
  let app: ElectronApplication | undefined, client: Client | undefined, display: Client | undefined;
  let workerStarted = false, phase = "launch", journeyPassed = false, cleanupPassed = false;
  const failures: unknown[] = [];
  const facts = {packSaved: false, ragSaved: false, queryCitations: 0, rebuildSaved: false, replayChecks: 0, denialChecks: 0, presentations: 0, revoked: false};
  try {
    app = await lifetime.launch(() => electron.launch({executablePath: profile.executablePath, env,
      args: ["--user-data-dir=" + profile.dataRoot, "--disable-gpu"], timeout: 60_000}));
    const originalClose = app.close.bind(app); let closeFlight: Promise<void> | undefined;
    app.close = () => closeFlight ??= originalClose();
    const page = await app.firstWindow({timeout: 60_000});
    await expect(page.getByRole("heading", {name: "Create a Workspace", exact: true})).toBeVisible({timeout: 60_000});
    const workspaceId = await createFormWorkspace(page, "Headless Context qualification");
    const seed = spawnSync(path.join(root, "node_modules/electron/dist/electron.exe"),
      ["--preserve-symlinks", "--preserve-symlinks-main", "--import", "tsx", "dev-tools/scripts/qualification/visual-composer/headless-context-model-seed.ts"],
      {cwd: root, env: {...env, ELECTRON_RUN_AS_NODE: "1", AISB_QUALIFICATION_WORKSPACE: workspaceId,
        AISB_QUALIFICATION_CONTEXT_MODEL: model.directory}, windowsHide: true, timeout: 30_000, maxBuffer: 8192});
    expect(seed.status, "The isolated installed-model registry entry must be created").toBe(0);
    phase = "pair";
    let region = await settings(app, page);
    await installPairingDialogDriver(app, true, "plan-review");
    await region.getByRole("button", {name: "Pair a client that requests plan approval", exact: true}).click();
    await expect(region.getByText("The local connector is on.", {exact: true})).toBeVisible();
    const address = await region.getByText("Local address:", {exact: false}).locator("code").innerText();
    const fingerprint = await region.getByText("Certificate fingerprint:", {exact: false}).locator("code").innerText();
    client = await connectMcp(address, fingerprint, await exchangePairing(address, fingerprint, await takePairingCode(app)), undefined, "plan-review");
    const host = await call(client, "aisb_host_describe", {});
    expect(host.ok).toBe(true);
    const workspace = {workspaceId, hostIncarnationId: host.value.hostIncarnationId};
    const mcp = client;

    async function approve(step: Record<string, unknown>, channel: "popup" | "chat" = "popup") {
      const preview = await call(mcp, "aisb_preview_build_plan", {...workspace, steps: [step]});
      expect(preview.ok, "The exact Context plan must preview").toBe(true);
      const fingerprint = preview.value.fingerprint as string;
      expect(fingerprint).toMatch(/^[a-f0-9]{64}$/);
      expect(await call(mcp, "aisb_request_build_plan_approval", {...workspace, fingerprint, steps: [step]}))
        .toMatchObject({ok: true, value: {status: "pending", approvedSteps: 0, stepCount: 1}});
      const target = {...workspace, fingerprint, approvalRevision: 2, step: 1};
      expect((await call(mcp, "aisb_run_approved_build_step", target)).ok).toBe(false); facts.denialChecks++;
      region = await settings(app!, page);
      await region.getByRole("button", {name: channel === "popup" ? "Review plan requests" : "Open plan approval chat", exact: true}).click();
      const panel = page.getByRole(channel === "popup" ? "dialog" : "region", {name: channel === "popup" ? "Review plan requests" : "Plan approval chat", exact: true});
      await panel.getByRole("button", {name: new RegExp("^Review request " + fingerprint.slice(0, 8))}).click();
      const permissions = panel.getByRole("list", {name: "Permissions and limits"});
      const changes = panel.getByRole("list", {name: "Requested changes"});
      await expect(permissions).toContainText("No outside service calls or provider charges.");
      if (step.operation === "data.save-local-source") {
        await expect(permissions).toContainText("Save the listed files");
        await expect(changes).toContainText("Save the selected file in Data");
        await expect(changes).toContainText(String(step.fileId));
        await expect(changes).toContainText(`Upload ${step.taskId}, version ${step.taskRevision}`);
      } else if (step.operation === "context.save-result") {
        await expect(permissions).toContainText("This save starts no model or processing task.");
        await expect(changes).toContainText(`Save reviewed Context: ${step.name}`);
        await expect(changes).toContainText(`Context task: ${step.taskId}`);
        await expect(changes).toContainText(`Reviewed result: ${step.reportFingerprint}`);
      } else if (step.operation === "context.query") {
        await expect(permissions).toContainText("Return only source references, scores and citation locations.");
        await expect(permissions).toContainText("This search does not save or publish data.");
        await expect(changes).toContainText("Search a saved RAG database");
        await expect(changes).toContainText(String(step.queryDigest));
        const reference = step.reference as HeadlessSavedContextReference;
        for (const text of [reference.contextId, reference.taskId, reference.artifactDigest, String(step.modelRecordId), String(step.modelUpdatedAt),
          `Device: ${step.embeddingDevice}. Return at most ${step.maximumResults} citation results.`]) await expect(changes).toContainText(text);
      } else {
        const settings = step.settings as Record<string, any>;
        const rag = step.operation === "context.generate-rag", parent = step.rebuildOf as HeadlessSavedContextReference | undefined;
        await expect(changes).toContainText(`${parent ? rag ? "Rebuild RAG database" : "Rebuild Context pack" : rag ? "Build RAG database" : "Prepare Context pack"}: ${step.name}`);
        await expect(permissions).toContainText(rag ? "Read the exact listed model record" : "Preparing this Markdown pack makes no model calls and installs no models.");
        await expect(changes).toContainText("Result review and a separate save request are required.");
        for (const source of step.sources as {taskId: string; fileId: string; taskRevision: number}[]) {
          await expect(changes).toContainText(`File reference ${source.fileId}. Upload ${source.taskId}, version ${source.taskRevision}.`);
        }
        await expect(changes).toContainText(`Text fields: ${settings.textFields.join(", ")}.`);
        await expect(changes).toContainText(`Chunk size: ${settings.chunkCharacters} characters.`);
        await expect(changes).toContainText(`Overlap: ${settings.overlapCharacters} characters. Maximum chunks: ${settings.maximumChunks}.`);
        if (rag) for (const text of [settings.modelRecordId, settings.modelUpdatedAt,
          `Device: ${settings.device}. Embedding batch size: ${settings.batchSize}.`, "Require license: No.", "Include source attribution: Yes."]) await expect(changes).toContainText(text);
        if (parent) for (const text of [parent.contextId, parent.taskId, parent.artifactDigest, "Keep the saved Context unchanged."]) await expect(changes).toContainText(text);
      }
      await panel.getByRole("button", {name: "Approve change 1", exact: true}).click();
      await expect(panel.getByText("Plan approved.", {exact: true})).toBeVisible();
      await panel.getByRole("button", {name: channel === "popup" ? "Close plan review" : "Close plan approval chat", exact: true}).click();
      const status = await call(mcp, "aisb_build_plan_approval_status", {...workspace, fingerprint});
      expect(status).toMatchObject({ok: true, value: {status: "approved", approvedSteps: 1}});
      return {...target, approvalRevision: status.value.revision as number};
    }
    async function generate(step: Record<string, unknown>) {
      const target = await approve(step, step.operation === "context.generate-pack" ? "chat" : "popup");
      workerStarted = true;
      const start = await call(mcp, "aisb_run_approved_build_step", target);
      if (start.ok) expect(start).toMatchObject({value: {kind: "started", operation: step.operation}});
      else expect(start.code).toBe("headless.operation-unconfirmed");
      let task: HeadlessContextTaskValue | undefined;
      await expect.poll(async () => {
        const result = await call(mcp, "aisb_context_task", {...workspace, selection: {kind: "plan-step", fingerprint: target.fingerprint, step: 1}});
        if (!result.ok) { expect(["headless.forbidden", "headless.unavailable"]).toContain(result.code); return "awaiting"; }
        if (task) expect(result.value.taskId).toBe(task.taskId);
        task = result.value; return result.value.state;
      }, {timeout: 90_000, intervals: [250, 500, 1000], message: "The actual Context worker must produce a reviewable result"}).toBe("review-required");
      const value = task as Extract<HeadlessContextTaskValue, {review: unknown}>;
      expect(value.review).toMatchObject({kind: step.operation === "context.generate-pack" ? "markdown-context-pack" : "rag-database",
        reportFingerprint: expect.stringMatching(/^[a-f0-9]{64}$/), sourceCount: 1, requiresExplicitSave: true});
      expect(value.review!.chunkCount).toBeGreaterThan(0);
      expect(await call(mcp, "aisb_run_approved_build_step", target)).toMatchObject({ok: true, value: {kind: "replayed", reference: {taskId: value.taskId}}}); facts.replayChecks++;
      expect(await call(mcp, "aisb_context_task", {...workspace, selection: {kind: "task", taskId: randomUUID()}})).toMatchObject({ok: false}); facts.denialChecks++;
      const saveStep = {operation: "context.save-result", idempotencyKey: randomUUID(), taskId: value.taskId,
        reportFingerprint: value.review!.reportFingerprint, name: step.name};
      const saveTarget = await approve(saveStep);
      const saved = await call(mcp, "aisb_run_approved_build_step", saveTarget);
      expect(saved).toMatchObject({ok: true, value: {kind: "committed", reference: {workspaceId, taskId: value.taskId, kind: value.review!.kind}}});
      const reference = saved.value.reference as HeadlessSavedContextReference;
      expect(await call(mcp, "aisb_run_approved_build_step", saveTarget)).toMatchObject({ok: true, value: {kind: "replayed", reference}}); facts.replayChecks++;
      const read = await call(mcp, "aisb_read_context", {...workspace, contextId: reference.contextId});
      expect(read).toMatchObject({ok: true, value: {reference, name: step.name, sourceCount: 1, byteAvailability: "not-checked"}});
      return {reference, read, taskId: value.taskId};
    }

    phase = "import";
    await page.getByRole("button", {name: "Data", exact: true}).click();
    await page.getByRole("tab", {name: "Artifact Ingestion", exact: true}).click();
    const ingestion = page.getByRole("list", {name: "Add data workflow", exact: true});
    const contents = Buffer.from("team,priority\nBilling support checks invoice dates before sending a replacement invoice.,Confirm the billing record and invoice period.\nAccount support helps customers restore sign in.,Send the approved password reset instructions.\n");
    await ingestion.getByLabel("Choose one or more files", {exact: true}).setInputFiles({name: "synthetic-context.csv", mimeType: "text/csv", buffer: contents});
    await expect(ingestion.getByRole("combobox", {name: "Chat client", exact: true})).not.toHaveValue("");
    await ingestion.getByRole("button", {name: "Prepare for chat", exact: true}).click();
    const selected = JSON.parse(await ingestion.getByRole("textbox", {name: "File reference", exact: true}).inputValue());
    const sourceTarget = await approve({operation: "data.save-local-source", taskId: selected.taskId, fileId: selected.fileId,
      taskRevision: selected.taskRevision, idempotencyKey: randomUUID()});
    expect(await call(mcp, "aisb_run_approved_build_step", sourceTarget)).toMatchObject({ok: true, value: {kind: "committed"}});
    const sourceStatus = await call(mcp, "aisb_ingestion_status", {...workspace, taskId: selected.taskId});
    expect(sourceStatus).toMatchObject({ok: true, value: {state: "succeeded", revision: expect.any(Number)}});
    const sources = [{kind: "ingestion-file", taskId: selected.taskId, fileId: selected.fileId, taskRevision: sourceStatus.value.revision}];
    const chunk = {chunkCharacters: 500, overlapCharacters: 50, maximumChunks: 100, textFields: ["team", "priority"]};
    phase = "pack";
    const pack = await generate({operation: "context.generate-pack", idempotencyKey: randomUUID(), name: "Synthetic Context pack", sources,
      settings: {...chunk, kind: "markdown-context-pack", cleaningPreset: "standard"}});
    facts.packSaved = true;
    phase = "rag";
    const models = await call(mcp, "aisb_context_models", workspace);
    expect(models).toMatchObject({ok: true, value: {runtimeReadiness: "not-checked"}});
    const installed = models.value.models.find((entry: {modelRecordId: string}) => entry.modelRecordId === CONTEXT_FIXTURE_MODEL_RECORD);
    expect(installed).toMatchObject({embeddings: true, lifecycleStatus: "downloaded"});
    const ragSettings = {...chunk, kind: "rag-database", modelRecordId: installed.modelRecordId, modelUpdatedAt: installed.updatedAt,
      batchSize: 8, device: "cpu", sourceChecks: {preset: "recommended", allowedLanguages: ["en"],
        requireLicenseMetadata: false, requireConsentMetadata: false, includeSourceAttribution: true}};
    const rag = await generate({operation: "context.generate-rag", idempotencyKey: randomUUID(), name: "Synthetic support RAG", sources, settings: ragSettings});
    facts.ragSaved = true;
    phase = "query";
    const question = "How does billing support replace an invoice?";
    const queryInput = {...workspace, reference: rag.reference, query: question, maximumResults: 5, embeddingDevice: "cpu"};
    const preview = await call(mcp, "aisb_preview_context_query", queryInput);
    expect(preview).toMatchObject({ok: true, value: {modelRecordId: installed.modelRecordId, modelUpdatedAt: installed.updatedAt, output: "citation-summary"}});
    for (const reference of [{...rag.reference, artifactDigest: "sha256:" + "f".repeat(64)}, {...rag.reference, contextId: randomUUID()}]) {
      expect((await call(mcp, "aisb_preview_context_query", {...queryInput, reference})).ok).toBe(false); facts.denialChecks++;
    }
    const queryTarget = await approve({operation: "context.query", idempotencyKey: randomUUID(), reference: rag.reference,
      queryDigest: preview.value.queryDigest, modelRecordId: installed.modelRecordId, modelUpdatedAt: installed.updatedAt,
      maximumResults: 5, embeddingDevice: "cpu"});
    const queryStart = await call(mcp, "aisb_run_approved_build_step", {...queryTarget, contextQuery: question});
    if (!queryStart.ok) expect(queryStart.code).toBe("headless.operation-unconfirmed");
    let query: any;
    await expect.poll(async () => {
      const result = await call(mcp, "aisb_context_task", {...workspace, selection: {kind: "plan-step", fingerprint: queryTarget.fingerprint, step: 1}});
      if (!result.ok) { expect(["headless.forbidden", "headless.unavailable"]).toContain(result.code); return "awaiting"; }
      if (query) expect(result.value.taskId).toBe(query.taskId);
      query = result.value; return query.state === "succeeded" && query.query.cleanupPending ? "retiring" : query.state;
    }, {timeout: 60_000, intervals: [250, 500, 1000], message: "The approved query must return actual citation coordinates"}).toBe("succeeded");
    expect(query.query).toMatchObject({queryDigest: preview.value.queryDigest, maximumResults: 5, embeddingDevice: "cpu", cleanupPending: false});
    expect(query.query.sources).toHaveLength(1);
    expect(query.query.sources[0]).toMatchObject({reference: sources[0], digest: "sha256:" + createHash("sha256").update(contents).digest("hex")});
    expect(query.query.matches.length).toBeGreaterThan(0); expect(query.query.matches.length).toBeLessThanOrEqual(5);
    expect(query.query.matches).toHaveLength(2);
    expect(query.query.matches.map((match: {rowIndex: number}) => match.rowIndex).sort()).toEqual([0, 1]);
    expect(query.query.matches.every((match: {chunkIndex: number}) => match.chunkIndex === 0)).toBe(true);
    for (const [index, match] of query.query.matches.entries()) {
      expect(match).toMatchObject({rank: index + 1, sourceOrdinal: 1, chunkIndex: expect.any(Number)});
      expect(Number.isFinite(match.score)).toBe(true);
      expect(Object.keys(match).every(key => ["rank", "score", "sourceOrdinal", "chunkIndex", "rowIndex", "normalizedStart", "normalizedEnd", "pageNumber"].includes(key))).toBe(true);
    }
    expect(JSON.stringify(query)).not.toContain(question);
    facts.queryCitations = query.query.matches.length;
    expect(await call(mcp, "aisb_run_approved_build_step", queryTarget)).toMatchObject({ok: true, value: {kind: "replayed", reference: {taskId: query.taskId}}}); facts.replayChecks++;
    phase = "rebuild";
    const rebuild = await call(mcp, "aisb_preview_context_rebuild", {...workspace, reference: rag.reference});
    expect(rebuild).toMatchObject({ok: true, value: {reference: rag.reference, preview: {settings: ragSettings}}});
    const rebuilt = await generate({operation: "context.generate-rag", idempotencyKey: randomUUID(), name: "Rebuilt support RAG", sources,
      settings: ragSettings, rebuildOf: rag.reference});
    expect(rebuilt.reference.contextId).not.toBe(rag.reference.contextId);
    expect(await call(mcp, "aisb_read_context", {...workspace, contextId: rag.reference.contextId})).toEqual(rag.read);
    facts.rebuildSaved = true;

    phase = "presentation";
    region = await settings(app, page);
    await installPairingDialogDriver(app, true, "presentation");
    await region.getByRole("button", {name: "Pair a client that can request window control", exact: true}).click();
    display = await connectMcp(address, fingerprint, await exchangePairing(address, fingerprint, await takePairingCode(app)), undefined, "presentation");
    const windows = await call(display, "aisb_list_windows", workspace);
    expect(windows.ok).toBe(true); expect(windows.value.windows).toHaveLength(1);
    const requested = await call(display, "aisb_request_window", {target: windows.value.windows[0], requestKey: randomUUID(), taskId: randomUUID()});
    expect(requested.ok).toBe(true);
    const attempt = requested.value.request.target;
    const consent = page.getByRole("dialog", {name: "Automation takeover request", exact: true});
    await expect(consent).toBeVisible();
    await consent.getByRole("button", {name: "Accept automation takeover", exact: true}).click();
    let lease: object | undefined;
    await expect.poll(async () => { const status = await call(display!, "aisb_window_status", {target: attempt}); lease = status.value?.lease; return !!lease; }).toBe(true);
    const shown = page.getByRole("region", {name: "Resource shown by automation", exact: true});
    for (const [intent, title, id] of [
      [{action: "show-context-artifact", reference: pack.reference}, "Saved context pack", pack.reference.contextId],
      [{action: "show-context-artifact", reference: rag.reference}, "Saved RAG database", rag.reference.contextId],
      [{action: "show-context-task", taskId: rebuilt.taskId}, "Context task", rebuilt.taskId],
      [{action: "show-context-query", taskId: query.taskId}, "Context search", query.taskId],
    ] as const) {
      const command = {target: lease, commandId: randomUUID(), intent};
      expect(await call(display, "aisb_present_in_window", command)).toMatchObject({ok: true});
      await expect(shown.getByRole("heading", {name: title, exact: true})).toBeVisible();
      await expect(shown).toContainText(id);
      if (intent.action === "show-context-query") {
        await expect(shown).toContainText(`Status: ${query.state}. Citation results: ${query.query.matches.length}. Sources: ${query.query.sources.length}. Device: ${query.query.embeddingDevice}. Maximum results: ${query.query.maximumResults}. Cleanup: complete. Question fingerprint: ${query.query.queryDigest}.`);
      } else if (intent.action === "show-context-artifact") {
        const saved = intent.reference.contextId === pack.reference.contextId ? pack.read.value : rag.read.value;
        await expect(shown).toContainText(`Sources: ${saved.sourceCount}. Chunks: ${saved.chunkCount}. Size: ${saved.sizeBytes} bytes. File availability has not been checked.`);
        await expect(shown).toContainText(intent.reference.artifactDigest);
      } else {
        const task = await call(mcp, "aisb_context_task", {...workspace, selection: {kind: "task", taskId: intent.taskId}});
        expect(task.ok).toBe(true);
        await expect(shown).toContainText(task.value.review
          ? `Review required. Sources: ${task.value.review.sourceCount}. Chunks: ${task.value.review.chunkCount}. Size: ${task.value.review.sizeBytes} bytes. Approve saving separately.`
          : `Task status: ${task.value.state}.`);
      }
      await expect.poll(async () => (await call(display!, "aisb_present_in_window", command)).value).toMatchObject({kind: "command", duplicate: true, receipt: {status: "applied"}});
      expect(await call(display, "aisb_window_context", {target: lease})).toMatchObject({ok: true, value: {context: {selection: intent}}}); facts.presentations++;
    }
    expect((await call(display, "aisb_present_in_window", {target: lease, commandId: randomUUID(), intent: {action: "show-context-task", taskId: query.taskId}})).ok).toBe(false); facts.denialChecks++;
    await page.getByRole("button", {name: "Revoke automation takeover", exact: true}).click();
    await expect(shown).toHaveCount(0);
    expect(await call(display, "aisb_window_context", {target: lease})).toEqual({ok: false, code: "headless.forbidden"}); facts.denialChecks++;
    expect((await call(display, "aisb_present_in_window", {target: lease, commandId: randomUUID(), intent: {action: "show-context-artifact", reference: rag.reference}})).ok).toBe(false); facts.denialChecks++;
    expect(await call(mcp, "aisb_read_context", {...workspace, contextId: rag.reference.contextId})).toEqual(rag.read);
    expect(await call(mcp, "aisb_context_task", {...workspace, selection: {kind: "task", taskId: query.taskId}})).toEqual({ok: true, operation: "context.task", value: query});
    facts.revoked = true; journeyPassed = true; phase = "complete";
  } catch (error) { failures.push(error); }
  finally {
    try { await Promise.all([client?.close(), display?.close()]); } catch (error) { failures.push(error); }
    try {
      if (app && workerStarted) {
        const outcome = await closeDesktopAndQualifyOwnedWorkers(app, model.cache, test.info());
        cleanupPassed = outcome.status === "passed";
      }
    } catch (error) { failures.push(error); }
    try { await lifetime.retire(); } catch (error) { failures.push(error); }
    const observation = {
      schemaVersion: "headless-context-desktop-observation-v1", sourceRevision: process.env.VISUAL_COMPOSER_QUALIFICATION_SOURCE_REVISION,
      journeyPassed, cleanupPassed, phase, facts, failures: failures.map(safeQualificationFailureType),
      model: "pinned-installed-MiniLM", worker: "unchanged-packaged-main",
      managedHost: "pending", physicalFailedBuild: "pending", parentQualification: "pending"};
    try {
      const run = process.env.VISUAL_COMPOSER_QUALIFICATION_RUN_ID;
      expect(run).toMatch(/^[a-z0-9-]{20,80}$/);
      expect(observation.sourceRevision).toMatch(/^source\.[a-f0-9]{64}$/);
      const folder = path.resolve("artifacts/qualification/visual-composer/runs", run!);
      await mkdir(folder, {recursive: true}); expect(await realpath(folder)).toBe(folder);
      const body = JSON.stringify(observation); expect(Buffer.byteLength(body)).toBeLessThan(8192);
      await writeFile(path.join(folder, "headless-context-desktop.json"), body + "\n", {flag: "wx"});
      await test.info().attach("headless-context-desktop", {contentType: "application/json", body});
    } catch (error) { failures.push(error); }
  }
  if (failures.length) throw new AggregateError(failures, "The focused Desktop Context journey did not qualify.");
}
