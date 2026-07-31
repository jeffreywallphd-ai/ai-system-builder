import type {
  DatasetQualityReport,
  DatasetQualityReviewLineId,
  DatasetQualityReviewPage,
} from "../../../contracts/runtime";
import type { ReviewNavigatorItem } from "./DatasetReviewModal";

export interface DatasetQualityReviewLine {
  readonly id: DatasetQualityReviewLineId;
  readonly label: string;
  readonly count: number;
}

export function createDatasetQualityReviewLines(
  report: DatasetQualityReport,
  reasonLabels: Readonly<Record<string, string>> = {},
): readonly DatasetQualityReviewLine[] {
  return [
    { id: "ready", label: "Ready", count: report.counts.acceptedRows },
    {
      id: "set-aside",
      label: "Set aside",
      count: report.counts.quarantinedRows,
    },
    ...Object.entries(report.reasonCounts)
      .filter(
        (entry): entry is [string, number] => typeof entry[1] === "number",
      )
      .map(([reason, count]) => ({
        id: `reason:${reason}` as DatasetQualityReviewLineId,
        label: reasonLabels[reason] ?? readableReason(reason),
        count,
      })),
  ];
}

export function createDatasetQualityReviewRowItems(
  page: DatasetQualityReviewPage | undefined,
  lineLabel: string,
): readonly ReviewNavigatorItem[] {
  return (page?.rows ?? []).map((row) => ({
    id: `${page?.lineId}:${row.rowFingerprint}`,
    title: `${lineLabel} record ${row.rowIndex + 1}`,
    summary:
      "Review the complete prepared record and its available source details.",
    content: (
      <dl className="dataset-review__values">
        {Object.entries(row.values).map(([name, value]) => (
          <div key={name}>
            <dt>{name}</dt>
            <dd>
              <pre>{formatReviewValue(value)}</pre>
            </dd>
          </div>
        ))}
      </dl>
    ),
  }));
}

function readableReason(value: string): string {
  const text = value.replace(/-/g, " ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function formatReviewValue(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}
