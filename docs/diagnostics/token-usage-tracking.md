# Optional contributor token tracking

The control-plane `usage` commands import authorized numeric counter exports.
They never invoke a model, scan unrelated chat histories, estimate from account quotas,
or grant Work/review/roadmap authority. Unsupported hosts remain unavailable.
Imports are optional at existing handoff/completion boundaries. Coding-session
initialization validates capture once and never gates work; no polling, extra
model call, per-call label or approval stage is added.

## Prospective implementation phases (v2)

The dashboard label **Implementation** contains only attributed `pre_review`
counts. `review_fixes`, `post_review_other`, `mixed`, `unknown` and
`legacy_unknown` remain separate. Review, tests, planning/research and bookkeeping
remain their own activity purposes. Numeric measured/estimated/unavailable status
is independent of declared/inferred/unavailable attribution. A phase label is
coarse Work context, not proof of a token's semantic purpose or billable cost.

Work start associates the calling known `CODEX_THREAD_ID` with the owning
checkout/Work/spec, when that selected source is configured. It never derives a
thread ID from an invocation name or associates every reviewer/child automatically.
For Work already started before this version, or an explicitly delegated author,
use an `associate` request with its exact known `agents` UUID list. Startup alone
does not guess an active Work from unrelated claims. A source/thread can have
conflicting active Work; that overlap stays mixed until explicitly disambiguated.

At the **actual first substantive technical review handoff**, including early
static/code/security review before formal disposition, invoke:

```text
python dev-tools/helpers/development_control_plane.py usage phase --from .local-codex/review-start.json
```

```json
{
  "schema_version": "usage-phase-command-v1",
  "operation": "review-start",
  "work_id": "example-work",
  "marker_id": "review-round-one",
  "source_ref": "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"
}
```

Use the actual frozen source digest, not the example digest. Omitted `agents`
selects only already-associated authors for that exact owning Work. The request
is limited to32KiB under ignored storage, with no code/finding prose or prompts.
It is optional telemetry at the existing handoff, never a review approval gate.
Existing Work review decisions reconcile later phase but cannot reconstruct when
substantive review began. Verification and test failures alone do not start review.

Before genuine reviewer-driven implementation changes, use the same request
shape with `operation: correction-resume`, a new marker ID and the actual
`review_ref` digest of the current `changes-requested` decision. An ordinary
post-review bug or approved scope addition uses `later` or a new Work, respectively;
it does not become reviewer-caused effort by chronology. Source-bound advisory
fixes can instead supply `advisory_ref` (SHA256), `source_ref` and one to eight
bounded `finding_refs`. They remain declared advisory attribution and never
fabricate a canonical rejection or supply technical qualification.

New Work is initial by default. A successor solely closing a predecessor finding
can use `start ... --correction-of <prior-work-id> --review-ref <actual-digest>`;
that changes only optional attribution, not Work scope/approval. A canonical
correction must reference the current changes-requested decision, not a closed
historical rejection. Several review rounds accumulate in fixes without new
permanent aggregate categories. `activity` requests can set any existing coarse
activity purpose at a useful boundary; no per-call labels are required.

A marker performs a best-effort bounded capture then records the observed source
position fence atomically with context under the existing usage writer. Source
reads retain at most the first response after that fence and the latest snapshot.
The first post-fence response stays mixed/unknown because it might have been in
flight; later supported cumulative spans can use the declared phase. Missing,
lagging or out-of-tail cutpoints, multiple unconsumed transitions and stale context
refs are not pre-review. The importer revalidates the live context under its lock,
so a concurrent review-start cannot import an earlier captured pre-review label.
No time prorating, new epoch/baseline or per-response-plus-cumulative doublecount.

