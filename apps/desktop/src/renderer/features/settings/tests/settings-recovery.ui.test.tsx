import { act, StrictMode, Suspense, startTransition } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DesktopApplicationSettingsClient } from "../api/desktopApplicationSettingsClient";
import { useApplicationSettings, type UseApplicationSettingsResult } from "../hooks/useApplicationSettings";
import type { ApplicationSettingCategory, ApplicationSettingKey } from "../../../../../../../modules/contracts/settings";

const key = "huggingface.defaultNamespace";
const secondKey = "runtime.python.defaultDevice";
function held<T>() {
  let resolve!: (value: T) => void, reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function values(value: string) { return { values: [{ key, configured: true, value }] }; }
function client(value = "current") {
  return {
    listDefinitions: vi.fn(async (_query?: Parameters<DesktopApplicationSettingsClient["listDefinitions"]>[0]) => ({
      definitions: [{ key, category: "huggingface" as const, label: "Namespace", valueKind: "string" as const }],
    })),
    readSettings: vi.fn(async (_query?: Parameters<DesktopApplicationSettingsClient["readSettings"]>[0]) => values(value)),
    updateSetting: vi.fn(async (_input: Parameters<DesktopApplicationSettingsClient["updateSetting"]>[0]) => ({ value: { key, configured: true } })),
    clearSetting: vi.fn(async (_input: Parameters<DesktopApplicationSettingsClient["clearSetting"]>[0]) => ({ value: { key, configured: false } })),
    resolveModelDefault: vi.fn(async (_input: Parameters<DesktopApplicationSettingsClient["resolveModelDefault"]>[0]) => ({
      resolved: { provider: "transformers" as const, modelId: "synthetic/model", inferenceMode: "chat" as const, source: "global" as const },
    })),
    selectFolder: vi.fn(async (_input?: { title?: string; defaultPath?: string }) => ({ canceled: false, path: "synthetic-folder" })),
  } satisfies DesktopApplicationSettingsClient;
}
type Props = { client: DesktopApplicationSettingsClient; category?: ApplicationSettingCategory; keys?: ApplicationSettingKey[]; suspend?: boolean };
let root: Root | undefined, container: HTMLDivElement | undefined, current: UseApplicationSettingsResult;
let strict = false;
const never = new Promise<void>(() => {});
function Probe(props: Props) {
  current = useApplicationSettings(props);
  if (props.suspend) throw never;
  return <><output data-testid="value">{String(current.valuesByKey.get(key)?.value ?? "")}</output>
    <p role="status">{current.loading ? "Loading" : current.saving ? "Saving" : current.status}</p>
    <p>{current.errorMessage}</p><p>{current.successMessage}</p></>;
}
async function render(props: Props) {
  if (!root) {
    container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container);
  }
  await act(async () => root!.render(strict ? <StrictMode><Probe {...props} /></StrictMode> : <Suspense fallback="Waiting"><Probe {...props} /></Suspense>));
}
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  container?.remove(); root = undefined; container = undefined; strict = false;
});
function shown() { return container!.querySelector('[data-testid="value"]')?.textContent; }

