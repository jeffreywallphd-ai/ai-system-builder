import assert from "node:assert/strict";
import { test } from "node:test";
import type { DesktopSystemChangeWatermark } from "../../../../../../../modules/contracts/headless";
import { observeDesktopSavedSystems } from "./observeDesktopSavedSystems";

test("suppresses hidden and disposed replies, refreshes the first current result, and ignores duplicates", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let visible = true;
  const events = new EventTarget();
  const visibility = {
    get hidden() { return !visible; },
    addEventListener: events.addEventListener.bind(events),
    removeEventListener: events.removeEventListener.bind(events),
  };
  const requests: Array<(value: DesktopSystemChangeWatermark) => void> = [];
  let changes = 0;
  const dispose = observeDesktopSavedSystems({
    read: () => new Promise((resolve) => { requests.push(resolve); }),
    changed: () => { changes++; },
    visibility: visibility as Parameters<typeof observeDesktopSavedSystems>[0]["visibility"],
  });
  const ready = async (index: number, sequence: number) => {
    requests[index]!({ status: "ready", sequence });
    await Promise.resolve();
    await Promise.resolve();
  };
  try {
    assert.equal(requests.length, 1);
    visible = false;
    events.dispatchEvent(new Event("visibilitychange"));
    await ready(0, 1);
    t.mock.timers.tick(800);
    assert.equal(requests.length, 1);
    assert.equal(changes, 0);
    visible = true;
    events.dispatchEvent(new Event("visibilitychange"));
    await ready(1, 2);
    assert.equal(changes, 1);
    t.mock.timers.tick(400);
    await ready(2, 2);
    assert.equal(changes, 1);
    t.mock.timers.tick(400);
    await ready(3, 3);
    assert.equal(changes, 2);
    t.mock.timers.tick(400);
    dispose();
    await ready(4, 4);
    assert.equal(changes, 2);
    t.mock.timers.tick(10_000);
    assert.equal(requests.length, 5);
  } finally { dispose(); }
});
