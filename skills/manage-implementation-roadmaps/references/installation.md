# Installing the implementation-roadmap skill

Install the engine, tests and references together. The explicit
`legacy-acceptance-scope-revised` event archives mixed legacy human acceptance
without qualifying technical work; it cannot substitute for the governed event.
Keep both policy-specific denial paths and semantic classification tests on all
supported agent hosts. Product human approval controls are never acceptance-test
scope to remove.

The canonical skill lives at
`skills/manage-implementation-roadmaps/SKILL.md` and follows the open Agent Skills
format. Keep one canonical copy in this repository. Let installers place or adapt it
for each supported host rather than maintaining divergent Codex, Claude, Copilot, or
Gemini copies.

## GitHub CLI skill commands

GitHub CLI 2.90 or later includes public-preview `gh skill` commands. Preview the
repository's discoverable skills:

```text
gh skill list <owner>/<repository>
gh skill preview <owner>/<repository> manage-implementation-roadmaps
```

Install for a host and scope:

```text
gh skill install <owner>/<repository> manage-implementation-roadmaps --agent codex --scope user
gh skill install <owner>/<repository> manage-implementation-roadmaps --agent claude-code --scope user
gh skill install <owner>/<repository> manage-implementation-roadmaps --agent github-copilot --scope user
```

Install from a trusted local checkout while developing:

```text
gh skill install . manage-implementation-roadmaps --from-local --agent codex --scope project
```

Choose `--scope project` when collaborators should use the skill only in the
current project. Choose `--scope user` when the same user should invoke it in other
repositories. Review the skill and every bundled script before installation,
especially when the source is not this repository.

The current `gh skill` agent catalog includes Codex, Claude Code, GitHub Copilot,
Cursor, Gemini CLI, OpenCode, and other hosts. Run `gh skill install --help` for
the locally installed version's exact values because the feature remains in preview.

## Codex installer

Codex users can also ask the built-in installer to install the published GitHub
directory:

```text
$skill-installer install https://github.com/<owner>/<repository>/tree/<ref>/skills/manage-implementation-roadmaps
```

Restart or reopen the agent session when the host requires skill rediscovery.

## Host-native locations

When an automatic installer is unavailable, use the host's documented project or
user skill directory. Examples include:

- Claude Code project skills: `.claude/skills/<skill-name>/SKILL.md`;
- GitHub Copilot repository skills: `.github/skills/<skill-name>/SKILL.md`;
- Agent Skills-compatible shared project discovery:
  `.agents/skills/<skill-name>/SKILL.md`.

Prefer installation or a generated adapter over copying. If a copy is unavoidable,
record its canonical source and version and add an automated parity check.

## Publishing checks

The target repository's `AGENTS.md` may integrate this skill with a bounded
contributor control plane. Preserve that routing, the JSON review-site startup
requirement and receipt-backed completion tests. Installing the portable skill
alone does not install repository helpers or grant execution/review authority.
Legacy repositories continue to use declarative state; the current repository
creates new roadmaps with `evidencePolicy: control-plane-v1`.
Its state path must be `.implementation-roadmaps/<slug>/state.json`. Configure
`completionSuite: all` for AI-related work (otherwise `standardande2e`), and
qualify the final candidate through the guide's reviewed `overall` work binding
before `roadmap-completed`. Portable repositories without the adapter retain
their declarative workflow.
Preserve implementation-boundary tests: final verifying work can qualify only
when every implementation chunk and predecessor is done, approval is current and
no human action or unclassified legacy record prevents execution. Open agent work
permits checks but still prevents completion. Pending criteria prevent final closure.
Keep exclusive unpredictable temporary publication and failure-cleanup tests;
portable installation does not attest OS-native ACL/reparse race qualification.
Preserve canonical completion regression tests: final approval keeps `completed`,
while its separate fact makes records immutable and removes the temporary report.
The user-authorized legacy normalization event must retain exact prior history,
approval, criteria, evidence and fingerprints, reject incomplete/malformed/repeated
conversion and preserve serialized publication and report non-recreation.
Preserve the explicit offline human-acceptance handoff tests and documentation.
The user-directed handoff archives original criteria and invalidates approval;
it never supplies a human test pass or bypasses technical/security/current-receipt
gates. Portable hosts must review criterion classification, not infer it from keywords.
Keep the denial test proving this legacy metadata event refuses receipt-governed
roadmaps; it cannot replace their current candidate-bound completion evidence.

Before publishing or changing the skill:

Preserve draft-before-approval behavior across hosts: persist and render the
complete unapproved proposal before asking. Where a review-site adapter exists,
verify the actual live roadmap identity, expected nonzero increments/objectives
and criterion IDs/counts/details, and share the verified link first. Test a
discovery-only 0/0 shell becoming a reviewable draft through live JSON refresh,
and prove that publication cannot start implementation or create approval.
Portable installation alone does not install a server or grant authority.

