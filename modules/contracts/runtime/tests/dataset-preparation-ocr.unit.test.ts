import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DATASET_PREPARATION_OCR_CAPABILITY,
  isDatasetPreparationOcrArtifactId,
  isDatasetPreparationOcrLanguage,
  supportsDatasetPreparationOcr,
  resolveDatasetPreparationOcrChoice,
} from "../dataset-preparation-ocr";

test("OCR language syntax is explicit and does not guess installed support", () => {
  for (const value of ["en", "en-US", "zh-Hans-CN", "fra", "en-us"]) {
    assert.equal(isDatasetPreparationOcrLanguage(value), true, value);
  }
  for (const value of [undefined, null, true, "", "English", " en-US", "en_US", "en-US\n", "en-1", "en-123456789", "a", "abcd"]) {
    assert.equal(isDatasetPreparationOcrLanguage(value), false, String(value));
  }
});

test("only an explicit valid OCR choice creates public content settings", () => {
  const input = { enabled: true, language: "en-US", method: "structure-aware", sourceCount: 2, sourceFormats: ["pdf", "pdf"] };
  assert.deepEqual(resolveDatasetPreparationOcrChoice(input), {
    ok: true, content: { ocrEnabled: true, ocrLanguage: "en-US" },
  });
  for (const enabled of [undefined, false]) {
    assert.deepEqual(resolveDatasetPreparationOcrChoice({ ...input, enabled, language: "private stale value" }), { ok: true });
  }
  for (const enabled of ["true", "false", 1, null, {}, []]) {
    assert.equal(resolveDatasetPreparationOcrChoice({ ...input, enabled }).ok, false);
  }
});

test("OCR form validation refuses incompatible or incomplete source selections", () => {
  const input = { enabled: true, language: "en-US", method: "structure-aware", sourceCount: 1, sourceFormats: ["pdf"] };
  for (const patch of [
    { method: "topic-aware" }, { method: undefined }, { sourceCount: 0 }, { sourceCount: 257 },
    { sourceCount: 1.5 }, { sourceCount: NaN }, { sourceCount: 2 }, { sourceFormats: [] },
    { sourceFormats: ["pdf", "text"] }, { sourceFormats: ["docx"] }, { sourceFormats: undefined },
    { language: "" }, { language: "English" }, { language: " en-US" }, { language: "en_US" },
    { language: 1 },
  ]) assert.equal(resolveDatasetPreparationOcrChoice({ ...input, ...patch }).ok, false);
  assert.equal(resolveDatasetPreparationOcrChoice({ ...input, sourceCount: 256, sourceFormats: Array(256).fill("pdf") }).ok, true);
});

test("OCR artifact identifiers match the native reader without changing Unicode ids", () => {
  assert.equal(isDatasetPreparationOcrArtifactId("workspace/document-\u{1f642}"), true);
  assert.equal(isDatasetPreparationOcrArtifactId("a".repeat(512)), true);
  for (const value of [undefined, null, 1, "", "a".repeat(513), "private\nline", "\u0000", "bad\ud800id"]) {
    assert.equal(isDatasetPreparationOcrArtifactId(value), false);
  }
});

test("only an exact declared OCR protocol grants protocol support", () => {
  assert.equal(supportsDatasetPreparationOcr(["prepare-training-dataset", DATASET_PREPARATION_OCR_CAPABILITY]), true);
  for (const value of [undefined, null, DATASET_PREPARATION_OCR_CAPABILITY, [], ["prepare-training-dataset"],
    [DATASET_PREPARATION_OCR_CAPABILITY + " "], [DATASET_PREPARATION_OCR_CAPABILITY.replace("v1", "v2")],
    [DATASET_PREPARATION_OCR_CAPABILITY, 1]]) {
    assert.equal(supportsDatasetPreparationOcr(value), false);
  }
});
