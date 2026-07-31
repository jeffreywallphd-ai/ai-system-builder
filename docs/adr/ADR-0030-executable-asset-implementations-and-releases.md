# ADR-0030: Executable Asset Implementations and Releases

- Status: accepted
- Date: 2026-07-17
- Deciders: ai-system-builder maintainers
- Related: ADR-0016, ADR-0018, ADR-0019, ADR-0020, ADR-0021, ADR-0022, `docs/architecture/asset-implementations-and-packages.md`

## Context

`AssetDefinition` describes the stable semantic contract for a reusable asset, but executable source, compiled code, UI bundles, migrations, tests, and build evidence have different lifecycles and security properties. Putting those payloads into Asset Kernel records would make metadata unsafe to transport, couple semantic versions to toolchains, and make immutable reproduction impossible.

The product needs trusted built-ins, imported packages, and user-authored implementations across desktop and server deployment shapes. It also needs to show definitions that do not yet have a usable implementation without pretending that they are runnable.

## Decision

Introduce a separate executable-implementation family downstream of Asset Kernel:

- `AssetImplementationDraft` is a mutable, workspace-scoped authoring record that references source snapshots in artifact storage.
- `AssetImplementationBuild` is an immutable build attempt over one exact source snapshot and toolchain profile.
- `AssetImplementationRelease` is an immutable, content-addressed result with one or more typed facets, compatibility declarations, permission requests, evidence references, provenance, and a revocation state.
- `AssetImplementationBinding` associates one exact `AssetDefinition` reference with one exact implementation release under a source/trust policy.
- `AssetImplementationFacet` distinguishes `ui`, `logic`, `workflow`, `data`, `migration`, `policy`, `test`, and `declarative` implementation shapes.
- Source, bundle, package, SBOM, and evidence bytes remain in artifact/object storage. Structured records contain only opaque storage keys, digests, sizes, media types, and safe summaries.
- Release identities and payload digests never change. Corrections produce new builds/releases; disablement and revocation are separate append-only policy state.
- Resolution is deterministic over an explicit definition version, deployment profile, host/runtime capabilities, trust policy, and lock constraints. Ambiguous, revoked, incompatible, or unimplemented candidates block use.
- A definition may remain discoverable when no implementation resolves. Public read models must label it `unimplemented`, `incompatible`, `setup-required`, `blocked`, or `revoked` rather than `ready`.
- Built-in implementations use the same release/binding contracts as imported and authored implementations. Trust changes policy and execution placement, not the domain shape.

Compatibility uses independent semantic versions for definition contracts, implementation releases, package format, host API, runtime ABI, and system-release format. Compatibility ranges are explicit; implicit `latest` is forbidden in frozen builds.

## Consequences

### Positive

- Semantic asset metadata remains safe, stable, and transportable.
- Reproducible builds can lock exact implementation and evidence digests.
- Built-in, imported, and authored implementations share one resolution model.
- Revocation does not rewrite historical releases.

### Negative

- More record families, ports, persistence, and lifecycle states are required.
- Definition publication and implementation publication are separate user-visible actions.
- Garbage collection must retain anything referenced by a release, build, or audit record.

### Follow-up

- Implement the contract family, repositories, storage ports, resolver, persistence adapters, and safe read models in Increment 1.
- Add compatibility and deprecation qualification in Increment 11.
