"""Exercise actual publication/read/recovery at the same JSON byte boundary."""
import argparse
import copy
import json
from pathlib import Path
import tempfile
import unittest
from unittest import mock

from test_roadmap import roadmap, security_impact
import test_work_chunk_refinement as refinement


class PublicationSizeTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="roadmap-size-")
        self.addCleanup(self.temporary.cleanup)
        self.repo = Path(self.temporary.name).resolve()
        self.state = roadmap.initial_state(self.repo, {
            "name": "Publication boundary", "slug": "publication-boundary", "objective": "Preserve every approved record."
        })
        roadmap.write_project_files(self.repo, self.state)
        self.event = {"type": "discovery-recorded", "summary": "A bounded publication fixture.", "sources": [],
                      "constraints": ["a" * 3500, "b" * 3500, "c" * 3500],
                      "securityImpact": security_impact(), "decisionRequired": False}
        self.event_file = self.repo / "event.json"
        self.event_file.write_text(json.dumps(self.event), encoding="utf8")
        self.clock = mock.patch.object(roadmap, "now_utc", return_value="2026-11-23T00:00:00Z")
        self.clock.start(); self.addCleanup(self.clock.stop)
        self.updated = roadmap.apply_event(copy.deepcopy(self.state), copy.deepcopy(self.event))
        roadmap.validate_state_shape(self.repo, self.updated)
        self.args = argparse.Namespace(repo=str(self.repo), state=self.state["paths"]["state"],
                                       event_file=str(self.event_file), dry_run=False)

    def snapshot(self):
        return {name: (self.repo / name).read_bytes() for name in self.state["paths"].values()}

    def journal(self):
        with roadmap.publication_lock(self.repo, self.args.state) as path:
            return path

    def fits_compact_only(self):
        envelope = {"before": roadmap.fingerprint(self.state), "successor": self.updated,
                    "previousReport": self.state["paths"]["report"]}
        budget = len(roadmap.canonical_json(envelope).encode("utf8")) + 16
        pretty = (json.dumps(self.updated, indent=2, ensure_ascii=True, sort_keys=True) + "\n").encode("utf8")
        self.assertGreater(len(pretty), budget)
        self.assertLess(len((self.repo / self.args.state).read_bytes()), budget)
        self.assertLess(self.event_file.stat().st_size, budget)
        return budget

    def test_cli_compacts_large_state_without_losing_history(self):
        self.assertEqual(roadmap.MAX_JSON_BYTES, 1048576)
        with mock.patch.object(roadmap, "MAX_JSON_BYTES", self.fits_compact_only()):
            result = roadmap.command_apply(self.args)
            _, actual = roadmap.load_state(self.repo, self.args.state)
            self.assertEqual(actual, self.updated)
            self.assertEqual(roadmap.fingerprint(actual), roadmap.fingerprint(self.updated))
            roadmap.ensure_documents_match(self.repo, actual)
            self.assertFalse(self.journal().exists())
            self.assertFalse(result["dryRun"])
            raw = (self.repo / self.args.state).read_bytes()
            self.assertLessEqual(len(raw.replace(b"\n", b"\r\n")), roadmap.MAX_JSON_BYTES)

    def test_unpublishable_state_and_envelope_refuse_before_managed_or_journal_writes(self):
        compact = len((roadmap.canonical_json(self.updated) + "\n").encode("utf8"))
        for cap in (compact - 1, compact + 2):
            for dry_run in (True, False):
                with self.subTest(cap=cap, dry_run=dry_run):
                    before = self.snapshot(); args = copy.copy(self.args); args.dry_run = dry_run
                    with mock.patch.object(roadmap, "MAX_JSON_BYTES", cap), self.assertRaises(roadmap.RoadmapError):
                        roadmap.command_apply(args)
                    self.assertEqual(self.snapshot(), before)
                    self.assertFalse(self.journal().exists())

    def test_small_state_keeps_pretty_json_and_crlf_boundary_uses_complete_compact_json(self):
        self.assertEqual((self.repo / self.args.state).read_text(encoding="utf8"),
                         json.dumps(self.state, indent=2, ensure_ascii=True, sort_keys=True) + "\n")
        pretty = json.dumps(self.updated, indent=2, ensure_ascii=True, sort_keys=True) + "\n"
        cap = len(pretty.encode("utf8"))
        self.assertGreater(len(pretty.replace("\n", "\r\n").encode("utf8")), cap)
        with mock.patch.object(roadmap, "MAX_JSON_BYTES", cap):
            roadmap.command_apply(self.args)
            raw = (self.repo / self.args.state).read_bytes()
            self.assertEqual(raw, (roadmap.canonical_json(self.updated) + "\n").encode("utf8"))
            self.assertLessEqual(len(raw.replace(b"\n", b"\r\n")), cap)
            self.assertEqual(roadmap.load_state(self.repo, self.args.state)[1], self.updated)

    def test_init_refuses_an_unreadable_recovery_envelope_before_creating_managed_files(self):
        root = self.repo / "fresh"; root.mkdir()
        config = {"name": "Fresh", "slug": "fresh", "objective": "Keep initialization recoverable."}
        config_path = root / "config.json"; config_path.write_text(json.dumps(config), encoding="utf8")
        state = roadmap.initial_state(root, config)
        cap = len(roadmap.canonical_json(state).encode("utf8")) + 2
        with mock.patch.object(roadmap, "MAX_JSON_BYTES", cap), self.assertRaises(roadmap.RoadmapError):
            roadmap.command_init(argparse.Namespace(repo=str(root), config=str(config_path)))
        self.assertTrue(all(not (root / name).exists() for name in state["paths"].values()))
        with roadmap.publication_lock(root, state["paths"]["state"]) as journal:
            self.assertFalse(journal.exists())

    def test_compact_publication_recovers_the_original_journal_after_interruption(self):
        original = roadmap.atomic_write
        def interrupted(path, content):
            if path == self.repo / self.args.state: raise OSError("synthetic interrupted state publication")
            original(path, content)
        with mock.patch.object(roadmap, "MAX_JSON_BYTES", self.fits_compact_only()):
            with mock.patch.object(roadmap, "atomic_write", side_effect=interrupted), self.assertRaises(OSError):
                roadmap.command_apply(self.args)
            journal = self.journal()
            self.assertTrue(journal.exists())
            self.assertLessEqual(journal.stat().st_size, roadmap.MAX_JSON_BYTES)
            roadmap.read_json(journal, "publication journal")
            roadmap.command_render(self.args)
            _, actual = roadmap.load_state(self.repo, self.args.state)
            self.assertEqual(actual, self.updated)
            roadmap.ensure_documents_match(self.repo, actual)
            self.assertFalse(journal.exists())

    def test_render_dry_run_and_apply_share_the_same_state_admission(self):
        # A legal Unicode state may fit its input encoding while ensure_ascii
        # serialization needs more bytes. Neither render mode may publish it.
        state = copy.deepcopy(self.updated)
        state["discovery"]["constraints"] = ["\u4e2d" * 1000] * 3
        roadmap.validate_state_shape(self.repo, state)
        source = json.dumps(state, ensure_ascii=False, separators=(",", ":")) + "\n"
        (self.repo / self.args.state).write_text(source, encoding="utf8")
        for name, content in roadmap.document_contents(state).items(): roadmap.atomic_write(self.repo / name, content)
        cap = len(source.encode("utf8")) + 16
        for dry_run in (True, False):
            with self.subTest(dry_run=dry_run):
                before = self.snapshot(); args = copy.copy(self.args); args.dry_run = dry_run
                with mock.patch.object(roadmap, "MAX_JSON_BYTES", cap), self.assertRaises(roadmap.RoadmapError):
                    roadmap.command_render(args)
                self.assertEqual(self.snapshot(), before)

    def test_refused_recovery_keeps_the_existing_journal_and_all_managed_bytes(self):
        state = copy.deepcopy(self.updated); state["discovery"]["constraints"] = ["\u4e2d" * 1000] * 3
        journal = self.journal(); envelope = {"before": roadmap.fingerprint(self.state), "successor": state,
                                           "previousReport": self.state["paths"]["report"]}
        raw = json.dumps(envelope, ensure_ascii=False, separators=(",", ":"))
        journal.write_text(raw, encoding="utf8"); before = self.snapshot(); old_journal = journal.read_bytes()
        with mock.patch.object(roadmap, "MAX_JSON_BYTES", len(old_journal) + 16), self.assertRaises(roadmap.RoadmapError):
            roadmap.command_render(self.args)
        self.assertEqual(journal.read_bytes(), old_journal)
        self.assertEqual(self.snapshot(), before)


