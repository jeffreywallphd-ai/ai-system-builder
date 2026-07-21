# ADR-0034: Functional Foundation Pack Evolution

- Status: accepted
- Date: 2026-07-17
- Deciders: ai-system-builder maintainers
- Related: ADR-0016, ADR-0018, ADR-0019, ADR-0020, ADR-0023, ADR-0030, ADR-0033, `docs/architecture/asset-implementations-and-packages.md`

## Context

`system.foundation` began as trusted semantic definitions and now supplies exact,
bounded backing-resource releases for supported renderer, logic, data, policy,
and workflow facets. A system-construction product needs defaults that are
genuinely usable while keeping definitions host-neutral and avoiding hidden
feature-specific code paths.

## Decision

- Evolve `system.foundation` through versioned manifests. Existing versions remain immutable; compatibility and deprecation metadata guide upgrades.
- Every advertised functional default has a complete semantic definition plus one of: a trusted implementation release, a supported declarative-engine binding, or a truthful unsupported state for the current host.
- Trusted built-in implementation IDs map through a closed host registry. Definitions never embed React components, functions, SQL, routes, credentials, or executable bytes.
- Minimum families cover shell/layout/page/display, data/schema/query, form/input/action, security/policy/audit, artifact/preview, model/context/conversation, finite workflow/logic, and test/mock/observability declarations.
- Composite defaults such as CRUD forms, chatbot features, and data-review features are built from lower-level assets and typed bindings. They may not hide a second composition model.
- Defaults include configuration schemas, ports, requirements, AI context, examples, preview fixtures, contract tests, error/loading/empty/unsupported states, accessibility expectations, and compatibility evidence.
- Security defaults fail closed and can only narrow platform authority. Data defaults operate through authorized application capability ports, never direct renderer persistence.

## Consequences

### Positive

- Catalog entries are useful construction parts rather than structural shells.
- Host-specific behavior remains replaceable behind stable implementation bindings.
- Reference systems exercise the same assets available to users.

### Negative

- Foundation releases require stronger compatibility and regression testing.
- Some assets need multiple host facets or explicit incompatibility states.

### Follow-up

- The minimum functional kit and exact backing resources were delivered for v1
  and v2. `system.foundation@3.0.0` adds property-complete presentation schemas
  and bounded semantic styling while preserving the exact v1/v2 artifacts.
- Continue to qualify every advertised default and require a new immutable pack
  version for future schema, renderer, or runtime-semantic changes.
