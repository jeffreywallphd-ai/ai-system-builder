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

const thinSharedImports = [
  "../../../../modules/ui/shared/styles/application.css",
  "../../../../modules/ui/shared/styles/forced-colors.css",
];

function readOnlyStyleImports(css: string): string[] {
  const separator = /(?:[ \t\r\n\f]|\/\*[\s\S]*?\*\/)+/y;
  const pattern = /@import(?:[ \t\r\n\f]|\/\*[\s\S]*?\*\/)+(["'])([^"'\\\r\n\f]+)\1(?:[ \t\r\n\f]|\/\*[\s\S]*?\*\/)*;/y;
  const imports: string[] = [];
  let offset = 0;
  while (offset < css.length) {
    separator.lastIndex = offset;
    if (separator.exec(css)) {
      offset = separator.lastIndex;
      continue;
    }
    pattern.lastIndex = offset;
    const match = pattern.exec(css);
    if (!match) {
      throw new Error("Expected a quoted stylesheet import");
    }
    imports.push(match[2]!);
    offset = pattern.lastIndex;
  }
  return imports;
}

function expectThinSharedImports(css: string): void {
  expect(readOnlyStyleImports(css)).toEqual(thinSharedImports);
}

function readShellCss(): string {
  return readFileSync(shellCssPath, "utf8").replace(/\r\n?/g, "\n");
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

  it("supports shared sidebar collapse without contextual page artwork", () => {
    const css = readShellCss();

    expect(css).toContain(".ui-shell--sidebar-collapsed .ui-shell__body");
    expect(css).toContain("var(--shell-sidebar-collapsed-width)");
    expect(css).toContain(".ui-shell__collapse-button");
    expect(css).not.toContain(".ui-shell__page-art");
    expect(css).not.toContain(".ui-shell__content--with-art");
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

  it("loads the shared visual foundation before the shared forced-colors override", () => {
    const desktopCss = readFileSync(desktopStylesheetPath, "utf8");
    const thinClientCss = readFileSync(thinClientStylesheetPath, "utf8");

    expect(desktopCss).toContain("modules/ui/shared/styles/application.css");
    expect(thinClientCss).toContain("modules/ui/shared/styles/application.css");
    expectThinSharedImports(thinClientCss);
    const desktopImports = readOnlyStyleImports(desktopCss);
    const desktopShared = [
      "../../../../../modules/ui/shared/styles/application.css",
      "../../../../../modules/ui/shared/styles/forced-colors.css",
    ];
    expect(desktopImports[0]).toBe(desktopShared[0]);
    expect(desktopImports.at(-1)).toBe(desktopShared[1]);
    for (const shared of desktopShared) {
      expect(desktopImports.filter((value) => value === shared).length).toBe(1);
    }
    expect(desktopCss).not.toContain("./tokens.css");
    expect(thinClientCss).not.toContain("./tokens.css");
  });

  it("ignores harmless line formatting and comments in the shared import contract", () => {
    expectThinSharedImports(thinSharedImports.map((value) => `@import '${value}';`).join(" \n\n/* shared layer */\n"));
    expectThinSharedImports(thinSharedImports.map((value) => `@import /* layer */ "${value}" /* end */;`).join("\n"));
  });

  it("rejects missing, duplicate, reordered, local and unknown style layers", () => {
    const css = (imports: string[]) => imports.map((value) => `@import "${value}";`).join("\n");
    for (const imports of [
      thinSharedImports.slice(0, 1),
      thinSharedImports.slice(1),
      [...thinSharedImports, thinSharedImports[1]!],
      [...thinSharedImports].reverse(),
      [...thinSharedImports, "./tokens.css"],
      [...thinSharedImports, "../../../../modules/ui/shared/styles/unknown.css"],
      [...thinSharedImports, "https://example.invalid/style.css"],
      [thinSharedImports[0]!.replace("application.css", "applica/*x*/tion.css"), thinSharedImports[1]!],
    ]) {
      expect(() => expectThinSharedImports(css(imports))).toThrow();
    }
    expect(() => expectThinSharedImports(`${css(thinSharedImports)}\nbody { color: red; }`)).toThrow();
    expect(() => expectThinSharedImports(`${css(thinSharedImports)}\n@import url('./tokens.css');`)).toThrow();
    expect(() => expectThinSharedImports(`${css(thinSharedImports)}\n/* unclosed`)).toThrow();
    expect(() => expectThinSharedImports(css(thinSharedImports).replace(";", "/* unclosed;"))).toThrow();
    for (const invalidWhitespace of ["\u00a0", "\u000b"]) {
      expect(() => expectThinSharedImports(css(thinSharedImports).replace("@import ", `@import${invalidWhitespace}`))).toThrow();
      expect(() => expectThinSharedImports(css(thinSharedImports).replace(";", `${invalidWhitespace};`))).toThrow();
      expect(() => expectThinSharedImports(`${invalidWhitespace}${css(thinSharedImports)}`)).toThrow();
    }
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
