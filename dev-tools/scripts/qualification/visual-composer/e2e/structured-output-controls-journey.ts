import { expect, type Page, type TestInfo } from "@playwright/test";
import { mkdir, realpath, writeFile } from "node:fs/promises";
import path from "node:path";

type Host = "desktop" | "thin";
const checkedLabel = "Keep generated JSON well structured";

export async function openStructuredOutputControls(page: Page, host: Host) {
  await page.getByRole("tab", { name: "Dataset Preparation", exact: true }).click();
  await page.getByLabel("low-memory-source.txt", { exact: false }).check();
  if (host === "desktop") {
    const generation = page.getByRole("button", { name: /Generation prompt/ });
    if (!await generation.isVisible()) await page.getByRole("button", { name: "Advanced settings", exact: true }).click();
    const model = page.getByRole("textbox", { name: /^Model ID/ });
    if (!await model.isVisible()) await generation.click();
  }
  await expect(page.getByRole("heading", { name: "Desired output format", exact: true })).toBeVisible();
}

export async function qualifyStructuredOutputControls(
  page: Page, info: TestInfo, host: Host, reopen: () => Promise<Page>,
) {
  let stage = "open-controls";
  const completed: string[] = [];
  let current = page;
  const editor = () => current.locator("section.dataset-output-shape-editor");
  const checked = () => current.getByRole("checkbox", { name: checkedLabel, exact: true });
  const model = () => current.getByRole("textbox", { name: host === "desktop" ? /^Model ID/ : /^Local generation model/ });
  const assertSchema = async () => {
    const preview = editor().getByLabel("Generated JSON schema preview", { exact: true });
    await expect.poll(() => preview.evaluate(element => {
      try {
        const envelope = JSON.parse(element.textContent ?? "");
        const schema = envelope.properties?.example?.anyOf?.[0];
        return envelope.type === "object" && envelope.required?.includes("example") === true &&
          schema?.type === "object" && schema.properties.request_text?.type === "string" &&
          schema.properties.metadata?.type === "object" &&
          schema.properties.metadata.properties?.score?.type === "number" &&
          !Object.hasOwn(schema.properties, "score") &&
          schema.required?.includes("request_text") === true &&
          schema.required?.includes("metadata") === true;
      } catch { return false; }
    })).toBe(true);
  };
  const assertShape = async () => {
    await expect(editor().getByRole("textbox", { name: "request_text field name", exact: true })).toHaveValue("request_text");
    await expect(editor().getByRole("textbox", { name: "metadata field name", exact: true })).toHaveValue("metadata");
    await expect(editor().getByRole("textbox", { name: "score field name", exact: true })).toHaveValue("score");
    await expect(editor().getByRole("combobox", { name: "score value type", exact: true })).toHaveValue("number");
    const metadata = editor().getByRole("group", { name: "metadata", exact: true });
    await expect(metadata.getByRole("group", { name: "score", exact: true })).toHaveCount(1);
    await expect(metadata.getByRole("checkbox", { name: "Always include this field", exact: true }).first()).toBeChecked();
    await expect(editor().getByRole("group", { name: "request_text", exact: true })
      .getByRole("checkbox", { name: "Always include this field", exact: true })).toBeChecked();
    const preview = editor().getByText("Advanced structure preview", { exact: true });
    if (!await editor().getByLabel("Generated JSON schema preview", { exact: true }).isVisible()) await preview.click();
    await assertSchema();
    await expect(checked()).toBeChecked();
    await expect(model()).toHaveValue("qualification/unknown-model");
  };
  try {
    await openStructuredOutputControls(current, host);
    stage = "declared-sufficient-accelerator-default";
    await model().fill("Qwen/Qwen2.5-1.5B-Instruct");
    if (host === "desktop") await current.getByRole("combobox", { name: /^Inference mode/ }).selectOption("chat");
    await current.getByRole("combobox", { name: /^Model device/ }).selectOption("cuda");
    await expect(checked()).toBeEnabled({ timeout: 30000 });
    await expect(checked()).toBeChecked();
    completed.push("declared-sufficient-accelerator-adaptive-on");
    stage = "unknown-capacity-and-override";
    await model().fill("qualification/unknown-model");
    if (host === "desktop") await current.getByRole("combobox", { name: /^Inference mode/ }).selectOption("chat");
    await current.getByRole("combobox", { name: /^Model device/ }).selectOption("cpu");
    await expect(checked()).toBeEnabled({ timeout: 30000 });
    await expect(checked()).not.toBeChecked();
    await checked().check();
    await expect(checked()).toBeChecked();
    completed.push("unknown-default-off-explicit-on");

    stage = "rename-and-protect-purpose";
    await editor().getByRole("textbox", { name: "instruction field name", exact: true }).fill("request_text");
    await expect(editor().getByRole("button", { name: "Remove request_text", exact: true })).toBeDisabled();
    const requestField = editor().getByRole("group", { name: "request_text", exact: true });
    await expect(requestField.getByRole("checkbox", { name: "Always include this field", exact: true })).toBeDisabled();
    await expect(requestField.getByRole("checkbox", { name: "Always include this field", exact: true })).toBeChecked();
    await requestField.getByRole("textbox", { name: "request_text field name", exact: true }).focus();
    await current.keyboard.press("Tab");
    await expect(requestField.getByRole("combobox", { name: "request_text value type", exact: true })).toBeFocused();
    completed.push("renamed-protected-purpose-keyboard");

    stage = "add-nested-number";
    await editor().getByRole("button", { name: "Add field", exact: true }).click();
    await editor().getByRole("textbox", { name: "new_field_1 field name", exact: true }).fill("metadata");
    await editor().getByRole("combobox", { name: "metadata value type", exact: true }).selectOption("group");
    await editor().getByRole("textbox", { name: "new_field_1 field name", exact: true }).fill("score");
    await editor().getByRole("combobox", { name: "score value type", exact: true }).selectOption("number");
    const metadata = editor().locator(":scope > .dataset-output-shape-editor__tree > fieldset").last();
    await metadata.getByRole("checkbox", { name: "Always include this field", exact: true }).first().check();
    await editor().getByText("Advanced structure preview", { exact: true }).click();
    await assertSchema();
    completed.push("nested-number-and-schema-preview");

    stage = "invalid-duplicate-denial";
    await metadata.getByRole("textbox", { name: "metadata field name", exact: true }).fill("input");
    await expect(checked()).toBeDisabled();
    await expect(editor().getByText("Desired output format is ready.", { exact: true })).toHaveCount(0);
    await metadata.getByRole("textbox", { name: "input field name", exact: true }).fill("metadata");
    await expect(editor().getByText("Desired output format is ready.", { exact: true })).toBeVisible();
    await expect(checked()).toBeChecked();
    completed.push("invalid-shape-refused-and-repaired");

    if (host === "desktop") {
      stage = "save-reset-load";
      await current.getByRole("button", { name: "Save training settings", exact: true }).click();
      const saved = current.getByRole("combobox", { name: /^Saved training settings/ });
      await expect(saved).not.toHaveValue("");
      await editor().getByRole("button", { name: "Reset fields", exact: true }).click();
      await expect(editor().getByRole("textbox", { name: "instruction field name", exact: true })).toBeVisible();
      await checked().uncheck();
      await current.getByRole("button", { name: "Load settings", exact: true }).click();
      await assertShape();
      completed.push("named-settings-reset-and-load");
    }
    stage = "reopen-and-restore";
    current = await reopen();
    if (host === "desktop") await current.getByRole("button", { name: "Data", exact: true }).click();
    await openStructuredOutputControls(current, host);
    if (host === "desktop") {
      const saved = current.getByRole("combobox", { name: /^Saved training settings/ });
      await saved.selectOption({ index: 1 });
      await current.getByRole("button", { name: "Load settings", exact: true }).click();
    }
    await assertShape();
    completed.push(host === "desktop" ? "renderer-reload-explicit-settings-load" : "renderer-reload-restored");
    stage = "reset-fields-preserves-explicit-choice";
    await editor().getByRole("button", { name: "Reset fields", exact: true }).click();
    await expect(editor().getByRole("textbox", { name: "instruction field name", exact: true })).toBeVisible();
    await expect(editor().getByRole("textbox", { name: "metadata field name", exact: true })).toHaveCount(0);
    await expect(checked()).toBeChecked();
    completed.push("field-reset-preserves-user-choice");
    stage = "passed";
  } finally {
    const report = { schemaVersion: "structured-output-host-controls-v1", host, stage, completed,
      sourceRevision: process.env.VISUAL_COMPOSER_QUALIFICATION_SOURCE_REVISION,
      evidence: "Actual isolated host UI with synthetic decoder capability and declared 8 GiB accelerator total; no generation, model quality, physical resource or parent qualification." };
    const run = process.env.VISUAL_COMPOSER_QUALIFICATION_RUN_ID!;
    expect(run).toMatch(/^[a-z0-9-]{20,80}$/);
    expect(report.sourceRevision).toMatch(/^source\.[a-f0-9]{64}$/);
    const folder = path.resolve("artifacts/qualification/visual-composer/runs", run, "structured-output-controls");
    await mkdir(folder, { recursive: true }); expect(await realpath(folder)).toBe(folder);
    const body = JSON.stringify(report, null, 2) + "\n";
    expect(Buffer.byteLength(body)).toBeLessThanOrEqual(4096);
    await writeFile(path.join(folder, `${host}.json`), body, { flag: "wx" });
    await info.attach("structured-output-controls", { body, contentType: "application/json" });
  }
}
