export const EXTERNAL_SUBJECT_MAX_LENGTH = 255;
export const EXTERNAL_ISSUER_MAX_LENGTH = 2048;

export interface ExternalSubjectIdentity {
  readonly issuer: string;
  readonly subject: string;
}

export function createExternalSubjectIdentity(input: {
  issuer: string;
  subject: string;
}): ExternalSubjectIdentity {
  const issuer = input.issuer.trim();
  const subject = input.subject.trim();
  let parsedIssuer: URL;
  try {
    parsedIssuer = new URL(issuer);
  } catch {
    throw invalidExternalIdentityError();
  }
  if (
    issuer !== input.issuer ||
    issuer.length > EXTERNAL_ISSUER_MAX_LENGTH ||
    parsedIssuer.protocol !== "https:" ||
    parsedIssuer.username.length > 0 ||
    parsedIssuer.password.length > 0 ||
    parsedIssuer.search.length > 0 ||
    parsedIssuer.hash.length > 0 ||
    subject !== input.subject ||
    subject.length === 0 ||
    subject.length > EXTERNAL_SUBJECT_MAX_LENGTH ||
    !/^[\x20-\x7E]+$/.test(subject)
  ) {
    throw invalidExternalIdentityError();
  }
  return { issuer, subject };
}

function invalidExternalIdentityError(): Error {
  const error = new Error(
    "External identity requires an exact HTTPS issuer without credentials, query, or fragment and a non-empty ASCII subject.",
  );
  error.stack = undefined;
  return error;
}
