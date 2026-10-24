import { useId } from "react";
import {
  isDatasetPreparationOcrLanguage,
  type DatasetPreparationAdvancedReport,
} from "../../../contracts/runtime";

export interface DatasetPreparationOcrSettingsProps {
  enabled: boolean;
  language: string;
  eligible: boolean;
  busy: boolean;
  onEnabledChange: (enabled: boolean) => void;
  onLanguageChange: (language: string) => void;
}

/** Display completed facts without turning character hygiene into reader accuracy. */
export function DatasetPreparationTextReadingChecks({ content }: {
  content: NonNullable<DatasetPreparationAdvancedReport["content"]>;
}) {
  const validCount = (value: unknown): value is number =>
    Number.isSafeInteger(value) && Number(value) >= 0;
  const ocr = content.ocr;
  const readerFacts = ocr && isDatasetPreparationOcrLanguage(ocr.language) &&
    validCount(ocr.documentCount) && validCount(ocr.pageCount) && validCount(ocr.lineCount);
  return (
    <>
      <dt>Source sections kept</dt>
      <dd>{validCount(content.sourceSpanCount) ? content.sourceSpanCount : "Not reported"}</dd>
      <dt>Text character check</dt>
      <dd>
        {Number.isFinite(content.meanExtractionQuality) && content.meanExtractionQuality >= 0 &&
        content.meanExtractionQuality <= 1 ? `${Math.round(content.meanExtractionQuality * 100)}%` : "Not reported"}
        <small className="ui-text-muted">
          {" "}Checks for unreadable replacement and control characters. This is not an OCR accuracy score.
        </small>
      </dd>
      {readerFacts ? (
        <>
          <dt>Text recognition language</dt><dd>{ocr.language}</dd>
          <dt>PDF files read</dt><dd>{ocr.documentCount}</dd>
          <dt>Pages read</dt><dd>{ocr.pageCount}</dd>
          <dt>Text lines read</dt><dd>{ocr.lineCount}</dd>
        </>
      ) : null}
    </>
  );
}

/** A choice to request recognition; this control never asserts reader readiness. */
export function DatasetPreparationOcrSettings({
  enabled,
  language,
  eligible,
  busy,
  onEnabledChange,
  onLanguageChange,
}: DatasetPreparationOcrSettingsProps) {
  const helpId = useId();
  return (
    <fieldset className="ui-stack ui-stack--sm" disabled={busy}>
      <legend>Scanned PDF pages</legend>
      <label>
        <input
          type="checkbox"
          checked={enabled === true}
          disabled={!eligible && enabled !== true}
          aria-describedby={helpId}
          onChange={(event) => onEnabledChange(event.target.checked)}
        />{" "}
        Read text from scanned PDF pages
      </label>
      <p id={helpId} className="ui-text-muted">
        Optional. Select only PDF files and Document-structure sections. Each
        PDF must be at most 16 MiB and 16 pages. Reading scanned pages can take longer than
        reading typed text. The task checks the Windows text reader and selected
        language before reading. This setting does not download a reader or model.
      </p>
      {!eligible ? (
        <p role="status">
          Select only PDF files and Document-structure sections to use this
          setting. You can turn it off to use another method.
        </p>
      ) : null}
      {enabled === true ? (
        <label className="ui-stack ui-stack--sm">
          <span>Text recognition language</span>
          <input
            className="ui-input"
            value={language}
            maxLength={35}
            spellCheck={false}
            placeholder="For example, en-US"
            aria-describedby={helpId}
            onChange={(event) => onLanguageChange(event.target.value)}
          />
          <small className="ui-text-muted">
            Enter the exact Windows language tag installed on the computer
            running the task. No language is selected automatically.
          </small>
        </label>
      ) : null}
    </fieldset>
  );
}
