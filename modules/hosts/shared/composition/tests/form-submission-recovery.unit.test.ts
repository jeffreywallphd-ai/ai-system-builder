import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { lstatSync, mkdtempSync, readFileSync, realpathSync, rmdirSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

test("a committed form record and its creation marker survive writer process exit without a second action", { timeout: 45_000 }, () => {
  const root = mkdtempSync(path.join(realpathSync(tmpdir()), "aisb-form-durable-"));
  const marker = path.join(root, ".owner");
  const owner = randomUUID();
  const child = fileURLToPath(new URL("./fixtures/form-submission-recovery-child.ts", import.meta.url));
  const keys = new Set(["path", "systemroot", "windir", "tmp", "temp", "tmpdir"]);
  const env = { ...Object.fromEntries(Object.entries(process.env).filter(([key]) => keys.has(key.toLowerCase()))),
    AISB_FORM_TEST_OWNER: owner, TSX_DISABLE_CACHE: "1" };
  try {
    writeFileSync(marker, owner, { flag: "wx", mode: 0o600 });
    const launch = (phase: "write" | "retry") => spawnSync(process.execPath, ["--import", "tsx", child, phase, root], {
      env, windowsHide: true, timeout: 20_000, maxBuffer: 4096, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
    });
    const write = launch("write");
    assert.equal(write.signal, null);
    assert.equal(write.status, 73, "The writer must stop after its transaction and before a receipt.");
    assert.ok(write.stdout === "", "The writer must emit no receipt.");
    const replay = launch("retry");
    assert.equal(replay.signal, null);
    assert.equal(replay.status, 0, "A fresh process must recognize the committed request.");
    assert.ok(replay.stdout === "durable replay confirmed\n", "The retry must emit only its fixed success marker.");
  } finally {
    assert.equal(realpathSync(root), root);
    const markerStat = lstatSync(marker);
    assert.ok(markerStat.isFile() && markerStat.nlink === 1 && markerStat.size === 36 &&
      realpathSync(marker) === marker && readFileSync(marker, "utf8") === owner, "The test must still own its profile.");
    const persistence = path.join(root, "persistence");
    if (lstatSync(persistence, { throwIfNoEntry: false })) {
      assert.equal(realpathSync(persistence), persistence);
      for (const suffix of ["", "-wal", "-shm", "-journal"]) {
        const file = path.join(persistence, "form-test.sqlite3" + suffix);
        const stat = lstatSync(file, { throwIfNoEntry: false });
        if (stat) { assert.ok(stat.isFile() && stat.nlink === 1 && realpathSync(file) === file); unlinkSync(file); }
      }
      rmdirSync(persistence);
    }
    unlinkSync(marker);
    rmdirSync(root);
  }
});
