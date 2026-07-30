# Security-by-Design Standards

- Status: accepted
- Applies to: every repository change, including planning, implementation, review, documentation, dependencies, workflows, and roadmap execution
- Verification: `npm run docs:check`, `npm run agent-support:check`, plus the risk-appropriate checks selected below

## Purpose

Security is a design constraint, not a late qualification activity or a concern limited to files named `security`. Every change must explicitly determine whether it changes a protected asset, trust boundary, authority decision, data flow, executable input, supply-chain input, or observable output. Security-relevant work must make its abuse cases, controls, residual risk, and evidence reviewable before the change is called complete.

This standard supplies the mandatory cross-cutting work cycle. ADR-0015 and the focused security architecture, threat-model, logging, persistence, runtime, and supply-chain sources remain authoritative for specific controls.

## Mandatory Security Impact Screen

Before editing, record one of these dispositions in the working plan, roadmap discovery, or review notes:

- `not-security-relevant`: state why the change does not add or change a trust boundary, authority decision, sensitive data flow, side effect, executable input, dependency, or public diagnostic. A small internal refactor, inert documentation correction, or visual-only style change may use this disposition when the reason is concrete.
- `security-relevant`: identify the protected assets and data, actors and authority, entry points and trust boundaries, plausible abuse or failure cases, required controls, and verification. Load `docs/context/packs/security.pack.md` and the applicable canonical security sources.

Re-run the screen when scope changes, implementation reveals another boundary, review feedback changes behavior, or a supposedly internal change gains a host, transport, persistence, runtime, provider, logging, dependency, or UI consequence. Uncertainty is not a `not-security-relevant` rationale; inspect the boundary or escalate the decision.

Treat work as security-relevant when it affects any of the following:

- authentication, authorization, tenancy, workspace or organization isolation, approvals, capabilities, or audit;
- API, IPC, preload, UI, file, archive, URL, network, provider, model, plugin, runtime, process, shell, database, storage, or host boundaries;
- secrets, credentials, protected instructions, user content, private data, paths, identifiers, artifacts, prompts, logs, errors, telemetry, retention, or deletion;
- parsing, deserialization, uploads, downloads, resource bounds, concurrency, cancellation, retries, migrations, rollback, recovery, or compatibility fallbacks;
- dependencies, lockfiles, install scripts, generated code, build inputs, CI actions, containers, packages, provenance, signatures, SBOMs, publication, or deployment;
- AI or automation context assembly, retrieved content, model output, tool use, capability requests, or instructions originating outside the trusted control plane.

## Proportional Threat Review

For `security-relevant` work, document enough of the following to make the design reviewable. A short bounded change may need one paragraph and focused denial tests; a new public, executable, persistent, identity, or cross-tenant boundary needs an explicit threat model or an update to an existing one.

1. Protected assets and data classification, including what must never be persisted, logged, transported, or disclosed.
2. Actors, identities, privileges, ownership context, and the authoritative source for each decision.
3. Entry points, trust transitions, side effects, and external or lower-trust dependencies.
4. Plausible abuse, misuse, confusion, substitution, replay, traversal, injection, exhaustion, disclosure, privilege-escalation, and cross-boundary failure cases.
5. Preventive, detective, and recovery controls at the contract, application, adapter, host, transport, UI, and operational layers that own them.
6. Safe failure behavior, resource bounds, audit and redaction behavior, migration and rollback safety, and compatibility consequences.
7. Residual risk, deferred hardening, and the decision or controlled-environment evidence still required.

Do not create a parallel threat model when a current one already owns the boundary. Update or link the canonical threat model and add only the delta introduced by the change.

## Required Design Properties