Markers are idempotent; changed contents with a repeated marker ID refuse.
Expected context refs protect delayed marker requests. The writer retains at most
16 contexts and64 recent marker references; closed context metadata can compact,
while numeric cursors/aggregates remain. No Work/review/finding IDs become rollup
keys. Failed transition metadata attempts to invalidate attribution; a storage or
lock failure can prevent even that write. Report unavailable and refresh a marker
before relying on phase; no work/quality action is blocked. Unreported transitions
cannot be authenticated from numeric counters.

Once the64-reference window is full, a new external request must include
`expected_contexts`; recent retained requests still deduplicate first. Use the
read-only `usage phase-status` to obtain opaque agent aliases and current context
refs, then include `{ "agent-<alias>": "<current-context-ref>" }` for each selected
author. Exact known UUID keys are also accepted. Persist those expected refs with
the request when retrying it; an expired old marker cannot obtain a fresh expected
ref implicitly. Source lifecycle wrappers supply live refs for actual immutable
Work transitions. No reference ledger grows beyond the fixed ring.

Storage/import/readout are explicitly versioned. Reading v1 migrates only in
memory: old implementation becomes legacy unknown with exactly the same numeric
values, epoch/sequence/baselines and latest-event replay digest. Summaries do not
write. A later successful numeric/marker publication writes v2; capacity/atomic
failure preserves old bytes. Future unassociated v1/manual/external observations
are unknown, not historical or initial. No historical totals are reallocated.
The raw `purpose.implementation` field remains the all-phase activity aggregate
for conservation; the exclusive displayed metric is
`implementation_phases.pre_review`. Phase tables are breakdowns, never extra
usage. The same fixed cells persist in lifetime/day/week/quarter/agent aggregates.
4MiB storage,128 detail,4096 cursors and400day/156week/40quarter retention remain.

For activation, integrate the complete reader/writer/UI first and restart the
read-only review server with the new code **before the first v2 writer runs**.
An old v1 server deliberately cannot read v2. Then initialize/poll using only the
explicit destination; never copy/sum independent stores. Old v1 data and old
readout fixtures remain visible as legacy unknown; no rollback may rewrite a v2
store into a guessed v1 file. Preserve it and run the compatible reader.

## Selected local response capture

`usage session-start` selects only the current known `CODEX_THREAD_ID` unless an
explicit `--session` is provided. When no external export config is present, it
initializes the local numeric adapter and captures once. Successful initialization
pins the source and retains its selection in ignored configuration; existing
Work start/verify/complete boundaries then poll configured selections once.
No daemon, background timer, extra model call or per-call label is required.

```text
python dev-tools/helpers/development_control_plane.py usage session-start
python dev-tools/helpers/development_control_plane.py usage local-poll
python dev-tools/helpers/development_control_plane.py usage local-enable --thread <known-thread-uuid>
python dev-tools/helpers/development_control_plane.py usage local-enable --thread <known-thread-uuid> --capture-destination <absolute-same-repository-checkout>
```

Additional `--thread` flags select only already known authorized parent/subagent
UUIDs. No other sessions are discovered or opened. Selections are additive under
a bounded writer lock. Unknown descendants remain unknown. Default purpose is
`mixed` with `unavailable` basis; an existing coarse task default can be declared
in the generated config without reading content or adding per-call labels.

