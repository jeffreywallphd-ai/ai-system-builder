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

for (const variant of ["local", "provider", "dataset"]) test(variant === "dataset"
  ? "both approval channels show exact dataset mapping, split, processing limits and separate result permission"
  : variant === "provider"
  ? "both app channels disclose provider reads and approve the exact provider save"
  : "both app channels identify the exact file save and approve through the same scoped view", async () => {
  const provider = variant === "provider", dataset = variant === "dataset";
  const hostIncarnationId = "d52c0a60-3384-48ce-80e4-6102898ad428";
  assert.ok(isHeadlessHostIncarnationId(hostIncarnationId));
  const workspaceId = createWorkspaceId("workspace.synthetic");
  const parsed = parseHeadlessBuildPlanProposal({ hostIncarnationId, workspaceId, steps: [{
    ...(dataset ? {operation: "data.prepare-local-dataset", sources: [{taskId: "ingestion.synthetic", fileId: "file.synthetic", taskRevision: 4}],
      recipe: {kind: "provided-instruction-rows-v1", inputColumn: "question", outputColumn: "answer"},
      split: {trainRatio: 0.8, validationRatio: 0.1, testRatio: 0.1, seed: 42}, qualityPreset: "recommended"}
      : {operation: provider ? "data.save-provider-source" : "data.save-local-source", taskId: "ingestion.synthetic", fileId: "file.synthetic", taskRevision: 4}),
    idempotencyKey: "e6b5f077-1a85-4ca3-8067-34f8aa6086da",
  }] }, hostIncarnationId, { allowLocalFileSave: true, allowProviderFileSave: provider, allowLocalDatasetPreparation: dataset });
  assert.ok(parsed.ok);
  const fingerprint = createHash("sha256").update(JSON.stringify(parsed.preview)).digest("hex");
  const selection = { workspaceId, fingerprint, registeredClientId: "83739bf2-c08e-4d9d-ad84-da05ae2d17f3" };
  const viewId = "36c91778-901d-4e0b-8e71-329157e9d79f";
  const expiresAt = Date.now() + 60_000;
  const state = { fingerprint, revision: 1, stepCount: 1, approvedSteps: 0, expiresAt, status: "pending" as const };
  const view = readDesktopPlanApprovalView({ selection, viewId, preview: parsed.preview, state }, selection);
  assert.ok(view);
  assert.equal(readDesktopPlanApprovalView({ selection, viewId, preview: parsed.preview, state }, selection,
    { allowLocalFileSave: false }), undefined);
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
    for (const surface of ["popup", "chat"] as const) {
      const decisions: DesktopPlanApprovalDecision[] = [];
      const client: HeadlessPlanApprovalClient = {
        async list(workspace) { assert.equal(workspace, workspaceId); return [{ ...selection, expiresAt }]; },
        async open(target) { assert.deepEqual(target, selection); return view; },
        async decide(decision) { decisions.push(decision); return { ...state, revision: 2, approvedSteps: 1,
          status: "approved", mode: "each-change" }; },
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
        assert.match(permissions?.textContent ?? "", dataset ? /Process the listed saved local files/ : /Save the listed files in this workspace/);
        assert.match(changes?.textContent ?? "", dataset ? /Prepare a dataset from saved local files/ : provider
          ? /Save the selected Hugging Face source in Data/ : /Save the selected file in Data/);
        if (provider) {
          assert.match(permissions?.textContent ?? "", /using your saved provider access/);
          assert.doesNotMatch(permissions?.textContent ?? "", /No outside service calls/);
        }
        assert.match(changes?.textContent ?? "", /File reference file\.synthetic/);
        assert.match(changes?.textContent ?? "", /Upload ingestion\.synthetic, version 4/);
        if (dataset) {
          assert.match(permissions?.textContent ?? "", /4 files, 4 MiB per file, 16 MiB total and 1,000 rows per file/);
          assert.match(permissions?.textContent ?? "", /saving and publication need separate permission/);
          assert.match(changes?.textContent ?? "", /Input column: question\. Output column: answer/);
          assert.match(changes?.textContent ?? "", /80% training, 10% validation, 10% test\. Seed: 42/);
        }
        await act(async () => button("Approve change 1").click());
        assert.deepEqual(decisions, [{ selection, viewId, expectedRevision: 1,
          decision: { kind: "approve", mode: "each-change", step: 1 } }]);
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
