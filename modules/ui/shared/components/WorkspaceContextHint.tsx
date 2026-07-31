import { getGlossaryEntry } from "../glossary";
import { ApplicationIcon } from "./ApplicationIcon";

const workspaceHint = getGlossaryEntry("workspace").definition;

export function WorkspaceContextHint() {
  return (
    <aside
      className="ui-panel home-workspace-hint"
      aria-label="Workspace context"
    >
      <span className="home-workspace-hint__icon" aria-hidden="true">
        <ApplicationIcon name="info" />
      </span>
      <div>
        <strong>Workspace context</strong>
        <p>{workspaceHint}</p>
      </div>
    </aside>
  );
}
