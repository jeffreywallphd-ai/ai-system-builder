// @vitest-environment jsdom
import React, {act} from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";

import { WindowTakeoverControls, WindowTakeoverProvider } from "../../../../../../../modules/ui/shared/takeover/WindowTakeoverControls";
import { PresentedWindowResource } from "../../../../../../../modules/ui/shared/takeover/PresentedWindowResource";
import { pairedDeviceTokenStore } from "../../../../security/pairedDeviceTokenStore";
import { useManagedBrowserTakeover } from "../useManagedBrowserTakeover";

const id = (suffix: number) => `00000000-0000-4000-8000-${String(suffix).padStart(12, "0")}`;
const target = {hostIncarnationId: id(1), windowId: id(2), uiIncarnationId: id(3), workspaceId: "workspace.fixture"};
const attempt = {...target, requestId: id(4), attemptId: id(5)};
const grant = {target: {...attempt, leaseId: id(7), generation: 1}, remainingMs: 10_000};
const pending = {target: attempt, status: "pending", agentSessionId: id(8), taskId: id(9), expiresAt: 50_000};
const proof = "a".repeat(43);
const reply = (value: unknown, presentation = false) => new Response(JSON.stringify(value), {
  headers: {"content-type": "application/json", ...(presentation ? {"x-aisb-headless-presentation": "1"} : {})},
});
const click = (label: string) => {
  const node = [...document.querySelectorAll("button")].find(button => button.textContent?.trim() === label);
  expect(node?.isConnected).toBe(true);
  node!.click();
};

(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT: boolean}).IS_REACT_ACT_ENVIRONMENT = true;
const originalHidden = Object.getOwnPropertyDescriptor(document, "hidden");
function hide(hidden: boolean) {
  Object.defineProperty(document, "hidden", {configurable: true, value: hidden});
  document.dispatchEvent(new Event("visibilitychange"));
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  localStorage.clear();
  if (originalHidden) Object.defineProperty(document, "hidden", originalHidden);
  else Reflect.deleteProperty(document, "hidden");
});

it("retries transient registration serially and stays detached between pagehide and pageshow", async () => {
  vi.useFakeTimers();
  hide(false);
  pairedDeviceTokenStore.setToken("fixture-browser-token");
  let registerCalls = 0;
  const held = Promise.withResolvers<Response>();
  vi.stubGlobal("fetch", async (_input: string, options: RequestInit) => {
    const request = JSON.parse(String(options.body));
    if (request.operation !== "register") return reply({status: "ready"});
    registerCalls++;
    if (registerCalls === 1) return new Response(null, {status: 503});
    if (registerCalls === 2) return held.promise;
    return new Response(null, {status: 404});
  });
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  function Fixture({workspace}: {workspace: string}) {
    const control = useManagedBrowserTakeover(workspace, "fixture-org", false);
    return <WindowTakeoverProvider control={control}><WindowTakeoverControls /></WindowTakeoverProvider>;
  }
  try {
    await act(async () => {root.render(<Fixture workspace={target.workspaceId} />);});
    expect(registerCalls).toBe(1);
    await act(async () => vi.advanceTimersByTimeAsync(1_499));
    expect(registerCalls).toBe(1);
    await act(async () => vi.advanceTimersByTimeAsync(1));
    expect(registerCalls).toBe(2);
    await act(async () => {
      window.dispatchEvent(new Event("pagehide"));
      hide(false);
      pairedDeviceTokenStore.setToken("replacement-fixture-token");
      root.render(<Fixture workspace="workspace.other" />);
    });
    await act(async () => {held.resolve(reply({target, proof}));});
    await act(async () => vi.advanceTimersByTimeAsync(10_000));
    expect(registerCalls).toBe(2);
    await act(async () => {window.dispatchEvent(new Event("pageshow"));});
    expect(registerCalls).toBe(3);
    await act(async () => vi.advanceTimersByTimeAsync(30_000));
    expect(registerCalls).toBe(3);
  } finally {
    held.resolve(reply({target, proof}));
    await act(async () => {root.unmount();});
    container.remove();
  }
});

