import { expect, type Page } from "@playwright/test";
import { collectNative400Frame, rawNativeFrame } from "./technical-accessibility";

export async function observeNativeFormControls(page: Page) {
  const form = page.getByRole("region", { name: "Form Composer", exact: true });
  const item = form.getByRole("button", { name: "Request reason", exact: true });
  await expect(item).toBeEnabled();
  await item.focus();
  await expect(item).toBeFocused();
  await item.press("Enter");
  await expect(item).toHaveAttribute("aria-expanded", "true");
  const content = form.getByRole("region", { name: "Element appearance", exact: true });
  await expect(content.getByRole("textbox", { name: "Field label", exact: true })).toHaveValue("Request reason");
  const sidebar = form.getByRole("complementary", { name: "Properties", exact: true });
  await expect(sidebar.getByRole("checkbox", { name: "Required answer" })).toBeChecked();
  const frame = await collectNative400Frame(page);
  expect(frame.status).toBe("passed");
  const preview = form.getByRole("button", { name: "Preview form", exact: true });
  await preview.focus();
  await preview.press("Enter");
  const dialog = page.getByRole("dialog", { name: /^Preview:/ });
  const finish = dialog.getByRole("button", { name: "Finish preview", exact: true });
  await expect(finish).toBeEnabled();
  await finish.press("Enter");
  const label = dialog.getByRole("textbox", { name: /Request reason/ });
  await expect(label).toBeFocused();
  await expect(label).toHaveAttribute("aria-invalid", "true");
  await expect(dialog.getByRole("alert").first()).toBeVisible();
  const previewFrame = await collectNative400Frame(page);
  expect(previewFrame.status).toBe("passed");
  const dialogFit = await dialog.evaluate(element => {
    const box = element.getBoundingClientRect();
    return box.width > 0 && box.left >= -1 && box.right <= document.documentElement.clientWidth + 1 &&
      element.scrollWidth <= element.clientWidth + 1;
  });
  expect(dialogFit).toBe(true);
  await page.keyboard.press("Escape");
  await expect(preview).toBeFocused();
  return { editor: rawNativeFrame(frame), preview: rawNativeFrame(previewFrame), dialogFit };
}
