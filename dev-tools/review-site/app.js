/* Structured data is rendered with textContent; source text never becomes HTML. */
let data = null;
let view = "roadmaps";
let lastDigest = "";
let focusedIncrement = null;
const names = { roadmaps: "Roadmaps", work_items: "Work items", evaluations: "Evaluations", feedback: "Feedback" };
const themePreferenceKey = "aisb-review-theme-v1";
function applyTheme(theme) {
  const current = theme === "light" ? "light" : "dark";
  const next = current === "dark" ? "light" : "dark";
  document.documentElement.dataset.theme = current;
  const toggle = document.querySelector("#theme-toggle");
  toggle.textContent = `${next === "light" ? "Light" : "Dark"} mode`;
  toggle.setAttribute("aria-label", `Switch to ${next} mode. Current theme: ${current}.`);
}
function initializeTheme() {
  let theme = "dark";
  try {
    const stored = localStorage.getItem(themePreferenceKey);
    if (stored === "light" || stored === "dark") theme = stored;
  } catch { /* Storage is optional; review remains usable. */ }
  applyTheme(theme);
  document.querySelector("#theme-toggle").addEventListener("click", () => {
    const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
    applyTheme(next);
    try { localStorage.setItem(themePreferenceKey, next); } catch { /* Keep the current in-memory choice. */ }
  });
}
const el = (tag, value, className) => { const n = document.createElement(tag); if (value !== undefined) n.textContent = value; if (className) n.className = className; return n; };
const readable = value => String(value).replaceAll("-", " ").replaceAll("_", " ");
const textLength = value => Array.from(value).length;
const badge = status => el("span", readable(["complete", "final-approved"].includes(status) ? "completed" : status), `status ${["completed", "complete", "final-approved", "passed", "accepted"].includes(status) ? "good" : ["failed", "blocked", "rejected", "changes-requested"].includes(status) ? "bad" : ""}`);
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
const reviewStatusKey = [
  { id: "pending", aliases: ["ready"], description: "Approved work has not started or is queued." },
  { id: "in-progress", aliases: ["executing", "verifying"], description: "Implementation or verification is underway." },
  { id: "awaiting-approval", aliases: ["roadmap-review", "decision-approval", "approval-required"], description: "A proposed roadmap, decision or revised scope needs user approval." },
  { id: "pending-qualification", aliases: ["implementation-complete-qualification-pending", "implemented-pending-qualification"], description: "The code is written. Required tests or evidence still need to be checked." },
  { id: "technical-check-pending", aliases: [], description: "The agent must run or review a required technical check. This is not a request for human testing." },
  { id: "blocked", aliases: ["blocked"], description: "A person must supply an approval, access or other named action before this work can continue." },
  { id: "completed", aliases: ["completed", "complete", "final-approved"], description: "Required work and qualification checks are recorded complete." },
];
const roadmapStatusAliases = new Map(reviewStatusKey.flatMap(row => row.aliases.map(alias => [alias, row.id])));
roadmapStatusAliases.set("roadmap-ready-to-close", "ready-to-finalize");
function roadmapDisplayStatus(item) {
  if (item.status === "blocked" && !item.blockers?.some(row => row.action_owner === "human")) return "status-review-needed";
  return roadmapStatusAliases.get(item.status) || item.status;
}
function roadmapStatusLegend() {
  const legend = el("section", undefined, "roadmap-status-legend");
  legend.setAttribute("aria-labelledby", "roadmap-status-key");
  const heading = el("h2", "Roadmap status key"); heading.id = "roadmap-status-key";
  legend.append(heading);
  const definitions = el("dl");
  for (const row of reviewStatusKey) {
    const group = el("div"); const term = el("dt"); term.append(badge(row.id));
    group.append(term, el("dd", row.description)); definitions.append(group);
  }
  const more = el("details", undefined, "additional-status-key");
  more.append(el("summary", "Other workflow and evidence statuses"));
  const additional = el("dl");
  for (const [title, description] of [
    ["Discovery / roadmap drafting / decision options", "The agent is investigating scope, drafting the plan or preparing decision options. These states do not authorize implementation."],
    ["Pending increment", "This increment has not started. Its parent roadmap records whether approval has been supplied."],
    ["Researching / planning", "An increment is being researched or its implementation chunks are being planned."],
    ["Implementing / verifying", "Planned work is being built or checked. Verification in progress does not itself mean blocked or passed."],
    ["Paused for approval", "An increment is paused for required renewed scope or decision approval."],
    ["Ready to finalize", "Increments are recorded complete; final evidence review and overall roadmap closure remain."],
    ["Qualification not recorded", "No evidence result has been recorded for this criterion. This does not mean its test failed."],
    ["Passed / failed", "The criterion has a recorded successful or unsuccessful check. Evidence scope and freshness still matter."],
    ["Reviewed local support", "A scoped component has completed verification and independent review at its recorded snapshot; the parent roadmap is not thereby qualified."],
    ["Unverified support", "A linked supporting record is unavailable or not verified. It supplies no parent qualification pass."],
    ["Historical / merged / retired", "Preserved declarative history or work owned by a validated successor. This is not a new current qualification pass."],
    ["Offline user-owned", "Human acceptance belongs to the user offline. Retained technical criteria still require their own automated evidence."],
  ]) {
    const group = el("div"); group.append(el("dt", title), el("dd", description)); additional.append(group);
  }
  more.append(additional);
  legend.append(definitions, more, el("p", "Blocked means a person must act. Pending agent work and technical checks do not mean blocked. Each criterion keeps its own test result.", "small"));
  return legend;
}


