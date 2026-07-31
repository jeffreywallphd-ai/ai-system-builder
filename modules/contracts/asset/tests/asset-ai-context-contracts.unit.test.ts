import { describe, expect, it } from "../../../testing/node-test";

import {
  ASSET_AI_CONTEXT_QUALITY_STATUSES,
  ASSET_AI_CONTEXT_SAFETY_NOTE_CATEGORIES,
  ASSET_AI_CONTEXT_SAFETY_NOTE_SEVERITIES,
  normalizeAssetAiContextQualityStatus,
  normalizeAssetAiContextSafetyNoteCategory,
  normalizeAssetAiContextSafetyNoteSeverity,
  normalizeAssetId,
  type AssetAiContext,
  type AssetAiContextAntiPattern,
  type AssetAiContextExample,
  type AssetAiContextSafetyNote,
  type AssetCapabilityDescription,
  type AssetDefinition,
  type AssetInputOutputSummary,
  type AssetLimitationDescription,
  type AssetProvenance,
  type AssetReference,
} from "..";

const provenance: AssetProvenance = {
  sourceKind: "human-authored",
  authorship: "human-authored",
};

const companionRef: AssetReference = {
  kind: "asset-definition-version",
  id: normalizeAssetId("workflow-step.summary-renderer@1.0.0"),
  version: "1.0.0",
  label: "Summary renderer",
};

function forbiddenKeys(value: object): readonly string[] {
  return [
    "rawPrompt",
    "promptTranscript",
    "privateConversationTranscript",
    "embedding",
    "embeddings",
    "vector",
    "vectors",
    "filePath",
    "filesystemPath",
    "localPath",
    "tempPath",
    "providerPath",
    "providerNativePath",
    "bytes",
    "blob",
    "buffer",
    "stream",
    "runtimeReadinessSnapshot",
    "transportEnvelope",
    "ipcChannel",
    "host",
    "hostProcess",
    "uiState",
    "rendererRoute",
    "execute",
    "run",
    "handler",
    "validate",
    "validator",
    "commandLine",
    "token",
    "secret",
    "rawEnvironment",
    "rawStackTrace",
    "adapterDetails",
  ].filter((key) => key in value);
}

describe("asset AI-context vocabularies", () => {
  it("covers safety note categories", () => {
    expect([...ASSET_AI_CONTEXT_SAFETY_NOTE_CATEGORIES]).toEqual([
      "data-sensitivity",
      "filesystem-access",
      "network-access",
      "secret-access",
      "runtime-execution",
      "external-provider",
      "thin-client",
      "automation",
      "user-approval",
      "security",
      "privacy",
      "operational",
      "unknown",
    ]);
    expect(normalizeAssetAiContextSafetyNoteCategory(" Network-Access ")).toBe(
      "network-access",
    );
  });

  it("covers safety note severities", () => {
    expect([...ASSET_AI_CONTEXT_SAFETY_NOTE_SEVERITIES]).toEqual([
      "info",
      "warning",
      "critical",
    ]);
    expect(normalizeAssetAiContextSafetyNoteSeverity(" Critical ")).toBe(
      "critical",
    );
  });

  it("covers quality statuses", () => {
    expect([...ASSET_AI_CONTEXT_QUALITY_STATUSES]).toEqual([
      "draft",
      "incomplete",
      "review-ready",
      "approved",
      "needs-revision",
    ]);
    expect(normalizeAssetAiContextQualityStatus(" Review-Ready ")).toBe(
      "review-ready",
    );
  });
});

