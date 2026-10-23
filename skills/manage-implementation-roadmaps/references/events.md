# Roadmap event reference

Write one UTF-8 JSON object to a temporary event file, then pass it to
`roadmap.py apply`. Unknown fields and event types are rejected. Event files are
limited to 1 MiB. Run `apply --dry-run` before recording a complex event.

The engine stores a timestamp and SHA-256 fingerprint in history. It stores
summaries, not the full event payload. Commands in evidence are descriptive strings;
the engine never executes them.

## Security evidence convention

New roadmaps in a repository containing the integrated contributor adapter carry
`evidencePolicy: control-plane-v1`. This is a versioned adoption boundary, not a
new user approval event. `increment-completed` requires a completed helper work
record bound to the active approved increment, every acceptance ID, current
executed verification and separate-invocation review. Descriptive evidence events
do not bypass that guard. Old state remains readable and explicitly legacy.

Command publication is serialized and predecessor-checked. An interrupted apply
or init has a confined recovery journal; the next apply or render finishes it
before accepting another mutation. Status and validate remain read-only.

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

The event requires current approval, the next pending increment and satisfied
dependencies, and refuses unresolved human actions and unclassified legacy
records before changing state or generated documents. Explicit agent-owned work
remains open and permits execution; it does not permit completion. Use
`blocker-reclassified` for responsibility changes and `resumed` for actual completion. Approved not-started work remains pending (`ready`); a user-ordered
future start is a plan constraint, not itself a blocker or an automatic check of
another roadmap's completion.

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
On governed roadmaps these are declarations: recording the last passing outcome
does not promote an implemented-pending increment to completed. An overall work
can qualify while controlled criteria are pending and cannot replace targeted
criterion-bound review. Use `increment-qualified` after current exact-target
verification and independent review. Do not edit status, invent an active
increment or reuse overall-only evidence to close it.

### `human-acceptance-transferred`

Use only after the human explicitly assigns human acceptance testing offline.
Review the exact criteria: manual accessibility and representative-user acceptance
may qualify; mixed performance, hardware, provider, runtime or security checks do
not. The human-only attestation is operator supplied, not semantic or identity proof.

```json
{
  "type": "human-acceptance-transferred",
  "incrementId": "completed-technical-slice",
  "criterionIds": ["manual-user-acceptance"],
  "approvedFingerprint": "current-roadmap-fingerprint",
  "authorityRef": "explicit-user-offline-acceptance",
  "onlyHumanAcceptance": true,
  "summary": "User handles manual acceptance offline; no human test pass asserted."
}
```

Admission is legacy-only: any `evidencePolicy` is refused so this metadata event
cannot bypass receipt-governed completion. Governed scope changes need separately
qualified current candidate evidence; this event supplies no such authority.
Admission requires a current approval/fingerprint, an implemented-pending increment,
every chunk complete, no open blocker, selected controlled criteria with pending
evidence, and every retained criterion passed. Local, missing, failed and security
criteria cannot transfer. Transfer archives the original criteria, plan and approval
under `humanAcceptanceTransfers`; original evidence/chunks stay unchanged. Active
criteria exclude the transferred checks and the increment becomes completed, but
approval is invalidated. Apply `roadmap-approved` only when this exact narrow change
is authorized by the human, attributing that actual direction. Other roadmap and
current-receipt closure gates remain intact. Never convert legacy declarations
into current executed evidence or remove the temporary report through this event.

### `acceptance-scope-revised`

For a started receipt-governed roadmap, use `acceptance-scope-revised` when the
human explicitly requests agent-only technical acceptance. This is a metadata
scope amendment, never an increment-completion event:

```json
{
  "type": "acceptance-scope-revised",
  "incrementId": "implemented-slice",
  "approvedFingerprint": "current-roadmap-fingerprint",
  "authorityRef": "explicit-user-agent-only-acceptance",
  "onlyHumanScope": true,
  "summary": "Human acceptance is user-owned offline; technical checks remain.",
  "removeCriterionIds": ["participant-study"],
  "replaceCriteria": [{
    "criterion": {"id": "mixed-accessibility", "description": "Automated keyboard, focus, semantics and reflow pass on named hosts.", "qualification": "controlled-environment"},
    "humanScope": "Manual screen-reader and participant acceptance"
  }]
}
```

Admission requires `control-plane-v1`, current approval/fingerprint, a verifying
or implemented-pending increment and all planned chunks complete. Selected IDs
must be unique known controlled criteria with latest **pending** evidence. Local,
security, missing, failed and passed criteria are refused. Replacements retain
the exact ID and qualification; at least one criterion remains active. The
human-only attestation requires independent semantic review; it is not inferred
from arbitrary prose or authenticated by the engine. Remove only pure human
scope, preserve technical portions of mixed scope, and retain automated UI,
performance, model, hardware, runtime, native and security requirements.