function userInstructions(criterion) {
  const copy = criterion.user_instructions;
  return data?.presentation_view === "user-v1" && copy?.owner === "agent" &&
    ["next_action", "completion_proof"].every(key => typeof copy[key] === "string" && copy[key].trim() && textLength(copy[key]) <= 2000) ? copy : null;
}
function requirementNodes(criterion) {
  const fallback = [{ text: criterion.description || "" }];
  let remaining = 64;
  const read = (nodes, depth = 1) => {
    if (!Array.isArray(nodes) || !nodes.length || nodes.length > 64 || depth > 3) throw new Error("requirements");
    return nodes.map(node => {
      if (!node || typeof node !== "object" || typeof node.text !== "string" || !node.text.trim() || textLength(node.text) > 1500 || --remaining < 0) throw new Error("requirements");
      if (Object.keys(node).some(key => !["text", "children"].includes(key))) throw new Error("requirements");
      return { text: node.text, ...(node.children === undefined ? {} : { children: read(node.children, depth + 1) }) };
    });
  };
  const flatten = nodes => nodes.flatMap(node => [node.text, ...flatten(node.children || [])]);
  const normalize = value => String(value).trim().replace(/\s+/gu, " ");
  try {
    const nodes = read(criterion.requirements);
    return userInstructions(criterion) || normalize(flatten(nodes).join(" ")) === normalize(criterion.description) ? nodes : fallback;
  } catch { return fallback; }
}
function requirementList(nodes, nested = false) {
  const list = el("ul", undefined, nested ? "requirement-children" : "criterion-requirements");
  for (const node of nodes) {
    const item = el("li");
    item.append(el("span", node.text));
    if (node.children?.length) item.append(requirementList(node.children, true));
    list.append(item);
  }
  return list;
}
function criterionRequirements(criterion) {
  const instructions = userInstructions(criterion);
  const nodes = requirementNodes(criterion);
  const container = el("div", undefined, "criterion-requirement-body");
  if (instructions) container.append(el("p", criterion.description));
  container.append(requirementList(nodes));
  if (nodes.length > 1 || nodes.some(node => node.children?.length)) {
    container.append(el("p", "These bullets share one criterion and one qualification result.", "small"));
    if (!instructions) {
      const original = el("details", undefined, "original-criterion");
      original.append(el("summary", "Original criterion wording"), el("p", criterion.description));
      container.append(original);
    }
  }
  if (instructions) {
    container.append(el("p", `Agent work: ${instructions.next_action}`),
      el("p", `Complete when: ${instructions.completion_proof}`));
  }
  return container;
}

function appendScope(container, item) {
  if (!Array.isArray(item.user_scope) || !item.user_scope.length) return;
  const list = el("ul", undefined, "user-scope");
  item.user_scope.slice(0, 64).forEach(value => { if (typeof value === "string") list.append(el("li", value)); });
  container.append(list);
}

