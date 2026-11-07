"""Model-free portable checks. No Native command or application is launched."""
import copy
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import shutil
import tempfile
import types
import unittest
from unittest.mock import patch

FILE = Path(__file__).resolve().parents[1] / "serial_provided_coordinator.py"
SPEC = importlib.util.spec_from_file_location("serial_provided_coordinator_tests", FILE)
S = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(S)
REV = "source." + "a" * 64


class CoordinatorTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name).resolve()
        self.candidate = self.root / ".local-codex/q/1234abcd/c"
        self.candidate.mkdir(parents=True)
        self.run = self.candidate / ".local-codex/native-fixed-host-operator/runs" / ("1" * 32)
        self.output = self.run / "serial-provided/coordinator"
        self.output.parent.mkdir(parents=True)
        self.qid = "qualification-test-1234567890"
        # Direct report validators accept already-resolved roots. Keep these
        # fixtures short on Windows; ui() separately tests their derivation.
        self.folder = self.root / "e"
        self.base = self.root / "d"

    def put(self, file, value):
        file.parent.mkdir(parents=True, exist_ok=True)
        file.write_bytes(value if type(value) is bytes else (json.dumps(value) + "\n").encode())
        return S.sha(file.read_bytes())

    def test_checked_in_entry_refuses_before_io_or_native_import(self):
        with patch.object(S, "load_context") as load, patch.object(S, "Coordinator") as coordinator:
            with self.assertRaisesRegex(S.Refused, "compiled-reviewed-context-required"):
                S.main()
            load.assert_not_called()
            coordinator.assert_not_called()

    def test_duplicate_nonfinite_invalid_and_deep_json_are_refused(self):
        for value in (b'{"a":1,"a":2}', b'{"a":NaN}', b'{"a":Infinity}', b'\xff', b'[', b'[' * 3000 + b'0' + b']' * 3000):
            with self.subTest(value=value[:20]), self.assertRaises(S.Refused):
                S.decode(value)

    def test_stable_same_snapshot_is_hashed_and_decoded(self):
        file = self.root / "input.json"
        digest = self.put(file, {"a": 1})
        with patch.object(Path, "open", autospec=True, side_effect=Path.open) as opened:
            self.assertEqual(S.read_json(file, 64, digest), {"a": 1})
        self.assertEqual(opened.call_count, 1)

    def test_oversize_is_refused_before_open_and_bad_digest_is_not_parsed(self):
        file = self.root / "input.json"
        self.put(file, b"x" * 65)
        with patch.object(Path, "open", side_effect=AssertionError("must not read")):
            with self.assertRaisesRegex(S.Refused, "file-bound"):
                S.read_json(file, 64)
        with patch.object(S, "decode", side_effect=AssertionError("must not parse")):
            with self.assertRaisesRegex(S.Refused, "file-digest-drift"):
                S.read_json(file, 128, "0" * 64)

    def test_hash_reader_denies_growth_truncation_replacement_and_read_error(self):
        file = self.root / "input.json"
        self.put(file, b"1234")
        real_open = Path.open
        for replacement in (b"12345", b"1"):
            self.put(file, b"1234")
            def changed_open(path, *args, **kwargs):
                stream = real_open(path, *args, **kwargs)
                with real_open(path, "wb") as writer:
                    writer.write(replacement)
                return stream
            with self.subTest(replacement=replacement), patch.object(Path, "open", changed_open), self.assertRaises(S.Refused):
                S.read_bytes(file, 4)
        self.put(file, b"1234")
        real_ordinary = S.ordinary
        with patch.object(S, "ordinary", wraps=real_ordinary) as ordinary:
            calls = 0
            def swapped(path, *args):
                nonlocal calls
                calls += 1
                if calls == 2:
                    new = file.with_suffix(".new")
                    self.put(new, b"1234")
                    os.replace(new, file)
                return real_ordinary(path, *args)
            ordinary.side_effect = swapped
            with self.assertRaisesRegex(S.Refused, "file-snapshot-changed"):
                S.read_bytes(file, 4)
        with patch.object(Path, "open", side_effect=PermissionError), self.assertRaises(PermissionError):
            S.read_bytes(file, 4)

    def test_inventory_cannot_mix_metadata_before_replacement_with_new_hash(self):
        folder = self.root / "inventory"; folder.mkdir()
        file = folder / "a.txt"; self.put(file, b"old")
        real_reader = S.read_bytes
        def changed_reader(path, *args, **kwargs):
            self.put(path, b"changed")
            return real_reader(path, *args, **kwargs)
        with patch.object(S, "read_bytes", changed_reader), self.assertRaisesRegex(S.Refused, "inventory-snapshot-changed"):
            S.inventory(folder)

    def test_hardlinks_and_symlinks_cannot_supply_proof_or_absent_entry(self):
        file = self.root / "input.json"
        self.put(file, b"{}")
        linked = self.root / "linked.json"
        os.link(file, linked)
        with self.assertRaisesRegex(S.Refused, "ordinary-single-link-file-required"):
            S.read_bytes(linked, 64)
        os.unlink(linked)
        # Portable fake dangling link: absence must use lstat and never exists().
        broken = self.root / "broken"
        with patch.object(Path, "lstat", return_value=types.SimpleNamespace(st_mode=0o120777)):
            self.assertFalse(S.absent(broken))

    def test_directory_enumeration_stops_at_cap_while_collecting(self):
        seen = []
        class Entries:
            def __enter__(self): return self
            def __exit__(self, *_): return False
            def __iter__(self):
                for i in range(1000):
                    seen.append(i)
                    yield types.SimpleNamespace(name=str(i))
        with patch.object(os, "scandir", return_value=Entries()):
            with self.assertRaisesRegex(S.Refused, "directory-entry-bound"):
                S.names(self.root, 2)
        self.assertEqual(seen, [0, 1, 2])

    def test_fresh_writer_keeps_old_bytes_and_partial_failure_consumes(self):
        file = self.root / "used.json"
        S.write_fresh(file, {"first": True})
        before = file.read_bytes()
        with self.assertRaises(S.Refused):
            S.write_fresh(file, {"second": True})
        self.assertEqual(file.read_bytes(), before)
        with self.assertRaises(S.Refused):
            S.write_fresh(self.root / "too-big.json", {"x": "z" * 20}, 8)
        self.assertTrue(S.absent(self.root / "too-big.json"))
        new = self.root / "partial.json"
        with patch.object(os, "fsync", side_effect=OSError), self.assertRaises(OSError):
            S.write_fresh(new, {"first": True})
        with self.assertRaises(S.Refused):
            S.write_fresh(new, {"second": True})

    def tree(self, directories=None):
        tree = {"schema_version": "fixed-packaged-desktop-tree-v1", "root": str(self.root), "caps": S.TREE_CAPS,
                "files": [{"path": "a.txt", "bytes": 1, "sha256": "a" * 64}], "directories": directories or ["."], "total_bytes": 1}
        tree["framed_sha256"] = S.frame(tree)
        return tree

    def test_package_transition_allows_only_empty_literal_additions_and_preserves_predecessor(self):
        original = self.tree()
        before = self.tree(sorted([".", S.EMPTY_GPU_DIRS[0]]))
        after = self.tree(sorted([".", *S.EMPTY_GPU_DIRS]))
        for row in (original, before, after):
            S.validate_tree(row, self.root)
        S.compare_trees(original, before, after)
        self.assertNotEqual(original["framed_sha256"], after["framed_sha256"])
        cases = []
        extra = copy.deepcopy(after); extra["directories"].append("unreviewed"); cases.append(extra)
        removed = copy.deepcopy(original); cases.append(removed)
        changed = copy.deepcopy(after); changed["files"][0]["sha256"] = "b" * 64; cases.append(changed)
        dirty = copy.deepcopy(after); dirty["files"].append({"path": S.EMPTY_GPU_DIRS[1] + "/log.txt", "bytes": 0, "sha256": "b" * 64}); cases.append(dirty)
        cased = copy.deepcopy(after); cased["directories"][-1] = S.EMPTY_GPU_DIRS[1].lower(); cases.append(cased)
        for row in cases:
            with self.subTest(row=row), self.assertRaises(S.Refused):
                S.compare_trees(original, before, row)

    def test_invalid_relative_members_and_duplicate_or_forged_frames_are_refused(self):
        for value in ("../x", "/x", "a//b", "C:/x", "a\\b", "a/./b", "a/\0b"):
            with self.subTest(value=value), self.assertRaises(S.Refused):
                S.relative_path(value)
        for change in (lambda t: t.update(framed_sha256="b" * 64), lambda t: t["files"].append(t["files"][0]), lambda t: t["directories"].append("."), lambda t: t.update(total_bytes=True)):
            row = self.tree(); change(row)
            if row["framed_sha256"] != "b" * 64: row["framed_sha256"] = S.frame(row)
            with self.assertRaises(S.Refused): S.validate_tree(row, self.root)

    def native(self, folder, phase):
        logs = {}
        for name in ("stdout", "stderr"):
            file = folder / (name + ".log")
            digest = self.put(file, b"ok\n")
            logs[name] = {"path": str(file), "bytes": 3, "observed_bytes": 3, "cap_bytes": 8 * S.MIB, "complete": True, "sha256": digest}
        return {"limits": {"flags": 0x2308, "process_bytes": S.GIB, "job_bytes": (2 if phase == "package" else 3) * S.GIB, "active_limit": 32},
                "command_passed": True, "root_exit_code": 0, "cleanup_confirmed": True, "all_owned_handles_close_acknowledged": True,
                "assigned_at_creation": True, "resumed_after_membership": True, "job_accounting": {"active": 0, "total": 1}, "reason": None,
                "forced_owned_job_termination": False, "log_overflow": False, "completion_message_overflow": False, "fence_required": False,
                "observed_limit_messages": [], "cleanup_errors": [], "logs": logs}

    def test_native_success_requires_original_success_and_every_retirement_and_stream_fact(self):
        row = self.native(self.output, "package")
        S.verify_native(row, self.output, "package")
        changes = [(key, False) for key in ("command_passed", "cleanup_confirmed", "all_owned_handles_close_acknowledged", "assigned_at_creation", "resumed_after_membership")]
        changes += [(key, True) for key in ("forced_owned_job_termination", "log_overflow", "completion_message_overflow", "fence_required")]
        changes += [("root_exit_code", 23), ("root_exit_code", True), ("reason", "timeout"), ("cleanup_errors", ["close"]), ("observed_limit_messages", [9])]
        for key, value in changes:
            mutated = copy.deepcopy(row); mutated[key] = value
            with self.subTest(key=key, value=value), self.assertRaises(S.Refused): S.verify_native(mutated, self.output, "package")
        for key, value in (("complete", False), ("bytes", True), ("observed_bytes", 4), ("sha256", "0" * 64)):
            mutated = copy.deepcopy(row); mutated["logs"]["stdout"][key] = value
            with self.subTest(key=key), self.assertRaises(S.Refused): S.verify_native(mutated, self.output, "package")

    def test_failed_command_with_proven_retirement_is_distinct_from_unknown_ownership(self):
        row = self.native(self.output, "package")
        row.update(command_passed=False, root_exit_code=1)
        with self.assertRaisesRegex(S.Refused, "^native-command-failed$"):
            S.verify_native(row, self.output, "package")
        for change in (lambda value: value.update(cleanup_confirmed=False),
                       lambda value: value.update(all_owned_handles_close_acknowledged=False),
                       lambda value: value["job_accounting"].update(active=1)):
            unknown = copy.deepcopy(row); change(unknown)
            with self.assertRaisesRegex(S.Refused, "^native-retirement-unconfirmed$"):
                S.verify_native(unknown, self.output, "package")

    def caches(self, host):
        items = []
        for index, (phase, cache, cleanup, ack) in enumerate(S.cache_census(host, self.base)):
            pid, parent = 100 + index, 200 + index
            identity = {"pid": pid, "parentPid": parent, "scenario": "dataset-profile"}
            name = f"qualification-worker-identity-{pid}.json"
            digest = self.put(cache / name, identity)
            items.append({"host": host, "phase": phase, "cache": str(cache), "failure_journals": 0, "outer_native_retirement_still_required": True,
                          "workers": [{"identity_file": name, "identity_sha256": digest, "identity": identity, "observed_alive": False}]})
            if host == "desktop":
                self.put(self.folder / "owned-host" / cleanup, {"schemaVersion": "owned-host-outcome-v1", "kind": "cleanup", "status": "passed", "sourceRevision": REV,
                    "mainPid": parent, "launchedPid": parent, "mainExitCode": 0, "willQuitAcknowledged": True, "physicalWorkersObserved": 1,
                    "physicalWorkersAlive": 0, "failures": 0, "failureTypes": [], "failureStages": [], "cleanupMilliseconds": 0.1})
                self.put(cache / ack, {"pid": parent, "event": "will-quit"})
        phase_folder = self.run / ("ui-" + host)
        inventory = {"schema_version": "actual-provided-single-host-worker-inventory-v1", "source_revision": REV, "project": S.PROJECTS[host], "phase": "ui-" + host, "inventories": items, "native_or_parent_pass_claimed": False}
        self.put(phase_folder / "worker-evidence-inventory.json", inventory)
        if host == "thin":
            for sequence in (1, 2):
                self.put(self.base / "thin-runtime" / f"provided-server-session-{sequence}.json", {"schemaVersion": "provided-server-session-v1", "sourceRevision": REV, "sequence": sequence, "previousResourcesClosed": sequence == 2})
        return phase_folder, inventory

    def test_exact_five_caches_and_three_literal_desktop_cleanup_acknowledgments(self):
        self.assertEqual(len(S.cache_census("thin", self.base)), 2)
        census = S.cache_census("desktop", self.base)
        self.assertEqual([row[2] for row in census], ["cleanup-1a99ea6bc56b7bfe.json", "cleanup-cc2c6026b89b14be.json", "cleanup-93d2c1b7348239e8.json"])
        self.assertEqual(census[2][3], "qualification-will-quit.json")
        for host in ("thin", "desktop"):
            phase, _ = self.caches(host)
            proof = S.verify_caches(self.folder, self.base, host, REV, phase)
            self.assertTrue(proof)
        phase, inventory = self.caches("desktop")
        inventory["inventories"].pop()
        self.put(phase / "worker-evidence-inventory.json", inventory)
        with self.assertRaisesRegex(S.Refused, "worker-census-count"):
            S.verify_caches(self.folder, self.base, "desktop", REV, phase)

    def test_failure_journal_extra_identity_stale_source_and_wrong_session_ack_deny(self):
        for problem in ("failure", "extra", "stale", "ack", "parent", "nan", "reuse"):
            phase, inventory = self.caches("desktop")
            cache = S.cache_census("desktop", self.base)[2][1]
            added = None
            if problem == "failure": added = cache / "qualification-provided-failure-123.json"; self.put(added, {})
            if problem == "extra": added = cache / "qualification-worker-identity-999.json"; self.put(added, {})
            if problem == "stale": inventory["source_revision"] = "source." + "b" * 64
            if problem == "ack": self.put(cache / "qualification-will-quit.json", {"pid": 200, "event": "will-quit"})
            if problem == "parent": inventory["inventories"][2]["workers"][0]["identity"]["parentPid"] = 200
            if problem in ("nan", "reuse"):
                cleanup = self.folder / "owned-host" / S.cache_census("desktop", self.base)[2][2]
                row = json.loads(cleanup.read_bytes()); row["cleanupMilliseconds" if problem == "nan" else "mainPid"] = float("nan") if problem == "nan" else 200; self.put(cleanup, row)
            self.put(phase / "worker-evidence-inventory.json", inventory)
            with self.subTest(problem=problem), self.assertRaises(S.Refused): S.verify_caches(self.folder, self.base, "desktop", REV, phase)
            if added: added.unlink()

    def engine(self, fail=None, pending=False):
        events = []
        m = {"root": str(self.root), "candidate": str(self.candidate), "run": str(self.run), "_manifest_sha256": "a" * 64,
             "helpers": {name: "a" * 64 for name in S.HELPERS[:-1]}, "node": {"path": "node.exe", "sha256": "a" * 64},
             "environment": {}, "environment_sha256": "b" * 64, "_review_sha256": "c" * 64, "source_revision": REV, "native_module_sha256": "d" * 64}
        coordinator = S.Coordinator(m)
        coordinator.preserve = lambda: {"source": "unchanged"}
        def unchanged(_):
            events.append("preserve")
            if fail == "drift" and "package" in events: raise S.Refused("drift")
        coordinator.unchanged = unchanged
        coordinator.package = lambda: ({}, {"tree": "original"})
        def ui(phase, *_):
            events.append("validate-" + phase)
            if fail == "evidence" and phase == "ui-thin": raise S.Refused("bad-evidence")
            return {}, "a" * 64, phase
        coordinator.ui = ui
        test = self
        class Owner:
            def __init__(self, intent, folder): self.intent, self.folder, self.phase = intent, folder, "running"
            def run(self):
                events.append(self.intent)
                if fail == "interrupt" and self.intent == "ui-thin": raise KeyboardInterrupt()
                row = test.native(self.folder, self.intent)
                if fail == "exit" and self.intent == "ui-thin": row["root_exit_code"] = 23
                self.phase = "finished"
                if pending and self.intent == "ui-thin": job._PENDING["held"] = self
                return row
            def finish(self, reason):
                events.append("finish-owned-only")
                self.phase = "finished"
                return {"confirmed": not pending}
        job = types.SimpleNamespace(_LIVE={}, _PENDING={}, _OwnedJob=Owner)
        job._assert_no_pending = lambda: S.need(not job._PENDING, "pending-owner")
        job._reviewed_host_intent = lambda phase, **kwargs: phase
        return coordinator, job, events

    def test_phase_engine_runs_only_fixed_serial_order_with_validation_between_hosts(self):
        coordinator, job, events = self.engine()
        with patch("builtins.print"):
            report = coordinator.execute(job)
        phases = [entry for entry in events if entry in S.PHASES or entry.startswith("validate-")]
        self.assertEqual(phases, ["package", "ui-thin", "validate-ui-thin", "ui-desktop", "validate-ui-desktop"])
        self.assertTrue(report["passed"])
        self.assertTrue(report["outer_native_retirement_still_required"])
        self.assertFalse(report["parent_qualification_granted"])
        with self.assertRaisesRegex(S.Refused, "coordinator-output-not-fresh"):
            coordinator.execute(job)

    def test_failed_phase_evidence_or_interrupted_validation_never_issues_successor(self):
        for index, problem in enumerate(("exit", "evidence", "interrupt", "drift")):
            # Every attempt has an independent fresh owned namespace.
            self.run = self.run.parent / (str(index + 2) * 32)
            self.output = self.run / "serial-provided/coordinator"; self.output.parent.mkdir(parents=True)
            coordinator, job, events = self.engine(problem)
            with self.subTest(problem=problem), patch("builtins.print"), self.assertRaises(S.Refused): coordinator.execute(job)
            self.assertNotIn("ui-desktop", events)
            self.assertTrue((self.output / "USED.json").is_file())
            report = json.loads((self.output / "observation.json").read_bytes())
            self.assertFalse(report["passed"])
            self.assertIsNotNone(report["failure"])
            if problem == "interrupt": self.assertIn("finish-owned-only", events)

    def test_pending_owner_preserves_fence_and_never_issues_desktop(self):
        coordinator, job, events = self.engine(pending=True)
        with patch("builtins.print"), self.assertRaises(S.Refused): coordinator.execute(job)
        self.assertNotIn("ui-desktop", events)
        fence = self.run / "FENCED.json"
        self.assertTrue(fence.is_file())
        before = fence.read_bytes()
        with self.assertRaises(S.Refused): coordinator.execute(job)
        self.assertEqual(fence.read_bytes(), before)

    def test_preexisting_phase_or_family_fence_prevents_any_dispatch(self):
        coordinator, job, events = self.engine()
        self.put(self.run.parent.parent / "FENCED.json", {"old": True})
        with self.assertRaisesRegex(S.Refused, "retained-native-fence"): coordinator.execute(job)
        self.assertEqual(events, [])
        self.assertTrue(S.absent(self.output / "USED.json"))

    def test_accessibility_facts_recompute_success_and_cannot_hide_failed_retry(self):
        row = {"violations": [], "incomplete": [{"rule": "color-contrast", "nodes": 1}], "contrastPassedNodes": 1, "retries": {"attempted": 1, "passed": 1}}
        S.audit_facts(row)
        for key, value in (("violations", [{"rule": "label", "nodes": 1}]), ("incomplete", [{"rule": "label", "nodes": 1}]), ("contrastPassedNodes", 0), ("retries", {"attempted": 1, "passed": 0})):
            mutated = copy.deepcopy(row); mutated[key] = value
            with self.subTest(key=key), self.assertRaises(S.Refused): S.audit_facts(mutated)
        frame = {"dpr": 4, "cssZoom": "1", "visualScale": 1, "outerWidth": 1440, "innerWidth": 360, "layoutWidth": 360, "overflow": 0, "controls": 3, "inaccessible": 0}
        S.native_frame(frame)
        for key, value in (("dpr", 1), ("cssZoom", "4"), ("visualScale", 4), ("overflow", 2), ("inaccessible", 1)):
            mutated = dict(frame); mutated[key] = value
            with self.subTest(key=key), self.assertRaises(S.Refused): S.native_frame(mutated)

    def feature_reports(self, host):
        common = {"sourceRevision": REV, "host": host, "status": "passed", "modelGeneration": False, "ocr": False, "scope": "Fixed synthetic feature evidence only."}
        rows = {
            "provided-versions": {"schemaVersion": "provided-version-host-journey-v1", "savedVersions": 2, "savedRowsPerVersion": 8, "immutableBytesAndLineage": True, "compareUi": True, "explicitSupportedSetupReuse": True, "restartKind": "new-app-process" if host == "desktop" else "complete-service-recomposition", "persistedVersionIdentity": True, "restartedPreparationAndDiscard": True, "datasetSha256": "a" * 64},
            "saved-row-review": {"schemaVersion": "saved-row-review-host-journey-v1", "savedVersions": 3, "rowCounts": [8, 8, 7], "exactVisibleValues": True, "exactParentSourceRecipeLineage": True, "originalBytesRetained": True, "persistedRecordsAndBytesAfterRestart": True, "datasetDigests": ["sha256:" + "a" * 64] * 3},
            "source-context": {"schemaVersion": "source-context-host-journey-v1", "sourcePackAndRagReopened": True, "exactSavedBytesAndSourceLineage": True, "citedRetrievalAndSourceReturn": True, "originalPreservingRebuilds": 2, "cancelledDeletionRetainedCatalog": True, "selectedRemovalSurvivedReload": True, "discardedCandidateDidNotPublish": True, "desktopDownloadVerified": host == "desktop", "thinClientDownload": "not-an-existing-UI-control", "embedding": "closed-finite-vectors"},
            "manual-context": {"schemaVersion": "manual-context-host-journey-v1", "workspace": "test-workspace", "artifactId": "test-artifact", "storageKey": "context/file.json", "digest": "sha256:" + "a" * 64, "sizeBytes": 100, "manualDigest": "sha256:" + "b" * 64, "discardNoPublication": True, "cancelledDeletePreservedBytes": True, "confirmedCatalogRemoval": True, "deletedDetailRefused": True, "removalSurvivedRendererReload": True},
        }
        for name, row in rows.items():
            row.update(common)
            self.put(self.folder / name / (host + ".json"), row)
        return rows

    def test_current_typed_artifact_digests_are_accepted_but_raw_and_contract_hashes_are_distinct(self):
        for host in ("thin", "desktop"):
            rows = self.feature_reports(host)
            self.assertEqual(len(S.require_reports(self.folder, host, REV)), 4)
            for name, field, value in (("manual-context", "digest", "a" * 64), ("saved-row-review", "datasetDigests", ["a" * 64] * 3), ("provided-versions", "datasetSha256", "sha256:" + "a" * 64)):
                mutated = copy.deepcopy(rows[name]); mutated[field] = value
                file = self.folder / name / (host + ".json"); self.put(file, mutated)
                with self.subTest(host=host, name=name), self.assertRaises(S.Refused): S.require_reports(self.folder, host, REV)
                self.put(file, rows[name])

    def test_feature_reports_require_all_facts_current_source_and_exact_fields(self):
        rows = self.feature_reports("thin")
        for name, field, value in (("source-context", "citedRetrievalAndSourceReturn", False), ("saved-row-review", "rowCounts", [8, 8, 8]), ("provided-versions", "savedVersions", True), ("manual-context", "ocr", True), ("manual-context", "failureStage", "attach"), ("source-context", "sourceRevision", "old")):
            file = self.folder / name / "thin.json"
            mutated = dict(rows[name]); mutated[field] = value; self.put(file, mutated)
            with self.subTest(name=name, field=field), self.assertRaises(S.Refused): S.require_reports(self.folder, "thin", REV)
            self.put(file, rows[name])

    def manifest(self):
        original = Path(S.sys._base_executable)
        env = {"NODE_OPTIONS": "", "PYTHON_RUNTIME_QUALIFICATION_SCENARIO": "dataset-profile", "AISB_LOCAL_DESKTOP_UI_RUN": str(self.run), "PYTHON": str(original), "PYTHON_RUNTIME_COMMAND": str(original)}
        return {"schema_version": "fixed-serial-provided-manifest-v1", "root": str(self.root), "candidate": str(self.candidate), "run": str(self.run), "source_revision": REV,
                "native_module_sha256": "a" * 64, "node": {"path": str(self.root / "node.exe"), "sha256": "b" * 64},
                "helpers": {name: "a" * 64 for name in S.HELPERS[:-1]}, "runtime": [{"path": str(path), "sha256": "b" * 64, "maximum": 128 * S.MIB} for path in (original, original.with_name("python312.dll"), self.root / "node.exe")],
                "environment": env, "environment_sha256": S.sha(json.dumps(env, sort_keys=True, separators=(",", ":")).encode()),
                "preservation": [{"path": str(self.root / "source.py"), "sha256": "c" * 64, "maximum": S.MIB}],
                "directory_preservation": [{"path": str(self.root / "site"), "inventory": {"files": [], "directories": ["."], "total_bytes": 0}}],
                "official_zip_sha256": "d" * 64, "ocr_helper_source_sha256": "e" * 64}

    def test_manifest_has_no_command_budget_phase_or_model_selector_and_requires_original_runtime(self):
        row = self.manifest()
        S.validate_manifest(row)
        for change in (lambda m: m.update(argv=["cmd.exe"]), lambda m: m.update(timeout=9000), lambda m: m["helpers"].update({"serial-provided.py": "a" * 64}), lambda m: m["runtime"].pop(), lambda m: m.update(source_revision="old"), lambda m: m["preservation"].append(m["preservation"][0])):
            mutated = copy.deepcopy(row); change(mutated)
            with self.assertRaises(S.Refused): S.validate_manifest(mutated)

    def test_compiled_manifest_authorization_and_review_are_read_from_hash_bound_bytes(self):
        m = self.manifest()
        script = self.candidate / ".local-codex/native-fixed-host-operator/v1/serial-provided.py"
        self.put(script, b"# inert compiled consumer fixture\n")
        context = {}
        def proof(name, value):
            file = self.root / (name + ".json")
            context[name] = {"path": str(file), "sha256": self.put(file, value)}
        proof("manifest", m)
        review = {"schema_version": "fixed-serial-provided-effect-review-v1", "disposition": "accepted", "manifest_sha256": context["manifest"]["sha256"], "effect_scope": "package-then-thin-then-desktop-dataset-profile", "reviewer_invocation": "separate-test-review"}
        proof("review", review)
        auth = {"schema_version": "fixed-serial-provided-authorization-v1", "purpose": "fixed-serial-provided-v1", "execution_authorized": True, "attempts": 1, "manifest_sha256": context["manifest"]["sha256"], "review_sha256": context["review"]["sha256"]}
        proof("authorization", auth)
        loaded = S.load_context(context, script)
        self.assertEqual(loaded["_serial_sha256"], S.sha(script.read_bytes()))
        self.assertNotIn("serial-provided.py", loaded["helpers"])
        for field, value in (("attempts", 2), ("execution_authorized", False), ("review_sha256", "0" * 64), ("unexpected", True)):
            altered = dict(auth); altered[field] = value; proof("authorization", altered)
            with self.subTest(field=field), self.assertRaises(S.Refused): S.load_context(context, script)
        proof("authorization", auth)
        self.put(Path(context["manifest"]["path"]), dict(m, source_revision="old"))
        with self.assertRaisesRegex(S.Refused, "file-digest-drift"): S.load_context(context, script)

    def test_enclosing_live_logs_are_not_adopted_as_child_outputs(self):
        self.put(self.output.parent / "stdout.log", b"outer-current")
        self.put(self.output.parent / "stderr.log", b"")
        coordinator, job, _ = self.engine()
        with patch("builtins.print"):
            self.assertTrue(coordinator.execute(job)["passed"])
        self.assertEqual((self.output.parent / "stdout.log").read_bytes(), b"outer-current")

    def package_fixture(self):
        candidate, run, package_root = self.root / "c", self.root / "r", self.root / "p"
        coordinator = S.Coordinator({"root": str(self.root), "candidate": str(candidate), "run": str(run), "source_revision": REV, "official_zip_sha256": "d" * 64})
        coordinator.package_root = package_root
        self.put(candidate / ".vite/build/main.cjs", b"// inert production build fixture\n")
        self.put(package_root / "resources/app/.vite/build/main.cjs", (candidate / ".vite/build/main.cjs").read_bytes())
        self.put(package_root / "ai-system-builder.exe", b"inert fixture; never executed")
        source = candidate / "modules/adapters/runtime/python/worker"
        deployed = package_root / "resources/worker"
        cs = b"// synthetic helper source; never compiled\n"
        image = bytearray(256); image[:2] = b"MZ"; image[0x3c:0x40] = (64).to_bytes(4, "little"); image[64:68] = b"PE\0\0"; image[68:70] = (0x8664).to_bytes(2, "little")
        resource = {"schema_version": "windows-ocr-resource-v1", "provider": "windows", "provider_version": "1", "architecture": "x64", "source_sha256": S.sha(cs), "binary_sha256": S.sha(image), "binary_bytes": len(image)}
        for folder in (source, deployed):
            self.put(folder / "ocr/native/WindowsOcrHelper.cs", cs)
            self.put(folder / "ocr/native/build/WindowsOcrHelper.exe", bytes(image))
            self.put(folder / "ocr/native/build/resource.json", resource)
        inv = S.inventory(source)
        worker = {"schema_version": "fixed-deployed-ocr-worker-identity-v1", "selected_root": str(source), "deployed_root": str(deployed),
                  "all_worker_files_raw_exact": True, "optional_build_success_inferred_from_package_exit": False, "resource_runtime_or_UI_qualified": False,
                  "files": inv["files"], "total_bytes": inv["total_bytes"], "framed_sha256": S.sha(json.dumps({key: inv[key] for key in ("files", "total_bytes")}, separators=(",", ":")).encode()),
                  "helper_source_sha256": S.sha(cs), "helper_binary_sha256": S.sha(image), "helper_binary_bytes": len(image), "helper_manifest_sha256": S.sha((deployed / "ocr/native/build/resource.json").read_bytes())}
        worker_digest = self.put(run / "packaged-ocr-worker.json", worker)
        tree = {"schema_version": "fixed-packaged-desktop-tree-v1", "root": str(package_root), "caps": S.TREE_CAPS, **S.inventory(package_root)}
        tree["framed_sha256"] = S.frame(tree)
        tree_digest = self.put(run / "packaged-tree.json", tree)
        receipt = {"schema_version": "offline-production-desktop-package-v2", "packaging_completed": True, "real_production_config_and_hooks": True, "zip_unchanged": True, "packaged_OCR_resource_validated": True,
                   "test_pass_claimed": False, "app_launched": False, "only_configuration_override": "packagerConfig.electronZipDir", "source_revision": REV, "zip_sha256": "d" * 64,
                   "executable": str(package_root / "ai-system-builder.exe"), "packaged_main": str(package_root / "resources/app/.vite/build/main.cjs"), "packaged_tree_path": str(run / "packaged-tree.json"),
                   "packaged_tree_file_sha256": tree_digest, "packaged_tree_framed_sha256": tree["framed_sha256"], "packaged_total_bytes": tree["total_bytes"], "packaged_files": len(tree["files"]), "packaged_directories": len(tree["directories"]),
                   "packaged_worker_identity_path": str(run / "packaged-ocr-worker.json"), "packaged_worker_identity_sha256": worker_digest, "packaged_worker_framed_sha256": worker["framed_sha256"]}
        self.put(run / "package-receipt.json", receipt)
        coordinator.m["ocr_helper_source_sha256"] = S.sha(cs)
        return coordinator, receipt, tree

    def test_real_synthetic_package_tree_worker_resource_and_main_are_all_checked(self):
        coordinator, receipt, tree = self.package_fixture()
        self.assertEqual(coordinator.package(), (receipt, tree))
        source_main = coordinator.candidate / ".vite/build/main.cjs"
        original = source_main.read_bytes()
        self.put(source_main, b"// stale source build")
        with self.assertRaisesRegex(S.Refused, "production-main-drift"): coordinator.package()
        self.put(source_main, original)
        resource = coordinator.package_root / "resources/worker/ocr/native/build/resource.json"
        self.put(resource, {"fake": True})
        with self.assertRaises(S.Refused): coordinator.package()

    def test_package_receipt_cannot_infer_hooks_or_worker_validation_from_exit_alone(self):
        coordinator, receipt, _ = self.package_fixture()
        for field, value in (("real_production_config_and_hooks", False), ("app_launched", True), ("test_pass_claimed", True), ("packaged_OCR_resource_validated", False), ("source_revision", "old"), ("only_configuration_override", "skip hooks")):
            row = dict(receipt); row[field] = value; self.put(coordinator.run / "package-receipt.json", row)
            with self.subTest(field=field), self.assertRaises(S.Refused): coordinator.package()

    def test_ui_phase_requires_actual_predecessor_tree_and_its_own_two_current_tests(self):
        coordinator, receipt, original = self.package_fixture()
        coordinator.package()
        phase = coordinator.run / "ui-thin"
        before = copy.deepcopy(original)
        for relative in S.EMPTY_GPU_DIRS:
            (coordinator.package_root / relative).mkdir(parents=True, exist_ok=True)
        after = {"schema_version": original["schema_version"], "root": original["root"], "caps": S.TREE_CAPS, **S.inventory(coordinator.package_root)}
        after["framed_sha256"] = S.frame(after)
        before_hash = self.put(phase / "packaged-tree-actual-before-ui.json", before)
        after_hash = self.put(phase / "packaged-tree-actual-after-ui.json", after)
        package_hash = coordinator.evidence[str(coordinator.run / "package-receipt.json")]
        before_summary = {"schema_version": "fixed-provided-package-before-ui-v1", "project": "thin-chrome", "phase": "ui-thin", "source_revision": REV, "package_receipt_sha256": package_hash,
                          "original_packaged_tree_framed_sha256": original["framed_sha256"], "actual_before_tree_file_sha256": before_hash, "actual_before_packaged_tree_framed_sha256": before["framed_sha256"],
                          "predecessor_after_tree_file_sha256": None, "added_empty_directories": [], "all_packaged_files_unchanged": True, "all_original_packaged_directories_preserved": True, "native_retirement_proven_by_this_record": False}
        after_summary = {"schema_version": "fixed-provided-package-after-ui-v1", "original_packaged_tree_framed_sha256": original["framed_sha256"], "actual_after_packaged_tree_framed_sha256": after["framed_sha256"],
                         "actual_after_tree_file_sha256": after_hash, "added_empty_directories": list(S.EMPTY_GPU_DIRS), "all_packaged_files_unchanged": True, "all_original_packaged_directories_preserved": True,
                         "packaged_worker_framed_sha256": receipt["packaged_worker_framed_sha256"], "existing_teardown_passed": True, "source_identity_unchanged": True}
        self.put(phase / "packaged-tree-before-ui.json", before_summary)
        self.put(phase / "packaged-tree-after-ui.json", after_summary)
        setup = {"schema_version": "fixed-provided-dataset-single-host-setup-v1", "project": "thin-chrome", "phase": "ui-thin", "source_revision": REV, "package_receipt_sha256": package_hash, "qualification_run_id": self.qid,
                 "actual_before_tree_file_sha256": before_hash, "actual_provided_launch_plan": True, "runtime_forwarding_verified": True, "root_node_options_restored": True, "thin_host_started": True, "desktop_identity_prepared": False,
                 "redundant_package_invoked": False, "model_generation": False, "ocr_executed": False, "old_space_is_total_memory_guarantee": False, "scenario": "dataset-profile", "child_node_old_space_bytes": 256 * S.MIB}
        self.put(phase / "setup-receipt.json", setup)
        evidence = coordinator.candidate / "artifacts/qualification/visual-composer/runs" / self.qid / "evidence.json"
        report = {"schemaVersion": 1, "runId": self.qid, "sourceRevision": REV, "status": "passed", "checks": [{"target": "thin-chrome", "status": "passed", "id": "thin file / " + title, "durationMs": 10} for title in S.TITLES["thin"]]}
        self.put(evidence, report)
        # Report and census validators have separate complete filesystem tests.
        # Here the real package/phase pipeline is the test target.
        with patch.object(S, "require_reports", return_value={}), patch.object(S, "require_accessibility", return_value={}), patch.object(S, "verify_caches", return_value={}):
            self.assertEqual(coordinator.ui("ui-thin", receipt, original, (original, None)), (after, after_hash, self.qid))
            with self.assertRaisesRegex(S.Refused, "phase-predecessor-tree-drift"):
                coordinator.ui("ui-thin", receipt, original, (after, after_hash))
            for field in ("target", "status", "id"):
                changed = copy.deepcopy(report); changed["checks"][1][field] = "unexpected"; self.put(evidence, changed)
                with self.subTest(field=field), self.assertRaises(S.Refused): coordinator.ui("ui-thin", receipt, original, (original, None))
            self.put(evidence, report)
            after_summary["existing_teardown_passed"] = False; self.put(phase / "packaged-tree-after-ui.json", after_summary)
            with self.assertRaises(S.Refused): coordinator.ui("ui-thin", receipt, original, (original, None))

    def test_all_eight_surfaces_in_standard_and_native_media_are_required_per_host(self):
        files = {}
        frame = {"dpr": 4, "cssZoom": "1", "visualScale": 1, "outerWidth": 1440, "innerWidth": 360, "layoutWidth": 360, "overflow": 0, "controls": 3, "inaccessible": 0}
        facts = {"violations": [], "incomplete": [], "contrastPassedNodes": 1, "retries": {"attempted": 0, "passed": 0}}
        motion = {"elements": 10, "maximumTransitionMilliseconds": 0, "maximumAnimationMilliseconds": 0}
        for host in ("thin", "desktop"):
            for native, title in zip((False, True), S.TITLES[host]):
                key = S.sha(title.encode())
                branch = "native-critical-accessibility" if native else "critical-accessibility"
                for surface in S.SURFACES:
                    row = {"schemaVersion": "native-critical-surface-accessibility-v1" if native else "critical-surface-accessibility-v1", "contextSchemaVersion": "critical-accessibility-context-v1", "runId": self.qid,
                           "sourceRevision": REV, "host": S.PROJECTS[host], "testKey": key, "surface": surface, "status": "passed", "profile": "synthetic-profile", "profileSha256": "a" * 64,
                           "scope": "native-ui-observation-only" if native else "ui-accessibility-observation-only"}
                    if native:
                        row.update(initialFrame=frame, audits=[{"schemaVersion": "native-technical-accessibility-audit-v1", "media": media, "frame": frame, **facts, "status": "passed", "failures": []} for media in ("normal", "forced-colors")])
                        row.update({"native-normal-motion": motion, "native-forced-colors-motion": motion})
                    else:
                        row.update(browser={"deviceScaleFactor": 1}, audits=[{"schemaVersion": "technical-accessibility-audit-v1", "width": width, **facts, "status": "passed", "failures": []} for width in (1440, 320)],
                                   forcedColorsAudits=[{"schemaVersion": "technical-accessibility-audit-v1", "width": width, **facts} for width in (1440, 320)])
                        for width in (1440, 320):
                            row["motion-" + str(width)] = motion
                            for prefix in ("control-access-", "forced-colors-control-access-"):
                                row[prefix + str(width)] = {"width": width, "controls": 3, "inaccessible": 0, "status": "passed"}
                    files[self.folder / branch / S.PROJECTS[host] / key / surface / "evidence.json"] = json.dumps(row).encode()
        # These are raw current-schema report fixtures, not browser observations.
        def read(file, maximum, *_):
            raw = files[file]
            self.assertLessEqual(len(raw), maximum)
            return raw
        with patch.object(S, "read_bytes", read):
            for host in ("thin", "desktop"):
                self.assertEqual(len(S.require_accessibility(self.folder, host, REV, self.qid)), 16)
            target = next(file for file in files if "native-critical" in str(file))
            original = files[target]
            row = json.loads(original); row["audits"][1]["media"] = "normal"; files[target] = json.dumps(row).encode()
            with self.assertRaisesRegex(S.Refused, "native-accessibility-media"): S.require_accessibility(self.folder, "thin", REV, self.qid)
            files[target] = original
            row = json.loads(original); row["audits"][0]["frame"]["overflow"] = 2; files[target] = json.dumps(row).encode()
            with self.assertRaises(S.Refused): S.require_accessibility(self.folder, "thin", REV, self.qid)
            del files[target]
            with self.assertRaises(KeyError): S.require_accessibility(self.folder, "thin", REV, self.qid)

    @unittest.skipUnless(os.name == "nt", "Windows extended-path filesystem compatibility only")
    def test_long_windows_paths_round_trip_without_changing_record_identity_or_guards(self):
        owned = self.root / "long-path-fixture"
        folder = owned / ("a" * 80) / ("b" * 80)
        file = folder / "evidence.json"
        self.assertGreater(len(str(file)), 260)
        extended = lambda path: Path("\\\\?\\" + str(path))
        extended(folder).mkdir(parents=True)
        try:
            raw = b'{"synthetic":true}\n'
            extended(file).write_bytes(raw)
            self.assertEqual(S.canonical(file), file)
            self.assertEqual(S.read_json(file, 128, S.sha(raw)), {"synthetic": True})
            new = folder / "fresh.json"
            digest = S.write_fresh(new, {"fresh": True})
            self.assertEqual(S.read_json(new, 128, digest), {"fresh": True})
            self.assertEqual(S.names(folder, 4), ["evidence.json", "fresh.json"])
            inv = S.inventory(folder)
            self.assertEqual([row["path"] for row in inv["files"]], ["evidence.json", "fresh.json"])
            self.assertEqual(S.read_bytes(file, 128, collect=False), S.sha(raw))
            for value in (extended(file), Path(r"\\localhost\C$\unapproved.json"), Path("relative.json")):
                with self.subTest(value=value), self.assertRaises(S.Refused): S.io_path(value)
            with self.assertRaises(S.Refused): S.write_fresh(new, {"replace": True})
            # The same ordinary/single-link checks govern long names.
            link = folder / "linked.json"
            os.link(extended(file), extended(link))
            with self.assertRaisesRegex(S.Refused, "ordinary-single-link-file-required"): S.read_json(file, 128)
        finally:
            # Only this exact newly created synthetic subtree is removed.
            self.assertEqual(owned.parent, self.root)
            self.assertTrue(owned.is_relative_to(self.root))
            shutil.rmtree(extended(owned))


if __name__ == "__main__":
    unittest.main()
