// @ts-expect-error jsdom is a runtime test dependency without local declarations.
import {JSDOM} from "jsdom";
import assert from "node:assert/strict";
import {createHash, randomUUID} from "node:crypto";
import test from "node:test";
import {act} from "react";
import {createRoot} from "react-dom/client";
import {createWorkspaceId} from "../../../../contracts/workspace";
import {readModelDownloadSource} from "../../../../contracts/model";
import {isHeadlessHostIncarnationId, parseHeadlessBuildPlanProposal, readDesktopPlanApprovalView,
  readManagedBrowserPlanApprovalValue, type DesktopPlanApprovalDecision} from "../../../../contracts/headless";
import {HeadlessPlanApprovalDialog, type HeadlessPlanApprovalClient} from "../HeadlessPlanApprovalDialog";

for (const variant of ["minimal", "full-mixed", "with-download"] as const) test(
  variant + " training preview shows exact permissions and settings in both approval modes and channels", async () => {
  const host = randomUUID(); assert.ok(isHeadlessHostIncarnationId(host));
  const workspaceId = createWorkspaceId("workspace.training-approval-ui");
  const training = {trainingTask: "llm-instruction", method: "lora", commonParameters: {maxSteps: 8, seed: 0},
    ...(variant === "full-mixed" ? {commonParameters: {maxSteps: 8, seed: 0, numEpochs: 1, batchSize: 1, learningRate: 0.0002,
      weightDecay: 0, maxSequenceLength: 128}, advancedParameters: {gradientAccumulationSteps: 2, warmupSteps: 0, warmupRatio: 0,
      schedulerType: "linear", evalIntervalSteps: 2, checkpointIntervalSteps: 4, saveTotalLimit: 1, mixedPrecision: "no",
      gradientCheckpointing: false, lora: {rank: 4, alpha: 8, dropout: 0, targetModules: ["q_proj", "v_proj"]},
      quantization: {loadIn4Bit: false, loadIn8Bit: false, bnb4BitQuantType: "nf4", bnb4BitComputeDtype: "float32"}},
      validation: {enabled: false, expectedLoRA: true, expectedRecurrentAdditions: false, taskTags: ["chat"]}} : {})};
  const model = {modelRecordId: "model.synthetic", updatedAt: "2026-11-21T00:00:00.000Z"};
  const dataset = {datasetId: "dataset.synthetic", versionId: "version.synthetic", versionDigest: "sha256:" + "a".repeat(64)};
  const name = "Support & training trial";
  const steps: Record<string, unknown>[] = [{operation: "models.train", idempotencyKey: randomUUID(), name, model, dataset, training}];
  if (variant === "full-mixed") steps.push({operation: "systems.create", idempotencyKey: randomUUID(),
    name: "<img src=x onerror=synthetic>", templateId: "reference.secured-data-review@1.0.0"});
  if (variant === "with-download") {
    const source = readModelDownloadSource({provider: "huggingface", modelId: "fixture/support-model", revision: "a".repeat(40),
      format: "transformers-safetensors", license: {kind: "unknown"}, files: ["config.json", "model.safetensors", "tokenizer.json"].map(path => ({
        path, sizeBytes: 1, integrity: {algorithm: "sha256", digest: "b".repeat(64)}})), totalBytes: 3, excludedFileCount: 0,
      sourceVerification: "provider-metadata", bytesVerification: "not-checked", runtimeReadiness: "not-checked"},
      {provider: "huggingface", modelId: "fixture/support-model", revision: "a".repeat(40)});
    steps.unshift({operation: "models.download", idempotencyKey: randomUUID(), name: "Future base model download",
      sourceManifest: {source, manifestDigest: "sha256:" + createHash("sha256").update(JSON.stringify(source)).digest("hex")},
      allowedOrigins: ["https://huggingface.co"], maximumDurationSeconds: 60});
  }
  const caps = {allowLocalFileSave: false, allowModelTraining: true, allowModelDownload: variant === "with-download"};
  const parsed = parseHeadlessBuildPlanProposal({hostIncarnationId: host, workspaceId, steps}, host, caps); assert.ok(parsed.ok);
  const fingerprint = createHash("sha256").update(JSON.stringify(parsed.preview)).digest("hex");
  const selection = {workspaceId, fingerprint, registeredClientId: randomUUID()}, viewId = randomUUID(), expiresAt = Date.now() + 60000;
  const state = {fingerprint, revision: 1, stepCount: parsed.requests.length, approvedSteps: 0, expiresAt, status: "pending" as const};
  const packet = {selection, viewId, preview: parsed.preview, state};
  const view = readDesktopPlanApprovalView(packet, selection, caps); assert.ok(view);
  assert.deepEqual(readManagedBrowserPlanApprovalValue({operation: "open", selection,
    document: {hostIncarnationId: host, workspaceId, windowId: randomUUID(), uiIncarnationId: randomUUID()}}, packet, caps), view);
  const dom = new JSDOM("<body><div id='app'></div></body>", {pretendToBeVisual: true});
  const globals = {window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true};
  const originals = Object.fromEntries(Object.keys(globals).map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  Object.assign(globalThis, globals);
  try {
    for (const surface of ["popup", "chat"] as const) for (const mode of ["each-change", "whole-plan"] as const) {
      const decisions: DesktopPlanApprovalDecision[] = [];
      const client: HeadlessPlanApprovalClient = {
        async list(actual) {assert.equal(actual, workspaceId); return [{...selection, expiresAt}];},
        async open(actual) {assert.deepEqual(actual, selection); return view;},
        async decide(decision) {decisions.push(decision); return {...state, revision: 2, mode,
          approvedSteps: mode === "whole-plan" ? state.stepCount : 1,
          status: mode === "whole-plan" || state.stepCount === 1 ? "approved" : "pending"};},
        async dismiss() {},
      };
      const root = createRoot(dom.window.document.getElementById("app")!);
      const button = (label: string, prefix = false) => {
        const found = [...dom.window.document.querySelectorAll<HTMLButtonElement>("button")].find(element =>
          prefix ? element.textContent?.trim().startsWith(label) : element.textContent?.trim() === label);
        assert.ok(found, "Missing expected action: " + label); return found;
      };
      try {
        await act(async () => root.render(<HeadlessPlanApprovalDialog workspaceId={workspaceId} workspaceName="Support workspace" client={client} surface={surface} />));
        await act(async () => button(surface === "popup" ? "Review plan requests" : "Open plan approval chat").click());
        await act(async () => button("Review request " + fingerprint.slice(0, 8), true).click());
        const permissions = dom.window.document.querySelector('[aria-label="Permissions and limits"]')?.textContent ?? "";
        assert.match(permissions, /Read the exact saved model and dataset version/);
        assert.match(permissions, /Train a local model with the listed settings/);
        assert.match(permissions, /Keep the trained result private until you review it/);
        assert.match(permissions, /separate Save approval/);
        assert.match(permissions, /check the input files, runtime support and available memory and disk space/);
        assert.match(permissions, /does not confirm those checks/);
        assert.match(permissions, /Each training step covers local training only/);
        assert.match(permissions, /Model downloads, software installation, outside publication and window control need their own approval/);
        assert.doesNotMatch(permissions, /This permission does not allow model downloads|This request does not.*train it/);
        if (variant === "with-download") {
          assert.match(permissions, /Download only the exact model files and versions/);
          assert.match(permissions, /Each download step does not add the downloaded model to the Models list, run it, train it, or publish it/);
          assert.match(permissions, /Those actions need their own approval steps/);
          assert.match(permissions, /Outside file transfers are required/);
          assert.doesNotMatch(permissions, /No outside service calls/);
        } else {
          assert.match(permissions, /No outside service calls or provider charges/);
          assert.doesNotMatch(permissions, /Download only/);
        }
        const changes = dom.window.document.querySelector('[aria-label="Requested changes"]')?.textContent ?? "";
        for (const value of [name, model.modelRecordId, model.updatedAt, dataset.datasetId, dataset.versionId, dataset.versionDigest])
          assert.ok(changes.includes(value), "Missing exact saved input: " + value);
        assert.match(changes, /Runtime and resource checks are still required/);
        const settings = dom.window.document.querySelector('[aria-label="Training settings"]'); assert.ok(settings);
        assert.match(settings.textContent ?? "", /Training task: llm-instruction. Method: lora/);
        const rows = new Map([...settings.querySelectorAll("dl > div")].map(row => [row.querySelector("dt")?.textContent, row.querySelector("dd")?.textContent]));
        assert.equal(rows.get("Maximum training steps"), "8"); assert.equal(rows.get("Random seed"), "0");
        if (variant === "full-mixed") {
          for (const details of settings.querySelectorAll("details")) {
            assert.equal(details.open, false);
            await act(async () => {details.open = true; details.dispatchEvent(new dom.window.Event("toggle"));});
          }
          assert.deepEqual(Object.fromEntries(rows), {"Epochs": "1", "Maximum training steps": "8", "Batch size": "1",
            "Learning rate": "0.0002", "Weight decay": "0", "Maximum sequence length": "128", "Random seed": "0",
            "Gradient accumulation steps": "2", "Warmup steps": "0", "Warmup ratio": "0", "Learning rate schedule": "linear",
            "Evaluation interval in steps": "2", "Checkpoint interval in steps": "4", "Checkpoint limit": "1", "Mixed precision": "no",
            "Gradient checkpointing": "No", "Rank": "4", "Alpha": "8", "Dropout": "0", "Target modules": "q_proj, v_proj",
            "Load in 4-bit": "No", "Load in 8-bit": "No", "4-bit quantization type": "nf4", "4-bit compute type": "float32",
            "Enable post-training checks": "No", "Expect LoRA adapters": "Yes", "Expect recurrent additions": "No", "Expected model tasks": "chat"});
          assert.ok(changes.includes("<img src=x onerror=synthetic>"));
        } else {
          assert.equal(settings.querySelectorAll("details").length, 0);
          assert.match(settings.textContent ?? "", /Settings not listed here use the existing training defaults/);
        }
        assert.equal(dom.window.document.querySelectorAll("img, script").length, 0);
        if (mode === "whole-plan") await act(async () => {
          const radio = [...dom.window.document.querySelectorAll<HTMLInputElement>('input[type="radio"]')]
            .find(element => element.parentElement?.textContent?.includes("Approve all listed changes"));
          assert.ok(radio); radio.click();
        });
        await act(async () => button(mode === "whole-plan" ? "Approve all changes" : "Approve change 1").click());
        assert.deepEqual(decisions, [{selection, viewId, expectedRevision: 1,
          decision: mode === "whole-plan" ? {kind: "approve", mode} : {kind: "approve", mode, step: 1}}]);
      } finally {await act(async () => root.unmount());}
    }
  } finally {
    for (const [name, descriptor] of Object.entries(originals)) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor); else Reflect.deleteProperty(globalThis, name);
    }
    dom.window.close();
  }
});
