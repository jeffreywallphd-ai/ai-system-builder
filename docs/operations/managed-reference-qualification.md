# Owned managed qualification database

- Status: current
- Verification: `dev-tools/scripts/qualification/tests/managed-reference-database.unit.test.mjs`

The managed reference tests use real PostgreSQL, OIDC and verified TLS. An absent
old disposable container is not permission to adopt another database. Preserve
its old private reference and acquire a fresh isolated fixture instead:

```text
node dev-tools/scripts/qualification/visual-composer/managed-reference-database.mjs --acquire
```

This explicit Windows operator requires the existing local Docker Desktop Linux
engine and the already cached fixed PostgreSQL digest. It installs/pulls nothing,
starts no Docker daemon and accepts no image, host, mount, command or database
URL option. It binds the fixed local named pipe, ignoring remote Docker endpoint
environment overrides. Missing prerequisites fail closed.

Successful output contains only `status` and a repository-relative
`database_reference`. Set `MANAGED_REFERENCE_DATABASE` to that exact reference
when running `dev-tools/config/playwright.managed-reference.config.ts`. Keep
sources unchanged during host qualification. The existing host checks ownership,
image and the single loopback port, creates isolated run-specific databases and
least-privilege runtime roles, and exercises actual OIDC/TLS authorization.
Qualification and teardown results remain separate from acquisition readiness.

The existing managed host consumer uses Docker's process environment for its
inspection. Bind that qualification process to the same local endpoint; changing
a global Docker context is unnecessary. In the PowerShell session launching it:

```powershell
$env:DOCKER_HOST = 'npipe:////./pipe/dockerDesktopLinuxEngine'
Remove-Item Env:DOCKER_CONTEXT -ErrorAction SilentlyContinue
```

Do not use a remote endpoint or another fixture to replace a failed ownership
check. This endpoint setting contains no credential and does not modify the
machine's saved Docker context.

The fixture uses a fresh random name and labels, a read-only container filesystem,
UID/GID 999, dropped capabilities, no new privileges, no restart policy, two CPUs,
768 MiB RAM, 128 processes and three bounded tmpfs mounts. It has no host bind or
volume mount. The only published port is PostgreSQL on `127.0.0.1` at an engine
assigned unprivileged port. Startup uses at most thirty readiness probes with a
sixty-second scheduling deadline; each Docker client call has a ten-second bound.
The final probe can finish after the scheduling deadline. Readiness requires
explicit TCP plus an authenticated fixed `SELECT 1` against `qualification_admin`;
the entrypoint's temporary Unix-socket server is insufficient.

Synthetic credentials exist only in the exclusive private `postgres.env` and
the disposable container environment. They are not command arguments, parent
environment mutations, logs or public evidence. Creation requests restrictive
directory/file modes; Windows access still depends on the containing account's
ACLs. This trusted-contributor fixture is not isolation from Docker administrators
or a hostile same-user filesystem actor. Use no real application data.

The private state records each acquired identity before startup. Failure retains
the exact history and attempts to stop only a matching owned container; uncertain
acquisition/cleanup remains explicit. A lost creation acknowledgement retains the
intent/name for inspection, not an invented cleanup success. The operator never
adopts, removes or overwrites a preexisting fixture. Stop an exact new-schema
fixture with:

```text
node dev-tools/scripts/qualification/visual-composer/managed-reference-database.mjs --stop .local-codex/managed-reference/<returned-id>/private-state.json
```

Stop rechecks the complete container ID, name, pinned image and ownership labels,
then confirms stopped state. It preserves private files and the stopped container;
tmpfs database contents are disposable. Unknown, redirected, malformed or foreign
references cannot authorize stopping another object.

Security disposition: `security-relevant`. Protected assets are the local engine,
host files, credentials, unrelated containers and qualification integrity. Inputs
cross local filesystem/Docker boundaries; private records and inspection results
cannot grant arbitrary execution. Negative tests cover foreign ownership,
redirected roots, missing images, broad listeners/mounts, weakened resource or
privilege controls, socket-only startup, failure cleanup and secret redaction.
The owning [asset threat model](../security/asset-package-authoring-and-execution-threat-model.md)
and [security standards](../standards/security-by-design-standards.md) still apply.
This operator does not qualify product/native storage safety or the separately
blocked legacy security review.

The Assets UI journey checks exact published copy rediscovery, semantic detail,
published history and unchanged original bases after real restarts. It does not
assume automatic implementation release/activation or a history-reopen editor.
The derived workflow regression separately recomposes the record, implementation
repository and verified artifact adapter, then checks identical full reviewed
snapshot bytes, overlay descriptors, publication/base identities and foreign
workspace denial. Source persistence remains required; history text alone is
insufficient. Automated keyboard, contrast, reflow and native zoom remain actual
host qualification, not human acceptance tasks.

The keyboard check selects the exact Foundation definition version, because
multiple immutable versions legitimately coexist. Focus contrast samples the
actual composited viewport PNG with verified CSS-to-device coordinates: three points on each straight
outline edge against both adjacent backdrops, with a minimum 3:1 ratio. Clipped,
transparent or mismatched-coordinate observations fail; gradient backgrounds do
not become an assumed solid color. Keyboard trapping, Escape, restored visible
focus, reflow, axe findings and actual native zoom remain separate assertions.
The evidence retains the 24 ratios, measured geometry, device mapping and original PNG with its
SHA-256 for replay; it records the outline observation before asserting it.

The real-host matrix exercises standard1440px, narrow320px and actual native
400% zoom on both Windows Electron and managed Chrome. Each run uses unique
output folders and per-case published identities, preserving prior failures.
Action/navigation waits are bounded10/30seconds; catalog/fixture initialization
has an explicit60second bound. These are functional waits, not performance passes.

Customization target listing uses fresh ordered definition batches of at most250
unique exact identities, avoiding hundreds of concurrent whole-collection reads
against the PostgreSQL pool. A sequential fallback supports single-read adapters.
Missing/revoked/foreign sources and malformed batch results still deny. See the
owning catalog workflow tests and canonical asset-kernel guidance.

Qualification restores the owned desktop window from maximized state before
setting native zoom bounds. Actual Chromium viewport capture avoids the automation
context's cached screenshot clip. PNG dimensions must match real DPR and viewport;
CSS/pinch zoom and narrow-device emulation cannot substitute for native zoom.
Numbered workflow first/active/default screenshots separately verify that card
backgrounds remain unobscured and text contrast meets4.5:1. The rail paints behind
opaque cards without adding per-step stacking contexts. Empty Saved, hovered
primary actions, file-chooser keyboard focus and title/source-badge geometry have
explicit checks in addition to the complete WCAG-tagged rule set. Every
incomplete axe node must be resolved; no unknown observation becomes a pass.

Controlled DOM regressions cover stale target/history/detail results, exact
preferred-target refresh on client replacement, late mutation settlements,
duplicate submission admission and rejected review/abandon recovery. This is UI
ownership and feedback support; backend commands, revisions, publication and
execution authority stay under the existing host controls.

Keep run-specific logs, original PNGs, failed reports, source identities and
cleanup results under ignored qualification artifacts. Link completed local
support through exact receipt/review references in
`docs/operations/roadmap-supporting-work.json`. Local host or fixture results do
not grant a parent pass, final current-candidate qualification, native storage
safety, model/provider qualification or the separately blocked legacy security
review. Canonical roadmaps retain those technical gaps until actually qualified.
