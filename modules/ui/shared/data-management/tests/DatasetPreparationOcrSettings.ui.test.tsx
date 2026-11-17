import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { DatasetPreparationOcrSettings, DatasetPreparationTextReadingChecks } from "../DatasetPreparationOcrSettings";

(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;

describe("scanned-PDF controls and completed reading facts", () => {
  let root: Root | undefined;
  let container: HTMLDivElement;
  afterEach(async () => { await act(async () => root?.unmount()); container?.remove(); });
  async function render(node: React.ReactNode) {
    container = document.createElement("div"); document.body.appendChild(container);
    root = createRoot(container); await act(async () => root!.render(node));
  }
  it("names its controls, starts without a language, and permits turning off an incompatible choice", async () => {
    let chooseEligibility!: (value: boolean) => void;
    function Form() {
      const [enabled, setEnabled] = useState(false);
      const [language, setLanguage] = useState("");
      const [eligible, setEligible] = useState(true); chooseEligibility = setEligible;
      return <DatasetPreparationOcrSettings enabled={enabled} language={language} eligible={eligible} busy={false} onEnabledChange={setEnabled} onLanguageChange={setLanguage} />;
    }
    await render(<Form />);
    const checkbox = container.querySelector('input[type="checkbox"]') as HTMLInputElement;
    expect(checkbox.labels?.[0]?.textContent).toContain("Read text from scanned PDF pages");
    expect(checkbox.checked).toBe(false);
    expect(container.querySelector('input:not([type="checkbox"])')).toBeNull();
    await act(async () => checkbox.click());
    const language = container.querySelector('input:not([type="checkbox"])') as HTMLInputElement;
    expect(language.labels?.[0]?.textContent).toContain("Text recognition language");
    expect(language.value).toBe("");
    expect(language.maxLength).toBe(35);
    expect(container.querySelector(`[id="${checkbox.getAttribute("aria-describedby")}"]`)?.textContent).toContain("task checks");
    await act(async () => chooseEligibility(false));
    expect(checkbox.checked).toBe(true);
    expect(checkbox.disabled).toBe(false);
    await act(async () => checkbox.click());
    expect(checkbox.checked).toBe(false);
    expect(checkbox.disabled).toBe(true);
  });
  it("locks all input while a task owns the selected settings", async () => {
    await render(<DatasetPreparationOcrSettings enabled language="en-US" eligible busy onEnabledChange={() => { throw new Error("locked"); }} onLanguageChange={() => { throw new Error("locked"); }} />);
    expect(container.querySelector("fieldset")?.disabled).toBe(true);
    for (const input of container.querySelectorAll("input")) expect(input.matches(":disabled")).toBe(true);
  });
  it("keeps the language name separate from its limits and language guidance", async () => {
    await render(<DatasetPreparationOcrSettings enabled language="en-US" eligible busy={false} onEnabledChange={() => {}} onLanguageChange={() => {}} />);
    const language = container.querySelector('input:not([type="checkbox"])')!;
    expect(document.getElementById(language.getAttribute("aria-labelledby")!)?.textContent).toBe("Text recognition language");
    const descriptions = language.getAttribute("aria-describedby")!.split(/\s+/);
    expect(new Set(descriptions).size).toBe(2);
    const guidance = descriptions.map(id => document.getElementById(id)?.textContent).join(" ");
    expect(guidance).toContain("16 MiB and 16 pages");
    expect(guidance).toContain("exact Windows language tag");
  });
  it("shows completed counts and explains that character checks do not prove OCR accuracy", async () => {
    await render(<dl><DatasetPreparationTextReadingChecks content={{ strategy: "layout", algorithmVersion: "bounded-ocr-lines-v1", sourceSpanCount: 5, lowConfidenceSourceCount: 0, meanExtractionQuality: 1,
      ocr: { provider: "private-path-must-not-display", version: "private-version", language: "en-US", documentCount: 1, pageCount: 5, lineCount: 5 } }} /></dl>);
    expect(container.textContent).toContain("Text character check100%");
    expect(container.textContent).toContain("not an OCR accuracy score");
    expect(container.textContent).toContain("Pages read5");
    expect(container.textContent).toContain("Text lines read5");
    expect(container.textContent).not.toContain("private-");
    expect(container.textContent).not.toContain("Reading quality");
  });
});
