import type { AssetMetadata } from "../../../contracts/asset";
import type { UserLibraryDiagnostic } from "../../../contracts/user-library";

const UNSAFE_METADATA_PATTERN = /(path|storage|provider|payload|prompt|workflow|token|stack|command|env|base64|blob|bytes|secret|key|signed|url|locator)/i;

export function containsUnsafeUserLibraryUseCaseMetadata(metadata: AssetMetadata | undefined): boolean {
  if (!metadata) return false;
  return UNSAFE_METADATA_PATTERN.test(JSON.stringify(metadata));
}

export function sanitizeUserLibraryUseCaseMetadata(metadata: AssetMetadata | undefined): AssetMetadata | undefined {
  return containsUnsafeUserLibraryUseCaseMetadata(metadata) ? undefined : metadata;
}

export function createUserLibraryDiagnostic(
  severity: UserLibraryDiagnostic["severity"],
  code: string,
  message: string,
): UserLibraryDiagnostic {
  return { severity, code, message };
}
