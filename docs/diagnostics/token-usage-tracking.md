# Optional contributor token tracking

The control-plane `usage` commands import authorized numeric counter exports.
They never invoke a model, scan chat histories/logs, estimate from account quotas,
or grant Work/review/roadmap authority. Unsupported hosts remain unavailable.
Imports are optional at existing handoff/completion boundaries. Coding-session
initialization validates capture once and never gates work; no polling, extra
model call, per-call label or approval stage is added.

## Coding-session initialization and real capture

```text
python dev-tools/helpers/development_control_plane.py usage session-start
python dev-tools/helpers/development_control_plane.py usage session-start --session selected-session
python dev-tools/helpers/development_control_plane.py usage capture --session selected-session
```

The startup command uses only the known `CODEX_THREAD_ID` reference unless
`--session` is supplied. It validates and receives one explicitly configured
numeric batch. Without a host bridge it returns `state: unavailable`,
`reason_code: capture.host-bridge-not-configured`, `live_capture: false` and
`work_may_continue: true`. It creates no placeholder observations. An explicit
capture error is a failed import; startup reports the same failure without
blocking feature work. Report unavailable/stale coverage once and continue.

`adapter_ready: true` means the receiver is installed, never that collection is
running. `adapter-ready` has no observations; `baseline-only` has an uncounted
starting cumulative sample. `recent-actual-events` means at least one selected
thread has a counted numeric delta ending within 900 seconds; `stale-actual-events`
has only older deltas. Counts of recent, stale, baseline and missing selected
threads expose partial coverage. Identical counter snapshots never refresh
freshness. This is recent source data, not proof of a continuously running host,
source authentication, complete coverage or billable usage.

**Current desktop bridge limitation:** the available app tools expose chat
metadata and quota percentages, but no selected-chat input/output counters or
subscription to numeric notifications. This receiver does not attach to the
existing desktop host. Automatic capture of those sessions remains unavailable
until that host exposes an authorized numeric-only callback/export. Do not start
a duplicate App Server, scan its private logs/history or infer tokens from context
budgets, account quotas or goal budgets. Existing unavailable imports are not
capture. No estimator is supplied.

