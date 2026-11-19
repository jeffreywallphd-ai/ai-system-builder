import { spawnSync } from "node:child_process";
import path from "node:path";
import { mkdir, realpath, writeFile } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";
import { _electron as electron, type ElectronApplication } from "playwright";
import { assetApplicationLifetime } from "../asset-experience-oracles";
import { contextFixtureRuntimeEndpoint, installContextFixtureModel, readContextFixtureStartupFailures } from "../headless-context-fixture";
import { closeDesktopAndQualifyOwnedWorkers } from "./desktop-task-cleanup";
import { safeQualificationFailureType } from "../qualification-reporting";
import {runHeadlessContextWorkflow, contextWorkflowFacts} from "./headless-context-workflow";
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
  const endpointProfile = process.env.VISUAL_COMPOSER_CONTEXT_ENDPOINT_PROFILE ?? "explicit-qualification";
  if (endpointProfile !== "explicit-qualification" && endpointProfile !== "os-selected-default") throw new Error("Invalid Context endpoint profile.");
  const root = process.cwd(), endpoint = endpointProfile === "os-selected-default" ? {} : contextFixtureRuntimeEndpoint(process.env), profile = prepareHeadlessDesktopProfile("plan-review");
  const model = await installContextFixtureModel(root, profile.dataRoot, process.env.VISUAL_COMPOSER_CONTEXT_MODEL_ACQUISITION);
  const python = process.env.PYTHON;
  expect(typeof python === "string" && path.isAbsolute(python)).toBe(true);
  // The existing wrapper records its own PID, then runs unchanged packaged main.py.
  // It does not replace handlers, vectors, model loading, results or authorization.
  const env = {...profile.env, ...endpoint, NODE_ENV: "test", PYTHON_RUNTIME_COMMAND: python!,
    PYTHON_RUNTIME_ARGS: "-u " + path.join(root, "dev-tools/scripts/qualification/visual-composer/headless-dataset-runtime-worker.py"),
    PYTHON_RUNTIME_WORKER_DIR: path.join(root, "out/ai-system-builder-win32-x64/resources/worker"),
    AISB_HEADLESS_DATASET_QUALIFICATION: "1", HF_HUB_OFFLINE: "1", TRANSFORMERS_OFFLINE: "1", HF_DATASETS_OFFLINE: "1", PIP_NO_INDEX: "1"};
  if (endpointProfile === "os-selected-default") {
    for (const key of ["PYTHON_RUNTIME_HOST", "PYTHON_RUNTIME_PORT", "PYTHON_RUNTIME_BASE_URL"]) delete (env as NodeJS.ProcessEnv)[key];
    expect(["PYTHON_RUNTIME_HOST", "PYTHON_RUNTIME_PORT", "PYTHON_RUNTIME_BASE_URL"].map(key => (env as NodeJS.ProcessEnv)[key])).toEqual([undefined, undefined, undefined]);
  }
  const lifetime = assetApplicationLifetime<ElectronApplication>();
  let app: ElectronApplication | undefined, client: Client | undefined, display: Client | undefined;
  let workerStarted = false, phase = "launch", journeyPassed = false, cleanupPassed = false;
  const failures: unknown[] = [];
  let startupFailures: Awaited<ReturnType<typeof readContextFixtureStartupFailures>> = [];
  let runtimeFailure: object | undefined, readRuntimeFailure: (() => Promise<object>) | undefined;
  const facts = contextWorkflowFacts();
  try {
    app = await lifetime.launch(() => electron.launch({executablePath: profile.executablePath, env,
      args: ["--user-data-dir=" + profile.dataRoot, "--disable-gpu"], timeout: 60_000}));
    const originalClose = app.close.bind(app); let closeFlight: Promise<void> | undefined;
    app.close = () => closeFlight ??= originalClose();
    const page = await app.firstWindow({timeout: 60_000});
    readRuntimeFailure = () => page.evaluate(async () => {
      const reply = await (window as any).desktopApi.readPythonRuntimeStatus();
      if (!reply.ok) return {available: false};
      const value = reply.value, detail = value.startupDiagnostics;
      // The bridge validates these finite enums. Never return runtime logs,
      // executable/model paths, loaded models or arbitrary error messages.
      return {available: true, supervisorStatus: value.supervisorStatus, healthy: value.healthy,
        startup: detail ? {attempt: detail.attempt, outcome: detail.outcome, phase: detail.phase, reason: detail.reason,
          stages: detail.stages.slice(-3).map((stage: any) => ({operation: stage.operation, stage: stage.stage, phase: stage.phase}))} : undefined};
    });
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

    await runHeadlessContextWorkflow({page, workspace, call: (name, input) => call(client!, name, input),
      openSettings: () => settings(app!, page), dataButtonLabel: "Data", facts, revokedContextCodes: ["headless.forbidden"],
      reportStage: value => {phase = value;}, onWorkerStart: () => {workerStarted = true;},
      connectPresentation: async () => {
        region = await settings(app!, page);
        await installPairingDialogDriver(app!, true, "presentation");
        await region.getByRole("button", {name: "Pair a client that can request window control", exact: true}).click();
        display = await connectMcp(address, fingerprint, await exchangePairing(address, fingerprint, await takePairingCode(app!)), undefined, "presentation");
        return (name, input) => call(display!, name, input);
      }});
    journeyPassed = true;
  } catch (error) {
    failures.push(error);
    try { runtimeFailure = await readRuntimeFailure?.(); } catch { runtimeFailure = {available: false}; }
  }
  finally {
    try { await Promise.all([client?.close(), display?.close()]); } catch (error) { failures.push(error); }
    try {
      if (app && workerStarted) {
        const outcome = await closeDesktopAndQualifyOwnedWorkers(app, model.cache, test.info());
        if (journeyPassed) {
          expect(outcome.physicalWorkersObserved).toBe(1);
          expect(outcome.physicalWorkersNativeObserved).toBeGreaterThan(0);
          expect(outcome.physicalWorkersNativeObserved).toBe(outcome.physicalWorkersObserved);
          expect(outcome.physicalWorkersPidAbsenceObserved).toBe(0);
        }
        cleanupPassed = outcome.status === "passed";
      }
    } catch (error) { failures.push(error); }
    try { await lifetime.retire(); } catch (error) { failures.push(error); }
    try { startupFailures = await readContextFixtureStartupFailures(root, profile.dataRoot); } catch (error) { failures.push(error); }
    const observation = {
      schemaVersion: "headless-context-desktop-observation-v2", sourceRevision: process.env.VISUAL_COMPOSER_QUALIFICATION_SOURCE_REVISION,
      endpointProfile, journeyPassed, cleanupPassed, phase, facts, failures: failures.map(safeQualificationFailureType), startupFailures, runtimeFailure,
      model: "pinned-installed-MiniLM", worker: "unchanged-packaged-main",
      managedHost: "pending", physicalFailedBuild: facts.failedBuildObserved && facts.failedBuildReplayed && facts.savedContextPreservedAfterFailure ? "observed" : "pending", parentQualification: "pending"};
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
