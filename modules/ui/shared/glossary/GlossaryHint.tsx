import { useId, useState, type ReactNode } from "react";

import { getGlossaryEntry, type GlossaryTermId } from "./glossary";

export interface GlossaryHintProps {
  readonly termId: GlossaryTermId;
}

export function GlossaryHint({ termId }: GlossaryHintProps) {
  const [isOpen, setIsOpen] = useState(false);
  const tooltipId = useId();
  const entry = getGlossaryEntry(termId);

  return (
    <span
      className={`ui-glossary-hint${isOpen ? " ui-glossary-hint--open" : ""}`}
      onBlur={(event) => {
        const nextFocus = event.relatedTarget instanceof Node ? event.relatedTarget : null;
        if (!event.currentTarget.contains(nextFocus)) {
          setIsOpen(false);
        }
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          setIsOpen(false);
        }
      }}
    >
      <button
        className="ui-glossary-hint__button"
        type="button"
        aria-label={`What does ${entry.term} mean?`}
        aria-describedby={tooltipId}
        aria-expanded={isOpen}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          setIsOpen((current) => !current);
        }}
      >
        i
      </button>
      <span className="ui-glossary-hint__bubble" id={tooltipId} role="tooltip">
        <strong>{entry.term}</strong>
        <span>{entry.definition}</span>
      </span>
    </span>
  );
}

export interface TermWithHintProps {
  readonly termId: GlossaryTermId;
  readonly children?: ReactNode;
}

export function TermWithHint({ termId, children }: TermWithHintProps) {
  const entry = getGlossaryEntry(termId);

  return (
    <span className="ui-glossary-term">
      <span>{children ?? entry.term}</span>
      <GlossaryHint termId={termId} />
    </span>
  );
}
