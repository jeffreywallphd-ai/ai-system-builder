import { useId, useRef, useState } from "react";

import {
  ApplicationIcon,
  TermWithHint,
} from "../../../../../../../modules/ui/shared";
import { useActiveWorkspace } from "../hooks/useActiveWorkspace";

export interface WorkspaceCreateFormProps {
  readonly compact?: boolean;
  readonly onCreated?: () => void;
}

export function WorkspaceCreateForm({
  compact = false,
  onCreated,
}: WorkspaceCreateFormProps) {
  const workspace = useActiveWorkspace();
  const errorId = useId();
  const [workspaceName, setWorkspaceName] = useState("");
  const [includeFoundation, setIncludeFoundation] = useState(true);
  const [formError, setFormError] = useState<string>();
  const creatingRef = useRef(false);
  const [creating, setCreating] = useState(false);

  return (
    <form
      className="ui-stack ui-stack--sm workspace-create-form"
      aria-busy={creating}
      onSubmit={async (event) => {
        event.preventDefault();
        if (creatingRef.current) return;
        const submittedValue = new FormData(event.currentTarget).get(
          "workspaceName",
        );
        const submittedName =
          typeof submittedValue === "string" ? submittedValue : workspaceName;
        if (!submittedName.trim()) {
          setFormError("Enter a workspace name.");
          return;
        }

        creatingRef.current = true;
        setCreating(true);
        try {
          await workspace.createWorkspace({
            name: submittedName,
            includeSystemFoundationAssets: includeFoundation,
          });
          setWorkspaceName("");
          setFormError(undefined);
          onCreated?.();
        } catch (error) {
          setFormError(
            error instanceof Error
              ? error.message
              : "Workspace could not be created.",
          );
        } finally {
          creatingRef.current = false;
          setCreating(false);
        }
      }}
    >
      <h3>{compact ? "Create workspace" : "Create a workspace"}</h3>
      <label className="ui-field">
        <span>
          <TermWithHint termId="workspaceName">Name</TermWithHint>
        </span>
        <input
          name="workspaceName"
          disabled={creating}
          value={workspaceName}
          aria-invalid={formError ? "true" : undefined}
          aria-describedby={formError ? errorId : undefined}
          onChange={(event) => {
            setWorkspaceName(event.currentTarget.value);
            setFormError(undefined);
          }}
          placeholder="My Project"
        />
      </label>
      <label className="ui-checkbox">
        <input
          type="checkbox"
          disabled={creating}
          checked={includeFoundation}
          onChange={(event) =>
            setIncludeFoundation(event.currentTarget.checked)
          }
        />
        <span>
          <TermWithHint termId="includeSystemAssets">
            Include System Foundation assets
          </TermWithHint>
        </span>
      </label>
      {!compact ? (
        <p className="ui-text-muted">
          Adds reusable UI, form, display, workflow, and system shell assets to
          this workspace.
        </p>
      ) : null}
      {formError ? (
        <p id={errorId} className="ui-status ui-status--error" role="alert">
          {formError}
        </p>
      ) : null}
      <button className="ui-button ui-button--primary" type="submit" disabled={creating}>
        <ApplicationIcon name="add" />
        <span className="ui-button__label">Create workspace</span>
      </button>
    </form>
  );
}
