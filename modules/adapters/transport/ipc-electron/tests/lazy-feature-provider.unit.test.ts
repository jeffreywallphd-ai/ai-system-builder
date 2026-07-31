import { describe, expect, it, testDouble } from "../../../../testing/node-test";

import { lazyProvidedObject } from "../lazyFeatureProvider";

describe("lazyProvidedObject", () => {
  it("marks a disposable feature released after a successful method call", async () => {
    const afterCall = testDouble.fn();
    const feature = {
      useCase: {
        async execute(input: string) {
          return `ok:${input}`;
        },
      },
    };

    const useCase = lazyProvidedObject(async () => feature, (value) => value.useCase, { afterCall });
    const result = await useCase.execute("demo");

    expect(result).toBe("ok:demo");
    expect(afterCall).toHaveBeenCalledWith("execute");
  });

  it("marks a disposable feature released after a failed method call without swallowing the error", async () => {
    const afterCall = testDouble.fn();
    const feature = {
      useCase: {
        async execute() {
          throw new Error("boom");
        },
      },
    };

    const useCase = lazyProvidedObject(async () => feature, (value) => value.useCase, { afterCall });

    await expect(useCase.execute()).rejects.toThrow("boom");
    expect(afterCall).toHaveBeenCalledWith("execute");
  });

  it("does not let lifecycle release hook failures change the IPC method result", async () => {
    const feature = {
      useCase: {
        async execute() {
          return "ok";
        },
      },
    };

    const useCase = lazyProvidedObject(async () => feature, (value) => value.useCase, {
      afterCall: () => { throw new Error("release failed"); },
    });

    const result = await useCase.execute();

    expect(result).toBe("ok");
  });

});
