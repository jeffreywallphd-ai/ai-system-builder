import { act, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { NotificationTestHarness, readNotificationMessages } from "../../../../../../../modules/ui/shared/notifications/tests/NotificationTestHarness";
import { SettingsPanel } from "../components/SettingsPanel";
import type { DesktopApplicationSettingsClient } from "../api/desktopApplicationSettingsClient";
import type { ApplicationSettingDefinition, ApplicationSettingValue } from "../../../../../../../modules/contracts/settings";

const definitions: ApplicationSettingDefinition[] = [
  { key: "huggingface.defaultNamespace", category: "huggingface", label: "Namespace", valueKind: "string" },
  { key: "runtime.python.defaultDevice", category: "runtime", label: "Device", valueKind: "select", options: [{ value: "auto" }, { value: "cpu" }, { value: "cuda" }] },
  { key: "runtime.enableTelemetry", category: "runtime", label: "Enable telemetry", valueKind: "boolean" },
  { key: "huggingface.token", category: "huggingface", label: "Hugging Face token", valueKind: "secret", sensitive: true },
  { key: "models.sharedStorageDirectory", category: "models", label: "Shared model storage folder", valueKind: "folder" },
  { key: "models.default", category: "models", label: "Global default model", valueKind: "object" },
];

const baseValues: ApplicationSettingValue[] = [
  { key: "huggingface.defaultNamespace", configured: true, value: "openai" },
  { key: "runtime.python.defaultDevice", configured: true, value: "auto" },
  { key: "runtime.enableTelemetry", configured: true, value: true },
  { key: "huggingface.token", configured: true, masked: true, maskedValue: "********" },
  { key: "models.sharedStorageDirectory", configured: true, value: "C:\\models" },
  {
    key: "models.default",
    configured: true,
    value: { provider: "transformers", modelId: "google/flan-t5-base", inferenceMode: "text2text", device: "auto", torchDtype: "auto" },
  },
];

let root: Root | undefined;
let container: HTMLDivElement | undefined;
let updateSetting: ReturnType<typeof vi.fn<DesktopApplicationSettingsClient["updateSetting"]>>;
let clearSetting: ReturnType<typeof vi.fn<DesktopApplicationSettingsClient["clearSetting"]>>;
let listDefinitions: ReturnType<typeof vi.fn<DesktopApplicationSettingsClient["listDefinitions"]>>;
let readSettings: ReturnType<typeof vi.fn<DesktopApplicationSettingsClient["readSettings"]>>;
let resolveModelDefault: ReturnType<typeof vi.fn<DesktopApplicationSettingsClient["resolveModelDefault"]>>;
let selectFolder: ReturnType<typeof vi.fn<DesktopApplicationSettingsClient["selectFolder"]>>;

vi.mock("../api/desktopApplicationSettingsClient", () => ({
  createDesktopApplicationSettingsClient: () => mockClient,
}));

const mockClient: DesktopApplicationSettingsClient = {
  listDefinitions: (...args) => listDefinitions(...args),
  readSettings: (...args) => readSettings(...args),
  updateSetting: (...args) => updateSetting(...args),
  clearSetting: (...args) => clearSetting(...args),
  resolveModelDefault: (...args) => resolveModelDefault(...args),
  selectFolder: (...args) => selectFolder(...args),
};

beforeEach(() => {
  updateSetting = vi.fn<DesktopApplicationSettingsClient["updateSetting"]>().mockResolvedValue({ value: { key: "x", configured: true } });
  clearSetting = vi.fn<DesktopApplicationSettingsClient["clearSetting"]>().mockResolvedValue({ value: { key: "x", configured: false } });
  listDefinitions = vi.fn<DesktopApplicationSettingsClient["listDefinitions"]>().mockResolvedValue({ definitions });
  readSettings = vi.fn<DesktopApplicationSettingsClient["readSettings"]>().mockResolvedValue({ values: baseValues });
  resolveModelDefault = vi.fn<DesktopApplicationSettingsClient["resolveModelDefault"]>().mockResolvedValue({
    resolved: { provider: "transformers", modelId: "google/flan-t5-base", inferenceMode: "text2text", source: "global", settingKey: "models.default" },
  });
  selectFolder = vi.fn<DesktopApplicationSettingsClient["selectFolder"]>().mockResolvedValue({ canceled: false, path: "D:\\shared-models" });
});

afterEach(async () => {
  if (root) {
    await act(async () => {
      root?.unmount();
    });
  }
  container?.remove();
  root = undefined;
  container = undefined;
});


function setNativeValue(element: HTMLInputElement | HTMLSelectElement, value: string) {
  const prototype = Object.getPrototypeOf(element);
  const descriptor = Object.getOwnPropertyDescriptor(prototype, "value");
  descriptor?.set?.call(element, value);
}

async function renderPanel(props: Partial<ComponentProps<typeof SettingsPanel>> = {}) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root?.render(
      <NotificationTestHarness>
        <SettingsPanel title="Test" {...props} />
      </NotificationTestHarness>,
    );
  });
}

