import type { ContextSourceInformation } from "../../../contracts/context-management";

const MAXIMUM_SOURCE_INFORMATION_CHARACTERS = 512;

export function projectContextSourceInformation(
  metadata: Readonly<Record<string, unknown>> | undefined,
): ContextSourceInformation | undefined {
  const author = firstText(metadata, ["author", "creator", "sourceAuthor"]);
  const license = firstText(metadata, ["license", "licenseId", "licenseName"]);
  const consent = firstText(metadata, [
    "consent",
    "consentStatus",
    "consentBasis",
  ]);
  const language = firstText(metadata, [
    "language",
    "languageCode",
    "lang",
  ])?.slice(0, 16);
  const sourceUrlCandidate = firstText(
    metadata,
    ["sourceUrl", "sourceUri", "url", "publicUrl"],
    2_048,
  );
  const sourceUrl = safeHttpUrl(sourceUrlCandidate);
  const projected = {
    ...(author ? { author } : {}),
    ...(license ? { license } : {}),
    ...(consent ? { consent } : {}),
    ...(sourceUrl ? { sourceUrl } : {}),
    ...(language ? { language } : {}),
  };
  return Object.keys(projected).length ? projected : undefined;
}

function firstText(
  metadata: Readonly<Record<string, unknown>> | undefined,
  keys: readonly string[],
  maximum = MAXIMUM_SOURCE_INFORMATION_CHARACTERS,
): string | undefined {
  for (const key of keys) {
    const value = metadata?.[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim().slice(0, maximum);
    }
  }
  return undefined;
}

function safeHttpUrl(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" || parsed.protocol === "http:"
      ? parsed.toString().slice(0, 2_048)
      : undefined;
  } catch {
    return undefined;
  }
}
