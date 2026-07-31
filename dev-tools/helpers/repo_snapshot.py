#!/usr/bin/env python3
"""Collect recurring read-only Git diagnostics in one bounded process."""

from __future__ import annotations

import argparse
import json
import subprocess
from pathlib import Path

from helper_config import (
    configured_int,
    configured_string,
    configured_strings,
    load_helper_section,
)


def safe_relative_path(repo: Path, value: str) -> str:
    candidate = (repo / value).resolve()
    try:
        return candidate.relative_to(repo).as_posix()
    except ValueError as error:
        raise ValueError(f"Path must stay inside the repository: {value}") from error


def build_commands(
    log_count: int,
    ignore_paths: list[str],
) -> list[tuple[str, list[str]]]:
    commands: list[tuple[str, list[str]]] = [
        ("worktree", ["git", "status", "--short", "--branch"]),
        (
            "recent commits",
            ["git", "log", f"-{log_count}", "--oneline", "--decorate"],
        ),
        ("diff check", ["git", "diff", "--check"]),
        ("diff summary", ["git", "diff", "--stat"]),
    ]
    commands.extend(
        (
            f"ignore check: {path}",
            ["git", "check-ignore", "-v", path],
        )
        for path in ignore_paths
    )
    return commands


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", help="JSON helper configuration file")
    parser.add_argument("--repo", help="Repository directory; defaults to current")
    parser.add_argument("--log-count", type=int, help="Recent commits to display")
    parser.add_argument(
        "--ignore-path",
        action="append",
        help="Repository-relative path to verify as ignored; repeatable",
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
        config = load_helper_section(args.config, "repositorySnapshot")
        repo = Path(
            args.repo or configured_string(config, "repo") or "."
        ).expanduser().resolve()
        log_count = (
            args.log_count
            if args.log_count is not None
            else configured_int(config, "logCount", 3)
        )
        if not 1 <= log_count <= 100:
            raise ValueError("--log-count must be between 1 and 100.")
        raw_ignore_paths = (
            args.ignore_path
            if args.ignore_path is not None
            else configured_strings(config, "ignorePaths")
        )
        ignore_paths = [
            safe_relative_path(repo, path) for path in raw_ignore_paths
        ]
    except ValueError as error:
        parser.error(str(error))

    commands = build_commands(log_count, ignore_paths)
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

    failed = False
    for label, command in commands:
        print(f"\n[repo-snapshot] {label}: {' '.join(command)}", flush=True)
        completed = subprocess.run(command, cwd=repo, check=False)
        failed = failed or completed.returncode != 0
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
