# Optional contributor token tracking

The control-plane `usage` commands import authorized numeric counter exports.
They never invoke a model, scan chat histories/logs, estimate from account quotas,
or grant Work/review/roadmap authority. Unsupported hosts remain unavailable.
Imports are optional at existing handoff/completion boundaries; no polling,
extra model call, per-call label or mandatory contributor stage is added.

## Enable local aggregate retention

```text
python dev-tools/helpers/development_control_plane.py usage enable
python dev-tools/helpers/development_control_plane.py usage summary
python dev-tools/helpers/development_control_plane.py usage summary --period daily --limit 31
python dev-tools/helpers/development_control_plane.py usage summary --period weekly --limit 13
python dev-tools/helpers/development_control_plane.py usage summary --period quarterly --limit 40
```

Enabling is explicit consent to local numeric retention. Nothing collects in the
background. Repeating enable is idempotent. Optional initial flags are
`--daily-days` (default 400, range 90–730), `--weekly-weeks` (156, 13–520) and
`--quarterly-quarters` (40, 4–80). Existing retention cannot be changed by enable.
Default quarterly detail spans ten years; lifetime and older-quarter rollups
preserve known totals beyond that window. Days are UTC dates, weeks start Monday
(ISO weeks), and quarters are calendar quarters.

Storage is one compact ignored `.local-codex/control-plane/usage/state.json`,
limited to **4 MiB**, plus a one-byte writer lock. Atomic publication temporarily
needs at most one additional 4 MiB file. Recent numeric detail rotates at 128
observations; day/week/quarter buckets compact to their configured windows.
Lifetime totals, older-quarter rollups and 4,096 sequence cursors survive detail
rotation, so replay cannot charge again. Cursors are not silently evicted.
No separate append-only log or accumulating archive is created.

An import exceeding byte, cursor, input, batch or integer limits is refused
before publication and explicitly not counted. Existing aggregates remain intact;
the caller preserves that export for later handling. The summary warns at 90%
byte/cursor capacity. An interrupted atomic temporary file is preserved and
further imports pause rather than accumulate crash files; status/review and Work
continue. Preserve state and unpublished files for explicit recovery; do not
replace authoritative state with an unverified temporary file.

## Authorized host adapter seam

The normalized `contributor-token-import-v1` schema accepts at most 64 events and
128 KiB per import. No automatic Codex counter integration is claimed. Use only a
host exporter that actually exposes counters and semantics under existing
authority; enabled account quota tools cannot substitute. If none exists, leave
counts unavailable. Write only the explicitly selected ignored numeric input:

```json
{
  "schema_version": "contributor-token-import-v1",
  "events": [{
    "producer": "authorized-host",
    "run_id": "run-one",
    "agent_id": "parent",
    "parent_agent_id": null,
    "counter_epoch": "epoch-one",
    "sequence": 0,
    "counter_mode": "delta",
    "from_zero": false,
    "started_at": "2026-11-24T10:00:00Z",
    "ended_at": "2026-11-24T10:05:00Z",
    "scope": "own",
    "purpose": "mixed",
    "purpose_basis": "unavailable",
    "provenance": "unavailable",
    "model": null,
    "outcome": "unavailable",
    "counts": {
      "input_tokens": {"value": null, "status": "unavailable"},
      "output_tokens": {"value": null, "status": "unavailable"},
      "cached_input_tokens": {"value": null, "status": "unavailable"},
      "reasoning_output_tokens": {"value": null, "status": "unavailable"}
    }
  }]
}
```

```text
python dev-tools/helpers/development_control_plane.py usage import --from .local-codex/usage-export.json
```

The example records unavailable coverage, not measured zeros. Identity/model
labels are bounded simple identifiers and hashed before storage/display. Never
put prompts, responses, tool arguments/output, secrets, private paths or raw host
events in an export. Unknown fields are rejected. This is cooperative local
accounting, not authenticated provider billing proof.

Each count has independent `measured`, `estimated` or `unavailable` status.
Known counts are nonnegative integers up to JavaScript's safe integer bound;
missing values are `null`. Provenance is `host-reported`, `operator-declared` or
`unavailable`; declarations are not independently verified measurements. No
estimator or dollar conversion is supplied. Cached input and reasoning output
are subsets of input/output, never extra usage added to the totals.

Purpose is coarse: `planning`, `research`, `implementation`, `tests`, `review`,
`bookkeeping`, `mixed` or `unclassified`; basis is `declared`, `inferred` or
`unavailable`. Use an existing task/role default and change it only when useful at
an existing boundary. Do not create per-call labels or derive shares from test
duration/files. Purpose basis counts remain separate from numeric status.

## Counting and coverage

- A stream is producer/run/agent/epoch. Sequences start at zero. Delta sequences
  must be contiguous; cumulative sequences can skip observations because their
  difference retains consumption. Reimporting the same latest event is a no-op;
  a conflicting latest sequence refuses the batch. Older sequences are explicitly
  not recounted, even after detail rotation. Batches publish all or nothing.
- Cumulative counters normally establish an uncounted starting baseline. Set
  `from_zero: true` on the first event only when the host establishes zero counters
  within this interval. Inherited/forked history is not new consumption.
  Subsequent intervals start at or after the preceding end. Real failed/cancelled
  attempts and retries count like success; retrying imports does not. Decreases,
  mode/scope changes and resets require a new explicit epoch.
- One epoch remains active per producer/run/agent/scope counter family. Starting
  a new epoch permanently retires earlier epochs in that family for new usage;
  their duplicate/conflict/replay cursors remain. Own and inclusive families are
  independent and never combined. A missing active index can be derived only
  for a single unambiguous epoch per family; ambiguous older data is preserved
  unavailable until explicit recovery, never assigned a guessed latest epoch.
- Unavailable fields retain their last known cumulative baseline. Changed numeric
  status/provenance establishes a new uncounted baseline and exposes unavailable
  coverage. Parent relationships must remain consistent and acyclic within a run.
  Keep each counter family's epochs sequential; do not represent the same consumption in
  overlapping epochs, different producers or different runs.
- Global totals sum only `own` observations. `includes-descendants` and `unknown`
  scopes remain separately inspectable. Parent own plus child own usage can be
  summed once; parent rollups plus children cannot. Missing reported parents and
  unreported descendants remain explicit limitations; the tracker cannot discover
  unknown children itself.
- Attribute each interval to its UTC end date/week/quarter. Multi-day or sparse
  reports are coarse; do not invent daily distributions. Late data outside retained
  periods still contributes to lifetime/older-quarter totals. Empty periods mean
  no reported observations, not measured zeros.

The Work view includes a compact disclosure with seven daily/eight weekly/eight
quarterly buckets, at most sixteen agent aliases and eight purpose groups. CLI
period queries expose the retained range within the requested bounded limit.
The repository-local summary is independent of the current work page and cannot
prove exact per-work attribution, complete account/agent use or billable charges.
Invalid/unavailable storage returns a fixed unavailable summary without breaking
Work or review. Stop importing when collection is unwanted; no background service
continues to write or read exports.

The exact source-owned contributor profile checks numeric storage/import, routing,
Work/evaluation, projection/wire/pagination and all existing DOM cases. It avoids
rerunning the DOM wrapper's entire Python controller. Mixed/unknown scope,
missing support or explicitly required generic checks retain existing fallback.
Synthetic fixtures grant no actual host, model or parent qualification.
