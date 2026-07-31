import { useId, type ReactNode } from "react";

function joinClassNames(...classNames: Array<string | undefined>): string {
  return classNames.filter(Boolean).join(" ");
}

export interface WorkflowSequenceProps {
  readonly children: ReactNode;
  readonly ariaLabel: string;
  readonly className?: string;
}

export function WorkflowSequence({
  children,
  ariaLabel,
  className,
}: WorkflowSequenceProps) {
  return (
    <div
      className={joinClassNames("ui-workflow", className)}
      role="list"
      aria-label={ariaLabel}
    >
      {children}
    </div>
  );
}

export interface WorkflowStepProps {
  readonly title: ReactNode;
  readonly description?: ReactNode;
  readonly children: ReactNode;
  readonly active?: boolean;
  readonly className?: string;
}

export function WorkflowStep({
  title,
  description,
  children,
  active = false,
  className,
}: WorkflowStepProps) {
  const headingId = useId();

  return (
    <section
      className={joinClassNames("ui-workflow__step", className)}
      role="listitem"
      aria-labelledby={headingId}
      data-active={active ? "true" : undefined}
    >
      <h3 id={headingId} className="ui-workflow__step-title">
        {title}
      </h3>
      {description ? (
        <p className="ui-workflow__step-description ui-text-muted">
          {description}
        </p>
      ) : null}
      {children}
    </section>
  );
}
