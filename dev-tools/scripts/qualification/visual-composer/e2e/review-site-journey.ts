import { expect, type BrowserContext, type Page, type Route, type TestInfo } from "@playwright/test";
import { createHash } from "node:crypto";
import { readFileSync, realpathSync } from "node:fs";
import { get, type ClientRequest } from "node:http";
import path from "node:path";
import { allowReviewSiteRequest, assertReviewRequirementText, captureReviewProjection, captureReviewSiteReply, parseReviewSiteJson, REVIEW_SITE_MAX_BYTES, REVIEW_SITE_ORIGIN, REVIEW_SITE_READ_TIMEOUT_MS, REVIEW_SITE_SECURITY_HEADERS, reviewBrowserPhases, reviewBrowserReport, reviewRepositoryId, verifyReviewSiteStatus, type ReviewBrowserCase } from "../review-site-oracles";

const unavailable = () => new Error("The local review browser test prerequisite is unavailable.");
// Node's direct HTTP client has no ambient proxy/cookie/redirect behavior. Stop
// the stream at its bound instead of buffering an arbitrary API response first.
interface ReadOwner { signal: AbortSignal; requests: Map<ClientRequest, Promise<void>>; }
async function readReviewRoute(route: string, maximum: number, owner: ReadOwner, repositoryId: string, expectedAsset?: Uint8Array): Promise<ReturnType<typeof captureReviewSiteReply>> {
  if (!allowReviewSiteRequest("GET", REVIEW_SITE_ORIGIN + route) || maximum < 1 || maximum > REVIEW_SITE_MAX_BYTES) throw unavailable();
  return new Promise((resolve, reject) => {
    let settled = false, size = 0; const chunks: Buffer[] = [];
    const fail = () => { if (!settled) { settled = true; clearTimeout(timer); reject(unavailable()); } };
    const request = get({ hostname: "127.0.0.1", port: 8766, path: route, method: "GET", agent: false, signal: owner.signal, maxHeaderSize: 16 * 1024, headers: { Accept: "*/*", "Cache-Control": "no-store" } }, response => {
      const length = response.headers["content-length"];
      if (response.statusCode !== (route === "/favicon.ico" ? 404 : 200) || response.headers["set-cookie"] || length === undefined || !/^\d+$/.test(length) || Number(length) > maximum) { response.destroy(); request.destroy(); fail(); return; }
      response.on("data", (chunk: Buffer) => {
        size += chunk.length;
        if (size > maximum) { response.destroy(); request.destroy(); fail(); }
        else chunks.push(Buffer.from(chunk));
      });
      response.once("aborted", fail); response.once("error", fail);
      response.once("end", () => {
        if (settled) return;
        try {
          if (Number(length) !== size) throw unavailable();
          const headers = Object.fromEntries([...Object.keys(REVIEW_SITE_SECURITY_HEADERS), "content-type", "content-length"].map(key => [key, response.headers[key]]));
          const admitted = captureReviewSiteReply(route, response.statusCode, headers, Buffer.concat(chunks, size), repositoryId, expectedAsset);
          settled = true; clearTimeout(timer); resolve(admitted);
        } catch { fail(); }
      });
    });
    const timer = setTimeout(() => { request.destroy(); fail(); }, REVIEW_SITE_READ_TIMEOUT_MS);
    owner.requests.set(request, new Promise<void>(closed => request.once("close", () => { owner.requests.delete(request); closed(); })));
    request.once("error", fail);
  });
}

