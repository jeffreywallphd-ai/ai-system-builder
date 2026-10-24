import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { JSDOM } from "jsdom";

test("contributor control plane passes focused behavioral qualification", () => {
  const temporary = path.resolve(".local-codex/t");
  mkdirSync(temporary, { recursive: true });
  const python = process.env.PYTHON ?? (process.platform === "win32" ? "python" : "python3");
  const result = spawnSync(python, ["-B", "-m", "unittest", "discover", "-s", "dev-tools/helpers/tests", "-p", "test_control_plane*.py"], {
    encoding: "utf8", env: { ...process.env, TEMP: temporary, TMP: temporary }, timeout: 180000,
  });
  assert.equal(result.status, 0, `Contributor qualification failed.\n${result.stdout}\n${result.stderr}`);
});

const pause = () => new Promise(resolve => setImmediate(resolve));
const humanIssue = (needed, prevents, action) => ({
  action_owner: "human", summary: "Internal technical summary stays off the page.", prevents, required_action: action,
  plain_language: { needed, prevents, action, responsible_role: "Repository owner", user_action: action,
    done_when: "The agent has checked and recorded the requested result." },
});

test("review notices distinguish bounded history, description maintenance and actual record failures", async () => {
  const dom = new JSDOM(readFileSync("dev-tools/review-site/index.html", "utf8"), { runScripts: "outside-only", url: "http://127.0.0.1:8766" });
  const { window } = dom;
  const response = { schema_version: "development-review-v1", source_digest: "notice", roadmaps: [], work_items: [], evaluations: [], feedback: [], diagnostics: [] };
  window.fetch = async () => ({ ok: true, json: async () => structuredClone(response) });
  window.setInterval = () => 1;
  try {
    window.eval(readFileSync("dev-tools/review-site/app.js", "utf8"));
    await pause();
    const error = window.document.querySelector("#error");
    const limit = { code: "projection.execution-records-truncated", total: 272, shown: 271 };
    response.diagnostics = [limit];
    window.document.querySelector("#refresh").click(); await pause();
    assert.match(error.textContent, /newest 271 of 272.*Older records remain saved.*Your action: None/);
    assert.doesNotMatch(error.textContent, /unavailable|recovery|could not be loaded/);
    response.diagnostics.push({ code: "projection.user-description-unavailable" });
    window.document.querySelector("#refresh").click(); await pause();
    assert.match(error.textContent, /newest 271 of 272.*Some descriptions need an update/);
    response.diagnostics.push({ code: "projection.local-state-unavailable", detail: "synthetic-private-note" });
    window.document.querySelector("#refresh").click(); await pause();
    assert.match(error.textContent, /newest 271 of 272.*Some records are unavailable/);
    for (const malformed of [{ shown: -1, total: 3 }, { shown: 3, total: 2 }, { shown: 2, total: 2 }, { shown: "<img src=x>", total: 3 }, { shown: 0.5, total: 3 }]) {
      response.diagnostics = [{ ...limit, ...malformed }];
      window.document.querySelector("#refresh").click(); await pause();
      assert.match(error.textContent, /Some records are unavailable/);
      assert.doesNotMatch(error.textContent, /newest|<img|synthetic-private-note/);
    }
    response.diagnostics = [];
    window.document.querySelector("#refresh").click(); await pause();
    assert.equal(error.hidden, true);
    assert.equal(error.textContent, "");
    assert.equal(window.document.querySelectorAll("img").length, 0);
  } finally { window.close(); }
});

test("JSON review UI refreshes, navigates and renders hostile text inertly", async () => {
  const html = readFileSync("dev-tools/review-site/index.html", "utf8");
  const script = readFileSync("dev-tools/review-site/app.js", "utf8");
  const dom = new JSDOM(html, { runScripts: "outside-only", url: "http://127.0.0.1:8766" });
  const { window } = dom;
  let response = { schema_version: "development-review-v1", source_digest: "first-fingerprint", roadmaps: [{ id: "fixture", title: "<img src=x onerror=alert(1)>", objective: "A useful outcome", status: "executing", current_increment: "one", increments: [{ id: "one", number: 1, title: "Deliver outcome", objective: "Complete the user task", status: "implementing", chunks_complete: 0, chunks_planned: 1, criteria: [{ id: "works", description: "User can complete the task", outcome: "missing" }] }] }], work_items: [], evaluations: [], feedback: [], diagnostics: [] };
  window.fetch = async () => ({ ok: true, json: async () => structuredClone(response) });
  window.setInterval = () => 1;
  window.eval(script);
  await pause();
  assert.equal(window.document.querySelectorAll("img").length, 0);
  assert.equal(window.document.querySelector(".card-heading h3").textContent, "<img src=x onerror=alert(1)>");
  assert.equal(window.document.querySelector(".increment").open, true);
  response.source_digest = "updated-fingerprint";
  response.roadmaps[0].title = "Updated JSON outcome";
  window.document.querySelector("#refresh").click();
  await pause();
  assert.equal(window.document.querySelector(".card-heading h3").textContent, "Updated JSON outcome");
  window.document.querySelector('[data-view="work_items"]').click();
  assert.match(window.document.querySelector("#items").textContent, /No work items yet/);
  window.fetch = async () => { throw new Error("synthetic-private-detail"); };
  window.document.querySelector("#refresh").click();
  await pause();
  assert.equal(window.document.querySelector("#error").hidden, false);
  assert.doesNotMatch(window.document.body.textContent, /synthetic-private-detail/);
  window.close();
});

