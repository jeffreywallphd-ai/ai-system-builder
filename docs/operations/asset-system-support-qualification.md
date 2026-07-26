# Asset and System Support Qualification

> AI documentation reminder: when behavior in this area changes, update the related architecture docs, context packs, and README files in the same change.

- Status: implemented qualification controls; controlled-profile evidence required
- Machine-readable policy: `dev-tools/config/asset-system-qualification.json`
- Operations: [System Deployment Operations](system-deployment-operations.md), [Persistence Operations](persistence-operations.md)
- Security: [Asset Package, Authoring, Build, and Execution Threat Model](../security/asset-package-authoring-and-execution-threat-model.md)

Repository implementation and production qualification are different states.
The repository gates prove declared invariants on the current source revision.
A deployment profile is `qualified` only when every required check in the
machine-readable profile has passed against the exact product digest. Missing,
failed, or manual evidence never becomes a pass by inference.

## Supported compatibility and deprecation

The qualification manifest is authoritative for the supported definition,
implementation, package, system-lock, schema, host API, runtime ABI, and
deployment combinations. Exact immutable locks win over broad version ranges,
and revocation always overrides compatibility.

- Definition and implementation breaking changes require new major versions.
- Deprecated public behavior remains for at least one minor release, names a
  replacement, and is documented before removal.
- Incompatible removal requires a product major version.
- Package format, system-lock schema, and persistence schema reject unsupported
  newer majors rather than guessing compatibility.
- Imported or authored execution is unsupported and remains
  `sandbox-unavailable`. Only the three closed trusted reference systems are
  executable through the current deployment runtime.
- Windows desktop, macOS desktop, Linux desktop, campus server, and cloud server
  are separate qualification profiles. Evidence from one profile does not
  qualify another.

## Repository and evidence gates

Run the policy and architecture checks on every change:

```text
npm run asset-system:check
npm run architecture:check
npm test
```

An evidence envelope records schema version, profile, source revision, product
digest, timestamp, and checks. Check status is one of `passed`, `failed`,
`not-run`, or `not-applicable`. A passed check also requires an opaque evidence
identifier and SHA-256 digest. Assess an envelope with:

```text
npm run asset-system:check -- --evidence <qualification-evidence.json>
```

The command exits nonzero for both `failed` and `incomplete`. Evidence records
must contain environment identifiers and sanitized results, not credentials,
tokens, prompts, protected content, provider payloads, host paths, or raw user
data. Store the evidence artifact under the owning release-retention policy;
do not commit environment evidence to source control.

## Asset experience qualification

The `asset-experience-automated` check covers representative System Foundation,
imported, and from-scratch Studio lifecycles; exact backing-resource restoration
after restart; base immutability; non-execution; fail-closed validation; modal and
status semantics; and responsive desktop/thin-client presentation. Every
qualification profile requires this automated evidence.

Automated evidence does not replace `accessibility-manual` or `security-manual`.
Use the [Asset Experience Controlled Review](asset-experience-controlled-review.md)
for the reusable keyboard, screen-reader, zoom/reflow, contrast, isolation,
revocation, and non-execution review procedure. Missing controlled evidence keeps
the target profile `incomplete`; it is never inferred from repository tests.

### Visual Composer automated qualification

After producing the Windows package, run both configured one-worker projects or
select one exact host:

```text
npm run package
npm run test:visual-composer
npm run test:visual-composer -- --project packaged-desktop
npm run test:visual-composer -- --project thin-chrome
```

The harness uses a fresh ignored run root for Electron user data and for server
storage/runtime data, drives real preload/IPC and HTTP API clients, bounds startup
and action waits, and writes immutable sanitized evidence beneath
`artifacts/qualification/visual-composer/runs`. It checks the shared create,
layout, pointer drag, keyboard cancellation, undo/redo, configure, preview,
save/reopen, Manage, Build and Test, axe, 320-CSS-pixel reflow, forced-colors,
reduced-motion, and renderer/console-error paths.

The ordinary System Builder preview tests also materialize all three closed
reference templates through the production layout-migration service and compare
the rendered application surface with checked-in, hand-authored semantic HTML
mockups. The comparison ignores CSS classes, styling, and runtime trace IDs but
retains meaningful elements, nesting, labels, controls, states, and text. Run
the focused oracle with:

```text
node --import tsx --test modules/ui/shared/system-builder/tests/SystemReferencePreviewHtml.unit.test.tsx
```

Treat those fixtures as product intent, not generated snapshots. Review fixture
changes as UI-design changes, and first repair definitions, placements,
configuration, or trusted renderers when actual output diverges.

This command qualifies only the exact packaged Windows Electron and configured
local Chrome environments that ran. It does not replace physical touch hardware,
screen-reader product review, manual security review, other platform/browser
profiles, or dedicated performance qualification. A shared-workstation duration
is diagnostic evidence, not a portable performance target.

## Performance qualification

The manifest defines p95 budgets and exact representative workloads for Catalog
browse, Studio validation, implementation resolution, deterministic build,
safe preview, and trusted runtime handoff. A controlled harness supplies a
trusted local probe module with `environmentId`, `sourceRevision`, and one async
probe for each operation, then runs:

```text
npm run asset-system:performance -- --probe-module <trusted-probes.mjs>
```

The runner performs five warmups and thirty measured iterations by default,
uses the Node monotonic performance clock, and emits only sample count, p95,
budget, workload, environment, revision, and pass/fail state. It never emits raw
samples or probe results. At least 20 samples and all six operations are
required. A profile assessment rejects a claimed performance pass unless the
embedded sanitized report validates and every budget passed.

