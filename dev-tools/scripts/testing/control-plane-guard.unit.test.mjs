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
  assert.equal(window.document.querySelector("h2").textContent, "<img src=x onerror=alert(1)>");
  assert.equal(window.document.querySelector("details").open, true);
  response.source_digest = "updated-fingerprint";
  response.roadmaps[0].title = "Updated JSON outcome";
  window.document.querySelector("#refresh").click();
  await pause();
  assert.equal(window.document.querySelector("h2").textContent, "Updated JSON outcome");
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
  const criterion = { id: "works", description: "User completes the task", outcome: "passed", evidence_summary: "Actual criterion evidence" };
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
  } finally { window.close(); }
});