Preserve the portable human-action execution guard and atomic denial tests.
New `blocker-recorded` events require a human owner, responsible role, required
action, location, completion condition and authority reference. Legacy stored
records remain valid and conservative until explicitly classified. Bundle
`blocker-reclassified`, exact old-record/digest archives, strict fields and stale
record denial tests together. Agent work stays open and allows approved execution;
it never supplies resolution, a pass or technical completion. Test mixed owners,
reapproval, archive chains/tampering, actual resolution and every completion path,
including legacy evidence promotion. Keep approvals, criteria, chunks and evidence.

Keep user descriptions separate and source-bound. Apply ASD-STE100 principles:
short sentences, a clear actor, one action, its location and completion proof.
Show agent work as In progress or Technical check pending with No action needed.
Keep technical detail internally, without a technical accordion in the user view.
Do not claim full ASD-STE100 conformance. Do not reactivate frozen successor history
or ask for credentials/approval already supplied merely to change a status label.

Preserve the reviewed-chunk checkpoint procedure across hosts. Completed, tested
and independently reviewed chunks commit on the authorized branch before later
chunks even when parent qualification is pending. Verify owned paths/hunks and
dependency closure, protect unrelated index/worktree changes, release source
claims before Git changes and require a fresh baseline afterward. Installation
does not grant push, history rewrite, main advancement or release authority.
Test a mixed dirty worktree with accepted local work and a pending parent check;
the checkpoint must neither capture unrelated changes nor complete the parent.

Keep `technical-acceptance-revised` engine, archive validation, rendering and denial
tests together with portable routing. It is governed and replacement-only; require
current approval, complete unique chunks, pending controlled nonsecurity identity,
unchanged qualification and explicit policy authority/digest. Test stale/unsafe
amendment denial, preserved evidence/history/blockers, approval invalidation and
blocked reapproval. Review actual policy semantics independently; an operator
reference/digest does not authenticate a user or qualify hardware. Keep human-only
events separate and require fresh current qualification after an amendment.

Preserve governed `acceptance-scope-revised` regression coverage: explicit narrow
human scope, immutable history/evidence/completion policy, stale-receipt denial,
pending technical closure and safe projection. Natural-language requests for
agent-only acceptance route to this event for started governed roadmaps. Keep the
legacy-only handoff separate and require actual fresh review after scope changes.

1. Run the skill unit tests.
2. Run the repository documentation and agent-support gates.
3. Run the skill validator supplied by the creating host.
4. Preview installation from the repository or a temporary package.
5. Scan the skill tree for credentials, personal names, absolute local paths, and
   private conversation text.
6. Test natural-language triggering with requests that do and do not name the skill.
7. Confirm the installed host can locate references and scripts relative to
   `SKILL.md`.
8. Confirm the target repository ignores `docs/tmp/`, progress reports remain
   concise and local, and explicit final approval removes the generated report.
9. Confirm roadmap discovery requires a security impact disposition, every increment
   carries security review acceptance evidence, and sanitized evidence cannot copy
   secrets, protected prompts, private payloads, personal data, or exploitable
   production details.
10. Confirm increment execution runs only tests relevant to each change and that
    overall roadmap completion runs combined standard and end-to-end coverage once
    after every increment is implemented. Confirm AI-related roadmaps add the AI
    suite through the all-suite command, while non-AI roadmaps do not.
11. Confirm that continuous execution carries an implementation-authorized approved
    roadmap through every increment without routine approval pauses, while changed scope, new
    authority, destructive or production actions, credentials, unresolved security
    choices, blockers, and final overall approval remain explicit gates.

## Primary references

For adapters with a user-description view, run its source/qualification binding,
stale/duplicate/foreign input, joined redaction, historical result preservation and
inert DOM tests. Confirm technical CLI output remains available, invalid copy gives
agent-owned recovery guidance, and no description can supply approval or a pass.
Update routing and installation guidance together with description behavior.

Adapter installations must test `increment-qualified` using portable skill tests
and repository lifecycle tests. Verify partial/overall-only/stale evidence denial,
report/plan/evidence binding and preservation of other active increments. Target
receipt consumption is historical. Repositories without the adapter cannot use
this governed path.

- [Agent Skills specification](https://agentskills.io/specification)
- [Agent Skills overview](https://agentskills.io/home)
- [GitHub CLI `gh skill install`](https://cli.github.com/manual/gh_skill_install)
- [GitHub Copilot agent skills](https://docs.github.com/en/copilot/how-tos/copilot-on-github/customize-copilot/customize-cloud-agent/add-skills)
- [Claude Code skills](https://code.claude.com/docs/en/slash-commands)
- [OpenAI skills catalog](https://github.com/openai/skills)
