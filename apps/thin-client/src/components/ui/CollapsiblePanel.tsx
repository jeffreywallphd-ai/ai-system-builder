import { useId, type ReactNode } from "react";

interface CollapsiblePanelProps {
  title: string;
  isExpanded: boolean;
  onToggle: () => void;
  contentId?: string;
  className?: string;
  children: ReactNode;
}

export function CollapsiblePanel({
  title,
  isExpanded,
  onToggle,
  contentId,
  className,
  children,
}: CollapsiblePanelProps) {
  const autoContentId = useId();
  const resolvedContentId = contentId ?? autoContentId;
  const panelClassName = ["ui-panel", "ui-panel--collapsible", className].filter(Boolean).join(" ");

  return (
    <section className={panelClassName}>
      <button
        className="ui-panel__toggle"
        type="button"
        aria-expanded={isExpanded}
        aria-controls={resolvedContentId}
        onClick={onToggle}
      >
        <span className="ui-panel__title">{title}</span>
        <span className="ui-panel__chevron" aria-hidden="true">
          {isExpanded ? "-" : "+"}
        </span>
      </button>
      <div id={resolvedContentId} className="ui-panel__body" hidden={!isExpanded}>
        {children}
      </div>
    </section>
  );
}
