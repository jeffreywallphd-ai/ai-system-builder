"""Controlled public-DNS/TLS/sink faults. No actual provider, model or TLS qualification."""
from contextlib import ExitStack
from email.message import Message
from io import BytesIO
import os
from pathlib import Path
import socket
import ssl
from tempfile import TemporaryDirectory
from threading import Event, Lock, Thread
import time
import unittest
from unittest.mock import patch

from modules.adapters.runtime.python.worker.tasks import model_source_transport as transport
from modules.adapters.runtime.python.worker.tasks.model_download_manifest import capture_manifest
from modules.adapters.runtime.python.worker.tests.test_model_download_manifest import fixture_manifest, REVISION


class Response:
    def __init__(self, body=b"", status=200, headers=()):
        self.status, self.body, self.headers, self.closed = status, BytesIO(body), Message(), False
        for name, value in headers: self.headers[name] = value
    def read(self, size): return self.body.read(size)
    def close(self): self.closed = True


class Connection:
    def __init__(self, host, address, deadline, response):
        self.host, self.address, self.deadline, self.response = host, address, deadline, response
        self.sock = None
        self.requests = []
        self.closed, self.aborted = False, Event()
    def request(self, method, path, headers): self.requests.append((method, path, headers))
    def getresponse(self): return self.response
    def abort(self): self.aborted.set()
    def close(self): self.closed = True
    def refresh_timeout(self): pass