export async function qualifyReviewSiteBrowser(page: Page, info: TestInfo, kind: ReviewBrowserCase): Promise<void> {
  const observed: string[] = [], expected = reviewBrowserPhases(kind);
  let context: BrowserContext | undefined, listening = false, closing = false, repositoryId = "";
  const controller = new AbortController(), owner: ReadOwner = { signal: controller.signal, requests: new Map() };
  const pending = new Set<Promise<ReturnType<typeof captureReviewSiteReply>>>(), frozenAssets = new Map<string, Buffer>();
  async function read(route: string, maximum: number) {
    if (closing || !repositoryId) throw unavailable();
    const operation = readReviewRoute(route, maximum, owner, repositoryId, frozenAssets.get(route)); pending.add(operation);
    try { return await operation; } finally { pending.delete(operation); }
  }
  let failed = false, cleanupPassed = true, denied = false, requestCount = 0, scriptFailed = false;
  let fixtureBody: string | undefined, fixtureUnavailable = false;
  const scriptError = () => { scriptFailed = true; };
  const guard = async (route: Route) => {
    try {
      if (closing) { await route.abort(); return; }
      const request = route.request(), headers = request.headers();
      const credential = ["authorization", "proxy-authorization", "cookie"].some(name => Object.prototype.hasOwnProperty.call(headers, name));
      if (++requestCount > 128 || !allowReviewSiteRequest(request.method(), request.url(), credential, request.redirectedFrom() !== null)) { denied = true; await route.abort(); return; }
      if (request.url() === `${REVIEW_SITE_ORIGIN}/api/review` && fixtureBody !== undefined) {
        const body = Buffer.from(fixtureUnavailable ? '{"error":"synthetic-private-review-response"}' : fixtureBody);
        if (body.length > REVIEW_SITE_MAX_BYTES) throw unavailable();
        await route.fulfill({ status: fixtureUnavailable ? 503 : 200, headers: { ...REVIEW_SITE_SECURITY_HEADERS, "content-type": "application/json; charset=utf-8", "content-length": String(body.length) }, body });
      } else {
        const routePath = new URL(request.url()).pathname;
        const maximum = routePath === "/api/review" ? REVIEW_SITE_MAX_BYTES : ["/api/status", "/favicon.ico"].includes(routePath) ? 4096 : 512 * 1024;
        const reply = await read(routePath, maximum);
        if (closing) await route.abort(); else await route.fulfill(reply);
      }
    } catch { if (!closing) denied = true; try { await route.abort(); } catch { /* Failure or owned shutdown is already recorded. */ } }
  };
  async function step(name: string, run: () => Promise<void>) {
    if (name !== expected[observed.length]) throw unavailable();
    await run(); if (denied || scriptFailed || context?.pages().length !== 1) throw unavailable(); observed.push(name);
  }
  try {
    context = await page.context();
    if (info.project.name !== "thin-chrome" || context.pages().length !== 1 || (await context.cookies()).length) throw unavailable();
    page.on("pageerror", scriptError); listening = true; await context.route("**/*", guard);
    let canonical: unknown;
    await step("server-verified", async () => {
      repositoryId = reviewRepositoryId(realpathSync.native(process.cwd()));
      verifyReviewSiteStatus(parseReviewSiteJson((await read("/api/status", 4096)).body, 4096), repositoryId);
      for (const [route, file] of [["/", "index.html"], ["/app.js", "app.js"], ["/style.css", "style.css"]]) {
        const local = readFileSync(path.join("dev-tools/review-site", file!)); frozenAssets.set(route!, Buffer.from(local));
        const actual = await read(route!, 512 * 1024); if (!actual.body.equals(local)) throw unavailable();
      }
      canonical = parseReviewSiteJson((await read("/api/review", REVIEW_SITE_MAX_BYTES)).body);
      captureReviewProjection(canonical, repositoryId);
    });
    const facts = captureReviewProjection(canonical, reviewRepositoryId(realpathSync.native(process.cwd())));
    const roadmapCard = () => page.locator("article.card").filter({ has: page.getByText(facts.roadmapId, { exact: true }) });
    const increment = () => roadmapCard().locator(":scope > details.increment").nth(facts.incrementIndex);
    async function openCanonical() {
      await page.goto(`${REVIEW_SITE_ORIGIN}/`);
      await expect(page.locator("#connection")).toHaveText("Live · JSON connected");
      await expect(page.getByRole("heading", { name: "Roadmaps", exact: true })).toBeVisible();
    }
    if (kind === "live") {
      await step("canonical-view-opened", openCanonical);
      await step("sections-ordered", async () => {
        await expect(page.getByRole("region", { name: "Roadmap status key", exact: true })).toBeVisible();
        await expect(page.locator("#open-roadmaps > article.card > .card-heading .record-id")).toHaveText([...facts.openIds]);
        await expect(page.locator("#completed-roadmaps > article.card > .card-heading .record-id")).toHaveText([...facts.completedIds]);
        expect(await page.locator("#items > section").evaluateAll(rows => rows.map(row => row.id))).toEqual(["", "open-roadmaps", "completed-roadmaps"]);
      });
      await step("criteria-and-support-reviewed", async () => {
        if (await increment().getAttribute("open") === null) await increment().locator(":scope > summary").click();
        const criteria = increment().locator(":scope > ul.criteria > li"); await expect(criteria).toHaveCount(facts.criterionOutcomes.length);
        await expect(criteria.locator(":scope > .status")).toHaveText([...facts.criterionOutcomes]);
        for (let index = 0; index < facts.criterionRequirements.length; index++) {
          const bullets = criteria.nth(index).locator("ul.criterion-requirements li > span");
          await expect.poll(async () => { try { assertReviewRequirementText(facts.criterionRequirements[index]!, await bullets.allTextContents()); return true; } catch { return false; } }).toBe(true);
          for (const bullet of await bullets.all()) await expect(bullet).toBeVisible();
        }
        if (facts.hasSupport) {
          const support = criteria.locator("details.local-support").first(); await support.locator(":scope > summary").click();
          await expect(support.getByText("Reviewed local support at recorded snapshot. Current whole-candidate qualification is not asserted.", { exact: true })).toBeVisible();
        }
      });
      await step("linked-work-opened", async () => {
        await increment().getByRole("button", { name: "View these work items", exact: true }).click();
        await expect(page.getByRole("heading", { name: "Work items", exact: true })).toBeVisible();
        await expect(page.locator("#items > article.card > .card-heading .record-id")).toHaveText([...facts.chunkWorkIds]);
      });
      await step("parent-returned", async () => {
        await page.getByRole("button", { name: "View parent increment", exact: true }).first().click();
        await expect(page.getByRole("heading", { name: "Roadmaps", exact: true })).toBeVisible();
        await expect(increment()).toHaveAttribute("open", ""); await expect(increment().getByRole("heading", { name: "Acceptance criteria", exact: true })).toBeVisible();
      });
    } else if (kind === "refresh-recovery") {
      fixtureBody = JSON.stringify(canonical); if (Buffer.byteLength(fixtureBody) > REVIEW_SITE_MAX_BYTES) throw unavailable();
      await step("canonical-copy-opened", openCanonical);
      await step("refresh-observed", async () => {
        const copy = structuredClone(canonical) as { source_digest: string; roadmaps: { id: string; title: string }[] };
        copy.roadmaps.find(row => row.id === facts.roadmapId)!.title = "Synthetic refreshed review title";
        copy.source_digest = createHash("sha256").update("review-browser-controlled-refresh-v1").digest("hex");
        fixtureBody = JSON.stringify(copy); if (Buffer.byteLength(fixtureBody) > REVIEW_SITE_MAX_BYTES) throw unavailable();
        await page.getByRole("button", { name: "Refresh", exact: true }).click();
        await expect(page.getByRole("heading", { name: "Synthetic refreshed review title", exact: true })).toBeVisible();
      });
      await step("unavailable-safe", async () => {
        fixtureUnavailable = true; await page.getByRole("button", { name: "Refresh", exact: true }).click();
        await expect(page.locator("#connection")).toHaveText("Connection interrupted");
        await expect(page.getByRole("alert")).toHaveText("The local review server is unavailable. Retry, or start it using the documented review-site command.");
        await expect(page.getByText("synthetic-private-review-response", { exact: false })).toHaveCount(0);
      });
      await step("connection-recovered", async () => {
        fixtureUnavailable = false; await page.getByRole("button", { name: "Refresh", exact: true }).click();
        await expect(page.locator("#connection")).toHaveText("Live · JSON connected");
        await expect(page.getByRole("heading", { name: "Synthetic refreshed review title", exact: true })).toBeVisible();
        await expect(page.getByRole("alert")).not.toContainText("The local review server is unavailable.");
      });
    } else {
      await step("dark-default", async () => { await openCanonical(); await expect(page.locator("html")).toHaveAttribute("data-theme", "dark"); });
      await step("light-selected", async () => {
        await page.getByRole("button", { name: "Switch to light mode. Current theme: dark.", exact: true }).click();
        await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
      });
      await step("preference-reopened", async () => { await page.reload(); await expect(page.locator("#connection")).toHaveText("Live · JSON connected"); await expect(page.locator("html")).toHaveAttribute("data-theme", "light"); });
      await step("narrow-keyboard-view", async () => {
        await page.setViewportSize({ width: 390, height: 844 });
        const toggle = page.getByRole("button", { name: "Switch to dark mode. Current theme: light.", exact: true });
        await toggle.focus(); await toggle.press("Enter"); await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
        await page.getByRole("button", { name: /^Work items/ }).click(); await expect(page.getByRole("heading", { name: "Work items", exact: true })).toBeVisible();
      });
      await step("storage-refusal-usable", async () => {
        await page.addInitScript(() => { Object.defineProperty(Storage.prototype, "getItem", { configurable: true, value() { throw new Error("synthetic storage refusal"); } }); Object.defineProperty(Storage.prototype, "setItem", { configurable: true, value() { throw new Error("synthetic storage refusal"); } }); });
        await page.reload(); await expect(page.locator("#connection")).toHaveText("Live · JSON connected");
        await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
        await page.getByRole("button", { name: "Switch to light mode. Current theme: dark.", exact: true }).click(); await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
        await page.getByRole("button", { name: "Refresh", exact: true }).click(); await expect(page.locator("#connection")).toHaveText("Live · JSON connected");
        await expect(page.getByText("synthetic storage refusal", { exact: false })).toHaveCount(0);
      });
    }
  } catch { failed = true; }
  closing = true;
  if (context) { try { await page.goto("about:blank"); } catch { cleanupPassed = false; } }
  controller.abort(); for (const request of owner.requests.keys()) request.destroy();
  let retirementTimer: ReturnType<typeof setTimeout> | undefined;
  const retired = await Promise.race([Promise.allSettled([...pending, ...owner.requests.values()]).then(() => true), new Promise<boolean>(resolve => { retirementTimer = setTimeout(() => resolve(false), 2000); })]);
  clearTimeout(retirementTimer);
  if (!retired || owner.requests.size || pending.size) cleanupPassed = false;
  if (context) { try { await context.unroute("**/*", guard); } catch { cleanupPassed = false; } }
  if (listening) { try { page.off("pageerror", scriptError); } catch { cleanupPassed = false; } }
  if (denied || scriptFailed) failed = true;
  const report = reviewBrowserReport(kind, observed, failed, cleanupPassed);
  try { await info.attach("review-site-browser", { body: JSON.stringify(report), contentType: "application/json" }); }
  catch { throw new Error(`Review browser report could not be saved; primary phase: ${report.nextPhase ?? "all-observed"}; cleanup: ${cleanupPassed ? "confirmed" : "unconfirmed"}.`); }
  if (report.status !== "passed") throw new Error(`Review browser phase did not complete: ${report.nextPhase ?? "owned-cleanup"}.`);
}