test("review work items expose chunk progress, criterion links and parent navigation", async () => {
  const dom = new JSDOM(readFileSync("dev-tools/review-site/index.html", "utf8"), { runScripts: "outside-only", url: "http://127.0.0.1:8766" });
  const { window } = dom;
  const criterion = { id: "works", description: "User completes the task. Safe cleanup remains required.", outcome: "passed", evidence_summary: "Actual criterion evidence",
    requirements: [{ text: "User completes the task." }, { text: "Safe cleanup remains required." }],
    blockers: [humanIssue("Private test access is needed", "The authorized publication test cannot execute", "Configure the approved credential store")] };
  const chunk = { id: "chunk", chunk_number: 1, title: "Implement the journey", outcome: "Recover from an error", status: "planned", is_next: true, criteria_ids: ["works"], completed_at: "", summary: "", tests: [] };
  let response = { schema_version: "development-review-v1", source_digest: "chunk-first", roadmaps: [{ id: "trace", title: "Trace workflow", objective: "Review useful work", status: "executing", evidence_policy: "declarative-legacy", current_increment: "increment", increments: [{ id: "increment", number: 1, title: "Deliver outcome", objective: "Complete the task", status: "implementing", chunks_complete: 0, chunks_planned: 1, chunks: [chunk], criteria: [criterion] }] }], work_items: [{ ...chunk, id: "trace/increment/chunk", source: "roadmap-chunk", roadmap_id: "trace", roadmap_title: "Trace workflow", increment_id: "increment", increment_title: "Deliver outcome", evidence_policy: "declarative-legacy", criteria: [criterion] }], evaluations: [], feedback: [], diagnostics: [] };
  window.fetch = async () => ({ ok: true, json: async () => structuredClone(response) });
  window.setInterval = () => 1;
  try {
    window.eval(readFileSync("dev-tools/review-site/app.js", "utf8"));
    await pause();
    assert.equal(window.document.querySelectorAll(".work-chunk").length, 1);
    assert.match(window.document.querySelector(".work-chunk").textContent, /1 \/ 1 linked criteria passed/);
    assert.match(window.document.querySelector(".work-chunk").textContent, /planned/);
    [...window.document.querySelectorAll("button")].find(b => b.textContent === "View these work items").click();
    assert.equal(window.document.querySelector("h1").textContent, "Work items");
    assert.equal(window.document.querySelectorAll("article").length, 1);
    assert.match(window.document.querySelector("article").textContent, /Trace workflow.*Deliver outcome/);
    assert.equal(window.document.querySelectorAll(".criterion-requirements > li").length, 2);
    assert.match(window.document.querySelector(".criterion-blockers").textContent, /Your action: Configure the approved credential store/);
    assert.equal(window.document.querySelector(".card-heading > .status").textContent, "planned");
    assert.match(window.document.querySelector("article").textContent, /Historical roadmap declaration/);
    [...window.document.querySelectorAll("button")].find(b => b.textContent === "View parent increment").click();
    assert.equal(window.document.querySelector("h1").textContent, "Roadmaps");
    assert.equal(window.document.querySelector(".increment").open, true);
    response.source_digest = "chunk-completed";
    response.work_items[0].status = "completed";
    response.work_items[0].tests = ["Focused verification passed"];
    window.document.querySelector('[data-view="work_items"]').click();
    window.document.querySelector("#refresh").click();
    await pause();
    assert.equal(window.document.querySelector(".card-heading > .status").textContent, "completed");
    assert.match(window.document.querySelector("article").textContent, /Focused verification passed/);
    response.source_digest = "deduplicated-linked-criteria";
    response.work_items[0].criteria = [{ id: "works", outcome: "passed" }];
    window.document.querySelector("#refresh").click();
    await pause();
    assert.equal(window.document.querySelectorAll(".criterion-requirements > li").length, 2);
    assert.match(window.document.querySelector(".criterion-blockers").textContent, /The authorized publication test cannot execute/);
    assert.match(window.document.querySelector("article").textContent, /Actual criterion evidence/);
    response.source_digest = "foreign-parent-rich-legacy-fallback";
    response.work_items[0].roadmap_id = "foreign";
    response.work_items[0].criteria = [{ id: "works", outcome: "passed", description: "Legacy fallback source remains visible." }];
    window.document.querySelector("#refresh").click();
    await pause();
    assert.match(window.document.querySelector(".criterion-requirements").textContent, /Legacy fallback source remains visible/);
    assert.equal(window.document.querySelectorAll(".criterion-blockers").length, 0);
  } finally { window.close(); }
});

