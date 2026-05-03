import { describe, expect, it, testDouble } from "../../../../testing/node-test";

import { TaskType } from "../../../../contracts/runtime";
import { createElectronPowerSuspensionBlocker } from "../createElectronPowerSuspensionBlocker";

describe("createElectronPowerSuspensionBlocker", () => {
  function createFakePowerSaveBlocker() {
    let currentId = 0;
    const active = new Set<number>();

    return {
      start: testDouble.fn<(type: "prevent-app-suspension") => number>().mockImplementation(() => {
        currentId += 1;
        active.add(currentId);
        return currentId;
      }),
      stop: testDouble.fn<(id: number) => void>().mockImplementation((id) => {
        active.delete(id);
      }),
      isStarted: testDouble.fn<(id: number) => boolean>().mockImplementation((id) => active.has(id)),
    };
  }

  it("starts with prevent-app-suspension and stores metadata", async () => {
    const fake = createFakePowerSaveBlocker();
    const port = createElectronPowerSuspensionBlocker({
      powerSaveBlocker: fake,
      createBlockerId: () => "blocker-1",
    });

    const started = await port.startBlocker("dataset preparation", { requestId: "req-1", taskType: TaskType.DATASET_PREPARATION });

    expect(fake.start).toHaveBeenCalledWith("prevent-app-suspension");
    expect(started).toEqual({ blockerId: "blocker-1", active: true });
    expect(await port.listBlockers()).toEqual([
      {
        blockerId: "blocker-1",
        reason: "dataset preparation",
        requestId: "req-1",
        taskType: TaskType.DATASET_PREPARATION,
        active: true,
      },
    ]);
  });

  it("stops only the matching blocker and is idempotent", async () => {
    const fake = createFakePowerSaveBlocker();
    const port = createElectronPowerSuspensionBlocker({
      powerSaveBlocker: fake,
      createBlockerId: (() => {
        const ids = ["blocker-a", "blocker-b"];
        return () => ids.shift() ?? "extra";
      })(),
    });

    await port.startBlocker("task a");
    await port.startBlocker("task b");

    expect(await port.stopBlocker("blocker-a")).toEqual({ blockerId: "blocker-a", active: false });
    expect(fake.stop).toHaveBeenCalledTimes(1);
    expect(fake.stop).toHaveBeenCalledWith(1);

    expect(await port.stopBlocker("blocker-a")).toEqual({ blockerId: "blocker-a", active: false });
    expect(fake.stop).toHaveBeenCalledTimes(1);
    expect(await port.listBlockers()).toEqual([
      {
        blockerId: "blocker-b",
        reason: "task b",
        active: true,
        requestId: undefined,
        taskType: undefined,
      },
    ]);
  });

  it("supports multiple active blockers and selective stop", async () => {
    const fake = createFakePowerSaveBlocker();
    const ids = ["one", "two", "three"];
    const port = createElectronPowerSuspensionBlocker({
      powerSaveBlocker: fake,
      createBlockerId: () => ids.shift() ?? "fallback",
    });

    await port.startBlocker("train");
    await port.startBlocker("validate");
    await port.startBlocker("publish");

    await port.stopBlocker("two");
    const active = await port.listBlockers();
    expect(active.map((entry) => entry.blockerId)).toEqual(["one", "three"]);
    expect(fake.stop).toHaveBeenCalledWith(2);
  });


  it("stopping non-existent blocker does not throw", async () => {
    const fake = createFakePowerSaveBlocker();
    const port = createElectronPowerSuspensionBlocker({ powerSaveBlocker: fake });
    expect(await port.stopBlocker("missing")).toEqual({ blockerId: "missing", active: false });
  });

  it("stopping already stopped blocker remains idempotent", async () => {
    const fake = createFakePowerSaveBlocker();
    const port = createElectronPowerSuspensionBlocker({ powerSaveBlocker: fake, createBlockerId: () => "one" });
    await port.startBlocker("task");
    await port.stopBlocker("one");
    expect(await port.stopBlocker("one")).toEqual({ blockerId: "one", active: false });
    expect(fake.stop).toHaveBeenCalledTimes(1);
  });

  it("listBlockers reflects powerSaveBlocker.isStarted state", async () => {
    const fake = createFakePowerSaveBlocker();
    const port = createElectronPowerSuspensionBlocker({ powerSaveBlocker: fake, createBlockerId: () => "one" });
    await port.startBlocker("task");
    fake.stop(1);
    expect(await port.listBlockers()).toEqual([]);
  });

  it("throws clear error when powerSaveBlocker is unavailable", async () => {
    const port = createElectronPowerSuspensionBlocker();
    await expect(port.startBlocker("long-task")).rejects.toThrow("powerSaveBlocker is unavailable");
  });
});
