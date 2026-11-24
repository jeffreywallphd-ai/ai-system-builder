"""Canonical storage compatibility must preserve authority and reader failures."""
from pathlib import Path
import copy
import json
import shutil
import re
import subprocess
import sys
import tempfile
import unittest
import uuid
from unittest import mock

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "dev-tools/helpers"))
sys.path.insert(0, str(ROOT / "skills/manage-implementation-roadmaps/tests"))
import test_roadmap as fixtures
import test_control_plane_supporting_work as support_fixtures
from control_plane import candidate, catalog, projection, user_presentation
from control_plane.contracts import ControlError
from control_plane.roadmap_state import CODEC, decode_roadmap_bytes, read_roadmap_state
from control_plane.work import Work

STATE = ".implementation-roadmaps/portable-roadmap/state.json"
NODE_TEST = "dev-tools/scripts/qualification/tests/roadmap-record-storage.unit.test.mjs"


class RoadmapStorageConsumerTests(unittest.TestCase):
    def setUp(self):
        fixture = fixtures.RoadmapEngineTest(); fixture.setUp()
        self.addCleanup(fixture.tearDown)
        fixture.define_and_approve([fixtures.increment_definition("increment-1", 1)])
        fixture.apply({"type": "increment-started", "incrementId": "increment-1"})
        self.root, self.state = fixture.repo, fixture.state
        for name in (CODEC, "skills/manage-implementation-roadmaps/scripts/roadmap.py"):
            path = self.root / name; path.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(ROOT / name, path)
        path = self.root / STATE; path.parent.mkdir(parents=True, exist_ok=True)
        self.path = path
        self.raw = fixtures.roadmap.storage_codec().encode_record(self.state).encode("ascii")

    def test_legacy_encoded_authority_projection_and_user_source_are_equivalent(self):
        observations = []
        for raw in (json.dumps(self.state).encode(), self.raw):
            self.path.write_bytes(raw)
            self.assertEqual(read_roadmap_state(self.root, STATE), self.state)
            binding = {"state_path": STATE, "increment_id": "increment-1"}
            authority = candidate.roadmap_authority(self.root, binding)
            view = projection.review_content(self.root)
            self.assertEqual(len(view["roadmaps"]), 1)
            self.assertNotIn("projection.roadmap-unavailable", str(view["diagnostics"]))
            sources = user_presentation._sources(self.root, [{"id": "portable-roadmap"}])
            observations.append((authority, view["roadmaps"], sources))
        self.assertEqual(observations[0], observations[1])
        self.assertEqual(observations[0][0], self.state["roadmapApproval"]["fingerprint"])

    def test_both_completion_phase_guards_use_decoded_values(self):
        work = Work.__new__(Work); work.root = self.root
        state = copy.deepcopy(self.state)
        state["increments"][0]["status"] = "implemented-pending-qualification"
        self.path.write_text(fixtures.roadmap.storage_codec().encode_record(state), encoding="ascii")
        partial = {"roadmap": {"state_path": STATE, "increment_id": "increment-1"},
                   "acceptance": [{"id": "criterion-1", "check_ids": ["documentation"]}]}
        with self.assertRaises(ControlError) as error:
            work.check_completion_phase(partial)
        self.assertEqual(error.exception.code, "verification.qualification-coverage")
        partial["acceptance"].append({"id": "security-impact-reviewed", "check_ids": ["documentation"]})
        work.check_completion_phase(partial)
        overall = {"roadmap": {"state_path": STATE, "increment_id": "overall"},
                   "acceptance": [{"id": "all", "check_ids": ["documentation"]}]}
        with self.assertRaises(ControlError) as error:
            work.check_completion_phase(overall)
        self.assertEqual(error.exception.code, "verification.completion-suite")
        overall["acceptance"][0]["check_ids"] = ["completion-standardande2e"]
        work.check_completion_phase(overall)

    def test_corruption_never_supplies_an_authority_or_public_roadmap(self):
        value = json.loads(self.raw); value["contentSha256"] = "0" * 64
        raw = json.dumps(value, sort_keys=True, separators=(",", ":")).encode()
        self.path.write_bytes(raw)
        with self.assertRaises(ControlError):
            candidate.roadmap_authority(self.root, {"state_path": STATE, "increment_id": "increment-1"})
        self.assertEqual(projection.review_content(self.root)["roadmaps"], [])
        self.assertEqual(self.path.read_bytes(), raw)

    def test_missing_unsafe_or_malformed_codec_denies_encoded_but_preserves_plain(self):
        codec = self.root / CODEC
        for payload in (None, b"this is invalid python !", b"value = 1\n"):
            if codec.exists(): codec.unlink()
            if payload is not None: codec.write_bytes(payload)
            self.assertEqual(decode_roadmap_bytes(self.root, b'{"plain":true}'), {"plain": True})
            with self.assertRaises(ControlError): decode_roadmap_bytes(self.root, self.raw)
        for name in ("other.json", ".implementation-roadmaps/../state.json"):
            with self.assertRaises(ControlError): read_roadmap_state(self.root, name)
        for raw in (b'{"a":1,"a":2}', b'{"a":NaN}', b'{}' + b' ' * 1048576):
            with self.assertRaises(ControlError): decode_roadmap_bytes(self.root, raw)

    def test_native_reparse_codec_is_rejected_without_import(self):
        info = (self.root / CODEC).lstat()
        unsafe = mock.Mock(st_mode=info.st_mode, st_size=info.st_size, st_file_attributes=0x400)
        with mock.patch("control_plane.roadmap_state.Path.lstat", return_value=unsafe), \
                mock.patch("control_plane.roadmap_state.importlib.util.spec_from_file_location") as load:
            with self.assertRaises(ControlError): decode_roadmap_bytes(self.root, self.raw)
        load.assert_not_called()

    def test_encoded_source_and_target_preserve_consolidation_without_a_pass(self):
        fixture = support_fixtures.ConsolidationTests(); fixture.setUp()
        self.addCleanup(fixture.doCleanups)
        codec_path = fixture.root / CODEC
        codec_path.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(ROOT / CODEC, codec_path)
        before = projection.project(fixture.root)
        for state in (fixture.source, fixture.target):
            path = fixture.root / f'.implementation-roadmaps/{state["slug"]}/state.json'
            path.write_text(fixtures.roadmap.storage_codec().encode_record(state), encoding="ascii")
        after = projection.project(fixture.root)
        self.assertEqual(before, after)
        self.assertEqual([r["id"] for r in after["roadmaps"]], ["owner"])
        self.assertEqual(after["roadmaps"][0]["merged_history"][0]["increments"][0]["criteria"][0]["outcome"], "missing")