test("review support stays separate from qualification and navigates safely", async () => {
  const dom = new JSDOM(readFileSync("dev-tools/review-site/index.html", "utf8"), {
    runScripts: "outside-only", url: "http://127.0.0.1:8766",
  });
  const { window } = dom;
  const support = {
    work_id: "reviewed-component", status: "reviewed-local-snapshot",
    receipt_digest: "a".repeat(64), review_digest: "b".repeat(64),
    scope: "<img src=x onerror=alert(1)>", limitations: ["Reference budget still pending"],
  };
  const criteria = [
    {
      id: "reference-and-accessibility-qualification", title: "Automated reference checks",
      description: "Actual automated qualification", outcome: "pending",
      evaluation_mode: "agent-executable-technical", qualification: "controlled-environment",
      supporting_work: [support, { ...support, work_id: "unverified-component", status: "unverified-support" }],
    },
    { id: "recorded-later", description: "Not yet qualified", outcome: "missing" },
    { id: "failed-check", description: "Failure stays visible", outcome: "failed" },
  ];
  const chunk = {
    id: "chunk", chunk_number: 1, title: "Complete qualification", outcome: "Gather actual proof",
    status: "planned", criteria_ids: criteria.map(c => c.id), tests: [],
  };
  const response = {
    schema_version: "development-review-v1", source_digest: "support-snapshot",
    roadmaps: [{
      id: "trace", title: "Trace support", status: "executing", current_increment: "one",
      increments: [{
        id: "one", number: 1, title: "Qualify outcome", objective: "Preserve evidence authority",
        status: "verifying", chunks_complete: 0, chunks_planned: 1, chunks: [chunk], criteria,
      }],
    }],
    work_items: [{ id: "reviewed-component", title: "Reviewed component", status: "complete" }],
    evaluations: [], feedback: [], diagnostics: [],
  };
  window.fetch = async () => ({ ok: true, json: async () => structuredClone(response) });
  window.setInterval = () => 1;
  try {
    window.eval(readFileSync("dev-tools/review-site/app.js", "utf8"));
    await pause();
    assert.deepEqual(
      [...window.document.querySelectorAll(".criteria > li > .status")].map(e => e.textContent),
      ["technical check pending", "qualification not recorded", "failed"],
    );
    assert.match(window.document.querySelector(".increment").textContent, /0 \/ 1 work chunks · 0 \/ 3 criteria passed/);
    assert.match(window.document.querySelector(".increment").textContent, /1 \/ 3 criteria have reviewed local implementation support/);
    assert.equal(window.document.querySelector(".work-chunk summary .status").textContent, "planned");
    assert.match(window.document.querySelector(".local-support > summary").textContent, /^1 reviewed local work records/);
    assert.match(window.document.querySelector(".local-support").textContent, /unverified support/);
    assert.match(window.document.querySelector(".local-support").textContent, /Current whole-candidate qualification is not asserted/);
    assert.match(window.document.querySelector(".criteria").textContent, /Agent-executable technical check.*Human acceptance is offline/);
    assert.equal(window.document.querySelectorAll("img").length, 0);
    [...window.document.querySelectorAll("button")].find(b => b.textContent === "View supporting work").click();
    assert.equal(window.document.querySelector("h1").textContent, "Work items");
    assert.equal(window.document.querySelector("#search").value, "reviewed-component");
    assert.equal(window.document.querySelectorAll("article").length, 1);
    assert.equal(window.document.querySelector("h2").textContent, "Reviewed component");
    assert.equal(window.document.querySelector(".card-heading > .status").textContent, "completed");
  } finally { window.close(); }
});

test("review groups roadmaps by top-level completion while preserving original creation order", async () => {
  const dom = new JSDOM(readFileSync("dev-tools/review-site/index.html", "utf8"), { runScripts: "outside-only", url: "http://127.0.0.1:8766" });
  const { window } = dom;
  const roadmap = (id, status, created_at, incrementStatus = "completed") => ({
    id, title: id, status, created_at, updated_at: "2099-01-01T00:00:00Z", completed_at: "2099-01-01T00:00:00Z",
    increments: [{ id: "one", number: 1, title: "Keep recorded detail", status: incrementStatus, chunks_complete: 0, chunks_planned: 0, criteria: [] }],
  });
  // The API supplies normalized creation order, including identity ties and undated last.
  // Partitioning must preserve this order; updates and completion dates are irrelevant.
  let response = {
    schema_version: "development-review-v1", source_digest: "section-first",
    roadmaps: [
      roadmap("new-completed", "completed", "2026-10-22T12:00:00.000000Z", "verifying"),
      roadmap("new-open", "executing", "2026-10-22T11:00:00.000000Z"),
      roadmap("tie-a-open", "blocked", "2026-10-21T10:00:00.000000Z"),
      roadmap("tie-b-open", "implementation-complete-qualification-pending", "2026-10-21T10:00:00.000000Z"),
      roadmap("tie-c-complete", "complete", "2026-10-21T10:00:00.000000Z"),
      roadmap("tie-d-final", "final-approved", "2026-10-21T10:00:00.000000Z"),
      roadmap("old-ready", "roadmap-ready-to-close", "2026-10-20T10:00:00.000000Z"),
      roadmap("undated-complete", "completed", null),
      roadmap("undated-open", "ready", null),
    ], work_items: [], evaluations: [], feedback: [], diagnostics: [],
  };
  window.fetch = async () => ({ ok: true, json: async () => structuredClone(response) });
  window.setInterval = () => 1;
  const ids = selector => [...window.document.querySelectorAll(`${selector} .card-heading .record-id`)].map(n => n.textContent);
  try {
    window.eval(readFileSync("dev-tools/review-site/app.js", "utf8"));
    await pause();
    assert.deepEqual([...window.document.querySelectorAll("#items > .roadmap-section > h2")].map(n => n.textContent), ["Open Roadmaps", "Completed Roadmaps"]);
    assert.deepEqual(ids("#open-roadmaps"), ["new-open", "tie-a-open", "tie-b-open", "old-ready", "undated-open"]);
    assert.deepEqual(ids("#completed-roadmaps"), ["new-completed", "tie-c-complete", "tie-d-final", "undated-complete"]);
    assert.deepEqual([...window.document.querySelectorAll("#completed-roadmaps .card-heading > .status")].map(n => n.textContent), ["completed", "completed", "completed", "completed"]);
    assert.doesNotMatch(window.document.querySelector("#items").textContent, /final approved/);
    assert.equal(window.document.querySelector("#open-roadmaps").getAttribute("aria-labelledby"), "open-roadmaps-heading");
    assert.equal(window.document.querySelector("#completed-roadmaps").getAttribute("aria-labelledby"), "completed-roadmaps-heading");
    assert.equal(window.document.querySelectorAll(".card-heading h3").length, 9);
    assert.equal(window.document.querySelectorAll(".increment h4").length, 18);
    assert.match(window.document.querySelector("#completed-roadmaps .increment").textContent, /Keep recorded detail.*verifying/);
    assert.equal(window.document.querySelectorAll(".metric strong")[2].textContent, "4");
    response.roadmaps[1].status = "completed";
    response.source_digest = "section-regrouped";
    window.document.querySelector("#refresh").click();
    await pause();
    assert.deepEqual(ids("#completed-roadmaps"), ["new-completed", "new-open", "tie-c-complete", "tie-d-final", "undated-complete"]);
    assert.deepEqual(ids("#open-roadmaps"), ["tie-a-open", "tie-b-open", "old-ready", "undated-open"]);
    assert.equal(response.roadmaps[1].created_at, "2026-10-22T11:00:00.000000Z");
  } finally { window.close(); }
});