it("uses the existing modal and fences revoke before the server reply", async () => {
  hide(false);
  pairedDeviceTokenStore.setToken("fixture-browser-token");
  let revoked = false;
  let retired = false;
  const held = Promise.withResolvers<Response>();
  const fetch = vi.fn(async (input: string, options: RequestInit) => {
    const headers = new Headers(options.headers);
    expect(options.mode).toBe("same-origin");
    const request = JSON.parse(String(options.body));
    expect(input).toBe(request.operation === "observe" ? "/api/headless/browser/observe" : "/api/headless/browser/consent");
    expect(headers.get("x-organization-id")).toBe("fixture-org");
    if (request.operation === "register") {
      expect(headers.has("x-aisb-headless-document")).toBe(false);
      return reply({target, proof});
    }
    expect(headers.get("x-aisb-headless-document")).toBe(proof);
    if (request.operation === "observe") return reply({status: "ready", request: pending});
    if (request.operation === "accept" || request.operation === "ready") return reply(grant);
    if (request.operation === "revoke") { revoked = true; return held.promise; }
    retired = true;
    expect(options.keepalive).toBe(true);
    return reply({ok: true});
  });
  vi.stubGlobal("fetch", fetch);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  function Fixture() {
    const control = useManagedBrowserTakeover(target.workspaceId, "fixture-org", false);
    return <WindowTakeoverProvider control={control}><button>Human action</button><WindowTakeoverControls /></WindowTakeoverProvider>;
  }
  try {
    await act(async () => {root.render(<Fixture />);});
    expect(container.querySelector('[role="dialog"]')).toBeNull();
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain("Automation takeover request");
    await act(async () => {click("Accept automation takeover");});
    expect(document.body.textContent).toContain("Automation controls this window.");
    await act(async () => {click("Revoke automation takeover");});
    expect(revoked).toBe(true);
    expect(document.body.textContent).toContain("You have control of this window.");
    expect(document.body.textContent).not.toContain("Automation controls this window.");
    await act(async () => {hide(true);});
    expect(retired).toBe(true);
    expect(localStorage.length).toBe(1);
    expect(localStorage.getItem(localStorage.key(0)!)).toBe("fixture-browser-token");
  } finally {
    held.resolve(reply({ok: true}));
    await act(async () => {root.unmount();});
    container.remove();
  }
});

it("recovers consent after the server reaches temporary registration capacity", async () => {
  vi.useFakeTimers();
  hide(false);
  pairedDeviceTokenStore.setToken("fixture-browser-token");
  const calls: string[] = [];
  vi.stubGlobal("fetch", async (_input: string, options: RequestInit) => {
    const {operation} = JSON.parse(String(options.body));
    calls.push(operation);
    if (calls.length === 1) return new Response(null, {status: 503});
    if (operation === "register") return reply({target, proof});
    return reply({status: "ready", request: pending});
  });
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  function Fixture() {
    const control = useManagedBrowserTakeover(target.workspaceId, "fixture-org", false);
    return <WindowTakeoverProvider control={control}><WindowTakeoverControls /></WindowTakeoverProvider>;
  }
  try {
    await act(async () => {root.render(<Fixture />);});
    expect(calls).toEqual(["register"]);
    await act(async () => vi.advanceTimersByTimeAsync(1_500));
    expect(calls).toEqual(["register", "register", "observe"]);
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain("Automation takeover request");
    expect(pairedDeviceTokenStore.getToken()).toBe("fixture-browser-token");
  } finally {
    await act(async () => {root.unmount();});
    container.remove();
  }
});

it("cannot present a delayed observation after the browser credential is replaced", async () => {
  hide(false);
  pairedDeviceTokenStore.setToken("fixture-first-browser-token");
  const held = Promise.withResolvers<Response>();
  const calls: string[] = [];
  vi.stubGlobal("fetch", async (_input: string, options: RequestInit) => {
    const token = new Headers(options.headers).get("authorization");
    const {operation} = JSON.parse(String(options.body));
    calls.push(operation);
    if (token !== "Bearer fixture-first-browser-token") return new Response(null, {status: 403});
    return operation === "register" ? reply({target, proof}) : held.promise;
  });
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  function Fixture() {
    const control = useManagedBrowserTakeover(target.workspaceId, "fixture-org", false);
    return <WindowTakeoverProvider control={control}><WindowTakeoverControls /></WindowTakeoverProvider>;
  }
  try {
    await act(async () => {root.render(<Fixture />);});
    expect(calls).toEqual(["register", "observe"]);
    await act(async () => {pairedDeviceTokenStore.setToken("fixture-new-browser-token");});
    await act(async () => {held.resolve(reply({status: "ready", request: pending}));});
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(calls).toEqual(["register", "observe", "register"]);
  } finally {
    held.resolve(reply({status: "ready"}));
    await act(async () => {root.unmount();});
    container.remove();
  }
});

