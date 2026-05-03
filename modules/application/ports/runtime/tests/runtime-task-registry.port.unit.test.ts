import { describe, expectTypeOf, it } from "../../../../testing/node-test";

import type {
  CancelRuntimeTaskResult,
  RuntimeTaskListRequest,
  RuntimeTaskListResult,
  RuntimeTaskRecord,
  StartRuntimeTaskRequest,
  StartRuntimeTaskResult,
} from "../../../../contracts/runtime";
import type { RuntimeTaskRegistryPort } from "..";

describe("RuntimeTaskRegistryPort", () => {
  it("exposes start/read/cancel/list with generic runtime task contracts", () => {
    expectTypeOf<keyof RuntimeTaskRegistryPort>().toEqualTypeOf<
      "startTask" | "getTaskStatus" | "cancelTask" | "listTasks"
    >();

    expectTypeOf<Parameters<RuntimeTaskRegistryPort["startTask"]>[0]>().toExtend<StartRuntimeTaskRequest>();
    expectTypeOf<Awaited<ReturnType<RuntimeTaskRegistryPort["startTask"]>>>().toEqualTypeOf<StartRuntimeTaskResult>();

    expectTypeOf<Parameters<RuntimeTaskRegistryPort["getTaskStatus"]>[0]>().toEqualTypeOf<string>();
    expectTypeOf<Awaited<ReturnType<RuntimeTaskRegistryPort["getTaskStatus"]>>>().toEqualTypeOf<RuntimeTaskRecord>();

    expectTypeOf<Parameters<RuntimeTaskRegistryPort["cancelTask"]>[0]>().toEqualTypeOf<string>();
    expectTypeOf<Awaited<ReturnType<RuntimeTaskRegistryPort["cancelTask"]>>>().toEqualTypeOf<CancelRuntimeTaskResult>();

    expectTypeOf<Parameters<RuntimeTaskRegistryPort["listTasks"]>[0]>().toExtend<RuntimeTaskListRequest>();
    expectTypeOf<Awaited<ReturnType<RuntimeTaskRegistryPort["listTasks"]>>>().toEqualTypeOf<RuntimeTaskListResult>();
  });
});
