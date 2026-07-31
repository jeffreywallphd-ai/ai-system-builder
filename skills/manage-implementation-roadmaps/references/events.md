# Roadmap event reference

Write one UTF-8 JSON object to a temporary event file, then pass it to
`roadmap.py apply`. Unknown fields and event types are rejected. Event files are
limited to 1 MiB. Run `apply --dry-run` before recording a complex event.

The engine stores a timestamp and SHA-256 fingerprint in history. It stores
summaries, not the full event payload. Commands in evidence are descriptive strings;
the engine never executes them.

## Security evidence convention

The event schema stores a structured security impact in discovery, then uses
acceptance criteria, risks, plans, and evidence without duplicating repository
security policy. Follow the target repository's security-by-design standard:

- `securityImpact.disposition` is `not-security-relevant` with a concrete summary,
  or `security-relevant` with non-empty assets, trust boundaries, abuse cases,
  controls, and verification plus explicit residual risks;
- every increment includes `security-impact-reviewed` or a more specific security
  acceptance criterion and maps it to a planned chunk;
- security-relevant research records abuse/failure risks, and its plan names focused
  denial/failure-path checks plus applicable completion gates;
- evidence uses sanitized summaries and synthetic fixtures. Never store secrets,
  credentials, protected prompts, private payloads, personal data, paths, raw logs,
  or exploitable production details in events or artifacts.

The engine rejects new discovery without `securityImpact` and rejects every new or
revised increment that lacks `security-impact-reviewed` or a more specific
`security-*` acceptance criterion. Existing stored roadmap state remains readable.

## Preparation events

### `discovery-recorded`

```json
{
  "type": "discovery-recorded",
  "summary": "Existing contracts support the change, but host wiring is incomplete.",
  "sources": [
    {
      "title": "Repository architecture",
      "url": "docs/architecture/README.md",
      "note": "Defines dependency direction."
    }
  ],
  "constraints": ["Preserve the existing public contract."],
  "securityImpact": {
    "disposition": "security-relevant",
    "summary": "Host wiring changes a trust boundary.",
    "assets": ["Authorized application behavior and safe diagnostics"],
    "trustBoundaries": [
      "Application orchestration to host adapter composition"
    ],
    "abuseCases": [
      "An unavailable policy dependency falls back to permissive behavior"
    ],
    "controls": ["Fail-closed composition and sanitized failures"],
    "verification": ["Focused denial and adapter-failure tests"],
    "residualRisks": ["Controlled host qualification remains required"]
  },
  "decisionRequired": true
}
```

### `decision-proposed`

Provide two or three options and exactly one recommendation.

```json
{
  "type": "decision-proposed",
  "decision": {
    "id": "integration-boundary",
    "title": "Integration boundary",
    "question": "Where should the new behavior be composed?",
    "context": "The selected boundary changes host ownership and testing.",
    "options": [
      {
        "id": "existing-host",
        "label": "Existing host",
        "summary": "Extend the current composition root.",
        "tradeoffs": ["Smallest surface", "Tighter host coupling"],
        "consequences": ["Existing host tests expand"],
        "recommended": true
      },
      {
        "id": "new-host",
        "label": "New host",
        "summary": "Introduce a separate composition root.",
        "tradeoffs": ["Clear ownership", "More deployment surface"],
        "consequences": ["New packaging and operations work"],
        "recommended": false
      }
    ]
  }
}
```

### `decision-approved`

Use only after explicit user approval.

```json
{
  "type": "decision-approved",
  "decisionId": "integration-boundary",
  "optionId": "existing-host",
  "note": "User accepted the recommended option."
}
```

### `roadmap-defined`

