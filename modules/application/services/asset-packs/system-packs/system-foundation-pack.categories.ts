export interface SystemFoundationPackCategory {
  readonly categoryId: string;
  readonly displayName: string;
  readonly description: string;
  readonly sortOrder: number;
}

export const SYSTEM_FOUNDATION_PACK_CATEGORIES = [
  {
    categoryId: "ui-structure",
    displayName: "UI Structure",
    description: "Foundational layout and structural building blocks for user-facing screens.",
    sortOrder: 10,
  },
  {
    categoryId: "forms-fields",
    displayName: "Forms and Fields",
    description: "Foundational input and field semantics for collecting user-provided values.",
    sortOrder: 20,
  },
  {
    categoryId: "data-display",
    displayName: "Data Display",
    description: "Foundational presentation semantics for readable data and records.",
    sortOrder: 30,
  },
  {
    categoryId: "state-messages",
    displayName: "State Messages",
    description: "Foundational status, feedback, and empty-state communication patterns.",
    sortOrder: 40,
  },
  {
    categoryId: "page-feature-shells",
    displayName: "Page and Feature Shells",
    description: "Foundational page and feature container semantics for composed product areas.",
    sortOrder: 50,
  },
  {
    categoryId: "workflow-system-shells",
    displayName: "Workflow and System Shells",
    description: "Foundational workflow and system container semantics for larger compositions.",
    sortOrder: 60,
  },
  {
    categoryId: "conversational-systems",
    displayName: "Conversational Systems",
    description: "Reusable conversational composite assets that preserve lineage to foundational primitives.",
    sortOrder: 70,
  },
  {
    categoryId: "data-modeling",
    displayName: "Data Modeling",
    description: "Portable data types, entities, fields, relationships, validation, queries, and bindings.",
    sortOrder: 80,
  },
  {
    categoryId: "security-policy",
    displayName: "Security and Audit",
    description: "Fail-closed authentication, authorization, permission, and audit declarations.",
    sortOrder: 90,
  },
  {
    categoryId: "artifact-preview",
    displayName: "Artifact and Data Preview",
    description: "Safe bounded previews for artifact and data resources.",
    sortOrder: 100,
  },
  {
    categoryId: "ai-context",
    displayName: "AI Models and Context",
    description: "Model references and bounded AI-readable context declarations.",
    sortOrder: 110,
  },
  {
    categoryId: "logic-workflow",
    displayName: "Logic and Workflow",
    description: "Finite conditions, mappings, and branches without arbitrary code evaluation.",
    sortOrder: 120,
  },
  {
    categoryId: "test-observability",
    displayName: "Test and Observability",
    description: "Fixtures, mock data, assertions, and safe operational event declarations.",
    sortOrder: 130,
  },
  {
    categoryId: "reference-features",
    displayName: "Reference Features",
    description: "Composed functional defaults made only from lower-level foundation assets.",
    sortOrder: 140,
  },
] as const satisfies readonly SystemFoundationPackCategory[];

export const SYSTEM_FOUNDATION_PACK_CATEGORY_IDS =
  SYSTEM_FOUNDATION_PACK_CATEGORIES.map((category) => category.categoryId);

export type SystemFoundationPackCategoryId =
  (typeof SYSTEM_FOUNDATION_PACK_CATEGORY_IDS)[number];