test("roadmap section filtering and empty states preserve navigation and dynamic refresh", async () => {
  const dom = new JSDOM(readFileSync("dev-tools/review-site/index.html", "utf8"), { runScripts: "outside-only", url: "http://127.0.0.1:8766" });
  const { window } = dom;
  let response = {
    schema_version: "development-review-v1", source_digest: "filter-first",
    roadmaps: [
      { id: "open", title: "Open outcome", status: "executing", increments: [] },
      { id: "done", title: "Completed outcome", status: "completed", increments: [] },
    ], work_items: [], evaluations: [], feedback: [], diagnostics: [],
  };
  window.fetch = async () => ({ ok: true, json: async () => structuredClone(response) });
  window.setInterval = () => 1;
  const search = value => { window.document.querySelector("#search").value = value; window.document.querySelector("#search").dispatchEvent(new window.Event("input")); };
  try {
    window.eval(readFileSync("dev-tools/review-site/app.js", "utf8"));
    await pause();
    search("Completed outcome");
    assert.equal(window.document.querySelectorAll("#items article").length, 1);
    assert.match(window.document.querySelector("#open-roadmaps .empty").textContent, /No matching open roadmaps/);
    assert.equal(window.document.querySelector("#completed-roadmaps .card-heading h3").textContent, "Completed outcome");
    search("no-match");
    assert.equal(window.document.querySelectorAll("#items article").length, 0);
    assert.match(window.document.querySelector("#completed-roadmaps .empty").textContent, /No matching completed roadmaps/);
    search("");
    response.roadmaps = [response.roadmaps[1]];
    response.source_digest = "only-completed";
    window.document.querySelector("#refresh").click();
    await pause();
    assert.match(window.document.querySelector("#open-roadmaps .empty").textContent, /No open roadmaps/);
    window.document.querySelector('[data-view="work_items"]').click();
    assert.equal(window.document.querySelectorAll(".roadmap-section").length, 0);
    assert.match(window.document.querySelector("#items").textContent, /No work items yet/);
    window.document.querySelector('[data-view="roadmaps"]').click();
    response.roadmaps = [];
    response.source_digest = "no-roadmaps";
    window.document.querySelector("#refresh").click();
    await pause();
    assert.equal(window.document.querySelectorAll(".roadmap-section").length, 2);
    assert.match(window.document.querySelector("#completed-roadmaps .empty").textContent, /No completed roadmaps yet/);
    assert.equal(window.document.querySelectorAll("#items article").length, 0);
  } finally { window.close(); }
});

test("review defaults dark and remembers only a valid explicit color preference", async () => {
  for (const stored of [null, "dark", "light", "<img src=x onerror=alert(1)>", "LIGHT"]) {
    const dom = new JSDOM(readFileSync("dev-tools/review-site/index.html", "utf8"), { runScripts: "outside-only", url: "http://127.0.0.1:8766" });
    const { window } = dom;
    if (stored !== null) window.localStorage.setItem("aisb-review-theme-v1", stored);
    window.fetch = async () => ({ ok: true, json: async () => ({ schema_version: "development-review-v1", source_digest: "theme", roadmaps: [], work_items: [], evaluations: [], feedback: [], diagnostics: [] }) });
    window.setInterval = () => 1;
    try {
      assert.equal(window.document.documentElement.dataset.theme, "dark");
      window.eval(readFileSync("dev-tools/review-site/app.js", "utf8"));
      await pause();
      const expected = stored === "light" ? "light" : "dark";
      assert.equal(window.document.documentElement.dataset.theme, expected);
      assert.equal(window.localStorage.getItem("aisb-review-theme-v1"), stored, "initial default is not an explicit user choice");
      const button = window.document.querySelector("header #theme-toggle");
      assert.equal(button.type, "button");
      assert.equal(button.textContent, expected === "dark" ? "Light mode" : "Dark mode");
      assert.match(button.getAttribute("aria-label"), new RegExp(`Current theme: ${expected}`));
      button.click();
      const next = expected === "dark" ? "light" : "dark";
      assert.equal(window.document.documentElement.dataset.theme, next);
      assert.equal(window.localStorage.getItem("aisb-review-theme-v1"), next);
      assert.match(button.getAttribute("aria-label"), new RegExp(`Switch to ${expected} mode`));
      assert.equal(window.document.querySelectorAll("img").length, 0);
      assert.equal(window.document.querySelectorAll(".roadmap-section").length, 2);
      button.click();
      assert.equal(window.document.documentElement.dataset.theme, expected);
      assert.equal(window.localStorage.getItem("aisb-review-theme-v1"), expected);
    } finally { window.close(); }
  }
});

test("review theme storage failure leaves theme action and live navigation usable", async () => {
  const dom = new JSDOM(readFileSync("dev-tools/review-site/index.html", "utf8"), { runScripts: "outside-only", url: "http://127.0.0.1:8766" });
  const { window } = dom;
  Object.defineProperty(window, "localStorage", { get() { throw new Error("synthetic-private-storage-detail"); } });
  window.fetch = async () => ({ ok: true, json: async () => ({ schema_version: "development-review-v1", source_digest: "theme-no-storage", roadmaps: [], work_items: [], evaluations: [], feedback: [], diagnostics: [] }) });
  window.setInterval = () => 1;
  try {
    window.eval(readFileSync("dev-tools/review-site/app.js", "utf8"));
    await pause();
    assert.equal(window.document.documentElement.dataset.theme, "dark");
    window.document.querySelector("#theme-toggle").click();
    assert.equal(window.document.documentElement.dataset.theme, "light");
    window.document.querySelector("#refresh").click(); await pause();
    assert.equal(window.document.querySelector("#connection").textContent, "Live · JSON connected");
    window.document.querySelector('[data-view="work_items"]').click();
    assert.equal(window.document.querySelector("h1").textContent, "Work items");
    assert.doesNotMatch(window.document.body.textContent, /synthetic-private-storage-detail/);
  } finally { window.close(); }
});

