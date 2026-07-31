import { useId, type ReactNode } from "react";

import { ApplicationIcon } from "./ApplicationIcon";

export interface SidebarNavigationGroupProps {
  readonly children: ReactNode;
  readonly forceExpanded?: boolean;
  readonly isExpanded: boolean;
  readonly label: string;
  readonly onToggle: () => void;
}

export function SidebarNavigationGroup({
  children,
  forceExpanded = false,
  isExpanded,
  label,
  onToggle,
}: SidebarNavigationGroupProps) {
  const itemsId = useId();
  const resolvedExpanded = forceExpanded || isExpanded;

  return (
    <section className="ui-shell__sidebar-group">
      <button
        className="ui-shell__sidebar-label"
        type="button"
        aria-controls={itemsId}
        aria-expanded={resolvedExpanded}
        onClick={onToggle}
      >
        <span>{label}</span>
        <ApplicationIcon name="chevron" />
      </button>
      <div
        id={itemsId}
        className="ui-shell__sidebar-items"
        hidden={!resolvedExpanded}
      >
        {children}
      </div>
    </section>
  );
}