class ModelSourceTransportTests(unittest.TestCase):
    def setUp(self):
        self.stack = ExitStack(); self.addCleanup(self.stack.close)
        self.data = {"config.json": b'{"synthetic":true}', "tokenizer.json": b'{"version":1}', "model.safetensors": b"synthetic file; not weights"}
        self.manifest = capture_manifest(fixture_manifest(self.data), "fixture/model", REVISION)
        self.connections = []
        self.responses = []
        self.real_connection = transport._PinnedHttpsConnection
        self.real_lookup = transport._lookup_public
        def connect(host, address, deadline):
            self.assertTrue(self.responses)
            value = Connection(host, address, deadline, self.responses.pop(0)); self.connections.append(value); return value
        self.lookup = self.stack.enter_context(patch.object(transport, "_lookup_public", return_value=("8.8.8.8",)))
        self.stack.enter_context(patch.object(transport, "_PinnedHttpsConnection", side_effect=connect))
        self.stack.enter_context(patch.object(transport, "_FILE_SLOT", Lock()))
        self.stack.enter_context(patch.object(transport, "_RETAINED_CONNECTION", None))

    def session(self, **options):
        return transport.ModelSourceTransferSession(self.manifest, maximum_duration_seconds=options.pop("maximum_duration_seconds", 5), **options)

    def test_fixed_selected_url_writes_exact_real_bytes_without_ambient_credentials(self):
        self.responses = [Response(self.data["model.safetensors"])]
        with TemporaryDirectory(prefix="model-stream-sink-") as folder:
            target = Path(folder) / "owned-staging-file"
            with patch.dict(os.environ, {"HF_TOKEN": "synthetic-marker", "HTTPS_PROXY": "http://127.0.0.1:9"}):
                with target.open("xb") as output:
                    def write(chunk): output.write(chunk)
                    receipt = self.session().transfer_file("model.safetensors", write)
            self.assertEqual(target.read_bytes(), self.data["model.safetensors"])
        self.assertEqual(receipt.size_bytes, len(self.data["model.safetensors"]))
        connection = self.connections[0]
        self.assertEqual((connection.host, connection.address), ("huggingface.co", "8.8.8.8"))
        method, path, headers = connection.requests[0]
        self.assertEqual(method, "GET"); self.assertEqual(path, f"/fixture/model/resolve/{REVISION}/model.safetensors")
        self.assertEqual(set(headers), {"Host", "Accept", "Connection"})
        self.assertTrue(connection.closed); self.assertTrue(connection.response.closed)

    def test_default_redirect_cannot_grant_a_new_origin_and_explicit_delegate_is_exact(self):
        self.responses = [Response(status=302, headers=[("location", "https://cdn.example.net/model?synthetic=private-marker")])]
        with self.assertRaises(transport.ModelSourceTransferError) as error:
            self.session().transfer_file("config.json", lambda _: None)
        self.assertEqual(error.exception.reason, "destination_denied")
        self.assertNotIn("private-marker", str(error.exception)); self.assertEqual(len(self.connections), 1)
        self.responses = [Response(status=302, headers=[("location", "https://cdn.example.net/model")]), Response(self.data["config.json"])]
        result = self.session(allowed_origins=("https://huggingface.co", "https://cdn.example.net")).transfer_file("config.json", lambda _: None)
        self.assertEqual(result.size_bytes, len(self.data["config.json"]))
        self.assertEqual(self.connections[-1].requests[0][2]["Host"], "cdn.example.net")
        self.assertTrue(all(item.closed for item in self.connections))

    def test_unsafe_origins_headers_and_redirect_loops_never_reach_a_sink(self):
        for target in ["http://huggingface.co/model", "https://user:secret@huggingface.co/model", "https://huggingface.co:8443/model",
                       "https://huggingface.co/model#", "https://huggingface.co/model\r\nInjected:yes"]:
            self.responses = [Response(status=302, headers=[("location", target)])]
            with self.assertRaises(transport.ModelSourceTransferError): self.session().transfer_file("config.json", lambda _: self.fail("No sink"))
        self.responses = [Response(status=302, headers=[("location", f"/fixture/model/resolve/{REVISION}/config.json")])]
        with self.assertRaises(transport.ModelSourceTransferError): self.session().transfer_file("config.json", lambda _: self.fail("No sink"))
        for headers in [[("content-length", "1")], [("content-length", str(len(self.data['config.json']))), ("content-length", "1")],
                        [("content-encoding", "gzip")], [("transfer-encoding", "gzip")]]:
            self.responses = [Response(self.data["config.json"], headers=headers)]
            with self.assertRaises(transport.ModelSourceTransferError): self.session().transfer_file("config.json", lambda _: self.fail("No sink"))

    def test_oversize_short_or_wrong_digest_cannot_complete_or_retry_the_session(self):
        for body in [self.data["config.json"] + b"x", b"short", b"x" * len(self.data["config.json"])]:
            self.responses = [Response(body)]
            session = self.session(); written = []
            with self.assertRaises(transport.ModelSourceTransferError): session.transfer_file("config.json", lambda value: written.append(value))
            self.assertLessEqual(sum(map(len, written)), len(self.data["config.json"]))
            before = len(self.connections)
            with self.assertRaises(transport.ModelSourceTransferError): session.transfer_file("tokenizer.json", lambda _: None)
            self.assertEqual(len(self.connections), before)

    def test_selected_files_are_one_use_and_policy_checks_are_immediate_booleans(self):
        self.responses = [Response(self.data["config.json"])]
        session = self.session(); session.transfer_file("config.json", lambda _: None)
        with self.assertRaises(transport.ModelSourceTransferError): session.transfer_file("config.json", lambda _: None)
        with self.assertRaises(transport.ModelSourceTransferError): session.transfer_file("../config.json", lambda _: None)
        for current in [lambda: "true", lambda: 1, lambda: False]:
            before = len(self.connections)
            with self.assertRaises(transport.ModelSourceTransferError): self.session(is_current=current).transfer_file("config.json", lambda _: None)
            self.assertEqual(len(self.connections), before)
        current = True
        def retire(_chunk):
            nonlocal current
            current = False
        self.responses = [Response(self.data["config.json"])]
        with self.assertRaises(transport.ModelSourceTransferError): self.session(is_current=lambda: current).transfer_file("config.json", retire)

    def test_stalled_sink_keeps_global_custody_through_deadline_until_it_returns(self):
        entered, released = Event(), Event()
        self.responses = [Response(self.data["config.json"])]
        errors = []
        session = self.session(maximum_duration_seconds=1)
        def sink(_chunk): entered.set(); released.wait(3)
        def run():
            try: session.transfer_file("config.json", sink)
            except Exception as error: errors.append(error)
        owner = Thread(target=run); owner.start()
        try:
            self.assertTrue(entered.wait(1))
            self.assertTrue(self.connections[-1].aborted.wait(2))
            with self.assertRaises(transport.ModelSourceTransferError) as error: self.session().transfer_file("config.json", lambda _: None)
            self.assertEqual(error.exception.reason, "busy")
            self.assertTrue(owner.is_alive())
        finally:
            released.set(); owner.join(2)
        self.assertFalse(owner.is_alive()); self.assertEqual(len(errors), 1)
        self.assertIsInstance(errors[0], transport.ModelSourceTransferError)

    def test_unconfirmed_close_retains_the_single_lease_without_publication(self):
        self.responses = [Response(self.data["config.json"])]
        original = self.responses[0].close
        def failed_close(): original(); raise OSError("Synthetic close was not acknowledged")
        self.responses[0].close = failed_close
        with self.assertRaises(transport.ModelSourceTransferError) as error: self.session().transfer_file("config.json", lambda _: None)
        self.assertEqual(error.exception.reason, "close_unconfirmed")
        self.assertIsNotNone(transport._RETAINED_CONNECTION)
        with self.assertRaises(transport.ModelSourceTransferError) as next_error: self.session().transfer_file("config.json", lambda _: None)
        self.assertEqual(next_error.exception.reason, "busy")

    def test_public_dns_rejects_any_private_or_mixed_result(self):
        for addresses in [["127.0.0.1"], ["8.8.8.8", "10.0.0.1"], ["169.254.169.254"], ["::1"], ["224.0.0.1"]]:
            records = [(socket.AF_INET6 if ':' in address else socket.AF_INET, socket.SOCK_STREAM, 6, '', (address, 443)) for address in addresses]
            with patch.object(transport.socket, "getaddrinfo", return_value=records):
                with self.assertRaises(transport.ModelSourceTransferError): transport._resolve_public("huggingface.co")
        with patch.object(transport.socket, "getaddrinfo", return_value=[(socket.AF_INET, socket.SOCK_STREAM, 6, '', ('8.8.8.8', 443))]):
            self.assertEqual(transport._resolve_public("huggingface.co"), ("8.8.8.8",))

    def test_connection_pins_ip_and_requests_verified_canonical_tls_hostname(self):
        class OwnedSocket:
            closed = False
            def settimeout(self, value): self.timeout = value
            def shutdown(self, _how): pass
            def close(self): self.closed = True
            def do_handshake(self): self.handshaken = True
        raw, wrapped = OwnedSocket(), OwnedSocket()
        context = ssl.create_default_context()
        self.assertTrue(context.check_hostname); self.assertEqual(context.verify_mode, ssl.CERT_REQUIRED)
        with patch.object(transport.socket, "create_connection", return_value=raw) as connect, \
                patch.object(transport.ssl, "create_default_context", return_value=context), \
                patch.object(context, "wrap_socket", return_value=wrapped) as wrap:
            connection = self.real_connection("huggingface.co", "8.8.8.8", time.monotonic() + 5)
            connection.connect()
            self.assertEqual(connect.call_args.args[0], ("8.8.8.8", 443))
            self.assertEqual(wrap.call_args.kwargs, {"server_hostname": "huggingface.co", "do_handshake_on_connect": False})
            self.assertTrue(wrapped.handshaken)
            connection.abort(); self.assertTrue(wrapped.closed)

    def test_timed_out_dns_keeps_its_nonqueueing_slot_until_actual_settlement(self):
        entered, released = Event(), Event()
        calls = []
        def resolve(host):
            calls.append(host); entered.set(); released.wait(3); return ("8.8.8.8",)
        with patch.object(transport, "_resolve_public", side_effect=resolve):
            try:
                with self.assertRaises(transport.ModelSourceTransferError) as error:
                    self.real_lookup("huggingface.co", time.monotonic() + 0.03, lambda: None)
                self.assertEqual(error.exception.reason, "timeout"); self.assertTrue(entered.is_set())
                with self.assertRaises(transport.ModelSourceTransferError) as busy:
                    self.real_lookup("cdn.example.net", time.monotonic() + 1, lambda: None)
                self.assertEqual(busy.exception.reason, "busy"); self.assertEqual(calls, ["huggingface.co"])
            finally:
                released.set()
            until = time.monotonic() + 1
            while True:
                try:
                    result = self.real_lookup("huggingface.co", until, lambda: None); break
                except transport.ModelSourceTransferError as error:
                    if error.reason != "busy" or time.monotonic() >= until: raise
                    time.sleep(0.001)
            self.assertEqual(result, ("8.8.8.8",)); self.assertEqual(len(calls), 2)

    def test_cancellation_and_bad_sink_acknowledgement_cannot_complete_or_fetch_again(self):
        self.responses = [Response(self.data["config.json"])]
        session = self.session()
        def cancel(_chunk): session.cancel()
        with self.assertRaises(transport.ModelSourceTransferError): session.transfer_file("config.json", cancel)
        count = len(self.connections)
        with self.assertRaises(transport.ModelSourceTransferError): session.transfer_file("tokenizer.json", lambda _: None)
        self.assertEqual(len(self.connections), count)
        self.responses = [Response(self.data["config.json"])]
        with self.assertRaises(transport.ModelSourceTransferError) as error: self.session().transfer_file("config.json", lambda _: False)
        self.assertEqual(error.exception.reason, "invalid_sink")

    def test_each_file_is_bounded_in_fixed_chunks_and_aggregate_receipts_cover_the_manifest(self):
        data = {**self.data, "model.safetensors": b"s" * (transport.CHUNK_BYTES * 2 + 1)}
        manifest = capture_manifest(fixture_manifest(data), "fixture/model", REVISION)
        session = transport.ModelSourceTransferSession(manifest, maximum_duration_seconds=5)
        sizes, chunks = [], []
        for name, body in data.items():
            self.responses = [Response(body)]
            receipt = session.transfer_file(name, lambda chunk: chunks.append(len(chunk)))
            sizes.append(receipt.size_bytes)
        self.assertEqual(sum(sizes), manifest.source.totalBytes)
        self.assertLessEqual(max(chunks), transport.CHUNK_BYTES)
        self.assertEqual(session._received, manifest.source.totalBytes)

    def test_final_prewrite_policy_cannot_return_true_after_cancel_or_deadline(self):
        for change in ("cancel", "deadline"):
            with self.subTest(change=change):
                response = Response(self.data["config.json"])
                self.responses = [response]
                after_read = 0
                session = None
                def current():
                    nonlocal after_read
                    if response.body.tell():
                        after_read += 1
                        # The first policy check follows the read; the second
                        # is the final synchronous authorization before sink.
                        if after_read == 2:
                            if change == "cancel": session.cancel()
                            else: time.sleep(1.05)
                    return True
                session = self.session(maximum_duration_seconds=1, is_current=current)
                written = []
                with self.assertRaises(transport.ModelSourceTransferError): session.transfer_file("config.json", lambda data: written.append(data))
                self.assertEqual(written, []); self.assertEqual(after_read, 2)

    def test_real_stdlib_connection_close_keeps_body_socket_abortable_at_deadline(self):
        client, server = socket.socketpair()
        client.settimeout(5); server.settimeout(3)
        release, sent_headers = Event(), Event()
        observations, errors = [], []
        base = self.real_connection
        class ObservedConnection(base):
            def getresponse(self):
                result = super().getresponse()
                observations.append(self.sock is None and self._owned_socket is client)
                return result
        def connected(host, address, deadline):
            value = ObservedConnection(host, address, deadline)
            value.sock = client; value._owned_socket = client
            return value
        def serve():
            try:
                request = b""
                while b"\r\n\r\n" not in request: request += server.recv(4096)
                server.sendall(f"HTTP/1.1 200 OK\r\nContent-Length: {len(self.data['config.json'])}\r\nConnection: close\r\n\r\n".encode())
                sent_headers.set(); release.wait(3)
            except OSError: pass
        def download():
            try: self.session(maximum_duration_seconds=1).transfer_file("config.json", lambda _: self.fail("No body may reach sink"))
            except Exception as error: errors.append(error)
        provider, owner = Thread(target=serve), Thread(target=download)
        with patch.object(transport, "_PinnedHttpsConnection", side_effect=connected):
            provider.start(); started = time.monotonic(); owner.start()
            try:
                self.assertTrue(sent_headers.wait(1))
                owner.join(1.8)
                self.assertFalse(owner.is_alive(), "Detached stdlib response socket ignored the absolute deadline")
                self.assertLess(time.monotonic() - started, 1.9)
                self.assertEqual(observations, [True])
                self.assertEqual(len(errors), 1); self.assertIsInstance(errors[0], transport.ModelSourceTransferError)
            finally:
                release.set()
                try: client.shutdown(socket.SHUT_RDWR)
                except OSError: pass
                client.close(); server.close(); owner.join(3); provider.join(3)
