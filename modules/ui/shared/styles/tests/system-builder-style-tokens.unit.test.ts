import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "../../../../testing/node-test";

const readStyle = (relativePath: string): string =>
  readFileSync(resolve(process.cwd(), relativePath), "utf8");

const repositoryUiSources = (relativeDirectory: string): readonly string[] => {
  const sources: string[] = [];
  const generatedDirectories = new Set([
    ".webpack",
    "build",
    "coverage",
    "dist",
    "node_modules",
  ]);
  const visit = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = resolve(directory, entry.name);
      if (entry.isDirectory() && !generatedDirectories.has(entry.name))
        visit(path);
      else if (entry.isFile() && /\.(?:css|ts|tsx)$/.test(entry.name))
        sources.push(readFileSync(path, "utf8"));
    }
  };
  visit(resolve(process.cwd(), relativeDirectory));
  return sources;
};

describe("system builder shared styles", () => {
  it("uses only declared shared design tokens", () => {
    const tokenSource = readStyle("modules/ui/shared/styles/tokens.css");
    const declaredTokens = new Set(
      [...tokenSource.matchAll(/(--[a-z0-9-]+)\s*:/gi)].map(
        (match) => match[1],
      ),
    );
    const styleSources = [
      "modules/ui/shared/styles/components/system-composer.css",
      "modules/ui/shared/styles/components/system-management.css",
    ].map(readStyle);
    const referencedTokens = styleSources.flatMap((source) =>
      [...source.matchAll(/var\((--[a-z0-9-]+)/gi)].map((match) => match[1]),
    );

    expect(
      [...new Set(referencedTokens)].filter(
        (token) => !declaredTokens.has(token),
      ),
    ).toEqual([]);
  });

  it("retains the compact management table-to-card layout", () => {
    const managementStyles = readStyle(
      "modules/ui/shared/styles/components/system-management.css",
    );

    expect(managementStyles).toContain("@media (max-width: 48rem)");
    expect(managementStyles).toContain("content: attr(data-label)");
  });

  it("keeps the visual composer flat, fixed-layout aware, and reduced-motion safe", () => {
    const composerStyles = readStyle(
      "modules/ui/shared/styles/components/system-composer.css",
    );
    const featureStyles = readStyle(
      "modules/ui/shared/styles/components/feature-surfaces.css",
    );

    expect(composerStyles).toContain(".system-composer__flat-control");
    expect(composerStyles).toContain("background: transparent");
    expect(composerStyles).toContain('data-layout-container="true"');
    expect(composerStyles).toContain('data-drag-over="true"');
    expect(composerStyles).toContain(".system-composer__unassigned");
    expect(composerStyles).toContain(".system-composer__resources");
    expect(composerStyles).toContain(".system-composer__sidebar-tabs");
    expect(composerStyles).toContain(
      "grid-template-columns: repeat(3, minmax(0, 1fr))",
    );
    expect(composerStyles).toContain(
      ".system-composer__sidebar-tabs .ui-tabbed-panel__tab",
    );
    expect(composerStyles).toContain(".system-composer__sidebar-heading");
    expect(composerStyles).toContain("overflow-wrap: anywhere");
    expect(composerStyles).toContain(
      '.system-composer__workspace[data-library-collapsed="true"]',
    );
    expect(composerStyles).toContain(
      '.system-composer__workspace[data-library-size="maximized"]',
    );
    expect(composerStyles).toContain(".system-composer__palette-size-controls");
    expect(composerStyles).toMatch(
      /\.system-composer__palette-size-controls\s*\{\s*display: grid;\s*grid-template-columns: minmax\(0, 1fr\)/,
    );
    expect(composerStyles).toContain(
      '.system-composer__panel--library[data-size="maximized"]',
    );
    expect(composerStyles).toContain(
      ".system-composer__palette-section-toggle",
    );
    expect(composerStyles).toContain(".system-composer__region-collapse");
    expect(composerStyles).toContain(".system-composer__slot-content[hidden]");
    const fixedLayoutRules = composerStyles.slice(
      composerStyles.indexOf(
        '.system-composer__canvas-node[data-layout-container="true"]',
      ),
      composerStyles.indexOf(".system-composer__drag-overlay"),
    );
    expect(fixedLayoutRules).toContain("overflow: visible");
    expect(fixedLayoutRules).not.toContain("overflow: auto");
    expect(composerStyles).toMatch(
      /\.system-composer__palette\s*\{\s*grid-template-columns: minmax\(0, 1fr\)/,
    );
    expect(composerStyles).toContain(
      '.system-composer__workspace[data-details-collapsed="true"]',
    );
    expect(composerStyles).toContain(
      'grid-template-areas: "library canvas details"',
    );
    expect(composerStyles).toContain("prefers-reduced-motion: reduce");
    expect(featureStyles).toContain(".system-builder__entry-options");
    expect(featureStyles).toContain(
      "grid-template-columns: repeat(3, minmax(0, 1fr))",
    );
    expect(featureStyles).toContain(".system-builder__entry-option legend");
  });

  it("keeps shared buttons flat and rounded without beveled gradients", () => {
    const obsoleteModifier = `ui-button--${"secondary"}`;
    const controlStyles = readStyle(
      "modules/ui/shared/styles/components/controls.css",
    );
    const primaryRules = controlStyles.slice(
      0,
      controlStyles.indexOf(
        ":where(.ui-button, button:not([class])) .ui-app-icon",
      ),
    );
    const secondaryRules = controlStyles.slice(
      controlStyles.indexOf(".ui-button--outline,"),
      controlStyles.indexOf(".ui-button--outline:hover:enabled"),
    );

    expect(primaryRules).toContain("appearance: none");
    expect(primaryRules).toContain("border-radius: var(--radius-sm)");
    expect(primaryRules).toContain("background: var(--color-bg-accent)");
    expect(primaryRules).toContain("box-shadow: none");
    expect(primaryRules).not.toContain("linear-gradient");
    expect(primaryRules).not.toContain("inset 0 1px");
    expect(secondaryRules).toContain("background: transparent");
    expect(secondaryRules).not.toContain("var(--color-bg-elevated)");
    expect(secondaryRules).toContain("box-shadow: none");
    expect(secondaryRules).not.toContain("inset 0 1px");
    expect(controlStyles).not.toContain(obsoleteModifier);
    expect(controlStyles).toContain(
      ".ui-file-input::file-selector-button {\n  appearance: none;",
    );

    const uiSources = [
      ...repositoryUiSources("apps"),
      ...repositoryUiSources("modules/ui"),
    ];
    expect(
      uiSources.filter((source) => source.includes(obsoleteModifier)),
    ).toEqual([]);
    for (const source of uiSources) {
      for (const match of source.matchAll(
        /className="([^"]*ui-button--outline[^"]*)"/g,
      )) {
        expect(match[1].split(/\s+/)).toContain("ui-button");
      }
    }
  });

  it("keeps preview styling semantic, bounded, and rooted in reusable theme variables", () => {
    const previewStyles = readStyle(
      "modules/ui/shared/styles/components/system-composition-preview.css",
    );

    for (const marker of [
      "--foundation-color-primary",
      'data-theme-button-treatment="outline"',
      'data-theme-form-treatment="filled"',
      'data-style-surface-role="tertiary"',
      'data-style-typography-role="heading"',
      'data-style-control-size="large"',
    ]) {
      expect(previewStyles).toContain(marker);
    }
    expect(previewStyles).not.toContain("style[data-user-css]");
  });
});
