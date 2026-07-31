import { useState } from "react";

import { CollapsiblePanel } from "../../../components/ui/CollapsiblePanel";
import { SectionErrorState } from "../../../components/ui/SectionErrorState";
import { SectionLoadingState } from "../../../components/ui/SectionLoadingState";
import { useAsyncSection } from "../../../hooks/useAsyncSection";
import { getDesktopApi } from "../../../lib/desktopApi";
import { createDesktopImageGenerationClient } from "../../image-generation/api";
import { PythonRuntimeFooter } from "../../python-runtime/components/PythonRuntimeFooter";

interface LifecycleEntry {
  readonly featureKey: string;
  readonly policy: string;
  readonly loaded: boolean;
  readonly idle: boolean;
  readonly idleTimeoutScheduled: boolean;
}

function normalizeLifecycleEntries(response: unknown): LifecycleEntry[] {
  if (
    !response ||
    typeof response !== "object" ||
    !("ok" in response) ||
    (response as { ok?: unknown }).ok !== true
  ) {
    throw new Error("Unable to read lifecycle diagnostics.");
  }
  const value = (response as { value?: { entries?: unknown } }).value;
  if (!value || !Array.isArray(value.entries)) return [];
  return value.entries
    .filter(
      (entry): entry is LifecycleEntry =>
        Boolean(entry) &&
        typeof entry === "object" &&
        typeof (entry as LifecycleEntry).featureKey === "string",
    )
    .map((entry) => ({
      featureKey: entry.featureKey,
      policy: String(entry.policy),
      loaded: Boolean(entry.loaded),
      idle: Boolean(entry.idle),
      idleTimeoutScheduled: Boolean(entry.idleTimeoutScheduled),
    }));
}

function normalizeDisposeResults(response: unknown): string {
  if (
    !response ||
    typeof response !== "object" ||
    !("ok" in response) ||
    (response as { ok?: unknown }).ok !== true
  ) {
    return "Unable to dispose idle disposable features.";
  }
  const results = (response as { value?: { results?: unknown } }).value
    ?.results;
  if (!Array.isArray(results) || results.length === 0)
    return "No idle disposable features were disposed.";
  const disposed = results.filter((result) =>
    Boolean((result as { disposed?: unknown }).disposed),
  ).length;
  return `Disposed ${disposed} idle feature(s); ${results.length - disposed} blocked or unchanged.`;
}

