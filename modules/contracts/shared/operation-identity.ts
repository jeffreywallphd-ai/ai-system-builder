const OPERATION_IDENTITY_SEGMENT_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export const OPERATION_IDENTITY_PATTERN =
  /^(?:[a-z0-9]+(?:-[a-z0-9]+)*)(?:\.(?:[a-z0-9]+(?:-[a-z0-9]+)*))+$/;

export const OPERATION_IDENTITY_FORMAT_DESCRIPTION =
  "lowercase dot-separated segments with at least two segments; segments allow a-z, 0-9, and internal hyphen";

export type OperationIdentity = `${Lowercase<string>}.${Lowercase<string>}`;

function invalidOperationIdentityMessage(value: string): string {
  return `Operation identity must use ${OPERATION_IDENTITY_FORMAT_DESCRIPTION}. Received "${value}".`;
}

export function isOperationIdentity(value: string): value is OperationIdentity {
  return OPERATION_IDENTITY_PATTERN.test(value);
}

export function normalizeOperationIdentity(value: string): OperationIdentity {
  const normalizedSegments = value
    .split(".")
    .map((segment) => segment.trim().toLowerCase());

  if (normalizedSegments.length < 2) {
    throw new Error(invalidOperationIdentityMessage(value));
  }

  for (const segment of normalizedSegments) {
    if (!OPERATION_IDENTITY_SEGMENT_PATTERN.test(segment)) {
      throw new Error(invalidOperationIdentityMessage(value));
    }
  }

  const normalizedValue = normalizedSegments.join(".");

  if (!isOperationIdentity(normalizedValue)) {
    throw new Error(invalidOperationIdentityMessage(value));
  }

  return normalizedValue;
}

export function createOperationIdentity(
  firstSegment: string,
  secondSegment: string,
  ...remainingSegments: readonly string[]
): OperationIdentity {
  return normalizeOperationIdentity(
    [firstSegment, secondSegment, ...remainingSegments].join("."),
  );
}
