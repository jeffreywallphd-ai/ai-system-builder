# Dependency and Supply-Chain Standards

- Status: accepted
- Verification: `npm run security:dependencies`, `npm test`

## Purpose

Dependency resolution, automated workflows, and release inputs are executable
parts of the product supply chain. They must be reproducible, reviewable, and
covered by fail-closed checks without disguising unresolved risk as an automatic
upgrade.

## Dependency resolution

- `package-lock.json` is tracked and is the authoritative npm dependency tree.
- CI and container builds use `npm ci`; they must not resolve a new dependency
  tree with `npm install`.
- Dependency changes include the manifest and lockfile in the same review.
- Runtime source imports only dependencies declared directly by the applicable
  root or workspace manifest; incidental access through a tool's transitive tree
  is not an application dependency boundary.
- Install lifecycle scripts remain disabled in validation and server-image
  dependency stages unless a separately reviewed build step requires them.
- Major runtime or packaging-tool upgrades require compatibility testing; do not
  apply `npm audit fix --force` or an unreviewed bulk remediation.

When a patched transitive package has intentionally changed its public module
shape, a build-tool-only compatibility package may preserve the legacy interface
while delegating all implementation behavior to an exact patched upstream
release. Such a package must remain local, contain no independent parsing or
expansion logic, expose only the interfaces required by reviewed consumers, and
have focused tests for both the legacy consumer and the current interface. Remove
the compatibility boundary when every dependent tool supports the patched
upstream interface directly.

## Advisory policy

`npm run security:dependencies` evaluates two scopes:

- the production/runtime tree fails on any known advisory,
- the complete development toolchain also fails on any known advisory.

The scopes remain separate so runtime exposure and build/package exposure are
visible independently, but neither scope may carry known advisory debt. When an
upstream range has not adopted a patched transitive release, a narrow exact npm
override is permitted only after its affected command paths pass compatibility
tests. Network or malformed-registry responses fail the check rather than
producing a false pass.

## SBOM and workflow integrity

- The dependency security check generates and validates a production SPDX 2.3
  SBOM from the locked tree. Release automation may retain or attest that output;
  local validation does not write it into source control.
- The same gate validates the direct conditional Python decoder inventory and
  the baseline model-loading, lazily installed text-training, and managed
  Context LanceDB inventories from the worker requirements files, including the
  exact PEFT version shared by LoRA inference and training, exact LanceDB and
  PyArrow pins, supported Python ranges or markers, Package URLs, and reviewed
  license identifiers. Dependabot monitors that requirements directory. These
  direct inventories do not claim to replace a
  deployment-generated full Python environment SBOM or image scan.
- Third-party GitHub Actions are pinned to full commit SHAs.
- Production and qualification container base images are pinned to full OCI
  digests. Tags remain alongside the digest for review clarity; automated Docker
  updates must refresh the reviewed digest rather than silently following a tag.
- Workflow permissions are least privilege and checkout credentials are not
  persisted when no later push is required.
- Dependabot proposes npm, GitHub Actions, and server Docker input updates for
  review; it does not merge or deploy them automatically.

## Asset implementation vulnerability response

Imported asset packages and their implementation releases are separate from the
product npm dependency tree, but use the same fail-closed principles. Correlate
an advisory to exact package, SBOM, provenance, implementation-release, system
lock, and deployment digests. Stop admission and revoke affected immutable
releases; never rewrite a release, trust a mutable tag, auto-upgrade an admitted
package, or treat provenance as proof of safety. Deployment operations re-read
revocation truth and deny when that truth is unavailable. The controlled
response and evidence procedure is
[Asset and System Support Qualification](../operations/asset-system-support-qualification.md).

## Review checklist

- Does the lockfile match every workspace manifest?
- Does `npm ci` succeed without modifying the tree?
- Are production and complete-toolchain advisories both at zero?
- Is every workflow action immutable by full commit SHA?
- Are build/runtime base images and qualification service images immutable by
  digest, and does the image scan block fixed critical findings?
- Were build, package, and runtime compatibility checks selected for the affected
  dependency rather than assuming semantic-version compatibility?

## References

- [AI Agent Development Standards](ai-agent-development-standards.md)
- [Change Impact Matrix](change-impact-matrix.md)
- [Deployment Qualification](../operations/deployment-qualification.md)