export function SoftwareStatusSection() {
  const diagnosticsEnabled = getDesktopApi().memoryDiagnosticsEnabled === true;
  const [pythonExpanded, setPythonExpanded] = useState(false);
  const [comfyExpanded, setComfyExpanded] = useState(false);
  const [lifecycleExpanded, setLifecycleExpanded] = useState(false);
  const [disposeMessage, setDisposeMessage] = useState<string | undefined>();
  const [disposingIdle, setDisposingIdle] = useState(false);
  const lifecycleState = useAsyncSection({
    pageKey: "settings",
    sectionKey: "settings.software-status.feature-lifecycle",
    initialTrigger: "expanded",
    loadOnMount: false,
    loader: async () => {
      const api = getDesktopApi();
      if (!api.readFeatureLifecycleState)
        throw new Error("Feature lifecycle diagnostics are unavailable.");
      return normalizeLifecycleEntries(await api.readFeatureLifecycleState());
    },
  });
  const comfyStatus = useAsyncSection({
    pageKey: "settings",
    sectionKey: "settings.software-status.comfyui-runtime",
    initialTrigger: "expanded",
    loadOnMount: false,
    loader: async () => {
      const result =
        await createDesktopImageGenerationClient().readComfyUiInstallStatus({});
      if (!result.ok) throw new Error(result.error.message);
      return result.value.status;
    },
  });

  const disposeIdleFeatures = async () => {
    const api = getDesktopApi();
    if (!api.disposeIdleFeatures) {
      setDisposeMessage("Feature lifecycle idle disposal is unavailable.");
      return;
    }
    setDisposingIdle(true);
    try {
      setDisposeMessage(
        normalizeDisposeResults(await api.disposeIdleFeatures()),
      );
      void lifecycleState.load("refresh");
    } finally {
      setDisposingIdle(false);
    }
  };

  return (
    <section
      className="ui-stack ui-stack--sm"
      aria-label="Software status controls"
    >
      <p className="ui-text-muted">
        Inspect the desktop builder, host features, and local runtimes. These
        operational controls do not describe systems built in a workspace.
      </p>

      <section
        className="ui-panel ui-stack ui-stack--sm"
        aria-label="Basic software diagnostics"
      >
        <h3 className="ui-panel__title">Basic diagnostics</h3>
        <p>
          The desktop builder shell is mounted. Runtime status panels remain
          deferred until opened.
        </p>
      </section>

      <section
        className="ui-panel ui-stack ui-stack--sm"
        aria-label="Runtime status overview"
      >
        <h3 className="ui-panel__title">Runtime status</h3>
        <p>
          Python and ComfyUI controls are idle until you expand a runtime
          section or choose an explicit action.
        </p>
      </section>

      {diagnosticsEnabled ? (
        <CollapsiblePanel
          title="Feature lifecycle diagnostics"
          isExpanded={lifecycleExpanded}
          onToggle={() => {
            setLifecycleExpanded((expanded) => {
              const next = !expanded;
              if (next && lifecycleState.status === "idle")
                void lifecycleState.load("expanded");
              return next;
            });
          }}
        >
          <p className="ui-text-muted">
            Developer diagnostics only. This read-only table does not compose
            unloaded feature graphs. The dispose action only asks the host to
            dispose idle disposable entries.
          </p>
          {lifecycleState.status === "idle" ? (
            <p>Open this section to read host feature lifecycle state.</p>
          ) : null}
          {lifecycleState.status === "loading" ? (
            <SectionLoadingState message="Loading feature lifecycle diagnostics..." />
          ) : null}
          {lifecycleState.status === "error" ? (
            <SectionErrorState
              message={
                lifecycleState.error ??
                "Failed to load feature lifecycle diagnostics."
              }
              onRetry={() => {
                void lifecycleState.retry();
              }}
            />
          ) : null}
          {lifecycleState.status === "success" ? (
            <section
              className="ui-stack ui-stack--sm"
              aria-label="Feature lifecycle state"
            >
              <div className="ui-actions">
                <button
                  className="ui-button"
                  type="button"
                  onClick={() => {
                    void lifecycleState.load("refresh");
                  }}
                >
                  Refresh
                </button>
                <button
                  className="ui-button ui-button--outline"
                  type="button"
                  disabled={disposingIdle}
                  onClick={() => {
                    void disposeIdleFeatures();
                  }}
                >
                  Dispose idle disposable features
                </button>
              </div>
              {disposeMessage ? <p role="status">{disposeMessage}</p> : null}
              <table className="ui-table">
                <thead>
                  <tr>
                    <th>Feature</th>
                    <th>Policy</th>
                    <th>Loaded</th>
                    <th>Idle</th>
                    <th>Idle timeout</th>
                  </tr>
                </thead>
                <tbody>
                  {lifecycleState.data?.map((entry) => (
                    <tr key={entry.featureKey}>
                      <td>{entry.featureKey}</td>
                      <td>{entry.policy}</td>
                      <td>{entry.loaded ? "yes" : "no"}</td>
                      <td>{entry.idle ? "yes" : "no"}</td>
                      <td>
                        {entry.idleTimeoutScheduled ? "scheduled" : "none"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          ) : null}
        </CollapsiblePanel>
      ) : null}

      <CollapsiblePanel
        title="Python runtime controls"
        isExpanded={pythonExpanded}
        onToggle={() => setPythonExpanded((expanded) => !expanded)}
      >
        {pythonExpanded ? (
          <PythonRuntimeFooter enabled />
        ) : (
          <p>
            Open this section to read Python runtime status and logs. Start,
            stop, and restart remain explicit actions.
          </p>
        )}
      </CollapsiblePanel>

      <CollapsiblePanel
        title="ComfyUI install status and repair"
        isExpanded={comfyExpanded}
        onToggle={() => {
          setComfyExpanded((expanded) => {
            const next = !expanded;
            if (next && comfyStatus.status === "idle")
              void comfyStatus.load("expanded");
            return next;
          });
        }}
      >
        {comfyStatus.status === "idle" ? (
          <p>Open this section to check ComfyUI install status.</p>
        ) : null}
        {comfyStatus.status === "loading" ? (
          <SectionLoadingState message="Loading ComfyUI install status..." />
        ) : null}
        {comfyStatus.status === "error" ? (
          <SectionErrorState
            message={
              comfyStatus.error ?? "Failed to load ComfyUI install status."
            }
            onRetry={() => {
              void comfyStatus.retry();
            }}
          />
        ) : null}
        {comfyStatus.status === "success" ? (
          <section
            className="ui-stack ui-stack--sm"
            aria-label="ComfyUI runtime status"
          >
            <p>
              ComfyUI install status: <strong>{comfyStatus.data}</strong>
            </p>
            <button
              className="ui-button"
              type="button"
              onClick={() => {
                void comfyStatus.load("refresh");
              }}
            >
              Refresh
            </button>
          </section>
        ) : null}
      </CollapsiblePanel>
    </section>
  );
}
