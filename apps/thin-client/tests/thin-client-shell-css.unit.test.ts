import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "../../../modules/testing/node-test";

const shellCssPath = resolve("modules/ui/shared/styles/components/shell.css");
const tabsCssPath = resolve("modules/ui/shared/styles/components/tabs.css");
const badgesCssPath = resolve("modules/ui/shared/styles/components/badges.css");
const workflowCssPath = resolve(
  "modules/ui/shared/styles/components/workflow.css",
);
const desktopStylesheetPath = resolve(
  "apps/desktop/src/renderer/styles/app.css",
);
const thinClientStylesheetPath = resolve("apps/thin-client/src/styles/app.css");

function readShellCss(): string {
  return readFileSync(shellCssPath, "utf8");
}

function getRule(css: string, selector: string): string {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = css.match(new RegExp(`${escapedSelector}\\s*\\{([^}]*)\\}`));
  return match?.[1] ?? "";
}

describe("shared application shell styling", () => {
  it("keeps the brand logo beside the product title", () => {
    const css = readShellCss();
    const brandRule = getRule(css, ".ui-shell__brand");

    expect(css).toContain(".ui-shell__header-left,\n.ui-shell__brand,");
    expect(css).toContain("display: flex");
    expect(css).toContain("align-items: center");
    expect(brandRule).toContain("gap: var(--space-sm)");
    expect(css).toContain(".ui-shell__logo-frame");
    expect(css).toContain(".ui-shell__title");
  });

  it("provides the persistent corporate sidebar with a compact navigation fallback", () => {
    const css = readShellCss();
    const bodyRule = getRule(css, ".ui-shell__body");
    const sidebarRule = getRule(css, ".ui-shell__sidebar");

    expect(bodyRule).toContain(
      "grid-template-columns: var(--shell-sidebar-width) minmax(0, 1fr)",
    );
    expect(sidebarRule).toContain("position: sticky");
    expect(css).toContain('.ui-shell__sidebar-item[aria-current="page"]');
    expect(css).toContain("@media (max-width: 64rem)");
    expect(css).toContain(".ui-shell__menu");
  });

  it("supports shared sidebar collapse and contextual page artwork", () => {
    const css = readShellCss();

    expect(css).toContain(".ui-shell--sidebar-collapsed .ui-shell__body");
    expect(css).toContain("var(--shell-sidebar-collapsed-width)");
    expect(css).toContain(".ui-shell__collapse-button");
    expect(css).toContain(".ui-shell__page-art");
    expect(css).toContain(
      ".ui-shell__main:has(.ui-page-loading-surface) .ui-shell__page-art",
    );
    expect(
      getRule(
        css,
        ".ui-shell__main:has(.ui-page-loading-surface) .ui-shell__page-art",
      ),
    ).toContain("visibility: hidden");
    expect(css).toContain(".ui-shell__content--with-art");
    expect(css).toContain(".ui-shell--sidebar-collapsed .ui-shell__content");
    expect(
      getRule(css, ".ui-shell--sidebar-collapsed .ui-shell__content"),
    ).toContain("inline-size: 100%");
  });

  it("separates header regions and styles navigation group disclosures", () => {
    const css = readShellCss();
    const workspaceLabelRule = getRule(css, ".workspace-switcher__label");
    const workspaceSelectRule = getRule(css, ".workspace-switcher__select");
    const workspaceChangeRule = getRule(css, ".workspace-switcher__change");

    expect(css).toContain(
      "border-inline-end: 1px solid rgb(104 145 184 / 12%)",
    );
    expect(css).toContain(
      "border-inline-start: 1px solid rgb(104 145 184 / 12%)",
    );
    expect(css).toContain('.ui-shell__sidebar-label[aria-expanded="false"]');
    expect(css).toContain(".ui-shell__sidebar-items[hidden]");
    expect(workspaceLabelRule).toContain("font-size: 0.6rem");
    expect(workspaceSelectRule).toContain("min-block-size: 2.125rem");
    expect(workspaceSelectRule).toContain("font-size: var(--font-size-sm)");
    expect(workspaceChangeRule).toContain("block-size: 2.125rem");
  });

  it("is the only shared visual foundation imported by both application entrypoints", () => {
    const desktopCss = readFileSync(desktopStylesheetPath, "utf8");
    const thinClientCss = readFileSync(thinClientStylesheetPath, "utf8");

    expect(desktopCss).toContain("modules/ui/shared/styles/application.css");
    expect(thinClientCss).toContain("modules/ui/shared/styles/application.css");
    expect(thinClientCss.trim().split(/\r?\n/).length).toBe(1);
    expect(desktopCss).not.toContain("./tokens.css");
    expect(thinClientCss).not.toContain("./tokens.css");
  });

  it("does not retain app-local copies of the shared token or shell layers", () => {
    const supersededStylePaths = [
      "apps/desktop/src/renderer/styles/tokens.css",
      "apps/desktop/src/renderer/styles/components/shell.css",
      "apps/thin-client/src/styles/tokens.css",
      "apps/thin-client/src/styles/components/shell.css",
    ];

    for (const stylePath of supersededStylePaths) {
      expect(existsSync(resolve(stylePath))).toBe(false);
    }
  });

  it("keeps inactive tabs outlined and type designators in the shared visual layer", () => {
    const tabsCss = readFileSync(tabsCssPath, "utf8");
    const badgesCss = readFileSync(badgesCssPath, "utf8");

    expect(tabsCss).toContain("border: 1px solid var(--color-border-soft)");
    expect(tabsCss).toContain(".ui-tabbed-panel__tab--active");
    expect(badgesCss).toContain(".ui-type-badge--red");
    expect(badgesCss).toContain(".ui-type-badge--green");
    expect(badgesCss).toContain(".ui-type-badge--violet");
  });

  it("provides one reusable ordered workflow visual layer", () => {
    const workflowCss = readFileSync(workflowCssPath, "utf8");

    expect(workflowCss).toContain("counter-reset: workflow-step");
    expect(workflowCss).toContain(".ui-workflow::before");
    expect(workflowCss).toContain(".ui-workflow__step::before");
    expect(workflowCss).toContain('.ui-workflow__step[data-active="true"]');
    expect(workflowCss).toContain(".ui-workflow__field-grid");
  });
});
