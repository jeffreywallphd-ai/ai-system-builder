"""Closed test-launch validation and bounded queue controls; no runtime/model."""
import unittest
from concurrent.futures import Future

from modules.adapters.runtime.python.worker.tests.model_source_identity_fixture import (
    ControlledSubmissions, host_configuration,
)


class ControlledSourceFixtureTests(unittest.TestCase):
    def environment(self):
        return {"AISB_MODEL_SOURCE_FIXTURE_HOST": "owned-runtime-v1",
                "PYTHON_RUNTIME_HOST": "127.0.0.1", "PYTHON_RUNTIME_PORT": "43111",
                "PYTHON_RUNTIME_AUTH_TOKEN": "synthetic-private-test-token-" + "x" * 16,
                "PYTHON_RUNTIME_STARTUP_PROOF": "a" * 64}

    def test_default_stdin_fixture_stays_separate_from_host_mode(self):
        self.assertIsNone(host_configuration({}))
        self.assertIsNone(host_configuration({"PYTHON_RUNTIME_HOST": "0.0.0.0"}))
        self.assertEqual(host_configuration(self.environment()), ("127.0.0.1", 43111))

    def test_partial_wrong_or_remote_host_configuration_cannot_fall_back(self):
        for key, value in [("AISB_MODEL_SOURCE_FIXTURE_HOST", "unknown"),
                           ("PYTHON_RUNTIME_HOST", "0.0.0.0"),
                           ("PYTHON_RUNTIME_PORT", "80"), ("PYTHON_RUNTIME_PORT", "65536"),
                           ("PYTHON_RUNTIME_PORT", "43111\n"),
                           ("PYTHON_RUNTIME_AUTH_TOKEN", "short"),
                           ("PYTHON_RUNTIME_STARTUP_PROOF", "not-a-nonce")]:
            with self.subTest(key=key, value=value):
                with self.assertRaises(ValueError):
                    host_configuration({**self.environment(), key: value})

    def test_original_callbacks_and_futures_survive_the_single_bounded_queue_hold(self):
        calls, observations = [], []
        class Executor:
            def submit(self, callback, *args, **kwargs):
                result = Future()
                calls.append((callback, args, kwargs, result))
                return result
        executor = Executor()
        submit = ControlledSubmissions(executor, observations.append)
        callbacks = [lambda: 1, lambda: 2, lambda: 3]
        first = submit(callbacks[0], "first", flag=True)
        second = submit(callbacks[1])
        third = submit(callbacks[2])
        self.assertEqual(observations, [1, 2, 3])
        self.assertEqual([row[0] for row in (calls[0], calls[2], calls[3])], callbacks)
        self.assertEqual(calls[0][1:3], (("first",), {"flag": True}))
        self.assertEqual(calls[1][1:3], ((5,), {}))
        self.assertIs(first, calls[0][3])
        self.assertIs(second, calls[2][3])
        self.assertIs(third, calls[3][3])


if __name__ == "__main__":
    unittest.main()
