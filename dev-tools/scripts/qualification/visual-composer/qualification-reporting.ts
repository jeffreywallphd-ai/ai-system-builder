/** Internal test-run facts only. Never serialize the caught failure values. */
export interface QualificationEvidenceReport {
  status: string;
  failureStage?: string;
  finalizationStage?: "evidence-attach" | "evidence-save";
}

/** Attempt final publication once, with one bounded failed-write recovery. */
export async function finalizeQualificationEvidence(
  report: QualificationEvidenceReport,
  primaryFailures: readonly unknown[],
  save: () => Promise<void>,
  attach: () => Promise<unknown>,
): Promise<void> {
  const failures = [...primaryFailures];
  if (report.status !== "passed" && failures.length === 0) {
    failures.push(new Error("Qualification did not complete."));
  }
  if (failures.length) {
    report.status = "failed";
    report.failureStage ??= "journey";
  }
  const failed = (stage: "evidence-attach" | "evidence-save", error: unknown) => {
    failures.push(error);
    report.status = "failed";
    report.failureStage ??= stage;
    report.finalizationStage = stage;
  };
  // An attachment failure must change the status before final persistence.
  try { await attach(); } catch (error) { failed("evidence-attach", error); }
  try { await save(); } catch (error) {
    failed("evidence-save", error);
    // The caller retains its existing exclusive-create/ownership policy. A
    // refused or unavailable file cannot be overwritten to manufacture proof.
    try { await save(); } catch (retryError) { failures.push(retryError); }
  }
  if (failures.length) {
    throw new AggregateError(failures, "Qualification or evidence publication failed.");
  }
}
