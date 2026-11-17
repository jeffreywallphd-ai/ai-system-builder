"""Journaled local record publication; no project lifecycle authority lives here."""
from __future__ import annotations

import copy
import hashlib
import json
import os
import re
import stat
from pathlib import Path
from typing import Callable

from .common import MAX_JSON, digest, fields, identifier, now, read_json, refuse, relative
from .storage import atomic_write, canonical_bytes, confined_path, exclusive_lock


def state_bytes(value):
    """Bound state formatting without changing parsed evidence or its digest."""
    payload = canonical_bytes(value)
    if len(payload) > MAX_JSON:
        payload = (json.dumps(value, sort_keys=True, separators=(",", ":")) + "\n").encode("utf-8")
    if len(payload) > MAX_JSON:
        refuse("state.capacity", "The bounded local record store is full.", "Preserve and archive completed local work before admitting more records.")
    return payload


MAX_ARCHIVES = 1024
MAX_ARCHIVE_BATCH = 128
MAX_ARCHIVE_EVENTS = 64
STORAGE_SCHEMA = "development-state-storage-v1"
ARCHIVE_SCHEMA = "completed-work-reference-v1"


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
        if not isinstance(value, dict) or value.get("schema_version") != "development-state-v1" or type(value.get("revision")) is not int or value["revision"] < 0 or any(not isinstance(value.get(k), dict) for k in ("work_items", "trials", "feedback")):
            refuse("state.invalid", "Local state has an unsupported schema.")
        if "state_digest" in value and value["state_digest"] != digest({k: v for k, v in value.items() if k != "state_digest"}):
            refuse("state.integrity", "Local state integrity failed; original bytes were preserved.")
        if "storage_archive_events" in value:
            events = value["storage_archive_events"]
            if not isinstance(events, list) or len(events) > MAX_ARCHIVE_EVENTS:
                refuse("archive.capacity", "The bounded archive audit history is invalid.")
            for event in events:
                keys = {"schema_version", "at", "work_ids", "authority_ref", "before_state_digest", "bootstrap_manifest_sha256"}
                fields(event, keys, keys)
                ids = event["work_ids"]
                if (event["schema_version"] != "completed-work-archive-event-v1" or not isinstance(ids, list) or
                        not 1 <= len(ids) <= MAX_ARCHIVE_BATCH or any(not isinstance(v, str) for v in ids) or len(set(ids)) != len(ids) or
                        not isinstance(event["at"], str) or not re.fullmatch(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z", event["at"]) or
                        not isinstance(event["before_state_digest"], str) or not re.fullmatch(r"[a-f0-9]{64}", event["before_state_digest"]) or
                        event["bootstrap_manifest_sha256"] is not None and (not isinstance(event["bootstrap_manifest_sha256"], str) or not re.fullmatch(r"[a-f0-9]{64}", event["bootstrap_manifest_sha256"]))):
                    refuse("archive.audit", "The archive audit record is invalid.")
                identifier(event["authority_ref"])
                for work_id in ids:
                    identifier(work_id)
        return value

    def load(self):
        """Return the same logical v1 objects, including completed history.

        Physical index and archive input are each bounded to MAX_JSON. Loading
        at most their combined 16 MiB does not increase any individual JSON,
        journal, model, process or disk admission limit.
        """
        return self._load_storage()[0]

    def _load_storage(self):
        if not self.path.exists():
            value = self.empty()
            return value, {}, value
        value = read_json(self.path)
        logical, references = self._decode_storage(value)
        return logical, references, value

    def _archive_directory(self):
        # Inspect the exact spelling before resolution. Generic repository
        # containment permits a junction to another directory inside the repo;
        # that must not redirect archive reads or publication.
        current = self.root
        for part in (None, ".local-codex", "control-plane", "archives"):
            if part is not None:
                current = current / part
            try:
                info = current.lstat()
            except FileNotFoundError:
                break
            if not stat.S_ISDIR(info.st_mode) or current.is_symlink() or getattr(info, "st_file_attributes", 0) & 0x400:
                refuse("archive.path", "Archive ancestors must be regular non-reparse directories.")
        return self.root / ".local-codex/control-plane/archives"

    def _archive_leaf(self, identity):
        if not isinstance(identity, str) or not re.fullmatch(r"[a-f0-9]{64}", identity):
            refuse("archive.reference", "The completed-work reference is invalid.")
        path = self._archive_directory() / f"{identity}.json"
        try:
            info = path.lstat()
        except FileNotFoundError:
            return path, None
        # Only a no-follow missing leaf is absent. In particular, exists() is
        # false for dangling links and must never grant replacement authority.
        if (not stat.S_ISREG(info.st_mode) or info.st_nlink != 1 or
                getattr(info, "st_file_attributes", 0) & 0x400 or not 0 < info.st_size <= MAX_JSON):
            refuse("archive.path", "Existing archive leaves must be bounded regular single-link non-reparse files.")
        return path, info

    def _archive_path(self, identity):
        return self._archive_leaf(identity)[0]

    @staticmethod
    def _completed(work, work_id):
        if (not isinstance(work, dict) or work.get("status") != "complete" or
                "claim" not in work or work["claim"] is not None or
                not isinstance(work.get("spec"), dict) or work["spec"].get("work_id") != work_id):
            refuse("archive.not-completed", "Only exact completed unclaimed work can be archived.")

    def _read_archive(self, reference, work_id):
        fields(reference, {"schema_version", "work_id", "archive_digest"}, {"schema_version", "work_id", "archive_digest"})
        if reference["schema_version"] != ARCHIVE_SCHEMA or reference["work_id"] != identifier(work_id):
            refuse("archive.reference", "The completed-work identity does not match its reference.")
        path, before = self._archive_leaf(reference["archive_digest"])
        if before is None:
            refuse("archive.unavailable", "Completed history is missing; original references were preserved.")
        def signature(info):
            reparse = getattr(info, "st_file_attributes", 0) & 0x400
            if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1 or reparse or not 0 < info.st_size <= MAX_JSON:
                refuse("archive.capacity", "A completed-work object is not a bounded regular single-link non-reparse file.")
            return (info.st_dev, info.st_ino, info.st_size, info.st_mtime_ns,
                    stat.S_IFMT(info.st_mode), info.st_nlink, reparse)
        expected = signature(before)
        with path.open("rb") as stream:
            if signature(os.fstat(stream.fileno())) != expected:
                refuse("archive.integrity", "Completed history changed before reading.")
            raw = stream.read(before.st_size + 1)
            after = os.fstat(stream.fileno())
        _path, named = self._archive_leaf(reference["archive_digest"])
        if named is None or len(raw) != before.st_size or signature(after) != expected or signature(named) != expected:
            refuse("archive.integrity", "Completed history changed while reading.")
        try:
            value = json.loads(raw)
        except (ValueError, UnicodeError):
            refuse("archive.integrity", "Completed history is not valid JSON.")
        if hashlib.sha256(raw).hexdigest() != reference["archive_digest"] or digest(value) != reference["archive_digest"]:
            refuse("archive.integrity", "Completed history changed; original bytes were preserved.")
        self._completed(value, work_id)
        return value

    def _decode_storage(self, value):
        references = {}
        if not isinstance(value, dict):
            refuse("state.invalid", "Local state has an unsupported schema.")
        if value.get("schema_version") == STORAGE_SCHEMA:
            fields(value, {"schema_version", "state", "storage_digest"}, {"schema_version", "state", "storage_digest"})
            if value["storage_digest"] != digest({k: v for k, v in value.items() if k != "storage_digest"}):
                refuse("archive.storage-integrity", "The physical record index failed its integrity check.")
            wire = value["state"]
            if not isinstance(wire, dict) or "state_digest" not in wire:
                refuse("state.integrity", "The logical state is missing its integrity record.")
            self.validate({k: v for k, v in wire.items() if k != "state_digest"})
            references = {k: v for k, v in wire["work_items"].items()
                          if isinstance(v, dict) and v.get("schema_version") == ARCHIVE_SCHEMA}
            if not references or len(references) > MAX_ARCHIVES:
                refuse("archive.capacity", "The completed-work archive count exceeds its fixed bound.")
            total = 0
            for work_id, reference in references.items():
                fields(reference, {"schema_version", "work_id", "archive_digest"}, {"schema_version", "work_id", "archive_digest"})
                if reference["work_id"] != identifier(work_id):
                    refuse("archive.reference", "The completed-work identity does not match its reference.")
                _path, info = self._archive_leaf(reference["archive_digest"])
                if info is None:
                    refuse("archive.unavailable", "Completed history is missing; original references were preserved.")
                total += info.st_size
            if total > MAX_JSON:
                refuse("archive.capacity", "Completed-work input exceeds its fixed aggregate bound.")
            logical = dict(wire)
            logical["work_items"] = dict(wire["work_items"])
            for work_id, reference in references.items():
                logical["work_items"][work_id] = self._read_archive(reference, work_id)
        else:
            logical = value
            self.validate({k: v for k, v in value.items() if k != "state_digest"})
            if any(isinstance(w, dict) and w.get("schema_version") == ARCHIVE_SCHEMA
                   for w in value.get("work_items", {}).values()):
                refuse("archive.storage-integrity", "Archive references require their physical integrity envelope.")
        if "state_digest" not in logical:
            refuse("state.integrity", "Persisted local state is missing its integrity record.")
        return self.validate(logical), references

    def _encode_storage(self, logical, references):
        if not references:
            return logical
        if len(references) > MAX_ARCHIVES:
            refuse("archive.capacity", "The completed-work archive count exceeds its fixed bound.")
        wire = dict(logical)
        wire["work_items"] = dict(logical["work_items"])
        for work_id, reference in references.items():
            work = logical["work_items"].get(work_id)
            self._completed(work, work_id)
            if digest(work) != reference["archive_digest"]:
                refuse("archive.immutable", "Completed archived history cannot be changed.")
            wire["work_items"][work_id] = reference
        value = {"schema_version": STORAGE_SCHEMA, "state": wire}
        value["storage_digest"] = digest(value)
        return value

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

    def _externalize_baselines(self, state, immutable_ids=()):
        for work_id, work in state["work_items"].items():
            if work_id in immutable_ids:
                continue
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
        if not isinstance(j, dict):
            refuse("transaction.invalid", "The recovery journal is malformed; original bytes were preserved.")
        version2 = j.get("schema_version") == "development-transaction-v2"
        keys = {"schema_version", "before", "successor"} | ({"before_storage_digest"} if version2 else set())
        if set(j) != keys or j["schema_version"] not in ("development-transaction-v1", "development-transaction-v2"):
            refuse("transaction.invalid", "The recovery journal is malformed; original bytes were preserved.")
        if version2 and any(not isinstance(j[k], str) or not re.fullmatch(r"[a-f0-9]{64}", j[k]) for k in ("before", "before_storage_digest")):
            refuse("transaction.invalid", "The archive journal predecessor identities are invalid.")
        if not isinstance(j["successor"], dict) or (not version2 and "state_digest" not in j["successor"]):
            refuse("transaction.integrity", "The recovery successor lacks its integrity record; original bytes were preserved.")
        if version2:
            if j["successor"].get("schema_version") != STORAGE_SCHEMA:
                refuse("transaction.invalid", "The archive journal is missing its physical envelope.")
            successor, references = self._decode_storage(j["successor"])
        else:
            successor, references = self.validate(j["successor"]), {}
        current, _current_references, current_wire = self._load_storage()
        if successor["revision"] != current["revision"] + 1 and digest(current) != digest(successor):
            refuse("transaction.conflict", "Recovery conflicts with the current revision.")
        if digest(current) not in {j["before"], digest(successor)}:
            refuse("transaction.conflict", "Recovery input changed outside the recorded transaction.")
        if version2:
            pair = (digest(current), digest(current_wire))
            if pair not in {(j["before"], j["before_storage_digest"]), (digest(successor), digest(j["successor"]))}:
                refuse("transaction.conflict", "Physical and logical predecessors do not match the archive transaction.")
            # After the state write, current already IS successor, while the
            # index can still name the exact declared predecessor. Its full
            # logical identity is retained in the journal, even when its old
            # physical bytes have been replaced.
            self._check_index_identities({(successor["revision"] - 1, j["before"]),
                                          (successor["revision"], digest(successor))})
        # Recovery must use the same bound as normal publication. A compact
        # journal must never expand into an unreadable indented state file.
        payload = state_bytes(self._encode_storage(successor, references))
        atomic_write(self.path, payload)
        atomic_write(self.index, canonical_bytes({"schema_version": "development-index-v1", "revision": successor["revision"], "state_digest": digest(successor)}))
        if version2:
            self._check_index(successor)
        self.journal.unlink()
        return True

    def recover(self):
        with exclusive_lock(self.lock):
            self._bootstrap_guard()
            return self._recover()

    def _check_index(self, *states):
        self._check_index_identities({(s["revision"], digest(s)) for s in states})

    def _check_index_identities(self, identities):
        value = read_json(self.index)
        fields(value, {"schema_version", "revision", "state_digest"}, {"schema_version", "revision", "state_digest"})
        if (value["schema_version"] != "development-index-v1" or type(value["revision"]) is not int or value["revision"] < 0 or
                not isinstance(value["state_digest"], str) or not re.fullmatch(r"[a-f0-9]{64}", value["state_digest"]) or
                (value["revision"], value["state_digest"]) not in identities):
            refuse("archive.index-conflict", "The record index does not match the declared logical state.")

    def _bootstrap_guard(self, manifest=None):
        marker = confined_path(self.root, ".local-codex/control-plane/bootstrap-recovery.lock")
        if not marker.exists():
            if manifest is not None:
                refuse("archive.bootstrap-owner", "The declared recovery owner is unavailable.")
            return
        value = read_json(marker, maximum=16 * 1024)
        if (manifest is None or not isinstance(manifest, str) or not re.fullmatch(r"[a-f0-9]{64}", manifest) or
                not isinstance(value, dict) or value.get("schema_version") != "control-plane-bootstrap-owner-v1" or value.get("plan_sha256") != manifest):
            refuse("archive.bootstrap-active", "An explicit reviewed record-store recovery owns this checkout.")

    def archive_completed(self, request):
        """Archive only named completed records. This never prunes history."""
        return self._archive_completed(request)

    def _archive_completed(self, request, *, bootstrap_manifest=None, fault_after=None):
        # A capacity bootstrap uses a separately reviewed private one-use driver.
        # The public CLI cannot supply a bootstrap override or an execution path.
        keys = {"schema_version", "work_ids", "expected_revision", "expected_state_digest", "authority_ref"}
        fields(request, keys, keys)
        ids = request["work_ids"]
        if (request["schema_version"] != "completed-work-archive-request-v1" or not isinstance(ids, list) or
                not 1 <= len(ids) <= MAX_ARCHIVE_BATCH or any(not isinstance(v, str) for v in ids) or len(set(ids)) != len(ids) or
                type(request["expected_revision"]) is not int or request["expected_revision"] < 0 or
                not isinstance(request["expected_state_digest"], str) or not re.fullmatch(r"[a-f0-9]{64}", request["expected_state_digest"])):
            refuse("archive.request", "Provide the bounded completed-work archive request.")
        ids = sorted(identifier(v) for v in ids)
        authority = identifier(request["authority_ref"])
        self._archive_directory()  # Deny redirected ancestors before any transition.
        def transition(state):
            if digest(state) != request["expected_state_digest"]:
                refuse("state.revision-conflict", "The record store changed before archival.")
            self._check_index(state)
            for work_id in ids:
                self._completed(state["work_items"].get(work_id), work_id)
            events = state.setdefault("storage_archive_events", [])
            if not isinstance(events, list) or len(events) >= MAX_ARCHIVE_EVENTS:
                refuse("archive.capacity", "The bounded archive audit history is full.")
            events.append({"schema_version": "completed-work-archive-event-v1", "at": now(), "work_ids": ids,
                           "authority_ref": authority, "before_state_digest": request["expected_state_digest"],
                           "bootstrap_manifest_sha256": bootstrap_manifest})
            return {"archived_work_ids": ids, "history_removed": False, "bootstrap_exception": bootstrap_manifest is not None}
        return self._mutate(transition, expected_revision=request["expected_revision"], fault_after=fault_after,
                            archive_ids=ids, bootstrap_manifest=bootstrap_manifest)

    def mutate(self, transition: Callable, *, expected_revision=None, fault_after=None):
        return self._mutate(transition, expected_revision=expected_revision, fault_after=fault_after)

    def _mutate(self, transition: Callable, *, expected_revision=None, fault_after=None, archive_ids=(), bootstrap_manifest=None):
        with exclusive_lock(self.lock):
            self._bootstrap_guard(bootstrap_manifest)
            self._recover()
            current, references, current_wire = self._load_storage()
            if references:
                self._check_index(current)
            if expected_revision is not None and expected_revision != current["revision"]:
                refuse("state.revision-conflict", "State changed since the requested revision.", "Reload status and reconcile before retrying.")
            successor = copy.deepcopy(current)
            result = transition(successor)
            # Publish snapshots before their references enter a recoverable journal.
            # Interrupted writes may leave harmless unreferenced snapshots; history
            # and existing evidence are never removed or recomputed.
            if set(archive_ids) & set(references) or len(references) + len(archive_ids) > MAX_ARCHIVES:
                refuse("archive.capacity", "Archival requires new completed IDs within the fixed archive count.")
            self._externalize_baselines(successor, set(references) | set(archive_ids))
            references = dict(references)
            payloads = {}
            for work_id in archive_ids:
                work = successor["work_items"][work_id]
                self._completed(work, work_id)
                payload = canonical_bytes(work)
                if len(payload) > MAX_JSON:
                    refuse("archive.capacity", "A completed-work object exceeds its fixed bound.")
                identity = digest(work)
                payloads[work_id] = payload
                references[work_id] = {"schema_version": ARCHIVE_SCHEMA, "work_id": work_id, "archive_digest": identity}
            total = 0
            for work_id, reference in references.items():
                path, info = self._archive_leaf(reference["archive_digest"])
                if info is not None:
                    if self._read_archive(reference, work_id) != successor["work_items"][work_id]:
                        refuse("archive.immutable", "Existing archive bytes cannot be replaced.")
                    total += info.st_size
                else:
                    if work_id not in payloads:
                        refuse("archive.unavailable", "Completed history is missing; no successor was published.")
                    total += len(payloads[work_id])
            if total > MAX_JSON:
                refuse("archive.capacity", "Completed-work input exceeds its fixed aggregate bound.")
            successor.pop("state_digest", None)
            successor["revision"] = current["revision"] + 1
            successor["updated_at"] = now()
            successor["state_digest"] = digest(successor)
            stored = self._encode_storage(successor, references)
            state_payload = state_bytes(stored)
            self.validate(successor)
            # The journal wraps the same state. Indenting that nested object can
            # exceed its reader bound even when the state itself fits. Whitespace
            # is not part of the parsed-value digest or recovery contract.
            journal = {"schema_version": "development-transaction-v2" if references else "development-transaction-v1",
                       "before": digest(current), "successor": stored}
            if references:
                journal["before_storage_digest"] = digest(current_wire)
            journal_payload = (json.dumps(journal, sort_keys=True, separators=(",", ":")) + "\n").encode("utf-8")
            if len(journal_payload) > MAX_JSON:
                refuse("state.capacity", "The bounded local recovery journal is full.", "Preserve and archive completed local work before admitting more records.")
            # Exact state and journal sizes pass before any archive publication.
            # A failed write may leave a harmless immutable object, never a live
            # reference to unwritten history. Such objects are not auto-deleted.
            for work_id, payload in payloads.items():
                path, info = self._archive_leaf(references[work_id]["archive_digest"])
                if info is None:
                    atomic_write(path, payload)
                if self._read_archive(references[work_id], work_id) != successor["work_items"][work_id]:
                    refuse("archive.integrity", "Completed history did not publish intact.")
            if fault_after == "archives":
                raise OSError("injected archive publication interruption")
            atomic_write(self.journal, journal_payload)
            if fault_after == "journal":
                raise OSError("injected publication interruption")
            atomic_write(self.path, state_payload)
            if fault_after == "state":
                raise OSError("injected publication interruption")
            self._recover()
            return result
