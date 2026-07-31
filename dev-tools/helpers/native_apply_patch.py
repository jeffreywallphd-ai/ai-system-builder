#!/usr/bin/env python3
"""Invoke Codex only in native apply-patch mode with validated input."""

from __future__ import annotations

import argparse
import base64
import binascii
import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

from helper_config import configured_string, load_helper_section


MAX_PATCH_BYTES = 8 * 1024 * 1024


def find_codex_executable(configured_path: str | None) -> Path:
    requested = configured_path or os.environ.get("CODEX_NATIVE_EXECUTABLE")
    if requested:
        candidate = Path(requested).expanduser()
        if candidate.is_file():
            return candidate
        raise FileNotFoundError("Configured Codex executable does not exist.")

    if os.name == "nt":
        local_app_data = os.environ.get("LOCALAPPDATA")
        if local_app_data:
            candidates = sorted(
                (Path(local_app_data) / "OpenAI" / "Codex" / "bin").glob(
                    "*/codex.exe"
                ),
                key=lambda item: item.stat().st_mtime,
                reverse=True,
            )
            if candidates:
                return candidates[0]

    path_candidate = shutil.which("codex")
    if path_candidate and Path(path_candidate).is_file():
        return Path(path_candidate)

    raise FileNotFoundError(
        "Codex executable not found. Pass --codex-executable or set "
        "CODEX_NATIVE_EXECUTABLE."
    )


def read_patch(args: argparse.Namespace) -> str:
    try:
        if args.base64 is not None:
            raw = base64.b64decode(args.base64, validate=True)
        elif args.patch_file is not None:
            raw = Path(args.patch_file).read_bytes()
        else:
            raw = sys.stdin.buffer.read(MAX_PATCH_BYTES + 1)
    except (OSError, binascii.Error) as error:
        raise ValueError(f"Unable to read patch input: {error}") from error

    if len(raw) > MAX_PATCH_BYTES:
        raise ValueError(f"Patch exceeds the {MAX_PATCH_BYTES}-byte safety limit.")
    try:
        patch = raw.decode("utf-8").replace("\r\n", "\n")
    except UnicodeDecodeError as error:
        raise ValueError("Patch input must be UTF-8.") from error
    if not patch.startswith("*** Begin Patch\n"):
        raise ValueError("Patch must start with '*** Begin Patch'.")
    if not patch.rstrip().endswith("*** End Patch"):
        raise ValueError("Patch must end with '*** End Patch'.")
    return patch


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Validate a patch and invoke Codex native apply-patch mode."
    )
    parser.add_argument("--config", help="JSON helper configuration file")
    parser.add_argument("--codex-executable", help="Codex executable path")
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Validate input and executable discovery without applying the patch",
    )
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument("--base64", help="UTF-8 patch encoded as base64")
    source.add_argument("--patch-file", help="Path to a UTF-8 patch file")
    source.add_argument(
        "--stdin",
        action="store_true",
        help="Read the UTF-8 patch from standard input",
    )
    return parser


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()
    try:
        config = load_helper_section(args.config, "nativeApplyPatch")
        configured_path = args.codex_executable or configured_string(
            config, "codexExecutable"
        )
        patch = read_patch(args)
        executable = find_codex_executable(configured_path)
    except (FileNotFoundError, ValueError) as error:
        parser.error(str(error))

    if args.dry_run:
        print(
            json.dumps(
                {
                    "operation": "native-apply-patch",
                    "patchBytes": len(patch.encode("utf-8")),
                    "status": "validated",
                }
            )
        )
        return 0

    completed = subprocess.run(
        [str(executable), "--codex-run-as-apply-patch", patch],
        check=False,
    )
    return completed.returncode


if __name__ == "__main__":
    raise SystemExit(main())
