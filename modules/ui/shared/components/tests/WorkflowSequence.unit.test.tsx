import { renderToStaticMarkup } from "react-dom/server";

import { describe, expect, it } from "../../../../testing/node-test";
import { WorkflowSequence, WorkflowStep } from "../WorkflowSequence";

describe("WorkflowSequence", () => {
  it("renders accessible ordered workflow steps and active state", () => {
    const html = renderToStaticMarkup(
      <WorkflowSequence ariaLabel="Example workflow">
        <WorkflowStep title="Choose input" description="Select a source.">
          <label>
            Source
            <input />
          </label>
        </WorkflowStep>
        <WorkflowStep title="Run" active>
          <button type="button">Start</button>
        </WorkflowStep>
      </WorkflowSequence>,
    );

    expect(html).toContain('class="ui-workflow"');
    expect(html).toContain('role="list"');
    expect(html).toContain('aria-label="Example workflow"');
    expect(html).toContain('class="ui-workflow__step"');
    expect(html.match(/role="listitem"/g)?.length).toBe(2);
    expect(html).toContain('data-active="true"');
    expect(html).toContain('aria-labelledby="');
    expect(html).toContain("Choose input");
    expect(html).toContain("Select a source.");
  });
});
