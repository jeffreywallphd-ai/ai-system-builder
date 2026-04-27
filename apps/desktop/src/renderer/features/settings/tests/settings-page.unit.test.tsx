import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SettingsPage } from "../../../pages/SettingsPage";
import type { DesktopApplicationSettingsClient } from "../api/desktopApplicationSettingsClient";

const definitions = [
  { key: "huggingface.token", category: "huggingface", label: "HF token", valueKind: "secret", sensitive: true },
  { key: "huggingface.defaultNamespace", category: "huggingface", label: "Namespace", valueKind: "string" },
  { key: "models.default", category: "models", label: "Global model", valueKind: "object" },
  { key: "runtime.python.defaultDevice", category: "runtime", label: "Device", valueKind: "select", options: [{ value: "auto" }, { value: "cpu" }] },
  { key: "features.datasetPreparation.qaGeneration.default", category: "datasetPreparation", label: "DP QA default", valueKind: "object" },
] as const;

const values = [
  { key: "huggingface.token", configured: true, masked: true, maskedValue: "********" },
  { key: "huggingface.defaultNamespace", configured: true, value: "openai" },
  { key: "models.default", configured: true, value: { provider: "transformers", modelId: "google/flan-t5-base", inferenceMode: "text2text" } },
  { key: "runtime.python.defaultDevice", configured: true, value: "auto" },
  { key: "features.datasetPreparation.qaGeneration.default", configured: false },
];

let container: HTMLDivElement | undefined;
let root: Root | undefined;
let listDefinitions: ReturnType<typeof vi.fn>;
let readSettings: ReturnType<typeof vi.fn>;
let updateSetting: ReturnType<typeof vi.fn>;
let clearSetting: ReturnType<typeof vi.fn>;
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
  listDefinitions = vi.fn().mockResolvedValue({ definitions });
  readSettings = vi.fn().mockResolvedValue({ values });
  updateSetting = vi.fn().mockResolvedValue({ value: { key: "x", configured: true } });
  clearSetting = vi.fn().mockResolvedValue({ value: { key: "x", configured: false } });
  resolveModelDefault = vi.fn().mockResolvedValue({ resolved: { provider: "transformers", modelId: "google/flan-t5-base", inferenceMode: "text2text", source: "global" } });
});

afterEach(async () => {
  if (root) {
    await act(async () => root?.unmount());
  }
  container?.remove();
  container = undefined;
  root = undefined;
});

function setNativeValue(element: HTMLInputElement | HTMLSelectElement, value: string) {
  const descriptor = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(element), "value");
  descriptor?.set?.call(element, value);
}

describe("SettingsPage", () => {
  it("renders grouped settings sections", async () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => root?.render(<SettingsPage />));

    expect(container.textContent).toContain("Hugging Face");
    expect(container.textContent).toContain("Models");
    expect(container.textContent).toContain("Runtime");
    expect(container.textContent).toContain("Dataset Preparation");
    expect(container.textContent).toContain("Publishing");
  });

  it("updates non-secret and masks secret set/clear", async () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => root?.render(<SettingsPage />));

    const input = container.querySelector('[data-testid="setting-huggingface.defaultNamespace-input"]') as HTMLInputElement;
    await act(async () => {
      setNativeValue(input, "acme");
      input.dispatchEvent(new Event("input", { bubbles: true }));
      (container?.querySelector('[data-testid="setting-huggingface.defaultNamespace-save"]') as HTMLButtonElement).click();
    });

    const secretInput = container.querySelector('[data-testid="secret-input"]') as HTMLInputElement;
    await act(async () => {
      setNativeValue(secretInput, "hf_secret_value");
      secretInput.dispatchEvent(new Event("input", { bubbles: true }));
      (container?.querySelector('[data-testid="secret-save"]') as HTMLButtonElement).click();
    });
    await act(async () => {
      (container?.querySelector('[data-testid="secret-clear"]') as HTMLButtonElement).click();
    });

    expect(updateSetting).toHaveBeenCalledWith({ key: "huggingface.defaultNamespace", value: "acme" });
    expect(updateSetting).toHaveBeenCalledWith({ key: "huggingface.token", value: "hf_secret_value" });
    expect(clearSetting).toHaveBeenCalledWith({ key: "huggingface.token" });
    expect(container.textContent).toContain("********");
    expect(container.textContent).not.toContain("hf_secret_value");
  });
});