class RoadmapStorageRoutingTests(unittest.TestCase):
    def test_storage_controller_scope_runs_actual_related_suites_and_binds_argv(self):
        paths = list(catalog.ROADMAP_STORAGE_SCOPE)
        plan = catalog.plan(ROOT, paths, ["control-plane"], "a" * 64)
        check = next(c for c in plan["selected"] if c["id"] == "control-plane")
        self.assertEqual(check["argv"], [sys.executable, "-B", "dev-tools/helpers/tests/test_control_plane_roadmap_storage.py", "--related"])
        self.assertEqual(len(catalog.ROADMAP_STORAGE_CONTROLLER_TESTS), 15)
        self.assertIn("dev-tools/helpers/tests/test_control_plane_support.py", catalog.ROADMAP_STORAGE_CONTROLLER_TESTS)
        self.assertIn("dev-tools/helpers/tests/test_control_plane_roadmap_storage.py", catalog.ROADMAP_STORAGE_CONTROLLER_TESTS)
        self.assertNotIn("control-plane", plan["deferred"])
        other = catalog.plan(ROOT, paths + ["dev-tools/helpers/control_plane/execution.py"], ["control-plane"], "a" * 64)
        self.assertNotEqual(plan["plan_digest"], other["plan_digest"])
        self.assertIn("discover", next(c for c in other["selected"] if c["id"] == "control-plane")["argv"])

    def test_storage_controller_missing_nonregular_empty_and_unrelated_scopes_retain_full_command(self):
        for paths in ([], ["dev-tools/helpers/control_plane/execution.py"],
                      ["dev-tools/helpers/control_plane/catalog.py"],
                      ["dev-tools/helpers/control_plane/work.py"],
                      list(catalog.ROADMAP_STORAGE_SCOPE)[:-1]):
            plan = catalog.plan(ROOT, paths, ["control-plane"], "a" * 64)
            self.assertIn("discover", next(c for c in plan["selected"] if c["id"] == "control-plane")["argv"])
        temporary_root = ROOT / ".local-codex/t"
        temporary_root.mkdir(parents=True, exist_ok=True)
        with tempfile.TemporaryDirectory(dir=temporary_root) as directory:
            root = Path(directory)
            for name in set(catalog.ROADMAP_STORAGE_SCOPE + catalog.ROADMAP_STORAGE_CONTROLLER_TESTS):
                path = root/name; path.parent.mkdir(parents=True, exist_ok=True)
                shutil.copyfile(ROOT/name, path)
            fixture = root / "skills/manage-implementation-roadmaps/tests/fixtures/roadmap-storage-vectors.json"
            fixture.unlink()
            for mode in ("missing", "directory"):
                if mode == "directory": fixture.mkdir()
                plan = catalog.plan(root, ["dev-tools/helpers/control_plane/candidate.py"], ["control-plane"], "a" * 64)
                self.assertIn("discover", next(c for c in plan["selected"] if c["id"] == "control-plane")["argv"])

    def test_node_check_is_exact_and_runs_real_cross_language_cases(self):
        source = "dev-tools/scripts/qualification/roadmap-record-storage.mjs"
        plan = catalog.plan(ROOT, [source], ["documentation"], "a" * 64)
        check = next(c for c in plan["selected"] if c["id"] == "roadmap-storage-node")
        self.assertEqual(check["argv"], ["node", "--test", "--test-reporter=tap", "--", NODE_TEST])
        result = subprocess.run(check["argv"], cwd=ROOT, capture_output=True, timeout=30)
        self.assertEqual(result.returncode, 0, result.stderr[-2000:])
        self.assertIn(b"# pass 12", result.stdout)
        self.assertIn(b"# fail 0", result.stdout)
        self.assertIn(b"# skipped 0", result.stdout)

    def test_missing_files_and_unrelated_paths_keep_generic_coverage(self):
        source = "dev-tools/scripts/qualification/roadmap-record-storage.mjs"
        for paths, required in (([source, "modules/example/unrelated.ts"], ["documentation"]),
                                ([source], ["focused-tests"])):
            self.assertIn("focused-tests", {c["id"] for c in catalog.plan(ROOT, paths, required, "a" * 64)["selected"]})
        with tempfile.TemporaryDirectory() as directory:
            ids = {c["id"] for c in catalog.plan(Path(directory), [source], ["documentation"], "a" * 64)["selected"]}
            self.assertIn("focused-tests", ids)
            self.assertNotIn("roadmap-storage-node", ids)


