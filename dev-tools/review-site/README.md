> AI documentation reminder: when behavior in this area changes, update the related ADRs, architecture docs, context packs, and README files in the same change.

# Dynamic Development Review

The production server shows reviewed user descriptions from
`docs/operations/roadmap-user-descriptions.json`. Purpose, requirement bullets,
agent action and completion proof replace technical criterion prose. The same
format covers merged history, roadmap/increment headings and local support limits.
The technical CLI and canonical roadmap JSON keep the original definitions.
Description hashes, qualification types and heading hashes must match current
sources. Missing, stale, duplicate, foreign or unsafe copy shows an agent-owned
description update, without exposing the technical fallback or changing results.
The browser does not show a technical criterion accordion. Narrative evidence
stays internal; the browser preserves its recorded/not-recorded fact and result.
Other proposal/chunk execution detail retains its existing structured ownership.
Text limits count Unicode code points in admission and rendering; invalid Unicode
is refused. File and HTTP limits continue to count encoded bytes.

The final response uses compact JSON and the existing 2 MiB limit. The server
checks the exact bytes it sends, after user descriptions are added. If more space
is needed, only older execution-history rows can leave this response. The page
retains every roadmap, merged history, planned work chunk, criterion and support
entry. Its inventory and single display-limit notice give the exact shown and
saved record counts. The final content digest covers those display facts.
If canonical details alone cannot fit, the server returns its fixed unavailable
response. It does not present a partial roadmap as a complete one.

Control-plane tests also admit the current versioned descriptions and support map
with an empty local receipt store. This catches stale or malformed display data
without requiring ignored historical receipts on another checkout. Missing
receipts remain unavailable and cannot qualify a parent roadmap.

Start through the unified contributor entry point:

```text
python dev-tools/helpers/development_control_plane.py review-site start
```

Share the returned verified loopback URL with the user. The buildless UI polls
`/api/review` every five seconds. `development-review-v1` derives only from
versioned roadmap JSON and local controller JSON. No Markdown parsing, build,
external fonts, analytics, credentials or hosting service is required.

The first visit uses dark mode, including before JavaScript loads. The header's
Light mode / Dark mode button changes only the local display and remembers an
explicit `dark` or `light` preference under `aisb-review-theme-v1`. Invalid or
unavailable browser storage falls back safely; storage failures do not block
review refresh or navigation. Both palettes use explicit colors with tested text,
badge, error, focus and input-boundary contrast, without inverting content.

Work items include the planned chunks projected from roadmap JSON and separate
execution records. Each increment shows its ordered chunks, recorded completion,
criterion links and verification notes. Use "View these work items" to filter
the Work items tab, or "View parent increment" to navigate back. Criterion
qualification and chunk completion are tracked independently; legacy chunk
declarations do not acquire execution receipts.

Increments start collapsed. Only an increment with a current, unexpired roadmap
work claim opens automatically. A saved current-increment pointer or an In progress
label is not enough. Automatic opening ends when that claim ends or expires.
Your explicit open and close choices survive polling, filtering and tab changes
for this browser page and repository. A linked parent-increment action is an
explicit open choice. A page reload starts fresh. Merged history never infers
active work; its panels retain your manual choices during the same page visit.
These display choices change no roadmap, acceptance result or execution authority.
Only unique public record identities retain choices across refreshes. Ambiguous
rows start collapsed and can be toggled in the current view, but they do not
share remembered choices or receive automatic opening or linked focus.

When contributor assertion definitions change, refresh their exact source-facts
row in `docs/operations/comprehensive-ui-automation-current-census.json`. Keep the
real committed pin at its recorded Git baseline and an explicit pending drift
until the reviewed source is committed. Then bind the actual new commit in a
separate metadata checkpoint. A definition inventory never supplies a host test
or parent qualification pass.

Criteria show parent qualification separately from reviewed local supporting
work. The fixed JSON map in `docs/operations/roadmap-supporting-work.json` links
actual completed receipt/review lineages without granting current qualification
or completing planned chunks. Long qualification badges wrap inside their own
column in narrow review panels. Agent-only labels distinguish automated technical
checks from archived offline human acceptance; genuine technical gaps stay pending.

Open Roadmaps appears first, followed by Completed Roadmaps. Only the roadmap's
top-level `completed` status selects the completed section; legacy `complete` and
`final-approved` records remain readable and display as `completed`. Current final
approval preserves `completed` and its separate immutable approval fact. Completed
increments never promote an open parent. Each section keeps
the API's newest-first original creation order, unaffected by later updates or
completion dates. Work items also appear newest first by creation time. Chunks
use their plan's recorded time, falling back to
increment start or roadmap creation for legacy data. Equal-time chunks retain
their increment/plan order; missing or invalid creation dates sort last.

The security plans share one execution backlog in `security-findings-refresh`.
The obsolete unapproved Run & Test proposal is separately retained beneath its
completed Publish lifecycle successor through a fixed validated retirement
manifest. It supplies no current pass and cannot hide started work. Mixed legacy
human acceptance appears offline while technical criteria remain pending.
Expand its **Merged history** to inspect the original remediation increments,
recorded criteria/chunks and exact primary/companion acceptance owners. The fixed
versioned consolidation JSON must cover every unfinished legacy criterion and
every current criterion, preserve both finding inventories, bind the frozen
legacy state and current acceptance definitions, validate current approval using
the canonical roadmap engine, reject successor cycles/chains through folded
history, and retain final qualification.
Only then is the legacy card/chunk backlog folded into history. Missing, malformed
or stale data leaves both original records visible with a diagnostic. Folding
does not change either roadmap's status, approval, evidence or completion.

