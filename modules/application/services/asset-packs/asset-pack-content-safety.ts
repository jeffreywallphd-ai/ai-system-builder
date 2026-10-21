// Actual representations, rather than a ban on explanatory security vocabulary.
// Keep this pure admission predicate separate from lossy display sanitization.
const PRIVATE_KEY = /-----BEGIN (?:RSA |EC |OPENSSH |ENCRYPTED )?PRIVATE KEY-----/i;
const CREDENTIAL = /\b(?:sk[-_]|ghp_|github_pat_|hf_)[A-Za-z0-9_-]{16,}\b/;

export function hasActualAssetPackCredential(value: string): boolean {
  return PRIVATE_KEY.test(value) || CREDENTIAL.test(value);
}
