import {expect,type TestInfo} from "@playwright/test";
import type {ElectronApplication} from "playwright";
import {lstat,mkdir,readFile,realpath,writeFile} from "node:fs/promises";
import path from "node:path";
import {observeOwnedNativeProcessExit} from "../owned-native-process-exit.mjs";
import {readCriticalAccessibilityMode,type CriticalAccessibilityMode} from "../technical-accessibility-observation";
import {finalizeQualificationEvidence,safeQualificationFailureType,type OwnedCleanupFailureStage} from "../qualification-reporting";

export type ImportedFileJourneyStage = "startup" | "workspace" | "file-import" | "complete";

// File import does not start a model worker. This is the existing main-only
// shutdown proof; the enclosing native operator separately observes its tree.
export async function closeImportedFileDesktop(app: ElectronApplication, dataRoot: string, info: TestInfo, journeyStage: ImportedFileJourneyStage, mode: CriticalAccessibilityMode = "standard") {
  readCriticalAccessibilityMode(mode);
  if (!["startup","workspace","file-import","complete"].includes(journeyStage)) throw new Error("Unsupported file-import cleanup stage.");
  if (info?.project?.name !== "packaged-desktop") throw new Error("Unsupported file-import cleanup host.");
  const errors: unknown[] = [];
  const failureStages: OwnedCleanupFailureStage[] = [];
  const recordFailure = (stage: OwnedCleanupFailureStage, error: unknown) => {failureStages.push(stage);errors.push(error);};
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
    expect(Number.isInteger(launchedPid)&&launchedPid!>0&&launchedPid!<=0xffffffff).toBe(true);
    const identity = await app.evaluate(() => ({ pid: process.pid, ppid: process.ppid }));
    mainPid = identity.pid;
    expect(Number.isInteger(mainPid)&&mainPid!>0&&mainPid!<=0xffffffff&&Number.isInteger(identity.ppid)&&identity.ppid>0&&identity.ppid<=0xffffffff).toBe(true);
    expect(mainPid===launchedPid||identity.ppid===launchedPid).toBe(true);
    observer = await observeOwnedNativeProcessExit(mainPid!,{rootPid:launchedPid!});
    expect(observer.admission.parentPid).toBe(identity.ppid);
    expect(await app.evaluate(({ app }, file) => {
      const { writeFileSync } = process.getBuiltinModule("fs");
      app.once("will-quit", () => writeFileSync(file, JSON.stringify({ pid: process.pid, event: "will-quit" }), { flag: "wx" }));
      return process.pid;
    }, ack)).toBe(mainPid);
  } catch (error) { recordFailure("admission",error); }
  try { await app.close(); } catch (error) { recordFailure("app-close",error); }
  try {
    if (!observer) throw new Error("Owned import main process was not admitted.");
    mainExitCode = (await observer.outcome).exitCode;
    expect(mainExitCode).toBe(0);
    const stat = await lstat(ack);
    expect(stat.isSymbolicLink()).toBe(false);
    expect(stat.size).toBeLessThanOrEqual(1024);
    expect(JSON.parse(await readFile(ack, "utf8"))).toEqual({ pid: mainPid, event: "will-quit" });
    willQuitAcknowledged = true;
  } catch (error) { recordFailure("main-exit",error); } finally { try { await observer?.close(); } catch (error) { recordFailure("observer-close",error); } }
  const report = {
    schemaVersion: "real-ingestion-desktop-shutdown-v1", status: errors.length ? "failed" : "passed",
    sourceRevision: process.env.VISUAL_COMPOSER_QUALIFICATION_SOURCE_REVISION,
    journeyStage, mainPid, launchedPid, mainExitCode, willQuitAcknowledged,
    cleanupMilliseconds: performance.now() - started, failures: errors.length,
    failureTypes: errors.map(safeQualificationFailureType), failureStages,
    modelWorkers: "not-exercised", scope: "Owned main-process shutdown only; complete job-tree retirement is measured separately. No model, native restart or parent qualification.",
  };
  const run = process.env.VISUAL_COMPOSER_QUALIFICATION_RUN_ID!;
  const serialize = () => {
    expect(run).toMatch(/^[a-z0-9-]{20,80}$/);
    expect(report.sourceRevision).toMatch(/^source\.[a-f0-9]{64}$/);
    const body = JSON.stringify(report, null, 2) + "\n";
    expect(Buffer.byteLength(body)).toBeLessThanOrEqual(8192);
    return body;
  };
  try {
    await finalizeQualificationEvidence(report, errors, async () => {
      const body = serialize();
      const folder = path.resolve("artifacts/qualification/visual-composer/runs", run, "ingestion-source");
      await mkdir(folder, { recursive: true }); expect(await realpath(folder)).toBe(folder);
      await writeFile(path.join(folder, mode === "native400" ? "desktop-shutdown-native400.json" : "desktop-shutdown.json"), body, { flag: "wx" });
    }, () => info.attach("desktop-file-import-shutdown", { body: serialize(), contentType: "application/json" }));
  } catch (error) {
    throw new AggregateError(error instanceof AggregateError ? error.errors : [error], "Owned file-import desktop shutdown failed.");
  }
}
