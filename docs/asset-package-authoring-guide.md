# Asset Package Authoring Guide

This guide explains how to create the bounded JSON `.aisb-package` v1 files
accepted by AI System Builder. Package inspection reads and verifies content;
it never executes package entries. Admission, installation, activation, build,
deployment, and execution remain distinct policy-controlled operations.

Canonical architecture and security requirements remain in
`docs/architecture/asset-implementations-and-packages.md`,
`docs/architecture/asset-authoring-and-execution-security.md`, and
`docs/security/asset-package-authoring-and-execution-threat-model.md`.

## Start from the downloadable package

1. Open **Assets**, select **Import Assets**, and choose **Download
   .aisb-package starter**.
2. Save the file with the `.aisb-package` extension and edit it as UTF-8 JSON.
3. Replace every `org.example` identity and every example display or publisher
   value. The downloaded starter is intentionally non-executing and contains
   no asset definitions or implementation declarations.
4. Add the semantic definitions, implementation declarations, entries, and
   evidence described below.
5. Return to **Import Assets**, choose the completed file, and review every
   inspection issue and capability request before admission.

The download is generated locally from the canonical contract. It does not
contact a registry, inspect or install a package, activate an asset, or run code.

## Container shape

The root object has three bounded areas:

- `mediaType`: exactly
  `application/vnd.ai-system-builder.package.v1+json`;
- `manifest`: package identity, semantic definitions, implementations,
  dependencies, deployment profiles, capabilities, and evidence references;
- `entries`: uncompressed base64 content with safe relative paths, media types,
  exact byte sizes, and `sha256:` digests.

The container is JSON, not a ZIP or general archive. Links, compression,
absolute paths, device paths, traversal, duplicate normalized paths, unknown
media types, invalid base64, size mismatches, and digest mismatches are rejected.
Default inspection limits are 32 MiB per package, 128 entries, 8 MiB per entry,
and 64 MiB total decoded content. Treat those as hard compatibility limits, not
upload targets.

## Authoring sequence

### 1. Define exact package identity

- Keep `formatVersion` at `1.0` for this container version.
- Use a stable lower-case namespaced `packageId`, such as
  `org.example.student-support`.
- Use a semantic version such as `1.0.0`; never replace different content under
  an existing package identity and version.
- Match `semanticManifest.packId` and `semanticManifest.version` to the package
  identity and version.
- Keep imported semantic manifests marked `sourceKind: imported`,
  `sourceLayer: imported-pack`, and `trustStatus: unverified`. Trust is derived
  by policy and evidence; package text cannot declare itself trusted.

### 2. Add semantic definitions

Add each complete `AssetPackAssetEntry` to `semanticManifest.assets`. Use stable
entry and definition identities, exact definition versions, safe classifications
and metadata, and matching definition references. Keep secrets, tokens, host
paths, provider payloads, signed URLs, source bytes, prompt text, and runtime
payloads out of semantic definitions and general metadata.

An implementation may only reference a definition that is present in the same
package. Definitions without an implementation remain semantic-only assets.

### 3. Add bounded entries and implementations

For every entry:

- use a forward-slash relative path without empty, `.` or `..` segments;
- choose an allowed media type: JSON, JavaScript, WebAssembly, SPDX JSON,
  CycloneDX JSON, in-toto JSON, Sigstore bundle JSON, CSS, plain text, or opaque
  octet-stream;
- base64-encode the exact bytes without a data-URL prefix;
- set `sizeBytes` to the decoded byte length;
- set `digest` to `sha256:` followed by the lower-case SHA-256 digest of those
  exact bytes.

Each implementation declaration needs a unique release ID, an exact definition
reference and version, and one or more bounded facets. A facet declares its kind,
supported imported runtime, stable entry key, optional package entry path,
required capabilities, and compatibility. Never use the system-only
`trusted-built-in` runtime for imported content.

### 4. Declare compatibility and authority

- List only supported deployment profiles that the package is designed and
  tested for.
- Declare dependencies with exact package identities, conservative version
  ranges, and whether each dependency is required.
- Keep requested capabilities unique and minimal. Every requested capability
  needs explicit consent during admission, and runtime policy may still deny it.
- Do not assume dependencies are installed, code is built, or capabilities are
  granted during inspection.

### 5. Attach evidence

Add and reference an SPDX or CycloneDX SBOM and an in-toto/SLSA-compatible
provenance statement. Evidence paths must identify entries in the same package,
and provenance subjects must bind to the inspected package digest. Add a
supported signature bundle when the target admission policy requires one.

Evidence supports a trust decision; it does not prove code safety and never
bypasses inspection, authorization, sandboxing, or runtime policy.

### 6. Inspect, admit, install, and activate separately

The Import Assets workflow performs these explicit steps:

1. inspection validates bounds, paths, media types, identities, definitions,
   implementations, digests, compatibility, capabilities, and evidence without
   execution;
2. admission records the exact package digest and explicit capability consent;
3. installation stores immutable definitions and implementation releases for
   the selected workspace;
4. activation is a separate reversible action; disabling or rollback does not
   rewrite the immutable package.

Fix every inspection error before admission. Warnings and missing evidence must
be evaluated against the target workspace or organization policy. Public
marketplace discovery, automatic updates, implicit dependency installation, and
automatic activation are not supported.

## Reference specifications

- [OCI Image and Distribution specifications](https://opencontainers.org/)
- [SLSA provenance](https://slsa.dev/spec/v1.2/provenance)
- [in-toto attestation framework](https://in-toto.io/)
- [SPDX specifications](https://spdx.dev/use/specifications/)
- [CycloneDX specifications](https://cyclonedx.org/specification/overview/)
- [Sigstore bundle formats](https://docs.sigstore.dev/about/bundle/)
