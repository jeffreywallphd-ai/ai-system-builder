/* Structured data is rendered with textContent; source text never becomes HTML. */
let data = null;
let view = "roadmaps";
let lastDigest = "";
let implementationPhaseView = "all";
let disclosureRepository = null;
let disclosureIdentityDigest = null;
const incrementChoices = new Map();
let incrementIdentities = new Map();
const pageSizes = { roadmaps: 3, work_items: 25, evaluations: 25, feedback: 25 };
const pageRequests = Object.fromEntries(Object.keys(pageSizes).map(key => [key, { page: 1, roadmap: "", increment: "", work: "" }]));
let linkedIncrement = null;
const incrementKey = (roadmap, increment, history = null) => JSON.stringify([data.repository_id || "", roadmap, history, increment]);
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
function formatDeliveryTime(milliseconds) {
  if (typeof milliseconds !== "number" || !Number.isFinite(milliseconds) || milliseconds < 0 || milliseconds > Number.MAX_SAFE_INTEGER) return null;
  // Round once before splitting units so a rounded 60 seconds carries correctly.
  const tenths = Math.round(milliseconds / 100);
  const hours = Math.floor(tenths / 36000);
  const minutes = Math.floor(tenths % 36000 / 600);
  const seconds = (tenths % 600 / 10).toFixed(1).replace(/\.0$/, "");
  return `${hours ? `${hours}h ` : ""}${minutes}m ${seconds}s`;
}
function incrementDelivery(increment) {
  const timing = increment.delivery;
  const duration = formatDeliveryTime(timing?.elapsed_ms);
  if (!["timed_records", "pending_records", "unavailable_records"].every(key => Number.isSafeInteger(timing?.[key]) && timing[key] >= 0) ||
      (duration === null) !== (timing.timed_records === 0))
    return el("p", "Delivery time: Not recorded.", "small delivery-time");
  return el("p", `Delivery time: ${duration ?? "Not recorded"} · ${timing.timed_records} measured · ${timing.pending_records} pending · ${timing.unavailable_records} unavailable.${duration === null ? "" : " Summed execution durations may overlap."}`, "small delivery-time");
}
function chunkDelivery() {
  return el("p", "Delivery time: Not recorded · Execution records do not identify individual chunks.", "small delivery-time");
}
function tokenUsagePanel(value) {
  const panel = el("details", undefined, "token-usage");
  const unavailable = () => {
    panel.replaceChildren(el("summary", "Contributor token usage · unavailable"),
      el("p", "No authorized counter feed is available. Contributor work continues; missing usage is unknown.", "small"));
    return panel;
  };
  if (value?.status !== "enabled") return unavailable();
  try {
    const count = n => {
      if (n === null) return "unknown";
      if (!Number.isSafeInteger(n) || n < 0) throw new Error("usage count");
      return n.toLocaleString();
    };
    const pair = usage => `${count(usage.input_tokens)} / ${count(usage.output_tokens)}`;
    const own = value.known_own_subtotal;
    panel.append(el("summary", `Contributor token usage · reported input / output ${pair(own.measured)} · partial coverage`),
      el("p", `Known own usage: measured ${pair(own.measured)}; estimated ${pair(own.estimated)}. Cache and reasoning are subsets. Cost is unavailable.`, "small"),
      el("p", `${count(value.agents_observed)} agents reported. Coverage of unreported agents and intervals is unknown. Inclusive and unknown-scope observations stay outside the own subtotal. Purpose attribution is coarse.`, "small"));
    const copy = {
      "reported-parent-counters-missing": "Some reported parents have no counters.",
      "usage-capacity-near-limit-imports-may-be-refused": "Usage storage is near capacity; refused imports preserve existing totals.",
      "unpublished-usage-file-preserved-imports-paused": "An unpublished usage file was preserved; imports need recovery. Work continues.",
    };
    for (const warning of value.warnings || []) if (copy[warning]) panel.append(el("p", copy[warning], "small"));
    for (const [period, title] of [["daily", "Daily"], ["weekly", "Weekly"], ["quarterly", "Quarterly"]]) {
      const rows = value.trends?.[period] || [];
      if (!Array.isArray(rows) || rows.length > 8) throw new Error("usage rows");
      const section = el("section"); section.append(el("h3", `${title} reported trends`));
      const list = el("ul");
      for (const row of rows) {
        if (typeof row.period !== "string" || !/^(?:\d{4}-\d{2}-\d{2}|\d{4}-Q[1-4])$/.test(row.period)) throw new Error("usage period");
        list.append(el("li", `${row.period}: measured input / output ${pair(row.usage.measured)}; estimated ${pair(row.usage.estimated)}; ${count(row.usage.coarse_intervals)} coarse intervals.`));
      }
      if (!rows.length) list.append(el("li", "No reported intervals."));
      section.append(list); panel.append(section);
    }
    const purposes = Object.entries(value.purpose || {});
    if (purposes.length > 8) throw new Error("usage purposes");
    if (purposes.length) {
      const list = el("ul");
      for (const [purpose, usage] of purposes) {
        if (!["planning", "research", "implementation", "tests", "review", "bookkeeping", "mixed", "unclassified"].includes(purpose)) throw new Error("usage purpose");
        if (purpose === "implementation") {
          for (const [phase, row] of Object.entries(usagePhaseMap(value))) list.append(el("li", `${usagePhaseLabels[phase]}: measured ${pair(row.measured)}; estimated ${pair(row.estimated)}.`));
        } else list.append(el("li", `${readable(purpose)}: measured ${pair(usage.measured)}; estimated ${pair(usage.estimated)}.`));
      }
      panel.append(el("h3", "Coarse purpose groups"), list);
    }
    if (!Array.isArray(value.agents) || value.agents.length > 16) throw new Error("usage agents");
    const agents = el("ul");
    for (const agent of value.agents) {
      if (!/^agent-[a-f0-9]{12}$/.test(agent.alias) || agent.parent_alias !== null && !/^agent-[a-f0-9]{12}$/.test(agent.parent_alias)) throw new Error("usage alias");
      agents.append(el("li", `${agent.alias}${agent.parent_alias ? ` (parent ${agent.parent_alias})` : ""}: own measured ${pair(agent.own_usage.measured)}; estimated ${pair(agent.own_usage.estimated)}.`));
    }
    panel.append(el("h3", `Agents (${count(value.agents_shown)} shown)`), agents,
      el("p", "UTC trends attribute intervals to their report end. Sparse or multi-day reports are coarse. Totals cover reported data only; retired detail retains aggregate totals.", "small"));
    return panel;
  } catch { return unavailable(); }
}
const usageFields = ["input_tokens", "output_tokens", "cached_input_tokens", "reasoning_output_tokens"];
const usageFieldNames = ["Input", "Output", "Cached input (subset)", "Reasoning output (subset)"];
const usageRoles = { parent: "Has reported children", child: "Reported child", "parent-and-child": "Child with reported children", unclassified: "Relationship not recorded" };
const usagePhaseLabels = { pre_review: "Implementation", review_fixes: "Post-review implementation fixes", post_review_other: "Other later implementation", mixed: "Mixed phase", unknown: "Phase unknown", legacy_unknown: "Legacy implementation — phase unknown" };
function usagePhaseMap(value) {
  const rows = value.implementation_phases;
  if (rows === undefined) return value.purpose?.implementation ? { legacy_unknown: usageRollup(value.purpose.implementation) } : {};
  if (!rows || Array.isArray(rows) || Object.keys(rows).length !== 6 || Object.keys(rows).some(key => !Object.hasOwn(usagePhaseLabels, key))) throw new Error("usage phases");
  for (const row of Object.values(rows)) usageRollup(row);
  return rows;
}
function phaseUsage(value, overall) {
  return implementationPhaseView === "all" ? overall : value.implementation_phases?.[implementationPhaseView] || null;
}
function phasePair(row, status) {
  return `${usageNumber(row?.[status].input_tokens ?? null)} / ${usageNumber(row?.[status].output_tokens ?? null)}`;
}

