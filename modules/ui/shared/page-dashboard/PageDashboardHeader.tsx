import type { ReactNode } from "react";

export function PageDashboardHeader({
  eyebrow,
  title,
  titleId,
  description,
  controls,
  dashboard,
}: {
  readonly eyebrow?: ReactNode;
  readonly title: string;
  readonly titleId?: string;
  readonly description?: ReactNode;
  readonly controls?: ReactNode;
  readonly dashboard: ReactNode;
}) {
  return (
    <header className="page-dashboard-header">
      <div className="page-dashboard-header__copy ui-stack ui-stack--sm">
        {eyebrow}
        <h1 id={titleId}>{title}</h1>
        {description ? <p className="ui-text-muted">{description}</p> : null}
        {controls}
      </div>
      <div className="page-dashboard-header__summary">{dashboard}</div>
    </header>
  );
}
