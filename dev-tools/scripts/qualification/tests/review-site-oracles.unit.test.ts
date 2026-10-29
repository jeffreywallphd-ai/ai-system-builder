import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { allowReviewSiteRequest, assertReviewRequirementText, captureReviewProjection, captureReviewSiteReply, parseReviewSiteJson, REVIEW_SITE_MAX_BYTES, REVIEW_SITE_SECURITY_HEADERS, REVIEW_SITE_TARGET, reviewBrowserPhases, reviewBrowserReport, reviewRepositoryId, verifyReviewSiteStatus } from "../visual-composer/review-site-oracles";

import type { Page, TestInfo } from "@playwright/test";
import { qualifyReviewSiteBrowser } from "../visual-composer/e2e/review-site-journey";
const R: string = REVIEW_SITE_TARGET.roadmapId, I: string = REVIEW_SITE_TARGET.incrementId;
const HASH = "a".repeat(64), encode = (value: unknown) => Buffer.from(JSON.stringify(value));
const status = () => ({ schema_version: "development-review-server-v1", repository_id: HASH, port: 8766, pid: 10, instance_id: "11111111-1111-4111-8111-111111111111", server_version: HASH });
const projection = () => ({ schema_version: "development-review-v1", presentation_view: "user-v1", repository_id: HASH, source_digest: HASH,
  roadmaps: [{ id: R, status: "executing", created_at: "2026-01-01T00:00:00Z", current_increment: I, increments: [{ id: I, chunks: [{ id: "piece" }], criteria: [{ id: "check", outcome: "pending", evaluation_mode: "agent", supporting_work: [{ status: "reviewed-local-snapshot" }], user_instructions: { owner: "agent", next_action: "Run the test.", completion_proof: "Saved results pass." }, requirements: [{ text: "First required behavior." }, { text: "Second required behavior.", children: [{ text: "Nested required result." }] }] }] }] },
    { id: "test-closed", status: "completed", created_at: "2026-02-01T00:00:00Z", increments: [] }],
  work_items: [{ id: `${R}/${I}/piece`, source: "roadmap-chunk", roadmap_id: R, increment_id: I, chunk_id: "piece" }] });
