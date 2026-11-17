# SPDX-License-Identifier: GPL-3.0-only
# Adapted from financial-ai-academy; see UPSTREAM.md and COPYING.
"""Stable, reusable command-result and refusal contracts."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


@dataclass(slots=True)
class ControlError(Exception):
    """A deterministic refusal with bounded recovery guidance."""

    code: str
    message: str
    observed: dict[str, Any] = field(default_factory=dict)
    remediation: list[str] = field(default_factory=list)

    def __str__(self) -> str:
        return self.message

    def as_result(self) -> dict[str, Any]:
        return {
            "schema_version": "1.0",
            "outcome": "refused",
            "code": self.code,
            "message": self.message,
            "observed": self.observed,
            "remediation": self.remediation,
        }


def success(
    code: str,
    message: str,
    *,
    revision: int | None = None,
    data: dict[str, Any] | None = None,
) -> dict[str, Any]:
    result: dict[str, Any] = {
        "schema_version": "1.0",
        "outcome": "succeeded",
        "code": code,
        "message": message,
        "observed": {},
        "remediation": [],
        "data": data or {},
    }
    if revision is not None:
        result["state_revision"] = revision
    return result