function proposalDetails(increment) {
  const proposal = increment.proposal;
  if (!proposal || typeof proposal !== "object") return null;
  const packages = Array.isArray(proposal.work_packages) ? proposal.work_packages.slice(0, 40) : [];
  const groups = [["Depends on increments", "depends_on"], ["Deliverables", "deliverables"], ["Verification procedure", "verification"], ["Excluded from this increment", "excluded"]]
    .map(([title, key]) => [title, Array.isArray(proposal[key]) ? proposal[key].slice(0, 40).filter(text => typeof text === "string") : []]);
  const rollback = typeof proposal.rollback === "string" ? proposal.rollback : "";
  if (!packages.length && !groups.some(([, rows]) => rows.length) && !rollback) return null;
  const detail = el("details", undefined, "proposal-detail");
  detail.open = Boolean(increment.chunk_plan_pending_approval || increment.chunk_plan_pending_start);
  detail.append(el("summary", "Increment proposal details"),
    el("p", "Planned scope and verification. These are not executed work chunks or qualification results.", "small"));
  if (packages.length) {
    detail.append(el("h4", "Planned work packages"));
    const list = el("ul", undefined, "proposal-packages");
    for (const row of packages) {
      if (!row || typeof row !== "object" || typeof row.title !== "string" || typeof row.outcome !== "string") continue;
      const item = el("li");
      item.append(el("strong", row.title.slice(0, 240)), el("p", row.outcome.slice(0, 1600)));
      list.append(item);
    }
    detail.append(list);
  }
  for (const [title, rows] of groups) {
    if (title === "Depends on increments" && !rows.length) { detail.append(el("h4", title), el("p", "None")); continue; }
    if (!rows.length) continue;
    detail.append(el("h4", title));
    const list = el("ul");
    for (const row of rows) list.append(el("li", row.slice(0, 1600)));
    detail.append(list);
  }
  if (rollback) detail.append(el("h4", "Rollback and recovery"), el("p", rollback.slice(0, 4000)));
  return detail;
}

function appendBlockerExplanation(container, row) {
  const copy = row.plain_language;
  const limits = { needed: 400, prevents: 800, action: 800 };
  const valid = copy && typeof copy === "object" && !Array.isArray(copy) &&
    Object.entries(limits).every(([key, limit]) =>
      typeof copy[key] === "string" && copy[key].trim() && textLength(copy[key]) <= limit);
  const userText = (key, limit, fallback) => valid && typeof copy[key] === "string" && copy[key].trim() && textLength(copy[key]) <= limit ? copy[key] : fallback;
  const human = row.action_owner === "human";
  container.append(el("strong", valid ? copy.needed : "Clear action instructions are not yet available."));
  container.append(el("p", `Who will act: ${userText("responsible_role", 160,
    human ? "Repository owner" : row.action_owner === "agent" ? "Coding agent" : "The agent must confirm responsibility")}`));
  if (valid) container.append(el("p", `Why it matters: ${copy.prevents}`));
  container.append(el("p", `Your action: ${userText("user_action", 800,
    human ? "Ask the agent for the exact action instructions before proceeding." : "None. The agent will continue this work.")}`));
  if (valid) container.append(el("p", `${human ? "Required action" : "Agent work"}: ${copy.action}`));
  container.append(el("p", `Complete when: ${userText("done_when", 800,
    "The required result has been checked and recorded. This item does not yet have complete action instructions.")}`));
}

function issueSection(rows, title, className, heading = "h5") {
  if (!rows.length) return null;
  const section = el("section", undefined, className);
  section.setAttribute("aria-label", title);
  section.append(el(heading, title));
  const list = el("ul");
  for (const row of rows) { const item = el("li"); appendBlockerExplanation(item, row); list.append(item); }
  section.append(list);
  return section;
}

function blockerDetails(roadmap) {
  const human = (roadmap.blockers || []).slice(0, 40).filter(row => row?.action_owner === "human");
  const pending = [...(roadmap.pending_work || []), ...(roadmap.blockers || []).filter(row => row?.action_owner !== "human")].slice(0, 40);
  if (!human.length && !pending.length) return null;
  const container = el("div", undefined, "roadmap-issues");
  for (const [rows, title, className] of [[human, "Blockers — human action needed", "roadmap-blockers"], [pending, "Pending work — coding agent", "roadmap-pending-work"]]) {
    const section = issueSection(rows, title, className, "h4"); if (section) container.append(section);
  }
  for (const [total, shown, label] of [[roadmap.blocker_count, human.length, "human actions"], [roadmap.pending_work_count, pending.length, "agent work items"]]) {
    if (Number.isSafeInteger(total) && total > shown) container.append(el("p", `Showing ${shown} of ${total} ${label}. The agent must check the remaining records.`, "small"));
  }
  return container;
}

