import assert from "node:assert/strict";
import { readFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { CONTEXT_FIXTURE_FILES, CONTEXT_FIXTURE_MODEL, CONTEXT_FIXTURE_REVISION, contextAcquisitionManifest,
  contextAcquisitionRelative, contextFixtureModelDestination, readContextModelAcquisition } from "../visual-composer/headless-context-fixture";

const relative = ".local-codex/model-qualification/minilm-12345678-1234-1234-1234-123456789abc/acquisition.json";
const manifest = () => ({schema_version: "qualified-model-acquisition-v1", model: CONTEXT_FIXTURE_MODEL,
  revision: CONTEXT_FIXTURE_REVISION, status: "verified", files: Object.entries(CONTEXT_FIXTURE_FILES).map(([name, sha256]) => ({name, sha256, bytes: 10}))});

test("Context installed input accepts only the exact acquisition shape and six pinned safe files", () => {
  assert.equal(contextAcquisitionRelative(relative), relative);
  assert.equal(contextAcquisitionManifest(manifest()).length, 6);
  for (const value of [undefined, "C:/private/acquisition.json", "../" + relative, relative.replace("/acquisition", "/../acquisition"), relative.replaceAll("/", "\\"), relative + ":stream"]) {
    assert.throws(() => contextAcquisitionRelative(value), /fixed installed Context/);
  }
  for (const edit of [(row: any) => row.revision = "changed", (row: any) => row.model = "other/model", (row: any) => row.status = "downloaded",
    (row: any) => row.files.push(row.files[0]), (row: any) => row.files[1] = row.files[0], (row: any) => row.files[0].name = "../config.json",
    (row: any) => row.files[0].sha256 = "f".repeat(64), (row: any) => row.files[0].bytes = 100 * 1024 ** 2 + 1, (row: any) => row.files[0].bytes = 0]) {
    const row = manifest(); edit(row); assert.throws(() => contextAcquisitionManifest(row), /fixed installed Context/);
  }
});

test("Context model destination is only the fresh existing plan-review profile", () => {
  const root = process.cwd(), profile = path.resolve("artifacts/qualification/visual-composer/d/" + "a".repeat(16) + "/desktop/headless-plan-review");
  assert.equal(contextFixtureModelDestination(root, profile), path.join(profile, "unused-model-cache/preinstalled-minilm"));
  for (const value of [root, profile + "/../other", profile.replace("headless-plan-review", "headless-paired"), profile.replace("a".repeat(16), "unknown")]) {
    assert.throws(() => contextFixtureModelDestination(root, value), /fixed installed Context/);
  }
});

test("Context acquisition refuses oversized metadata, unexpected members and wrong physical hashes before seeding", async () => {
  const base = path.resolve(".local-codex/t"); await mkdir(base, {recursive: true});
  const root = await mkdtemp(path.join(base, "context-fixture-"));
  try {
    const file = path.join(root, relative), directory = path.dirname(file); await mkdir(directory, {recursive: true});
    await writeFile(file, " ".repeat(8193));
    await assert.rejects(readContextModelAcquisition(root, relative), /fixed installed Context/);
    await writeFile(file, JSON.stringify(manifest()));
    await assert.rejects(readContextModelAcquisition(root, relative)); // Missing physical files cannot be a positive fixture.
    for (const name of Object.keys(CONTEXT_FIXTURE_FILES)) await writeFile(path.join(directory, name), "0123456789");
    await assert.rejects(readContextModelAcquisition(root, relative), /fixed installed Context/);
    await writeFile(path.join(directory, "unexpected.bin"), "untrusted");
    await assert.rejects(readContextModelAcquisition(root, relative), /fixed installed Context/);
  } finally {
    // Exact directory created above, after all descriptor/stream operations settled.
    assert.equal(path.dirname(root), base); await rm(root, {recursive: true});
  }
});

test("Desktop Context journey retains real package, approvals, pinned model and scoped capture controls", async () => {
  const source = await readFile("dev-tools/scripts/qualification/visual-composer/e2e/headless-context-journey.ts", "utf8");
  for (const required of ["prepareHeadlessDesktopProfile(\"plan-review\")", "headless-dataset-runtime-worker.py", "installPairingDialogDriver",
    "connectMcp", "closeDesktopAndQualifyOwnedWorkers", "lifetime.retire()", "context.generate-pack", "context.generate-rag", "context.save-result", "context.query",
    "aisb_preview_context_rebuild", "show-context-query", "Revoke automation takeover", "test.setTimeout(240_000)"]) assert.ok(source.includes(required), required);
  const registered = await readFile("dev-tools/scripts/qualification/visual-composer/e2e/packaged-desktop-headless.e2e.spec.ts", "utf8");
  assert.ok(registered.includes('test.use({ trace: "off", screenshot: "off", video: "off" })'));
  assert.ok(registered.includes('test("packaged Desktop approves saves queries rebuilds and reveals real Context through MCP", runHeadlessContextDesktopJourney)'));
  assert.ok(registered.includes('import { runHeadlessContextDesktopJourney } from "./headless-context-journey"'));
  assert.ok(registered.includes('if (process.env.VISUAL_COMPOSER_CONTEXT_MODEL_ACQUISITION)'));
  assert.ok(!source.includes("controlled-conversation-runtime-worker"));
  const seed = await readFile("dev-tools/scripts/qualification/visual-composer/headless-context-model-seed.ts", "utf8");
  assert.ok(seed.includes("registerDownloadedModel")); assert.ok(seed.includes("verifyContextFixtureModel"));
  for (const forbidden of ["saveExecutionApproval", "saveHeadless", "saveContext", "getContextStart"]) assert.ok(!seed.includes(forbidden));
  // Guard default helpers against a new context mode that accidentally changes old roots/runtime.
  const shared = await readFile("dev-tools/scripts/qualification/visual-composer/e2e/headless-desktop-fixture.ts", "utf8");
  assert.ok(shared.includes('mode: HeadlessFixturePairing | "window-isolation" = "author"'));
  assert.ok(shared.includes('mode === "conversation" ? "controlled-model-cache" : "unused-model-cache"'));
});