```json
{
  "type": "roadmap-defined",
  "increments": [
    {
      "id": "contract-slice",
      "number": 1,
      "title": "Contract and use-case slice",
      "objective": "Expose the behavior through an implementation-neutral port.",
      "dependsOn": [],
      "workPackages": [
        {
          "id": "contract",
          "title": "Contract",
          "outcome": "Stable request and response semantics."
        }
      ],
      "deliverables": ["Contract", "Use case", "Unit tests", "Documentation"],
      "acceptanceCriteria": [
        {
          "id": "contract-tests",
          "description": "Contract behavior passes unit tests.",
          "qualification": "local"
        },
        {
          "id": "security-impact-reviewed",
          "description": "Security impact, controls, denial behavior, rollback, and residual risk are reviewed and evidenced.",
          "qualification": "local"
        }
      ],
      "verification": [
        "Run the focused contract test.",
        "Review the security disposition and run the mapped denial/failure-path test."
      ],
      "rollback": "Remove the additive contract before consumers depend on it.",
      "excluded": ["Host wiring"],
      "allowPendingQualification": false
    }
  ]
}
```

Increment numbers must be contiguous. Dependencies must refer to earlier increment
ids. Valid qualification values are `local` and `controlled-environment`.

### `roadmap-approved`

Use only after the user approves the rendered roadmap.

```json
{
  "type": "roadmap-approved",
  "note": "User approved the increment sequence and acceptance criteria."
}
```

### `roadmap-revised`

Use after execution starts only to replace the still-pending suffix with a more
cohesive approved proposal. Completed or implemented-pending-qualification
increments, chunks, and evidence are preserved exactly. No increment may be active.
Record the scope or granularity feedback first, then render the revised roadmap and
obtain a new `roadmap-approved` event before resuming implementation.

```json
{
  "type": "roadmap-revised",
  "reason": "Merge closely coupled UI work to reduce planning and verification overhead.",
  "increments": [
    {
      "id": "cohesive-experience",
      "number": 2,
      "title": "Cohesive user experience",
      "objective": "Deliver the complete user-visible experience as one vertical slice.",
      "dependsOn": ["completed-foundation"],
      "workPackages": [
        {
          "id": "experience",
          "title": "Integrated experience",
          "outcome": "Related UI and supporting behavior work together end to end."
        }
      ],
      "deliverables": ["Integrated behavior", "Tests", "Documentation"],
      "acceptanceCriteria": [
        {
          "id": "experience-works",
          "description": "The complete experience works across supported hosts.",
          "qualification": "local"
        },
        {
          "id": "security-impact-reviewed",
          "description": "Security impact and safe rollback are reviewed and evidenced for the revised slice.",
          "qualification": "local"
        }
      ],
      "verification": [
        "Run focused tests and applicable completion gates.",
        "Review the security disposition and safe rollback evidence."
      ],
      "rollback": "Revert the integrated experience without changing preserved increments.",
      "excluded": ["Unrelated scope"],
      "allowPendingQualification": false
    }
  ]
}
```

Replacement numbers must continue contiguously after the preserved prefix.
Dependencies may refer to preserved increments or earlier replacements. This event
invalidates the prior roadmap approval.

## Execution events

### `increment-started`

```json
{ "type": "increment-started", "incrementId": "contract-slice" }
```

### `increment-research-recorded`

```json
{
  "type": "increment-research-recorded",
  "summary": "The existing port pattern can be extended without a new dependency.",
  "sources": [
    {
      "title": "Nearest port README",
      "url": "modules/application/ports/README.md"
    }
  ],
  "risks": [
    "A host adapter may still need backward-compatible defaults.",
    "Security impact is relevant: an unavailable authorization or composition dependency must fail closed without exposing internal details."
  ]
}
```

### `increment-plan-recorded`

Every criterion must be assigned to one or more planned chunks.