test("matches canonical repository strings including Windows slashes, Unicode and LF", () => {
  assert.equal(reviewRepositoryId("C:\\repo"), createHash("sha256").update('"C:\\\\repo"\n').digest("hex"));
  assert.equal(reviewRepositoryId("/repo/é😀"), createHash("sha256").update('"/repo/\\u00e9\\ud83d\\ude00"\n').digest("hex"));
});
test("admits only exact fixed-origin GET routes without credentials or redirects", () => {
  for (const route of ["/", "/api/status", "/api/review", "/app.js", "/style.css", "/favicon.ico"]) assert.equal(allowReviewSiteRequest("GET", `http://127.0.0.1:8766${route}`), true);
  for (const address of ["https://127.0.0.1:8766/", "http://localhost:8766/", "http://127.0.0.1:8767/", "http://user@127.0.0.1:8766/", "http://example.invalid/", "http://127.0.0.1:8766/api/review?x=1", "http://127.0.0.1:8766/#x", "http://127.0.0.1:8766/../api/review", "http://127.0.0.1:8766/private"]) assert.equal(allowReviewSiteRequest("GET", address), false);
  assert.equal(allowReviewSiteRequest("POST", "http://127.0.0.1:8766/"), false);
  assert.equal(allowReviewSiteRequest("GET", "http://127.0.0.1:8766/", true), false);
  assert.equal(allowReviewSiteRequest("GET", "http://127.0.0.1:8766/", false, true), false);
});
test("bounds UTF8/JSON reads and keeps malformed response content out of errors", () => {
  assert.deepEqual(parseReviewSiteJson(encode({ ok: true })), { ok: true });
  for (const bytes of [Buffer.from("synthetic-private-non-json"), Buffer.from([0xff]), Buffer.alloc(REVIEW_SITE_MAX_BYTES + 1)]) assert.throws(() => parseReviewSiteJson(bytes), error => error instanceof Error && !error.message.includes("synthetic-private"));
  assert.throws(() => parseReviewSiteJson(encode({}), REVIEW_SITE_MAX_BYTES + 1));
  assert.throws(() => parseReviewSiteJson(encode({}), 0));
});
test("denies a wrong server identity or malformed status without invoking accessors", () => {
  verifyReviewSiteStatus(status(), HASH);
  for (const change of [{ repository_id: "b".repeat(64) }, { port: 8767 }, { schema_version: "other" }, { pid: 0 }, { instance_id: "private" }, { server_version: "unbound" }]) assert.throws(() => verifyReviewSiteStatus({ ...status(), ...change }, HASH));
  let reads = 0; const accessor = status(); Object.defineProperty(accessor, "pid", { get() { reads++; return 1; } });
  assert.throws(() => verifyReviewSiteStatus(accessor, HASH)); assert.equal(reads, 0);
  assert.throws(() => verifyReviewSiteStatus(new Proxy(status(), {}), HASH));
});
test("captures independent ordered records and linked work without promoting support", () => {
  const input = projection(), facts = captureReviewProjection(input, HASH);
  assert.deepEqual(facts.openIds, [R]); assert.deepEqual(facts.completedIds, ["test-closed"]);
  assert.deepEqual(facts.chunkWorkIds, [`${R}/${I}/piece`]); assert.deepEqual(facts.criterionOutcomes, ["technical check pending"]); assert.equal(facts.hasSupport, true);
  assert.deepEqual(facts.criterionRequirements, [["First required behavior.", "Second required behavior.", "Nested required result."]]);
  input.roadmaps[0]!.id = "changed"; input.work_items[0]!.id = "changed";
  assert.equal(facts.roadmapId, R); assert.equal(facts.chunkWorkIds[0], `${R}/${I}/piece`); assert(Object.isFrozen(facts));
});
test("rejects malformed, duplicate, foreign and missing required canonical records", () => {
  const mutations = [
    (p: ReturnType<typeof projection>) => { p.schema_version = "other"; },
    (p: ReturnType<typeof projection>) => { p.repository_id = "b".repeat(64); },
    (p: ReturnType<typeof projection>) => { p.roadmaps[0]!.status = "fake-complete"; },
    (p: ReturnType<typeof projection>) => { p.roadmaps.push(p.roadmaps[0]!); },
    (p: ReturnType<typeof projection>) => { p.work_items[0]!.roadmap_id = "foreign"; },
    (p: ReturnType<typeof projection>) => { p.work_items[0]!.chunk_id = "missing"; },
    (p: ReturnType<typeof projection>) => { p.roadmaps[0]!.id = "other-roadmap"; p.work_items[0]!.roadmap_id = "other-roadmap"; p.work_items[0]!.id = `other-roadmap/${I}/piece`; },
    (p: ReturnType<typeof projection>) => { p.roadmaps[0]!.increments[0]!.id = "other-increment"; p.roadmaps[0]!.current_increment = "other-increment"; p.work_items[0]!.increment_id = "other-increment"; p.work_items[0]!.id = `${R}/other-increment/piece`; },
    (p: ReturnType<typeof projection>) => { p.roadmaps[0]!.current_increment = "foreign-current"; },
    (p: ReturnType<typeof projection>) => { Reflect.deleteProperty(p.roadmaps[0]!, "current_increment"); },
    (p: ReturnType<typeof projection>) => { p.work_items = []; },
    (p: ReturnType<typeof projection>) => { p.work_items.push(p.work_items[0]!); },
    (p: ReturnType<typeof projection>) => { p.roadmaps = Array.from({ length: 201 }, () => p.roadmaps[0]!); },
  ];
  for (const mutate of mutations) { const input = projection(); mutate(input); assert.throws(() => captureReviewProjection(input, HASH)); }
  const input = projection(); let reads = 0; Object.defineProperty(input.work_items, "0", { get() { reads++; return {}; } });
  assert.throws(() => captureReviewProjection(input, HASH)); assert.equal(reads, 0);
});
test("reports only closed phase labels; failed, incomplete and cleanup failures never pass", () => {
  for (const kind of ["live", "refresh-recovery", "theme-storage"] as const) {
    const expected = reviewBrowserPhases(kind); const full = reviewBrowserReport(kind, [...expected], false, true);
    assert.equal(full.status, "passed"); assert.equal(full.parentQualificationGranted, false);
    assert.equal(reviewBrowserReport(kind, expected.slice(0, 1), false, true).status, "failed");
    assert.equal(reviewBrowserReport(kind, [...expected], true, true).status, "failed");
    assert.equal(reviewBrowserReport(kind, [...expected], false, false).status, "failed");
    assert.throws(() => reviewBrowserReport(kind, ["synthetic-private-error"], true, false));
    assert.throws(() => reviewBrowserReport(kind, [...expected, expected[0]!], false, true));
  }
});

