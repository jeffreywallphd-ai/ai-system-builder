# Installing the implementation-roadmap skill

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

Before publishing or changing the skill:

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

- [Agent Skills specification](https://agentskills.io/specification)
- [Agent Skills overview](https://agentskills.io/home)
- [GitHub CLI `gh skill install`](https://cli.github.com/manual/gh_skill_install)
- [GitHub Copilot agent skills](https://docs.github.com/en/copilot/how-tos/copilot-on-github/customize-copilot/customize-cloud-agent/add-skills)
- [Claude Code skills](https://code.claude.com/docs/en/slash-commands)
- [OpenAI skills catalog](https://github.com/openai/skills)
