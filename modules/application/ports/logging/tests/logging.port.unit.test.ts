import { describe, expect, expectTypeOf, it, testDouble } from "../../../../testing/node-test";

import type { StructuredLogEvent } from "../../../../contracts/logging";

import type { LoggingPort } from "../logging.port";

describe("LoggingPort", () => {
  it("keeps a narrow seam with only the log operation", () => {
    expectTypeOf<keyof LoggingPort>().toEqualTypeOf<"log">();
  });

  it("requires shared StructuredLogEvent input and supports async adapters", async () => {
    const log = testDouble.fn<LoggingPort["log"]>().mockResolvedValue(undefined);
    const port: LoggingPort = { log };

    const event: StructuredLogEvent = {
      timestamp: "2026-04-14T12:00:00.000Z",
      level: "info",
      verbosity: "normal",
      event: "runtime.execution.completed",
      message: "Execution completed",
      component: "runtime-adapter",
    };

    await port.log(event);

    expect(log).toHaveBeenCalledWith(event);
    expectTypeOf<Parameters<LoggingPort["log"]>[0]>().toExtend<StructuredLogEvent>();
  });
});
