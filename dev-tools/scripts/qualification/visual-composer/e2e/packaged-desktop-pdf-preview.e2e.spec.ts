import { expect, test } from "@playwright/test";
import { _electron as electron } from "playwright";
import { prepareIsolatedDesktopCase } from "./isolated-desktop-case";

function syntheticPdf() {
  const content = "BT /F1 12 Tf 10 50 Td (Desktop worker qualification) Tj ET";
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 240 100] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let result = "%PDF-1.4\n";
  const offsets = [0];
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(result));
    result += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xref = Buffer.byteLength(result);
  result += `xref\n0 ${offsets.length}\n0000000000 65535 f \n`;
  result += offsets.slice(1).map(offset => `${String(offset).padStart(10, "0")} 00000 n \n`).join("");
  result += `trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(result);
}

test("packaged desktop uploads a PDF and renders its first page through the packaged worker", async () => {
  test.setTimeout(150_000);
  const isolated = prepareIsolatedDesktopCase("pdf");
  const app = await electron.launch({ executablePath: process.env.VISUAL_COMPOSER_DESKTOP_EXECUTABLE!, args: [`--user-data-dir=${isolated.dataRoot}`, "--disable-gpu"], env: isolated.env, timeout: 60_000 });
  try {
    const page = await app.firstWindow({ timeout: 60_000 });
    await expect(page.getByRole("heading", { name: "Create a Workspace", exact: true })).toBeVisible({ timeout: 60_000 });
    await page.getByRole("button", { name: "Create new workspace" }).click();
    await page.locator('input[name="workspaceName"]').fill("Packaged PDF fixture");
    await page.getByRole("button", { name: "Create workspace", exact: true }).click();
    await expect(page.getByLabel("Select current workspace")).toHaveValue(/^workspace\./);
    await page.getByRole("button", { name: "Data", exact: true }).click();
    await page.locator('input[type="file"]').setInputFiles({ name: "packaged-worker-fixture.pdf", mimeType: "application/pdf", buffer: syntheticPdf() });
    await page.getByRole("button", { name: "Add data", exact: true }).click();
    const notifications = page.getByRole("dialog", { name: "Notifications", exact: true });
    await expect(notifications.getByText("All files are ready.", { exact: true })).toBeVisible({ timeout: 30_000 });
    await notifications.getByRole("button", { name: "Close notifications", exact: true }).click();
    await page.getByRole("tab", { name: "Artifact Browser", exact: true }).click();
    const card = page.getByRole("article").filter({ has: page.getByRole("heading", { name: "packaged-worker-fixture.pdf", exact: true }) });
    await card.getByRole("button", { name: "View Details", exact: true }).click();
    const preview = page.getByRole("img", { name: "First page of packaged-worker-fixture.pdf", exact: true });
    await expect(preview).toBeVisible({ timeout: 30_000 });
    await expect.poll(() => preview.evaluate(image => ({ complete: (image as HTMLImageElement).complete, width: (image as HTMLImageElement).naturalWidth }))).toEqual({ complete: true, width: 360 });
    const darkPixels = await preview.evaluate(image => {
      const canvas = document.createElement("canvas");
      canvas.width = 360; canvas.height = 150;
      const context = canvas.getContext("2d")!;
      context.drawImage(image as HTMLImageElement, 0, 0);
      const pixels = context.getImageData(0, 0, 360, 150).data;
      let count = 0;
      for (let offset = 0; offset < pixels.length; offset += 4) {
        if (pixels[offset + 3] > 0 && pixels[offset] < 80 && pixels[offset + 1] < 80 && pixels[offset + 2] < 80) count += 1;
      }
      return count;
    });
    expect(darkPixels).toBeGreaterThan(50);
    await test.info().attach("packaged-pdf-preview", { body: JSON.stringify({ status: "passed", firstPageRasterized: true, fixture: "synthetic-one-page-pdf", sourceRevision: process.env.VISUAL_COMPOSER_QUALIFICATION_SOURCE_REVISION }), contentType: "application/json" });
  } finally { await app.close(); }
});
