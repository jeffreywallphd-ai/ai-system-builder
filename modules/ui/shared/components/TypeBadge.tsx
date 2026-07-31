export type TypeBadgeTone =
  "amber" | "blue" | "cyan" | "green" | "neutral" | "red" | "violet";

export interface TypeBadgePresentation {
  readonly label: string;
  readonly tone: TypeBadgeTone;
}

export interface TypeBadgeProps {
  readonly label?: string;
  readonly value?: string;
}

const knownTypes: readonly {
  readonly label: string;
  readonly matches: readonly string[];
  readonly tone: TypeBadgeTone;
}[] = [
  { label: "PDF", matches: ["pdf"], tone: "red" },
  {
    label: "DOCX",
    matches: ["docx", "wordprocessingml"],
    tone: "blue",
  },
  { label: "DOC", matches: ["msword", ".doc"], tone: "blue" },
  {
    label: "XLSX",
    matches: ["xlsx", "spreadsheetml"],
    tone: "green",
  },
  { label: "XLS", matches: ["ms-excel", ".xls"], tone: "green" },
  { label: "CSV", matches: ["csv"], tone: "green" },
  { label: "JSONL", matches: ["jsonl", "ndjson"], tone: "amber" },
  { label: "JSON", matches: ["json"], tone: "amber" },
  { label: "YAML", matches: ["yaml", "yml"], tone: "amber" },
  { label: "PNG", matches: ["png"], tone: "violet" },
  { label: "JPG", matches: ["jpeg", "jpg"], tone: "violet" },
  { label: "WEBP", matches: ["webp"], tone: "violet" },
  { label: "SVG", matches: ["svg"], tone: "violet" },
  { label: "HTML", matches: ["html"], tone: "cyan" },
  { label: "MD", matches: ["markdown", ".md"], tone: "cyan" },
  { label: "TXT", matches: ["text/plain", ".txt"], tone: "cyan" },
  { label: "ZIP", matches: ["zip"], tone: "neutral" },
  { label: "PARQ", matches: ["parquet"], tone: "green" },
];

export function resolveTypeBadgePresentation(
  value: string | undefined,
): TypeBadgePresentation {
  const normalizedValue = value?.trim().toLowerCase() ?? "";
  const knownType = knownTypes.find((candidate) =>
    candidate.matches.some((match) => normalizedValue.includes(match)),
  );

  if (knownType) {
    return { label: knownType.label, tone: knownType.tone };
  }

  const valueWithoutQuery = normalizedValue.split(/[?#]/, 1)[0] ?? "";
  const extension = valueWithoutQuery.includes(".")
    ? valueWithoutQuery.split(".").pop()
    : undefined;
  const mediaSubtype = normalizedValue.includes("/")
    ? normalizedValue.split("/").pop()?.replace(/^x-/, "")
    : undefined;
  const fallbackLabel = extension || mediaSubtype || normalizedValue || "type";

  return {
    label:
      fallbackLabel
        .replace(/[^a-z0-9]+/g, "")
        .slice(0, 5)
        .toUpperCase() || "TYPE",
    tone: "neutral",
  };
}

export function TypeBadge({ label, value }: TypeBadgeProps) {
  const presentation = resolveTypeBadgePresentation(value);

  return (
    <span
      className={`ui-type-badge ui-type-badge--${presentation.tone}`}
      title={value}
    >
      {label ?? presentation.label}
    </span>
  );
}
