export const USER_LIBRARY_PROPAGATION_POLICIES = [
  "pinned-version",
  "explicit-update",
] as const;

export type UserLibraryPropagationPolicy =
  (typeof USER_LIBRARY_PROPAGATION_POLICIES)[number];

export interface UserLibraryPropagationPolicySummary {
  readonly policy: UserLibraryPropagationPolicy;
  readonly selectedVersion?: string;
  readonly description?: string;
}

export function isUserLibraryPropagationPolicy(
  value: string,
): value is UserLibraryPropagationPolicy {
  return USER_LIBRARY_PROPAGATION_POLICIES.includes(
    value as UserLibraryPropagationPolicy,
  );
}

/**
 * Propagation policy is descriptive contract state only. It does not execute,
 * schedule, or imply update propagation by itself.
 */
export function normalizeUserLibraryPropagationPolicy(
  value: string,
): UserLibraryPropagationPolicy {
  const normalized = value.trim().toLowerCase();

  if (!isUserLibraryPropagationPolicy(normalized)) {
    const error = new Error(
      `User-library propagation policy must be one of ${USER_LIBRARY_PROPAGATION_POLICIES.join(", ")}.`,
    );
    error.stack = undefined;
    throw error;
  }

  return normalized;
}
