# Incomplete Work Register

This file records incomplete product, implementation, or workflow work discovered while reviewing documentation and code. It is separate from `docs/docs-mismatch-register.md`, which records documentation drift.

Use this register when the docs or code indicate work is intentionally unavailable, partially wired, unsupported, or left behind a placeholder boundary.

Do not use this register for:

- documentation mismatches,
- architectural decisions that need owner review,
- phase diaries or prompt transcripts,
- speculative roadmap ideas not evidenced by docs or code.

## Entry Template

```md
### IW-YYYYMMDD-###

- Status: open
- Severity: high | medium | low
- Area: short feature or subsystem name
- Evidence:
  - `path/to/file.md`: concise statement of the incomplete work.
  - `path/to/code.ts`: concise statement of the related implementation state.
- Summary: One sentence describing what remains incomplete.
- Decision needed: Clarify whether to complete, remove, defer explicitly, or re-scope the work.
- Notes: Optional implementation-neutral details for follow-up.
```

## Findings

### IW-20260605-001

- Status: open
- Severity: medium
- Area: Asset authoring override creation
- Evidence:
  - `docs/architecture/asset-authoring-customization-and-overrides.md`: says create-override flows are deferred until safe target selection/validation exists.
  - `modules/application/use-cases/asset-authoring/create-asset-override.use-case.ts`: implements the create override use case.
  - `modules/hosts/server/composition/composeServerHost.ts`: uses an unavailable target reader for override creation.
- Summary: Override creation is partially implemented below the UI, but safe target selection/validation and user-facing creation remain incomplete.
- Decision needed: Decide whether to finish safe target selection and UI exposure, keep the operation intentionally unavailable, or remove the exposed partial path.
- Notes: This also appears in the documentation mismatch register because docs and implementation boundaries disagree.

### IW-20260605-002

- Status: open
- Severity: medium
- Area: Controlled conversational execution lifecycle
- Evidence:
  - `docs/context/packs/controlled-conversational-system-execution.pack.md`: says cancel, retry, and streaming remain unsupported/deferred unless a real application/runtime path supports them.
  - `modules/application/use-cases/conversations/submit-conversation-turn.use-case.ts`: implements the single-turn submission path.
- Summary: The initial conversational execution slice exists, but broader lifecycle behavior such as cancel, retry, and streaming remains incomplete or unsupported.
- Decision needed: Decide which lifecycle operations should be implemented next and which should stay explicitly unsupported.
- Notes: Keep this distinct from the separate doc mismatch about whether the text-generation adapter itself is supported.

### IW-20260605-003

- Status: addressed
- Severity: low
- Area: Context pack maintenance automation
- Evidence:
  - `docs/context/README.md`: requires each context pack to stay at or below 200 physical lines.
  - `dev-tools/scripts/docs/check-doc-drift.mjs`: enforces context pack line limits, canonical source sections, banned diary phrases, ADR inventory shape, and README reminders.
- Summary: Context pack size and diary-shape rules now have a visible `npm run docs:check` guardrail.
- Decision needed: None for the initial guardrail; future work may broaden checks as new drift patterns appear.
- Notes: Addressed by the documentation drift check.

### IW-20260605-004

- Status: addressed
- Severity: medium
- Area: Run & Test conversational UI
- Evidence:
  - `docs/architecture/controlled-conversational-system-execution.md`: states that selected-system context, wording, DTO mapping, UI state, behavior tests, and final documentation remain separate UI repair work.
  - `docs/context/packs/controlled-conversational-system-execution.pack.md`: says Run & Test UI correctness remains a distinct responsibility.
- Summary: The conversational Run & Test UI now shares one desktop/thin
  presenter, consumes actual execution-plan summaries, projects authoritative
  action availability, bounds input/transcript rendering, and has host/parity,
  accessibility, long-conversation, and DTO-envelope regression coverage.
- Decision needed: None for the repaired initial controlled-text slice.
- Notes: Tools, retrieval, memory, multimodal IO, streaming, cancel, and retry
  remain explicitly unsupported unless implemented end to end.

### IW-20260605-005

- Status: addressed
- Severity: medium
- Area: Documentation guardrail tests
- Evidence:
  - `modules/contracts/tests/runtime-readiness-docs-closeout.unit.test.ts`: now asserts runtime-readiness concepts rather than phase labels.
  - `modules/contracts/tests/execution-plan-docs-closeout.unit.test.ts`: now asserts non-executing execution-plan concepts rather than phase labels.
  - `modules/contracts/tests/controlled-conversational-execution-docs-closeout.unit.test.ts`: now asserts asset-first/runtime-record separation without exact closeout wording.
- Summary: Documentation guardrail tests now assert durable concepts instead of phase/closeout phrasing.
- Decision needed: None for the initial repair.
- Notes: Full `npm test` still has unrelated failures outside these docs guardrail tests.

### IW-20260605-006

- Status: addressed
- Severity: high
- Area: Non-text model training runtimes
- Evidence:
  - `modules/adapters/runtime/python/worker/tasks/train_model.py`: routes diffusion LoRA and vision training tasks to dedicated multimodal trainers.
  - `modules/adapters/runtime/python/worker/tasks/train_model_multimodal.py`: implements diffusion LoRA, vision classification, object detection, and segmentation trainer paths.
  - `modules/application/use-cases/model/train-model.use-case.ts`: stages source image artifact bytes for generated image manifests before runtime training.
  - `apps/desktop/src/renderer/features/models/profiles/modelTrainingTaskProfiles.ts`: marks diffusion and vision model training tasks as trainable.
- Summary: First-tier diffusion and vision model training tasks now have runtime trainer implementations and source artifact staging.
- Decision needed: None for the initial trainer completion; future work can add model-family-specific advanced controls if needed.
- Notes: Vision training supports LoRA and full fine-tuning; diffusion training supports LoRA.