function criterionBlockers(criterion) {
  const human = (criterion.blockers || []).slice(0, 20).filter(row => row?.action_owner === "human");
  const pending = [...(criterion.pending_work || []), ...(criterion.blockers || []).filter(row => row?.action_owner !== "human")].slice(0, 20);
  if (!human.length && !pending.length) return null;
  const container = el("div", undefined, "criterion-issues");
  for (const [rows, title, className] of [[human, "Blockers", "criterion-blockers"], [pending, "Pending work — coding agent", "criterion-pending-work"]]) {
    const section = issueSection(rows, title, className); if (section) container.append(section);
  }
  return container;
}

function criteriaList(criteria, chunks = []) {
  const list = el("ul", undefined, "criteria");
  for (const c of criteria) {
    const li = el("li"); const detail = el("div");
    detail.append(el("strong", c.title || readable(c.id), "criterion-name"), criterionRequirements(c));
    const obstacles = criterionBlockers(c); if (obstacles) detail.append(obstacles);
    detail.append(el("p", c.id, "record-id"));
    if (c.evaluation_mode) detail.append(el("p", `Agent-executable technical check${c.qualification === "controlled-environment" ? " · requires its declared environment" : ""}. Human acceptance is offline.`, "small"));
    const linked = chunks.filter(chunk => chunk.criteria_ids.includes(c.id));
    if (linked.length) detail.append(el("p", `Work chunks: ${linked.map(chunk => `${chunk.title} (${readable(chunk.status)})`).join("; ")}`, "small"));
    if (c.evidence_summary) detail.append(el("p", c.evidence_summary, "small"));
    if (c.evidence_recorded) detail.append(el("p", "Evidence is recorded. The status shows whether the required check has passed.", "small"));
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
function linkedWorkCriteria(item) {
  const increment = data.roadmaps.find(roadmap => roadmap.id === item.roadmap_id)
    ?.increments?.find(row => row.id === item.increment_id);
  const fallback = Array.isArray(item.criteria) ? item.criteria : [];
  const ids = Array.isArray(item.criteria_ids) ? item.criteria_ids : fallback.map(row => row.id);
  return ids.map(id => increment?.criteria?.find(row => row.id === id) || fallback.find(row => row.id === id))
    .filter(Boolean);
}
const completedRoadmap = item => ["completed", "complete", "final-approved"].includes(item.status);
function roadmapSections(parent, records, query) {
  const sections = {};
  for (const [key, title, complete] of [["open", "Open Roadmaps", false], ["completed", "Completed Roadmaps", true]]) {
    const section = el("section", undefined, "roadmap-section");
    section.id = `${key}-roadmaps`;
    const heading = el("h2", title); heading.id = `${section.id}-heading`;
    section.setAttribute("aria-labelledby", heading.id); section.append(heading);
    if (!records.some(item => completedRoadmap(item) === complete)) {
      const empty = el("div", undefined, "empty");
      empty.append(el("p", query ? `No matching ${key} roadmaps. Try a different title or outcome.` : complete ? "No completed roadmaps yet." : "No open roadmaps."));
      section.append(empty);
    }
    sections[key] = section; parent.append(section);
  }
  return sections;
}
function render() {
  if (!data) return;
  for (const key of Object.keys(names)) document.querySelector(`#count-${key}`).textContent = data[key].length;
  document.querySelector("#heading").textContent = names[view];
  const all = data[view];
  const done = all.filter(i => view === "roadmaps" ? completedRoadmap(i) : ["completed", "complete", "closed", "final-approved"].includes(i.status)).length;
  const active = all.filter(i => view === "roadmaps" ? roadmapDisplayStatus(i) === "in-progress" : ["executing", "active", "verifying", "prepared"].includes(i.status)).length;
  const summary = document.querySelector("#summary"); summary.replaceChildren(metric(all.length, "Total records"), metric(active, "In progress"), metric(done, "Completed"), metric(all.reduce((n, i) => n + (i.blocker_count || 0), 0), "Human actions needed"));
  const query = document.querySelector("#search").value.toLowerCase();
  const selected = all.filter(i => JSON.stringify([i.title, i.id, i.objective, i.outcome, i.roadmap_title, i.increment_title, i.criteria_ids, i.merged_history]).toLowerCase().includes(query));
  const items = document.querySelector("#items"); items.replaceChildren();
  if (view === "roadmaps") items.append(roadmapStatusLegend());
  const sections = view === "roadmaps" ? roadmapSections(items, selected, query) : null;
  if (view === "work_items" && data.inventory?.execution_records_truncated && Number.isSafeInteger(data.inventory.execution_records_shown) && Number.isSafeInteger(data.inventory.execution_records_total)) items.append(el("p", `Showing the newest ${data.inventory.execution_records_shown} of ${data.inventory.execution_records_total} scoped execution records; the remaining records are outside this bounded display.`, "small inventory-limit"));
  if (!selected.length && !sections) { const empty = el("div", undefined, "empty"); empty.append(el("h2", query ? "No matching work" : `No ${names[view].toLowerCase()} yet`), el("p", query ? "Try a different title or outcome." : "New JSON records will appear here as the workflow creates them.")); items.append(empty); }
  // The API orders by normalized first creation time. A stable partition preserves
  // that chronology (including ties and undated records) within each section.
  for (const item of selected) {
    const card = el("article", undefined, "card");
    const row = el("div", undefined, "card-heading"); const title = el("div"); title.append(el("p", item.id, "record-id"), el(sections ? "h3" : "h2", item.title || item.task_id || item.summary || item.id)); row.append(title, badge(sections ? roadmapDisplayStatus(item) : item.status)); card.append(row);
    if (sections && roadmapDisplayStatus(item) === "status-review-needed") card.append(el("p", "The agent must review this status. No specific human action has been recorded.", "small status-review-note"));
    if (item.objective || item.outcome && typeof item.outcome === "object") card.append(el("p", item.objective || item.outcome.success || item.outcome.problem, "objective"));
    appendScope(card, item);
    const obstacles = sections ? blockerDetails(item) : null; if (obstacles) card.append(obstacles);
    if (item.increments) {
      card.append(el("p", item.evidence_policy === "control-plane-v1" ? "Receipt-backed completion policy" : "Historical roadmap · declarative evidence", "small"));
      if (item.successor) card.append(el("p", item.successor.summary, "small"), action("View active successor roadmap", () => selectView("roadmaps", item.successor.id)));
      for (const legacy of item.merged_history || []) {
        const archive = el("details", undefined, "merged-history");
        archive.append(el("summary", `Merged history: ${legacy.title}`), el("p", data.presentation_view ? legacy.objective : legacy.summary, "small"),
          el("p", "Historical evidence preserved. Remaining execution belongs to this roadmap; no legacy or current qualification pass is inferred.", "small"));
        appendScope(archive, legacy);
        for (const increment of legacy.increments || []) {
          const detail = el("details", undefined, "increment");
          const heading = el("summary"); heading.append(el("span", `${increment.number}. ${increment.title}`), badge(increment.status === "blocked" ? "archived-pending" : increment.status));
          detail.append(heading);
          if (data.presentation_view) detail.append(el("p", increment.objective));
          appendScope(detail, increment);
          const proposal = proposalDetails(increment); if (proposal) detail.append(proposal); detail.append(criteriaList(increment.criteria || []));
          for (const chunk of increment.chunks || []) detail.append(el("p", `${chunk.title}: ${readable(chunk.status)}${chunk.summary ? ` · ${chunk.summary}` : ""}`, "small"));
          for (const owner of (legacy.criterion_owners || []).filter(row => row.increment_id === increment.id)) {
            detail.append(el("p", `${owner.criterion_id} → ${owner.owner_increment_id}/${owner.owner_criterion_id}. ${owner.summary}`, "small"),
              action("View owning increment", () => selectView("roadmaps", item.id, owner.owner_increment_id)));
            if (owner.related_owners?.length) detail.append(el("p", `Required companion checks: ${owner.related_owners.map(c => `${c.increment_id}/${c.criterion_id}`).join(", ")}`, "small"));
          }
          archive.append(detail);
        }
        card.append(archive);
      }
      const progress = item.increments.filter(i => i.status === "completed").length;
      const progressLabel = `${progress} of ${item.increments.length} increments complete`;
      card.append(el("p", progressLabel, "small")); const meter = el("progress"); meter.max = item.increments.length || 1; meter.value = progress; meter.setAttribute("aria-label", progressLabel); card.append(meter);
      for (const i of item.increments) {
        const details = el("details", undefined, "increment"); if (item.current_increment === i.id || focusedIncrement === i.id) details.open = true;
        const summary = el("summary"); const heading = el("span", `${i.number}. ${i.title}`); summary.append(heading, badge(i.status === "blocked" && !item.blockers?.some(row => row.action_owner === "human") ? "status-review-needed" : i.status)); details.append(summary, el("p", i.objective, "objective"));
        appendScope(details, i);
        const planning = i.chunk_plan_pending_approval ? "Implementation chunk plan is created after roadmap approval" : i.chunk_plan_pending_start ? "Implementation chunk plan is created when this increment starts" : null;
        details.append(el("p", `${planning || `${i.chunks_complete} / ${i.chunks_planned} work chunks`} · ${i.criteria.filter(c => c.outcome === "passed").length} / ${i.criteria.length} criteria passed`, "small"));
        const proposal = proposalDetails(i); if (proposal) details.append(proposal);
        const supported = i.criteria.filter(c => c.supporting_work?.some(s => s.status === "reviewed-local-snapshot")).length;
        if (supported) details.append(el("p", `${supported} / ${i.criteria.length} criteria have reviewed local implementation support. Planned chunks and parent qualification are tracked separately.`, "small"));
        details.append(el("h4", planning ? "Implementation planning" : "Work chunks"));
        const chunks = i.chunks || [];
        if (!chunks.length) details.append(el("p", planning || "No chunk plan recorded for this increment.", "small"));
        for (const chunk of chunks) {
          const work = el("details", undefined, "work-chunk");
          const heading = el("summary"); heading.append(el("span", `${chunk.chunk_number}. ${chunk.title}`), badge(chunk.status));
          work.append(heading, chunkBody(chunk, i.criteria)); details.append(work);
        }
        if (chunks.length) details.append(action("View these work items", () => selectView("work_items", `${item.id}/${i.id}/`)));
        details.append(el("h4", "Acceptance criteria"), criteriaList(i.criteria, chunks));
        for (const handoff of i.offline_acceptance || []) {
          details.append(el("p", `Human scope: ${readable(handoff.status)} · Human portions of original plans are historical; current technical criteria govern closure. No human test pass asserted.`, "small"));
          for (const c of handoff.criteria) details.append(el("p", `${c.id}: ${c.description}`, "small"));
        }
        card.append(details);
      }
    } else if (item.source === "roadmap-chunk") {
      card.append(el("p", `Roadmap chunk · ${item.roadmap_title} › ${item.increment_title}`, "small"));
      card.append(el("p", item.evidence_policy === "control-plane-v1" ? "Governed roadmap record" : "Historical roadmap declaration", "small"));
      const linkedCriteria = linkedWorkCriteria(item);
      card.append(chunkBody(item, linkedCriteria), action("View parent increment", () => selectView("roadmaps", item.roadmap_id, item.increment_id)));
      const detail = el("details", undefined, "chunk-evidence"); detail.append(el("summary", "Linked acceptance evidence"), criteriaList(linkedCriteria)); card.append(detail);
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
    (sections ? sections[completedRoadmap(item) ? "completed" : "open"] : items).append(card);
  }
  document.querySelector("#fingerprint").textContent = `Source ${data.source_digest.slice(0, 12)}`;
}
let fetching = false;
function reviewNotice(diagnostics) {
  const messages = [];
  const limits = diagnostics.filter(row => row?.code === "projection.execution-records-truncated");
  const limit = limits[0];
  const validLimit = limits.length === 1 && Number.isSafeInteger(limit.shown) && Number.isSafeInteger(limit.total)
    && limit.shown >= 0 && limit.total > limit.shown;
  if (validLimit) messages.push(`The Work items tab shows the newest ${limit.shown} of ${limit.total} execution records. Older records remain saved. Your action: None.`);
  if (diagnostics.some(row => row?.code === "projection.user-description-unavailable"))
    messages.push("Some descriptions need an update. The agent will update them. Your action: None.");
  if (diagnostics.some(row => row?.code !== "projection.user-description-unavailable"
    && !(row?.code === "projection.execution-records-truncated" && validLimit)))
    messages.push("Some records are unavailable. The agent will check the saved workflow records and repair the issue. Your action: None.");
  return messages.join(" ");
}
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
    const error = document.querySelector("#error");
    error.textContent = reviewNotice(data.diagnostics);
    error.hidden = !error.textContent;
  } catch {
    document.querySelector("#connection").textContent = "Connection interrupted";
    const error = document.querySelector("#error"); error.hidden = false; error.textContent = "The local review server is unavailable. Retry, or start it using the documented review-site command.";
  } finally { fetching = false; }
}
initializeTheme();
document.querySelectorAll(".nav").forEach(button => button.addEventListener("click", () => selectView(button.dataset.view)));
document.querySelector("#search").addEventListener("input", render);
document.querySelector("#refresh").addEventListener("click", refresh);
refresh();
setInterval(refresh, 5000);
