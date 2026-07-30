import { useEffect, useId, useState } from "react";

import {
  ApplicationIcon,
  TermWithHint,
} from "../../../../../../../modules/ui/shared";
import { useActiveWorkspace } from "../hooks/useActiveWorkspace";
import { WorkspaceCreateForm } from "./WorkspaceCreateForm";

export interface WorkspaceSwitcherProps {
  readonly variant?: "card" | "header";
}

export function WorkspaceSwitcher({
  variant = "card",
}: WorkspaceSwitcherProps = {}) {
  const workspace = useActiveWorkspace();
  const selectId = useId();
  const [creating, setCreating] = useState(false);
  const activeWorkspaces = workspace.workspaces.filter(
    (candidate) => candidate.status === "active",
  );
  const activeWorkspaceId = workspace.activeWorkspace?.id ?? "";
  const [pendingWorkspaceId, setPendingWorkspaceId] =
    useState(activeWorkspaceId);

  useEffect(() => {
    setPendingWorkspaceId(activeWorkspaceId);
  }, [activeWorkspaceId]);

  if (variant === "card") {
    if (workspace.loading) {
      return (
        <section className="workspace-switcher" aria-label="Workspace">
          <span>Workspace: Loading...</span>
        </section>
      );
    }

    const canChangeWorkspace =
      pendingWorkspaceId.length > 0 && pendingWorkspaceId !== activeWorkspaceId;

    return (
      <section
        className="workspace-switcher workspace-switcher--card ui-stack ui-stack--md"
        aria-label="Workspace"
      >
        <span className="ui-visually-hidden">
          Current workspace:{" "}
          {workspace.activeWorkspace?.displayName ?? "No workspace selected"}
        </span>
        <div className="workspace-switcher__card-section ui-stack ui-stack--sm">
          {activeWorkspaces.length > 0 ? (
            <div className="ui-cluster">
              <label className="ui-stack ui-stack--xs" htmlFor={selectId}>
                <select
                  id={selectId}
                  className="ui-input"
                  aria-label="Select workspace"
                  value={pendingWorkspaceId}
                  onChange={(event) =>
                    setPendingWorkspaceId(event.currentTarget.value)
                  }
                >
                  <option value="">Select workspace</option>
                  {activeWorkspaces.map((candidate) => (
                    <option key={candidate.id} value={candidate.id}>
                      {candidate.displayName}
                    </option>
                  ))}
                </select>
              </label>
              <button
                className="ui-button"
                type="button"
                disabled={!canChangeWorkspace}
                onClick={() => {
                  if (pendingWorkspaceId) {
                    void workspace.selectWorkspace(pendingWorkspaceId);
                  }
                }}
              >
                <ApplicationIcon name="switch" />
                <span className="ui-button__label">Change workspace</span>
              </button>
            </div>
          ) : (
            <p className="ui-text-muted">No workspace is available yet.</p>
          )}
        </div>
        <div className="workspace-switcher__card-section workspace-switcher__card-section--create ui-stack ui-stack--sm">
          {creating ? (
            <WorkspaceCreateForm compact onCreated={() => setCreating(false)} />
          ) : (
            <button
              className="ui-button ui-button--outline"
              type="button"
              onClick={() => setCreating(true)}
            >
              <ApplicationIcon name="add" />
              <span className="ui-button__label">Create new workspace</span>
            </button>
          )}
        </div>
        {workspace.error ? (
          <p className="ui-status ui-status--error" role="alert">
            {workspace.error}
          </p>
        ) : null}
        {workspace.activeWorkspaceId && !workspace.activeWorkspace ? (
          <p className="ui-status ui-status--error" role="alert">
            This workspace is unavailable. Select or create another workspace.
          </p>
        ) : null}
      </section>
    );
  }

  if (workspace.loading) {
    return (
      <section
        className="workspace-switcher workspace-switcher--header"
        aria-label="Current workspace"
      >
        <span className="workspace-switcher__label">Current Workspace</span>
        <span className="workspace-switcher__status">Loading...</span>
      </section>
    );
  }

  const canChangeWorkspace =
    pendingWorkspaceId.length > 0 && pendingWorkspaceId !== activeWorkspaceId;

  return (
    <section
      className="workspace-switcher workspace-switcher--header"
      aria-label="Current workspace"
    >
      <label className="workspace-switcher__field" htmlFor={selectId}>
        <span className="workspace-switcher__label">
          <TermWithHint termId="workspace">Current Workspace</TermWithHint>
        </span>
        <select
          id={selectId}
          className="ui-input workspace-switcher__select"
          aria-label="Select current workspace"
          value={pendingWorkspaceId}
          disabled={activeWorkspaces.length === 0}
          onChange={(event) => setPendingWorkspaceId(event.currentTarget.value)}
        >
          <option value="">No workspace selected</option>
          {activeWorkspaces.map((candidate) => (
            <option key={candidate.id} value={candidate.id}>
              {candidate.displayName}
            </option>
          ))}
        </select>
      </label>
      <button
        className="ui-button workspace-switcher__change"
        type="button"
        disabled={!canChangeWorkspace}
        onClick={() => {
          if (pendingWorkspaceId) {
            void workspace.selectWorkspace(pendingWorkspaceId);
          }
        }}
      >
        <ApplicationIcon name="switch" />
        <span className="ui-button__label">Change</span>
      </button>
      {workspace.error ? (
        <p className="ui-status ui-status--error" role="alert">
          {workspace.error}
        </p>
      ) : null}
      {workspace.activeWorkspaceId && !workspace.activeWorkspace ? (
        <p className="ui-status ui-status--error" role="alert">
          This workspace is unavailable. Select or create another workspace.
        </p>
      ) : null}
    </section>
  );
}
