import type { ReactNode } from "react";

import { ApplicationIcon, type ApplicationIconName } from "./ApplicationIcon";

export type PanelHeadingTone = "blue" | "cyan" | "violet";

export interface PanelHeadingProps {
  readonly children: ReactNode;
  readonly icon: ApplicationIconName;
  readonly tone?: PanelHeadingTone;
}

export function PanelHeading({
  children,
  icon,
  tone = "blue",
}: PanelHeadingProps) {
  return (
    <div className={`ui-panel-heading ui-panel-heading--${tone}`}>
      <span className="ui-panel-heading__icon" aria-hidden="true">
        <ApplicationIcon name={icon} />
      </span>
      <h2 className="ui-panel__title">{children}</h2>
    </div>
  );
}
