# Headless Skills and UI Takeover Source Coverage

- Status: implementation in progress. See the roadmap and review site for qualification status.
- Roadmap: [Headless Skills and Revocable UI Takeover](../headless-skills-ui-takeover-implementation-roadmap.md)
- Complete executable owners and host scope: [coverage JSON](headless-skills-ui-takeover-source-coverage.json)

The approved order is desktop, then server and browser. This crosswalk summarizes
the supplied design without publishing the private source document. Every
invariant and acceptance scenario has an owning criterion. Server/browser
parity repeats the applicable checks against the same server authority; it
does not synchronize desktop and server data.

The user later authorized implementation. In the isolated Windows app, a
separate MCP client paired, created and renamed a saved system, observed an
ordinary desktop save in the same feed and replayed the original create after
restart. For 100 bounded edits, dispatch-to-visible p95 was 873 ms. The client
reconnected and replayed all changes in 651 ms. These observations do not cover
dirty Canvas conflict in the packaged app, a lost reply injection, UI takeover,
or server/browser parity.

## Architectural invariants

| Source | Owning increment | Criterion | Required assertion |
| --- | --- | --- | --- |
| INV-01 | headless-authoring-and-synchronization | same-host-and-finite-tool-boundary | same host incarnation; same resource/revision; no independent database or second host |
| INV-02 | revocable-desktop-presentation | backend-continuity-and-lifecycle-isolation | backend read/mutation works with no lease; revocation does not invoke task cancellation; lease grant changes no backend permissions |
| INV-03 | revocable-desktop-presentation | exact-window-acceptance-and-reservation | agent credential denied; exact interactive principal/window accepted; forged body identity ineffective |
| INV-04 | revocable-desktop-presentation | exact-window-acceptance-and-reservation | wrong host/UI incarnation, session, scope or generation rejected; lease ID alone rejected |
| INV-05 | revocable-desktop-presentation | exact-window-acceptance-and-reservation | parallel accepts have one reservation winner; awaiting-ready reservation blocks silent displacement |
| INV-06 | revocable-desktop-presentation | immediate-local-revocation-and-exact-retry | gate/fence/control state changes before deferred transport settles; host-unreachable path remains manual |
| INV-07 | revocable-desktop-presentation | presentation-effect-fencing | held prepare/read/navigation/timer/animation effects suppressed; abort failure is harmless; new lease cannot consume old queue |
| INV-08 | revocable-desktop-presentation | backend-continuity-and-lifecycle-isolation | same running handle completes; chat connection/status usable; new authorized backend command succeeds |
| INV-09 | headless-authoring-and-synchronization | committed-change-delivery | lists/tasks update from saved state; route/focus/selection unchanged by update |
| INV-10 | revocable-desktop-presentation | context-minimization-and-revoke-fence | no producer starts after fence; held producer publishes zero fresh context; queued-unsent discarded; already transmitted bytes explicitly outside guarantee |
| INV-11 | revocable-desktop-presentation | immediate-local-revocation-and-exact-retry | reconnect/heartbeat/retry/replay cannot revive; new request and click create new authority |
| INV-12 | revocable-desktop-presentation | immediate-local-revocation-and-exact-retry | attempt plus captured local fence rejects late grant; old immutable revoke target does not end new lease |
| INV-13 | headless-authoring-and-synchronization | draft-base-and-refetch-ownership | new list metadata cannot update draft base; undo/draft preserved; stale write returns conflict |
| INV-14 | revocable-desktop-presentation | backend-continuity-and-lifecycle-isolation | human workspace switch changes no agent task target; missing workspace fails closed |
| INV-15 | headless-authoring-and-synchronization | portable-skill-and-result-contract | saved mutation stays succeeded when reveal detached; no business retry for presentation failure |
| INV-16 | revocable-desktop-presentation | serial-delivery-and-independent-deduplication | stable principal/client receipt survives reconnect; command dedup scoped to lease/generation; same ID changed payload denied |
| INV-17 | revocable-desktop-presentation | security-ui-control-reviewed | same denial before/after lease; confirmation description is not authorization; routine skill lacks privileged grants |
| INV-18 | revocable-desktop-presentation | backend-continuity-and-lifecycle-isolation | new UI incarnation rejects old traffic; host restart invalidates old leases; liveness loss/expiry returns manual |

## Acceptance scenarios

