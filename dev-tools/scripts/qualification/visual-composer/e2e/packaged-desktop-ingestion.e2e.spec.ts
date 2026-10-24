import { expect, test, type TestInfo } from "@playwright/test";
import { _electron as electron, type ElectronApplication } from "playwright";
import { lstat, mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import { prepareIsolatedDesktopCase } from "./isolated-desktop-case";
import { qualifyIngestionSourceJourney } from "./ingestion-source-journey";
import { observeOwnedNativeProcessExit } from "../owned-native-process-exit.mjs";

// File import does not start a model worker. Qualify the main process explicitly;
// the enclosing native operator separately observes the complete job tree.
// Model-task tests retain their stronger, positive worker-shutdown assertions.
async function closeImportedFileDesktop(app: ElectronApplication, dataRoot: string, info: TestInfo, journeyStage: string) {
  const errors: unknown[] = [];
  const started = performance.now();
  let mainPid: number | undefined, launchedPid: number | undefined, mainExitCode: number | undefined;
  let willQuitAcknowledged = false;
  let observer: Awaited<ReturnType<typeof observeOwnedNativeProcessExit>> | undefined;
  const ack = path.join(dataRoot, "qualification-ingestion-will-quit.json");
  try {
    expect(path.isAbsolute(dataRoot)).toBe(true);
    expect(path.resolve(dataRoot).replaceAll("\\", "/")).toContain("/artifacts/qualification/visual-composer/d/");
    expect(await realpath(dataRoot)).toBe(dataRoot);
    expect((await lstat(dataRoot)).isSymbolicLink()).toBe(false);
    expect(await lstat(ack).then(() => true, error => { if (error.code === "ENOENT") return false; throw error; }), "A previous acknowledgment cannot qualify this shutdown").toBe(false);
    launchedPid = app.process().pid;
    const identity = await app.evaluate(() => ({ pid: process.pid, ppid: process.ppid }));
    mainPid = identity.pid;
    expect(identity.ppid).toBe(launchedPid);
    observer = await observeOwnedNativeProcessExit(mainPid);
    expect(await app.evaluate(({ app }, file) => {
      const { writeFileSync } = process.getBuiltinModule("fs");
      app.once("will-quit", () => writeFileSync(file, JSON.stringify({ pid: process.pid, event: "will-quit" }), { flag: "wx" }));
      return process.pid;
    }, ack)).toBe(mainPid);
  } catch (error) { errors.push(error); }
  try { await app.close(); } catch (error) { errors.push(error); }
  try {
    if (!observer) throw new Error("Owned import main process was not admitted.");
    mainExitCode = (await observer.outcome).exitCode;
    expect(mainExitCode).toBe(0);
    const stat = await lstat(ack);
    expect(stat.isSymbolicLink()).toBe(false);
    expect(stat.size).toBeLessThanOrEqual(1024);
    expect(JSON.parse(await readFile(ack, "utf8"))).toEqual({ pid: mainPid, event: "will-quit" });
    willQuitAcknowledged = true;
  } catch (error) { errors.push(error); } finally { await observer?.close(); }
  const report = {
    schemaVersion: "real-ingestion-desktop-shutdown-v1", status: errors.length ? "failed" : "passed",
    sourceRevision: process.env.VISUAL_COMPOSER_QUALIFICATION_SOURCE_REVISION,
    journeyStage, mainPid, launchedPid, mainExitCode, willQuitAcknowledged,
    cleanupMilliseconds: performance.now() - started, failures: errors.length,
    failureTypes: errors.map(error => error instanceof Error ? error.name : "Unknown"),
    modelWorkers: "not-exercised", scope: "Owned main-process shutdown only; complete job-tree retirement is measured separately. No model, native restart or parent qualification.",
  };
  const run = process.env.VISUAL_COMPOSER_QUALIFICATION_RUN_ID!;
  expect(run).toMatch(/^[a-z0-9-]{20,80}$/);
  expect(report.sourceRevision).toMatch(/^source\.[a-f0-9]{64}$/);
  const folder = path.resolve("artifacts/qualification/visual-composer/runs", run, "ingestion-source");
  await mkdir(folder, { recursive: true });
  expect(await realpath(folder)).toBe(folder);
  const body = JSON.stringify(report, null, 2) + "\n";
  expect(Buffer.byteLength(body)).toBeLessThanOrEqual(8192);
  await writeFile(path.join(folder, "desktop-shutdown.json"), body, { flag: "wx" });
  await info.attach("desktop-file-import-shutdown", { body, contentType: "application/json" });
  if (errors.length) throw new AggregateError(errors, "Owned file-import desktop shutdown failed.");
}

test.use({ trace: "off", video: "off", screenshot: "off" });
test("packaged desktop imports distinct multi-chunk files through Add data and retains their source records", async () => {
  test.setTimeout(180_000);
  const isolated = prepareIsolatedDesktopCase("ingestion");
  const app = await electron.launch({ executablePath: process.env.VISUAL_COMPOSER_DESKTOP_EXECUTABLE!, args: [`--user-data-dir=${isolated.dataRoot}`, "--disable-gpu"], env: isolated.env, timeout: 60_000 });
  let stage = "startup";
  let journeyError: unknown, shutdownError: unknown;
  try {
    const page = await app.firstWindow({ timeout: 60_000 });
    await expect(page.getByRole("heading", { name: "Create a Workspace", exact: true })).toBeVisible({ timeout: 60_000 });
    stage = "workspace";
    await page.getByRole("button", { name: "Create new workspace", exact: true }).click();
    await page.locator('input[name="workspaceName"]').fill("Synthetic desktop file import");
    await page.getByRole("button", { name: "Create workspace", exact: true }).click();
    await expect(page.getByLabel("Select current workspace")).toHaveValue(/^workspace\./);
    await page.getByRole("button", { name: "Data", exact: true }).click();
    stage = "file-import";
    await qualifyIngestionSourceJourney(page, test.info(), "desktop");
    stage = "complete";
  } catch (error) { journeyError = error; }
  try { await closeImportedFileDesktop(app, isolated.dataRoot, test.info(), stage); }
  catch (error) { shutdownError = error; }
  // A cleanup error must never replace the original product/journey failure.
  if (journeyError && shutdownError) throw new AggregateError([journeyError, shutdownError], `Desktop file import failed at ${stage}, and shutdown also failed.`);
  if (journeyError) throw journeyError;
  if (shutdownError) throw shutdownError;
});
