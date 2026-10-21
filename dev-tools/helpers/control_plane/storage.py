# SPDX-License-Identifier: GPL-3.0-only
# Adapted from financial-ai-academy; see UPSTREAM.md and COPYING.
"""Project-neutral journaled CAS persistence with a pluggable projection."""

from __future__ import annotations

import json
import os
import re
import tempfile
import time
from contextlib import contextmanager
from pathlib import Path, PurePosixPath
from typing import Any, Callable, Iterator

from .contracts import ControlError


SCHEMA_VERSION = "1.0"


def normalize_resolved_path(path: Path) -> Path:
    """Resolve a path while normalizing equivalent Windows device prefixes."""

    value = str(path.resolve(strict=False))
    if os.name == "nt":
        if value.startswith("\\\\?\\UNC\\"):
            value = "\\\\" + value[8:]
        elif value.startswith("\\\\?\\"):
            value = value[4:]
    return Path(value)


def canonical_bytes(value: object) -> bytes:
    return (json.dumps(value, indent=2, sort_keys=True) + "\n").encode("utf-8")


def confined_path(root: Path, relative: str) -> Path:
    posix = PurePosixPath(relative.replace("\\", "/"))
    if (
        posix.is_absolute()
        or re.match(r"^[A-Za-z]:", relative)
        or ".." in posix.parts
        or not posix.parts
    ):
        raise ControlError(
            "path.outside-repository",
            "Control-plane paths must be non-empty repository-relative paths.",
            {"path": relative},
            ["Use a normalized repository-relative path without parent traversal."],
        )
    target = root.joinpath(*posix.parts)
    resolved_root = normalize_resolved_path(root)
    resolved_parent = normalize_resolved_path(target.parent)
    try:
        resolved_parent.relative_to(resolved_root)
    except ValueError as error:
        raise ControlError(
            "path.outside-repository",
            "The resolved path escapes the repository boundary.",
            {"path": relative, "boundary": "repository"},
            ["Remove the symlink or junction escape and retry."],
        ) from error
    if target.exists():
        resolved_target = normalize_resolved_path(target)
        try:
            resolved_target.relative_to(resolved_root)
        except ValueError as error:
            # A short-lived lock file can disappear between exists() and
            # resolve() on Windows, where NTFS reports the removed object below
            # C:\$Extend\$Deleted. Revalidate the current pathname once so the
            # vanished object is not mistaken for a stable symlink escape.
            current_target = normalize_resolved_path(target)
            try:
                current_target.relative_to(resolved_root)
            except ValueError:
                raise ControlError(
                    "path.outside-repository",
                    "The resolved target escapes the repository boundary.",
                    {
                        "path": relative,
                        "boundary": "repository",
                    },
                    ["Use a path contained by the repository."],
                ) from error
    return target


def atomic_write(path: Path, payload: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    descriptor, name = tempfile.mkstemp(prefix=f".{path.name}.", suffix=".tmp", dir=path.parent)
    temporary = Path(name)
    try:
        with os.fdopen(descriptor, "wb") as stream:
            stream.write(payload)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)


@contextmanager
def exclusive_lock(path: Path, timeout_seconds: float = 5.0) -> Iterator[None]:
    """Advisory single writer, released by the OS even after process failure."""
    deadline = time.monotonic() + timeout_seconds
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a+b") as stream:
        if path.stat().st_size == 0:
            stream.write(b"\0")
            stream.flush()
        acquired = False
        while not acquired:
            try:
                stream.seek(0)
                if os.name == "nt":
                    import msvcrt
                    msvcrt.locking(stream.fileno(), msvcrt.LK_NBLCK, 1)
                else:
                    import fcntl
                    fcntl.flock(stream.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
                acquired = True
            except OSError:
                if time.monotonic() >= deadline:
                    raise ControlError("state.lock-contended", "Another mutation owns the local lock.", {}, ["Retry after the current mutation finishes."])
                time.sleep(0.025)
        try:
            yield
        finally:
            stream.seek(0)
            if os.name == "nt":
                import msvcrt
                msvcrt.locking(stream.fileno(), msvcrt.LK_UNLCK, 1)
            else:
                import fcntl
                fcntl.flock(stream.fileno(), fcntl.LOCK_UN)

