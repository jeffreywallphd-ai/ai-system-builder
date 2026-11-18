import {constants} from "node:fs";
import {lstat, open, realpath} from "node:fs/promises";
import path from "node:path";
import type {ContextResultOutputSourcePort} from "../../../../application/ports/context-management";
import {CONTEXT_GENERATION_LIMITS} from "../../../../contracts/context-management";

/** Cooperative read of an already owned task's private output. Selection is
 * internal, not a client path. No discovery, write, link, cleanup or adoption. */
export function createFilesystemContextResultOutputSourceAdapter(): ContextResultOutputSourcePort {
  return {readOutput(input) {
    const {runtimeDirectory, outputHandle, expectedSizeBytes} = input;
    return (async function* () {
      if (typeof runtimeDirectory !== "string" || !path.isAbsolute(runtimeDirectory) ||
          typeof outputHandle !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,200}$/.test(outputHandle) ||
          !Number.isSafeInteger(expectedSizeBytes) || expectedSizeBytes < 1 || expectedSizeBytes > CONTEXT_GENERATION_LIMITS.maximumArtifactBytes)
        throw new Error("The owned Context output is unavailable.");
      const directory = await lstat(runtimeDirectory);
      if (!directory.isDirectory() || directory.isSymbolicLink()) throw new Error("The owned Context output is unavailable.");
      const root = await realpath(runtimeDirectory), target = path.join(root, outputHandle);
      const selected = await lstat(target);
      if (!selected.isFile() || selected.isSymbolicLink() || selected.nlink !== 1 || selected.size !== expectedSizeBytes)
        throw new Error("The owned Context output is unavailable.");
      const resolved = await realpath(target);
      if (path.dirname(resolved) !== root) throw new Error("The owned Context output is unavailable.");
      const handle = await open(target, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
      try {
        const before = await handle.stat();
        if (!before.isFile() || before.nlink !== 1 || before.dev !== selected.dev || before.ino !== selected.ino || before.size !== expectedSizeBytes ||
            before.mtimeMs !== selected.mtimeMs || before.ctimeMs !== selected.ctimeMs)
          throw new Error("The owned Context output changed.");
        let total = 0;
        while (total <= expectedSizeBytes) {
          // Read at most one excess byte, never an unbounded readFile allocation.
          const buffer = new Uint8Array(Math.min(64 * 1024, expectedSizeBytes - total + 1));
          const {bytesRead} = await handle.read(buffer, 0, buffer.byteLength, total);
          if (bytesRead === 0) break;
          total += bytesRead;
          if (total > expectedSizeBytes) throw new Error("The owned Context output changed.");
          yield buffer.subarray(0, bytesRead);
        }
        const after = await handle.stat();
        if (total !== expectedSizeBytes || !after.isFile() || after.nlink !== 1 || after.dev !== before.dev || after.ino !== before.ino ||
            after.size !== before.size || after.mtimeMs !== before.mtimeMs || after.ctimeMs !== before.ctimeMs)
          throw new Error("The owned Context output changed.");
      } finally {await handle.close();}
    })();
  }};
}
