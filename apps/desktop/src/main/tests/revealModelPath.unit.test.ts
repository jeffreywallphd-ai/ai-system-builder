import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import { createRevealModelPath } from "../revealModelPath";

test("reveals an absolute model path through the desktop shell", () => {
  const revealedPaths: string[] = [];
  const revealModelPath = createRevealModelPath({
    showItemInFolder(localPath) {
      revealedPaths.push(localPath);
    },
  });
  const localPath = path.resolve("models", "example");

  revealModelPath(localPath);

  assert.deepEqual(revealedPaths, [path.normalize(localPath)]);
});

test("rejects a relative model path without invoking the desktop shell", () => {
  let revealCalls = 0;
  const revealModelPath = createRevealModelPath({
    showItemInFolder() {
      revealCalls += 1;
    },
  });

  assert.throws(
    () => revealModelPath("models/example"),
    /absolute host path/,
  );
  assert.equal(revealCalls, 0);
});