describe("asset AI-context contract shapes", () => {
  it("creates a minimal partial AssetAiContext", () => {
    const aiContext: AssetAiContext = {
      purpose: "Summarize selected asset outputs for a dashboard card.",
    };

    expect(aiContext.purpose).toContain("Summarize");
    expect(aiContext.capabilities).toBeUndefined();
    expect(forbiddenKeys(aiContext)).toEqual([]);
  });

  it("creates a full AssetAiContext shape", () => {
    const aiContext: AssetAiContext = {
      purpose: "Create a user-readable summary from structured asset output.",
      userFacingSummary: "Shows concise summaries in dashboards.",
      developerFacingSummary:
        "Provides semantic guidance for configuring a summary workflow step.",
      capabilities: [
        {
          capabilityId: "summary.condense",
          summary: "Condenses structured input into a short explanation.",
          details: "Best for small JSON-compatible records and artifact summaries.",
          appliesWhen: "Use when downstream users need a quick overview.",
        },
      ],
      limitations: [
        {
          limitationId: "summary.not-source-of-truth",
          summary: "Does not replace source artifacts or validation rules.",
          details: "Formal compatibility remains in machine contracts.",
          avoidWhen: "Avoid when exact source fidelity is required.",
        },
      ],
      inputSummary: {
        summary: "Accepts semantic references to records, documents, or artifacts.",
        dataKinds: ["json-record", "artifact-summary"],
        expectedAssetTypes: ["data-source", "document"],
        required: true,
        notes: ["Formal ports are intentionally deferred."],
      },
      outputSummary: {
        summary: "Produces a text summary suitable for display or composition.",
        dataKinds: ["text"],
        expectedAssetTypes: ["prompt-template"],
      },
      configurationGuidance: {
        summary: "Configure tone and maximum summary length.",
        requiredConfiguration: ["tone", "maxLength"],
        recommendedDefaults: {
          tone: "neutral",
          maxLength: 280,
        },
        commonMistakes: ["Do not put secrets in configuration examples."],
        configurationExamples: [
          {
            exampleId: "neutral-card-summary",
            label: "Neutral card summary",
            values: {
              tone: "neutral",
              maxLength: 280,
            },
          },
        ],
      },
      compositionGuidance: {
        summary: "Place after data preparation and before display assets.",
        commonlyComposedWith: [companionRef],
        requiredCompanions: [companionRef],
        incompatibleWith: [
          {
            kind: "asset-definition",
            id: normalizeAssetId("workflow-step.raw-secret-dumper"),
            label: "Unsafe secret dumping step",
          },
        ],
        orderingGuidance: "Run after source normalization.",
        bindingGuidance:
          "Use semantic binding descriptions only; formal binding rules are deferred.",
      },
      examples: [
        {
          exampleId: "dashboard-card",
          title: "Dashboard card",
          description: "Summarize validated chart data for a card.",
          scenario: "A dashboard has a prepared dataset summary.",
          configurationValues: {
            tone: "plain-language",
          },
          compositionRefs: [companionRef],
          expectedOutcome: "A concise summary appears above the chart.",
        },
      ],
      antiPatterns: [
        {
          antiPatternId: "raw-private-prompt",
          title: "Embedding raw private prompts",
          description: "Do not store private prompt transcripts in asset context.",
          whyAvoid: "They may contain secrets or sensitive user data.",
          saferAlternative: "Store a redacted summary and safe source references.",
        },
      ],
      safetyNotes: [
        {
          safetyNoteId: "external-summary-provider",
          category: "external-provider",
          severity: "warning",
          summary: "May send summaries to an external provider in future runtimes.",
          details: "Obtain approval before enabling provider-backed execution.",
          recommendedAction: "Use redacted inputs for external-provider workflows.",
        },
      ],
      quality: {
        qualityStatus: "review-ready",
        lastReviewedAt: "2026-05-07T00:00:00.000Z",
        reviewedBy: "asset-kernel-maintainer",
        missingSections: [],
        notes: "Ready for future completeness validation.",
      },
      metadata: {
        sourceDocRef: "docs/architecture/asset-kernel.md#ai-readable-context",
      },
    };

    expect(aiContext.capabilities?.[0]?.summary).toContain("Condenses");
    expect(aiContext.limitations?.[0]?.avoidWhen).toContain("exact");
    expect(aiContext.inputSummary?.required).toBe(true);
    expect(aiContext.configurationGuidance?.recommendedDefaults?.tone).toBe(
      "neutral",
    );
    expect(aiContext.compositionGuidance?.commonlyComposedWith).toEqual([
      companionRef,
    ]);
    expect(aiContext.examples?.[0]?.configurationValues).toMatchObject({
      tone: "plain-language",
    });
    expect(aiContext.antiPatterns?.[0]?.whyAvoid).toContain("secrets");
    expect(aiContext.safetyNotes?.[0]?.category).toBe("external-provider");
    expect(aiContext.quality?.qualityStatus).toBe("review-ready");
    expect(forbiddenKeys(aiContext)).toEqual([]);
  });

  it("lets AssetDefinition reference detailed AI context", () => {
    const definition: AssetDefinition = {
      definitionId: normalizeAssetId("workflow-step.dashboard.summary"),
      assetType: "workflow-step",
      assetFamily: "behavioral",
      version: "1.0.0",
      displayName: "Dashboard summary step",
      description: "Summarizes prepared dashboard data.",
      lifecycleStatus: "draft",
      provenance,
      aiContext: {
        purpose: "Help AI compose a dashboard summary step safely.",
        userFacingSummary: "Summarizes dashboard data.",
      },
    };

    expect(definition.aiContext?.purpose).toContain("compose");
    expect(forbiddenKeys(definition)).toEqual([]);
  });

  it("keeps AI context optional for draft and internal assets", () => {
    const definition: AssetDefinition = {
      definitionId: normalizeAssetId("tool.internal.placeholder"),
      assetType: "tool",
      assetFamily: "behavioral",
      version: "0.1.0",
      displayName: "Internal placeholder",
      description: "Draft internal asset without complete AI context.",
      lifecycleStatus: "draft",
      provenance,
    };

    expect(definition.aiContext).toBeUndefined();
  });

  it("models capability descriptors without executable logic", () => {
    const capability: AssetCapabilityDescription = {
      capabilityId: "image.caption",
      summary: "Creates captions from safe image references.",
      details: "Future implementations may connect this to runtime capabilities.",
      appliesWhen: "Use when image assets need accessible labels.",
    };

    expect(capability.summary).toContain("captions");
    expect(forbiddenKeys(capability)).toEqual([]);
    expect("execute" in capability).toBe(false);
    expect("run" in capability).toBe(false);
  });

  it("models limitation descriptors without executable logic", () => {
    const limitation: AssetLimitationDescription = {
      limitationId: "no-diagnosis",
      summary: "Does not provide medical diagnosis.",
      details: "Use approved domain workflows for regulated guidance.",
      avoidWhen: "Avoid for regulated medical decision support.",
    };

    expect(limitation.avoidWhen).toContain("regulated");
    expect(forbiddenKeys(limitation)).toEqual([]);
    expect("validate" in limitation).toBe(false);
  });

  it("keeps input/output summaries semantic instead of duplicating formal ports", () => {
    const summary: AssetInputOutputSummary = {
      summary: "Consumes normalized text and produces a concise markdown summary.",
      dataKinds: ["text", "markdown"],
      expectedAssetTypes: ["document"],
      required: true,
      notes: ["No port IDs or binding compatibility rules are declared here."],
    };

    expect(summary.expectedAssetTypes).toEqual(["document"]);
    expect("ports" in summary).toBe(false);
    expect("portId" in summary).toBe(false);
    expect("bindingRules" in summary).toBe(false);
  });

  it("lets configuration guidance reference examples without replacing schemas", () => {
    const aiContext: AssetAiContext = {
      purpose: "Guide configuration of a prompt-template asset.",
      configurationGuidance: {
        summary: "Use defaults unless the composition requires a different tone.",
        requiredConfiguration: ["tone"],
        recommendedDefaults: { tone: "neutral" },
        configurationExamples: [
          {
            exampleId: "friendly-tone",
            label: "Friendly tone",
            values: { tone: "friendly" },
          },
        ],
      },
    };

    expect(aiContext.configurationGuidance?.configurationExamples?.[0]?.values).toEqual({
      tone: "friendly",
    });
    expect("fields" in (aiContext.configurationGuidance ?? {})).toBe(false);
    expect("schema" in (aiContext.configurationGuidance ?? {})).toBe(false);
  });

  it("lets composition guidance use safe AssetReference values", () => {
    const aiContext: AssetAiContext = {
      purpose: "Guide safe feature composition.",
      compositionGuidance: {
        summary: "Compose with a display card and avoid raw secret dumpers.",
        commonlyComposedWith: [companionRef],
      },
    };

    expect(aiContext.compositionGuidance?.commonlyComposedWith?.[0]).toEqual(
      companionRef,
    );
    expect(forbiddenKeys(companionRef)).toEqual([]);
  });

  it("represents examples and anti-patterns safely", () => {
    const example: AssetAiContextExample = {
      description: "Use redacted artifact references for summary examples.",
      configurationValues: {
        includeSensitiveFields: false,
      },
      compositionRefs: [companionRef],
    };
    const antiPattern: AssetAiContextAntiPattern = {
      description: "Storing raw private conversation transcripts.",
      whyAvoid: "They may contain secrets and user-sensitive information.",
      saferAlternative: "Use redacted summaries and safe references.",
    };

    expect(example.configurationValues?.includeSensitiveFields).toBe(false);
    expect(antiPattern.saferAlternative).toContain("redacted");
    expect(forbiddenKeys(example)).toEqual([]);
    expect(forbiddenKeys(antiPattern)).toEqual([]);
  });

  it("does not require unsafe runtime, host, transport, prompt, path, byte, or function fields", () => {
    const aiContext: AssetAiContext = {
      purpose: "Safely guide AI composition without runtime implementation details.",
      safetyNotes: [
        {
          category: "security",
          severity: "info",
          summary: "Use safe references instead of raw paths or secrets.",
        },
      ],
      metadata: {
        redactedSourceRef: "asset-doc.summary-guidance",
      },
    };
    const safetyNote: AssetAiContextSafetyNote = aiContext.safetyNotes?.[0] ?? {
      category: "unknown",
      summary: "missing",
    };

    expect(forbiddenKeys(aiContext)).toEqual([]);
    expect(forbiddenKeys(safetyNote)).toEqual([]);
    expect("rawPrompt" in aiContext).toBe(false);
    expect("embeddings" in aiContext).toBe(false);
    expect("runtimeReadinessSnapshot" in aiContext).toBe(false);
    expect("transportEnvelope" in aiContext).toBe(false);
    expect("handler" in safetyNote).toBe(false);
  });
});