if __name__ == "__main__":
    if sys.argv[1:] == ["--related"]:
        # Fixed module names, with the same sibling import path as discovery.
        # This runs the existing suites, not mocks or a successful empty loader.
        names = [Path(name).stem for name in catalog.ROADMAP_STORAGE_CONTROLLER_TESTS]
        suite = unittest.defaultTestLoader.loadTestsFromNames(names)
        if suite.countTestCases() < len(names):
            raise RuntimeError("The related controller suites were not collected.")
        result = unittest.TextTestRunner().run(suite)
        # Actual failures get bounded source locations, never exception bodies,
        # request data or arbitrary command output. Keep diagnostics out of source.
        diagnostics = []
        for case, trace in (result.failures + result.errors)[:128]:
            locations = []
            for name, line in re.findall(r'File "([^"]+)", line ([0-9]+)', trace):
                try: path = Path(name).resolve().relative_to(ROOT).as_posix()
                except ValueError: continue
                if path in catalog.ROADMAP_STORAGE_CONTROLLER_TESTS:
                    locations.append({"path": path, "line": int(line)})
            diagnostics.append({"test": case.id()[:240], "locations": locations[-8:]})
        folder = ROOT / ".local-codex/roadmap-storage-diagnostics"
        folder.mkdir(parents=True, exist_ok=True)
        target = folder / (uuid.uuid4().hex + ".json")
        with target.open("x", encoding="utf8") as stream:
            json.dump({"tests_run": result.testsRun, "failures": diagnostics}, stream)
        print(json.dumps({"diagnostics": target.relative_to(ROOT).as_posix(), "tests_run": result.testsRun,
                          "failed": len(result.failures), "errors": len(result.errors)}))
        raise SystemExit(0 if result.wasSuccessful() else 1)
    unittest.main()
