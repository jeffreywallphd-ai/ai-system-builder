import { act, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SettingsPanel } from "../components/SettingsPanel";
import type { DesktopApplicationSettingsClient } from "../api/desktopApplicationSettingsClient";

const definitions = [
  { key: "huggingface.defaultNamespace", category: "huggingface", label: "Namespace", valueKind: "string" },
  { key: "runtime.python.defaultDevice", category: "runtime", label: "Device", valueKind: "select", options: [{ value: "auto" }, { value: "cpu" }, { value: "cuda" }] },
  { key: "runtime.enableTelemetry", category: "runtime", label: "Enable telemetry", valueKind: "boolean" },
  { key: "huggingface.token", category: "huggingface", label: "Hugging Face token", valueKind: "secret", sensitive: true },
  { key: "models.default", category: "models", label: "Global default model", valueKind: "object" },
] as const;

const baseValues = [
  { key: "huggingface.defaultNamespace", configured: true, value: "openai" },
  { key: "runtime.python.defaultDevice", configured: true, value: "auto" },
  { key: "runtime.enableTelemetry", configured: true, value: true },
  { key: "huggingface.token", configured: true, masked: true, maskedValue: "********" },
  {
    key: "models.default",
    configured: true,
    value: { provider: "transformers", modelId: "google/flan-t5-base", inferenceMode: "text2text", device: "auto", torchDtype: "auto" },
  },
];

let root: Root | undefined;
let container: HTMLDivElement | undefined;
let updateSetting: ReturnType<typeof vi.fn>;
let clearSetting: ReturnType<typeof vi.fn>;
let listDefinitions: ReturnType<typeof vi.fn>;
let readSettings: ReturnType<typeof vi.fn>;
let resolveModelDefault: ReturnType<typeof vi.fn>;

vi.mock("../api/desktopApplicationSettingsClient", () => ({
  createDesktopApplicationSettingsClient: () => mockClient,
}));

const mockClient: DesktopApplicationSettingsClient = {
  listDefinitions: (...args) => listDefinitions(...args),
  readSettings: (...args) => readSettings(...args),
  updateSetting: (...args) => updateSetting(...args),
  clearSetting: (...args) => clearSetting(...args),
  resolveModelDefault: (...args) => resolveModelDefault(...args),
};

beforeEach(() => {
  updateSetting = vi.fn().mockResolvedValue({ value: { key: "x", configured: true } });
  clearSetting = vi.fn().mockResolvedValue({ value: { key: "x", configured: false } });
  listDefinitions = vi.fn().mockResolvedValue({ definitions });
  readSettings = vi.fn().mockResolvedValue({ values: baseValues });
  resolveModelDefault = vi.fn().mockResolvedValue({
    resolved: { provider: "transformers", modelId: "google/flan-t5-base", inferenceMode: "text2text", source: "global", settingKey: "models.default" },
  });
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
    root?.render(<SettingsPanel title="Test" {...props} />);
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

    expect(container?.textContent).toContain("settings unavailable");
  });

  it("supports compact feature-local rendering", async () => {
    await renderPanel({ compact: true, category: "runtime" });

    const panel = container?.querySelector("section.ui-panel") as HTMLElement;
    expect(panel.className).toContain("settings-panel--compact");
  });
});
