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