describe("SettingsPanel", () => {
  it("loads definitions and values by category", async () => {
    await renderPanel({ category: "huggingface" });

    expect(listDefinitions).toHaveBeenCalledWith({ category: "huggingface", keys: undefined });
    expect(readSettings).toHaveBeenCalledWith({ category: "huggingface", keys: undefined });
  });

  it("loads definitions and values by explicit keys", async () => {
    await renderPanel({ keys: ["runtime.python.defaultDevice", "models.default"] as never });

    expect(listDefinitions).toHaveBeenCalledWith({ category: undefined, keys: ["runtime.python.defaultDevice", "models.default"] });
    expect(readSettings).toHaveBeenCalledWith({ category: undefined, keys: ["runtime.python.defaultDevice", "models.default"] });
  });

  it("does not reload settings when equivalent key arrays are recreated", async () => {
    await renderPanel({ keys: ["huggingface.defaultNamespace"] as never });

    expect(listDefinitions).toHaveBeenCalledTimes(1);
    expect(readSettings).toHaveBeenCalledTimes(1);

    await act(async () => {
      root?.render(
        <NotificationTestHarness>
          <SettingsPanel
            title="Test"
            keys={["huggingface.defaultNamespace"] as never}
          />
        </NotificationTestHarness>,
      );
      await Promise.resolve();
    });

    expect(listDefinitions).toHaveBeenCalledTimes(1);
    expect(readSettings).toHaveBeenCalledTimes(1);
  });

  it("updates string, select, and boolean settings", async () => {
    await renderPanel();

    const textInput = container?.querySelector('[data-testid="setting-huggingface.defaultNamespace-input"]') as HTMLInputElement;
    await act(async () => {
      setNativeValue(textInput, "org");
      textInput.dispatchEvent(new Event("input", { bubbles: true }));
      textInput.dispatchEvent(new Event("change", { bubbles: true }));
      (container?.querySelector('[data-testid="setting-huggingface.defaultNamespace-save"]') as HTMLButtonElement).click();
    });

    const deviceSelect = container?.querySelector('[data-testid="setting-runtime.python.defaultDevice-select"]') as HTMLSelectElement;
    await act(async () => {
      setNativeValue(deviceSelect, "cuda");
      deviceSelect.dispatchEvent(new Event("change", { bubbles: true }));
      (container?.querySelector('[data-testid="setting-runtime.python.defaultDevice-save"]') as HTMLButtonElement).click();
    });

    const booleanInput = container?.querySelector('[data-testid="setting-runtime.enableTelemetry-boolean"]') as HTMLInputElement;
    await act(async () => {
      booleanInput.click();
    });

    expect(updateSetting).toHaveBeenCalledWith({ key: "huggingface.defaultNamespace", value: "org" });
    expect(updateSetting).toHaveBeenCalledWith({ key: "runtime.python.defaultDevice", value: "cuda" });
    expect(updateSetting).toHaveBeenCalledWith({ key: "runtime.enableTelemetry", value: false });
  });

  it("renders secret masking and supports set/clear without showing raw value", async () => {
    await renderPanel({ category: "huggingface" });

    expect(container?.textContent).toContain("********");
    expect(container?.textContent).not.toContain("hf_secret");

    const secretInput = container?.querySelector('[data-testid="secret-input"]') as HTMLInputElement;
    await act(async () => {
      setNativeValue(secretInput, "hf_new");
      secretInput.dispatchEvent(new Event("input", { bubbles: true }));
      secretInput.dispatchEvent(new Event("change", { bubbles: true }));
      (container?.querySelector('[data-testid="secret-save"]') as HTMLButtonElement).click();
    });
    await act(async () => {
      (container?.querySelector('[data-testid="secret-clear"]') as HTMLButtonElement).click();
    });

    expect(updateSetting).toHaveBeenCalledWith({ key: "huggingface.token", value: "hf_new" });
    expect(clearSetting).toHaveBeenCalledWith({ key: "huggingface.token" });
  });

  it("lets folder settings browse through the desktop bridge", async () => {
    await renderPanel({ keys: ["models.sharedStorageDirectory"] as never });

    await act(async () => {
      (container?.querySelector('[data-testid="setting-models.sharedStorageDirectory-browse"]') as HTMLButtonElement).click();
    });

    const input = container?.querySelector('[data-testid="setting-models.sharedStorageDirectory-input"]') as HTMLInputElement;
    expect(selectFolder).toHaveBeenCalledWith({ title: "Shared model storage folder", defaultPath: "C:\\models" });
    expect(input.value).toBe("D:\\shared-models");
  });

  it("renders and saves model default with modelId and inferenceMode together", async () => {
    await renderPanel({ keys: ["models.default"] as never });

    expect(container?.textContent).toContain("Inference mode");
    expect(container?.textContent).toContain("auto");
    expect(container?.textContent).toContain("text2text");
    expect(container?.textContent).toContain("causal");
    expect(container?.textContent).toContain("chat");

    const modelId = container?.querySelector('[data-testid="model-default-model-id"]') as HTMLInputElement;
    await act(async () => {
      setNativeValue(modelId, "google/flan-t5-large");
      modelId.dispatchEvent(new Event("input", { bubbles: true }));
      modelId.dispatchEvent(new Event("change", { bubbles: true }));
    });

    const inferenceSelect = container?.querySelector('[data-testid="model-default-inference-mode"]') as HTMLSelectElement;
    await act(async () => {
      setNativeValue(inferenceSelect, "chat");
      inferenceSelect.dispatchEvent(new Event("change", { bubbles: true }));
      (container?.querySelector('[data-testid="model-default-save"]') as HTMLButtonElement).click();
    });

    expect(updateSetting).toHaveBeenCalledWith({
      key: "models.default",
      value: expect.objectContaining({ modelId: "google/flan-t5-large", inferenceMode: "chat", provider: "transformers" }),
    });
  });

  it("renders error state", async () => {
    listDefinitions.mockRejectedValueOnce(new Error("settings unavailable"));
    await renderPanel();

    expect(readNotificationMessages(container!)).toContain("Could not load settings. Refresh settings to try again.");
    expect(container?.textContent).not.toContain("settings unavailable");
  });

  it("supports compact feature-local rendering", async () => {
    await renderPanel({ compact: true, category: "runtime" });

    const panel = container?.querySelector("section.ui-panel") as HTMLElement;
    expect(panel.className).toContain("settings-panel--compact");
  });

  it("keeps a failed secret draft and publishes only a fixed safe error", async () => {
    const synthetic = "synthetic-retry-input";
    updateSetting.mockRejectedValueOnce(new Error(`private provider details ${synthetic}`));
    await renderPanel({ category: "huggingface" });
    const input = container!.querySelector('[data-testid="secret-input"]') as HTMLInputElement;
    await act(async () => {
      setNativeValue(input, synthetic);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => (container!.querySelector('[data-testid="secret-save"]') as HTMLButtonElement).click());
    expect(input.value).toBe(synthetic);
    expect(readNotificationMessages(container!)).toContain("Could not save setting. Try again.");
    expect(readNotificationMessages(container!)).not.toContain(synthetic);
    expect(container!.textContent).not.toContain(synthetic);
    expect(readNotificationMessages(container!)).not.toContain("Setting saved.");
    await act(async () => (container!.querySelector('[data-testid="secret-save"]') as HTMLButtonElement).click());
    expect(updateSetting).toHaveBeenCalledTimes(2);
    expect(input.value).toBe("");
    expect(readNotificationMessages(container!)).toContain("Setting saved.");
  });

  it("does not clear a secret or announce success when save readback fails", async () => {
    await renderPanel({ category: "huggingface" });
    readSettings.mockRejectedValueOnce(new Error("private readback details"));
    const input = container!.querySelector('[data-testid="secret-input"]') as HTMLInputElement;
    await act(async () => {
      setNativeValue(input, "synthetic-readback-input");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => (container!.querySelector('[data-testid="secret-save"]') as HTMLButtonElement).click());
    expect(updateSetting).toHaveBeenCalledTimes(1);
    expect(input.value).toBe("synthetic-readback-input");
    expect(readNotificationMessages(container!)).not.toContain("Setting saved.");
    expect(readNotificationMessages(container!)).not.toContain("private readback details");
    expect(readNotificationMessages(container!)).toContain("Could not reload settings after the change. Refresh settings before trying again.");
    const refresh = Array.from(container!.querySelectorAll("button")).find(button => button.textContent === "Refresh settings");
    expect(refresh).toBeDefined();
    await act(async () => refresh!.click());
    expect(readSettings).toHaveBeenCalledTimes(3);
    expect(input.value).toBe("synthetic-readback-input");
  });

  it("admits one secret write before a pending save disables controls", async () => {
    let finish!: () => void;
    updateSetting.mockImplementationOnce(() => new Promise<Awaited<ReturnType<DesktopApplicationSettingsClient["updateSetting"]>>>(resolve => {
      finish = () => resolve({ value: { key: "huggingface.token", configured: true, masked: true, maskedValue: "********" } });
    }));
    await renderPanel({ category: "huggingface" });
    const input = container!.querySelector('[data-testid="secret-input"]') as HTMLInputElement;
    await act(async () => {
      setNativeValue(input, "synthetic-duplicate-input");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const save = container!.querySelector('[data-testid="secret-save"]') as HTMLButtonElement;
    await act(async () => { save.click(); save.click(); });
    expect(updateSetting).toHaveBeenCalledTimes(1);
    expect(save.disabled).toBe(true);
    expect(input.value).toBe("synthetic-duplicate-input");
    await act(async () => finish());
    expect(input.value).toBe("");
    expect(save.disabled).toBe(true);
  });

  it("can refresh after an initial read failure without an inline error", async () => {
    readSettings.mockRejectedValueOnce(new Error("synthetic private read details"));
    await renderPanel();
    expect(readNotificationMessages(container!)).toContain("Could not load settings. Refresh settings to try again.");
    expect(container!.querySelector('[data-testid="secret-input"]')).toBeNull();
    const refresh = Array.from(container!.querySelectorAll("button")).find(button => button.textContent === "Refresh settings")!;
    await act(async () => refresh.click());
    expect(readSettings).toHaveBeenCalledTimes(2);
    expect(container!.querySelector('[data-testid="secret-input"]')).not.toBeNull();
    expect(container!.textContent).not.toContain("synthetic private read details");
  });

  it("retains a failed Clear draft and clears it only after successful retry", async () => {
    clearSetting.mockRejectedValueOnce(new Error("synthetic private clear details"));
    await renderPanel();
    const input = container!.querySelector('[data-testid="secret-input"]') as HTMLInputElement;
    await act(async () => {
      setNativeValue(input, "synthetic-clear-retry"); input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const clear = container!.querySelector('[data-testid="secret-clear"]') as HTMLButtonElement;
    await act(async () => clear.click());
    expect(input.value).toBe("synthetic-clear-retry");
    expect(readNotificationMessages(container!)).toContain("Could not clear setting. Try again.");
    expect(readNotificationMessages(container!)).not.toContain("synthetic private clear details");
    await act(async () => clear.click());
    expect(clearSetting).toHaveBeenCalledTimes(2); expect(input.value).toBe("");
    expect(readNotificationMessages(container!)).toContain("Setting cleared.");
  });

  it("refreshes ordinary and model-default drafts from the current read", async () => {
    await renderPanel();
    readSettings.mockResolvedValueOnce({ values: baseValues.map(value => value.key === "huggingface.defaultNamespace"
      ? { ...value, value: "refreshed-namespace" } : value.key === "models.default"
        ? { ...value, value: { provider: "transformers", modelId: "synthetic/refreshed", inferenceMode: "chat" } } : value) });
    const refresh = Array.from(container!.querySelectorAll("button")).find(button => button.textContent === "Refresh settings")!;
    await act(async () => refresh.click());
    expect((container!.querySelector('[data-testid="setting-huggingface.defaultNamespace-input"]') as HTMLInputElement).value).toBe("refreshed-namespace");
    expect((container!.querySelector('[data-testid="model-default-model-id"]') as HTMLInputElement).value).toBe("synthetic/refreshed");
    expect((container!.querySelector('[data-testid="model-default-inference-mode"]') as HTMLSelectElement).value).toBe("chat");
  });

  it.each([null, { values: null }, { values: [null] }])("recovers safely from malformed initial readback %j", async malformed => {
    readSettings.mockResolvedValueOnce(malformed as unknown as Awaited<ReturnType<DesktopApplicationSettingsClient["readSettings"]>>);
    await renderPanel();
    expect(readNotificationMessages(container!)).toContain("Could not load settings. Refresh settings to try again.");
    const refresh = Array.from(container!.querySelectorAll("button")).find(button => button.textContent === "Refresh settings")!;
    await act(async () => refresh.click());
    expect(container!.querySelector('[data-testid="secret-input"]')).not.toBeNull();
  });

  it("keeps the secret draft when a successful write returns malformed readback", async () => {
    await renderPanel();
    const input = container!.querySelector('[data-testid="secret-input"]') as HTMLInputElement;
    await act(async () => {
      setNativeValue(input, "synthetic-malformed-retry"); input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    readSettings.mockResolvedValueOnce({ values: [null] } as unknown as Awaited<ReturnType<DesktopApplicationSettingsClient["readSettings"]>>);
    await act(async () => (container!.querySelector('[data-testid="secret-save"]') as HTMLButtonElement).click());
    expect(input.value).toBe("synthetic-malformed-retry");
    expect(readNotificationMessages(container!)).toContain("Could not reload settings after the change. Refresh settings before trying again.");
    expect(readNotificationMessages(container!)).not.toContain("Setting saved.");
    const refresh = Array.from(container!.querySelectorAll("button")).find(button => button.textContent === "Refresh settings")!;
    await act(async () => refresh.click());
    await act(async () => (container!.querySelector('[data-testid="secret-save"]') as HTMLButtonElement).click());
    expect(input.value).toBe(""); expect(updateSetting).toHaveBeenCalledTimes(2);
  });

  it("rejects malformed definition rows before rendering fields", async () => {
    listDefinitions.mockResolvedValueOnce({ definitions: [null] } as unknown as Awaited<ReturnType<DesktopApplicationSettingsClient["listDefinitions"]>>);
    await renderPanel();
    expect(readNotificationMessages(container!)).toContain("Could not load settings. Refresh settings to try again.");
    expect(container!.querySelector('[data-testid="secret-input"]')).toBeNull();
  });

  it.each(["save", "clear"] as const)("preserves a new draft edit queued in the same turn as %s", async action => {
    let finish!: () => void;
    const pending = new Promise<Awaited<ReturnType<DesktopApplicationSettingsClient["updateSetting"]>>>(resolve => {
      finish = () => resolve({ value: { key: "huggingface.token", configured: true, masked: true, maskedValue: "********" } });
    });
    if (action === "save") updateSetting.mockReturnValueOnce(pending); else clearSetting.mockReturnValueOnce(pending);
    await renderPanel();
    const input = container!.querySelector('[data-testid="secret-input"]') as HTMLInputElement;
    await act(async () => { setNativeValue(input, "synthetic-submitted"); input.dispatchEvent(new Event("input", { bubbles: true })); });
    await act(async () => {
      (container!.querySelector(`[data-testid="secret-${action}"]`) as HTMLButtonElement).click();
      setNativeValue(input, "synthetic-new-edit"); input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(input.value).toBe("synthetic-new-edit");
    await act(async () => finish());
    expect(input.value).toBe("synthetic-new-edit");
    expect(input.disabled).toBe(false);
    if (action === "save") expect(updateSetting).toHaveBeenCalledWith({ key: "huggingface.token", value: "synthetic-submitted" });
  });
});
