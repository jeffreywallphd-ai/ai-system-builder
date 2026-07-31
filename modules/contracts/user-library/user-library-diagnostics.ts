import type { AssetMetadata } from "../asset";

export const USER_LIBRARY_DIAGNOSTIC_SEVERITIES = [
  "info",
  "warning",
  "error",
] as const;

export type UserLibraryDiagnosticSeverity =
  (typeof USER_LIBRARY_DIAGNOSTIC_SEVERITIES)[number];

export interface UserLibraryDiagnostic {
  readonly severity: UserLibraryDiagnosticSeverity;
  readonly code: string;
  readonly message: string;
  readonly safeDetails?: AssetMetadata;
}

export const USER_LIBRARY_FAILURE_CODES = [
  "validation",
  "not-found",
  "conflict",
  "unavailable",
  "permission-denied",
  "unauthorized",
  "internal",
] as const;

export type UserLibraryFailureCode = (typeof USER_LIBRARY_FAILURE_CODES)[number];

export interface UserLibraryFailure {
  readonly code: UserLibraryFailureCode;
  readonly message: string;
  readonly diagnostics?: readonly UserLibraryDiagnostic[];
  readonly safeDetails?: AssetMetadata;
}

export function isUserLibraryFailureCode(value: string): value is UserLibraryFailureCode {
  return USER_LIBRARY_FAILURE_CODES.includes(value as UserLibraryFailureCode);
}
