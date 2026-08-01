import { useEffect, useState } from "react";

import {
  loadPageDashboardMetrics,
  type PageDashboardDataSource,
  type PageDashboardKind,
  type PageDashboardMetric,
} from "./dashboardMetrics";

export interface PageDashboardProps {
  readonly kind: PageDashboardKind;
  readonly source: PageDashboardDataSource;
  readonly workspaceId?: string;
  readonly size?: "default" | "large";
}

export function PageDashboard({
  kind,
  source,
  workspaceId,
  size = "default",
}: PageDashboardProps) {
  const [state, setState] = useState<{
    readonly status: "loading" | "ready" | "unavailable";
    readonly metrics: readonly PageDashboardMetric[];
  }>({ status: "loading", metrics: [] });

  useEffect(() => {
    let current = true;
    setState({ status: "loading", metrics: [] });
    void loadPageDashboardMetrics(kind, source, workspaceId)
      .then((metrics) => {
        if (current) setState({ status: "ready", metrics });
      })
      .catch(() => {
        if (current) setState({ status: "unavailable", metrics: [] });
      });
    return () => {
      current = false;
    };
  }, [kind, source, workspaceId]);

  const loading = state.status === "loading";
  const metrics = loading
    ? placeholderMetrics(kind)
    : state.status === "ready"
      ? state.metrics
      : placeholderMetrics(kind);

  if (!workspaceId && kind !== "settings") return null;

  return (
    <section
      className={`page-dashboard page-dashboard--${size}${metrics.length === 1 ? " page-dashboard--single" : ""}`}
      aria-label="Page summary"
      aria-busy={loading || undefined}
    >
      <dl className="page-dashboard__grid">
        {metrics.map((metric) => (
          <div className="page-dashboard__metric" key={metric.label}>
            <dt>{metric.label}</dt>
            <dd>
              {loading || state.status === "unavailable" ? "—" : metric.value}
            </dd>
            {metric.detail ? (
              <span className="page-dashboard__detail">{metric.detail}</span>
            ) : null}
          </div>
        ))}
      </dl>
      {state.status === "unavailable" ? (
        <p className="page-dashboard__status" role="status">
          Summary unavailable.
        </p>
      ) : null}
    </section>
  );
}

function placeholderMetrics(
  kind: PageDashboardKind,
): readonly PageDashboardMetric[] {
  const labels: Record<PageDashboardKind, readonly string[]> = {
    home: [
      "Systems Published",
      "Training Datasets Created",
      "Custom Models Trained",
      "Custom Assets Created",
    ],
    systems: ["Systems Composed", "Systems Published"],
    models: ["Models Installed", "Models Trained"],
    "image-generation": ["Images Generated"],
    artifacts: ["Artifacts Uploaded", "Datasets Created"],
    context: ["RAG Databases", "Markdown Context Packs"],
    assets: ["Assets Used", "Custom Assets"],
    settings: ["Default Runtime Device", "Default Global Model"],
  };
  return labels[kind].map((label) => ({ label, value: "—" }));
}
