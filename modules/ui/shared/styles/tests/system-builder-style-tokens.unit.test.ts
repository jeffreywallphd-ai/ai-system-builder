import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "../../../../testing/node-test";

const readStyle = (relativePath: string): string =>
  readFileSync(resolve(process.cwd(), relativePath), "utf8");

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

    expect(composerStyles).toContain(".system-composer__flat-control");
    expect(composerStyles).toContain("background: transparent");
    expect(composerStyles).toContain('data-layout-container="true"');
    expect(composerStyles).toContain('data-drag-over="true"');
    expect(composerStyles).toContain(".system-composer__unassigned");
    expect(composerStyles).toContain(".system-composer__resources");
    expect(composerStyles).toContain(".system-composer__sidebar-tabs");
    expect(composerStyles).toContain(
      '.system-composer__workspace[data-library-collapsed="true"]',
    );
    expect(composerStyles).toContain(
      '.system-composer__workspace[data-library-size="maximized"]',
    );
    expect(composerStyles).toContain(".system-composer__palette-size-controls");
    expect(composerStyles).toContain(
      ".system-composer__palette-section-toggle",
    );
    expect(composerStyles).toContain(".system-composer__region-collapse");
    expect(composerStyles).toContain(".system-composer__slot-content[hidden]");
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
