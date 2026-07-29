import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "../../../../testing/node-test";
import { SystemRunWorkflow } from "../SystemRunWorkflow";

describe("SystemRunWorkflow static surface", () => {
  it("renders one ordered, accessible, capability-neutral Run & Test experience", () => {
    const pending = new Promise<never>(() => undefined);
    const html = renderToStaticMarkup(
      <SystemRunWorkflow
        workspaceId="workspace-a"
        client={{
          listProfiles: () => pending,
          prepare: () => pending,
          invoke: () => pending,
        }}
      />,
    );

    expect(html).toContain("Run &amp; Test");
    expect(html).toContain("Choose a workflow");
    expect(html).toContain("Configure an action");
    expect(html).toContain("Review and confirm");
    expect(html).toContain("Results and history");
    expect(html).toContain("exact approved releases or reviewed execution plans");
    expect(html).not.toContain("Secured data-entry release");
    expect(html).not.toContain("Controlled chatbot");
    expect(html).not.toContain("Artifact review release");
  });
});