Run timing qualification on dedicated, named hardware with fixed power policy,
runtime version, data fixture, storage mode, and background-load controls. Do
not turn ordinary unit tests into timing gates; host variance would make them
flaky and would not qualify the target environment.

## Admission and availability controls

The manifest consolidates package byte/entry/expansion ceilings, declaration
cardinality, build instance/diagnostic limits, preview/list/table/text limits,
release-manifest size, and runtime duration/memory/output/concurrency ceilings.
`npm run architecture:check` ties each value to an owning source declaration and
fails on drift. These application limits remain mandatory even when a platform
adds stricter quotas.

Package parsing rejects malformed collection shapes, excessive declarations,
paths, links, duplicate normalized names, digest mismatches, unsupported media,
and expansion limits without executing package content. Build, preview, and run
boundaries reject oversized inputs before privileged work. Temporary storage,
process, CPU, network, and sandbox limits still require target-runner evidence.

## Vulnerable package and revocation response

1. Record the advisory source, affected component and version range, first-known
   time, triage owner, and exploitation priority. CISA KEV is a prioritization
   input; it is not an automatic compatibility verdict.
2. Correlate the component to the exact package digest, implementation release,
   SBOM/provenance evidence, system lock, and active deployment. Do not identify
   exposure from a display name or mutable tag.
3. Stop admitting the affected package. Invoke the trusted host's application
   revocation workflow for every affected immutable implementation release;
   revocation mutation is intentionally not available to untrusted renderers.
4. Reconcile affected deployments. Install, activation, health, rollback target,
   and new run start re-read revocation truth. An active deployment that becomes
   revoked is best-effort deactivated, persisted as `revoked`, and denied new
   starts. Unavailable revocation storage also denies the operation.
5. Select, build, approve, install, and activate an unaffected exact release.
   Verify readiness before restoring traffic; never delete a revocation or
   rewrite the affected release.
6. Retain redacted audit/evidence, determine root cause, update dependency or
   admission controls, and repeat compatibility, security, recovery, and
   performance checks appropriate to the change.

The current public asset-implementation transports are read-only. A managed
operator must perform revocation through approved trusted-host maintenance
automation that invokes the application use case; exposing a mutation route
requires a separately reviewed organization/workspace authorization contract.
Until that automation and the controlled revocation drill are evidenced, the
profile remains `incomplete` rather than production-qualified.

## Upgrade, rollback, backup, and disaster recovery

Before upgrade, retain the exact application/package or image digest, database
backup, immutable package/release artifacts, active deployment IDs, schema
versions, compatibility result, and evidence record. Restore into an isolated
environment, verify all content digests, import only through supported monotonic
migrations, and exercise all three reference systems plus activation and
rollback before promotion.

Database backup alone is insufficient. Coordinate structured organization,
workspace, asset, implementation, package, System Builder, build, release,
deployment, run, and audit records with immutable artifact storage. Portable
export is an interchange/recovery aid, not a substitute for a rehearsed native
backup. Follow [Persistence Operations](persistence-operations.md) for SQLite,
PostgreSQL, artifact recovery, import, and destructive-drill safeguards.

RPO, RTO, retention, encryption, failure domain, approver, and recovery owner are
organization-owned inputs. Record observed recovery point and duration; do not
claim an objective merely because a repository test passed.

## Security qualification

Automated evidence includes dependency/SBOM checks, package parser negative
tests, digest and immutable-lock verification, capability narrowing, secret/path
redaction, authorization and tenant denial, route-policy coverage, API/IPC
parity, revocation propagation, sandbox-unavailable denial, interrupted-state
reconciliation, and Electron main/renderer compilation.

Manual review uses OWASP ASVS 5.0 as control vocabulary and must cover package
parser abuse, coding-model tool scope, renderer isolation and sender validation,
capability-broker messages, security-asset narrowing, tenant isolation,
audit/privacy, sandbox escape/egress/resource controls, and target identity/TLS.
Record tested version, environment, technique, result, exception, owner, expiry,
and evidence digest. A checklist is not a penetration test; the profile requires
both `security-automated` and `security-manual` evidence.

## Accessibility qualification

Shared component tests cover native labels and controls, ordered workflow
semantics, keyboard-operable actions, status/log regions, truthful empty/error
states, bounded content, and the Catalog/package, functional preview, Builder,
build/release, deployment, data entry, chatbot, and data-review presenters.

Manual WCAG 2.2 AA review remains required on both desktop and thin-client
surfaces. Test keyboard-only traversal, visible focus, focus order and modal
return, accessible names/descriptions, error association, status announcements,
zoom/reflow, contrast, non-color cues, target size, reduced motion, screen-reader
navigation, and timeout/cancellation behavior with representative data and all
three reference systems. Automated semantic assertions do not establish WCAG
conformance. Record failures and retest evidence; do not mark
`accessibility-manual` passed while exceptions remain unapproved.

## Qualification completion

The repository currently supplies implementation and automated-gate evidence.
Cross-platform desktop packaging, live managed services, coordinated artifact
recovery, load/concurrency/cancellation, sandbox resource limits, target security
review, manual accessibility review, and rehearsed revocation/recovery evidence
remain controlled-environment responsibilities. The machine assessor keeps each
profile incomplete until its exact required checks pass.
