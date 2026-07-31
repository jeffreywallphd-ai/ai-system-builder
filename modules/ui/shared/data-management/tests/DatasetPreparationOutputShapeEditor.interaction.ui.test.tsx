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
  element: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement,
  value: string,
): void {
  const prototype =
    element instanceof dom.window.HTMLSelectElement
      ? dom.window.HTMLSelectElement.prototype
      : element instanceof dom.window.HTMLTextAreaElement
        ? dom.window.HTMLTextAreaElement.prototype
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

    expect(view.textContent).toContain(
      "Define one sample JSON result",
    );
    expect(view.textContent).toContain("Instruction");
    expect(view.textContent).toContain("Input");
    expect(view.textContent).toContain("Context");
    expect(view.textContent).toContain("Output");
    expect(
      view.querySelector(".dataset-output-shape-editor__purposes")?.textContent,
    ).toContain("Context");
    expect(view.textContent).not.toContain("Allowed choices");
    expect(view.textContent).toContain(
      "Instruction — describe how the model should behave",
    );
    expect(
      view.querySelector<HTMLTextAreaElement>(
        'textarea[aria-label="instruction example value"]',
      )?.value,
    ).toContain("using only the provided context");
    expect(
      view.querySelector<HTMLTextAreaElement>(
        'textarea[aria-label="input example value"]',
      )?.value,
    ).toBe("When does the city library close on weekdays?");
    expect(
      view.querySelector<HTMLTextAreaElement>(
        'textarea[aria-label="context example value"]',
      )?.value,
    ).toBe("The city library closes at 6:00 PM on weekdays.");
    expect(
      view.querySelector<HTMLTextAreaElement>(
        'textarea[aria-label="output example value"]',
      )?.value,
    ).toContain("closes at 6:00 PM");
    expect(
      view.querySelectorAll('input[aria-label$="field name"]').length,
    ).toBe(4);
    expect(
      view.querySelectorAll('select[aria-label$="value type"]').length,
    ).toBe(4);
    expect(
      view.querySelector<HTMLSelectElement>(
        'select[aria-label="instruction value type"]',
      )?.options.length,
    ).toBe(1);
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
    expect(typeControls.length).toBe(5);

    const customType = typeControls[4]!;
    await act(async () => {
      setNativeValue(customType, "group");
    });
    expect(view.textContent).toContain("Add field inside");
    expect(
      view.querySelectorAll('input[aria-label$="field name"]').length,
    ).toBe(6);

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

  it("offers optional Thought as text and shows it in the sample JSON", async () => {
    const view = await renderEditor();
    const addField = Array.from(view.querySelectorAll("button")).find(
      (button) => button.textContent === "Add field",
    )!;
    await act(async () => addField.click());
    const purpose = view.querySelectorAll<HTMLSelectElement>(
      'select[aria-label$="training purpose"]',
    )[4]!;
    expect(Array.from(purpose.options).map((option) => option.text)).toContain(
      "Thought",
    );

    const typeBeforePurpose = view.querySelectorAll<HTMLSelectElement>(
      'select[aria-label$="value type"]',
    )[4]!;
    await act(async () => setNativeValue(typeBeforePurpose, "number"));
    await act(async () => setNativeValue(purpose, "thought"));
    const type = view.querySelectorAll<HTMLSelectElement>(
      'select[aria-label$="value type"]',
    )[4]!;
    expect(type.value).toBe("text");
    expect(type.options.length).toBe(1);
    expect(
      view.querySelector<HTMLTextAreaElement>(
        'textarea[aria-label="new_field_1 example value"]',
      )?.value,
    ).toContain("weekday closing time");
    expect(
      view.querySelector<HTMLPreElement>(
        'pre[aria-label="JSON output preview"]',
      )?.textContent,
    ).toContain('"new_field_1"');
  });

  it("keeps configured labels in Step 1 instead of duplicating them", async () => {
    const view = await renderEditor({ taskType: "llm-classification" });
    expect(view.textContent).toContain(
      "Labels are selected in the training goal settings in Step 1",
    );
    expect(
      view.querySelector('textarea[aria-label="label example value"]'),
    ).toBe(null);
  });

  it("shows the task-specific default schema for every generation prompt", async () => {
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
      expect(view.textContent).toContain("JSON output preview");
      expect(view.textContent).toContain("Advanced structure preview");
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