class EncodedPublicationTests(unittest.TestCase):
    def setUp(self):
        fixture = refinement.WorkChunkRefinementTests()
        fixture.setUp()
        self.addCleanup(fixture.doCleanups)
        self.engine = fixture.engine
        self.repo = self.engine.repo
        self.state = copy.deepcopy(self.engine.state)
        # Repeated full plans, not discarded history, are the real growth case.
        plan = copy.deepcopy(self.state["increments"][0]["plan"])
        for chunk in plan["chunks"]:
            chunk["outcome"] = "A measured outcome. " * 150
        plan = {k: v for k, v in plan.items() if k not in {"fingerprint", "recordedAt"}}
        event = fixture.event()
        event["plan"] = plan
        self.state = roadmap.apply_event(self.state, event)
        roadmap.write_project_files(self.repo, self.state)
        self.event = fixture.event()
        self.event["expectedPlanDigest"] = roadmap.fingerprint(self.state["increments"][0]["plan"])
        self.event["plan"] = copy.deepcopy(plan)
        self.event["plan"]["chunks"].append({**copy.deepcopy(plan["chunks"][-1]), "id": "additional-outcome"})
        self.event_file = self.repo / "refinement.json"
        self.event_file.write_text(json.dumps(self.event), encoding="utf8")
        clock = mock.patch.object(roadmap, "now_utc", return_value="2026-11-24T00:00:00Z")
        clock.start(); self.addCleanup(clock.stop)
        self.updated = roadmap.apply_event(copy.deepcopy(self.state), copy.deepcopy(self.event))
        roadmap.validate_state_shape(self.repo, self.updated)
        envelope = {"before": roadmap.fingerprint(self.state), "successor": self.updated,
                    "previousReport": self.state["paths"]["report"]}
        codec = roadmap.storage_codec()
        self.cap = max(len((self.repo / self.state["paths"]["state"]).read_bytes()),
                       self.event_file.stat().st_size,
                       len(codec.encode_record(envelope).encode("ascii"))) + 32
        self.assertLess(self.cap, len(roadmap.canonical_json(self.updated)))
        self.args = argparse.Namespace(repo=str(self.repo), state=self.state["paths"]["state"],
                                       event_file=str(self.event_file), dry_run=False)

    def snapshot(self):
        return {name: (self.repo / name).read_bytes() for name in self.state["paths"].values()}

    def journal(self):
        with roadmap.publication_lock(self.repo, self.args.state) as path:
            return path

    def interrupt(self):
        original = roadmap.atomic_write
        def write(path, content):
            if path == self.repo / self.args.state:
                raise OSError("synthetic interrupted encoded publication")
            original(path, content)
        with mock.patch.object(roadmap, "atomic_write", side_effect=write), self.assertRaises(OSError):
            roadmap.command_apply(self.args)
        return self.journal()

    def test_actual_refinement_dry_run_and_encoded_publication_preserve_authority(self):
        before = self.snapshot()
        with mock.patch.object(roadmap, "MAX_JSON_BYTES", self.cap):
            dry = copy.copy(self.args); dry.dry_run = True
            roadmap.command_apply(dry)
            self.assertEqual(before, self.snapshot())
            self.assertFalse(self.journal().exists())
            roadmap.command_apply(self.args)
            raw = (self.repo / self.args.state).read_bytes()
            self.assertEqual(json.loads(raw)["storageVersion"], "roadmap-record-tree-v1")
            actual = roadmap.load_state(self.repo, self.args.state)[1]
            self.assertEqual(actual, self.updated)
            self.assertEqual(actual["roadmapApproval"], self.state["roadmapApproval"])
            self.assertTrue(roadmap.approval_is_current(actual))
            self.assertEqual(roadmap.fingerprint(actual), roadmap.fingerprint(self.updated))
            roadmap.ensure_documents_match(self.repo, actual)

    def test_whole_encoded_journal_recovers_exact_successor(self):
        with mock.patch.object(roadmap, "MAX_JSON_BYTES", self.cap):
            journal = self.interrupt()
            self.assertEqual(json.loads(journal.read_bytes())["storageVersion"], "roadmap-record-tree-v1")
            self.assertLessEqual(journal.stat().st_size, self.cap)
            roadmap.command_render(self.args)
            self.assertEqual(roadmap.load_state(self.repo, self.args.state)[1], self.updated)
            roadmap.ensure_documents_match(self.repo, self.updated)
            self.assertFalse(journal.exists())

    def test_corrupt_encoded_recovery_retains_original_managed_and_journal_bytes(self):
        with mock.patch.object(roadmap, "MAX_JSON_BYTES", self.cap):
            journal = self.interrupt()
            value = json.loads(journal.read_bytes()); value["contentSha256"] = "0" * 64
            raw = (json.dumps(value, sort_keys=True, separators=(",", ":")) + "\n").encode()
            journal.write_bytes(raw); before = self.snapshot()
            with self.assertRaises(roadmap.RoadmapError):
                roadmap.command_render(self.args)
            self.assertEqual(journal.read_bytes(), raw)
            self.assertEqual(self.snapshot(), before)

    def test_encoded_recovery_does_not_overwrite_a_changed_predecessor(self):
        with mock.patch.object(roadmap, "MAX_JSON_BYTES", self.cap):
            journal = self.interrupt(); retained = journal.read_bytes()
            changed = copy.deepcopy(self.state); changed["name"] = "Externally changed predecessor"
            (self.repo / self.args.state).write_text(roadmap.state_publication_content(changed), encoding="ascii")
            before = self.snapshot()
            with self.assertRaises(roadmap.RoadmapError): roadmap.command_render(self.args)
            self.assertEqual(journal.read_bytes(), retained)
            self.assertEqual(self.snapshot(), before)

    def test_oversize_encoded_journal_is_retained_without_partial_recovery(self):
        with mock.patch.object(roadmap, "MAX_JSON_BYTES", self.cap):
            journal = self.interrupt(); retained = journal.read_bytes(); before = self.snapshot()
            with mock.patch.object(roadmap, "MAX_JSON_BYTES", len(retained) - 1), self.assertRaises(roadmap.RoadmapError):
                roadmap.command_render(self.args)
            self.assertEqual(journal.read_bytes(), retained)
            self.assertEqual(self.snapshot(), before)

    def test_missing_codec_keeps_plain_reads_but_never_adopts_encoded_record(self):
        plain = self.repo / "plain.json"; plain.write_text('{"value":1}', encoding="utf8")
        encoded = self.repo / "encoded.json"
        raw = roadmap.storage_codec().encode_record({"value": 1}).encode("ascii")
        encoded.write_bytes(raw)
        with mock.patch.object(roadmap, "storage_codec", side_effect=roadmap.RoadmapError("codec unavailable")):
            self.assertEqual(roadmap.read_json(plain, "plain", stored=True), {"value": 1})
            with self.assertRaises(roadmap.RoadmapError):
                roadmap.read_json(encoded, "encoded", stored=True)
            # Config and event inputs are never implicitly expanded.
            self.assertIn("storageVersion", roadmap.read_json(encoded, "event"))
        self.assertEqual(encoded.read_bytes(), raw)


if __name__ == "__main__": unittest.main()
