import type { SystemFormRoute, SystemFormValue } from "./system-builder-form-route";

export interface SystemFormField {
  readonly id: string;
  readonly label: string;
  readonly helpText: string;
  readonly kind: "text" | "multiline" | "choice" | "number" | "date-time" | "checkbox";
  readonly required: boolean;
  readonly options: readonly { readonly label: string; readonly value: string }[];
  readonly choicePresentation?: "radio";
  readonly min?: number;
  readonly max?: number;
  readonly dateKind: "date" | "time" | "date-time";
  readonly earliest?: string;
  readonly latest?: string;
}

export interface SystemFormStep {
  readonly id: string;
  readonly label: string;
  readonly fields: readonly SystemFormField[];
  readonly conditions: readonly SystemFormRoute[];
  readonly defaultDestinationId: string;
}

export interface PublishedSystemForm {
  readonly id: string;
  readonly title: string;
  readonly steps: readonly SystemFormStep[];
}

export interface PublishedSystemFormsInput {
  readonly workspaceId: string;
  readonly releaseId: string;
}

export interface PublishedSystemFormSubmitInput extends PublishedSystemFormsInput {
  readonly formId: string;
  readonly submissionId: string;
  readonly answers: Readonly<Record<string, SystemFormValue>>;
}

export type SystemFormSubmitResult =
  | { readonly status: "completed" | "already-recorded" | "pending"; readonly receiptId: string }
  | { readonly status: "unavailable" | "denied" | "invalid"; readonly fieldId?: string };
