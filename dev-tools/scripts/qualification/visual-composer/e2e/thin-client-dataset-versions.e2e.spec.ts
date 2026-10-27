import { expect, test } from "@playwright/test";
import { prepareProvidedVersions, verifyProvidedVersionsAfterRestart, resolveProvidedServerRestartMarker } from "./provided-dataset-version-journey";
import { lstat, readFile, realpath } from "node:fs/promises";
import { prepareManualContext, verifyManualContextAfterRestart } from "./manual-context-host-journey";
import { prepareSavedRowReview, verifySavedRowReviewAfterRestart } from "./saved-row-review-host-journey";

test.use({ trace: "off", video: "off", screenshot: "off" });
test.skip(process.env.PYTHON_RUNTIME_QUALIFICATION_SCENARIO !== "dataset-profile" ||
  process.env.PYTHON_RUNTIME_ARGS !== "-I -B ../../../../dev-tools/scripts/qualification/visual-composer/provided-dataset-qualification-worker.py",
  "Requires the separately reviewed real provided-data composition.");
test("browser saves dataset versions and manual Context across full service restart", async ({ page }) => {
  test.setTimeout(300_000);
  await page.addInitScript(token => localStorage.setItem("ai-system-builder.paired-device-token", token), process.env.VISUAL_COMPOSER_THIN_CLIENT_BEARER_TOKEN!);
  await page.goto(new URL("/", process.env.VISUAL_COMPOSER_THIN_CLIENT_ORIGIN!).href);
  await page.getByRole("button", { name: "Create new workspace", exact: true }).click();
  await page.locator('input[name="workspaceName"]').fill("Synthetic provided browser data");
  await page.getByRole("button", { name: "Create workspace", exact: true }).click();
  await expect(page.getByLabel("Select current workspace")).toHaveValue(/^workspace\./);
  await page.getByRole("button", { name: "Artifacts", exact: true }).click();
  const saved = await prepareProvidedVersions(page, "thin");
  const savedRows = await prepareSavedRowReview(page, "thin");
  const savedContext = await prepareManualContext(page, "thin");
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: "Restart server", exact: true }).click();
  // Readiness alone could observe the old listener. Require the fresh second
  // owner record, emitted only after task/listener/persistence close + reopen.
  const marker = await resolveProvidedServerRestartMarker(process.env.VISUAL_COMPOSER_QUALIFICATION_RUN_ID!);
  await expect.poll(async () => {
    try {
      if (await realpath(marker) !== marker) return false;
      const stat = await lstat(marker); if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 1024) return false;
      const value = JSON.parse(await readFile(marker, "utf8"));
      return Object.keys(value).sort().join(",") === "previousResourcesClosed,schemaVersion,sequence,sourceRevision" &&
        value.schemaVersion === "provided-server-session-v1" && value.sequence === 2 && value.previousResourcesClosed === true &&
        value.sourceRevision === process.env.VISUAL_COMPOSER_QUALIFICATION_SOURCE_REVISION;
    } catch { return false; }
  }, { timeout: 60_000 }).toBe(true);
  await expect.poll(async () => {
    try { return (await page.request.get(new URL("/health/live", process.env.VISUAL_COMPOSER_SERVER_ORIGIN!).href)).status(); }
    catch { return 0; }
  }, { timeout: 60_000 }).toBe(200);
  await page.reload();
  await verifyProvidedVersionsAfterRestart(page, "thin", saved, test.info());
  await verifyManualContextAfterRestart(page, "thin", savedContext, test.info());
  await verifySavedRowReviewAfterRestart(page, "thin", savedRows, test.info());
});
