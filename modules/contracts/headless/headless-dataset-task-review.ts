import {copyBoundedPassiveData, readStrictPassiveRecord} from "../shared";
import {DATASET_QUALITY_REASON_CODES, DATASET_QUALITY_STATUSES, type DatasetQualityReport} from "../runtime/dataset-quality";
import {HEADLESS_DATASET_MAX_ROWS_PER_SOURCE, HEADLESS_DATASET_MAX_SOURCES, HEADLESS_DATASET_MAX_TOTAL_BYTES} from "./headless-dataset-preparation";
import {HEADLESS_CONTRACT_VERSION, type HeadlessHostIncarnationId} from "./headless-protocol";
import {readHeadlessDatasetTaskStatusRequest, readHeadlessDatasetTaskStatusValue,
  type HeadlessDatasetTaskSelection, type HeadlessDatasetTaskStatus, type HeadlessDatasetTaskStatusRequest} from "./headless-dataset-task-status";

export interface HeadlessDatasetQualityReview {
  readonly taskId: string;
  readonly reportFingerprint: string;
  readonly policyFingerprint: `sha256:${string}`;
  readonly status: DatasetQualityReport["status"];
  readonly counts: DatasetQualityReport["counts"];
  readonly reasonCounts: DatasetQualityReport["reasonCounts"];
  readonly splits: {readonly trainRows: number; readonly validationRows: number; readonly testRows: number};
  readonly approvalAllowed: boolean;
  readonly saveAvailable: boolean;
}
export interface HeadlessDatasetTaskReview extends HeadlessDatasetTaskStatus {
  readonly review: HeadlessDatasetQualityReview | null;
}
export interface HeadlessDatasetTaskReviewRequest {
  readonly version: typeof HEADLESS_CONTRACT_VERSION;
  readonly operation: "data.dataset-task-review";
  readonly input: HeadlessDatasetTaskStatusRequest["input"];
}

export function readHeadlessDatasetTaskReviewRequest(value: unknown, host: HeadlessHostIncarnationId) {
  const invalid = {ok: false, code: "headless.invalid-request"} as const;
  try {
    const outer = readStrictPassiveRecord(copyBoundedPassiveData(value), ["version", "operation", "input"]);
    if (outer.version !== HEADLESS_CONTRACT_VERSION || outer.operation !== "data.dataset-task-review") return invalid;
    const parsed = readHeadlessDatasetTaskStatusRequest({...outer, operation: "data.dataset-task-status"}, host);
    return parsed.ok ? {ok: true, request: {...parsed.request, operation: "data.dataset-task-review"} satisfies HeadlessDatasetTaskReviewRequest} as const : parsed;
  } catch {return invalid;}
}

export function readHeadlessDatasetTaskReviewValue(value: unknown, selection: HeadlessDatasetTaskSelection): HeadlessDatasetTaskReview | undefined {
  try {
    const outer = readStrictPassiveRecord(copyBoundedPassiveData(value), ["taskId", "state", "review"]);
    const task = readHeadlessDatasetTaskStatusValue({taskId: outer.taskId, state: outer.state}, selection);
    if (!task) return;
    if (outer.review === null) return task.state === "review-required" ? undefined : {...task, review: null};
    if (task.state !== "review-required") return;
    const r = readStrictPassiveRecord(outer.review, ["taskId", "reportFingerprint", "policyFingerprint", "status", "counts",
      "reasonCounts", "splits", "approvalAllowed", "saveAvailable"]);
    if (r.taskId !== task.taskId || typeof r.reportFingerprint !== "string" || !/^[a-f0-9]{64}$/.test(r.reportFingerprint) ||
        typeof r.policyFingerprint !== "string" || !/^sha256:[a-f0-9]{64}$/.test(r.policyFingerprint) ||
        !DATASET_QUALITY_STATUSES.some(status => status === r.status) || typeof r.approvalAllowed !== "boolean" ||
        typeof r.saveAvailable !== "boolean" || (r.saveAvailable && !r.approvalAllowed) ||
        (r.status === "blocked" && r.approvalAllowed)) return;
    const counts = readStrictPassiveRecord(r.counts, ["inputRows", "acceptedRows", "quarantinedRows"]);
    const splits = readStrictPassiveRecord(r.splits, ["trainRows", "validationRows", "testRows"]);
    const reasons = readStrictPassiveRecord(r.reasonCounts, DATASET_QUALITY_REASON_CODES);
    const bounded = (n: unknown): n is number => typeof n === "number" && Number.isSafeInteger(n) && n >= 0 &&
      n <= HEADLESS_DATASET_MAX_TOTAL_BYTES;
    if (![counts.inputRows, counts.acceptedRows, counts.quarantinedRows, splits.trainRows, splits.validationRows, splits.testRows,
      ...Object.values(reasons)].every(bounded)) return;
    const {inputRows, acceptedRows, quarantinedRows} = counts as HeadlessDatasetQualityReview["counts"];
    const {trainRows, validationRows, testRows} = splits as HeadlessDatasetQualityReview["splits"];
    // The quality cap limits accepted rows per source. Additional input rows
    // are still counted and set aside; the admitted byte limit bounds them.
    if (acceptedRows > HEADLESS_DATASET_MAX_ROWS_PER_SOURCE * HEADLESS_DATASET_MAX_SOURCES ||
        acceptedRows + quarantinedRows > inputRows || trainRows + validationRows + testRows > acceptedRows ||
        Object.values(reasons).some(count => (count as number) > inputRows)) return;
    return {...task, review: {taskId: task.taskId, reportFingerprint: r.reportFingerprint,
      policyFingerprint: r.policyFingerprint as `sha256:${string}`, status: r.status as HeadlessDatasetQualityReview["status"],
      counts: {inputRows, acceptedRows, quarantinedRows}, splits: {trainRows, validationRows, testRows},
      reasonCounts: {...reasons} as HeadlessDatasetQualityReview["reasonCounts"],
      approvalAllowed: r.approvalAllowed, saveAvailable: r.saveAvailable}};
  } catch {return;}
}
