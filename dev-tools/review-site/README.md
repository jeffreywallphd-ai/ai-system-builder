> AI documentation reminder: when behavior in this area changes, update the related ADRs, architecture docs, context packs, and README files in the same change.

# Dynamic Development Review

Start through the unified contributor entry point:

```text
python dev-tools/helpers/development_control_plane.py review-site start
```

Share the returned verified loopback URL with the user. The buildless UI polls
`/api/review` every five seconds. `development-review-v1` derives only from
versioned roadmap JSON and local controller JSON. No Markdown parsing, build,
external fonts, analytics, credentials or hosting service is required.

Work items include the planned chunks projected from roadmap JSON and separate
execution records. Each increment shows its ordered chunks, recorded completion,
criterion links and verification notes. Use "View these work items" to filter
the Work items tab, or "View parent increment" to navigate back. Criterion
qualification and chunk completion are tracked independently; legacy chunk
declarations do not acquire execution receipts.

Criteria show parent qualification separately from reviewed local supporting
work. The fixed JSON map in `docs/operations/roadmap-supporting-work.json` links
actual completed receipt/review lineages without granting current qualification
or completing planned chunks. Long qualification badges wrap inside their own
column in narrow review panels. Agent-only labels distinguish automated technical
checks from archived offline human acceptance; genuine technical gaps stay pending.

Roadmaps and work items appear newest first by creation time, regardless of
status or later updates. Chunks use their plan's recorded time, falling back to
increment start or roadmap creation for legacy data. Equal-time chunks retain
their increment/plan order; missing or invalid creation dates sort last.

`/api/status` identifies the repository and local server instance. GET/HEAD
routes are fixed; the server checks Host/Origin, has no CORS or mutation API,
and never serves repository files. Local output omits private authority notes,
raw logs and paths. Read `docs/architecture/ai-development-control-plane.md`
and the contributor threat model before changing exposure or data fields.

Focused tests live in `dev-tools/helpers/tests/test_control_plane_site.py`;
browser behavior is covered by the contributor Node tests. Use `review-site
status` for readiness and `review-site stop` for explicit, identity-checked
shutdown. A localhost isolation policy may require the host's normal approval
mechanism; keep the binding on numeric loopback.

## Readable complete proposals

Affected criteria have an always-visible **Blockers** subsection naming the actual
obstacle, the operation it prevents and the needed action. The fixed
`docs/operations/roadmap-blocker-presentation.json` map binds exact criterion
identity/current description and a fresh still-open canonical blocker digest.
Summary and action come from current roadmap JSON; the reviewed association adds
only a bounded operation explanation. Missing/stale/resolved/foreign mappings
diagnose and retain the parent **Why blocked** disclosure. Ordinary pending
verification is independent from obstacle presence and never becomes a pass.

Each increment shows bounded JSON dependencies, work packages, deliverables, verification,
rollback and exclusions in **Increment proposal details**. Planned packages are
separate from recorded implementation chunks. An unapproved proposal explains
that chunk planning follows approval; an approved pending increment explains
that its chunk plan is created when the increment starts. Neither invents work
or changes qualification.

Acceptance uses explicit nested requirement arrays from
`docs/operations/roadmap-criterion-presentation.json`. Shared conditions and
predicates remain with their requirements; alternatives stay together. Every
bullet shares its criterion's single result. **Original criterion wording**
retains the complete canonical text. The fixed presentation file is bounded,
identity/source-description SHA-256 bound and must reconstruct the exact ordered
canonical wording after whitespace normalization. Stale, malformed or altered
entries fall back to the complete sanitized original as one bullet. No runtime
punctuation heuristic or Markdown parser is used.

Roadmap display labels show Pending for canonical ready, In progress for
executing and Awaiting approval for roadmap-review. Actual open blockers
remain Blocked; a blocked record with an explicit zero blocker count
keeps its source status and shows a needs-review note. The accessible
status key above Open Roadmaps explains these labels and pending
qualification without changing criteria or granting authority. Labels never change
canonical workflow state, ordering, approval or start authority.

The status key also explains Technical check pending, missing evidence,
passed/failed checks, scoped reviewed support and intermediate skill
states. Pending verification is distinct from a recorded blocker.
Execution records are sorted by original creation before the finite
1,000-record display limit and a byte admission limit below the unchanged
2 MiB response bound. The API exposes total/shown/truncated facts
and a diagnostic if either limit is exceeded; current work beyond the old
200-record cap remains visible without exposing private record fields.
Linked work resolves full requirements, evidence and blockers from its exact
roadmap/increment/criterion identity in the same response, avoiding duplicate
criterion payloads. Older rich work records remain a display fallback.

## Plain-language blocker explanations

Optional `plain_language` copy on an existing blocker reference contains exactly
`needed` (400 characters), `prevents` (800) and `action` (800). The same current
criterion-description and still-open canonical blocker digest checks govern this
copy. Shared blocker explanations must agree; conflicting or invalid copy falls
back to canonical facts with a diagnostic. Sanitization and inert text rendering
remain mandatory. No copy changes status, authority or qualification.

Parent and affected-criterion views show **What’s needed**, **Why it matters** and
**What to do**, followed by expandable **Technical details** retaining the original
canonical summary/action and criterion-specific operation explanation. Historical
technical wording can predate newly supplied access; primary copy must accurately
distinguish authorized access from successful verification. Do not ask for access
again when it has been supplied, or imply it works before an actual check passes.
