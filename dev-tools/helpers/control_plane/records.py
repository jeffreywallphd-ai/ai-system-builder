"""Journaled local record publication; no project lifecycle authority lives here."""
from __future__ import annotations

import copy
import re
from pathlib import Path
from typing import Callable

from .common import MAX_JSON, digest, fields, now, read_json, refuse, relative
from .storage import atomic_write, canonical_bytes, confined_path, exclusive_lock


class Records:
    def __init__(self, root: Path):
        self.root = root.resolve()
        self.path = confined_path(self.root, ".local-codex/control-plane/state.json")
        self.lock = confined_path(self.root, ".local-codex/control-plane/mutation.lock")
        self.journal = confined_path(self.root, ".local-codex/control-plane/transaction.json")
        self.index = confined_path(self.root, ".local-codex/control-plane/index.json")

    @staticmethod
    def empty():
        return {"schema_version": "development-state-v1", "revision": 0, "work_items": {}, "trials": {}, "feedback": {}}

    @staticmethod
    def validate(value):
        if value.get("schema_version") != "development-state-v1" or type(value.get("revision")) is not int or value["revision"] < 0 or any(not isinstance(value.get(k), dict) for k in ("work_items", "trials", "feedback")):
            refuse("state.invalid", "Local state has an unsupported schema.")
        if "state_digest" in value and value["state_digest"] != digest({k: v for k, v in value.items() if k != "state_digest"}):
            refuse("state.integrity", "Local state integrity failed; original bytes were preserved.")
        return value

    def load(self):
        if not self.path.exists():
            return self.empty()
        value = read_json(self.path)
        if "state_digest" not in value:
            refuse("state.integrity", "Persisted local state is missing its integrity record.")
        return self.validate(value)

    def baseline(self, work):
        value = work.get("baseline")
        if isinstance(value, dict) and value.get("schema_version") == "source-snapshot-reference-v1":
            fields(value, {"schema_version", "snapshot_digest"}, {"schema_version", "snapshot_digest"})
            identity = value["snapshot_digest"]
            if not isinstance(identity, str) or not re.fullmatch(r"[a-f0-9]{64}", identity):
                refuse("snapshot.reference", "The snapshot reference is invalid.")
            path = confined_path(self.root, f".local-codex/control-plane/snapshots/{identity}.json")
            try:
                value = read_json(path)
            except (OSError, ValueError):
                refuse("snapshot.unavailable", "The source snapshot is unavailable; preserve its reference and restore verified bytes.")
            if digest(value) != identity:
                refuse("snapshot.integrity", "The source snapshot changed; original bytes were preserved.")
        fields(value, {"schema_version", "head", "files", "source_digest"}, {"schema_version", "head", "files", "source_digest"})
        if value["schema_version"] != "source-snapshot-v1" or not isinstance(value["head"], str) or not re.fullmatch(r"(?:[a-f0-9]{40}|[a-f0-9]{64})", value["head"]) or not isinstance(value["files"], dict) or len(value["files"]) > 20000:
            refuse("snapshot.invalid", "The source snapshot schema is invalid.")
        for name, identity in value["files"].items():
            relative(name)
            if not isinstance(identity, str) or not re.fullmatch(r"[a-f0-9]{64}", identity):
                refuse("snapshot.invalid", "The source snapshot file identity is invalid.")
        if value["source_digest"] != digest(value["files"]):
            refuse("snapshot.integrity", "The source snapshot content identity is invalid.")
        return value

    def _externalize_baselines(self, state):
        for work in state["work_items"].values():
            if "baseline" not in work or isinstance(work["baseline"], dict) and work["baseline"].get("schema_version") == "source-snapshot-reference-v1":
                continue
            baseline = self.baseline(work)
            identity = digest(baseline)
            path = confined_path(self.root, f".local-codex/control-plane/snapshots/{identity}.json")
            payload = canonical_bytes(baseline)
            if len(payload) > MAX_JSON:
                refuse("snapshot.capacity", "The source snapshot exceeds its unchanged file bound.")
            if path.exists():
                if digest(read_json(path)) != identity:
                    refuse("snapshot.integrity", "Existing immutable snapshot bytes changed; they were preserved.")
            else:
                atomic_write(path, payload)
            work["baseline"] = {"schema_version": "source-snapshot-reference-v1", "snapshot_digest": identity}

    def _recover(self):
        if not self.journal.exists():
            return False
        j = read_json(self.journal)
        if set(j) != {"schema_version", "before", "successor"} or j["schema_version"] != "development-transaction-v1":
            refuse("transaction.invalid", "The recovery journal is malformed; original bytes were preserved.")
        if not isinstance(j["successor"], dict) or "state_digest" not in j["successor"]:
            refuse("transaction.integrity", "The recovery successor lacks its integrity record; original bytes were preserved.")
        successor = self.validate(j["successor"])
        current = self.load()
        if successor["revision"] != current["revision"] + 1 and digest(current) != digest(successor):
            refuse("transaction.conflict", "Recovery conflicts with the current revision.")
        if digest(current) not in {j["before"], digest(successor)}:
            refuse("transaction.conflict", "Recovery input changed outside the recorded transaction.")
        atomic_write(self.path, canonical_bytes(successor))
        atomic_write(self.index, canonical_bytes({"schema_version": "development-index-v1", "revision": successor["revision"], "state_digest": digest(successor)}))
        self.journal.unlink()
        return True

    def recover(self):
        with exclusive_lock(self.lock):
            return self._recover()

    def mutate(self, transition: Callable, *, expected_revision=None, fault_after=None):
        with exclusive_lock(self.lock):
            self._recover()
            current = self.load()
            if expected_revision is not None and expected_revision != current["revision"]:
                refuse("state.revision-conflict", "State changed since the requested revision.", "Reload status and reconcile before retrying.")
            successor = copy.deepcopy(current)
            result = transition(successor)
            # Publish snapshots before their references enter a recoverable journal.
            # Interrupted writes may leave harmless unreferenced snapshots; history
            # and existing evidence are never removed or recomputed.
            self._externalize_baselines(successor)
            successor.pop("state_digest", None)
            successor["revision"] = current["revision"] + 1
            successor["updated_at"] = now()
            successor["state_digest"] = digest(successor)
            if len(canonical_bytes(successor)) > MAX_JSON:
                refuse("state.capacity", "The bounded local record store is full.", "Preserve and archive completed local work before admitting more records.")
            self.validate(successor)
            atomic_write(self.journal, canonical_bytes({"schema_version": "development-transaction-v1", "before": digest(current), "successor": successor}))
            if fault_after == "journal":
                raise OSError("injected publication interruption")
            atomic_write(self.path, canonical_bytes(successor))
            if fault_after == "state":
                raise OSError("injected publication interruption")
            self._recover()
            return result
