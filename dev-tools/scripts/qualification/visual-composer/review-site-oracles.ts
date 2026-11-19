import { createHash } from "node:crypto";
import { types } from "node:util";

export const REVIEW_SITE_ORIGIN = "http://127.0.0.1:8766";
export const REVIEW_SITE_BROWSER_TIMEOUT_MS = 90_000;
export const REVIEW_SITE_READ_TIMEOUT_MS = 15_000;
export const REVIEW_SITE_MAX_BYTES = 2 * 1024 * 1024;
export const REVIEW_SITE_WORK_ITEM_FORMAT = "roadmap-chunk-refs-v1";
export const REVIEW_SITE_TARGET = Object.freeze({ roadmapId: "comprehensive-ui-automation", incrementId: "operational-ui-and-coverage-qualification" });
export const REVIEW_SITE_FIRST_PAGE = "/api/review?view=roadmaps&page=1";
export const REVIEW_SITE_TARGET_PAGE = `${REVIEW_SITE_FIRST_PAGE}&roadmap=${REVIEW_SITE_TARGET.roadmapId}`;
export const REVIEW_SITE_SECURITY_HEADERS = Object.freeze({
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
  "content-security-policy": "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  "cross-origin-resource-policy": "same-origin",
});
const INVALID = "The local review browser test input is unavailable or invalid.";
const routes = new Set(["/", "/api/status", "/api/review", "/app.js", "/style.css", "/favicon.ico"]);
const pageSizes: Readonly<Record<string, number>> = Object.freeze({ roadmaps: 3, work_items: 25, evaluations: 25, feedback: 25 });
function reviewPath(route: unknown): string | null {
  if (typeof route !== "string" || route.length > 512) return null;
  if (routes.has(route)) return route;
  if (!route.startsWith("/api/review?")) return null;
  const values = new Map<string, string>();
  for (const pair of route.slice(12).split("&")) {
    const match = /^(view|page|roadmap|increment|work)=([a-zA-Z0-9._-]{1,80})$/.exec(pair);
    if (!match || values.has(match[1]!)) return null;
    values.set(match[1]!, match[2]!);
  }
  const view = values.get("view"), page = values.get("page");
  if (!view || !Object.hasOwn(pageSizes, view) || !page || !/^[1-9][0-9]{0,6}$/.test(page) || Number(page) > 1000000
    || values.has("increment") && (view !== "work_items" || !values.has("roadmap"))
    || values.has("roadmap") && !["roadmaps", "work_items"].includes(view)
    || values.has("work") && (view !== "work_items" || values.has("roadmap") || values.has("increment"))
    || ["roadmap", "increment", "work"].some(key => values.has(key) && !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,79}$/.test(values.get(key)!))) return null;
  return "/api/review";
}
const roadmapStatuses = new Set(["discovery", "decision-options", "decision-approval", "roadmap-drafting", "roadmap-review", "ready", "executing", "blocked", "implementation-complete-qualification-pending", "roadmap-ready-to-close", "completed", "complete", "final-approved"]);
const completed = new Set(["completed", "complete", "final-approved"]);
const phases = Object.freeze({
  live: Object.freeze(["server-verified", "canonical-view-opened", "sections-ordered", "criteria-and-support-reviewed", "linked-work-opened", "parent-returned"]),
  "refresh-recovery": Object.freeze(["server-verified", "canonical-copy-opened", "refresh-observed", "unavailable-safe", "connection-recovered"]),
  "theme-storage": Object.freeze(["server-verified", "dark-default", "light-selected", "preference-reopened", "narrow-keyboard-view", "storage-refusal-usable"]),
});
export type ReviewBrowserCase = keyof typeof phases;
function deny(): never { throw new Error(INVALID); }
function field(value: unknown, key: string): unknown {
  if (!value || typeof value !== "object" || types.isProxy(value) || Object.getPrototypeOf(value) !== Object.prototype) deny();
  const property = Object.getOwnPropertyDescriptor(value, key);
  if (!property || !("value" in property)) deny();
  return property.value;
}
function array(value: unknown, maximum: number): unknown[] {
  if (!Array.isArray(value) || types.isProxy(value) || Object.getPrototypeOf(value) !== Array.prototype) deny();
  const length = Object.getOwnPropertyDescriptor(value, "length")?.value;
  if (!Number.isInteger(length) || length < 0 || length > maximum) deny();
  const result: unknown[] = [];
  for (let index = 0; index < length; index++) {
    const item = Object.getOwnPropertyDescriptor(value, String(index));
    if (!item || !("value" in item)) deny();
    result.push(item.value);
  }
  return result;
}
function id(value: unknown): string {
  if (typeof value !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9._/-]{0,399}$/.test(value)) deny();
  return value;
}
function hash(value: unknown): string {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value)) deny();
  return value;
}
export function reviewRepositoryId(resolvedRoot: string): string {
  if (typeof resolvedRoot !== "string" || !resolvedRoot || resolvedRoot.length > 4096) deny();
  // Match the controller's canonical JSON string, including ensure_ascii and LF.
  const canonical = JSON.stringify(resolvedRoot).replace(/[\u007f-\uffff]/g, character => `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`) + "\n";
  return createHash("sha256").update(canonical).digest("hex");
}
export function allowReviewSiteRequest(method: unknown, address: unknown, hasCredentials = false, redirected = false): boolean {
  if (method !== "GET" || typeof address !== "string" || address.length > 540 || hasCredentials !== false || redirected !== false) return false;
  try {
    const url = new URL(address);
    return url.origin === REVIEW_SITE_ORIGIN && !url.username && !url.password && !url.hash
      && reviewPath(url.pathname + url.search) !== null && url.href === address;
  } catch { return false; }
}
export function reviewRouteHeaders(route: unknown): Readonly<Record<string, string>> {
  const pathname = reviewPath(route); if (pathname === null) deny();
  return Object.freeze({ Accept: "*/*", "Cache-Control": "no-store",
    ...(pathname === "/api/review" ? { "X-Review-Work-Items": REVIEW_SITE_WORK_ITEM_FORMAT } : {}) });
}
export function allowReviewSiteReferenceRequest(route: unknown, representation: unknown): boolean {
  const pathname = reviewPath(route);
  return pathname !== null && (pathname !== "/api/review" || representation === REVIEW_SITE_WORK_ITEM_FORMAT);
}
export function parseReviewSiteJson(bytes: Uint8Array, maximum = REVIEW_SITE_MAX_BYTES): unknown {
  try {
    if (!(bytes instanceof Uint8Array) || !Number.isInteger(maximum) || maximum < 1 || maximum > REVIEW_SITE_MAX_BYTES || bytes.byteLength > maximum) deny();
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch { return deny(); }
}
export function verifyReviewSiteStatus(value: unknown, expectedRepository: string): void {
  hash(expectedRepository);
  if (field(value, "schema_version") !== "development-review-server-v1" || field(value, "repository_id") !== expectedRepository
    || field(value, "port") !== 8766 || !Number.isInteger(field(value, "pid")) || Number(field(value, "pid")) <= 0
    || typeof field(value, "instance_id") !== "string" || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(String(field(value, "instance_id")))) deny();
  hash(field(value, "server_version"));
}
export interface ReviewProjectionFacts {
  readonly sourceDigest: string;
  readonly openIds: readonly string[];
  readonly completedIds: readonly string[];
  readonly roadmapId: string;
  readonly incrementId: string;
  readonly incrementIndex: number;
  readonly chunkWorkIds: readonly string[];
  readonly criterionOutcomes: readonly string[];
  readonly criterionRequirements: readonly (readonly string[])[];
  readonly hasSupport: boolean;
}
export function captureReviewProjection(value: unknown, repositoryId: string): ReviewProjectionFacts {
  if (field(value, "schema_version") !== "development-review-v1" || field(value, "presentation_view") !== "user-v1" || field(value, "repository_id") !== hash(repositoryId)) deny();
  const sourceDigest = hash(field(value, "source_digest")), rows = array(field(value, "roadmaps"), 200), works = array(field(value, "work_items"), 4096);
  if (!rows.length) deny();
  const seen = new Set<string>(), scopes = new Map<string, Set<string>>();
  const roadmaps = rows.map((row, index) => {
    const name = id(field(row, "id")), status = field(row, "status"), created = field(row, "created_at");
    if (seen.has(name) || typeof status !== "string" || !roadmapStatuses.has(status) || typeof created !== "string" || created.length > 80) deny();
    seen.add(name);
    const increments = array(field(row, "increments"), 100);
    const incrementIds = new Set<string>();
    increments.forEach(increment => {
      const incrementId = id(field(increment, "id")); if (incrementIds.has(incrementId)) deny(); incrementIds.add(incrementId);
      const chunks = array(field(increment, "chunks"), 100).map(chunk => id(field(chunk, "id")));
      if (new Set(chunks).size !== chunks.length) deny(); scopes.set(`${name}/${incrementId}`, new Set(chunks));
    });
    return { row, name, status, index, created: Number.isFinite(Date.parse(created)) ? Date.parse(created) : -Infinity, increments };
  });
  const selected = roadmaps.find(row => row.name === REVIEW_SITE_TARGET.roadmapId);
  if (!selected) deny();
  const candidates = selected.increments.map((increment, index) => ({ increment, index })).filter(({ increment }) => array(field(increment, "chunks"), 100).length && array(field(increment, "criteria"), 100).length);
  const current = field(selected.row, "current_increment");
  if (current !== null && current !== "" && (typeof current !== "string" || !selected.increments.some(increment => field(increment, "id") === current))) deny();
  const chosen = candidates.find(({ increment }) => field(increment, "id") === REVIEW_SITE_TARGET.incrementId); if (!chosen) deny();
  const incrementId = id(field(chosen.increment, "id")), expectedChunks = scopes.get(`${selected.name}/${incrementId}`)!;
  const workIds = new Set<string>(), selectedWork: string[] = [];
  for (const work of works) {
    const name = id(field(work, "id")); if (workIds.has(name)) deny(); workIds.add(name);
    if (Object.getOwnPropertyDescriptor(work as object, "source")?.value !== "roadmap-chunk") continue;
    const roadmap = id(field(work, "roadmap_id")), increment = id(field(work, "increment_id")), chunk = id(field(work, "chunk_id"));
    if (!scopes.get(`${roadmap}/${increment}`)?.has(chunk) || name !== `${roadmap}/${increment}/${chunk}`) deny();
    if (roadmap === selected.name && increment === incrementId) selectedWork.push(name);
  }
  if (Object.getOwnPropertyDescriptor(value as object, "pagination")) {
    if (works.length) deny();
    selectedWork.push(...[...expectedChunks].map(chunk => `${selected.name}/${incrementId}/${chunk}`));
  }
  if (selectedWork.length !== expectedChunks.size) deny();
  const criteria = array(field(chosen.increment, "criteria"), 100), criterionIds = new Set<string>(); let hasSupport = false;
  const criterionRequirements = criteria.map(criterion => {
    const instructions = field(criterion, "user_instructions");
    if (field(instructions, "owner") !== "agent") deny();
    for (const key of ["next_action", "completion_proof"]) {
      const text = field(instructions, key); if (typeof text !== "string" || !text.trim() || Array.from(text).length > 2000) deny();
    }
    let count = 0;
    const flatten = (input: unknown, depth = 1): string[] => {
      if (depth > 3) deny(); const nodes = array(input, 64); if (!nodes.length) deny();
      return nodes.flatMap(node => {
        const text = field(node, "text");
        if (++count > 64 || typeof text !== "string" || !text.trim() || Array.from(text).length > 1500 || Reflect.ownKeys(node as object).some(key => key !== "text" && key !== "children")) deny();
        const child = Object.getOwnPropertyDescriptor(node as object, "children");
        if (child && !("value" in child)) deny();
        return [text, ...(child ? flatten(child.value, depth + 1) : [])];
      });
    };
    return Object.freeze(flatten(field(criterion, "requirements")));
  });
  const criterionOutcomes = criteria.map(criterion => {
    const name = id(field(criterion, "id")), outcome = field(criterion, "outcome");
    if (criterionIds.has(name) || !["passed", "failed", "pending", "missing"].includes(String(outcome))) deny(); criterionIds.add(name);
    const support = Object.getOwnPropertyDescriptor(criterion as object, "supporting_work")?.value;
    if (support !== undefined && array(support, 100).length) hasSupport = true;
    const evaluated = Object.getOwnPropertyDescriptor(criterion as object, "evaluation_mode")?.value;
    return outcome === "missing" ? "qualification not recorded" : outcome === "pending" && evaluated ? "technical check pending" : String(outcome);
  });
  const ordered = [...roadmaps].sort((left, right) => right.created - left.created || left.index - right.index);
  return Object.freeze({ sourceDigest, openIds: Object.freeze(ordered.filter(row => !completed.has(row.status)).map(row => row.name)), completedIds: Object.freeze(ordered.filter(row => completed.has(row.status)).map(row => row.name)), roadmapId: selected.name, incrementId, incrementIndex: chosen.index, chunkWorkIds: Object.freeze(selectedWork), criterionOutcomes: Object.freeze(criterionOutcomes), criterionRequirements: Object.freeze(criterionRequirements), hasSupport });
}
export function reviewRouteMaximum(route: string): number {
  const pathname = reviewPath(route); if (pathname === null) deny();
  return pathname === "/api/review" ? REVIEW_SITE_MAX_BYTES : ["/api/status", "/favicon.ico"].includes(pathname) ? 4096 : 512 * 1024;
}
export function captureReviewPage(value: unknown, repositoryId: string, route: string): void {
  if (reviewPath(route) !== "/api/review" || !route.includes("?") || field(value, "schema_version") !== "development-review-v1"
    || field(value, "presentation_view") !== "user-v1" || field(value, "repository_id") !== hash(repositoryId)
    || field(value, "work_item_format") !== REVIEW_SITE_WORK_ITEM_FORMAT) deny();
  hash(field(value, "source_digest"));
  hash(field(value, "disclosure_digest"));
  const requested = new URL(route, REVIEW_SITE_ORIGIN).searchParams, p = field(value, "pagination"), view = requested.get("view")!;
  const count = (input: unknown): number => { if (!Number.isSafeInteger(input) || Number(input) < 0 || Number(input) > 3000000) deny(); return Number(input); };
  const total = count(field(p, "total_records")), pages = Math.max(1, Math.ceil(total / pageSizes[view]!)), page = Math.min(Number(requested.get("page")), pages);
  if (Reflect.ownKeys(p as object).length !== 8 || field(p, "view") !== view || field(p, "page_size") !== pageSizes[view]
    || field(p, "total_pages") !== pages || field(p, "page") !== page
    || field(p, "roadmap") !== (requested.get("roadmap") || "") || field(p, "increment") !== (requested.get("increment") || "") || field(p, "work") !== (requested.get("work") || "")) deny();
  const totals = field(value, "totals"); if (Reflect.ownKeys(totals as object).length !== 4) deny();
  for (const key of Object.keys(pageSizes)) {
    const fullCount = count(field(totals, key)), rows = array(field(value, key), key === "roadmaps" ? 3 : 25);
    if (rows.length !== (key === view ? Math.min(pageSizes[view]!, Math.max(0, total - (page - 1) * pageSizes[view]!)) : 0)
      || key === view && (fullCount < total || !requested.has("roadmap") && !requested.has("work") && fullCount !== total)) deny();
    if (key === view && requested.has("roadmap") && rows.some(row => field(row, view === "roadmaps" ? "id" : "roadmap_id") !== requested.get("roadmap")
      || requested.has("increment") && field(row, "increment_id") !== requested.get("increment"))) deny();
    if (key === view && requested.has("work") && rows.some(row => field(row, "id") !== requested.get("work"))) deny();
  }
  const parents = array(field(value, "work_item_roadmaps"), 25), works = array(field(value, "work_items"), 25);
  if (view !== "work_items" && parents.length) deny();
  const index = new Map<string, unknown[]>();
  const parentIds = new Set<string>();
  for (const parent of parents) {
    const name = id(field(parent, "id")), increments = array(field(parent, "increments"), 25);
    if (parentIds.has(name) || !increments.length) deny(); parentIds.add(name);
    const seen = new Set<string>();
    for (const increment of increments) {
      const name = id(field(increment, "id")); if (seen.has(name) || !array(field(increment, "chunks"), 25).length) deny(); seen.add(name);
    }
  }
  for (const parent of parents) for (const increment of array(field(parent, "increments"), 100)) for (const chunk of array(field(increment, "chunks"), 25)) {
    const owner = id(field(parent, "id")), inc = id(field(increment, "id")), piece = id(field(chunk, "id")), name = `${owner}/${inc}/${piece}`;
    if (index.has(name)) deny();
    index.set(name, [name, "roadmap-chunk", owner, inc, piece, field(increment, "number"), field(chunk, "chunk_number"), field(chunk, "created_at")]);
  }
  const fields = ["id", "source", "roadmap_id", "increment_id", "chunk_id", "increment_number", "chunk_number", "created_at"], seen = new Set<string>(), joined = new Set<string>();
  for (const row of works) {
    const name = id(field(row, "id")); if (seen.has(name)) deny(); seen.add(name);
    if (field(row, "source") === "execution" && !index.has(name)) continue;
    const expected = index.get(name); if (!expected || Reflect.ownKeys(row as object).length !== fields.length || fields.some((key, n) => field(row, key) !== expected[n])) deny();
    joined.add(name);
  }
  if (joined.size !== index.size) deny();
}
export function assertReviewRequirementText(expected: readonly string[], observed: readonly string[]): void {
  const left = array(expected, 64), right = array(observed, 64);
  const normalize = (value: unknown) => {
    if (typeof value !== "string" || !value.trim() || Array.from(value).length > 1500) deny();
    return value.trim().replace(/\s+/gu, " ");
  };
  if (!left.length || left.length !== right.length || left.some((value, index) => normalize(value) !== normalize(right[index]))) deny();
}
export function captureReviewSiteReply(route: string, status: unknown, headers: unknown, body: Uint8Array, repositoryId: string, expectedAsset?: Uint8Array) {
  const maximum = reviewRouteMaximum(route);
  const pathname = reviewPath(route)!;
  if (types.isProxy(body) || !(body instanceof Uint8Array) || body.byteLength > maximum || status !== (route === "/favicon.ico" ? 404 : 200)) deny();
  const contentType = route === "/" ? "text/html; charset=utf-8" : route === "/app.js" ? "text/javascript; charset=utf-8" : route === "/style.css" ? "text/css; charset=utf-8" : "application/json; charset=utf-8";
  if (field(headers, "content-type") !== contentType || field(headers, "content-length") !== String(body.byteLength) || Object.getOwnPropertyDescriptor(headers as object, "set-cookie")) deny();
  for (const [key, value] of Object.entries(REVIEW_SITE_SECURITY_HEADERS)) if (field(headers, key) !== value) deny();
  if (["/", "/app.js", "/style.css"].includes(route)) {
    if (!expectedAsset || types.isProxy(expectedAsset) || !(expectedAsset instanceof Uint8Array) || expectedAsset.byteLength > maximum || !Buffer.from(body).equals(Buffer.from(expectedAsset))) deny();
  } else {
    const value = parseReviewSiteJson(body, maximum);
    if (route === "/api/status") verifyReviewSiteStatus(value, repositoryId);
    else if (pathname === "/api/review") { if (route.includes("?")) captureReviewPage(value, repositoryId, route); else captureReviewProjection(value, repositoryId); }
    else if (field(value, "error") !== "review.route-not-found") deny();
  }
  return Object.freeze({ status: Number(status), headers: Object.freeze({ ...REVIEW_SITE_SECURITY_HEADERS, "content-type": contentType, "content-length": String(body.byteLength) }), body: Buffer.from(body) });
}
export function reviewBrowserPhases(kind: ReviewBrowserCase): readonly string[] {
  if (typeof kind !== "string" || !Object.prototype.hasOwnProperty.call(phases, kind)) deny(); return phases[kind];
}
export function reviewBrowserReport(kind: ReviewBrowserCase, observed: readonly string[], failed: boolean, cleanupPassed: boolean) {
  const expected = reviewBrowserPhases(kind), captured = array(observed, expected.length);
  if (typeof failed !== "boolean" || typeof cleanupPassed !== "boolean" || captured.some((phase, index) => phase !== expected[index])) deny();
  const passed = !failed && cleanupPassed && captured.length === expected.length;
  return Object.freeze({ schemaVersion: "review-site-browser-observation-v1", case: kind, status: passed ? "passed" : "failed", phases: Object.freeze([...captured]), cleanupPassed, nextPhase: expected[captured.length], scope: "review-site-browser-ui-only", transport: "bounded-live-loopback-proxy", controlledVariations: kind !== "live", parentQualificationGranted: false });
}