test("consolidated security history stays inspectable and searchable without a duplicate execution card", async () => {
  const dom = new JSDOM(readFileSync("dev-tools/review-site/index.html", "utf8"), { runScripts: "outside-only", url: "http://127.0.0.1:8766" });
  const { window } = dom;
  const criteria = [{ id: "native-check", description: "Actual native proof", outcome: "pending" }];
  const owner = { id: "security-findings-refresh", title: "Unified security delivery", status: "blocked", current_increment: "current",
    blocker_count: 1, blockers: [humanIssue("A permitted independent review is needed.", "This review needs an allowed independent reviewer.", "Arrange the permitted review of Assets access controls.")],
    increments: [{ id: "current", number: 1, title: "Current authority", status: "blocked", criteria, chunks_planned: 0, chunks_complete: 0 }],
    merged_history: [{ id: "security-vulnerability-remediation", title: "Legacy <img src=x onerror=alert(1)>", status: "blocked",
      summary: "Keep completed history and current pending proof separate", increments: [{ id: "old", number: 5, title: "Legacy runtime", status: "blocked", criteria,
        chunks: [{ title: "Historical chunk", status: "completed", summary: "Recorded earlier" }] }],
      criterion_owners: [{ increment_id: "old", criterion_id: "old-check", owner_increment_id: "current", owner_criterion_id: "native-check",
        related_owners: [{ increment_id: "current", criterion_id: "other-check" }], summary: "Native proof remains required" }] }],
  };
  window.fetch = async () => ({ ok: true, json: async () => ({ schema_version: "development-review-v1", source_digest: "merged",
    roadmaps: [owner], work_items: [], evaluations: [], feedback: [], diagnostics: [] }) });
  window.setInterval = () => 1;
  try {
    window.eval(readFileSync("dev-tools/review-site/app.js", "utf8")); await pause();
    assert.equal(window.document.querySelectorAll("article.card").length, 1);
    assert.equal(window.document.querySelectorAll("img").length, 0);
    const history = window.document.querySelector(".merged-history");
    assert.match(history.textContent, /Historical chunk: completed/);
    assert.equal(history.querySelector(".status").textContent, "archived pending");
    assert.match(history.textContent, /no legacy or current qualification pass is inferred/i);
    assert.match(history.textContent, /Required companion checks: current\/other-check/);
    assert.equal(window.document.querySelector(".card-heading > .status").textContent, "blocked");
    const search = window.document.querySelector("#search");
    search.value = "security-vulnerability-remediation"; search.dispatchEvent(new window.Event("input"));
    assert.equal(window.document.querySelectorAll("article.card").length, 1);
    [...window.document.querySelectorAll(".merged-history button")].find(b => b.textContent === "View owning increment").click();
    assert.equal(search.value, "security-findings-refresh");
    assert.equal(window.document.querySelectorAll("#open-roadmaps article.card").length, 1);
    assert.equal(window.document.querySelectorAll("#completed-roadmaps article.card").length, 0);
    assert.equal([...window.document.querySelectorAll(".increment")].find(d => d.querySelector("summary").textContent.includes("Current authority")).open, true);
  } finally { window.close(); }
});