test("checks every required bullet in order, including later and nested requirements", () => {
  const expected = captureReviewProjection(projection(), HASH).criterionRequirements[0]!;
  assertReviewRequirementText(expected, [...expected]);
  assertReviewRequirementText(["A  spaced requirement."], [" A spaced\nrequirement. "]);
  for (const observed of [[expected[0]!], expected.slice(0, 2), [...expected].reverse(), [expected[0]!, "Changed behavior.", expected[2]!]]) assert.throws(() => assertReviewRequirementText(expected, observed));
});
test("admits exact bounded live replies and denies changed assets or weakened headers", () => {
  const body = Buffer.from("synthetic asset"), headers = { ...REVIEW_SITE_SECURITY_HEADERS, "content-type": "text/javascript; charset=utf-8", "content-length": String(body.length) };
  const admitted = captureReviewSiteReply("/app.js", 200, headers, body, HASH, body);
  assert.deepEqual(admitted.body, body); body[0] = 0; assert.notDeepEqual(admitted.body, body);
  assert.throws(() => captureReviewSiteReply("/app.js", 200, headers, body, HASH, admitted.body));
  assert.throws(() => captureReviewSiteReply("/app.js", 302, headers, admitted.body, HASH, admitted.body));
  for (const change of [{ "content-security-policy": "default-src *" }, { "content-length": "0" }, { "content-type": "text/plain" }, { "set-cookie": "synthetic-private-cookie" }]) assert.throws(() => captureReviewSiteReply("/app.js", 200, { ...headers, ...change }, admitted.body, HASH, admitted.body));
  assert.throws(() => captureReviewSiteReply("/api/review", 200, headers, Buffer.alloc(REVIEW_SITE_MAX_BYTES + 1), HASH));
  const bytes = encode(projection()), jsonHeaders = { ...REVIEW_SITE_SECURITY_HEADERS, "content-type": "application/json; charset=utf-8", "content-length": String(bytes.length) };
  assert.equal(captureReviewSiteReply("/api/review", 200, jsonHeaders, bytes, HASH).status, 200);
  assert.throws(() => captureReviewSiteReply("/api/review", 200, jsonHeaders, bytes, "b".repeat(64)));
});
test("redacts initial Page-port sync and async failures, including falsy rejection reasons", async () => {
  for (const reason of [new Error("synthetic-private-page-context"), undefined, null, false, 0, ""]) {
    for (const asynchronous of [false, true]) {
      const reports: { status: string; phases: string[]; cleanupPassed: boolean }[] = [];
      const page = { context: () => { if (asynchronous) return Promise.reject(reason); throw reason; } } as unknown as Page;
      const info = { project: { name: "thin-chrome" }, attach: async (_name: string, attachment: { body: string }) => { reports.push(JSON.parse(attachment.body)); } } as unknown as TestInfo;
      await assert.rejects(qualifyReviewSiteBrowser(page, info, "live"), error => error instanceof Error && error.message === "Review browser phase did not complete: server-verified.");
      assert.equal(reports.length, 1); assert.equal(reports[0]!.status, "failed"); assert.deepEqual(reports[0]!.phases, []); assert.equal(reports[0]!.cleanupPassed, true);
      assert(!JSON.stringify(reports).includes("synthetic-private"));
    }
  }
});
test("retains fixed primary and cleanup facts when report publication also fails", async () => {
  const page = { context: () => ({ pages: () => [page], cookies: async () => [], unroute: async () => {} }), goto: async () => { throw new Error("synthetic-private-cleanup"); } } as unknown as Page;
  const info = { project: { name: "unsupported" }, attach: async () => { throw undefined; } } as unknown as TestInfo;
  await assert.rejects(qualifyReviewSiteBrowser(page, info, "live"), error => error instanceof Error && error.message === "Review browser report could not be saved; primary phase: server-verified; cleanup: unconfirmed.");
});
test("refuses an unknown case before key coercion, Page reads or report callbacks", async () => {
  let coerced = 0, pageReads = 0, callbacks = 0;
  const kind = { [Symbol.toPrimitive]() { coerced++; throw new Error("synthetic-private-case-coercion"); } } as never;
  const page = { context: () => { pageReads++; throw undefined; } } as unknown as Page;
  const info = { attach: async () => { callbacks++; } } as unknown as TestInfo;
  await assert.rejects(qualifyReviewSiteBrowser(page, info, kind), error => error instanceof Error && error.message === "The local review browser test input is unavailable or invalid.");
  assert.equal(coerced, 0); assert.equal(pageReads, 0); assert.equal(callbacks, 0);
});