| Source | Owning increment | Criterion | Required assertion |
| --- | --- | --- | --- |
| AT-01 | headless-authoring-and-synchronization | same-host-and-finite-tool-boundary | read succeeds; no attachment/context opened |
| AT-02 | headless-authoring-and-synchronization | revision-safe-semantic-authoring | one authoritative saved result returned; UI absence is allowed |
| AT-03 | revocable-desktop-presentation | exact-window-acceptance-and-reservation | presentation rejected; fresh context denied |
| AT-04 | revocable-desktop-presentation | exact-window-acceptance-and-reservation | agent credential denied before reservation mutation |
| AT-05 | revocable-desktop-presentation | exact-window-acceptance-and-reservation | exact window/workspace activated only after ready; automated product Accept click |
| AT-06 | revocable-desktop-presentation | exact-window-acceptance-and-reservation | active/activating controller retained; no silent displacement |
| AT-07 | revocable-desktop-presentation | immediate-local-revocation-and-exact-retry | manual controls before acknowledgment; no confirmation required |
| AT-08 | revocable-desktop-presentation | immediate-local-revocation-and-exact-retry | local gate stays closed; exact target retained for retry; human actions work |
| AT-09 | revocable-desktop-presentation | immediate-local-revocation-and-exact-retry | cancel-before-grant and grant-before-cancel permutations; late grant cannot activate |
| AT-10 | revocable-desktop-presentation | immediate-local-revocation-and-exact-retry | terminal attempt/unknown old target rejected; no recreated lease |
| AT-11 | revocable-desktop-presentation | immediate-local-revocation-and-exact-retry | new generation remains active; old target receives terminal/stale result |
| AT-12 | revocable-desktop-presentation | presentation-effect-fencing | captured local fence fails at final effect commit; no route/focus/selection change |
| AT-13 | revocable-desktop-presentation | presentation-effect-fencing | preview does not open or steal focus; backend result remains available |
| AT-14 | revocable-desktop-presentation | presentation-effect-fencing | generation guard suppresses effect even when cancellation double does not abort |
| AT-15 | revocable-desktop-presentation | backend-continuity-and-lifecycle-isolation | saved revision commits; result reports detached presentation; no forced reveal |
| AT-16 | revocable-desktop-presentation | backend-continuity-and-lifecycle-isolation | same authoritative task handle continues; chat status remains readable; task cancellation not called |
| AT-17 | revocable-desktop-presentation | backend-continuity-and-lifecycle-isolation | current-authority permitted command succeeds; lease is not required |
| AT-18 | revocable-desktop-presentation | context-minimization-and-revoke-fence | new collection and publication denied; independent backend read unchanged |
| AT-19 | headless-authoring-and-synchronization | committed-change-delivery | normal data updates; no implicit focus/route/selection/preview |
| AT-20 | revocable-desktop-presentation | backend-continuity-and-lifecycle-isolation | agent work remains scoped to original explicit workspace; human selection retained |
| AT-21 | headless-authoring-and-synchronization | draft-base-and-refetch-ownership | exact dirty values and undo preserved; original record revision/revision ID retained; new saved revision indicated |
| AT-22 | headless-authoring-and-synchronization | draft-base-and-refetch-ownership | expected original revision causes conflict; neither draft nor other writer overwritten |
| AT-23 | revocable-desktop-presentation | dirty-handoff-and-reachable-controls | manual state retained; no ready/lease gate; draft preserved |
| AT-24 | headless-authoring-and-synchronization | durable-retries-and-current-authority | same result identity; one logical create; restart persistence where claimed |
| AT-25 | headless-authoring-and-synchronization | durable-retries-and-current-authority | fingerprint mismatch rejected; no second effect or result disclosure |
| AT-26 | revocable-desktop-presentation | serial-delivery-and-independent-deduplication | same command no repeat; payload mismatch denied; serial gap replay bounded; unrecoverable gap detaches |
| AT-27 | revocable-desktop-presentation | serial-delivery-and-independent-deduplication | old binding/generation refused; no replay into new lease |
| AT-28 | revocable-desktop-presentation | backend-continuity-and-lifecycle-isolation | new UI/host incarnation starts manual; old grant/readiness/queue rejected; saved data retained |
| AT-29 | revocable-desktop-presentation | backend-continuity-and-lifecycle-isolation | manual controls restored; heartbeat cannot revive ended lease; backend task lifecycle unchanged |
| AT-30 | revocable-desktop-presentation | backend-continuity-and-lifecycle-isolation | only exact lease ends; other controller/window unaffected |
| AT-31 | revocable-desktop-presentation | security-ui-control-reviewed | cross-org/workspace/window denied; no protected payload or identity leak |
| AT-32 | headless-authoring-and-synchronization | committed-change-delivery | valid cursor replays; expired/invalid/gapped cursor resyncs; current authorization applied |
| AT-33 | server-browser-and-delivery-qualification | postgres-atomicity-and-worker-delivery | committed outbox survives; dispatch resumes to subscribers on both workers; consumer deduplication tolerates repeats |
| AT-34 | headless-authoring-and-synchronization | portable-skill-and-result-contract | business success + failed/detached presentation reported separately; mutation call count remains one |
| AT-35 | server-browser-and-delivery-qualification | security-managed-parity-reviewed | new reads/writes/replay/receipt access denied; attachment ends; in-flight work uses existing policy |
| AT-36 | revocable-desktop-presentation | dirty-handoff-and-reachable-controls | keyboard-visible shell revoke remains reachable; click executes without confirmation; manual controls/focus restored |
| AT-37 | headless-authoring-and-synchronization | draft-base-and-refetch-ownership | no revision regression; old workspace/subscription ignored; dirty base unchanged |
| AT-38 | revocable-desktop-presentation | exact-window-acceptance-and-reservation | old ready cannot activate/displace current reservation; exact local attempt/fence also required |
| AT-39 | revocable-desktop-presentation | context-minimization-and-revoke-fence | held result publishes zero new values; pretransmitted bytes explicitly not recalled; host queued values discarded once revoke processed |
| AT-40 | headless-authoring-and-synchronization | durable-retries-and-current-authority | stable tenant/principal/client namespace deduplicates; new chat-session ID does not duplicate; current access rechecked before result |
| AT-41 | revocable-desktop-presentation | serial-delivery-and-independent-deduplication | old command generation invalidated before advancing; same valid lease cannot authorize obsolete callback; later presentation retained |
