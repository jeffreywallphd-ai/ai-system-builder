/* Structured data is rendered with textContent; source text never becomes HTML. */
let data = null;
let view = "roadmaps";
let lastDigest = "";
let focusedIncrement = null;
const names = { roadmaps: "Roadmaps", work_items: "Work items", evaluations: "Evaluations", feedback: "Feedback" };
const el = (tag, value, className) => { const n = document.createElement(tag); if (value !== undefined) n.textContent = value; if (className) n.className = className; return n; };
const readable = value => String(value).replaceAll("-", " ").replaceAll("_", " ");
const badge = status => el("span", readable(status), `status ${["completed", "complete", "passed", "accepted"].includes(status) ? "good" : ["failed", "blocked", "rejected", "changes-requested"].includes(status) ? "bad" : ""}`);
function metric(value, label) { const n = el("div", undefined, "metric"); n.append(el("strong", value), el("span", label)); return n; }
function selectView(next, query = "", increment = null) {
  view = next; focusedIncrement = increment;
  document.querySelector("#search").value = query;
  document.querySelectorAll(".nav").forEach(b => { b.classList.toggle("active", b.dataset.view === next); b.setAttribute("aria-current", b.dataset.view === next ? "page" : "false"); });
  render();
}
function action(label, run) { const button = el("button", label, "link-button"); button.type = "button"; button.addEventListener("click", run); return button; }
function qualificationBadge(criterion) {
  const outcome = criterion?.outcome || "missing";
  return badge(outcome === "missing" ? "qualification-not-recorded" : outcome === "pending" && criterion?.evaluation_mode ? "technical-check-pending" : outcome);
}
function criteriaList(criteria, chunks = []) {
  const list = el("ul", undefined, "criteria");
  for (const c of criteria) {
    const li = el("li"); const detail = el("div");
    detail.append(el("strong", c.title || readable(c.id), "criterion-name"), el("span", c.description));
    detail.append(el("p", c.id, "record-id"));
    if (c.evaluation_mode) detail.append(el("p", `Agent-executable technical check${c.qualification === "controlled-environment" ? " · requires its declared environment" : ""}. Human acceptance is offline.`, "small"));
    const linked = chunks.filter(chunk => chunk.criteria_ids.includes(c.id));
    if (linked.length) detail.append(el("p", `Work chunks: ${linked.map(chunk => `${chunk.title} (${readable(chunk.status)})`).join("; ")}`, "small"));
    if (c.evidence_summary) detail.append(el("p", c.evidence_summary, "small"));
    const support = c.supporting_work || [];
    if (support.length) {
      const local = el("details", undefined, "local-support");
      const verified = support.filter(s => s.status === "reviewed-local-snapshot").length;
      local.append(el("summary", `${verified} reviewed local work records · parent qualification remains separate`));
      local.append(el("p", "Reviewed local support at recorded snapshot. Current whole-candidate qualification is not asserted.", "small"));
      for (const s of support) {
        local.append(el("p", `${readable(s.status)}: ${s.scope}`, "small"));
        local.append(el("p", `Receipt ${s.receipt_digest.slice(0, 12)} · Review ${s.review_digest.slice(0, 12)}`, "small"));
        for (const limit of s.limitations) local.append(el("p", limit, "small"));
        local.append(action("View supporting work", () => selectView("work_items", s.work_id)));
      }
      detail.append(local);
    }
    li.append(qualificationBadge(c), detail); list.append(li);
  }
  return list;
}
function chunkBody(chunk, criteria) {
  const body = el("div", undefined, "chunk-body");
  const linked = criteria.filter(c => chunk.criteria_ids.includes(c.id));
  body.append(el("p", chunk.outcome, "objective"));
  body.append(el("p", `${linked.filter(c => c.outcome === "passed").length} / ${chunk.criteria_ids.length} linked criteria passed${chunk.is_next ? " · Next planned chunk" : ""}${chunk.completed_at ? ` · Recorded complete ${new Date(chunk.completed_at).toLocaleString()}` : ""}`, "small"));
  if (chunk.summary) body.append(el("p", chunk.summary, "objective"));
  const coverage = el("ul", undefined, "chunk-criteria");
  for (const id of chunk.criteria_ids) { const criterion = linked.find(c => c.id === id); const li = el("li"); li.append(qualificationBadge(criterion), el("span", id)); coverage.append(li); }
  body.append(coverage);
  if (chunk.tests?.length) {
    const evidence = el("details", undefined, "chunk-evidence"); evidence.append(el("summary", "Recorded verification"));
    const tests = el("ul"); chunk.tests.forEach(value => tests.append(el("li", value))); evidence.append(tests); body.append(evidence);
  }
  return body;
}
function render() {
  if (!data) return;
  for (const key of Object.keys(names)) document.querySelector(`#count-${key}`).textContent = data[key].length;
  document.querySelector("#heading").textContent = names[view];
  const all = data[view];
  const done = all.filter(i => ["completed", "complete", "closed", "final-approved"].includes(i.status)).length;
  const active = all.filter(i => ["executing", "active", "verifying", "prepared"].includes(i.status)).length;
  const summary = document.querySelector("#summary"); summary.replaceChildren(metric(all.length, "Total records"), metric(active, "In progress"), metric(done, "Completed"), metric(all.reduce((n, i) => n + (i.blocker_count || 0), 0), "Open blockers"));
  const query = document.querySelector("#search").value.toLowerCase();
  const selected = all.filter(i => JSON.stringify([i.title, i.id, i.objective, i.outcome, i.roadmap_title, i.increment_title, i.criteria_ids]).toLowerCase().includes(query));
  const items = document.querySelector("#items"); items.replaceChildren();
  if (!selected.length) { const empty = el("div", undefined, "empty"); empty.append(el("h2", query ? "No matching work" : `No ${names[view].toLowerCase()} yet`), el("p", query ? "Try a different title or outcome." : "New JSON records will appear here as the workflow creates them.")); items.append(empty); }
  for (const item of selected) {
    const card = el("article", undefined, "card");
    const row = el("div", undefined, "card-heading"); const title = el("div"); title.append(el("p", item.id, "record-id"), el("h2", item.title || item.task_id || item.summary || item.id)); row.append(title, badge(item.status)); card.append(row);
    if (item.objective || item.outcome && typeof item.outcome === "object") card.append(el("p", item.objective || item.outcome.success || item.outcome.problem, "objective"));
    if (item.increments) {
      card.append(el("p", item.evidence_policy === "control-plane-v1" ? "Receipt-backed completion policy" : "Historical roadmap · declarative evidence", "small"));
      if (item.successor) card.append(el("p", item.successor.summary, "small"), action("View active successor roadmap", () => selectView("roadmaps", item.successor.id)));
      const progress = item.increments.filter(i => i.status === "completed").length;
      const progressLabel = `${progress} of ${item.increments.length} increments complete`;
      card.append(el("p", progressLabel, "small")); const meter = el("progress"); meter.max = item.increments.length || 1; meter.value = progress; meter.setAttribute("aria-label", progressLabel); card.append(meter);
      for (const i of item.increments) {
        const details = el("details", undefined, "increment"); if (item.current_increment === i.id || focusedIncrement === i.id) details.open = true;
        const summary = el("summary"); const heading = el("span", `${i.number}. ${i.title}`); summary.append(heading, badge(i.status)); details.append(summary, el("p", i.objective, "objective"));
        details.append(el("p", `${i.chunks_complete} / ${i.chunks_planned} work chunks · ${i.criteria.filter(c => c.outcome === "passed").length} / ${i.criteria.length} criteria passed`, "small"));
        const supported = i.criteria.filter(c => c.supporting_work?.some(s => s.status === "reviewed-local-snapshot")).length;
        if (supported) details.append(el("p", `${supported} / ${i.criteria.length} criteria have reviewed local implementation support. Planned chunks and parent qualification are tracked separately.`, "small"));
        details.append(el("h3", "Work chunks"));
        const chunks = i.chunks || [];
        if (!chunks.length) details.append(el("p", "No chunk plan recorded for this increment.", "small"));
        for (const chunk of chunks) {
          const work = el("details", undefined, "work-chunk");
          const heading = el("summary"); heading.append(el("span", `${chunk.chunk_number}. ${chunk.title}`), badge(chunk.status));
          work.append(heading, chunkBody(chunk, i.criteria)); details.append(work);
        }
        if (chunks.length) details.append(action("View these work items", () => selectView("work_items", `${item.id}/${i.id}/`)));
        details.append(el("h3", "Acceptance criteria"), criteriaList(i.criteria, chunks));
        for (const handoff of i.offline_acceptance || []) {
          details.append(el("p", `Human scope: ${readable(handoff.status)} · Human portions of original plans are historical; current technical criteria govern closure. No human test pass asserted.`, "small"));
          for (const c of handoff.criteria) details.append(el("p", `${c.id}: ${c.description}`, "small"));
        }
        card.append(details);
      }
    } else if (item.source === "roadmap-chunk") {
      card.append(el("p", `Roadmap chunk · ${item.roadmap_title} › ${item.increment_title}`, "small"));
      card.append(el("p", item.evidence_policy === "control-plane-v1" ? "Governed roadmap record" : "Historical roadmap declaration", "small"));
      card.append(chunkBody(item, item.criteria), action("View parent increment", () => selectView("roadmaps", item.roadmap_id, item.increment_id)));
      const detail = el("details", undefined, "chunk-evidence"); detail.append(el("summary", "Linked acceptance evidence"), criteriaList(item.criteria)); card.append(detail);
    } else {
      if (view === "work_items") card.append(el("p", "Execution record · scoped verification and independent review", "small"));
      const meta = el("div", undefined, "metadata");
      for (const [label, key] of [["Verification", "latest_verification"], ["Review", "latest_review"], ["Evidence", "evidence_kind"], ["Result", "result"], ["Regression", "regression"]]) if (item[key]) meta.append(el("span", `${label}: ${readable(item[key])}`));
      card.append(meta);
      if (item.metrics) {
        const m = item.metrics;
        card.append(el("p", `${m.check_attempts} check attempts · ${(m.check_duration_ms / 1000).toFixed(2)} seconds checking · ${m.verification_retries} verification retries · ${m.review_corrections} review corrections`, "small"));
        card.append(el("p", `Delivery time: ${m.elapsed_ms === null ? "pending" : (m.elapsed_ms / 1000).toFixed(1) + " seconds"} · Provider cost and tokens: unavailable`, "small"));
      }
      if (item.run) {
        const r = item.run;
        const known = (value, suffix) => value === null ? "unknown" : `${value}${suffix}`;
        card.append(el("p", `${item.attempt_count} grading attempts · ${r.model} · ${readable(r.assurance)} · Infrastructure: ${readable(r.infrastructure_status)}`, "small"));
        card.append(el("p", `Run time: ${known(r.duration_ms, " ms")} · Cost: ${known(r.cost_usd, " USD")} · Input / output tokens: ${known(r.input_tokens, "")} / ${known(r.output_tokens, "")}`, "small"));
      }
    }
    items.append(card);
  }
  document.querySelector("#fingerprint").textContent = `Source ${data.source_digest.slice(0, 12)}`;
}
let fetching = false;
async function refresh() {
  if (fetching) return; fetching = true;
  try {
    const response = await fetch("/api/review", { cache: "no-store", credentials: "omit" });
    if (!response.ok) throw new Error("unavailable");
    const next = await response.json();
    if (next.schema_version !== "development-review-v1") throw new Error("schema");
    data = next;
    if (lastDigest !== data.source_digest) { lastDigest = data.source_digest; render(); }
    document.querySelector("#connection").textContent = "Live · JSON connected";
    document.querySelector("#updated").textContent = `Checked ${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}`;
    const error = document.querySelector("#error"); error.hidden = !data.diagnostics.length; error.textContent = data.diagnostics.length ? "Some records could not be loaded. Check the contributor status command for recovery guidance." : "";
  } catch {
    document.querySelector("#connection").textContent = "Connection interrupted";
    const error = document.querySelector("#error"); error.hidden = false; error.textContent = "The local review server is unavailable. Retry, or start it using the documented review-site command.";
  } finally { fetching = false; }
}
document.querySelectorAll(".nav").forEach(button => button.addEventListener("click", () => selectView(button.dataset.view)));
document.querySelector("#search").addEventListener("input", render);
document.querySelector("#refresh").addEventListener("click", refresh);
refresh();
setInterval(refresh, 5000);
