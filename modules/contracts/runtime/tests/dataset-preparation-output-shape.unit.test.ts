import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  compileDatasetPreparationVisualOutputShape,
  createDefaultDatasetPreparationVisualOutputShape,
  listDatasetPreparationAvailableOutputPurposes,
  listDatasetPreparationRequiredOutputPurposes,
  resolveDatasetPreparationVisualOutputShape,
  type DatasetPreparationVisualOutputShape,
} from "../dataset-preparation-output-shape";
import {
  DATASET_PREPARATION_TASK_TYPES,
  DATASET_PREPARATION_TEXT_GENERATION_TASK_TYPES,
  resolveDefaultDatasetPreparationPromptTemplate,
} from "../dataset-preparation";

const compile = (
  shape: unknown,
  taskType: (typeof DATASET_PREPARATION_TASK_TYPES)[number],
  options: {
    outputFormat?: "jsonl" | "json" | "csv" | "parquet";
    multiLabel?: boolean;
    allowedLabels?: readonly string[];
  } = {},
) => compileDatasetPreparationVisualOutputShape(shape, { taskType, ...options });

const diagnosticCodes = (
  result: ReturnType<typeof compileDatasetPreparationVisualOutputShape>,
) => result.diagnostics.map((diagnostic) => diagnostic.code);

