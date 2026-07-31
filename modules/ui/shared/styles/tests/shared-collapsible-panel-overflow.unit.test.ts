import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "../../../../testing/node-test";

describe("shared collapsible panel styles", () => {
  it("allow information hints to extend beyond expanded card boundaries", () => {
    const styles = readFileSync(
      resolve(
        process.cwd(),
        "modules/ui/shared/styles/components/surfaces.css",
      ),
      "utf8",
    );

    expect(styles).toMatch(
      /\.ui-panel--collapsible\s*\{\s*overflow: visible;\s*\}/,
    );
    expect(styles).toMatch(
      /\.ui-panel--sectioned\s*\{\s*overflow: hidden;\s*\}/,
    );
    expect(styles).not.toMatch(
      /\.ui-panel--sectioned,\s*\.ui-panel--collapsible\s*\{[^}]*overflow: hidden;/,
    );
  });
});
