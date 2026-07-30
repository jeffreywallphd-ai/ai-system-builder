// @ts-expect-error jsdom is a runtime test dependency without local declarations.
import { JSDOM } from "jsdom";
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "../../../../testing/node-test";

import {
  createDefaultDatasetPreparationVisualOutputShape,
  DATASET_PREPARATION_TEXT_GENERATION_TASK_TYPES,
  type DatasetPreparationTaskType,
  type DatasetPreparationVisualOutputShape,
} from "../../../../contracts/runtime";
import { DatasetPreparationOutputShapeEditor } from "../DatasetPreparationOutputShapeEditor";

const dom = new JSDOM("<!doctype html><html><body></body></html>", {
  url: "http://localhost/",
});
(globalThis as any).window = dom.window;
(globalThis as any).document = dom.window.document;
(globalThis as any).Event = dom.window.Event;
(globalThis as any).Node = dom.window.Node;
(globalThis as any).HTMLElement = dom.window.HTMLElement;
(globalThis as any).HTMLInputElement = dom.window.HTMLInputElement;
(globalThis as any).HTMLSelectElement = dom.window.HTMLSelectElement;
Object.defineProperty(globalThis, "navigator", {
  configurable: true,
  value: dom.window.navigator,
});
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | undefined;
let container: HTMLDivElement | undefined;

function setNativeValue(
  element: HTMLInputElement | HTMLSelectElement,
  value: string,
): void {
  const prototype =
    element instanceof dom.window.HTMLSelectElement
      ? dom.window.HTMLSelectElement.prototype
      : dom.window.HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(
    element,
    value,
  );
  element.dispatchEvent(
    new Event(element instanceof dom.window.HTMLSelectElement ? "change" : "input", {
      bubbles: true,
    }),
  );
}

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  container?.remove();
  root = undefined;
  container = undefined;
});

function Harness({
  taskType = "llm-instruction",
  includeSourceAttribution = false,
}: {
  taskType?: DatasetPreparationTaskType;
  includeSourceAttribution?: boolean;
}) {
  const [shape, setShape] = useState<DatasetPreparationVisualOutputShape>(() =>
    createDefaultDatasetPreparationVisualOutputShape(taskType),
  );
  return (
    <DatasetPreparationOutputShapeEditor
      idPrefix="test-output-shape"
      onChange={setShape}
      outputFormat="parquet"
      shape={shape}
      taskType={taskType}
      includeSourceAttribution={includeSourceAttribution}
    />
  );
}

async function renderEditor(
  props: Parameters<typeof Harness>[0] = {},
): Promise<HTMLDivElement> {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root?.render(<Harness {...props} />));
  return container;
}

describe("DatasetPreparationOutputShapeEditor", () => {
  it("uses labeled native controls and protects fields assigned to training purposes", async () => {
    const view = await renderEditor();

    expect(view.textContent).toContain("You do not need to write JSON");
    expect(view.textContent).toContain("Instruction");
    expect(view.textContent).toContain("Supporting input");
    expect(view.textContent).toContain("Answer");
    expect(
      view.querySelectorAll('input[aria-label$="field name"]').length,
    ).toBe(3);
    expect(
      view.querySelectorAll('select[aria-label$="value type"]').length,
    ).toBe(3);
    expect(
      view.querySelector<HTMLButtonElement>(
        'button[aria-label="Remove instruction"]',
      )?.disabled,
    ).toBe(true);
    expect(view.querySelector("[draggable=true]")).toBe(null);
  });

  it("renames, adds, nests, previews, and resets fields without raw schema editing", async () => {
    const view = await renderEditor();
    const instructionName = view.querySelector<HTMLInputElement>(
      'input[aria-label="instruction field name"]',
    )!;
    await act(async () => {
      setNativeValue(instructionName, "request_text");
    });
    expect(view.textContent).toContain("request_text");

    const addField = Array.from(view.querySelectorAll("button")).find(
      (button) => button.textContent === "Add field",
    )!;
    await act(async () => addField.click());
    const typeControls = view.querySelectorAll<HTMLSelectElement>(
      'select[aria-label$="value type"]',
    );
    expect(typeControls.length).toBe(4);

    const customType = typeControls[3]!;
    await act(async () => {
      setNativeValue(customType, "group");
    });
    expect(view.textContent).toContain("Add field inside");
    expect(
      view.querySelectorAll('input[aria-label$="field name"]').length,
    ).toBe(5);

    const preview = view.querySelector<HTMLPreElement>(
      'pre[aria-label="Generated JSON schema preview"]',
    )!;
    expect(preview.textContent).toContain("request_text");

    const reset = Array.from(view.querySelectorAll("button")).find(
      (button) => button.textContent === "Reset fields",
    )!;
    await act(async () => reset.click());
    expect(
      view.querySelector<HTMLInputElement>(
        'input[aria-label="instruction field name"]',
      )?.value,
    ).toBe("instruction");
  });

  it("shows the task-specific default schema for every example-creation prompt", async () => {
    for (const taskType of DATASET_PREPARATION_TEXT_GENERATION_TASK_TYPES) {
      if (root) await act(async () => root?.unmount());
      container?.remove();
      root = undefined;
      container = undefined;
      const view = await renderEditor({ taskType });
      const preview = view.querySelector<HTMLPreElement>(
        'pre[aria-label="Generated JSON schema preview"]',
      );
      expect(preview?.textContent).toContain(`"const": "${taskType}"`);
      expect(view.textContent).toContain("Model JSON schema preview");
    }
  });

  it("shows locked attribution fields when source attribution is selected", async () => {
    const view = await renderEditor({ includeSourceAttribution: true });
    expect(view.textContent).toContain("Source attribution added automatically");
    expect(view.textContent).toContain(
      "These trusted fields are added by the system",
    );
    const preview = view.querySelector<HTMLPreElement>(
      'pre[aria-label="Source attribution JSON schema preview"]',
    );
    expect(preview?.textContent).toContain("sourceArtifactId");
    expect(preview?.textContent).toContain("sourceAuthor");
  });
});
