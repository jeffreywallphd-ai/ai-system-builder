import { describe, expect, it, testDouble } from "../../../../testing/node-test";

import { createLoggingConfig } from "../../../../contracts/config";
import type { StructuredLogEvent } from "../../../../contracts/logging";

import { createLogger } from "../createLogger";

describe("createLogger", () => {
  it("emits structured events through the configured sink", async () => {
    const sink = testDouble.fn();
    const logger = createLogger({
      host: "desktop",
      component: "upload-use-case",
      config: createLoggingConfig({
        verbosity: "trace",
        level: "debug",
      }),
      sink,
    });

    const event: StructuredLogEvent = {
      timestamp: "2026-04-14T12:00:00.000Z",
      level: "info",
      verbosity: "normal",
      event: "upload.started",
      message: "Upload started",
      component: "",
      useCase: "store-artifact-upload",
    };

    await logger.log(event);

    expect(sink).toHaveBeenCalledOnce();

    const [serializedEvent, emittedEvent] = sink.mock.calls[0] as [string, StructuredLogEvent];
    expect(emittedEvent).toEqual({
      ...event,
      component: "upload-use-case",
      host: "desktop",
    });
    expect(JSON.parse(serializedEvent)).toEqual(emittedEvent);
  });

  it("filters events based on configured level and verbosity", async () => {
    const sink = testDouble.fn();
    const logger = createLogger({
      config: createLoggingConfig({
        verbosity: "normal",
        level: "warn",
      }),
      sink,
    });

    await logger.log({
      timestamp: "2026-04-14T12:00:00.000Z",
      level: "info",
      verbosity: "normal",
      event: "upload.started",
      message: "Upload started",
      component: "upload-use-case",
    });
    await logger.log({
      timestamp: "2026-04-14T12:00:01.000Z",
      level: "error",
      verbosity: "verbose",
      event: "upload.failed",
      message: "Upload failed",
      component: "upload-use-case",
    });
    await logger.log({
      timestamp: "2026-04-14T12:00:02.000Z",
      level: "error",
      verbosity: "minimal",
      event: "upload.failed",
      message: "Upload failed",
      component: "upload-use-case",
    });

    expect(sink).toHaveBeenCalledTimes(1);
    const [, emittedEvent] = sink.mock.calls[0] as [string, StructuredLogEvent];
    expect(emittedEvent.event).toBe("upload.failed");
  });

  it("handles sink failures without throwing through the application seam", async () => {
    const sink = testDouble.fn().mockRejectedValue(new Error("sink unavailable"));
    const consoleErrorSpy = testDouble.spyOn(console, "error").mockImplementation(() => undefined);

    const logger = createLogger({
      host: "desktop",
      sink,
    });

    await expect(
      logger.log({
        timestamp: "2026-04-14T12:00:00.000Z",
        level: "error",
        verbosity: "normal",
        event: "upload.failed",
        message: "Upload failed",
        component: "upload-use-case",
      }),
    ).resolves.toBeUndefined();

    expect(consoleErrorSpy).toHaveBeenCalledOnce();
    const failureEvent = JSON.parse(consoleErrorSpy.mock.calls[0][0] as string);
    expect(failureEvent).toMatchObject({
      level: "error",
      event: "observability.logging.write_failed",
      component: "observability-logger",
      host: "desktop",
    });

    expect(JSON.stringify(failureEvent)).not.toContain("sink unavailable");
    consoleErrorSpy.mockRestore();
  });
});

it("contains normalization, serialization and fallback failures without disclosing payloads", async () => {
  const sink = testDouble.fn();
  const spy = testDouble.spyOn(console, "error").mockImplementation(() => { throw new Error("console unavailable"); });
  const logger = createLogger({ sink });
  const base = { timestamp: "now", component: "test", level: "error", verbosity: "normal", event: "test", message: "safe" } as StructuredLogEvent;
  const cyclic: any = {}; cyclic.self = cyclic;
  try {
    for (const event of [{ ...base, timestamp: undefined }, { ...base, data: cyclic }, { ...base, data: { value: 1n } }]) {
      await expect(logger.log(event as never)).resolves.toBeUndefined();
    }
    expect(sink).not.toHaveBeenCalled();
  } finally { spy.mockRestore(); }
});
