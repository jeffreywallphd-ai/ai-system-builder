# Optional deterministic contributor support

Use the existing [control plane](ai-development-control-plane.md) for claims,
checks, actual review and completion. Its optional `support` commands replace
copied bookkeeping scripts with bounded data. Each invocation makes one pass.
They never execute checks, retry work, mutate Git, apply roadmap events, supply
reviewer judgment or qualify a parent. Normal Work requires no support stage.

```text
python dev-tools/helpers/development_control_plane.py support handoff --from .local-codex/support-request.json
```

Requests use this common envelope. Add only fields documented for the selected
operation. Keep requests and results private and ignored. Never select credentials,
private prompts, provider payloads or sensitive artifacts. No directory scan,
shell command, arbitrary executable or absolute path is accepted.

```json
{
  "schema_version": "contributor-support-request-v1",
  "work_id": "current-work",
  "packet_id": "unique-handoff-1",
  "references": [
    {"path": ".local-codex/selected-evidence.json", "sha256": "replace-with-actual-sha256"}
  ]
}
```

Omit `references` when none are needed. Select at most 64 exact pinned references.
The helper reads no reference contents into reports: only paths, size and hash.
Source selections must remain within the selected Work's scope. Paths must be
canonical and contained, with no symbolic link, reparse or hardlink redirection.
Each source file is at most 32 MiB; explicit reads total at most 64 MiB. Requests
are at most 64 KiB. Complete packets retain the existing 8 MiB bound. Narrow the
selection on overflow; do not raise limits or remove historical evidence.

## Evidence prepare, freeze and export

`prepare` captures current source/HEAD, exact raw selected-file hashes, absence
facts, work/authority identities and compact unrelated-record digests. Add `paths`
to select up to 200 exact owned files; otherwise changed files are selected, then
the write scope when no files changed. A directory scope needs exact `paths`.
Optional boolean `include_preimages: true` embeds base64 source preimages in the
private packet. It is off by default. Artifact bodies are never embedded.

`freeze` captures the current candidate and canonical check plan without requiring
that checks have run. `export` requires an actual current qualifying receipt and
exports it unchanged; an existing current separate review is included unchanged.
A missing review produces an advisory and creates none. Both accept `paths` and
an optional `before` reference to a prepare packet. That reference verifies HEAD,
scope/authority, protected references and unrelated records remained consistent.

```json
{
  "schema_version": "contributor-support-request-v1",
  "work_id": "current-work",
  "packet_id": "unique-freeze-1",
  "before": {"packet_id": "unique-prepare-1", "packet_digest": "replace-with-returned-packet-digest"}
}
```

## Transition observations

Use `transition-before` with `transition: "review"` or `"complete"` immediately
before the ordinary canonical operation. It captures own-work preimage and
unrelated-record/source/reference identities. After that one real operation,
use `transition-after` with its `before` packet reference. It proves the exact
allowed review append or completion change and one Records revision increment.
Concurrent unrelated mutations, stale proof and extra changes refuse. The proof
observes actual canonical history; it cannot create an independent reviewer,
approve findings, authorize completion or authenticate a local actor.

## Owned checkpoint planning

`checkpoint` accepts optional exact `paths` and pinned `references`. It requires
completed current Work, accepted review and no live source claim. The full union
of tracked and nonignored untracked changes must equal the owned paths. It checks
conflicts, unrelated staged work, attributes and any staged normalized blobs
against current bytes. A clean index is valid. A partial or mixed index needs
explicit owned-hunk handling outside this helper. Binary/custom-encoding staging
also stays outside this text preflight. Diff discovery explicitly uses the same
CRLF-to-LF text normalization as the blob comparison, independent of system Git
configuration. Raw source identities remain unchanged.

Every nonmanaged owned file's observed presence/hash must match the captured
candidate. The plan is an advisory about those observations in this invocation;
hashes do not establish simultaneous filesystem immutability. Revalidate source,
ownership, index and authority at any later actual Git action through the existing
checkpoint procedure. A retained plan cannot authorize or replace that validation.

The result is a data-only plan. Dependency closure, meaningful chunk boundaries
and actual Git permission still need judgment under the roadmap skill's existing
checkpoint procedure. This command performs no staging, commit, fast-forward,
push, history change, primary-checkout operation or main/release advancement.

## Progress preparation and pure replay

`progress` needs roadmap-bound Work and one to eight explicit `events`, using only
the existing `work-chunks-reconfigured` and `chunk-recorded` event types. It loads
state with the canonical engine's `load_state`, including its current codec. For
refinement, omit `expectedPlanDigest` to derive the fingerprint of the complete
stored plan. A supplied stale/internal fingerprint refuses.

Supply `incrementId`, `plan`, `authorityRef` and `reason` for reconfiguration;
chunk recording needs `chunkId`, `summary` and a nonempty `areas` list. Known
missing or empty required fields return `needs-input` with exact `events[i]`
field paths. The authority reference must come from the actual authorized work.
Replacement event plans must omit stored-only `recordedAt`, `fingerprint` and
`outlineOnly`. A fixed `stored-plan-metadata` diagnostic names those fields;
remove them explicitly. The helper never strips input or infers permission.
These advisories create no packet, live event or qualification. Other canonical
engine refusals retain a fixed generic message without echoing private errors.

The canonical engine replays events in memory and validates each result. The
helper checks unchanged approval/evidence/obligations, other increments, original
completed definitions/order and existing history. The packet provides prospective
chunk/criterion/status projection facts and a deterministic rendering hash. It
does not publish a live review-site projection or apply events. Review semantic
coverage and actual component evidence, then use the normal governed CLI for
authorized publication. A count or component commit alone supplies no pass.

## Compact handoff

`handoff` returns selected-work candidate identities, claim owner/expiry, criterion
IDs, selected checks, receipt currentness/outcomes, open finding IDs and explicit
artifact references. It omits raw outcome/review prose, claim tokens and logs.
Failed and historical receipts remain visibly distinct. Without `packet_id`, it
returns this compact advisory directly; no output file is written.

Other operations need a unique `packet_id`. Packets publish exclusively under
`.local-codex/control-plane/support/<packet_id>.json`, with a canonical content
digest and explicit no-authority/no-qualification fields. Existing or partial
files are retained, never overwritten or adopted. Missing descriptive input is
not a new gate: actionable `needs-input`/advisory results leave normal Work usable.
Ownership, integrity, authority and actual receipt boundaries still fail closed.

The local cooperative trust model is unchanged. Hashes are consistency witnesses,
not authenticated review or hostile-writer isolation. Within-call read reuse is
bounded and checks file identity; no authoritative persistent source cache exists.
Turning off optional support leaves the existing workflow and evidence intact.

Run its focused model-free behavior and denial checks with:

```text
python -m unittest discover -s dev-tools/helpers/tests -p test_control_plane_deterministic_support.py
```

For the exact helper, helper tests, this guide, catalog and focused-routing test
scope, the catalog uses native unittest module filters to execute the helper and
focused-routing regressions. Its actual command is stored in the plan/receipt.
Partial, mixed or shared-source changes, missing/nonregular required support,
and explicit generic `focused-tests` requests retain the full controller gate.