`/api/status` identifies the repository and local server instance. GET/HEAD
routes are fixed; the server checks Host/Origin, has no CORS or mutation API,
and never serves repository files. Local output omits private authority notes,
raw logs and paths. Read `docs/architecture/ai-development-control-plane.md`
and the contributor threat model before changing exposure or data fields.

Focused tests live in `dev-tools/helpers/tests/test_control_plane_site.py`;
browser behavior is covered by the complete contributor Node DOM/controller file.
The policy-bound `review-site` source-owned profile selects that exact file for
UI assets and its test changes; no desktop, model or native qualification is
inferred. Uncovered sources and explicitly required generic focused checks retain
their existing gates. Use `review-site
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
executing and Awaiting approval for roadmap-review. Explicit human-action requests
remain Blocked. A legacy record without a named human action displays
Status review needed; its execution guard remains unchanged until classification. The accessible
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

An existing issue reference can carry reviewed `plain_language` copy. Legacy
three-field copy remains readable: `needed` (400 characters), `prevents` (800)
and `action` (800). New complete explanations also require `responsible_role`
(160), `user_action` (800) and `done_when` (800). The exact current criterion and
unresolved issue digests govern every explanation. Shared copies must agree.
Invalid, conflicting or stale copy produces a diagnostic; the page requests clear
instructions instead of displaying technical source text or inventing an action.
All text stays sanitized and inert. Presentation grants no authority or test pass.

Parent and affected-criterion views show the responsible role, the user's action,
the remaining work and its completion check. Technical summary/action text stays
in versioned JSON for agents. No technical-details accordion appears in these
issue cards. Distinguish supplied access from successful tests. Do not request
credentials again after the user supplied them.

## Responsibility and pending work

Use **Blocked** only when a person must take a specific action. Coding-agent
implementation, debugging and available automated checks are pending work. They
do not become human requests because the code or evidence is unfinished.

Canonical open issue records carry `actionOwner`, `responsibleRole`,
`requiredAction`, `actionLocation` and `completionCondition`. The governed
`blocker-reclassified` event archives the prior record without resolving its
technical requirement. Unknown legacy responsibility needs review; it cannot be
silently assigned or accepted. Only explicit human issues contribute to the
human-action count. Agent-owned issues appear in **Pending work** at roadmap and
criterion level. Their technical tests still prevent completion until satisfied.

The source-bound blocker presentation supports a complete plain explanation:
`needed`, `prevents`, `responsible_role`, `user_action`, `action` and `done_when`.
Review this explanation for the same scope as its exact canonical issue digest.
The page shows the user explanation. Technical source text stays in versioned JSON
for agents; there is no technical-details accordion for these issue cards.
Missing or stale explanations show an instruction-review message, rather than
unsupported technical instructions or an invented request for access.

Each card answers: Who will act? What must the user do? What work remains? What
result will close it? Use short active sentences and separate actions. Apply the
applicable [ASD-STE100 Issue 9](https://www.asd-ste100.org/assets/files/ASD-STE100_ISSUE9.pdf) writing principles; this is not a claim of formal
ASD-STE100 certification. Retain security controls, accurate limits and completed
model results when simplifying the wording.

Execution summaries expose only the success and problem fields used by the browser.
Other work context remains in the canonical controller records and technical CLI.
This reduces response size without increasing the existing byte or record limits.
A display-limit notice says how many recent execution records are shown and confirms
that older records remain saved. Description maintenance and genuine record failures
are explained separately, including when both occur. No user action is requested
for these agent-owned display issues.


## Focused real-browser review

Start the review server with the documented contributor command above. Then run
only the read-only review cases with the existing installed Chrome:

```text
node node_modules/@playwright/test/cli.js test --config dev-tools/config/playwright.review-site.config.ts
```

This fixed configuration selects three named cases in the existing thin Chrome
project and disables the application setup. It does not open the app, load models
or contact providers. One browser worker uses fresh contexts with recordings off.
The live case checks this repository's loopback server and shipped assets, original
roadmap order, criterion bullets, local-support limits and linked work navigation.
Separate current-copy fixtures check refresh failure/recovery and storage refusal.
Theme persistence and narrow keyboard use are checked in the isolated browser.

The helper bounds response bytes, time and request routes. Reports contain fixed
phase labels rather than page text, private errors or credentials. Failed setup,
assertions, cleanup or report publication cannot count as a pass. The ordinary
operational profile runs only oracle and routing tests; browser execution remains
an explicit feature command. It does not qualify app hosts, models, native controls
or final combined roadmap testing.

The live browser reads use a bounded read-only proxy to the verified loopback
server. Every live reply retains the server's security headers and checks its
bytes, current repository identity or exact shipped asset. This is distinct from
the controlled refresh/error copy. The canonical journey pins the existing
Comprehensive UI operational increment and compares every requirement bullet in
order, including nested bullets. Initial port failures, owned-read retirement and
report publication retain fixed primary/cleanup facts without private errors.
