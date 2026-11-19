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

for (const variant of ["unknown", "open", "non-open", "mixed-escaped"] as const) test(
  variant + " Model download approval shows exact permissions in both channels and approval modes", async () => {
  const host = "ca353bdd-7793-44c6-8c36-c470be8c537c"; assert.ok(isHeadlessHostIncarnationId(host));
  const workspaceId = createWorkspaceId("workspace.model-plan-ui");
  const license = variant === "unknown" ? {kind: "unknown"} : {kind: "provider-declared", identifier: variant === "open" ? "apache-2.0" : "proprietary"};
  const source = readModelDownloadSource({provider: "huggingface", modelId: "fixture/support-model", revision: "a".repeat(40),
    format: "transformers-safetensors", license, files: ["config.json", "model.safetensors", "tokenizer.json"].map(path => ({
      path, sizeBytes: 1048576, integrity: {algorithm: path.endsWith("safetensors") ? "sha256" : "git-blob-sha1",
        digest: "b".repeat(path.endsWith("safetensors") ? 64 : 40)}})), totalBytes: 3145728, excludedFileCount: 0,
    sourceVerification: "provider-metadata", bytesVerification: "not-checked", runtimeReadiness: "not-checked"},
    {provider: "huggingface", modelId: "fixture/support-model", revision: "a".repeat(40)});
  const name = variant === "mixed-escaped" ? "<img src=x onerror=synthetic>" : "Small support model";
  const steps: Record<string, unknown>[] = [{operation: "models.download", idempotencyKey: randomUUID(), name,
    sourceManifest: {source, manifestDigest: "sha256:" + createHash("sha256").update(JSON.stringify(source)).digest("hex")},
    allowedOrigins: ["https://huggingface.co", "https://cdn-lfs.huggingface.co"], maximumDurationSeconds: 1800, inferenceMode: "chat"}];
  if (variant === "mixed-escaped") steps.push({operation: "systems.create", idempotencyKey: randomUUID(),
    name: "Customer support assistant", templateId: "reference.secured-data-review@1.0.0"});
  const caps = {allowLocalFileSave: false, allowModelDownload: true};
  const parsed = parseHeadlessBuildPlanProposal({hostIncarnationId: host, workspaceId, steps}, host, caps); assert.ok(parsed.ok);
  const fingerprint = createHash("sha256").update(JSON.stringify(parsed.preview)).digest("hex");
  const selection = {workspaceId, fingerprint, registeredClientId: randomUUID()}, viewId = randomUUID(), expiresAt = Date.now() + 60000;
  const state = {fingerprint, revision: 1, stepCount: parsed.requests.length, approvedSteps: 0, expiresAt, status: "pending" as const};
  const packet = {selection, viewId, preview: parsed.preview, state};
  const view = readDesktopPlanApprovalView(packet, selection, caps); assert.ok(view);
  const managedRequest = {operation: "open" as const, selection, document: {hostIncarnationId: host, workspaceId,
    windowId: randomUUID(), uiIncarnationId: randomUUID()}};
  assert.deepEqual(readManagedBrowserPlanApprovalValue(managedRequest, packet, caps), view);
  assert.equal(readDesktopPlanApprovalView(packet, selection), undefined);
  assert.equal(readManagedBrowserPlanApprovalValue(managedRequest, packet), undefined);
  const dom = new JSDOM("<body><div id='app'></div></body>", {pretendToBeVisual: true});
  const globals = {window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true};
  const originals = Object.fromEntries(Object.keys(globals).map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  Object.assign(globalThis, globals);
  try {
    for (const surface of ["popup", "chat"] as const) for (const mode of ["each-change", "whole-plan"] as const) {
      const decisions: DesktopPlanApprovalDecision[] = [], dismissed: string[] = [];
      const client: HeadlessPlanApprovalClient = {
        async list(actual) {assert.equal(actual, workspaceId); return [{...selection, expiresAt}];},
        async open(actual) {assert.deepEqual(actual, selection); return view;},
        async decide(decision) {decisions.push(decision); return {...state, revision: 2,
          approvedSteps: mode === "whole-plan" ? state.stepCount : 1,
          status: mode === "whole-plan" || state.stepCount === 1 ? "approved" : "pending", mode};},
        async dismiss(id) {dismissed.push(id);},
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
        const changes = dom.window.document.querySelector('[aria-label="Requested changes"]')?.textContent ?? "";
        assert.match(permissions, /Download only the exact model files and versions/);
        assert.match(permissions, /saved Hugging Face access/); assert.match(permissions, /only the allowed sites/);
        assert.match(permissions, /to check model details/); assert.match(permissions, /File transfers use public access only/);
        assert.match(permissions, /Files that require a token are not supported/);
        assert.match(permissions, /byte and time limits/); assert.match(permissions, /estimate, not a reservation/);
        assert.match(permissions, /If stopping cannot be confirmed, the outcome stays unconfirmed/);
        assert.doesNotMatch(permissions, /Each download stops at/);
        assert.match(permissions, /does not add the downloaded model to the Models list, run it, train it, or publish it/);
        assert.match(permissions, /Outside file transfers are required/); assert.doesNotMatch(permissions, /No outside service calls/);
        assert.match(changes, /fixture\/support-model/); assert.match(changes, new RegExp("Exact version: " + "a".repeat(40)));
        assert.match(changes, /Transformers safetensors/);
        const selectedBytes = [...dom.window.document.querySelectorAll("div")].find(element => element.textContent?.startsWith("Selected file bytes:"));
        const diskBytes = [...dom.window.document.querySelectorAll("div")].find(element => element.textContent?.startsWith("Disk space estimate during transfer:"));
        assert.equal(Number(selectedBytes?.textContent?.replace(/\D/g, "")), 3145728);
        assert.equal(Number(diskBytes?.textContent?.split(" bytes.")[0]?.replace(/\D/g, "")), 6291456);
        assert.match(changes, /Public files without credentials/); assert.match(changes, /Private or gated file downloads are unavailable/);
        assert.match(changes, /Time limit: 30 minutes 0 seconds/); assert.match(changes, /integrity and runtime support are not yet checked/);
        assert.equal(dom.window.document.querySelectorAll('[aria-label="Allowed download sites"] li').length, 2);
        assert.match(changes, /https:\/\/cdn-lfs.huggingface.co/); assert.match(changes, /https:\/\/huggingface.co/);
        assert.match(changes, variant === "unknown" ? /License: Not reported by the provider/ : variant === "open" ? /apache-2.0/ : /proprietary/);
        const files = dom.window.document.querySelector("details"); assert.ok(files); assert.equal(files.open, false);
        await act(async () => {files.open = true; files.dispatchEvent(new dom.window.Event("toggle"));});
        assert.match(files.textContent ?? "", /config.json/); assert.match(files.textContent ?? "", /model.safetensors/); assert.match(files.textContent ?? "", /tokenizer.json/);
        assert.equal(dom.window.document.querySelectorAll("img, script").length, 0);
        if (variant === "mixed-escaped") {assert.ok(changes.includes(name)); assert.match(changes, /Create Customer support assistant/);}
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