it("shows the first saved command and withholds a held command and context after local revoke", async () => {
  vi.useFakeTimers();
  hide(false);
  pairedDeviceTokenStore.setToken("fixture-browser-token");
  const lateCommand = Promise.withResolvers<Response>();
  const lateContext = Promise.withResolvers<Response>();
  const intent = {action:"open-system", systemId:"fixture.system", revisionId:"revision-1"};
  const command = {target:grant.target, commandId:id(11), intent, sequence:1, remainingMs:1_000};
  const acknowledged: unknown[] = [];
  const published: unknown[] = [];
  let accepted = false;
  let waitingToPull = false;
  let challengeCalls = 0;
  let revokeCalls = 0;
  let discardFirstAckReply = true;
  vi.stubGlobal("fetch", async (_input: string, options: RequestInit) => {
    const request = JSON.parse(String(options.body));
    switch (request.operation) {
      case "register": return reply({target, proof});
      case "observe": return accepted ? reply({status:"ready", request:{...pending, status:"active"}, lease:grant}, true)
        : reply({status:"ready", request:pending}, true);
      case "accept": return reply(grant);
      case "ready": accepted = true; return reply(grant);
      case "challenge": return ++challengeCalls === 1 ? reply({challenge:id(12)}) : lateContext.promise;
      case "publish": published.push(request.input); return reply({ok:true});
      case "acknowledge":
        acknowledged.push(request.input.receipt);
        if (discardFirstAckReply) {
          discardFirstAckReply = false;
          throw new TypeError("The acknowledgment reply was lost after application.");
        }
        return reply({ok:true});
      case "pull":
        if (request.input.sequence === 1) return reply({status:"command", command, detail:{title:"Saved metadata"}});
        waitingToPull = true;
        return lateCommand.promise;
      case "revoke": revokeCalls++; return reply({ok:true});
      default: return reply({ok:true});
    }
  });
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  function Fixture() {
    const control = useManagedBrowserTakeover(target.workspaceId, "fixture-org", false);
    return <WindowTakeoverProvider control={control}>
      <h1>Existing view</h1>
      {control.presented && <PresentedWindowResource {...control.presented} elementRef={control.presentedElement} />}
      <WindowTakeoverControls />
    </WindowTakeoverProvider>;
  }
  try {
    await act(async () => {root.render(<Fixture />);});
    await act(async () => {click("Accept automation takeover");});
    expect(container.querySelector('[aria-label="Resource shown by automation"]')?.textContent).toContain("Saved metadata");
    await act(async () => vi.advanceTimersByTimeAsync(650));
    const receipt = {sequence:1, commandId:id(11), status:"applied"};
    expect(acknowledged).toEqual([receipt,receipt]);
    expect(waitingToPull).toBe(true);
    expect(challengeCalls).toBe(2);
    expect(published).toEqual([{target:grant.target, challenge:id(12),
      context:{view:"system", ready:true, dirtyNavigationBlocked:false, selection:intent}}]);
    await act(async () => {click("Revoke automation takeover");});
    expect(revokeCalls).toBe(1);
    expect(container.querySelector('[aria-label="Resource shown by automation"]')).toBeNull();
    await act(async () => {
      lateCommand.resolve(reply({status:"command", command:{...command, commandId:id(13), sequence:2},
        detail:{title:"Late saved data"}}));
      lateContext.resolve(reply({challenge:id(14)}));
    });
    expect(acknowledged).toHaveLength(2);
    expect(published).toHaveLength(1);
    expect(container.querySelector("h1")?.textContent).toBe("Existing view");
    expect(container.textContent).not.toContain("Late saved data");
  } finally {
    lateCommand.resolve(reply({status:"empty"}));
    lateContext.resolve(reply({}));
    await act(async () => {root.unmount();});
    container.remove();
  }
});