The local adapter uses the official public
[rollout location and canonical first-header rules](https://github.com/openai/codex/blob/main/codex-rs/rollout/src/recorder.rs),
[persisted numeric-record policy](https://github.com/openai/codex/blob/main/codex-rs/rollout/src/policy.rs)
and [TokenUsageRecord schema](https://github.com/openai/codex/blob/main/codex-rs/protocol/src/protocol.rs).
It reads only exact selected UUID filenames in at most three adjacent creation-day
directories under `CODEX_HOME/sessions` (default `~/.codex/sessions`). The official
recorder uses local dates. Directory inspection is filename-only and capped at
4,096 entries per day; multiple/reverted/compressed candidates refuse safely.
There is no recursive search, database/account read, credential access or content
search. Canonical header identity and workspace must match the selected thread
and canonical Git repository; copied later headers cannot override the first.

Only a bounded first header (256 KiB, checked again after reading) and latest
1 MiB tail per selected file are examined locally. Message, tool, reasoning and
quota rows never enter the decoder; only exact outer `token_usage_record` rows
and canonical session metadata are decoded. Raw rows, prompts and responses are
never emitted, stored in tracker files or copied to artifacts. Only exact matching
`record.thread_id` is eligible. The public
[response caller](https://github.com/openai/codex/blob/main/codex-rs/core/src/session/turn.rs),
[session recorder](https://github.com/openai/codex/blob/main/codex-rs/core/src/session/mod.rs)
and [state accumulator](https://github.com/openai/codex/blob/main/codex-rs/core/src/state/session.rs)
bind reported response usage to the current thread and add it to that thread's
cumulative totals. These own counters may include internal compaction and
reported incomplete responses; outcome/model remain unavailable. Shared
`session_id` and `root_turn_id` are correlation, never descendant sums or epochs.

The first latest cumulative record is always an uncounted baseline. Fork/resume
history can seed thread totals; neither that inherited total, every repeated
`thread_token_usage`, `turn_token_usage` nor `record.usage` is added separately.
Subsequent exact-thread cumulative differences enter the existing atomic importer
as source-reported measured own usage. This avoids an unbounded response-ID log.
Per-response numeric shapes/subsets are validated too. `event_msg/token_count`
is deliberately not a fallback: it can be estimated, replayed or synthetic
context-window state. Cached/reasoning values remain subsets, never extra tokens.

Each source is pinned to a regular, single-link, non-reparse file identity and
canonical header digest. A fixed initial byte boundary excludes earlier copied
history; durable usage cursors protect subsequent replay. Counter/time decreases,
changed parentage, source replacement/truncation, unsupported fields and integer
or subset failures preserve the old store and report unavailable. After a genuine
qualified reset/replacement, `usage local-enable --thread <known-thread-uuid>
--counter-epoch <new-unique-label>` explicitly pins a new uncounted baseline.
Do not guess reset epochs or reuse old epochs. Ordinary startup preserves the
configured epoch. Keep a shared epoch/source policy when several checkouts use
the same central store.

The generated `.local-codex/token-capture/local.json` is limited to 32 KiB and
16 selected bindings, with a one-byte `local.lock`; it retains no log/archive.
It records selected UUID/known parent, opaque source/workspace digests, initial
byte boundary, epoch, coarse purpose/basis and optional destination. Configured
polls have a two-second work budget between bounded operations; fixed Git metadata
queries time out after one second. Busy/unavailable/capped input never gates Work.
Individual local filesystem IO is cooperative, not a hard real-time guarantee.
The existing 4 MiB usage file and aggregate retention remain unchanged.

This is partial observed coverage, never an account/billing audit. Capture begins
at the initial baseline; old usage is not backfilled. Sparse reports are attributed
to the final UTC bucket without fabricated daily shares. A missing numeric record,
oversized skipped row, incomplete append, bounded-tail history and unknown agents
stay explicit. Retried concurrent polls use actual importer receipts; a refused
or older sequence is not counted. A duplicate cannot refresh stale capture.
Recent actual deltas must exist before `live_capture` becomes true.

`--capture-destination` changes only the usage store. The destination must be an
existing checkout of the same canonical Git repository. Keep every Work command's
`--repo` at its owning checkout; claims, source, checks and receipts never move.
For a primary dashboard shared with a secondary author worktree, initialize that
worktree's local capture with an explicit primary usage destination. Both can
poll the same counters without copying stores; atomic cumulative dedup protects
the central store. Independent stores are never automatically summed. Avoid
importing the same consumption through both local and external producers.

Removing local capture configuration stops boundary capture; it does not erase
aggregate history or replay cursors. Current installed-file behavior must still
match the strict public schema. Same-user filesystem forgery and missing provider
usage remain limitations; source-reported counts are not authenticated billing
proof or a model/Work/parent qualification pass.

## Coding-session initialization and configured host exports

```text
python dev-tools/helpers/development_control_plane.py usage session-start
python dev-tools/helpers/development_control_plane.py usage session-start --session selected-session
python dev-tools/helpers/development_control_plane.py usage capture --session selected-session
```

The startup command prefers an existing explicit external config; otherwise it
uses the selected local path above. An explicit nondefault export config never
falls back to a different source. Missing/invalid source reports `state: unavailable`,
`live_capture: false` and `work_may_continue: true` with a fixed reason code.
It creates no placeholder observations. An explicit
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

**Public desktop bridge limitation:** the available app tools expose chat
metadata and quota percentages, but no selected-chat input/output counters or
subscription to numeric notifications. The external receiver does not attach to
the existing desktop host; selected local capture uses the precise numeric
boundary above instead. A public numeric-only callback/export remains preferable
when available. Do not start
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

### Optional planning scopes

After compatible v3 readers are deployed and long-running readers restarted,
run `usage enable-scopes` against the deliberately selected usage destination.
This explicit command extends the same atomic 4 MiB file. Generic `usage enable`,
imports and Work hooks keep their existing v2 schema until then. Preserve a
bounded pre-migration snapshot when coordinating a real shared-store deployment;
do not replace the live file with an older snapshot after new observations.
If the complete migrated file does not fit, it refuses without changing old bytes;
do not trim replay cursors, drop records or raise the cap to force adoption.

`usage scope-summary --limit 16` reports at most 128 known exclusive scopes. v3
keeps all original totals, raw classifications, baselines, streams and latest
replay hashes. Earlier usage is the explicit repository-unassigned remainder,
computed by subtracting known scoped cells from raw cells. No historical task,
time or token ownership is inferred. Default 400 daily/156 weekly/40 quarterly
retention, older-quarter/lifetime aggregates, 128 recent details and 4096permanent
token cursors remain unchanged. Scope definitions and closed activity cursors
are also bounded 4096 each within that same file and byte cap.

New phase markers resolve only exact current Work authority from its owning
checkout. One or more tasks belonging to one story contribute once to that
story. Tasks in different stories contribute only to the common increment;
legacy increment Work stays increment-only; overall Work stays roadmap-only.
Unrelated, stale, invalid or recovery-pending Work remains unassigned. Task and
assignment hashes are marker pins, separate from stable story ancestry. Imports
never reinterpret old markers or duplicate responses. The first response after
a fence can be in flight and remains unassigned; later exact responses may be
attributed. Review fixes, later work, tests and unknown phases stay separate from
the exclusively pre-review Implementation metric. This attribution is declared
context, not an authenticated claim of complete capture or account billing.

The v3 activity section starts empty. Enabling scopes does not measure time or
start a timer, host, process or collector.
Unobserved implementation time remains unknown. Work/receipt elapsed duration
is separate delivery evidence and can include idle time or overlap other Work.

### Closed implementation-time observations

`usage activity-import --from .local-codex/activity.json` accepts an explicit
ignored `contributor-activity-import-v1` object containing one to 64 `events`,
within 128 KiB. `usage activity-summary` reads own agent effort, implementation
phases and separately unaggregated inclusive/unknown reports. Actual supported
Codex active-span capture is unavailable; no timer or collector is started.
An ordinary manifest may record `estimated` or `unavailable` time only. A claimed
`measured` value is refused even if it supplies plausible clocks. The private
host-adapter seam requires separate source qualification and consistent real
session-monotonic endpoints; its clock fixtures are not live host qualification.

Each event has only `producer_ref`, `agent_ref`, `session_ref` (opaque 64 hex
hashes), zero-based contiguous `sequence`, UTC `started_at`/`ended_at` (seconds or
three decimal milliseconds), `scope` (`own`, `includes-descendants`, `unknown`),
the existing `purpose`, `measurement`, `duration_ms`, `clock_ref`,
`monotonic_start_ms`, `monotonic_end_ms`, and `attribution` containing nullable
`work_ref`/`context_ref`. An estimate has integer nonnegative milliseconds no
greater than its closed span; unknown duration is null. Both have null clock
fields. Qualified measured duration equals monotonic endpoint difference and
fits its UTC span with at most one millisecond rounding allowance. Keep a stable
clock identity within a session; a reset needs a new session.

Exact v3 `usage phase-status` supplies opaque agent/Work/context refs, planning
validity and `marked_at`/`time_phase`, without discovering sessions. Only a span
wholly at or after its exact current active marker may inherit declared phase
and scope. Missing, crossed, conflicting or activity-mismatched contexts stay
unknown; implementation time does not depend on a token source fence. The first
token response still follows its existing mixed/unknown rule.

Retain one activity cursor per producer/agent/session/accounting-scope family.
Latest same-event replay is a no-op; a conflicting latest sequence or gap refuses;
older sequences are not recounted or reclassified. Submit own-agent spans in
chronological order across sessions/producers; overlapping or late earlier spans
refuse, while half-open adjacent spans are allowed. Parallel distinct agents sum
**agent effort**, not calendar elapsed duration. Inclusive reports are never
added to child own effort. UTC end dates determine day/week/quarter buckets;
multi-day spans stay coarse. Time-only imports preserve every token counter,
baseline, classification, replay cursor and token freshness timestamp.

### Roadmaps reporting

The Roadmaps page shows implementation time and input/output tokens for each
story, increment and roadmap. **Implementation** is exclusively own-purpose
implementation before review; details show review fixes and other/unknown phases
separately. All-purpose totals include planning/tests/review and are labelled as
such. Measured and estimated numbers stay separate; missing data is unavailable
or not recorded, never a fabricated zero. Time is summed agent effort and can
overlap across different agents. Delivery duration remains a separate elapsed
Work measure and is not assigned to tasks.

Parent views fold each exact exclusive leaf once. Direct parent observations are
already included, not an extra amount to add to the parent. No task-count shares,
equal allocations or historical guesses are made. Unassigned repository usage is
shown once globally; linked usage on other pages or historical scope remains
separate. Details show at most 7 daily/8 weekly/8 quarterly UTC-end trend rows.
The full existing retention and older/lifetime data remain in the same store.

Optional reports use the same read-only endpoint, polling and themes. Malformed
numeric reports leave navigation and qualification intact. The existing 2 MiB
response cap bounds report construction and admission; oversized optional data
is omitted before canonical rows or execution records can be affected. A fixed
notice explains omission when it fits; if even the optional notice cannot fit at
an exact canonical boundary, it is omitted and the UI shows unavailable. Restart
all compatible readers before explicit v3 deployment. No live time feed or
historical measured activity is inferred by the display.

### Reporting from an author worktree

The review site and CLI `usage summary`, `scope-summary` and `activity-summary`
follow the owning checkout's single explicit usage-only destination. A server in
an author worktree can therefore show the primary checkout's canonical numeric
store. The reader validates the bounded existing config, workspace identity and
same common Git repository before opening that store. It reads no session files,
starts no capture and never creates or reroutes Work, claims or receipts.
Unavailable, foreign, relative or malformed destinations stay unavailable; they
do not silently fall back to a stale author-local store. No config means the
existing local-store behavior. Destinations are not followed recursively.

Writer routing stays explicit: enable/import actions and their acknowledgements
describe the selected checkout's store. For deployment choose the actual numeric
destination with `--repo <canonical-numeric-checkout> usage enable-scopes`, after
all its readers are compatible. Work commands remain pointed at their owning
checkout. Reporting alone never enables, migrates or writes either store.

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