`acceptanceScopeRevisions` archives removed/original/revised criteria, exact human
scope, original plan and previous approval. Human portions of original work
packages, deliverables, verification and completed plans become historical/offline;
current technical criteria govern future qualification. Original evidence,
chunks, increment status, blockers and completion policy are unchanged. Only
retired IDs leave pending/chunk projections; retained mixed IDs stay linked and
pending. Approval is invalidated. Record `roadmap-approved` only for the actual
user-authorized narrow change. Changed fingerprints invalidate old bound receipts;
fresh checks and separate review remain mandatory. No pass or closure is created.

### `legacy-acceptance-scope-revised`

Use the same fields and protections as `acceptance-scope-revised`, with this
explicit type only for a legacy roadmap without an evidence policy. The governed
event still refuses legacy state, and this legacy event refuses governed state.
Archive originals under `legacyAcceptanceScopeRevisions`; retain technical
criterion IDs and qualification, pending evidence, plan/chunks, increment status,
blockers and legacy completion policy. Approval is invalidated and the exact
user-authorized narrow scope needs `roadmap-approved` before further work.
This event never qualifies a test or closes an increment. Archive only acceptance
testing performed by people; product data review, publishing authorization and
other human approval controls remain product requirements.

### `technical-acceptance-revised`

Use only for an explicitly user-authorized technical policy amendment on governed,
fully implemented work. Unlike human-only scope events, this replaces exactly one
pending controlled nonsecurity criterion description without changing its identity
or qualification. It removes no criterion and supplies no passing evidence.

```json
{
  "type": "technical-acceptance-revised",
  "incrementId": "implemented-slice",
  "approvedFingerprint": "current-roadmap-fingerprint",
  "authorityRef": "explicit-user-technical-policy",
  "policyRef": "versioned-quality-contract",
  "policyDigest": "replace-with-64-lowercase-hex-sha256",
  "criterion": {
    "id": "model-outcomes",
    "description": "Use the explicitly approved output-quality contract; actual feature resources and cleanup still need qualification.",
    "qualification": "controlled-environment"
  },
  "supersededRequirements": ["The earlier numeric output-quality threshold"],
  "retainedRequirements": ["Native authority, bounded resources and actual feature execution/cleanup"],
  "summary": "Apply the explicit narrow policy amendment without a test pass."
}
```

Admission requires `control-plane-v1`, current approval/fingerprint, all unique
planned chunks complete, and a verifying, implemented-pending or blocked target.
Only known controlled nonsecurity criteria with latest pending evidence qualify.
Local, missing, failed, passed, unknown, unchanged and security-targeted criteria,
changed identities/qualification, removals and unknown fields are refused. Authority
and policy references are opaque identifiers; the digest must be 64 lowercase hex
characters. They are operator declarations, not authenticated user authority or
automatic proof of the referenced bytes. Independent review must verify the actual
user direction, policy artifact/digest and retained software/security obligations.

`technicalAcceptanceRevisions` archives the exact old/new criterion, original plan,
previous approval, policy identity/digest and superseded/retained requirements.
Evidence, chunks, increment status, blockers and completion policy remain intact.
The event invalidates approval and old semantic receipt bindings. Record
`roadmap-approved` only for the actual narrow user authority, which may already have
been explicitly supplied; reapproval preserves open blockers. Fresh current checks
and separate review still govern qualification. Neither amendment nor reapproval
is a measurement, hardware result, pass or completion. Never use this event to
remove a security control or conceal a genuine feature/runtime/resource failure.

### `increment-completed`

```json
{
  "type": "increment-completed",
  "summary": "The contract slice is implemented, documented, and verified."
}
```

### `increment-qualified`

After all implementation is complete, record each target criterion's actual
passing evidence and immutable report. Create fresh work bound to the exact
implemented-pending increment with every criterion; execute its fixed checks,
obtain independent review and complete it. Consume the exact references:

```json
{
  "type": "increment-qualified",
  "incrementId": "implemented-slice",
  "workId": "target-qualification",
  "receiptDigest": "replace-with-64-character-receipt-sha256",
  "reviewDigest": "replace-with-64-character-review-sha256",
  "summary": "All target criteria passed with current independent review."
}
```

Admission requires current governed approval, complete implementation, no blockers,
a pending target and every target criterion passed. Authority binds plan/chunks,
criterion semantics, latest evidence and referenced report bytes. Missing, unsafe,
changing or oversized reports fail closed. Evidence changes need fresh successor
work. Partial, overall-only, wrong-target, failed, stale or self-reviewed records
cannot qualify. Other active increments, original plans/chunks/evidence and
approval remain intact. The event records consumed references and completes only
the target. Its pending-only receipt becomes historical after consumption;
completed targets cannot reopen here. Final closure still requires current overall
qualification and all increments complete.

### `roadmap-completed`

With `evidencePolicy: control-plane-v1`, first complete the guide's reviewed
`overall` work item with current source and the configured completion suite.
Completed increment declarations alone cannot qualify final closure.
Overall verification may run with the final increment verifying only after every
implementation chunk and all predecessors are implemented, approval is current
and no human action or unclassified legacy record prevents execution. Open
agent-owned work may run checks; it still prevents technical completion. This
admits checks, never controlled evidence or closure.
Do not record aggregate execution as a completed implementation chunk in advance.

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
and preserves the roadmap and canonical JSON state. The status remains `completed`;
`finalApproval` is a separate approval fact, not another completion status. Any
finally approved record is immutable regardless of its legacy or canonical status.

