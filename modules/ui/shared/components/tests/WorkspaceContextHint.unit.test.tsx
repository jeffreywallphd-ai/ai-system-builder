import { renderToString } from "react-dom/server";

import { describe, expect, it } from "../../../../testing/node-test";
import { getGlossaryEntry } from "../../glossary";
import { WorkspaceContextHint } from "../WorkspaceContextHint";

describe("WorkspaceContextHint", () => {
  it("uses the canonical workspace helper definition", () => {
    const html = renderToString(<WorkspaceContextHint />);

    expect(html).toContain("Workspace context");
    expect(html).toContain(getGlossaryEntry("workspace").definition);
    expect(html).toContain('aria-label="Workspace context"');
  });
});
