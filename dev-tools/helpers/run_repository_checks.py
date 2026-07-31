#!/usr/bin/env python3
"""Run a configurable allowlist of repository verification gates."""

from __future__ import annotations

import argparse
import json
import os
import subprocess
from pathlib import Path

from helper_config import (
    configured_bool,
    configured_string,
    configured_strings,
    load_helper_section,
)


def safe_existing_path(repo: Path, value: str) -> str:
    candidate = (repo / value).resolve()
    try:
        relative = candidate.relative_to(repo).as_posix()
    except ValueError as error:
        raise ValueError(f"Path must stay inside the repository: {value}") from error
    if not candidate.exists():
        raise ValueError(f"Configured repository path does not exist: {value}")
    return relative


def selected_bool(
    cli_value: bool | None,
    config: dict[str, object],
    name: str,
    default: bool,
) -> bool:
    return (
        cli_value
        if cli_value is not None
        else configured_bool(config, name, default)
    )


def build_commands(
    *,
    format_paths: list[str],
    focused_tests: list[str],
    install_electron: bool,
    documentation: bool,
    agent_support: bool,
    architecture: bool,
    deployment: bool,
    full_suite: bool,
) -> list[tuple[str, list[str]]]:
    npm = "npm.cmd" if os.name == "nt" else "npm"
    npx = "npx.cmd" if os.name == "nt" else "npx"
    commands: list[tuple[str, list[str]]] = []
    if format_paths:
        commands.append(("format", [npx, "prettier", "--check", *format_paths]))
    if focused_tests:
        commands.append(
            (
                "focused tests",
                ["node", "--import", "tsx", "--test", *focused_tests],
            )
        )
    if install_electron:
        commands.append(
            (
                "pinned Electron runtime",
                [npm, "rebuild", "electron", "--no-audit", "--no-fund"],
            )
        )
    if documentation:
        commands.append(("documentation", [npm, "run", "docs:check"]))
    if agent_support:
        commands.append(("agent support", [npm, "run", "agent-support:check"]))
    if architecture:
        commands.append(("architecture", [npm, "run", "architecture:check"]))
    if deployment:
        commands.append(("deployment", [npm, "run", "deployment:check"]))
    if full_suite:
        commands.append(("full non-browser suite", [npm, "test"]))
    return commands


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", help="JSON helper configuration file")
    parser.add_argument("--repo", help="Repository directory; defaults to current")
    parser.add_argument(
        "--format-path",
        action="append",
        help="Repository-relative path for Prettier --check; repeatable",
    )
    parser.add_argument(
        "--focused-test",
        action="append",
        help="Repository-relative Node test path; repeatable",
    )
    parser.add_argument(
        "--install-electron",
        action=argparse.BooleanOptionalAction,
        default=None,
    )
    parser.add_argument(
        "--documentation",
        action=argparse.BooleanOptionalAction,
        default=None,
    )
    parser.add_argument(
        "--agent-support",
        action=argparse.BooleanOptionalAction,
        default=None,
    )
    parser.add_argument(
        "--architecture",
        action=argparse.BooleanOptionalAction,
        default=None,
    )
    parser.add_argument(
        "--deployment",
        action=argparse.BooleanOptionalAction,
        default=None,
    )
    parser.add_argument(
        "--full-suite",
        action=argparse.BooleanOptionalAction,
        default=None,
    )
    parser.add_argument(
        "--plan",
        action="store_true",
        help="Print the bounded command plan as JSON without executing it",
    )
    return parser


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()
    try:
        config = load_helper_section(args.config, "repositoryChecks")
        repo = Path(
            args.repo or configured_string(config, "repo") or "."
        ).expanduser().resolve()
        format_values = (
            args.format_path
            if args.format_path is not None
            else configured_strings(config, "formatPaths")
        )
        focused_values = (
            args.focused_test
            if args.focused_test is not None
            else configured_strings(config, "focusedTests")
        )
        format_paths = [safe_existing_path(repo, path) for path in format_values]
        focused_tests = [
            safe_existing_path(repo, path) for path in focused_values
        ]
        commands = build_commands(
            format_paths=format_paths,
            focused_tests=focused_tests,
            install_electron=selected_bool(
                args.install_electron, config, "installElectron", False
            ),
            documentation=selected_bool(
                args.documentation, config, "documentation", True
            ),
            agent_support=selected_bool(
                args.agent_support, config, "agentSupport", True
            ),
            architecture=selected_bool(
                args.architecture, config, "architecture", True
            ),
            deployment=selected_bool(
                args.deployment, config, "deployment", True
            ),
            full_suite=selected_bool(
                args.full_suite, config, "fullSuite", False
            ),
        )
    except ValueError as error:
        parser.error(str(error))

    if args.plan:
        print(
            json.dumps(
                [
                    {"label": label, "command": command}
                    for label, command in commands
                ],
                indent=2,
            )
        )
        return 0

    for label, command in commands:
        print(f"\n[repository-checks] {label}: {' '.join(command)}", flush=True)
        completed = subprocess.run(command, cwd=repo, check=False)
        if completed.returncode != 0:
            print(
                f"[repository-checks] stopped after {label} failed with exit "
                f"code {completed.returncode}.",
                flush=True,
            )
            return completed.returncode
    print("\n[repository-checks] all selected checks passed.", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
