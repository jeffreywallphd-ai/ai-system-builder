export const PYTHON_INSTALLATION_FAILURES = ["missing", "unsupported", "incomplete"] as const;

export type DesktopStartupFailure = typeof PYTHON_INSTALLATION_FAILURES[number];

export function readDesktopStartupFailure(search: string): DesktopStartupFailure | undefined {
  const failure = new URLSearchParams(search).get("required-python");
  return PYTHON_INSTALLATION_FAILURES.find(value => value === failure);
}
