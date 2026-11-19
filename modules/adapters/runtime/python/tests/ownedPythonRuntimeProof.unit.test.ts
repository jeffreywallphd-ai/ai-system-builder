import assert from "node:assert/strict";
import { test } from "node:test";
import { createOwnedPythonRuntimeProof, OWNED_RUNTIME_READY_PREFIX } from "../supervisor/ownedPythonRuntimeProof";

const nonce = "a".repeat(64);
const endpoint = {host: "127.0.0.1", port: "43111"};
const frame = OWNED_RUNTIME_READY_PREFIX + nonce + " 127.0.0.1:43111\n";
test("proof accepts every split of one exact private stdout frame", () => {
  for (let split = 1; split < frame.length; split++) {
    const proof = createOwnedPythonRuntimeProof(nonce, endpoint);
    assert.equal(proof.push(Buffer.from(frame.slice(0, split))), false);
    assert.equal(proof.push(Buffer.from(frame.slice(split))), true);
  }
  assert.equal(createOwnedPythonRuntimeProof(nonce, endpoint).push(frame.replace("\n", "\r\n")), true);
});
test("wrong, unterminated, malformed and substring frames supply no proof", () => {
  for (const input of [frame.replace(nonce, "b".repeat(64)), frame.trim(), "prefix" + frame,
    frame.replace("\n", " \n"), frame.replace("V1", "V2"), frame.replace(":43111", ":43112"), JSON.stringify({proof: frame}) + "\n"]) {
    assert.equal(createOwnedPythonRuntimeProof(nonce, endpoint).push(input), false);
  }
  for (const value of ["", "a".repeat(63), "a".repeat(65), "G".repeat(64)]) {
    assert.throws(() => createOwnedPythonRuntimeProof(value, endpoint), /ownership proof is unavailable/);
  }
  for (const value of [{host: "0.0.0.0", port: "43111"}, {host: "127.0.0.1", port: "1023"}, {host: "127.0.0.1", port: "043111"}]) {
    assert.throws(() => createOwnedPythonRuntimeProof(nonce, value), /ownership endpoint is unavailable/);
  }
});
test("oversized line and chunk discard cannot be spliced into a valid proof", () => {
  const proof = createOwnedPythonRuntimeProof(nonce, endpoint);
  assert.equal(proof.push("x".repeat(129) + frame), false);
  assert.equal(proof.push("x".repeat(16385)), false);
  assert.equal(proof.push(frame), false);
  assert.equal(proof.push(frame), true);
  assert.equal(createOwnedPythonRuntimeProof(nonce, endpoint).push("ordinary startup output\n" + frame), true);
});
