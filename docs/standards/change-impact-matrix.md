# Change Impact Matrix

- Status: accepted
- Purpose: minimum repository impact analysis for implementation and review
- Verification: `npm run docs:check`

Use this matrix before editing. “Inspect” does not mean “change”: it identifies evidence needed to preserve existing contracts and dependency direction. Add narrower checks when the affected area has them.

## Universal Security Impact Screen

Before selecting rows, apply `docs/standards/security-by-design-standards.md` and record `not-security-relevant` with a concrete rationale or `security-relevant` with protected assets, trust boundaries, abuse/failure cases, controls, verification, and residual risk. Apply every matching row; a change does not stop being security-relevant because it lives outside a security folder. Re-run the screen if another boundary appears during implementation.

| Change trigger | Inspect before editing | Likely coordinated updates | Minimum verification |
| --- | --- | --- | --- |
| Domain entity, value object, or invariant | Domain callers, application use cases, serializers/mappers, domain tests | Domain tests; application mapping only when the public shape changes; ADR/architecture for semantic decisions | Focused domain and application tests; `npm test` |
| Contract family or public DTO | Family barrel, API/IPC specializations, application ports, adapters, clients, UI mappers | All typed consumers; contract docs/context; successor ADR for semantic incompatibility | Contract-family invariants, affected transport/client tests, builds, `npm test` |
| Application use case or policy | Owning ports, domain rules, transport callers, host composition, use-case tests | Use-case tests; ports when a real seam changes; outer consumers only as required | Focused application tests plus affected integration tests |
| Application port | Contract alignment, every adapter implementation, host composition, test doubles | Port-family tests, adapters, composition roots, canonical boundary docs | Port invariant tests, adapter tests, host composition tests, `npm test` |
| Persistence record or repository behavior | Repository port, schema/manifest/version, mappers, workspace isolation, host-selected adapter | Migration/version handling, adapter tests, persistence architecture, deployment configuration | Round-trip, malformed/version mismatch, concurrency, isolation, and integration tests |
| Storage or blob behavior | Storage port, key/path resolution, lifecycle/cleanup, metadata persistence, public error mapping | Storage adapters, host root configuration, security/sanitization docs | Path traversal/unsafe input, lifecycle, error-redaction, and host integration tests |
| Runtime/provider integration | Runtime contracts and guards, task registry, installer/readiness, host ownership, sanitized outputs | Adapter, readiness/task lifecycle, host composition, security/logging docs | Adapter contract, lifecycle/timeout/cancellation where supported, readiness, host tests |
| Host composition or lifecycle | Shared composition helpers, selected adapters, runtime/storage roots, shutdown, transports | Desktop/server host wiring and configuration docs; no application/domain policy leakage | Host composition/integration tests and affected app build |
| Server API route | Transport operation/envelope, application use case, security policy, server client, thin-client consumer | Route/client tests, API docs/context, authz and sanitization rules | Success/failure envelope, authn/authz, validation, redaction, server build |
| Electron IPC or preload bridge | IPC operation/channel derivation, handler, preload exposure, renderer client | Contract/handler/preload/client tests and desktop boundary docs | Channel identity, wrong-envelope, exposure allowlist, desktop typecheck/tests |
| Shared or platform UI | UI-facing contract/client, presenter/mapper, accessibility and empty/error states | Desktop/thin-client parity only when requested; UI tests/styles/readmes | Presenter/component tests and affected client build |
| Workspace-owned behavior | Contract request context, clients, all transports, use cases, ports, providers, persistence keys | Every propagation layer and workspace docs/context | Missing-context failure, cross-workspace isolation, same-id non-overwrite, legacy fallback rejection |
| Security boundary or policy | Threat/trust boundary, authn/authz ports, transport enforcement, credential store, audit/redaction | ADR/security architecture, host config, tests, operator guidance | Denial paths, privilege boundaries, secret/path redaction, secure-mode startup |
| New or changed trust/data/execution boundary | Protected assets, actors/authority, entry points, untrusted inputs/outputs, side effects, bounds, rollback and residual risk | Security standard, ADR-0015, applicable threat model, owning contracts/services/adapters/hosts | Positive behavior plus denial/malformed/failure-path, isolation, bounds, and non-disclosure evidence |
| Logging or diagnostics | Logging port, event taxonomy, sanitization, host sink, operational consumers | Logging standard/context and affected tests | Structured shape, level filtering, sink failure, sensitive-data negative assertions |
| Repository script, test runner, or CI | Local command parity, failure/exit semantics, generated artifacts, workflow permissions/actions | `package.json`, contributor/agent docs, workflow and script tests | Direct command, negative fixture where feasible, `git diff --check` |
| Dependency or build configuration | Import sites, lock/version policy, licenses/provenance, runtime compatibility, packaging | Package/build config, CI, security and deployment docs | Clean install/build in affected target; tests; audit findings reviewed rather than auto-fixed |
| Deployment or environment configuration | Desktop/server/thin-client composition, persistence/storage/runtime roots, security mode, secrets, health/rollback | Host config, operator docs, deployment-specific tests and ADR when topology changes | Startup failure/success modes, configuration validation, isolation, build/package checks |
| Canonical documentation only | Corresponding implementation/tests, related ADRs, downstream context packs/readmes, links | Only sources made stale by the correction | `npm run docs:check`; link/structure checks when available |

## Cross-Boundary Ordering

When several rows apply, plan in dependency order:

1. Clarify or approve the decision.
2. Record the security impact disposition and threat/control delta.
3. Define domain semantics and stable contract/port boundaries.
4. Implement application behavior.
5. Implement adapters.
6. Compose in hosts and expose through transports.
7. Update clients and UI.
8. Reconcile canonical docs and downstream context.
9. Run focused checks, builds, and repository gates.

This order describes reasoning and validation; it does not require changing every layer.

## Escalation Triggers

Stop and request a decision before implementation when the change would:

- introduce or reverse an architecturally significant dependency,
- select an unspecified database, tenancy, migration, synchronization, identity, or deployment policy,
- make a deferred or proposed capability publicly supported,
- weaken workspace isolation, authorization, redaction, or compatibility behavior,
- introduce an unresolved trust, identity, tenancy, secret, sandbox, public exposure, encryption, retention, audit, or residual-risk policy,
- require a rollback, migration, recovery, or compatibility path that is weaker than the forward security posture,
- add a new public operation without a clear owning use case and contract family,
- require destructive migration, credential use, production mutation, or publication.

Consult `docs/adr/decision-readiness.md` for known decision gates.