function usageNumber(value) {
  if (value === null) return "Unavailable";
  if (!Number.isSafeInteger(value) || value < 0) throw new Error("usage number");
  return value.toLocaleString();
}
function usageRollup(value) {
  for (const status of ["measured", "estimated"]) for (const field of usageFields) usageNumber(value[status][field]);
  for (const field of usageFields) {
    if (value.unavailable_fields[field] === null) throw new Error("usage coverage");
    usageNumber(value.unavailable_fields[field]);
  }
  for (const key of ["intervals", "coarse_intervals"]) {
    if (value[key] === null) throw new Error("usage intervals");
    usageNumber(value[key]);
  }
  for (const key of ["declared", "inferred", "unavailable"]) {
    if (value.purpose_attribution[key] === null) throw new Error("usage purpose basis");
    usageNumber(value.purpose_attribution[key]);
  }
  if (value.phase_attribution !== undefined) {
    if (!value.phase_attribution || Object.keys(value.phase_attribution).length !== 3) throw new Error("usage phase basis");
    for (const key of ["declared", "inferred", "unavailable"]) {
      if (value.phase_attribution[key] === null || value.phase_attribution[key] === undefined) throw new Error("usage phase basis");
      usageNumber(value.phase_attribution[key]);
    }
  }
  if (!Array.isArray(value.provenance) || value.provenance.length > 3 ||
      value.provenance.some(v => !["host-reported", "operator-declared", "unavailable"].includes(v))) throw new Error("usage provenance");
  return value;
}
function usageDashboardData(value) {
  if (value?.status !== "enabled") return { status: value?.status === "disabled" ? "disabled" : "unavailable" };
  try {
    usageRollup(value.known_own_subtotal);
    const phases = usagePhaseMap(value);
    if (value.implementation_phases !== undefined) for (const status of ["measured", "estimated"]) for (const field of usageFields) {
      const known = Object.values(phases).map(row => row[status][field]).filter(number => number !== null);
      const sum = known.length ? known.reduce((total, number) => total + number, 0) : null;
      if (sum !== null && !Number.isSafeInteger(sum) || sum !== (value.purpose.implementation?.[status][field] ?? null)) throw new Error("usage phase conservation");
    }
    for (const scope of ["includes-descendants", "unknown"]) usageRollup(value.unaggregated_scopes[scope]);
    for (const name of ["agents_observed", "agents_shown", "missing_reported_parents"]) {
      if (!Number.isSafeInteger(value[name]) || value[name] < 0 || value[name] > 4096) throw new Error("usage agents");
    }
    if (!Array.isArray(value.agents) || value.agents.length > 16 || value.agents.length !== value.agents_shown || value.agents_shown > value.agents_observed) throw new Error("usage agents");
    const seen = new Set();
    for (const agent of value.agents) {
      if (!/^agent-[a-f0-9]{12}$/.test(agent.alias) || seen.has(agent.alias) ||
          agent.parent_alias !== null && !/^agent-[a-f0-9]{12}$/.test(agent.parent_alias) ||
          agent.role !== undefined && !Object.hasOwn(usageRoles, agent.role) ||
          agent.role_basis !== undefined && agent.role_basis !== "reported-parent-links") throw new Error("usage relationship");
      seen.add(agent.alias); usageRollup(agent.own_usage); if (agent.implementation_phases !== undefined) usagePhaseMap(agent);
    }
    const purposes = Object.entries(value.purpose);
    if (purposes.length > 8 || purposes.some(([key]) => !["planning", "research", "implementation", "tests", "review", "bookkeeping", "mixed", "unclassified"].includes(key))) throw new Error("usage purposes");
    for (const [, row] of purposes) usageRollup(row);
    for (const [period, maximum] of [["daily", 7], ["weekly", 8], ["quarterly", 8]]) {
      const rows = value.trends[period];
      if (!Array.isArray(rows) || rows.length > maximum) throw new Error("usage trends");
      let previous = "";
      for (const row of rows) {
        if (typeof row.period !== "string" || row.period <= previous) throw new Error("usage periods");
        if (period === "quarterly") {
          if (!/^(?:20\d\d|21\d\d|2200)-Q[1-4]$/.test(row.period)) throw new Error("usage quarter");
        } else {
          if (!/^\d{4}-\d{2}-\d{2}$/.test(row.period)) throw new Error("usage date");
          const date = new Date(`${row.period}T00:00:00Z`);
          if (date.toISOString().slice(0, 10) !== row.period || period === "weekly" && date.getUTCDay() !== 1) throw new Error("usage date");
        }
        previous = row.period; usageRollup(row.usage); if (row.implementation_phases !== undefined) usagePhaseMap(row);
      }
    }
    if (value.last_updated !== null && (typeof value.last_updated !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(value.last_updated) ||
        new Date(value.last_updated).toISOString() !== value.last_updated.replace("Z", ".000Z"))) throw new Error("usage updated");
    for (const key of ["bytes", "maximum_bytes", "stream_cursors", "maximum_stream_cursors", "recent_detail", "recent_detail_compacted"]) {
      if (value.storage[key] === null) throw new Error("usage storage");
      usageNumber(value.storage[key]);
    }
    return value;
  } catch { return { status: "unavailable" }; }
}
function usageTable(caption, columns, rows) {
  const wrap = el("div", undefined, "usage-table-wrap");
  wrap.setAttribute("role", "region"); wrap.setAttribute("aria-label", caption); wrap.tabIndex = 0;
  const table = el("table", undefined, "usage-table"); table.append(el("caption", caption));
  const head = el("thead"), headings = el("tr");
  for (const text of columns) { const th = el("th", text); th.scope = "col"; headings.append(th); }
  head.append(headings); table.append(head);
  const body = el("tbody");
  for (const row of rows) {
    const tr = el("tr");
    row.forEach((text, index) => { const cell = el(index ? "td" : "th", text); if (!index) cell.scope = "row"; tr.append(cell); });
    body.append(tr);
  }
  if (!rows.length) { const tr = el("tr"), cell = el("td", "No reported intervals or records. Missing data is not zero."); cell.colSpan = columns.length; tr.append(cell); body.append(tr); }
  table.append(body); wrap.append(table); return wrap;
}
function usageSection(title, description) {
  const section = el("section", undefined, "card usage-section");
  section.append(el("h2", title), el("p", description, "usage-description")); return section;
}
function tokenUsageDashboard(input) {
  const value = usageDashboardData(input), enabled = value.status === "enabled";
  const body = el("div", undefined, "usage-dashboard");
  const empty = { measured: { input_tokens: null, output_tokens: null }, estimated: { input_tokens: null, output_tokens: null } };
  const own = enabled ? value.known_own_subtotal : empty;
  const metrics = [metric(usageNumber(own.measured.input_tokens), "Reported measured input"), metric(usageNumber(own.measured.output_tokens), "Reported measured output"),
    metric(usageNumber(own.estimated.input_tokens), "Estimated input"), metric(usageNumber(own.estimated.output_tokens), "Estimated output")];
  const known = enabled && usageFields.some(field => own.measured[field] !== null);
  const coverage = usageSection(known ? "Partial reported usage" : "Own measurements unavailable",
    "This page reads recorded observations. Selected local response counters or a configured numeric host bridge can supply usage; run usage session-start to validate recent capture. Adapter readiness alone is not live capture. Coverage is partial. Measured means source-reported; declarations are not independently verified.");
  coverage.append(el("p", enabled ? `Last imported observation: ${value.last_updated || "Not recorded"}. ${usageNumber(value.agents_observed)} agents reported; ${usageNumber(value.agents_shown)} shown. Coverage of unreported agents and intervals is unknown.` :
    value.status === "disabled" ? "Optional local retention is not enabled. No measurements have been filled in." : "Usage data is missing or could not be validated. Other review pages remain usable; no measurements have been filled in.", "usage-note"));
  if (enabled) {
    coverage.append(el("p", `${usageNumber(value.missing_reported_parents)} reported parents have no counters. Only own usage joins the subtotal; inclusive and unknown scopes remain separate.`, "usage-description"));
    const warnings = {
      "usage-capacity-near-limit-imports-may-be-refused": "Storage is near its bound. Refused imports preserve existing totals and are not counted.",
      "unpublished-usage-file-preserved-imports-paused": "An unpublished usage file was preserved. Imports need recovery; contributor work continues.",
    };
    for (const key of Array.isArray(value.warnings) ? value.warnings.slice(0, 12) : []) if (warnings[key]) coverage.append(el("p", warnings[key], "usage-note"));
    coverage.append(el("p", `Local storage: ${usageNumber(value.storage.bytes)} of ${usageNumber(value.storage.maximum_bytes)} bytes; ${usageNumber(value.storage.recent_detail_compacted)} recent detail rows compacted. Aggregate totals remain retained.`, "usage-description"));
  }
  body.append(coverage);
  const breakdown = usageSection("Input and output breakdown", "Cached input is part of input. Reasoning output is part of output. Subsets are never added again; unavailable is different from measured zero.");
  breakdown.append(usageTable("Reported own token counts", ["Count", "Reported measured", "Estimated", "Unavailable field observations"], usageFields.map((field, index) =>
    [usageFieldNames[index], usageNumber(enabled ? own.measured[field] : null), usageNumber(enabled ? own.estimated[field] : null), enabled ? usageNumber(own.unavailable_fields[field]) : "Unavailable"])));
  body.append(breakdown);
  const phases = usageSection("Implementation phases", "Implementation contains only attributed pre-review work. Review-driven fixes, other later work and legacy or uncertain attribution stay separate. Numeric measurement is independent of declared phase; a crossing response stays mixed or unknown.");
  phases.append(usageTable("Implementation phase counts", ["Phase", "Measured input / output", "Estimated input / output", "Attribution"], enabled ? Object.entries(usagePhaseMap(value)).map(([phase, row]) =>
    [usagePhaseLabels[phase], phasePair(row, "measured"), phasePair(row, "estimated"), row.phase_attribution ? ["declared", "inferred", "unavailable"].map(key => usageNumber(row.phase_attribution[key])).join(" / ") : "Unavailable"]) : []));
  const label = el("label", "Trend and agent view "); label.htmlFor = "usage-phase-filter";
  const filter = el("select"); filter.id = "usage-phase-filter";
  for (const [key, title] of Object.entries({ all: "All reported usage", ...usagePhaseLabels })) { const option = el("option", title); option.value = key; option.selected = implementationPhaseView === key; filter.append(option); }
  filter.addEventListener("change", () => { implementationPhaseView = Object.hasOwn(usagePhaseLabels, filter.value) ? filter.value : "all"; render(); });
  label.append(filter); phases.append(label); body.append(phases);
  const trends = el("div", undefined, "usage-trends");
  for (const [period, title, maximum] of [["daily", "Daily", 7], ["weekly", "Weekly", 8], ["quarterly", "Quarterly", 8]]) {
    const section = usageSection(`${title} trends`, `Latest ${maximum} reported UTC periods. Sparse reports are attributed to the interval end; multi-day intervals remain coarse.`);
    const rows = enabled ? value.trends[period] : [];
    section.append(usageTable(`${title} input and output`, ["Period", "Measured input", "Measured output", "Estimated input", "Estimated output", "Coarse intervals"], rows.map(row => { const selected = phaseUsage(row, row.usage); return [row.period, usageNumber(selected?.measured.input_tokens ?? null), usageNumber(selected?.measured.output_tokens ?? null), usageNumber(selected?.estimated.input_tokens ?? null), usageNumber(selected?.estimated.output_tokens ?? null), selected ? usageNumber(selected.coarse_intervals) : "Unavailable"]; })));
    trends.append(section);
  }
  body.append(trends);
  const purposes = usageSection("Coarse purpose groups", "Purpose comes from declared or inferred task labels. It is separate from measurement status; no per-call category is required.");
  purposes.append(usageTable("Own usage by purpose", ["Purpose", "Measured input / output", "Estimated input / output", "Declared / inferred / unavailable labels"], enabled ? Object.entries(value.purpose).filter(([name]) => name !== "implementation").map(([name, row]) =>
    [readable(name), `${usageNumber(row.measured.input_tokens)} / ${usageNumber(row.measured.output_tokens)}`, `${usageNumber(row.estimated.input_tokens)} / ${usageNumber(row.estimated.output_tokens)}`,
      ["declared", "inferred", "unavailable"].map(key => usageNumber(row.purpose_attribution[key])).join(" / ")]) : []));
  body.append(purposes);
  const agents = usageSection("Observed agent relationships", "Relationships use reported parent links only. They do not identify job roles or prove that every child is represented. Aliases hide original agent identifiers.");
  agents.append(usageTable("Own usage by reported agent", ["Agent alias", "Observed relationship", "Reported parent", "Measured input / output", "Estimated input / output"], enabled ? value.agents.map(agent =>
    [agent.alias, usageRoles[agent.role] || usageRoles.unclassified, agent.parent_alias || "Not recorded", phasePair(phaseUsage(agent, agent.own_usage), "measured"),
      phasePair(phaseUsage(agent, agent.own_usage), "estimated")]) : []));
  body.append(agents);
  const excluded = usageSection("Separately reported scopes", "These counts are excluded from the own subtotal. Parent rollups plus children are not added together.");
  excluded.append(usageTable("Scopes outside the own subtotal", ["Scope", "Measured input / output", "Estimated input / output"], enabled ? ["includes-descendants", "unknown"].map(scope => {
    const row = value.unaggregated_scopes[scope]; return [readable(scope), `${usageNumber(row.measured.input_tokens)} / ${usageNumber(row.measured.output_tokens)}`, `${usageNumber(row.estimated.input_tokens)} / ${usageNumber(row.estimated.output_tokens)}`];
  }) : [])); body.append(excluded);
  const guidance = usageSection("Supplying measurements", "An authorized host must supply real counters with explicit scope and provenance. Account quotas, billing assumptions and transcript scans cannot substitute. Missing telemetry never blocks work.");
  guidance.append(el("pre", "python dev-tools/helpers/development_control_plane.py usage enable\npython dev-tools/helpers/development_control_plane.py usage import --from .local-codex/usage-export.json\npython dev-tools/helpers/development_control_plane.py usage summary --period quarterly --limit 40", "usage-commands"));
  body.append(guidance); return { metrics, body };
}
function selectView(next, query = "", increment = null, work = null) {
  if (view !== next) lastDigest = "";
  view = next;
  if (next === "token_usage") { linkedIncrement = null; render(); refresh(); return; }
  if (work !== null && !data?.pagination) query = work;
  if (data?.pagination) {
    const parts = query.split("/");
    pageRequests[next] = { page: 1, roadmap: next === "roadmaps" ? query : parts[0],
      increment: next === "work_items" ? parts[1] || "" : "", work: work || "" };
    linkedIncrement = next === "roadmaps" && increment !== null ? { roadmap: query, increment } : null;
    document.querySelector("#search").value = "";
    refresh();
    return;
  }
  if (next === "roadmaps" && increment !== null) {
    const key = incrementKey(query, increment);
    if (incrementIdentities.get(key) === 1) incrementChoices.set(key, true);
  }
  document.querySelector("#search").value = query;
  document.querySelectorAll(".nav").forEach(b => { b.classList.toggle("active", b.dataset.view === next); b.setAttribute("aria-current", b.dataset.view === next ? "page" : "false"); });
  render();
}
function disclosure(key, className, automatic = false) {
  const details = el("details", undefined, className);
  const unique = incrementIdentities.get(key) === 1;
  details.open = unique && (incrementChoices.has(key) ? incrementChoices.get(key) : automatic);
  let observed = details.open;
  details.addEventListener("toggle", () => {
    // Setting open during rendering can queue a browser toggle event. It is
    // not a user choice and must not pin an automatically opened panel open.
    if (unique && details.isConnected && details.open !== observed) {
      observed = details.open;
      incrementChoices.set(key, observed);
    }
  });
  // Native summary activation also covers keyboard use. Retain intent even
  // when rapid activations coalesce into one toggle event.
  details.addEventListener("click", event => {
    if (unique && details.isConnected && event.target.closest?.("summary")?.parentElement === details && !event.defaultPrevented)
      incrementChoices.set(key, !details.open);
  });
  return details;
}
function incrementDisclosure(roadmap, increment, history = null) {
  return disclosure(incrementKey(roadmap, increment.id, history), "increment", history === null && increment.actively_worked === true);
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
        local.append(action("View supporting work", () => selectView("work_items", "", null, s.work_id)));
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
  body.append(el("p", chunk.outcome, "objective"), chunkDelivery());
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
  const increment = (data.pagination ? data.work_item_roadmaps : data.roadmaps).find(roadmap => roadmap.id === item.roadmap_id)
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
      empty.append(el("p", query ? `No matching ${key} roadmaps on this page. Try a different title or outcome.` : data.pagination ? `No ${key} roadmaps on this page.` : complete ? "No completed roadmaps yet." : "No open roadmaps."));
      section.append(empty);
    }
    sections[key] = section; parent.append(section);
  }
  return sections;
}
function render() {
  if (view === "token_usage") {
    for (const key of Object.keys(names)) document.querySelector(`#count-${key}`).textContent = data?.totals?.[key] ?? data?.[key]?.length ?? 0;
    document.querySelectorAll(".nav").forEach(b => { b.classList.toggle("active", b.dataset.view === view); b.setAttribute("aria-current", b.dataset.view === view ? "page" : "false"); });
    document.querySelector("#heading").textContent = "Token usage";
    document.querySelector("#subtitle").textContent = "Reported usage, trends and coverage. Unavailable counters stay unknown.";
    document.querySelector(".toolbar").hidden = true;
    const dashboard = tokenUsageDashboard(data?.token_usage), summary = document.querySelector("#summary");
    summary.classList.add("usage-overview"); summary.replaceChildren(...dashboard.metrics);
    document.querySelector("#items").replaceChildren(dashboard.body);
    document.querySelector("#fingerprint").textContent = data ? `Source ${data.source_digest.slice(0, 12)}` : "Usage data not available";
    return;
  }
  if (!data) {
    document.querySelector("#heading").textContent = names[view];
    document.querySelector("#subtitle").textContent = "From intended outcomes to verified software.";
    document.querySelector(".toolbar").hidden = false;
    const summary = document.querySelector("#summary"); summary.classList.remove("usage-overview"); summary.replaceChildren();
    const empty = el("div", undefined, "empty"); empty.append(el("h2", "Review data unavailable"), el("p", "Retry the JSON connection to view saved work."));
    document.querySelector("#items").replaceChildren(empty);
    document.querySelector("#fingerprint").textContent = "Review data not available";
    return;
  }
  if (data.pagination && data.pagination.view !== view) return;
  document.querySelector(".toolbar").hidden = false;
  document.querySelector("#summary").classList.remove("usage-overview");
  document.querySelector("#subtitle").textContent = "From intended outcomes to verified software.";
  if (disclosureRepository !== (data.repository_id || "")) {
    incrementChoices.clear();
    disclosureRepository = data.repository_id || "";
  }
  incrementIdentities = new Map();
  const countIdentity = (key, unique = true) => incrementIdentities.set(key, (incrementIdentities.get(key) || 0) + (unique === false ? 2 : 1));
  for (const roadmap of data.roadmaps) {
    for (const increment of roadmap.increments || []) countIdentity(incrementKey(roadmap.id, increment.id), increment.disclosure_unique);
    for (const history of roadmap.merged_history || []) {
      countIdentity(incrementKey(roadmap.id, null, history.id), history.disclosure_unique);
      for (const increment of history.increments || []) countIdentity(incrementKey(roadmap.id, increment.id, history.id), increment.disclosure_unique);
    }
  }
  // Use the complete incoming view, before search or section filtering. An
  // ambiguous identity cannot inherit another row's manual choice or focus.
  for (const key of incrementChoices.keys()) if (incrementIdentities.has(key) && incrementIdentities.get(key) !== 1 || !data.pagination && !incrementIdentities.has(key)) incrementChoices.delete(key);
  if (linkedIncrement) {
    const key = incrementKey(linkedIncrement.roadmap, linkedIncrement.increment);
    if (incrementIdentities.get(key) === 1) incrementChoices.set(key, true);
    linkedIncrement = null;
  }
  for (const key of Object.keys(names)) document.querySelector(`#count-${key}`).textContent = data.totals?.[key] ?? data[key].length;
  document.querySelectorAll(".nav").forEach(b => { b.classList.toggle("active", b.dataset.view === view); b.setAttribute("aria-current", b.dataset.view === view ? "page" : "false"); });
  document.querySelector("#heading").textContent = names[view];
  const all = data[view];
  const done = all.filter(i => view === "roadmaps" ? completedRoadmap(i) : ["completed", "complete", "closed", "final-approved"].includes(i.status)).length;
  const active = all.filter(i => view === "roadmaps" ? roadmapDisplayStatus(i) === "in-progress" : ["executing", "active", "verifying", "prepared"].includes(i.status)).length;
  const summary = document.querySelector("#summary"); summary.replaceChildren(metric(data.pagination?.total_records ?? all.length, "Total records"), metric(active, data.pagination ? "In progress on page" : "In progress"), metric(done, data.pagination ? "Completed on page" : "Completed"), metric(all.reduce((n, i) => n + (i.blocker_count || 0), 0), data.pagination ? "Human actions on page" : "Human actions needed"));
  const query = document.querySelector("#search").value.toLowerCase();
  const selected = all.filter(i => JSON.stringify([i.title, i.id, i.objective, i.outcome, i.roadmap_title, i.increment_title, i.criteria_ids, i.merged_history]).toLowerCase().includes(query));
  const items = document.querySelector("#items"); items.replaceChildren();
  if (view === "work_items") items.append(tokenUsagePanel(data.token_usage));
  if (data.pagination) items.append(pageControls());
  if (view === "roadmaps") items.append(roadmapStatusLegend());
  const sections = view === "roadmaps" ? roadmapSections(items, selected, query) : null;
  if (view === "work_items" && data.inventory?.execution_records_truncated && Number.isSafeInteger(data.inventory.execution_records_shown) && Number.isSafeInteger(data.inventory.execution_records_total)) items.append(el("p", `Showing the newest ${data.inventory.execution_records_shown} of ${data.inventory.execution_records_total} scoped execution records; the remaining records are outside this bounded display.`, "small inventory-limit"));
  if (!selected.length && !sections) { const empty = el("div", undefined, "empty"); const filtered = data.pagination?.roadmap || data.pagination?.work; empty.append(el("h2", query || filtered ? "No matching work" : `No ${names[view].toLowerCase()} yet`), el("p", filtered ? "No records match this selection. Use Show all to browse saved records." : query ? "Try a different title or outcome." : "New JSON records will appear here as the workflow creates them.")); items.append(empty); }
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
        const archive = disclosure(incrementKey(item.id, null, legacy.id), "merged-history");
        archive.append(el("summary", `Merged history: ${legacy.title}`), el("p", data.presentation_view ? legacy.objective : legacy.summary, "small"),
          el("p", "Historical evidence preserved. Remaining execution belongs to this roadmap; no legacy or current qualification pass is inferred.", "small"));
        appendScope(archive, legacy);
        for (const increment of legacy.increments || []) {
          const detail = incrementDisclosure(item.id, increment, legacy.id);
          const heading = el("summary"); heading.append(el("span", `${increment.number}. ${increment.title}`), badge(increment.status === "blocked" ? "archived-pending" : increment.status));
          detail.append(heading, incrementDelivery(increment));
          if (data.presentation_view) detail.append(el("p", increment.objective));
          appendScope(detail, increment);
          const proposal = proposalDetails(increment); if (proposal) detail.append(proposal); detail.append(criteriaList(increment.criteria || []));
          for (const chunk of increment.chunks || []) detail.append(el("p", `${chunk.title}: ${readable(chunk.status)}${chunk.summary ? ` · ${chunk.summary}` : ""}`, "small"), chunkDelivery());
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
        const details = incrementDisclosure(item.id, i);
        const summary = el("summary"); const heading = el("span", `${i.number}. ${i.title}`); summary.append(heading, badge(i.status === "blocked" && !item.blockers?.some(row => row.action_owner === "human") ? "status-review-needed" : i.status)); details.append(summary, el("p", i.objective, "objective"));
        appendScope(details, i);
        details.append(incrementDelivery(i));
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
        card.append(el("p", `Delivery time: ${m.elapsed_ms === null ? "pending" : formatDeliveryTime(m.elapsed_ms) ?? "unavailable"} · Provider cost and tokens: unavailable`, "small"));
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
let refreshQueued = false;
function pageControls() {
  const paging = data.pagination;
  const controls = el("nav", undefined, "pagination"); controls.setAttribute("aria-label", `${names[view]} pages`);
  const move = direction => { view = paging.view; pageRequests[view].page = paging.page + direction; refresh(); };
  const previous = action("Previous page", () => move(-1)); previous.disabled = paging.page <= 1;
  const next = action("Next page", () => move(1)); next.disabled = paging.page >= paging.total_pages;
  controls.append(previous, el("span", `Page ${paging.page} of ${paging.total_pages} · ${paging.total_records} records`, "page-count"), next,
    el("span", "Search filters this page. All records remain saved.", "small"));
  if (paging.roadmap || paging.work) controls.append(el("span", paging.work ? "Showing the selected supporting-work record." : paging.increment ? "Showing work for the selected increment." : "Showing the selected roadmap.", "small"), action(`Show all ${names[view].toLowerCase()}`, () => selectView(paging.view)));
  return controls;
}
function pageUrl() {
  if (view === "token_usage") return "/api/review?view=work_items&page=1";
  const request = pageRequests[view];
  return `/api/review?view=${view}&page=${request.page}${request.roadmap ? `&roadmap=${encodeURIComponent(request.roadmap)}` : ""}${request.increment ? `&increment=${encodeURIComponent(request.increment)}` : ""}${request.work ? `&work=${encodeURIComponent(request.work)}` : ""}`;
}
function validatePage(value, requestedView, requested) {
  if (!Object.hasOwn(value, "pagination")) {
    if (Object.hasOwn(value, "totals") || Object.hasOwn(value, "work_item_roadmaps")) throw new Error("incomplete page contract");
    return; // Complete legacy representation remains readable.
  }
  const p = value.pagination;
  const keys = ["view", "page", "page_size", "total_records", "total_pages", "roadmap", "increment", "work"];
  const count = n => Number.isSafeInteger(n) && n >= 0 && n <= 3000000;
  if (!p || typeof p !== "object" || Array.isArray(p) || Object.keys(p).length !== keys.length
    || keys.some(key => !Object.hasOwn(p, key)) || p.view !== requestedView || p.roadmap !== requested.roadmap || p.increment !== requested.increment || p.work !== requested.work
    || typeof value.disclosure_digest !== "string" || !/^[a-f0-9]{64}$/.test(value.disclosure_digest)
    || p.page_size !== pageSizes[requestedView] || !count(p.total_records) || !count(p.total_pages) || !count(p.page)
    || p.total_pages !== Math.max(1, Math.ceil(p.total_records / p.page_size)) || p.page !== Math.min(requested.page, p.total_pages)
    || !value.totals || Object.keys(value.totals).length !== Object.keys(pageSizes).length
    || Object.keys(pageSizes).some(key => !count(value.totals[key]) || !Array.isArray(value[key])
      || value[key].length !== (key === requestedView ? Math.min(p.page_size, Math.max(0, p.total_records - (p.page - 1) * p.page_size)) : 0))
    || value.totals[requestedView] < p.total_records || !requested.roadmap && !requested.work && value.totals[requestedView] !== p.total_records || !Array.isArray(value.work_item_roadmaps) || value.work_item_roadmaps.length > 25
    || requestedView !== "work_items" && value.work_item_roadmaps.length !== 0
    || requested.roadmap && value[requestedView].some(row => row?.[requestedView === "roadmaps" ? "id" : "roadmap_id"] !== requested.roadmap
      || requested.increment && row.increment_id !== requested.increment)
    || requested.work && value.work_items.some(row => row?.id !== requested.work)) throw new Error("page contract");
}
function observeDisclosureIdentity(next) {
  if (disclosureRepository !== (next.repository_id || "") || next.pagination && disclosureIdentityDigest !== next.disclosure_digest) incrementChoices.clear();
  disclosureRepository = next.repository_id || "";
  disclosureIdentityDigest = next.pagination ? next.disclosure_digest : null;
}
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
function expandedReviewWorkItems(value) {
  if (!Array.isArray(value.work_items)) throw new Error("work items");
  if (!Object.hasOwn(value, "work_item_format")) return value.work_items;
  if (value.work_item_format !== "roadmap-chunk-refs-v1") throw new Error("work format");
  const fields = ["id", "source", "roadmap_id", "increment_id", "chunk_id", "increment_number", "chunk_number", "created_at"];
  const index = new Map();
  const parents = value.pagination ? value.work_item_roadmaps : value.roadmaps;
  if (value.pagination) {
    const seen = new Set();
    for (const parent of parents) {
      if (!parent || typeof parent.id !== "string" || !parent.id || seen.has(parent.id) || !Array.isArray(parent.increments) || !parent.increments.length || parent.increments.length > 25) throw new Error("work parents");
      seen.add(parent.id); const increments = new Set();
      for (const increment of parent.increments) {
        if (!increment || typeof increment.id !== "string" || !increment.id || increments.has(increment.id) || !Array.isArray(increment.chunks) || !increment.chunks.length || increment.chunks.length > 25) throw new Error("work parents");
        increments.add(increment.id);
      }
    }
  }
  for (const roadmap of parents) for (const increment of roadmap.increments) for (const chunk of increment.chunks) {
    const id = [roadmap.id, increment.id, chunk.id].join("/");
    if (index.has(id)) throw new Error("ambiguous work item");
    const criteria = increment.criteria.filter(c => chunk.criteria_ids.includes(c.id))
      .map(c => Object.fromEntries(["id", "outcome", "qualification", "evaluation_mode"].filter(k => Object.hasOwn(c, k)).map(k => [k, c[k]])));
    index.set(id, { ...chunk, id, chunk_id: chunk.id, source: "roadmap-chunk", roadmap_id: roadmap.id,
      roadmap_title: roadmap.title, increment_id: increment.id, increment_number: increment.number,
      increment_title: increment.title, criteria, evidence_policy: roadmap.evidence_policy });
  }
  const seen = new Set(), joined = new Set();
  const expanded = value.work_items.map(row => {
    if (!row || typeof row !== "object" || Array.isArray(row) || typeof row.id !== "string" || seen.has(row.id)) throw new Error("work item");
    seen.add(row.id);
    if (row.source === "execution" && !index.has(row.id)) return row;
    const full = index.get(row.id);
    if (row.source !== "roadmap-chunk" || !full || Object.keys(row).length !== fields.length
      || fields.some(k => !Object.hasOwn(row, k) || row[k] !== full[k])) throw new Error("chunk reference");
    joined.add(row.id);
    return full;
  });
  if (joined.size !== index.size) throw new Error("incomplete work items");
  return expanded;
}
async function refresh() {
  if (fetching) { refreshQueued = true; return; } fetching = true;
  const requestedView = view === "token_usage" ? "work_items" : view;
  const requested = view === "token_usage" ? { page: 1, roadmap: "", increment: "", work: "" } : { ...pageRequests[view] }, url = pageUrl();
  try {
    const response = await fetch(url, { cache: "no-store", credentials: "omit",
      headers: { "X-Review-Work-Items": "roadmap-chunk-refs-v1" } });
    if (!response.ok) throw new Error("unavailable");
    const next = await response.json();
    if (next.schema_version !== "development-review-v1") throw new Error("schema");
    validatePage(next, requestedView, requested);
    const workItems = expandedReviewWorkItems(next);
    observeDisclosureIdentity(next);
    if (url !== pageUrl()) { refreshQueued = true; return; }
    data = { ...next, work_items: workItems };
    if (next.pagination && view !== "token_usage") pageRequests[view].page = next.pagination.page;
    if (lastDigest !== data.source_digest) { lastDigest = data.source_digest; render(); }
    document.querySelector("#connection").textContent = "Live · JSON connected";
    document.querySelector("#updated").textContent = `Checked ${new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}`;
    const error = document.querySelector("#error");
    error.textContent = reviewNotice(data.diagnostics);
    error.hidden = !error.textContent;
  } catch {
    document.querySelector("#connection").textContent = "Connection interrupted";
    const error = document.querySelector("#error"); error.hidden = false; error.textContent = "The local review server is unavailable. Retry, or start it using the documented review-site command.";
  } finally { fetching = false; if (refreshQueued) { refreshQueued = false; refresh(); } }
}
initializeTheme();
document.querySelectorAll(".nav").forEach(button => button.addEventListener("click", () => selectView(button.dataset.view)));
document.querySelector("#search").addEventListener("input", render);
document.querySelector("#refresh").addEventListener("click", refresh);
refresh();
setInterval(refresh, 5000);