describe("Settings committed view and request recovery", () => {
  it.each(["resolve", "reject"] as const)("ignores an old client read that later %s", async disposition => {
    const old = client("old"), next = client("new"), pending = held<ReturnType<typeof values>>();
    old.readSettings.mockReturnValueOnce(pending.promise);
    await render({ client: old }); expect(current.loading).toBe(true);
    await render({ client: next }); expect(shown()).toBe("new");
    await act(async () => disposition === "resolve" ? pending.resolve(values("old")) : pending.reject(new Error("private old error")));
    expect(shown()).toBe("new"); expect(current.status).toBe("idle"); expect(current.loading).toBe(false);
    expect(container!.textContent).not.toContain("private old error");
  });

  it("retires a category/key query and copies caller key arrays", async () => {
    const c = client(), pending = held<ReturnType<typeof values>>(), keys: ApplicationSettingKey[] = [key];
    c.readSettings.mockReturnValueOnce(pending.promise);
    await render({ client: c, category: "huggingface", keys });
    keys.push(secondKey);
    expect(c.readSettings.mock.calls[0][0]).toEqual({ category: "huggingface", keys: [key] });
    c.readSettings.mockResolvedValueOnce(values("new query"));
    await render({ client: c, category: "runtime", keys: [secondKey] });
    await act(async () => pending.resolve(values("old query")));
    expect(shown()).toBe("new query");
    expect(c.readSettings).toHaveBeenLastCalledWith({ category: "runtime", keys: [secondKey] });
  });

  it("does not reload an equivalent key list or change callback ownership", async () => {
    const c = client(); await render({ client: c, keys: [key] }); const save = current.updateSetting;
    await render({ client: c, keys: [key] });
    expect(c.readSettings).toHaveBeenCalledTimes(1); expect(current.updateSetting).toBe(save);
  });

  it("only adopts the latest overlapping refresh", async () => {
    const c = client(); await render({ client: c });
    const first = held<ReturnType<typeof values>>(), second = held<ReturnType<typeof values>>();
    c.readSettings.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    let a!: Promise<void>, b!: Promise<void>;
    await act(async () => { a = current.refresh(); b = current.refresh(); });
    await act(async () => { second.resolve(values("newest")); await b; });
    await act(async () => { first.reject(new Error("private older failure")); await a; });
    expect(shown()).toBe("newest"); expect(current.loading).toBe(false); expect(current.status).toBe("idle");
  });

  it.each(["resolve", "reject"] as const)("retires a pending write that later %s without refreshing or notifying a new view", async disposition => {
    const old = client("old"), next = client("new"), pending = held<{ value: { key: string; configured: boolean } }>();
    await render({ client: old }); old.updateSetting.mockReturnValueOnce(pending.promise);
    let saved!: Promise<boolean>;
    await act(async () => { saved = current.updateSetting(key, "synthetic-change"); });
    await render({ client: next });
    await act(async () => {
      if (disposition === "resolve") pending.resolve({ value: { key, configured: true } }); else pending.reject(new Error("private write details"));
      expect(await saved).toBe(false);
    });
    expect(old.readSettings).toHaveBeenCalledTimes(1); expect(next.readSettings).toHaveBeenCalledTimes(1);
    expect(shown()).toBe("new"); expect(current.saving).toBe(false); expect(current.status).toBe("idle");
  });

  it("admits one same-turn save/clear, then releases denial for explicit retry", async () => {
    const c = client(); await render({ client: c }); const pending = held<{ value: { key: string; configured: boolean } }>();
    c.updateSetting.mockReturnValueOnce(pending.promise); let saved!: Promise<boolean>;
    await act(async () => { saved = current.updateSetting(key, "synthetic"); expect(await current.clearSetting(key)).toBe(false); });
    expect(c.updateSetting).toHaveBeenCalledTimes(1); expect(c.clearSetting).not.toHaveBeenCalled();
    await act(async () => { pending.reject(new Error("private refused value")); expect(await saved).toBe(false); });
    expect(current.saving).toBe(false); expect(current.errorMessage).toBe("Could not save setting. Try again.");
    await act(async () => { expect(await current.clearSetting(key)).toBe(true); });
    expect(c.clearSetting).toHaveBeenCalledTimes(1); expect(current.successMessage).toBe("Setting cleared.");
  });

  it("requires a successful refresh after an uncertain clear readback", async () => {
    const c = client(); await render({ client: c }); c.readSettings.mockRejectedValueOnce(new Error("private read failure"));
    await act(async () => { expect(await current.clearSetting(key)).toBe(false); });
    expect(current.status).toBe("error"); expect(current.successMessage).toBeUndefined();
    expect(current.errorMessage).toBe("Could not reload settings after the change. Refresh settings before trying again.");
    await act(async () => { expect(await current.updateSetting(key, "no dispatch")).toBe(false); });
    expect(c.updateSetting).not.toHaveBeenCalled();
    await act(async () => current.refresh());
    await act(async () => { expect(await current.updateSetting(key, "retry")).toBe(true); });
  });

  it("does not let retained callbacks dispatch after replacement or unmount", async () => {
    const old = client(), next = client("next"); await render({ client: old }); const retired = current;
    await render({ client: next });
    await act(async () => {
      expect(await retired.updateSetting(key, "no dispatch")).toBe(false);
      expect(await retired.clearSetting(key)).toBe(false); await retired.refresh();
      expect(await retired.selectFolder()).toBeUndefined();
    });
    const unmounted = current; await act(async () => root!.unmount()); root = undefined;
    expect(await unmounted.updateSetting(key, "no dispatch")).toBe(false);
    expect(await unmounted.selectFolder()).toBeUndefined();
    expect(old.updateSetting).not.toHaveBeenCalled(); expect(old.clearSetting).not.toHaveBeenCalled();
    expect(old.readSettings).toHaveBeenCalledTimes(1); expect(next.updateSetting).not.toHaveBeenCalled();
  });

  it("survives StrictMode effect replay without adopting the first read", async () => {
    strict = true; const c = client("replayed"), first = held<ReturnType<typeof values>>();
    c.readSettings.mockReturnValueOnce(first.promise); await render({ client: c });
    expect(c.readSettings).toHaveBeenCalledTimes(2); expect(shown()).toBe("replayed");
    await act(async () => first.reject(new Error("retired first lease")));
    expect(shown()).toBe("replayed"); expect(current.status).toBe("idle");
    await act(async () => { expect(await current.updateSetting(key, "after replay")).toBe(true); });
  });

  it("an abandoned render grants no write and does not retire the committed client", async () => {
    const old = client("committed"), proposed = client("uncommitted"); await render({ client: old }); const committed = current;
    await act(async () => startTransition(() => root!.render(<Suspense fallback="Waiting"><Probe client={proposed} suspend /></Suspense>)));
    const uncommitted = current;
    expect(shown()).toBe("committed");
    expect(await uncommitted.updateSetting(key, "no dispatch")).toBe(false);
    await act(async () => { expect(await committed.updateSetting(key, "committed change")).toBe(true); });
    expect(old.updateSetting).toHaveBeenCalledTimes(1); expect(proposed.updateSetting).not.toHaveBeenCalled();
    expect(proposed.readSettings).not.toHaveBeenCalled();
  });

  it("bounds folder admission, ignores retired results and maps errors to safe text", async () => {
    const old = client(), next = client("new"), pending = held<{ canceled: boolean; path: string }>();
    await render({ client: old }); old.selectFolder.mockReturnValueOnce(pending.promise);
    const folder = current.selectFolder({ title: "Synthetic folder" });
    expect(await current.selectFolder()).toBeUndefined(); expect(old.selectFolder).toHaveBeenCalledTimes(1);
    await render({ client: next }); pending.resolve({ canceled: false, path: "retired-synthetic-folder" }); expect(await folder).toBeUndefined();
    next.selectFolder.mockRejectedValueOnce(new Error("private native path"));
    await act(async () => { expect(await current.selectFolder()).toBeUndefined(); });
    expect(current.errorMessage).toBe("Could not choose a folder. Try again.");
    expect(container!.textContent).not.toContain("private native path");
    await act(async () => { expect(await current.selectFolder()).toBe("synthetic-folder"); });
    expect(current.errorMessage).toBeUndefined();
  });

  it("does not return a retired model default or raw resolver error", async () => {
    const old = client(), next = client(), pending = held<Awaited<ReturnType<typeof old.resolveModelDefault>>>();
    await render({ client: old }); old.resolveModelDefault.mockReturnValueOnce(pending.promise);
    const result = current.resolveModelDefault({ taskKey: "qaGeneration" });
    const refusal = expect(result).rejects.toThrow("Could not resolve the model setting. Try again.");
    await render({ client: next }); pending.resolve({ resolved: { provider: "transformers", modelId: "synthetic/old", inferenceMode: "chat", source: "global" } }); await refusal;
    next.resolveModelDefault.mockRejectedValueOnce(new Error("private resolver details"));
    await expect(current.resolveModelDefault({ taskKey: "qaGeneration" })).rejects.toThrow("Could not resolve the model setting. Try again.");
  });
});
