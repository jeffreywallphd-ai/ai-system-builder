# Asset Authoring and Execution Security

- Status: current
- Implementation: bounded manual/coding-model patch proposal, immutable source review, and fail-closed provider behavior are current; untrusted build/execution remains unavailable until the selected sandbox adapter is qualified
- Related decisions: ADR-0015, ADR-0029, ADR-0030, ADR-0031, ADR-0032, ADR-0035
- Verification: `docs/security/asset-package-authoring-and-execution-threat-model.md`

## Purpose

This document defines the isolation and capability boundaries for imported assets, user-authored assets, coding-model changes, previews, builds, and runtime execution.

## Trust zones

1. **Product control plane**: domain/application services, host composition, authorization, policy, audit, persistence metadata, and capability broker.
2. **Trusted built-in plane**: product-compiled implementations selected from a closed registry.
3. **Untrusted source plane**: imported archives, authored source, generated patches, dependency metadata, fixtures, and package manifests.
4. **Sandboxed build/logic plane**: ephemeral constrained worker with only declared and approved capabilities.
5. **Sandboxed UI plane**: separate browser origin/frame with no Node/Electron privilege and a validated message contract.
6. **Data/secrets plane**: organization/workspace resources and credential providers, accessible only through authorized broker calls.

No lower-trust zone can call a higher-trust implementation directly.

## Capability broker

Capabilities use narrow versioned contracts such as:

- read/write a named data entity under actor and organization context;
- read a bounded artifact preview by opaque reference;
- invoke an approved model operation with safe settings;
- emit a declared audit event;
- request a user interaction;
- fetch an approved origin under an egress policy;
- store/retrieve bounded release-owned state.

Every request includes release identity, system release, workspace, organization, actor, run, declared capability, and correlation identifiers. Authorization evaluates platform policy, organization policy, system policy, asset declaration, and runtime quota. Any denial wins. Secret values and host paths are not returned to the asset.

## UI isolation

Untrusted UI must use:

- no Node integration or preload access;
- context isolation and process sandboxing;
- a restrictive CSP with no inline/eval script and no undeclared network origin;
- blocked top navigation, popups, downloads, external protocol launches, and browser permissions;
- a unique origin/partition per trust context where supported;
- schema-validated, size-limited, versioned post-message envelopes;
- sanitized input data and explicit action responses from the host UI shell.

Trusted built-in React components may run in the product renderer because they are compiled, reviewed product code. A package cannot claim built-in trust through metadata.

## Build and logic isolation

The sandbox adapter must enforce a non-root ephemeral process/container, read-only base, canonicalized mounts, bounded scratch storage, CPU/memory/wall-clock/process/output limits, default-deny egress, an environment allowlist, no Docker/host socket, no host package manager credentials, cancellation, and cleanup.

WASI components may implement portable logic when the selected runtime passes the same capability, quota, determinism, and escape qualification. Node's permission model may add defense in depth but is never the sole malicious-code boundary.

## Coding-model workflow

```txt
user intent
  -> bounded context assembly
  -> model-authored plan
  -> user approves plan (when policy requires)
  -> isolated patch generation
  -> complete diff review
  -> independent format/type/test/security/dependency gates
  -> preview in sandbox
  -> explicit human publish approval
  -> immutable build/release
```

The model sees only required contracts, templates, selected source, tests, and safe diagnostics. Repository instructions, package content, and test fixtures are untrusted context and cannot authorize tools, secrets, network, publication, activation, or deployment.

The implemented `AssetCodingModelPort` can only return a structured plan and
bounded file patch. Application validation owns path, type, size, dependency,
capability, duplicate, and secret checks. The proposal artifact is re-read by
digest and revalidated at approval. Exact workflow revision plus exact
dependency/capability consent are required before an immutable source snapshot
is created. No configured provider is a normal unavailable state, not a reason
to fall back to an implicit provider or broader tools.

Layered derived customizations use the same boundary. Structured customization
records may contain exact base identities, a sparse safe semantic patch, bounded
counts, and immutable artifact descriptors; they never contain source text or raw
paths. Changed relative paths and source text are authorized proposal content only.
Materialization re-reads the exact base and overlay by digest, revalidates all
source/dependency/capability limits plus workspace ownership and optimistic
revision, and creates a new immutable review snapshot. Any base drift, revocation,
unavailable artifact, stale approval, or validation failure denies materialization
and publication without changing the base.

## Approved-release data execution

The secured data-entry reference runtime accepts only an integrity-verified
manifest from an approved `SystemRelease`. It requires exactly one supported
entity and exact authentication, authorization, masking, audit, CRUD-operation,
workflow, and form declarations. Missing, duplicate, malformed, or cross-entity
declarations deny execution.

Field names and values are positively allowlisted at the application boundary.
Transport principals are host-derived, system policy may only narrow platform
policy, and protected fields are removed before response serialization. Record
create/update and their append-only audit entry share one database transaction.
Audit entries contain actor, release/entity/action/outcome, record identity, and
changed field names only; they never contain field values, prompts, credentials,
provider payloads, or raw errors.

## Approved-release artifact review

The secured data-review runtime applies the same release-bound rule to artifact
access. It accepts only host-derived authenticated principals and opaque
artifact references, validates workspace ownership before storage access, and
allows system policy to narrow but never widen platform roles. Browse/detail
results mask configured metadata and never expose paths, storage keys, provider
payloads, credentials, or parser diagnostics.

Preview policy uses conservative media allowlists plus bounded signature checks.
The application supplies a maximum-byte ceiling that storage enforces before
reading. JSON/CSV parsing is sample-bounded and inert, formula-like cells are
neutralized for display, HTML is never rendered as markup, raster images are
allowlisted, SVG and Office formats are unsupported, and PDF frames are titled
and sandboxed. Allow and denial audit events are bounded and redacted.

## Fail-closed requirements

- Missing sandbox runtime: authored/imported build or execution is unavailable.
- Unknown capability: denied.
- Missing organization/workspace/actor context: denied.
- Stale approval after source/dependency/capability change: invalidated.
- Timeout, quota breach, malformed broker message, cleanup failure, or revoked release: terminate and audit.
- Sandbox diagnostics are bounded and redacted before persistence or transport.

## Deployment capability boundary

Approved releases cross into operational state only through the
`system-deployment` application boundary. The host supplies deployment profile,
host/runtime version, available capabilities, and sandbox qualification; API
and IPC callers cannot override them. Application policy computes a narrowing
intersection for capabilities, opaque secret references, HTTPS egress origins,
duration, memory, output, and concurrency before any adapter call.

Only product-compiled mappings for secured data entry, controlled chatbot, and
secured data review are enabled by the default desktop/server adapter. Unknown,
imported, authored, sandbox-required, thin-client-owned, incompatible, revoked,
or not-ready execution fails closed. Kubernetes Restricted security context,
NetworkPolicy, quota, and immutable image settings are necessary operator
controls but do not qualify a sandbox or authorize executable assets.

## Research basis

- [Electron security guidance](https://www.electronjs.org/docs/latest/tutorial/security)
- [Node permission model limitations](https://nodejs.org/api/permissions.html)
- [WASI capability-based security](https://wasi.dev/)
- [OWASP Secure Coding with AI](https://cheatsheetseries.owasp.org/cheatsheets/Secure_Coding_with_AI_Cheat_Sheet.html)