```json
{
  "type": "increment-plan-recorded",
  "plan": {
    "summary": "Implement and verify the contract vertical slice.",
    "steps": [
      "Add the contract.",
      "Implement the use case.",
      "Verify behavior."
    ],
    "chunks": [
      {
        "id": "contract-use-case",
        "title": "Contract and use case",
        "outcome": "The behavior is callable through the application port.",
        "criteriaIds": ["contract-tests", "security-impact-reviewed"]
      }
    ],
    "focusedTests": [
      "Focused unit tests for the active chunk",
      "Focused denial and sanitized failure-path tests for the changed trust boundary"
    ],
    "completionTests": [
      "Tests and gates relevant to this increment after every planned chunk is implemented"
    ],
    "documentation": ["Nearest README", "Roadmap report"],
    "rollback": "Remove the additive port and use case.",
    "assumptions": ["No persisted-data migration is required."]
  }
}
```

### `chunk-recorded`

```json
{
  "type": "chunk-recorded",
  "chunkId": "contract-use-case",
  "summary": "Added the approved contract and use-case behavior.",
  "areas": ["Application port", "Use case"],
  "tests": ["Focused unit test passed"],
  "documentation": ["Port README updated"],
  "feedbackAddressed": []
}
```

### `evidence-recorded`

```json
{
  "type": "evidence-recorded",
  "incrementId": "contract-slice",
  "criterionId": "contract-tests",
  "kind": "test",
  "outcome": "passed",
  "summary": "Focused unit test passed locally.",
  "command": "npm test -- contract-test",
  "artifact": "artifacts/test-results/contract.xml"
}
```

Kinds are `test`, `documentation`, `review`, `manual`, or `external`.
Outcomes are `passed`, `failed`, or `pending`. Only a controlled-environment
criterion may be pending.

### `increment-completed`

```json
{
  "type": "increment-completed",
  "summary": "The contract slice is implemented, documented, and verified."
}
```

### `roadmap-completed`

```json
{
  "type": "roadmap-completed",
  "summary": "Every increment and controlled-environment criterion passed."
}
```

This records implementation completion but does not remove the temporary report.
Present the report and wait for explicit user approval of the overall result.

### `report-relocated`

Use this to migrate a legacy active report into ignored `docs/tmp/`.

```json
{
  "type": "report-relocated",
  "reportPath": "docs/tmp/example-feature-implementation-report.md",
  "reason": "Keep the generated progress summary local and temporary."
}
```

The engine writes the new generated report before removing the old generated file.
It refuses to remove a file without the generated notice.

### `final-approval-recorded`

Use only after `roadmap-completed` and an explicit user approval response.

```json
{
  "type": "final-approval-recorded",
  "note": "The user explicitly approved the completed overall work."
}
```

This makes the roadmap final and immutable, removes the generated temporary report,
and preserves the roadmap and canonical JSON state.

## Feedback and recovery events

### `feedback-recorded`

```json
{
  "type": "feedback-recorded",
  "id": "feedback-asset-read",
  "summary": "The desktop asset browser cannot read its library.",
  "category": "defect",
  "impact": "within-increment",
  "targetIncrementId": "desktop-integration",
  "disposition": "accepted",
  "nextAction": "Reproduce through the desktop host and add a regression test."
}
```

Categories: `clarification`, `defect`, `scope`, `decision`, `environment`,
or `verification`.

Impacts: `within-increment`, `later-increment`, `high-level`, `scope-change`,
or `environment`.

Dispositions: `accepted`, `deferred`, `needs-decision`, or `blocked`.
High-level, scope-changing, and needs-decision feedback invalidates roadmap approval.

### `blocker-recorded`

```json
{
  "type": "blocker-recorded",
  "id": "sandbox-acl",
  "kind": "environment",
  "summary": "The Windows sandbox cannot read a generated temporary directory.",
  "requiredAction": "Repair or remove the stale temporary directory ACL."
}
```

Kinds: `environment`, `dependency`, `decision`, `credential`,
`production-authority`, or `technical`.

### `resumed`

```json
{
  "type": "resumed",
  "blockerId": "sandbox-acl",
  "resolution": "The stale temporary directory was removed.",
  "reconciliation": "Re-inspected uncommitted changes and reran the focused baseline."
}
```