test("review color tokens preserve text and control contrast in both themes", () => {
  const css = readFileSync("dev-tools/review-site/style.css", "utf8");
  const luminance = hex => {
    const value = hex.length === 4 ? hex.slice(1).split("").map(c => c + c).join("") : hex.slice(1);
    const channels = [0, 2, 4].map(at => parseInt(value.slice(at, at + 2), 16) / 255).map(v => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
    return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
  };
  for (const [name, pattern] of [["dark", /:root\{([^}]+)\}/], ["light", /:root\[data-theme="light"\]\{([^}]+)\}/]]) {
    const tokens = Object.fromEntries([...css.match(pattern)[1].matchAll(/--([a-z-]+):(#[0-9a-f]+)/g)].map(m => [m[1], m[2]]));
    const contrast = (a, b) => { const values = [luminance(tokens[a]), luminance(tokens[b])].sort((x, y) => x - y); return (values[1] + 0.05) / (values[0] + 0.05); };
    for (const [foreground, background] of [["ink", "card"], ["muted", "card"], ["muted", "aside"], ["green", "paper"], ["neutral-ink", "neutral-bg"], ["good-ink", "good-bg"], ["danger", "bad-bg"], ["error-ink", "error-bg"], ["mark-ink", "mark-bg"]]) {
      assert.ok(contrast(foreground, background) >= 4.5, `${name} ${foreground}/${background} text contrast`);
    }
    assert.ok(contrast("focus", "paper") >= 3, `${name} focus contrast`);
    assert.ok(contrast("line", "card") >= 3, `${name} control boundary contrast`);
  }
  assert.doesNotMatch(css, /filter\s*:\s*invert/);
});

test("review requirement bullets retain shared context, one qualification and canonical fallback", async () => {
  const dom = new JSDOM(readFileSync("dev-tools/review-site/index.html", "utf8"), {
    runScripts: "outside-only", url: "http://127.0.0.1:8766",
  });
  const { window } = dom;
  const description = "Models load safely. Memory, staging and cleanup stay bounded.";
  const criterion = { id: "bounded", description, outcome: "pending", evaluation_mode: "agent-executable-technical",
    blockers: [humanIssue("Private test access is needed.", "The real private publication test cannot run without an authorized credential.", "Configure the private test repository through the approved credential store.")],
    qualification: "controlled-environment", requirements: [
      { text: "Models load safely." }, { text: "Memory,", children: [{ text: "staging and cleanup stay bounded." }] },
    ] };
  let response = {
    schema_version: "development-review-v1", source_digest: "requirements-first",
    roadmaps: [{ id: "fixture", title: "Readable criteria", status: "blocked", current_increment: "one", increments: [
      { id: "one", number: 1, title: "Qualify actual behavior", status: "blocked", objective: "Keep canonical requirements",
        chunks_complete: 0, chunks_planned: 0, criteria: [criterion] },
    ] }], work_items: [], evaluations: [], feedback: [], diagnostics: [],
  };
  window.fetch = async () => ({ ok: true, json: async () => structuredClone(response) });
  window.setInterval = () => 1;
  try {
    window.eval(readFileSync("dev-tools/review-site/app.js", "utf8"));
    await pause();
    assert.equal(window.document.querySelectorAll(".criteria > li > .status").length, 1);
    assert.equal(window.document.querySelector(".criteria > li > .status").textContent, "technical check pending");
    assert.equal(window.document.querySelectorAll(".criterion-requirements > li").length, 2);
    assert.equal(window.document.querySelectorAll(".requirement-children > li").length, 1);
    assert.equal(window.document.querySelectorAll(".criterion-requirements .status").length, 0);
    assert.equal(window.document.querySelector(".original-criterion p").textContent, description);
    const blockers = window.document.querySelector(".criterion-blockers");
    assert.equal(blockers.querySelector("h5").textContent, "Blockers");
    assert.match(blockers.textContent, /Why it matters: The real private publication test cannot run/);
    assert.match(blockers.textContent, /Your action: Configure the private test repository/);
    assert.equal(blockers.querySelectorAll(".status,details").length, 0);
    assert.ok(window.document.querySelector(".criterion-requirement-body").compareDocumentPosition(blockers) & window.Node.DOCUMENT_POSITION_FOLLOWING);
    assert.match(window.document.querySelector(".increment").textContent, /0 \/ 0 work chunks · 0 \/ 1 criteria passed/);
    response = structuredClone(response);
    response.source_digest = "requirements-fallback";
    response.roadmaps[0].increments[0].criteria[0].requirements = [{ text: "Silently omit resource requirements." }];
    window.document.querySelector("#refresh").click();
    await pause();
    assert.equal(window.document.querySelector(".criterion-requirements").textContent, description);
    assert.equal(window.document.querySelectorAll(".criterion-requirements > li").length, 1);
    assert.doesNotMatch(window.document.body.textContent, /Silently omit/);
    response.source_digest = "requirements-hostile";
    const hostile = "<img src=x onerror=alert(1)> remains inert.";
    response.roadmaps[0].increments[0].criteria[0].description = hostile;
    response.roadmaps[0].increments[0].criteria[0].requirements = [{ text: hostile }];
    window.document.querySelector("#refresh").click();
    await pause();
    assert.equal(window.document.querySelectorAll("img").length, 0);
    assert.equal(window.document.querySelector(".criterion-requirements").textContent, hostile);
    assert.equal(window.document.querySelector(".criteria > li > .status").textContent, "technical check pending");
  } finally { window.close(); }
});

test("review shows full proposal details and honest preapproval or queued chunk planning", async () => {
  const dom = new JSDOM(readFileSync("dev-tools/review-site/index.html", "utf8"), {
    runScripts: "outside-only", url: "http://127.0.0.1:8766",
  });
  const { window } = dom;
  let response = {
    schema_version: "development-review-v1", source_digest: "draft-proposal",
    roadmaps: [{ id: "proposal", title: "Complete proposal", status: "roadmap-review", current_increment: "none",
      increments: [{ id: "first", number: 1, title: "Useful workflows", status: "pending", objective: "Build actual tests",
        chunks_complete: 0, chunks_planned: 0, chunks: [], chunk_plan_pending_approval: true,
        criteria: [{ id: "behavior", description: "Safe behavior remains required.", outcome: "missing" }],
        proposal: { work_packages: [{ id: "public-ui", title: "Create actual UI tests", outcome: "Run and fix defects through real host UI." }],
          depends_on: ["prior-daily-journeys"], deliverables: ["Source-bound coverage report"], verification: ["Execute current UI regressions"],
          excluded: ["<img src=x onerror=alert(1)> external effects"], rollback: "Restore the secure prior path" },
      }] }], work_items: [], evaluations: [], feedback: [], diagnostics: [],
  };
  window.fetch = async () => ({ ok: true, json: async () => structuredClone(response) });
  window.setInterval = () => 1;
  try {
    window.eval(readFileSync("dev-tools/review-site/app.js", "utf8"));
    await pause();
    const body = () => window.document.querySelector(".increment").textContent;
    assert.match(body(), /Implementation chunk plan is created after roadmap approval/);
    assert.doesNotMatch(body(), /0 \/ 0 work chunks|No chunk plan recorded/);
    assert.match(body(), /Create actual UI tests/);
    assert.match(body(), /Depends on increments/);
    assert.match(body(), /prior-daily-journeys/);
    assert.match(body(), /Source-bound coverage report/);
    assert.match(body(), /Execute current UI regressions/);
    assert.match(body(), /Restore the secure prior path/);
    assert.equal(window.document.querySelectorAll(".proposal-detail .status,.work-chunk").length, 0);
    assert.equal(window.document.querySelectorAll("img").length, 0);
    response = structuredClone(response);
    response.source_digest = "approved-queued-proposal";
    response.roadmaps[0].status = "increment-research";
    response.roadmaps[0].increments[0].chunk_plan_pending_approval = false;
    response.roadmaps[0].increments[0].chunk_plan_pending_start = true;
    window.document.querySelector("#refresh").click();
    await pause();
    assert.match(body(), /Implementation chunk plan is created when this increment starts/);
    assert.doesNotMatch(body(), /after roadmap approval|0 \/ 0 work chunks/);
    assert.match(body(), /0 \/ 1 criteria passed/);
    response.source_digest = "active-missing-plan";
    response.roadmaps[0].increments[0].status = "verifying";
    response.roadmaps[0].increments[0].chunk_plan_pending_start = false;
    window.document.querySelector("#refresh").click();
    await pause();
    assert.match(body(), /No chunk plan recorded for this increment/);
  } finally { window.close(); }
});

test("roadmap labels distinguish queued pending, in-progress, approval and actual blockers", async () => {
  const dom = new JSDOM(readFileSync("dev-tools/review-site/index.html", "utf8"), {
    runScripts: "outside-only", url: "http://127.0.0.1:8766",
  });
  const { window } = dom;
  const response = { schema_version: "development-review-v1", source_digest: "status-labels",
    roadmaps: [
      { id: "queued", title: "Queued", status: "ready", blocker_count: 0, increments: [] },
      { id: "active", title: "Active", status: "executing", blocker_count: 0, increments: [] },
      { id: "proposal", title: "Proposal", status: "roadmap-review", blocker_count: 0, increments: [] },
      { id: "real-gap", title: "Real gap", status: "blocked", blocker_count: 1, increments: [],
        blockers: [{ id: "review-access", ...humanIssue("An allowed independent review is needed.", "This review requires the repository owner to arrange access.", "Arrange the permitted independent review.") }] },
      { id: "stale-label", title: "No actual blocker", status: "blocked", blocker_count: 0, current_increment: "none", increments: [] },
      { id: "qualification", title: "Qualification", status: "implementation-complete-qualification-pending", blocker_count: 0, increments: [] },
      { id: "finalize", title: "Finalize", status: "roadmap-ready-to-close", blocker_count: 0, increments: [] },
      { id: "done", title: "Done", status: "completed", blocker_count: 0, increments: [] },
    ], work_items: [], evaluations: [], feedback: [], diagnostics: [] };
  window.fetch = async () => ({ ok: true, json: async () => structuredClone(response) });
  window.setInterval = () => 1;
  try {
    window.eval(readFileSync("dev-tools/review-site/app.js", "utf8"));
    await pause();
    assert.deepEqual([...window.document.querySelectorAll(".card-heading > .status")].map(n => n.textContent),
      ["pending", "in progress", "awaiting approval", "blocked", "status review needed", "pending qualification", "ready to finalize", "completed"]);
    assert.equal(response.roadmaps[0].status, "ready");
    assert.equal(response.roadmaps[4].status, "blocked");
    assert.match(window.document.querySelector(".status-review-note").textContent, /The agent must review this status/);
    assert.match(window.document.querySelector(".roadmap-blockers").textContent, /An allowed independent review is needed/);
    assert.match(window.document.querySelector(".roadmap-blockers").textContent, /Your action: Arrange the permitted independent review/);
    assert.equal(window.document.querySelector(".roadmap-blockers").querySelectorAll("details").length, 0);
    const legend = window.document.querySelector(".roadmap-status-legend");
    assert.equal(legend.getAttribute("aria-labelledby"), "roadmap-status-key");
    assert.equal(window.document.querySelector("#items").firstElementChild, legend);
    assert.equal(legend.nextElementSibling.id, "open-roadmaps");
    for (const text of ["technical check pending", "Qualification not recorded", "This does not mean its test failed", "Reviewed local support", "the parent roadmap is not thereby qualified", "Paused for approval", "Ready to finalize"])
      assert.ok(legend.textContent.includes(text), text);
    assert.match(window.document.querySelector("#summary").textContent, /1In progress/);
    assert.match(window.document.querySelector("#summary").textContent, /1Human actions needed/);
  } finally { window.close(); }
});

test("review assigns agent work and human blockers clearly without displaying technical source text", async () => {
  const dom = new JSDOM(readFileSync("dev-tools/review-site/index.html", "utf8"), { runScripts: "outside-only", url: "http://127.0.0.1:8766" });
  const { window } = dom;
  const issue = { id: "safe-restart", action_owner: "agent", summary: "Private technical staging-fence implementation detail.",
    prevents: "Internal ownership proof is not composed.", required_action: "Internal native qualification specification.",
    plain_language: { needed: "Finish the safe restart checks for low-memory mode.", responsible_role: "Coding agent",
      prevents: "The software must protect temporary model files before another low-memory test can start.",
      user_action: "None. The agent will finish the code and tests.", action: "Finish and test file protection, disk limits and worker shutdown.",
      done_when: "The restart and cleanup tests pass without changing completed model accuracy results." } };
  let response = { schema_version: "development-review-v1", source_digest: "agent-pending-first",
    roadmaps: [{ id: "low-memory", title: "Low-memory mode", status: "executing", blocker_count: 0, blockers: [], pending_work: [issue], current_increment: "one",
      increments: [{ id: "one", number: 1, title: "Safe restart", status: "verifying", chunks_complete: 0, chunks_planned: 0, criteria: [
        { id: "checked", description: "Required tests remain pending.", evaluation_mode: "agent-executable-technical", outcome: "pending", blockers: [], pending_work: [issue] } ] }] }],
    work_items: [], evaluations: [], feedback: [], diagnostics: [] };
  window.fetch = async () => ({ ok: true, json: async () => structuredClone(response) });
  window.setInterval = () => 1;
  try {
    window.eval(readFileSync("dev-tools/review-site/app.js", "utf8")); await pause();
    assert.equal(window.document.querySelectorAll(".criterion-blockers,.roadmap-blockers,.blocker-technical-details").length, 0);
    for (const section of [".roadmap-pending-work", ".criterion-pending-work"]) {
      const text = window.document.querySelector(section).textContent;
      assert.match(text, /Who will act: Coding agent/);
      assert.match(text, /Your action: None/);
      assert.match(text, /Agent work: Finish and test file protection/);
      assert.match(text, /Complete when: The restart and cleanup tests pass/);
    }
    assert.doesNotMatch(window.document.body.textContent, /staging-fence|ownership proof|native qualification specification/);
    assert.equal(window.document.querySelector(".card-heading > .status").textContent, "in progress");
    assert.equal(window.document.querySelector(".criteria > li > .status").textContent, "technical check pending");
    response = structuredClone(response); response.source_digest = "human-needed";
    const human = humanIssue("A permitted independent review is needed.", "This review needs an allowed reviewer.", "Arrange an allowed reviewer for the named access-control change.");
    response.roadmaps[0].status = "blocked"; response.roadmaps[0].blocker_count = 1;
    response.roadmaps[0].blockers = [human]; response.roadmaps[0].increments[0].criteria[0].blockers = [human];
    window.document.querySelector("#refresh").click(); await pause();
    assert.match(window.document.querySelector(".criterion-blockers").textContent, /Who will act: Repository owner/);
    assert.match(window.document.querySelector(".criterion-blockers").textContent, /Your action: Arrange an allowed reviewer/);
    assert.equal(window.document.querySelector(".card-heading > .status").textContent, "blocked");
    response.source_digest = "hostile-copy";
    response.roadmaps[0].increments[0].criteria[0].pending_work[0].plain_language.needed = "<img src=x onerror=alert(1)> remains inert.";
    window.document.querySelector("#refresh").click(); await pause();
    assert.equal(window.document.querySelectorAll("img").length, 0);
    assert.match(window.document.querySelector(".criterion-pending-work").textContent, /<img src=x/);
    response.source_digest = "stale-copy";
    response.roadmaps[0].increments[0].criteria[0].pending_work[0].plain_language = { needed: "Unsupported incomplete copy" };
    window.document.querySelector("#refresh").click(); await pause();
    assert.match(window.document.querySelector(".criterion-pending-work").textContent, /Clear action instructions are not yet available/);
    assert.doesNotMatch(window.document.body.textContent, /Unsupported incomplete copy|staging-fence/);
  } finally { window.close(); }
});

test("review presents plain requirement bullets and actions without a technical accordion or outcome change", async () => {
  const dom = new JSDOM(readFileSync("dev-tools/review-site/index.html", "utf8"), { runScripts: "outside-only", url: "http://127.0.0.1:8766" });
  const { window } = dom;
  const criterion = { id: "safe-loading", description: "Load a model only when enough memory is free.",
    requirements: [{ text: "Keep the approved memory guard." }, { text: "Refuse loading when memory is too low." }],
    user_instructions: { owner: "agent", next_action: "Test the memory check.", completion_proof: "Required tests pass and have a separate review." },
    qualification: "controlled-environment", evaluation_mode: "agent-executable-technical", outcome: "pending", evidence_recorded: true,
    technical_description: "Internal diagnostic must remain off the page." };
  const response = { schema_version: "development-review-v1", presentation_view: "user-v1", source_digest: "plain-user-view",
    roadmaps: [{ id: "safe-models", title: "Safe model loading", objective: "Keep model loading safe.", user_scope: ["Use the current approved limits."],
      status: "executing", blocker_count: 0, current_increment: "one", increments: [{ id: "one", number: 1, title: "Test safe loading", objective: "Test the guard.",
        status: "verifying", user_scope: ["Keep completed accuracy checks closed."], chunks: [], chunks_complete: 0, chunks_planned: 0, criteria: [criterion] }] }],
    work_items: [], evaluations: [], feedback: [], diagnostics: [] };
  window.fetch = async () => ({ ok: true, json: async () => structuredClone(response) }); window.setInterval = () => 1;
  try {
    window.eval(readFileSync("dev-tools/review-site/app.js", "utf8")); await pause();
    const body = window.document.body;
    assert.equal(window.document.querySelectorAll(".original-criterion").length, 0);
    assert.match(body.textContent, /Agent work: Test the memory check/);
    assert.match(body.textContent, /Complete when: Required tests pass and have a separate review/);
    assert.match(body.textContent, /Evidence is recorded/);
    assert.equal(window.document.querySelectorAll(".criterion-requirement-body li").length, 2);
    assert.equal(window.document.querySelectorAll(".user-scope li").length, 2);
    response.source_digest = "maximum-user-bullet";
    criterion.requirements.push({ text: "x".repeat(1500) });
    window.document.querySelector("#refresh").click(); await pause();
    assert.equal(window.document.querySelectorAll(".criterion-requirement-body li").length, 3);
    response.source_digest = "unicode-user-bounds";
    criterion.requirements = [{ text: "\u{1f600}".repeat(1500) }];
    criterion.user_instructions.next_action = "\u{1f600}".repeat(2000);
    criterion.user_instructions.completion_proof = "\u{1f600}".repeat(2000);
    window.document.querySelector("#refresh").click(); await pause();
    assert.equal(Array.from(window.document.querySelector(".criterion-requirement-body li span").textContent).length, 1500);
    assert.equal(window.document.querySelectorAll(".original-criterion").length, 0);
    assert.match(body.textContent, /Agent work:/);
    assert.doesNotMatch(body.textContent, /Internal diagnostic/);
    assert.equal(window.document.querySelector(".criteria > li > .status").textContent, "technical check pending");
    response.source_digest = "description-recovery";
    response.diagnostics = [{ code: "projection.user-description-unavailable" }];
    criterion.description = "The agent must update this description.";
    criterion.requirements = [{ text: "<img src=x onerror=alert(1)> remains inert." }];
    window.document.querySelector("#refresh").click(); await pause();
    assert.match(window.document.querySelector("#error").textContent, /The agent will update them. Your action: None/);
    assert.equal(window.document.querySelectorAll("img,.criterion-blockers").length, 0);
    assert.equal(window.document.querySelector(".criteria > li > .status").textContent, "technical check pending");
  } finally { window.close(); }
});
