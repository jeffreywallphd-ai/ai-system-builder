import { describe, expect, it } from "../../testing/node-test";

import { isLogLevel, LOG_LEVELS } from "./log-level";
import {
  isLogVerbosity,
  LOG_VERBOSITIES,
  resolveLogVerbosity,
} from "./log-verbosity";

describe("logging contracts", () => {
  it("exposes a stable shared log level vocabulary", () => {
    expect(LOG_LEVELS).toEqual([
      "trace",
      "debug",
      "info",
      "warn",
      "error",
      "fatal",
    ]);
    expect(isLogLevel("info")).toBe(true);
    expect(isLogLevel("verbose")).toBe(false);
  });

  it("exposes shared verbosity vocabulary and resolves normalized config values", () => {
    expect(LOG_VERBOSITIES).toEqual(["minimal", "normal", "verbose", "trace"]);
    expect(isLogVerbosity("normal")).toBe(true);
    expect(isLogVerbosity("debug")).toBe(false);

    expect(resolveLogVerbosity(" VERBOSE ")).toBe("verbose");
    expect(resolveLogVerbosity(undefined)).toBe("normal");
    expect(resolveLogVerbosity("invalid", "minimal")).toBe("minimal");
  });
});
