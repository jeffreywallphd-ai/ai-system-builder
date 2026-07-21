# Asset Implementations and Packages

- Status: current
- Implementation: the executable implementation kernel plus bounded package inspection, admission, installation, activation, disable, and rollback workflows are current across desktop and server/thin-client hosts
- Related decisions: ADR-0016, ADR-0018, ADR-0019, ADR-0030, ADR-0031, ADR-0034
- Verification: `docs/architecture/architecture-verification.md`

## Purpose

This architecture adds executable or declarative behavior to semantic assets without placing code in Asset Kernel records. It governs implementation drafts, immutable releases, definition bindings, package inspection/admission, trust, compatibility, and functional system defaults.

## Boundary model

```txt
AssetDefinition (semantic contract)
        |
        | exact reference
        v
AssetImplementationBinding ---- trust/activation policy
        |
        v
AssetImplementationRelease ---- immutable metadata + facet descriptors
        |
        +---- source/package/evidence/SBOM artifacts (opaque storage keys)
        +---- compatibility + capability requirements
        +---- provenance + signature/digest evidence
        +---- revocation/disable policy (separate records)
```

Asset Kernel remains authoritative for definitions, instances, ports, bindings, compositions, requirements, validation vocabulary, and provenance summaries. The implementation family owns source/build/release lifecycles. Artifact storage owns bytes. Runtime adapters own execution.

## Canonical records

| Record                                     | Mutability                   | Scope                         | Responsibility                                                          |
| ------------------------------------------ | ---------------------------- | ----------------------------- | ----------------------------------------------------------------------- |
| `AssetImplementationDraft`                 | mutable with revision token  | workspace                     | authoring intent and current source snapshot reference                  |
| `AssetSourceSnapshot`                      | immutable                    | workspace/organization        | content digest and source artifact descriptor                           |
| `AssetImplementationBuild`                 | immutable attempt record     | workspace/organization        | toolchain inputs, status, bounded log/evidence references               |
| `AssetImplementationRelease`               | immutable                    | workspace/organization/system | facets, digests, compatibility, capabilities, provenance, evidence      |
| `AssetImplementationBinding`               | revisioned policy record     | workspace/organization/system | exact definition-to-release association and activation state            |
| `AssetImplementationRevocation`            | append-only                  | authority scope               | reason, authority, timestamp, affected digest/identity                  |
| `AssetImplementationBackingResourceRecord` | immutable exact-release link | workspace/system              | safe descriptors linking an exact release to one verified source bundle |

The structured records use opaque identifiers, media types, digests, byte sizes, and storage keys. They reject code strings, raw package bytes, source files, filesystem paths, credentials, environment values, provider payloads, and unbounded logs.

Actual implementation backing resources remain in immutable artifact storage.
Their bounded bundle may contain frontend structure, frontend styling, backend
logic, and other definition/source files. The structured record retains only
safe descriptors and the verified artifact identity. System Foundation previews
consume the same canonical declarative resource programs stored for customization;
admitted packages retain their inspected text facet resources. Compiled JavaScript
is visible but read-only, while allowlisted TypeScript/TSX/JSON/CSS/Markdown source
may participate in a reviewed sparse overlay.

## Facets

One release may expose multiple independently compatible facets:

- `ui`: sandboxed browser bundle or trusted built-in UI registry entry;
- `logic`: bounded capability-based operation;
- `workflow`: finite typed orchestration definition or interpreter binding;
- `data`: schema/query/entity behavior through authorized data capabilities;
- `migration`: analyzed migration bundle, applied only by host-owned migration services;
- `policy`: declarative policy compiled by platform policy services;
- `test`: fixtures, contracts, and release qualification descriptors;
- `declarative`: implementation interpreted by a trusted platform engine.

Facet descriptors declare entry identity, ABI/API version, target environment, capability requests, content digest, and artifact reference. They do not contain executable payloads.

## Deterministic resolution

Resolution input is explicit and frozen where reproducibility matters:

- exact definition reference;
- active bindings visible to the workspace/organization;
- deployment profile and host/runtime capability inventory;
- trust/admission policy;
- required facets and port/configuration contracts;
- version and digest lock constraints;
- revocation and disable state.

The resolver returns exactly one permitted release or a safe diagnostic. It never chooses silently among equal candidates, ignores revocation, downgrades outside policy, installs dependencies, or executes code.

## Package lifecycle

```txt
source received
  -> quarantine
  -> bounded inspect (never execute)
  -> digest/signature/provenance/schema/compatibility/capability checks
  -> authorized admission decision
  -> immutable install
  -> scoped activation/binding
  -> disable / rollback / revocation
```

The first supported transport is a bounded JSON `.aisb-package` v1 container with uncompressed base64 entries. Unknown compression, links, and archive extraction are rejected rather than delegated to a general-purpose extractor. Package descriptors align with OCI content-addressed manifest semantics so an organization OCI-registry adapter can be introduced later. Public marketplace discovery remains outside this architecture.

Package parsing must reject absolute/device/traversal paths, links, duplicate normalized paths, invalid names, excessive files, excessive compressed or expanded size, excessive ratios, unsupported algorithms, mismatched digests, duplicate identities, unsupported format/runtime versions, and unknown required capabilities.

## Trust and provenance

Trust is an evaluated result, not a source label:

