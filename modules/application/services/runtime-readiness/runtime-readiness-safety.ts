export const sanitizeRuntimeReadinessMessage = (value: unknown): string => {
  const raw = typeof value === "string" ? value : "runtime inventory source unavailable";
  if (/(secret|token|password|api[_-]?key|private[_-]?key|path|stack|trace|command|shell|env|payload|prompt|workflow|graph|base64|signed\s*url|bytes?)/i.test(raw)) {
    return "runtime inventory source unavailable";
  }
  return raw.slice(0, 160);
};