### `completion-status-normalized`

For explicit user-directed conversion of an existing legacy `final-approved`
record, apply this narrow event through the ordinary serialized engine:

```json
{
  "type": "completion-status-normalized",
  "authorityRef": "user-single-completion-status",
  "summary": "Use the canonical completed status while preserving final approval."
}
```

Admission requires the legacy status, valid existing completion and final approval,
all increments completed, no active increment and no open blocker. It changes only
the current status to `completed`, the update timestamp and one appended history
entry. Original creation time, approval, completion, plans, chunks, criteria,
evidence, history entries and approved fingerprint remain unchanged. Missing or
malformed facts, incomplete work, overrides and repeat conversion are refused.
This event never creates approval, test evidence or current qualification. Final
immutability and report removal are keyed on `finalApproval`; render cannot
recreate a finally approved report. New work still requires a successor roadmap.

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

Dispositions: `accepted`, `deferred`, `needs-decision`, or `blocked`. New
`blocked` feedback requires a recorded unresolved explicit human action.
High-level, scope-changing, and needs-decision feedback invalidates roadmap approval.

### `blocker-recorded`

```json
{
  "type": "blocker-recorded",
  "id": "independent-review-needed",
  "kind": "dependency",
  "summary": "An independent security review is needed.",
  "actionOwner": "human",
  "responsibleRole": "Repository owner",
  "requiredAction": "Arrange a permitted independent review.",
  "actionLocation": "The approved review channel",
  "completionCondition": "A candidate-bound independent review is received and checked.",
  "authorityRef": "user-human-action-policy"
}
```

Kinds: `environment`, `dependency`, `decision`, `credential`,
`production-authority`, or `technical`. A new record requires `actionOwner: human`
and every nonempty action field shown above. Authority references are bounded
identifiers, not proof that a person acted. The record stays open until actual
resolution. Its presence pauses execution; it does not change technical criteria.

Missing implementation or unrun checks belong to the agent plan. They are In
progress or Technical check pending, not Blocked. A user start order stays a plan
constraint. Do not request a credential or approval already supplied. A failed
check remains failed regardless of who owns its correction.

### `blocker-reclassified`

```json
{
  "type": "blocker-reclassified",
  "blockerId": "saved-technical-gap",
  "expectedBlockerDigest": "replace-with-engine-fingerprint-of-current-record",
  "actionOwner": "agent",
  "responsibleRole": "Coding agent",
  "requiredAction": "Implement the approved protection and run its checks.",
  "actionLocation": "The owning implementation increment",
  "completionCondition": "Current checks and independent review confirm the protection.",
  "authorityRef": "user-human-action-policy",
  "reason": "The user reserves Blocked for a required human action. This work is unfinished."
}
```

This event changes responsibility for one existing open record. Both `agent` and
`human` require the same concrete action fields. `expectedBlockerDigest` uses the
engine's `fingerprint(record)` (canonical sorted ASCII JSON, SHA-256). A stale
record, missing field, unknown field or unchanged assignment is refused without
mutation. Optional `summary` corrects an obsolete factual summary; it cannot alter
criteria. The exact old record/digest, new assignment, reason, authority reference
and optional revised summary are retained in `blockerReclassifications`.

The record remains `open`, with no invented resolution or completion. Agent
ownership permits ordered approved execution and checks. Human ownership pauses
execution. Unclassified legacy open records remain valid and conservatively stop
execution until an explicit reviewed classification; kind/text never infers owner.

Criteria, chunks, evidence, approvals and their fingerprints remain unchanged.
Unfinished work of either owner prevents increment completion, exact-target
qualification, roadmap completion and final approval. It also prevents legacy
passing evidence from automatically closing an increment. Checks may run before
actual work is reconciled; a check receipt is not a resolution event. Keep frozen
successor histories archived rather than reactivating them for display changes.

Generated reports separate Pending work, Human action needed and unclassified
legacy records. User descriptions follow ASD-STE100 principles: name the actor,
action, location and completion condition in plain sentences. Keep source-bound technical detail internally; do
not expose a technical accordion or shorten a technical acceptance requirement.

### `resumed`

```json
{
  "type": "resumed",
  "blockerId": "sandbox-acl",
  "resolution": "The stale temporary directory was removed.",
  "reconciliation": "Re-inspected uncommitted changes and reran the focused baseline."
}
```

Use this event only after the action or technical work is actually done. For an
unfinished responsibility change use `blocker-reclassified`, not a false resolution.
Other human actions or unclassified legacy records retain `blocked`; remaining
agent-owned work stays open without pausing execution. Stale approval retains
`approval-required`. Active work resumes its actual research/planning/implementation/
verification stage. Without active work, all completed increments yield
`roadmap-ready-to-close`; all implemented increments with outstanding qualification
yield `implementation-complete-qualification-pending`; a remaining pending increment
yields `ready`. None of these labels grants qualification or closes work.
