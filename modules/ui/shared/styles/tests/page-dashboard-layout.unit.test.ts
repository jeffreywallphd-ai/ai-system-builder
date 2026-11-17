import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "../../../../testing/node-test";

describe("page dashboard layout", () => {
  it("keeps page summaries in the right header column", () => {
    const styles = readFileSync(
      resolve(
        process.cwd(),
        "modules/ui/shared/styles/components/page-dashboard.css",
      ),
      "utf8",
    );

    expect(styles).toMatch(
      /\.page-dashboard-header\s*\{[^}]*display: grid;[^}]*grid-template-columns: minmax\(0, 1fr\) minmax\(31rem, 44rem\);/s,
    );
    expect(styles).toMatch(
      /\.page-dashboard__grid\s*\{[^}]*grid-template-columns: repeat\([^;]*var\(--page-dashboard-card-inline-size\)[^;]*;[^}]*justify-content: end;/s,
    );
    expect(styles).toMatch(
      /\.page-dashboard__metric\s*\{[^}]*inline-size: var\(--page-dashboard-card-inline-size\);[^}]*block-size: 6rem;/s,
    );
    expect(styles).toMatch(
      /\.page-dashboard__metric dd\s*\{[^}]*font-size: 1\.6rem;/s,
    );
    expect(styles).toMatch(
      /\.page-dashboard-header__summary \.page-dashboard\s*\{[^}]*inline-size: 100%;[^}]*margin: 0;/s,
    );
    expect(styles).toMatch(
      /\.page-dashboard--large\s*\{[^}]*inline-size: 100%;/s,
    );
    expect(styles).toMatch(
      /\.page-dashboard--large \.page-dashboard__grid\s*\{[^}]*grid-template-columns: repeat\([^;]*2,[^;]*var\(--page-dashboard-card-inline-size\)[^;]*;/s,
    );
    expect(styles).toMatch(
      /@media \(max-width: 56rem\)[\s\S]*\.page-dashboard\s*\{[^}]*display: none;[\s\S]*\.page-dashboard-header\s*\{[^}]*grid-template-columns: 1fr;/,
    );
  });
});
