import {createHash, randomUUID} from "node:crypto";
import {expect, type Locator, type Page} from "@playwright/test";
import type {HeadlessSavedContextReference, HeadlessContextTaskValue} from "../../../../../modules/contracts/headless";
import {CONTEXT_FIXTURE_MODEL_RECORD} from "../headless-context-fixture";

export type ContextCall = (name: string, args: Record<string, unknown>) => Promise<{ok?: boolean; code?: string; value?: any}>;
export function contextLeaseRetirementConfirmed(status: Awaited<ReturnType<ContextCall>>) {
  return status.ok === true && (status.value?.kind === "ended" ||
    status.value?.kind === "request" && status.value.request?.status === "ended");
}
export const contextWorkflowFacts = () => ({packSaved: false, ragSaved: false, queryCitations: 0, queriesGrounded: 0,
  rebuildSaved: false, replayChecks: 0, denialChecks: 0, presentations: 0, revoked: false});

/** The callers supply actual authenticated MCP connections and their real app UI.
 * No runtime, vector, result, approval or save substitute is accepted here. */
export async function runHeadlessContextWorkflow(options: {
  page: Page; workspace: {workspaceId: string; hostIncarnationId: string}; call: ContextCall;
  openSettings: () => Promise<Locator>; connectPresentation: () => Promise<ContextCall>;
  dataButtonLabel: "Data" | "Artifacts"; facts: ReturnType<typeof contextWorkflowFacts>;
  revokedContextCodes: readonly string[];
  reportStage: (phase: string) => void; onWorkerStart: () => void;
}) {
  const {page, workspace, call, openSettings, connectPresentation, dataButtonLabel, facts, reportStage, onWorkerStart} = options;
  const {workspaceId} = workspace;
  async function approve(step: Record<string, unknown>, channel: "popup" | "chat" = "popup") {
    const preview = await call("aisb_preview_build_plan", {...workspace, steps: [step]});
    expect(preview.ok, "The exact Context plan must preview").toBe(true);
    const fingerprint = preview.value.fingerprint as string;
    expect(fingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(await call("aisb_request_build_plan_approval", {...workspace, fingerprint, steps: [step]}))
      .toMatchObject({ok: true, value: {status: "pending", approvedSteps: 0, stepCount: 1}});
    const target = {...workspace, fingerprint, approvalRevision: 2, step: 1};
    expect((await call("aisb_run_approved_build_step", target)).ok).toBe(false); facts.denialChecks++;
    const region = await openSettings();
    await region.getByRole("button", {name: channel === "popup" ? "Review plan requests" : "Open plan approval chat", exact: true}).click();
    const panel = page.getByRole(channel === "popup" ? "dialog" : "region", {name: channel === "popup" ? "Review plan requests" : "Plan approval chat", exact: true});
    await panel.getByRole("button", {name: new RegExp("^Review request " + fingerprint.slice(0, 8))}).click();
    const permissions = panel.getByRole("list", {name: "Permissions and limits"});
    const changes = panel.getByRole("list", {name: "Requested changes"});
    await expect(permissions).toContainText("No outside service calls or provider charges.");
    if (step.operation === "data.save-local-source") {
      await expect(permissions).toContainText("Save the listed files");
      await expect(changes).toContainText("Save the selected file in Data");
      await expect(changes).toContainText(String(step.fileId));
      await expect(changes).toContainText(`Upload ${step.taskId}, version ${step.taskRevision}`);
    } else if (step.operation === "context.save-result") {
      await expect(permissions).toContainText("This save starts no model or processing task.");
      await expect(changes).toContainText(`Save reviewed Context: ${step.name}`);
      await expect(changes).toContainText(`Context task: ${step.taskId}`);
      await expect(changes).toContainText(`Reviewed result: ${step.reportFingerprint}`);
    } else if (step.operation === "context.query") {
      await expect(permissions).toContainText("Return only source references, scores and citation locations.");
      await expect(permissions).toContainText("This search does not save or publish data.");
      await expect(changes).toContainText("Search a saved RAG database");
      await expect(changes).toContainText(String(step.queryDigest));
      const reference = step.reference as HeadlessSavedContextReference;
      for (const text of [reference.contextId, reference.taskId, reference.artifactDigest, String(step.modelRecordId), String(step.modelUpdatedAt),
        `Device: ${step.embeddingDevice}. Return at most ${step.maximumResults} citation results.`]) await expect(changes).toContainText(text);
    } else {
      const settings = step.settings as Record<string, any>;
      const rag = step.operation === "context.generate-rag", parent = step.rebuildOf as HeadlessSavedContextReference | undefined;
      await expect(changes).toContainText(`${parent ? rag ? "Rebuild RAG database" : "Rebuild Context pack" : rag ? "Build RAG database" : "Prepare Context pack"}: ${step.name}`);
      await expect(permissions).toContainText(rag ? "Read the exact listed model record" : "Preparing this Markdown pack makes no model calls and installs no models.");
      await expect(changes).toContainText("Result review and a separate save request are required.");
      for (const source of step.sources as {taskId: string; fileId: string; taskRevision: number}[]) {
        await expect(changes).toContainText(`File reference ${source.fileId}. Upload ${source.taskId}, version ${source.taskRevision}.`);
      }
      await expect(changes).toContainText(`Text fields: ${settings.textFields.join(", ")}.`);
      await expect(changes).toContainText(`Chunk size: ${settings.chunkCharacters} characters.`);
      await expect(changes).toContainText(`Overlap: ${settings.overlapCharacters} characters. Maximum chunks: ${settings.maximumChunks}.`);
      if (rag) for (const text of [settings.modelRecordId, settings.modelUpdatedAt,
        `Device: ${settings.device}. Embedding batch size: ${settings.batchSize}.`, "Require license: No.", "Include source attribution: Yes."]) await expect(changes).toContainText(text);
      if (parent) for (const text of [parent.contextId, parent.taskId, parent.artifactDigest, "Keep the saved Context unchanged."]) await expect(changes).toContainText(text);
    }
    await panel.getByRole("button", {name: "Approve change 1", exact: true}).click();
    await expect(panel.getByText("Plan approved.", {exact: true})).toBeVisible();
    await panel.getByRole("button", {name: channel === "popup" ? "Close plan review" : "Close plan approval chat", exact: true}).click();
    const status = await call("aisb_build_plan_approval_status", {...workspace, fingerprint});
    expect(status).toMatchObject({ok: true, value: {status: "approved", approvedSteps: 1}});
    return {...target, approvalRevision: status.value.revision as number};
  }
  async function generate(step: Record<string, unknown>) {
    const target = await approve(step, step.operation === "context.generate-pack" ? "chat" : "popup");
    onWorkerStart();
    const start = await call("aisb_run_approved_build_step", target);
    if (!start.ok && typeof start.code === "string" && /^headless\.[a-z-]{1,48}$/.test(start.code))
      reportStage((step.operation === "context.generate-pack" ? "pack" : "rag") + "-start-" + start.code);
    if (start.ok) expect(start).toMatchObject({value: {kind: "started", operation: step.operation}});
    else expect(start.code).toBe("headless.operation-unconfirmed");
    let task: HeadlessContextTaskValue | undefined;
    await expect.poll(async () => {
      const result = await call("aisb_context_task", {...workspace, selection: {kind: "plan-step", fingerprint: target.fingerprint, step: 1}});
      if (!result.ok) { expect(["headless.forbidden", "headless.unavailable"]).toContain(result.code); return "awaiting"; }
      if (task) expect(result.value.taskId).toBe(task.taskId);
      task = result.value; return result.value.state;
    }, {timeout: 90_000, intervals: [250, 500, 1000], message: "The actual Context worker must produce a reviewable result"}).toBe("review-required");
    const value = task as Extract<HeadlessContextTaskValue, {review: unknown}>;
    expect(value.review).toMatchObject({kind: step.operation === "context.generate-pack" ? "markdown-context-pack" : "rag-database",
      reportFingerprint: expect.stringMatching(/^[a-f0-9]{64}$/), sourceCount: 1, requiresExplicitSave: true});
    expect(value.review!.chunkCount).toBeGreaterThan(0);
    expect(await call("aisb_run_approved_build_step", target)).toMatchObject({ok: true, value: {kind: "replayed", reference: {taskId: value.taskId}}}); facts.replayChecks++;
    expect(await call("aisb_context_task", {...workspace, selection: {kind: "task", taskId: randomUUID()}})).toMatchObject({ok: false}); facts.denialChecks++;
    const saveStep = {operation: "context.save-result", idempotencyKey: randomUUID(), taskId: value.taskId,
      reportFingerprint: value.review!.reportFingerprint, name: step.name};
    const saveTarget = await approve(saveStep);
    const saved = await call("aisb_run_approved_build_step", saveTarget);
    expect(saved).toMatchObject({ok: true, value: {kind: "committed", reference: {workspaceId, taskId: value.taskId, kind: value.review!.kind}}});
    const reference = saved.value.reference as HeadlessSavedContextReference;
    expect(await call("aisb_run_approved_build_step", saveTarget)).toMatchObject({ok: true, value: {kind: "replayed", reference}}); facts.replayChecks++;
    const read = await call("aisb_read_context", {...workspace, contextId: reference.contextId});
    expect(read).toMatchObject({ok: true, value: {reference, name: step.name, sourceCount: 1, byteAvailability: "not-checked"}});
    return {reference, read, taskId: value.taskId};
  }

  reportStage("import");
  await page.getByRole("button", {name: dataButtonLabel, exact: true}).click();
  await page.getByRole("tab", {name: "Artifact Ingestion", exact: true}).click();
  const ingestion = page.getByRole("list", {name: "Add data workflow", exact: true});
  const contents = Buffer.from("team,priority\nBilling support checks invoice dates before sending a replacement invoice.,Confirm the billing record and invoice period.\nAccount support helps customers restore sign in.,Send the approved password reset instructions.\n");
  await ingestion.getByLabel("Choose one or more files", {exact: true}).setInputFiles({name: "synthetic-context.csv", mimeType: "text/csv", buffer: contents});
  const chatClient = ingestion.getByRole("combobox", {name: "Chat client", exact: true});
  await expect(chatClient.locator("option")).toHaveCount(2);
  if (await chatClient.inputValue() === "") await chatClient.selectOption({index: 1});
  await expect(chatClient).not.toHaveValue("");
  await ingestion.getByRole("button", {name: "Prepare for chat", exact: true}).click();
  const selected = JSON.parse(await ingestion.getByRole("textbox", {name: "File reference", exact: true}).inputValue());
  const sourceTarget = await approve({operation: "data.save-local-source", taskId: selected.taskId, fileId: selected.fileId,
    taskRevision: selected.taskRevision, idempotencyKey: randomUUID()});
  expect(await call("aisb_run_approved_build_step", sourceTarget)).toMatchObject({ok: true, value: {kind: "committed"}});
  const sourceStatus = await call("aisb_ingestion_status", {...workspace, taskId: selected.taskId});
  expect(sourceStatus).toMatchObject({ok: true, value: {state: "succeeded", revision: expect.any(Number)}});
  const sources = [{kind: "ingestion-file", taskId: selected.taskId, fileId: selected.fileId, taskRevision: sourceStatus.value.revision}];
  const chunk = {chunkCharacters: 500, overlapCharacters: 50, maximumChunks: 100, textFields: ["team", "priority"]};
  reportStage("pack");
  const pack = await generate({operation: "context.generate-pack", idempotencyKey: randomUUID(), name: "Synthetic Context pack", sources,
    settings: {...chunk, kind: "markdown-context-pack", cleaningPreset: "standard"}});
  facts.packSaved = true;
  reportStage("rag");
  const models = await call("aisb_context_models", workspace);
  expect(models).toMatchObject({ok: true, value: {runtimeReadiness: "not-checked"}});
  const installed = models.value.models.find((entry: {modelRecordId: string}) => entry.modelRecordId === CONTEXT_FIXTURE_MODEL_RECORD);
  expect(installed).toMatchObject({embeddings: true, lifecycleStatus: "downloaded"});
  const ragSettings = {...chunk, kind: "rag-database", modelRecordId: installed.modelRecordId, modelUpdatedAt: installed.updatedAt,
    batchSize: 8, device: "cpu", sourceChecks: {preset: "recommended", allowedLanguages: ["en"],
      requireLicenseMetadata: false, requireConsentMetadata: false, includeSourceAttribution: true}};
  const rag = await generate({operation: "context.generate-rag", idempotencyKey: randomUUID(), name: "Synthetic support RAG", sources, settings: ragSettings});
  facts.ragSaved = true;
  reportStage("query");
  async function queryKnownRow(question: string, expectedRow: number) {
  const queryInput = {...workspace, reference: rag.reference, query: question, maximumResults: 5, embeddingDevice: "cpu"};
  const preview = await call("aisb_preview_context_query", queryInput);
  expect(preview).toMatchObject({ok: true, value: {modelRecordId: installed.modelRecordId, modelUpdatedAt: installed.updatedAt, output: "citation-summary"}});
  for (const reference of [{...rag.reference, artifactDigest: "sha256:" + "f".repeat(64)}, {...rag.reference, contextId: randomUUID()}]) {
    expect((await call("aisb_preview_context_query", {...queryInput, reference})).ok).toBe(false); facts.denialChecks++;
  }
  expect(preview.value.queryDigest).toBe("sha256:" + createHash("sha256").update(question).digest("hex"));
  const queryTarget = await approve({operation: "context.query", idempotencyKey: randomUUID(), reference: rag.reference,
    queryDigest: preview.value.queryDigest, modelRecordId: installed.modelRecordId, modelUpdatedAt: installed.updatedAt,
    maximumResults: 5, embeddingDevice: "cpu"});
  expect((await call("aisb_run_approved_build_step", {...queryTarget, contextQuery: question + " different"})).ok).toBe(false);
  facts.denialChecks++;
  const queryStart = await call("aisb_run_approved_build_step", {...queryTarget, contextQuery: question});
  if (!queryStart.ok) expect(queryStart.code).toBe("headless.operation-unconfirmed");
  let query: any;
  await expect.poll(async () => {
    const result = await call("aisb_context_task", {...workspace, selection: {kind: "plan-step", fingerprint: queryTarget.fingerprint, step: 1}});
    if (!result.ok) { expect(["headless.forbidden", "headless.unavailable"]).toContain(result.code); return "awaiting"; }
    if (query) expect(result.value.taskId).toBe(query.taskId);
    query = result.value; return query.state === "succeeded" && query.query.cleanupPending ? "retiring" : query.state;
  }, {timeout: 60_000, intervals: [250, 500, 1000], message: "The approved query must return actual citation coordinates"}).toBe("succeeded");
  expect(query.query).toMatchObject({queryDigest: preview.value.queryDigest, maximumResults: 5, embeddingDevice: "cpu", cleanupPending: false});
  expect(query.query.sources).toHaveLength(1);
  expect(query.query.sources[0]).toMatchObject({reference: sources[0], digest: "sha256:" + createHash("sha256").update(contents).digest("hex")});
  expect(query.query.matches.length).toBeGreaterThan(0); expect(query.query.matches.length).toBeLessThanOrEqual(5);
  expect(query.query.matches).toHaveLength(2);
  expect(query.query.matches[0].rowIndex).toBe(expectedRow);
  expect(query.query.matches.map((match: {rowIndex: number}) => match.rowIndex).sort()).toEqual([0, 1]);
  expect(query.query.matches.every((match: {chunkIndex: number}) => match.chunkIndex === 0)).toBe(true);
  for (const [index, match] of query.query.matches.entries()) {
    expect(match).toMatchObject({rank: index + 1, sourceOrdinal: 1, chunkIndex: expect.any(Number)});
    expect(Number.isFinite(match.score)).toBe(true);
    expect(Object.keys(match).every(key => ["rank", "score", "sourceOrdinal", "chunkIndex", "rowIndex", "normalizedStart", "normalizedEnd", "pageNumber"].includes(key))).toBe(true);
  }
  expect(JSON.stringify(query)).not.toContain(question);
  facts.queryCitations = query.query.matches.length;
  expect(await call("aisb_run_approved_build_step", queryTarget)).toMatchObject({ok: true, value: {kind: "replayed", reference: {taskId: query.taskId}}}); facts.replayChecks++;
  return query;
  }
  const billingQuery = await queryKnownRow("How does billing support replace an invoice?", 0);
  const query = await queryKnownRow("How does account support help customers restore sign in?", 1);
  expect(query.query.queryDigest).not.toBe(billingQuery.query.queryDigest);
  facts.queriesGrounded = 2;
  reportStage("rebuild");
  const rebuild = await call("aisb_preview_context_rebuild", {...workspace, reference: rag.reference});
  expect(rebuild).toMatchObject({ok: true, value: {reference: rag.reference, preview: {settings: ragSettings}}});
  const rebuilt = await generate({operation: "context.generate-rag", idempotencyKey: randomUUID(), name: "Rebuilt support RAG", sources,
    settings: ragSettings, rebuildOf: rag.reference});
  expect(rebuilt.reference.contextId).not.toBe(rag.reference.contextId);
  expect(await call("aisb_read_context", {...workspace, contextId: rag.reference.contextId})).toEqual(rag.read);
  facts.rebuildSaved = true;

  reportStage("presentation");
  const present = await connectPresentation();
  const windows = await present("aisb_list_windows", workspace);
  expect(windows.ok).toBe(true); expect(windows.value.windows).toHaveLength(1);
  const requested = await present("aisb_request_window", {target: windows.value.windows[0], requestKey: randomUUID(), taskId: randomUUID()});
  expect(requested.ok).toBe(true);
  const attempt = requested.value.request.target;
  const consent = page.getByRole("dialog", {name: "Automation takeover request", exact: true});
  await expect(consent).toBeVisible();
  await consent.getByRole("button", {name: "Accept automation takeover", exact: true}).click();
  let lease: object | undefined;
  await expect.poll(async () => { const status = await present("aisb_window_status", {target: attempt}); lease = status.value?.lease; return !!lease; }).toBe(true);
  const shown = page.getByRole("region", {name: "Resource shown by automation", exact: true});
  for (const [intent, title, id] of [
    [{action: "show-context-artifact", reference: pack.reference}, "Saved context pack", pack.reference.contextId],
    [{action: "show-context-artifact", reference: rag.reference}, "Saved RAG database", rag.reference.contextId],
    [{action: "show-context-task", taskId: rebuilt.taskId}, "Context task", rebuilt.taskId],
    [{action: "show-context-query", taskId: query.taskId}, "Context search", query.taskId],
  ] as const) {
    const command = {target: lease, commandId: randomUUID(), intent};
    expect(await present("aisb_present_in_window", command)).toMatchObject({ok: true});
    await expect(shown.getByRole("heading", {name: title, exact: true})).toBeVisible();
    await expect(shown).toContainText(id);
    if (intent.action === "show-context-query") {
      await expect(shown).toContainText(`Status: ${query.state}. Citation results: ${query.query.matches.length}. Sources: ${query.query.sources.length}. Device: ${query.query.embeddingDevice}. Maximum results: ${query.query.maximumResults}. Cleanup: complete. Question fingerprint: ${query.query.queryDigest}.`);
    } else if (intent.action === "show-context-artifact") {
      const saved = intent.reference.contextId === pack.reference.contextId ? pack.read.value : rag.read.value;
      await expect(shown).toContainText(`Sources: ${saved.sourceCount}. Chunks: ${saved.chunkCount}. Size: ${saved.sizeBytes} bytes. File availability has not been checked.`);
      await expect(shown).toContainText(intent.reference.artifactDigest);
    } else {
      const task = await call("aisb_context_task", {...workspace, selection: {kind: "task", taskId: intent.taskId}});
      expect(task.ok).toBe(true);
      await expect(shown).toContainText(task.value.review
        ? `Review required. Sources: ${task.value.review.sourceCount}. Chunks: ${task.value.review.chunkCount}. Size: ${task.value.review.sizeBytes} bytes. Approve saving separately.`
        : `Task status: ${task.value.state}.`);
    }
    await expect.poll(async () => (await present("aisb_present_in_window", command)).value).toMatchObject({kind: "command", duplicate: true, receipt: {status: "applied"}});
    expect(await present("aisb_window_context", {target: lease})).toMatchObject({ok: true, value: {context: {selection: intent}}}); facts.presentations++;
  }
  expect((await present("aisb_present_in_window", {target: lease, commandId: randomUUID(), intent: {action: "show-context-task", taskId: query.taskId}})).ok).toBe(false); facts.denialChecks++;
  await page.getByRole("button", {name: "Revoke automation takeover", exact: true}).click();
  await expect(shown).toHaveCount(0);
  // Managed revocation is a real HTTP action. Local fencing is immediate; wait
  // for the server to acknowledge lease retirement before testing its egress.
  await expect.poll(async () => {
    const status = await present("aisb_window_status", {target: attempt});
    return contextLeaseRetirementConfirmed(status);
  }).toBe(true);
  const revokedContext = await present("aisb_window_context", {target: lease});
  expect(revokedContext.ok).toBe(false); expect(Object.keys(revokedContext).sort()).toEqual(["code", "ok"]);
  expect(options.revokedContextCodes).toContain(revokedContext.code); facts.denialChecks++;
  expect((await present("aisb_present_in_window", {target: lease, commandId: randomUUID(), intent: {action: "show-context-artifact", reference: rag.reference}})).ok).toBe(false); facts.denialChecks++;
  expect(await call("aisb_read_context", {...workspace, contextId: rag.reference.contextId})).toEqual(rag.read);
  expect(await call("aisb_context_task", {...workspace, selection: {kind: "task", taskId: query.taskId}})).toEqual({ok: true, operation: "context.task", value: query});
  facts.revoked = true; reportStage("complete");
}