For future separately owned CLI sessions, official
[non-interactive JSON output](https://developers.openai.com/codex/noninteractive)
includes `turn.completed.usage`. The current public
[JSONL processor](https://github.com/openai/codex/blob/main/codex-rs/exec/src/event_processor_with_jsonl_output.rs)
builds those values from cumulative thread totals; never sum them as per-turn
deltas without a version-qualified source contract. That stream also includes
conversation/tool payloads, so a future producer must filter allowed numeric
metadata in memory without retaining raw events. This receiver accepts the
App Server shape below, not a raw CLI stream. Starting a new CLI job does not
measure an existing desktop chat; no CLI/model call is needed for startup validation.

The supported input shape follows the official
[App Server notification documentation](https://developers.openai.com/codex/app-server)
and public protocol declarations for
[thread notifications](https://github.com/openai/codex/blob/main/codex-rs/app-server-protocol/schema/typescript/v2/ThreadTokenUsageUpdatedNotification.ts),
[cumulative totals](https://github.com/openai/codex/blob/main/codex-rs/app-server-protocol/schema/typescript/v2/ThreadTokenUsage.ts)
and [six counter fields](https://github.com/openai/codex/blob/main/codex-rs/app-server-protocol/schema/typescript/v2/TokenUsageBreakdown.ts).
The producer must verify its source version, real cumulative-provider semantics,
selected threads, reset epoch, counter scope and known parent links. Public
protocol shape alone does not qualify a particular installed host. Unknown scope
must stay `unknown`; use `own` only with established noninclusive semantics.

Opt in with the following **synthetic schema example**, replacing identifiers
only from authorized metadata. Store regular ignored JSON files under
`.local-codex/token-capture/`; no prompts, responses, messages or tool payloads.
The receiver reads one config (32 KiB, at most 64 thread bindings) and one feed
(128 KiB, at most 64 events). The external producer must replace that fixed feed
atomically, retain unacknowledged numeric samples on refusal, and avoid accumulating
files. It may invoke `usage capture` at existing event/handoff boundaries; the
repository starts no service and adds no timer or model call.

`.local-codex/token-capture/config.json`:

```json
{
  "schema_version": "codex-token-capture-config-v1",
  "protocol": "codex-app-server-v2-six-token-fields",
  "source_version": "verified-host-version",
  "counter_semantics": "cumulative-provider-counters",
  "session_id": "selected-session",
  "feed_path": ".local-codex/token-capture/feed.json",
  "threads": [{
    "thread_id": "selected-thread", "parent_thread_id": null,
    "counter_epoch": "host-lifetime-one", "scope": "unknown",
    "purpose": "mixed", "purpose_basis": "unavailable"
  }]
}
```

`.local-codex/token-capture/feed.json`:

```json
{
  "schema_version": "codex-token-feed-v1",
  "session_id": "selected-session",
  "source_version": "verified-host-version",
  "events": [{
    "observed_at": "2026-11-24T10:00:00Z",
    "notification": {
      "method": "thread/tokenUsage/updated",
      "params": {
        "threadId": "selected-thread", "turnId": "selected-turn",
        "tokenUsage": {
          "total": {"totalTokens": 120, "inputTokens": 100, "outputTokens": 20,
            "cachedInputTokens": 10, "cacheWriteInputTokens": 0, "reasoningOutputTokens": 5},
          "last": {"totalTokens": 120, "inputTokens": 100, "outputTokens": 20,
            "cachedInputTokens": 10, "cacheWriteInputTokens": 0, "reasoningOutputTokens": 5},
          "modelContextWindow": null
        }
      }
    }
  }]
}
```

The first sample always establishes an uncounted baseline, including on a new
epoch or source version; inherited/forked history is never charged. Subsequent
monotonic totals yield exact four-field deltas through the existing atomic
importer. `last`, `totalTokens` and `modelContextWindow` are never additional usage.
`totalTokens` must equal input plus output; synthetic context-window-fill counters
are refused. Cached input plus cache-write input must fit input; reasoning must
fit output. Cache-write is validated as an input subset but has no separate
retained metric. Failed/retried attempts are included when the source cumulative
counter includes them; outcome stays unavailable because this notification
does not prove success. Model identity also stays unavailable.

The host must supply a new explicit `counter_epoch` on reset, compaction that
changes counter semantics, or source replacement. A source-version change also
creates a new baseline. Old epochs are permanently retired; old/reordered lower
snapshots refuse the whole batch rather than guessing a reset. Repeated latest
counters are no-ops, even with a newer timestamp. Export only current/new samples
after acknowledgement; replaying a whole old feed with lower snapshots is refused
safely. Concurrent receivers may refuse a changed sequence; preserve the numeric
export and retry from current state, never silently drop it. Parent metadata is
immutable; selected unknown descendants remain undiscovered. Own, inclusive and
unknown scope accounting remains separate. Coarse purpose defaults require no
per-call labels or content inspection.

Config/feed files are cooperative local declarations, not authenticated billing
proof. Raw host identifiers remain only in the explicitly selected ignored config
and bounded feed; durable tracker cursors use hashes. The receiver retains no
additional raw-event archive and emits only fixed diagnostics/counts/status. Stop
invoking capture and remove its external numeric callback to stop collection;
no repository background process continues. Existing aggregate retention applies.

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

The **Token usage** sidebar page provides a dedicated dashboard. It shows reported
measured and estimated input/output separately, unavailable field observations,
cached-input/reasoning-output subsets, daily/weekly/quarterly tables, coarse
purposes and at most sixteen agent aliases. Reported parent links classify only
observed parent/child relationships, never job roles or complete coverage.
Dark/light controls are shared with the rest of review. Disabled, missing or
invalid telemetry keeps a useful empty dashboard and numeric capture guidance.
The dashboard reads stored observations; it does not start capture, infer
quota/billing use or add polling. Validate actual freshness with `usage session-start`.
The page uses the global summary on the existing bounded first Work-items page,
so no server endpoint or collection paging contract changes.

The Work view retains its compact disclosure with seven daily/eight weekly/eight
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
