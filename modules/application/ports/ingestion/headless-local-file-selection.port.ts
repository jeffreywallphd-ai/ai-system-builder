import type { HeadlessLocalFileImportRequest, projectHeadlessLocalFileImport } from "../../../contracts/headless";
import type { OrganizationId } from "../../../contracts/organization";

export interface HeadlessLocalFileSelection {
  readonly organizationId: OrganizationId;
  readonly principalId: string;
  readonly registeredClientId: string;
  readonly target: HeadlessLocalFileImportRequest["input"];
}

export interface HeadlessLocalFileSelectionPort {
  /** Record an app user's exact selection in the owning organization. */
  record(selection: HeadlessLocalFileSelection, expectedRevision: number, isCurrent: () => boolean): Promise<number | undefined>;
  /** An unselected or differently scoped source returns false without exposing the record. */
  matches(selection: HeadlessLocalFileSelection): Promise<boolean>;
  /** Observe the selection and current staged upload in the same owned read. */
  observe(selection: HeadlessLocalFileSelection): Promise<ReturnType<typeof projectHeadlessLocalFileImport> | undefined>;
}
