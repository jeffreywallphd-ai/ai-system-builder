import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "../../../../testing/node-test";

describe("shared form control styles", () => {
  it("replaces native fieldset, radio, checkbox, and file-button chrome with primary design tokens", () => {
    const styles = readFileSync(
      resolve(
        process.cwd(),
        "modules/ui/shared/styles/components/controls.css",
      ),
      "utf8",
    );

    expect(styles).toMatch(
      /:where\(fieldset\)\s*\{[^}]*border: 1px solid var\(--color-border\)/s,
    );
    expect(styles).toMatch(
      /:where\(input\[type="checkbox"\], input\[type="radio"\]\)\s*\{[^}]*appearance: none;/s,
    );
    expect(styles).toMatch(
      /:where\(input\[type="checkbox"\], input\[type="radio"\]\):checked\s*\{[^}]*background: var\(--color-accent-strong\)/s,
    );
    expect(styles).toContain(".ui-choice:has(input:checked)");
    expect(styles).toContain(
      ".ui-file-input::file-selector-button {\n  appearance: none;",
    );
    expect(styles).not.toContain("accent-color:");
  });
});
