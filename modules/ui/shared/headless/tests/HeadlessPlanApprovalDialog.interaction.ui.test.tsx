// @ts-expect-error jsdom is a runtime test dependency without local declarations.
import { JSDOM } from "jsdom";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { act } from "react";
import { createRoot } from "react-dom/client";
import {
  isHeadlessHostIncarnationId, parseHeadlessBuildPlanProposal,
} from "../../../../contracts/headless";
import { readDesktopPlanApprovalView, type DesktopPlanApprovalDecision } from "../../../../contracts/headless";
import { readManagedBrowserPlanApprovalRequest, readManagedBrowserPlanApprovalValue } from "../../../../contracts/headless";
import { createWorkspaceId } from "../../../../contracts/workspace";
import { HeadlessPlanApprovalDialog, type HeadlessPlanApprovalClient } from "../HeadlessPlanApprovalDialog";

for (const variant of ["local", "provider", "dataset", "result", "context", "rag", "mixed-context", "context-save", "mixed-save"]) test(variant === "context-save" || variant === "mixed-save"
  ? `${variant} approval in both channels and modes discloses separate reviewed Context saving permissions`
  : variant === "mixed-context"
  ? "mixed RAG and pack plans scope model permissions to their own actions in both channels and modes"
  : variant === "rag"
  ? "both approval channels and modes disclose exact RAG model, device, policy and separate save permissions"
  : variant === "context"
  ? "both approval channels and modes show exact Context sources, settings and separate review/save permissions"
  : variant === "result"
  ? "both approval channels disclose an exact immutable dataset save with no processing or publication permission"
  : variant === "dataset"
  ? "both approval channels show exact dataset mapping, split, processing limits and separate result permission"
  : variant === "provider"
  ? "both app channels disclose provider reads and approve the exact provider save"
  : "both app channels identify the exact file save and approve through the same scoped view", async () => {
  const mixed = variant === "mixed-context" || variant === "mixed-save";
  const contextSave = variant === "context-save" || variant === "mixed-save";
  const provider = variant === "provider", dataset = variant === "dataset", result = variant === "result", context = variant === "context" || mixed, rag = variant === "rag" || mixed;
  const hostIncarnationId = "d52c0a60-3384-48ce-80e4-6102898ad428";
  assert.ok(isHeadlessHostIncarnationId(hostIncarnationId));
  const workspaceId = createWorkspaceId("workspace.synthetic");
  const steps: Record<string, unknown>[] = [{
    ...(context || rag ? {operation: rag ? "context.generate-rag" : "context.generate-pack", name: "Support reference", sources: [
      {kind: "ingestion-file", taskId: "ingestion.synthetic", fileId: "file.synthetic", taskRevision: 4},
      {kind: "dataset-version", datasetId: "support", versionId: "support:1234", versionDigest: "sha256:" + "c".repeat(64), role: "train"}],
      settings: {chunkCharacters: 500, overlapCharacters: 50, maximumChunks: 100, textFields: ["question", "answer"],
        ...(rag ? {kind: "rag-database", modelRecordId: "model.synthetic", modelUpdatedAt: "2026-11-18T00:00:00.000Z", device: "cpu", batchSize: 4,
          sourceChecks: {preset: "strict", allowedLanguages: ["en"], requireLicenseMetadata: true, requireConsentMetadata: true, includeSourceAttribution: false}}
          : {kind: "markdown-context-pack", cleaningPreset: "strict"})}}
      : contextSave ? {operation: "context.save-result", taskId: "26a7ce63-a472-4779-876a-58500d26b971",
      reportFingerprint: "a".repeat(64), name: "Reviewed support context"}
      : result ? {operation: "data.save-prepared-dataset", taskId: "26a7ce63-a472-4779-876a-58500d26b971",
      reportFingerprint: "a".repeat(64), outputBaseName: "Reviewed support answers"}
      : dataset ? {operation: "data.prepare-local-dataset", sources: [{taskId: "ingestion.synthetic", fileId: "file.synthetic", taskRevision: 4}],
      recipe: {kind: "provided-instruction-rows-v1", inputColumn: "question", outputColumn: "answer"},
      split: {trainRatio: 0.8, validationRatio: 0.1, testRatio: 0.1, seed: 42}, qualityPreset: "recommended"}
      : {operation: provider ? "data.save-provider-source" : "data.save-local-source", taskId: "ingestion.synthetic", fileId: "file.synthetic", taskRevision: 4}),
    idempotencyKey: "e6b5f077-1a85-4ca3-8067-34f8aa6086da",
  }];
  if (mixed) steps.push({operation: "context.generate-pack", name: "Support reference", sources: steps[0].sources,
    idempotencyKey: "e6b5f077-1a85-4ca3-8067-34f8aa6086db", settings: {kind: "markdown-context-pack", cleaningPreset: "strict",
      chunkCharacters: 500, overlapCharacters: 50, maximumChunks: 100, textFields: ["question", "answer"]}});
  if (variant === "mixed-save") steps.push({operation: "context.save-result", taskId: "26a7ce63-a472-4779-876a-58500d26b971",
    reportFingerprint: "a".repeat(64), name: "Reviewed support context", idempotencyKey: "e6b5f077-1a85-4ca3-8067-34f8aa6086dc"});
  const parsed = parseHeadlessBuildPlanProposal({hostIncarnationId, workspaceId, steps}, hostIncarnationId, { allowLocalFileSave: true, allowProviderFileSave: provider, allowLocalDatasetPreparation: dataset,
    allowDatasetResultSave: result, allowContextPackGeneration: context, allowContextRagGeneration: rag, allowContextResultSave: contextSave });
  assert.ok(parsed.ok);
  const fingerprint = createHash("sha256").update(JSON.stringify(parsed.preview)).digest("hex");
  const selection = { workspaceId, fingerprint, registeredClientId: "83739bf2-c08e-4d9d-ad84-da05ae2d17f3" };
  const viewId = "36c91778-901d-4e0b-8e71-329157e9d79f";
  const expiresAt = Date.now() + 60_000;
  const state = { fingerprint, revision: 1, stepCount: parsed.requests.length, approvedSteps: 0, expiresAt, status: "pending" as const };
  const view = readDesktopPlanApprovalView({ selection, viewId, preview: parsed.preview, state }, selection);
  assert.ok(view);
  assert.equal(readDesktopPlanApprovalView({ selection, viewId, preview: parsed.preview, state }, selection,
    { allowLocalFileSave: false, allowDatasetResultSave: false, allowContextResultSave: false }), undefined);
  const managed = readManagedBrowserPlanApprovalRequest({ operation: "open", selection,
    document: { hostIncarnationId, workspaceId, windowId: "f57979a4-41e3-489f-b32b-40452707c441",
      uiIncarnationId: "90583b7a-16a4-4478-b28d-ec9f3349175c" } });
  assert.ok(managed);
  assert.equal(readManagedBrowserPlanApprovalValue(managed, view), undefined);
  const dom = new JSDOM("<body><div id='app'></div></body>", { pretendToBeVisual: true });
  const globals = { window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement,
    IS_REACT_ACT_ENVIRONMENT: true };
  const original = Object.fromEntries(Object.keys(globals).map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  Object.assign(globalThis, globals);
  try {
    for (const surface of ["popup", "chat"] as const) for (const mode of (context || rag || contextSave ? ["each-change", "whole-plan"] : ["each-change"]) as ("each-change" | "whole-plan")[]) {
      const decisions: DesktopPlanApprovalDecision[] = [];
      const client: HeadlessPlanApprovalClient = {
        async list(workspace) { assert.equal(workspace, workspaceId); return [{ ...selection, expiresAt }]; },
        async open(target) { assert.deepEqual(target, selection); return view; },
        async decide(decision) { decisions.push(decision); return { ...state, revision: 2, approvedSteps: mode === "whole-plan" ? state.stepCount : 1,
          status: mode === "whole-plan" || state.stepCount === 1 ? "approved" : "pending", mode }; },
        async dismiss() {},
      };
      const root = createRoot(dom.window.document.getElementById("app")!);
      const button = (label: string, exact = true) => {
        const matching = [...dom.window.document.querySelectorAll<HTMLButtonElement>("button")].find(item =>
          exact ? item.textContent?.trim() === label : item.textContent?.trim().startsWith(label));
        assert.ok(matching, `Expected button: ${label}`);
        return matching;
      };
      try {
        await act(async () => root.render(<HeadlessPlanApprovalDialog workspaceId={workspaceId}
          workspaceName="Synthetic workspace" client={client} surface={surface} />));
        await act(async () => button(surface === "popup" ? "Review plan requests" : "Open plan approval chat").click());
        await act(async () => button("Review request " + fingerprint.slice(0, 8), false).click());
        const changes = dom.window.document.querySelector('[aria-label="Requested changes"]');
        const permissions = dom.window.document.querySelector('[aria-label="Permissions and limits"]');
        assert.match(permissions?.textContent ?? "", rag ? /Build a RAG database/ : context ? /Prepare a Markdown Context pack/ : contextSave ? /Save only the reviewed Context result/ : result ? /Save the reviewed task output/ : dataset ? /Process the listed saved local files/ : /Save the listed files in this workspace/);
        assert.match(changes?.textContent ?? "", rag ? /Build RAG database: Support reference/ : context ? /Prepare Context pack: Support reference/ : contextSave ? /Save reviewed Context: Reviewed support context/ : result ? /Save reviewed dataset: Reviewed support answers/ : dataset ? /Prepare a dataset from saved local files/ : provider
          ? /Save the selected Hugging Face source in Data/ : /Save the selected file in Data/);
        if (provider) {
          assert.match(permissions?.textContent ?? "", /using your saved provider access/);
          assert.doesNotMatch(permissions?.textContent ?? "", /No outside service calls/);
        }
        if (result) {
          assert.match(changes?.textContent ?? "", /Preparation task: 26a7ce63-a472-4779-876a-58500d26b971/);
          assert.match(changes?.textContent ?? "", new RegExp("Approved quality report: " + "a".repeat(64)));
          assert.match(permissions?.textContent ?? "", /immutable dataset version/);
          assert.match(permissions?.textContent ?? "", /Saving this dataset makes no model calls\. No outside publication\. No second processing run/);
          assert.doesNotMatch(permissions?.textContent ?? "", /Process the listed|Save the listed files/);
        } else if (!contextSave || mixed) {
          assert.match(changes?.textContent ?? "", /File reference file\.synthetic/);
          assert.match(changes?.textContent ?? "", /Upload ingestion\.synthetic, version 4/);
        }
        if (contextSave) {
          assert.match(changes?.textContent ?? "", /26a7ce63-a472-4779-876a-58500d26b971/);
          assert.match(changes?.textContent ?? "", new RegExp("a".repeat(64)));
          assert.match(permissions?.textContent ?? "", /64 MiB/);
          assert.match(permissions?.textContent ?? "", /This save starts no model or processing task/);
          assert.doesNotMatch(permissions?.textContent ?? "", /Save the listed files|immutable dataset version/);
        }
        if (dataset) {
          assert.match(permissions?.textContent ?? "", /4 files, 4 MiB per file, 16 MiB total and 1,000 rows per file/);
          assert.match(permissions?.textContent ?? "", /saving and publication need separate permission/);
          assert.match(changes?.textContent ?? "", /Input column: question\. Output column: answer/);
          assert.match(changes?.textContent ?? "", /80% training, 10% validation, 10% test\. Seed: 42/);
        }
        if (context) {
          assert.match(permissions?.textContent ?? "", /4 sources, 4 MiB per source, 16 MiB total and 1,000 text chunks/);
          assert.match(permissions?.textContent ?? "", /Preparing this Markdown pack makes no model calls and installs no models/);
          assert.match(permissions?.textContent ?? "", /Review the result before a separate request to save it/);
          assert.match(permissions?.textContent ?? "", /unknown terms stay unknown/);
          assert.doesNotMatch(permissions?.textContent ?? "", /Save the listed files|immutable dataset version/);
          assert.match(changes?.textContent ?? "", /Dataset support\. Saved version support:1234\. Part: train/);
          assert.match(changes?.textContent ?? "", /Text fields: question, answer/);
          assert.match(changes?.textContent ?? "", /Cleaning: strict\. Chunk size: 500 characters\. Overlap: 50 characters\. Maximum chunks: 100/);
          assert.match(changes?.textContent ?? "", /No summarization or model calls/);
        }
        if (rag) {
          assert.match(permissions?.textContent ?? "", /4 sources, 4 MiB per source, 16 MiB total and 1,000 text chunks/);
          assert.match(permissions?.textContent ?? "", /existing local safe-weight files/);
          assert.match(permissions?.textContent ?? "", /Model downloads, installation and outside publication need separate permission/);
          assert.doesNotMatch(permissions?.textContent ?? "", /No model calls/);
          assert.match(changes?.textContent ?? "", /Model record: model\.synthetic\. Saved at 2026-11-18T00:00:00.000Z/);
          assert.match(changes?.textContent ?? "", /Device: cpu\. Embedding batch size: 4/);
          assert.match(changes?.textContent ?? "", /Source checks: strict\. Languages: en/);
          assert.match(changes?.textContent ?? "", /Require license: Yes\. Require consent: Yes\. Include source attribution: No/);
          assert.match(changes?.textContent ?? "", /Use local embeddings/);
          assert.doesNotMatch(changes?.textContent ?? "", /localModelReference|private\/model/);
        }
        if (mode === "whole-plan") await act(async () => {
          const radio = [...dom.window.document.querySelectorAll<HTMLInputElement>('input[type="radio"]')]
            .find(element => element.parentElement?.textContent?.includes("Approve all listed changes"));
          assert.ok(radio); radio.click();
        });
        await act(async () => button(mode === "whole-plan" ? "Approve all changes" : "Approve change 1").click());
        assert.deepEqual(decisions, [{ selection, viewId, expectedRevision: 1,
          decision: mode === "whole-plan" ? {kind: "approve", mode} : { kind: "approve", mode, step: 1 } }]);
      } finally { await act(async () => root.unmount()); }
    }
  } finally {
    for (const [name, descriptor] of Object.entries(original)) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else Reflect.deleteProperty(globalThis, name);
    }
    dom.window.close();
  }
});
