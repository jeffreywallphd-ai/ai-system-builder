import {finalizeQualificationEvidence} from "../qualification-reporting";
import { expect, type Page, type TestInfo } from "@playwright/test";
import { mkdir, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import { qualifyCriticalSurfaceAccessibility } from "./critical-surface-accessibility";
import { readCriticalAccessibilityMode, type CriticalAccessibilityMode } from "../technical-accessibility-observation";
import { INGESTION_TASK_RECOMMENDED_CHUNK_BYTES } from "../../../../../modules/contracts/ingestion";

/** Fixed result identity keeps standard and native cohorts separate. */
export function ingestionSourceEvidenceName(host: "desktop" | "thin", mode: CriticalAccessibilityMode = "standard"): string {
  readCriticalAccessibilityMode(mode);
  if (host !== "desktop" && host !== "thin") throw new Error("Invalid ingestion evidence identity.");
  return `${host}${mode === "native400" ? "-native400" : ""}.json`;
}

// Exercise mounted controls and real host publication. No upload/API success mock,
// model, provider credential or synthetic worker result can satisfy this journey.
export async function qualifyIngestionSourceJourney(page: Page, info: TestInfo, host: "desktop" | "thin", mode: CriticalAccessibilityMode = "standard") {
  readCriticalAccessibilityMode(mode);
  if (mode === "native400" && !((host === "desktop" && info?.project?.name === "packaged-desktop") || (host === "thin" && info?.project?.name === "thin-chrome"))) throw new Error("Unsupported native Data and Context host.");
  const evidenceName = ingestionSourceEvidenceName(host, mode);
  await page.getByRole("tab", { name: "Artifact Ingestion", exact: true }).click();
  const workflow = page.getByRole("list", { name: "Add data workflow", exact: true });
  const input = workflow.getByLabel("Choose one or more files", { exact: true });
  const add = workflow.getByRole("button", { name: "Add data", exact: true });
  for (const secondName of ["ambiguous.csv", " ambiguous.csv"]) {
    await input.setInputFiles([
    { name: "ambiguous.csv", mimeType: "text/csv", buffer: Buffer.from("a,b\n1,2\n") },
    { name: secondName, mimeType: "text/csv", buffer: Buffer.from("c,d\n3,4\n") },
  ]);
  await add.click();
  await expect(workflow.getByRole("alert")).toHaveText(
    "Two selected files have the same name and size. Rename one file and select the files again.",
  );
  await expect(workflow.getByRole("region", { name: "Selected files", exact: true }).getByText("2 files selected", { exact: true })).toBeVisible();
  await expect(add).toBeEnabled();
  }
  await page.evaluate(() => {
    const facts = { wholeFileReads: 0, blobReads: 0, largestSliceBytes: 0, totalSliceBytes: 0, progress: [] as number[] };
    const fileRead = File.prototype.arrayBuffer;
    const blobRead = Blob.prototype.arrayBuffer;
    Object.defineProperty(File.prototype, "arrayBuffer", { configurable: true, value: function(this: File) {
      facts.wholeFileReads++;
      return fileRead.call(this);
    } });
    Object.defineProperty(Blob.prototype, "arrayBuffer", { configurable: true, value: function(this: Blob) {
      facts.blobReads++;
      facts.largestSliceBytes = Math.max(facts.largestSliceBytes, this.size);
      facts.totalSliceBytes += this.size;
      return blobRead.call(this);
    } });
    const observer = new MutationObserver(() => {
      const progress = document.querySelector<HTMLProgressElement>('progress[aria-label="Ingestion progress"]');
      if (progress && facts.progress[facts.progress.length - 1] !== progress.value && facts.progress.length < 256) facts.progress.push(progress.value);
    });
    observer.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ["value"] });
    (window as any).__ingestionReadFacts = facts;
    (window as any).__ingestionObserver = observer;
  });
  const files = [
    { name: "ui-ingestion-large.csv", mimeType: "text/csv", buffer: Buffer.from("instruction,answer\n" + `Summarize the synthetic reference,${"x".repeat(480)}\n`.repeat(16_384)) },
    { name: "ui-ingestion-records.jsonl", mimeType: "application/jsonl", buffer: Buffer.from('{"instruction":"What is two plus two?","answer":"Four."}\n{"instruction":"Name a primary colour.","answer":"Blue."}\n') },
    { name: " ui-ingestion-records.json", mimeType: "application/json", buffer: Buffer.from('[{"instruction":"Name the synthetic sample.","answer":"Example."}]\n') },
  ];
  const totalBytes = files.reduce((sum, file) => sum + file.buffer.byteLength, 0);
  // Desktop labels include a type badge before the exact file name. Locate
  // its label by the exact file-name span, then require its actual checkbox.
  const sourceCheckbox = (name: string) => host === "desktop"
    ? page.locator("label").filter({ has: page.getByText(name.trim(), { exact: true }) }).getByRole("checkbox")
    : page.getByRole("checkbox", { name: name.trim(), exact: true });
  expect(files[0]!.buffer.byteLength).toBeGreaterThan(8 * 1024**2);
  expect(totalBytes).toBeLessThan(9 * 1024**2);
  await input.setInputFiles(files);
  await expect(workflow.getByRole("region", { name: "Selected files", exact: true }).getByText("3 files selected", { exact: true })).toBeVisible();
  await qualifyCriticalSurfaceAccessibility(page, info, "data-ingestion", mode);
  const started = performance.now();
  await add.click();
  const center = page.getByRole("dialog", { name: "Notifications", exact: true });
  await Promise.race([
    center.waitFor({ state: "visible", timeout: 90_000 }),
    workflow.getByRole("alert").waitFor({ state: "visible", timeout: 90_000 }).then(async () => {
      const message = (await workflow.getByRole("alert").innerText()).slice(0, 240);
      // Only the app's bounded public synthetic-fixture error is diagnostic.
      // Never print request bodies, headers, storage, credentials or raw errors.
      const safe = /[A-Za-z]:\\|\/Users\/|authorization|bearer|token=/i.test(message) ? "Public import error." : message;
      throw new Error(`Real Add data import did not complete: ${safe}`);
    }),
  ]);
  await expect(center.locator(".ui-notification__item").filter({ hasText: "All files are ready." })).toHaveCount(1, { timeout: 90_000 });
  await center.getByRole("button", { name: "Close notifications", exact: true }).click();
  await expect(workflow.getByText("0 files selected", { exact: true })).toBeVisible();
  await expect(input).toHaveValue("");
  const facts = await page.evaluate(() => {
    (window as any).__ingestionObserver.disconnect();
    return (window as any).__ingestionReadFacts as {
      wholeFileReads: number; blobReads: number; largestSliceBytes: number; totalSliceBytes: number; progress: number[];
    };
  });
  expect(facts.wholeFileReads).toBe(0);
  expect(facts.largestSliceBytes).toBeLessThanOrEqual(INGESTION_TASK_RECOMMENDED_CHUNK_BYTES);
  expect(facts.totalSliceBytes).toBe(totalBytes);
  expect(facts.blobReads).toBeGreaterThan(8);
  expect(facts.progress.some(value => value > 0 && value < 100)).toBe(true);
  expect(facts.progress.every((value, index) => value >= 0 && value <= 100 && (!index || value >= facts.progress[index - 1]!))).toBe(true);
  await page.getByRole("tab", { name: "Artifact Browser", exact: true }).click();
  for (const file of files) {
    await expect(page.getByRole(host === "desktop" ? "heading" : "button", { name: file.name.trim(), exact: true })).toHaveCount(1, { timeout: 20_000 });
  }
  await expect(page.getByRole(host === "desktop" ? "heading" : "button", { name: "ambiguous.csv", exact: true })).toHaveCount(0);
  await page.getByRole("tab", { name: "Dataset Preparation", exact: true }).click();
  for (const file of files) await expect(sourceCheckbox(file.name)).toHaveCount(1, { timeout: 20_000 });
  const workspace = await page.getByLabel("Select current workspace").inputValue();
  await page.reload();
  await expect(page.getByLabel("Select current workspace")).toHaveValue(workspace, { timeout: 60_000 });
  await page.getByRole("button", { name: host === "desktop" ? "Data" : "Artifacts", exact: true }).click();
  await page.getByRole("tab", { name: "Dataset Preparation", exact: true }).click();
  for (const file of files) await expect(sourceCheckbox(file.name)).toHaveCount(1, { timeout: 20_000 });
  const report = { schemaVersion: "real-ingestion-source-host-journey-v1", host, status: "passed",
    sourceRevision: process.env.VISUAL_COMPOSER_QUALIFICATION_SOURCE_REVISION,
    files: files.length, totalBytes, ...facts, elapsedMilliseconds: performance.now() - started,
    ambiguousSelectionDenied: true, sourceDiscoveryAfterRendererReload: true,
    scope: "Real file controls, host publication, completion and source discovery. Slice sizes do not qualify whole-process RSS, native crash protection, provider/website/scale matrices or parent completion." };
  const run = process.env.VISUAL_COMPOSER_QUALIFICATION_RUN_ID!;
  expect(run).toMatch(/^[a-z0-9-]{20,80}$/);
  expect(report.sourceRevision).toMatch(/^source\.[a-f0-9]{64}$/);
  const folder = path.resolve("artifacts/qualification/visual-composer/runs", run, "ingestion-source");
  await mkdir(folder, { recursive: true });
  expect(await realpath(folder)).toBe(folder);
  const serialize = () => {
    const body = JSON.stringify(report, null, 2) + "\n";
    expect(Buffer.byteLength(body)).toBeLessThanOrEqual(8192);
    return body;
  };
  await finalizeQualificationEvidence(report, [], async () => {
    const body = serialize();
    await writeFile(path.join(folder, evidenceName), body, { flag: "wx" });
  }, () => info.attach("real-ingestion-source-host-journey", { body: serialize(), contentType: "application/json" }));
}