describe("dataset preparation visual output shapes", () => {
  it("compiles a backward-compatible exact default for every training task", () => {
    for (const taskType of DATASET_PREPARATION_TASK_TYPES) {
      const shape = createDefaultDatasetPreparationVisualOutputShape(taskType);
      const result = compile(shape, taskType);

      assert.equal(result.ok, true, `${taskType} should compile`);
      if (!result.ok) continue;
      assert.equal(result.value.shape.taskType, taskType);
      assert.equal(
        result.value.payloadKey,
        taskType.startsWith("llm-") ? "example" : "value",
      );
      assert.equal(result.value.envelopeSchema.additionalProperties, false);
      assert.equal(result.value.exampleSchema.additionalProperties, false);
      assert.equal(result.value.exampleEnvelope.status, "ok");
      assert.ok(
        result.value.exampleEnvelope[result.value.payloadKey],
        `${taskType} should have a visible format example`,
      );
    }
  });

  it("pairs every generation system prompt with a complete default schema", () => {
    assert.deepEqual(
      [...DATASET_PREPARATION_TEXT_GENERATION_TASK_TYPES].sort(),
      [...DATASET_PREPARATION_TASK_TYPES].sort(),
    );
    for (const taskType of DATASET_PREPARATION_TEXT_GENERATION_TASK_TYPES) {
      const prompt = resolveDefaultDatasetPreparationPromptTemplate(taskType);
      const result = compile(
        createDefaultDatasetPreparationVisualOutputShape(taskType),
        taskType,
        { outputFormat: "parquet" },
      );
      assert.ok(prompt, `${taskType} should have example instructions`);
      assert.match(prompt, /^You generate /);
      assert.match(prompt, /structured output schema exactly/i);
      assert.match(prompt, /no text before or after/i);
      assert.equal(result.ok, true, `${taskType} should have a visible schema`);
      if (!result.ok) continue;
      for (const purpose of listDatasetPreparationRequiredOutputPurposes(
        taskType,
      )) {
        assert.ok(
          result.value.purposePaths[purpose],
          `${taskType} should map ${purpose}`,
        );
      }
    }
    const instructionPrompt = resolveDefaultDatasetPreparationPromptTemplate(
      "llm-instruction",
    ) ?? "";
    assert.match(instructionPrompt, /Copy the configured Instruction value exactly/);
    assert.match(instructionPrompt, /do not create, summarize, or rewrite it/);
    assert.doesNotMatch(instructionPrompt, /write a concise instruction/i);
  });

  it("resolves omitted layouts to task defaults without changing saved layouts", () => {
    const fallback = resolveDatasetPreparationVisualOutputShape(
      "llm-classification",
      undefined,
      { multiLabel: true },
    );
    assert.equal(fallback.source, "default");
    assert.equal(fallback.shape.fields[0]?.kind, "text-list");

    const saved = createDefaultDatasetPreparationVisualOutputShape(
      "llm-classification",
    );
    saved.fields[0]!.name = "sentiment";
    const resolved = resolveDatasetPreparationVisualOutputShape(
      "llm-classification",
      saved,
    );
    assert.equal(resolved.source, "saved");
    assert.equal(resolved.shape, saved);
  });

  it("uses the configured labels for single- and multi-label schemas", () => {
    const single = compile(
      createDefaultDatasetPreparationVisualOutputShape("llm-classification"),
      "llm-classification",
      { allowedLabels: ["positive", "negative"] },
    );
    assert.equal(single.ok, true);
    if (single.ok) {
      assert.deepEqual(
        (single.value.exampleSchema.properties as Record<string, unknown>).label,
        {
          type: "string",
          minLength: 1,
          maxLength: 120,
          enum: ["positive", "negative"],
        },
      );
      assert.equal(
        (single.value.exampleEnvelope.example as Record<string, unknown>).label,
        "positive",
      );
    }

    const multi = compile(
      createDefaultDatasetPreparationVisualOutputShape(
        "llm-classification",
        { multiLabel: true },
      ),
      "llm-classification",
      { multiLabel: true, allowedLabels: ["a", "b"] },
    );
    assert.equal(multi.ok, true);
    if (multi.ok) {
      const label = (
        multi.value.exampleSchema.properties as Record<
          string,
          Record<string, unknown>
        >
      ).label;
      assert.deepEqual(
        (label.items as Record<string, unknown>).enum,
        ["a", "b"],
      );
    }
  });

  it("keeps Thought optional and text-only for instruction tuning", () => {
    assert.ok(
      listDatasetPreparationAvailableOutputPurposes(
        "llm-instruction",
      ).includes("thought"),
    );
    assert.ok(
      !listDatasetPreparationRequiredOutputPurposes(
        "llm-instruction",
      ).includes("thought"),
    );
    assert.ok(
      listDatasetPreparationAvailableOutputPurposes(
        "llm-instruction",
      ).includes("context"),
    );
    const shape = createDefaultDatasetPreparationVisualOutputShape(
      "llm-instruction",
    );
    assert.deepEqual(
      shape.fields.map((field) => field.purpose),
      ["instruction", "input", "context", "output"],
    );
    shape.fields.push({
      id: "thought",
      name: "thought",
      kind: "text",
      required: true,
      purpose: "thought",
      example: "Connect the supporting evidence to the answer.",
    });
    const result = compile(shape, "llm-instruction");
    assert.equal(result.ok, true);
    if (result.ok) {
      assert.deepEqual(result.value.purposePaths.thought, ["thought"]);
      assert.deepEqual(result.value.purposePaths.context, ["context"]);
      assert.equal(
        (result.value.exampleEnvelope.example as Record<string, unknown>)
          .thought,
        "Connect the supporting evidence to the answer.",
      );
      assert.deepEqual(result.value.exampleEnvelope.example, {
        instruction: "Answer the input using only the provided context.",
        input: "When does the city library close on weekdays?",
        context: "The city library closes at 6:00 PM on weekdays.",
        output: "The city library closes at 6:00 PM on weekdays.",
        thought: "Connect the supporting evidence to the answer.",
      });
    }

    shape.fields[shape.fields.length - 1]!.kind = "number";
    const incompatible = compile(shape, "llm-instruction");
    assert.equal(incompatible.ok, false);
    assert.ok(
      diagnosticCodes(incompatible).includes("purpose-incompatible"),
    );
  });

  it("fixes Instruction to its configured value while other examples remain guidance", () => {
    const shape = createDefaultDatasetPreparationVisualOutputShape(
      "llm-instruction",
    );
    shape.fields[0]!.choices = ["legacy-choice"];
    shape.fields[1]!.example = "Exact example source passage.";
    const result = compile(shape, "llm-instruction");

    assert.equal(result.ok, true);
    if (!result.ok) return;
    const properties = result.value.exampleSchema.properties as Record<
      string,
      Record<string, unknown>
    >;
    assert.equal(properties.instruction.enum, undefined);
    assert.equal(
      properties.instruction.const,
      "Answer the input using only the provided context.",
    );
    assert.equal(result.value.shape.fields[0]!.choices, undefined);
    assert.equal(
      (result.value.exampleEnvelope.example as Record<string, unknown>).input,
      "Exact example source passage.",
    );
  });

  it("rejects malformed or oversized sample values before generation", () => {
    const numberShape = createDefaultDatasetPreparationVisualOutputShape(
      "llm-instruction",
    );
    numberShape.fields.push({
      id: "score",
      name: "score",
      kind: "number",
      required: false,
      example: "not-a-number",
    });
    const invalidNumber = compile(numberShape, "llm-instruction");
    assert.equal(invalidNumber.ok, false);
    assert.ok(
      diagnosticCodes(invalidNumber).includes("field-example-invalid"),
    );

    const extraction =
      createDefaultDatasetPreparationVisualOutputShape("llm-extraction");
    extraction.fields[0]!.example = '{"nested":{"not":"supported"}}';
    const invalidObject = compile(extraction, "llm-extraction");
    assert.equal(invalidObject.ok, false);
    assert.ok(
      diagnosticCodes(invalidObject).includes("field-example-invalid"),
    );
  });

  it("compiles renamed and nested fields deterministically with training-purpose paths", () => {
    const shape: DatasetPreparationVisualOutputShape = {
      schemaVersion: "1",
      taskType: "llm-extraction",
      fields: [
        {
          id: "result",
          name: "result",
          kind: "group",
          required: true,
          purpose: "expected-output",
          children: [
            {
              id: "company-name",
              name: "companyName",
              kind: "text",
              required: true,
            },
            {
              id: "founded-year",
              name: "foundedYear",
              kind: "number",
              required: false,
            },
          ],
        },
      ],
    };

    const first = compile(shape, "llm-extraction", { outputFormat: "parquet" });
    const second = compile(
      JSON.parse(JSON.stringify(shape)),
      "llm-extraction",
      { outputFormat: "parquet" },
    );
    assert.equal(first.ok, true);
    assert.equal(second.ok, true);
    if (first.ok && second.ok) {
      assert.deepEqual(first.value.purposePaths["expected-output"], ["result"]);
      assert.equal(first.value.decoderCompatible, true);
      assert.equal(
        first.value.canonicalFingerprintMaterial,
        second.value.canonicalFingerprintMaterial,
      );
    }
  });

  it("keeps legacy free-form extraction usable but marks it decoder-incompatible", () => {
    const result = compile(
      createDefaultDatasetPreparationVisualOutputShape("llm-extraction"),
      "llm-extraction",
      { outputFormat: "parquet" },
    );

    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.value.decoderCompatible, false);
    assert.ok(diagnosticCodes(result).includes("decoder-dynamic-record-unsupported"));
  });

  it("rejects nested layouts for CSV before generation", () => {
    const shape = createDefaultDatasetPreparationVisualOutputShape(
      "llm-extraction",
    );
    const result = compile(shape, "llm-extraction", { outputFormat: "csv" });

    assert.equal(result.ok, false);
    assert.ok(diagnosticCodes(result).includes("nested-csv-unsupported"));
  });

  it("rejects protected, unsafe, duplicate, and malformed field identities", () => {
    const base = createDefaultDatasetPreparationVisualOutputShape(
      "llm-instruction",
    );
    base.fields[0]!.name = "status";
    base.fields[1]!.name = "output";
    base.fields[2]!.name = "output";
    base.fields[2]!.id = base.fields[1]!.id;
    const unsafe = JSON.parse(JSON.stringify(base)) as DatasetPreparationVisualOutputShape;
    unsafe.fields[0]!.name = "__proto__";

    const protectedResult = compile(base, "llm-instruction");
    const unsafeResult = compile(unsafe, "llm-instruction");
    assert.equal(protectedResult.ok, false);
    assert.ok(diagnosticCodes(protectedResult).includes("field-name-protected"));
    assert.ok(diagnosticCodes(protectedResult).includes("field-name-duplicate"));
    assert.ok(diagnosticCodes(protectedResult).includes("field-id-duplicate"));
    assert.equal(unsafeResult.ok, false);
    assert.ok(diagnosticCodes(unsafeResult).includes("field-name-unsafe"));
  });

  it("rejects runtime-owned lineage names at the custom payload root", () => {
    const shape = createDefaultDatasetPreparationVisualOutputShape(
      "llm-instruction",
    );
    shape.fields[0] = { ...shape.fields[0]!, name: "sourceLineage" };

    const result = compile(shape, "llm-instruction", {
      outputFormat: "parquet",
    });

    assert.equal(result.ok, false);
    assert.ok(diagnosticCodes(result).includes("field-name-protected"));
  });

  it("rejects missing, duplicate, task-mismatched, optional, and type-incompatible purposes", () => {
    const shape = createDefaultDatasetPreparationVisualOutputShape(
      "llm-instruction",
    );
    delete shape.fields[0]!.purpose;
    shape.fields[1]!.purpose = "output";
    shape.fields[1]!.required = false;
    shape.fields[2]!.purpose = "output";

    const result = compile(shape, "llm-instruction");
    assert.equal(result.ok, false);
    assert.ok(diagnosticCodes(result).includes("purpose-missing"));
    assert.ok(diagnosticCodes(result).includes("purpose-duplicate"));
    assert.ok(diagnosticCodes(result).includes("purpose-incompatible"));

    const taskMismatch = compile(shape, "llm-reranker");
    assert.equal(taskMismatch.ok, false);
    assert.ok(diagnosticCodes(taskMismatch).includes("task-mismatch"));
  });

  it("rejects unbounded children, choices, and value limits", () => {
    const shape = createDefaultDatasetPreparationVisualOutputShape(
      "llm-classification",
    );
    shape.fields[0]!.kind = "group";
    shape.fields[0]!.choices = ["a"];
    shape.fields[0]!.maxLength = 100_000;
    shape.fields[0]!.maxItems = 100;

    const result = compile(shape, "llm-classification");
    assert.equal(result.ok, false);
    assert.ok(diagnosticCodes(result).includes("field-children-invalid"));
    assert.ok(diagnosticCodes(result).includes("field-choices-invalid"));
    assert.ok(diagnosticCodes(result).includes("field-limit-invalid"));

    const labels = compile(
      createDefaultDatasetPreparationVisualOutputShape("llm-classification"),
      "llm-classification",
      { allowedLabels: ["duplicate", "duplicate"] },
    );
    assert.equal(labels.ok, false);
    assert.ok(diagnosticCodes(labels).includes("field-choices-invalid"));
  });

  it("rejects excessive field counts and nesting depth", () => {
    const tooMany = createDefaultDatasetPreparationVisualOutputShape(
      "llm-classification",
    );
    tooMany.fields.push(
      ...Array.from({ length: 40 }, (_, index) => ({
        id: `extra-${index}`,
        name: `extra_${index}`,
        kind: "text" as const,
        required: false,
      })),
    );
    const tooManyResult = compile(tooMany, "llm-classification");
    assert.equal(tooManyResult.ok, false);
    assert.ok(diagnosticCodes(tooManyResult).includes("field-count-invalid"));

    const nested = createDefaultDatasetPreparationVisualOutputShape(
      "llm-extraction",
    );
    let parent = nested.fields[0]!;
    parent.kind = "group";
    delete parent.children;
    for (let depth = 0; depth < 6; depth += 1) {
      const child = {
        id: `level-${depth}`,
        name: `level_${depth}`,
        kind: "group" as const,
        required: true,
        children: [] as DatasetPreparationVisualOutputShape["fields"],
      };
      parent.children = [child];
      parent = child;
    }
    parent.kind = "text";
    delete parent.children;
    const nestedResult = compile(nested, "llm-extraction");
    assert.equal(nestedResult.ok, false);
    assert.ok(diagnosticCodes(nestedResult).includes("field-depth-invalid"));
  });
});