- `system-trusted`: shipped and digest-locked with the product;
- `organization-approved`: admitted by an organization policy authority;
- `workspace-approved`: explicitly admitted for one workspace where policy permits;
- `quarantined`, `unverified`, `rejected`, or `revoked`: not eligible for activation/execution.

Signature verification, SLSA-compatible provenance, SBOM, dependency scanning, and build evidence contribute to admission. None independently proves code safety. Execution policy still applies after admission.

## Functional foundation

`system.foundation` definitions stay host-neutral. Functional behavior comes from exact bindings to trusted built-in or declarative implementation releases. A default is advertised as usable only when its required facet resolves on the current deployment profile.

Foundation upgrades publish a new immutable pack version. Exact old references continue to resolve if not revoked and retained. Deprecation supplies replacement guidance and support dates; it never rewrites a consumer's lock.

The original `system.foundation@1.0.0` release remains immutable and contains
105 exact semantic definitions. `system.foundation@2.0.0` remains immutable
with 119 definitions: the complete v1 vocabulary at exact v2 references plus
eight application layouts and six page layouts. The current
`system.foundation@3.0.0` release preserves those 119 definition identities at
exact v3 references and adds property-complete presentation schemas, a bounded
root theme contract, and semantic per-asset style overrides. All three releases
are installed and materialized independently; existing workspace activations
and implementation identities are not rewritten, while newly created
interactive systems select v3 by exact reference.

The version-addressed functional-default catalog maps every definition to a
closed entry key, facet, deployment compatibility set, bounded preview fixture,
and trusted built-in or declarative-engine release. The shared Catalog preview
is available to desktop and thin-client renderers and has no external side
effects. Policy and security entries deny by default and request no authority;
platform authorization remains authoritative. Record-form, data-preview, and
basic-assistant composites reference the same lower-level definitions and typed
composition model used by System Builder.

Every definition in all Foundation releases has an exact bounded backing
bundle. Depending on the asset, it contains the canonical frontend structure,
CSS, declarative backend logic, definition JSON, or an appropriate combination.
The v2 layout resources include named-slot structure, logical source order,
responsive area maps, and working grid CSS. V3 resources additionally expose
allowlisted semantic CSS variables and role selectors for theme inheritance;
they never accept raw stylesheet text, arbitrary selectors, or dimensions from
configuration. These resources are persisted as
separate immutable artifacts when trusted built-ins are ensured; they are not
metadata-only placeholders and they do not copy protected host implementation
code into Asset Kernel records.

Trusted built-in initialization is additive. When an exact implementation
release already has a compatible system-owned backing-resource record, host
composition preserves that immutable record and its artifact digest rather than
attempting an in-place replacement. Missing release resources may still be
materialized independently during an upgrade.

Preview classification and backing-resource enrichment do not change the
identity fields of an already-published trusted implementation release. In
particular, facet kind, runtime kind, entry key, compatibility, and deployment
profiles remain stable for an exact release so retained installations continue
to initialize. A change to those runtime semantics requires a new release and
pack identity rather than an in-place seed rewrite.

## Ownership and dependency direction

```txt
contracts/asset-implementation
  <- application ports/services/use-cases
  <- persistence, storage, package, signature, scan, sandbox adapters
  <- desktop/server host composition
  <- API/IPC/preload clients
  <- shared desktop/thin-client UI
```

No UI imports persistence, package parsers, sandbox adapters, or host composition. No implementation contract imports React, Electron, Express, PostgreSQL, SQLite, filesystem, registry, container, or provider types.

## Current implementation status

`AssetImplementationRelease`, facet, binding, artifact, resolver, and package
lifecycle contract families are implemented. A package is quarantined in
immutable artifact storage, inspected without execution, and admitted only
after the stored bytes are reread and reinspected. Workspace admission requires
verified provenance and SBOM evidence plus exact capability consent;
organization admission additionally requires a configured verified signature.
Definitions and implementation releases use same-identity/same-content
idempotency and reject replacement with different content.

Admission also creates one immutable implementation backing bundle per admitted
release from the exact inspected definition and readable facet entries. Workspace
authorization and release visibility govern reads; unsupported/binary resources
remain unavailable rather than being decoded or executed.

The Assets **Import Assets** tab provides a canonical deterministic,
inspector-valid, non-executing `.aisb-package` starter plus complete authoring
guidance and the same three-step inspection, permission review, install,
activate, disable, and rollback workflow in desktop and thin-client surfaces.
The starter download is generated locally and performs no inspection,
installation, network access, activation, or execution. The API routes require
`asset:read` or `asset:write`;
desktop IPC exposes only typed package lifecycle channels. Package browse or
inspection never resolves or executes an implementation. Public registries,
automatic updates, package removal, and public marketplace behavior remain
unsupported.

`docs/asset-package-authoring-guide.md` documents the contract-aligned authoring
sequence, bounded entry descriptors, evidence, and separate trust decisions.

## Research basis

- [OCI Image and Distribution 1.1](https://opencontainers.org/posts/blog/2024-03-13-image-and-distribution-1-1/)
- [SLSA provenance 1.2](https://slsa.dev/spec/v1.2/provenance)
- [Sigstore blob signing bundles](https://docs.sigstore.dev/cosign/signing/signing_with_blobs/)