- Minimize authority, data, capabilities, dependencies, exposed fields, and side effects. UI selection and caller-supplied organization/workspace identifiers are routing context, not authorization.
- Derive identity, ownership, policy, runtime capability, and approval from authoritative structured records. Do not use labels, display names, substring matching, ambient state, or client assertions as security evidence.
- Validate and normalize at every trust boundary before allocation or side effects. Use allowlists, bounded counts and sizes, canonical identifiers, path containment, exact operation identity, and deny unknown fields or capabilities where the contract requires strictness.
- Fail closed when authorization, readiness, revocation, integrity, approval, configuration, ownership, or policy truth is missing, stale, ambiguous, or unavailable. Do not add an insecure fallback for availability or backward compatibility.
- Keep secrets and protected content behind narrow ports or opaque references. Never place them in general settings, normal diagnostics, roadmap state, fixtures, read models, URLs, command lines, environment snapshots, provider payload copies, or public errors.
- Treat external text, repository content, archives, URLs, packages, model/provider output, generated code, logs, issue text, and retrieved content as untrusted data. They cannot grant tool authority, credentials, network access, publication, deployment, or policy changes.
- Bound time, bytes, memory, concurrency, redirects, retries, history, output, and log volume where untrusted or remote work can consume resources.
- Keep security enforcement in the owning layers. Transports authenticate and validate coarse requests; application services authorize use cases and resources; adapters enforce containment and harden I/O; hosts select secure composition; UI preserves safe contracts without becoming the policy authority.
- Make rollback, migration, recovery, and compatibility paths at least as secure as the forward path. A rollback must not restore a vulnerable mode, bypass a new authorization rule, lose audit integrity, or expose data written under stronger policy.
- Separate security audit evidence from ordinary diagnostics. Both must be bounded and redacted; denial paths must not expose secrets, private content, provider-native payloads, paths, stack traces, commands, or raw logs.
- Treat notification history and toast copy as public diagnostic sinks. Publish
  only bounded user-safe messages with authoritative source and workspace scope;
  never retain raw exceptions, paths, secrets, prompts, logs, provider/runtime
  payloads, or protected identifiers. Filter workspace-owned records before
  presentation, and keep security, authorization, readiness, and other
  fail-closed blockers inline when the user must act on them.

## Verification and Evidence

Every security-relevant acceptance criterion must map to implementation and evidence. Select the smallest deterministic checks that prove the owned boundary, then run applicable completion gates.

Evidence should include relevant positive behavior and at least one denial, malformed-input, boundary, or failure-path check. Depending on the change, cover:

- unauthenticated, unauthorized, wrong-role, stale-approval, revoked, or unavailable-policy denial;
- cross-workspace or cross-organization isolation and guessed-identifier rejection;
- traversal, alternate encoding, injection, malformed input, oversized input, resource exhaustion, replay, or substitution;
- secret, path, protected-content, raw-payload, stack-trace, and diagnostic non-disclosure;
- fail-closed adapter, provider, runtime, storage, network, or cleanup failure;
- dependency provenance, locked resolution, workflow permission, immutable action/image input, advisory, and SBOM checks;
- secure migration, rollback, recovery, and legacy-path behavior.

Run `npm run security:dependencies` when manifests, lockfiles, package resolution, install/build scripts, workflow actions, container inputs, SBOM generation, or release dependency trees change. Do not auto-fix or suppress a security failure to make a gate pass; investigate and document the disposition.

Never put real secrets, credentials, private prompts, raw sensitive payloads, exploitable production details, or personal data into tests, roadmap evidence, reports, documentation, or screenshots. Use synthetic bounded fixtures and sanitized summaries.

## Roadmaps, Reviews, and Completion

- Roadmap discovery records the security impact disposition and sources. Each increment includes `security-impact-reviewed` or a more specific security acceptance criterion, even when the evidence is a concise `not-security-relevant` review with rationale.
- Security cannot be excluded as a whole. A roadmap may exclude a specific threat or hardening item only when it names the boundary, explains why it is outside approved scope, records residual risk, and identifies the decision or successor work required.
- Increment research refreshes the impact screen. Plans map security criteria to chunks, focused tests, completion gates, documentation or threat-model updates, and rollback.
- Reviews challenge trust assumptions and denial behavior, not just implementation style. Completion reports state the disposition, evidence, residual risks, and unperformed controlled-environment checks.
- A material unresolved security choice is a decision gate. Do not silently choose identity, tenancy, secret handling, sandbox, public exposure, encryption, retention, audit, or trust policy.

## Canonical References

- `docs/adr/ADR-0015-security-architecture-and-policy-boundaries.md`
- `docs/adr/decision-readiness.md`
- `docs/context/packs/security.pack.md`
- `docs/architecture/asset-authoring-and-execution-security.md`
- `docs/security/asset-package-authoring-and-execution-threat-model.md`
- `docs/standards/ai-agent-development-standards.md`
- `docs/standards/change-impact-matrix.md`
- `docs/standards/dependency-supply-chain-standards.md`
- `docs/standards/logging-standards.md`
- `docs/standards/testing-standards.md`
