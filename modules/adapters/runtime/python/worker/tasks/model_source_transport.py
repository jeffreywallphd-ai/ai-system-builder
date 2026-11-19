"""Private fixed-source streaming. No paths, publication, credentials or approval authority."""
from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor, TimeoutError as FutureTimeout
from dataclasses import dataclass
import hashlib
import http.client
import inspect
import ipaddress
import re
import socket
import ssl
from threading import Event, Lock, Timer
import time
from typing import Callable
from urllib.parse import quote, urljoin, urlsplit

from .model_download_manifest import capture_manifest
from ..models import ModelDownloadManifest

CHUNK_BYTES = 64 * 1024
MAX_REDIRECTS = 5
_FILE_SLOT = Lock()
_DNS_SLOT = Lock()
_DNS_EXECUTOR: ThreadPoolExecutor | None = None
_RETAINED_CONNECTION = None


class ModelSourceTransferError(RuntimeError):
    retryable = False
    stage = "generation"

    def __init__(self, reason: str = "failed"):
        super().__init__("The selected model file transfer could not be completed.")
        if type(reason) is not str or reason not in {"failed", "destination_denied", "dns_denied", "busy", "timeout", "invalid_limits", "invalid_selection",
                          "not_current", "request_limit", "redirect_denied", "provider_denied", "invalid_framing", "invalid_body",
                          "size_exceeded", "invalid_sink", "integrity_failed", "close_unconfirmed"}:
            reason = "failed"
        self.reason = reason
        self.error_code = "model_download_transfer_" + reason


def _origin(value: str) -> str:
    try:
        if type(value) is not str or len(value) > 8192 or any(ord(c) < 33 or ord(c) == 127 for c in value):
            raise ValueError()
        parsed = urlsplit(value)
        host = parsed.hostname
        if (parsed.scheme != "https" or not host or len(host) > 253 or parsed.username is not None or
                parsed.password is not None or "#" in value or parsed.port not in (None, 443) or
                re.fullmatch(r"[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?", host) is None or
                ".." in host or host.endswith(".")):
            raise ValueError()
        return "https://" + host
    except Exception:
        raise ModelSourceTransferError("destination_denied") from None


def _resolve_public(host: str) -> tuple[str, ...]:
    records = socket.getaddrinfo(host, 443, type=socket.SOCK_STREAM)
    if not records or len(records) > 64:
        raise ModelSourceTransferError("dns_denied")
    addresses = []
    for family, _kind, _protocol, _canonical, location in records:
        if family not in (socket.AF_INET, socket.AF_INET6):
            raise ModelSourceTransferError("dns_denied")
        address = location[0]
        parsed = ipaddress.ip_address(address)
        if "%" in address or not parsed.is_global or parsed.is_multicast or parsed.is_reserved:
            raise ModelSourceTransferError("dns_denied")
        if address not in addresses:
            addresses.append(address)
    if not 1 <= len(addresses) <= 8:
        raise ModelSourceTransferError("dns_denied")
    return tuple(addresses)


def _lookup_public(host: str, deadline: float, fence: Callable[[], None]) -> tuple[str, ...]:
    global _DNS_EXECUTOR
    fence()
    if not _DNS_SLOT.acquire(blocking=False):
        raise ModelSourceTransferError("busy")
    try:
        if _DNS_EXECUTOR is None:
            _DNS_EXECUTOR = ThreadPoolExecutor(max_workers=1, thread_name_prefix="model-source-dns")
        def resolve_if_live():
            fence()
            return _resolve_public(host)
        future = _DNS_EXECUTOR.submit(resolve_if_live)
    except Exception:
        _DNS_SLOT.release()
        raise ModelSourceTransferError() from None
    def settled(result):
        try:
            result.exception()
        except BaseException:
            pass
        finally:
            _DNS_SLOT.release()
    future.add_done_callback(settled)
    try:
        return future.result(timeout=max(0, deadline - time.monotonic()))
    except FutureTimeout:
        # Never cancel/credit a resolver that may still be running. It cannot
        # open the provider connection; later attempts cannot enqueue behind it.
        raise ModelSourceTransferError("timeout") from None
    except ModelSourceTransferError:
        raise
    except Exception:
        raise ModelSourceTransferError("dns_denied") from None


class _PinnedHttpsConnection(http.client.HTTPSConnection):
    """One-shot custody: close detaches HTTP state; abort retires the owned socket."""
    def __init__(self, host: str, address: str, deadline: float):
        super().__init__(host, port=443, timeout=max(0.001, deadline - time.monotonic()), context=ssl.create_default_context())
        self._address, self._deadline, self._aborted = address, deadline, Event()
        self._close_error = False
        self._owned_socket = None

    def connect(self):
        if self._aborted.is_set() or time.monotonic() >= self._deadline:
            raise ModelSourceTransferError("timeout")
        raw = socket.create_connection((self._address, 443), timeout=min(60, self._deadline - time.monotonic()))
        self.sock = raw
        self._owned_socket = raw
        try:
            if self._aborted.is_set() or time.monotonic() >= self._deadline:
                raise ModelSourceTransferError("timeout")
            raw.settimeout(min(60, self._deadline - time.monotonic()))
            # No proxy/tunnel/environment session: pin TCP but verify the real
            # approved hostname through the default certificate/SNI policy.
            self.sock = self._context.wrap_socket(raw, server_hostname=self.host, do_handshake_on_connect=False)
            self._owned_socket = self.sock
            self.refresh_timeout()
            self.sock.do_handshake()
            if self._aborted.is_set() or time.monotonic() >= self._deadline:
                raise ModelSourceTransferError("timeout")
        except BaseException:
            self.abort()
            raw.close()
            raise

    def abort(self):
        self._aborted.set()
        current = self._owned_socket
        if current is not None:
            try:
                current.shutdown(socket.SHUT_RDWR)
            except OSError:
                pass
            try:
                current.close()
            except OSError:
                self._close_error = True

    def refresh_timeout(self):
        remaining = self._deadline - time.monotonic()
        if self._aborted.is_set() or remaining <= 0:
            raise ModelSourceTransferError("timeout")
        if self._owned_socket is not None:
            self._owned_socket.settimeout(min(60, remaining))

    def close(self):
        # getresponse() detaches Connection: close sockets before returning its
        # still-live response. Keep our one-shot custody until abort + response
        # settlement in the caller, instead of losing the cancellation target.
        self.sock = None
        super().close()


@dataclass(frozen=True)
class ModelFileTransferReceipt:
    size_bytes: int
    sha256: str


class ModelSourceTransferSession:
    def __init__(self, manifest: ModelDownloadManifest, *, maximum_duration_seconds: int,
                 allowed_origins: tuple[str, ...] = ("https://huggingface.co",),
                 is_current: Callable[[], bool] = lambda: True):
        if not isinstance(manifest, ModelDownloadManifest):
            raise ModelSourceTransferError("invalid_selection")
        self._manifest = capture_manifest(manifest, manifest.source.modelId, manifest.source.revision)
        if type(maximum_duration_seconds) is not int or not 1 <= maximum_duration_seconds <= 3600:
            raise ModelSourceTransferError("invalid_limits")
        if type(allowed_origins) is not tuple or not 1 <= len(allowed_origins) <= 4 or not callable(is_current):
            raise ModelSourceTransferError("invalid_limits")
        origins = frozenset(_origin(value) for value in allowed_origins)
        if len(origins) != len(allowed_origins) or "https://huggingface.co" not in origins or any(
                urlsplit(value).path not in ("", "/") or urlsplit(value).query for value in allowed_origins):
            raise ModelSourceTransferError("invalid_limits")
        self._origins, self._current = origins, is_current
        self._deadline = time.monotonic() + maximum_duration_seconds
        self._used: set[str] = set()
        self._received = 0
        self._requests = 0
        self._cancelled = Event()
        self._failed = Event()
        self._cancel_close_failed = Event()
        self._connection: _PinnedHttpsConnection | None = None

    def cancel(self):
        self._cancelled.set()
        connection = self._connection
        if connection is not None:
            try:
                connection.abort()
            except BaseException:
                self._cancel_close_failed.set()

    def assert_current(self) -> None:
        """Private composition fence; it adds no task or filesystem authority."""
        self._fence()

    def _fence(self):
        if self._cancelled.is_set() or self._failed.is_set():
            raise ModelSourceTransferError("not_current")
        if time.monotonic() >= self._deadline:
            raise ModelSourceTransferError("timeout")
        try:
            allowed = self._current()
            if inspect.iscoroutine(allowed):
                allowed.close()
            if allowed is not True:
                raise ModelSourceTransferError("not_current")
            if self._cancelled.is_set() or self._failed.is_set():
                raise ModelSourceTransferError("not_current")
            if time.monotonic() >= self._deadline:
                raise ModelSourceTransferError("timeout")
        except ModelSourceTransferError:
            raise
        except Exception:
            raise ModelSourceTransferError("not_current") from None

    def transfer_file(self, name: str, write: Callable[[bytes], None]) -> ModelFileTransferReceipt:
        global _RETAINED_CONNECTION
        self._fence()
        selected = next((item for item in self._manifest.source.files if item.path == name), None)
        if selected is None or name in self._used or not callable(write):
            raise ModelSourceTransferError("invalid_selection")
        if not _FILE_SLOT.acquire(blocking=False):
            raise ModelSourceTransferError("busy")
        self._used.add(name)
        release_lease = True
        try:
            source = self._manifest.source
            url = f"https://huggingface.co/{quote(source.modelId, safe='/')}/resolve/{source.revision}/{quote(name, safe='')}"
            visited = set()
            for redirect in range(MAX_REDIRECTS + 1):
                self._fence()
                origin = _origin(url)
                if origin not in self._origins or url in visited:
                    raise ModelSourceTransferError("destination_denied")
                visited.add(url)
                parsed = urlsplit(url)
                self._requests += 1
                if self._requests > len(source.files) * (MAX_REDIRECTS + 1):
                    raise ModelSourceTransferError("request_limit")
                addresses = _lookup_public(parsed.hostname, self._deadline, self._fence)
                self._fence()
                connection = _PinnedHttpsConnection(parsed.hostname, addresses[0], self._deadline)
                self._connection = connection
                close_failed = Event()
                def expire(owned=connection, failure=close_failed):
                    try:
                        owned.abort()
                    except BaseException:
                        failure.set()
                timer = Timer(max(0.001, self._deadline - time.monotonic()), expire)
                timer.start()
                response = None
                try:
                    self._fence()
                    connection.request("GET", parsed.path + ("?" + parsed.query if parsed.query else ""), headers={
                        "Host": parsed.hostname, "Accept": "application/octet-stream, application/json, text/plain", "Connection": "close"})
                    self._fence()
                    response = connection.getresponse()
                    self._fence()
                    if response.status in (301, 302, 303, 307, 308):
                        locations = response.headers.get_all("location") or []
                        if len(locations) != 1 or redirect == MAX_REDIRECTS:
                            raise ModelSourceTransferError("redirect_denied")
                        url = urljoin(url, locations[0])
                        continue
                    if response.status != 200:
                        raise ModelSourceTransferError("provider_denied")
                    lengths = response.headers.get_all("content-length") or []
                    encodings = response.headers.get_all("content-encoding") or []
                    transfers = response.headers.get_all("transfer-encoding") or []
                    if (len(lengths) > 1 or lengths and (re.fullmatch(r"[0-9]{1,20}", lengths[0]) is None or int(lengths[0]) != selected.sizeBytes) or
                            encodings and encodings != ["identity"] or transfers and (transfers != ["chunked"] or lengths)):
                        raise ModelSourceTransferError("invalid_framing")
                    size = 0
                    checksum = hashlib.sha256() if selected.integrity.algorithm == "sha256" else hashlib.sha1()
                    if selected.integrity.algorithm == "git-blob-sha1":
                        checksum.update(f"blob {selected.sizeBytes}\0".encode("ascii"))
                    sha256 = hashlib.sha256()
                    while True:
                        self._fence()
                        connection.refresh_timeout()
                        chunk = response.read(min(CHUNK_BYTES, selected.sizeBytes - size + 1,
                            source.totalBytes - self._received + 1))
                        self._fence()
                        if not chunk:
                            break
                        if type(chunk) is not bytes:
                            raise ModelSourceTransferError("invalid_body")
                        self._received += len(chunk)
                        if len(chunk) > selected.sizeBytes - size or self._received > source.totalBytes:
                            raise ModelSourceTransferError("size_exceeded")
                        checksum.update(chunk); sha256.update(chunk)
                        self._fence()
                        if write(chunk) is not None:
                            raise ModelSourceTransferError("invalid_sink")
                        self._fence()
                        size += len(chunk)
                    if size != selected.sizeBytes or checksum.hexdigest() != selected.integrity.digest:
                        raise ModelSourceTransferError("integrity_failed")
                    self._fence()
                    return ModelFileTransferReceipt(size, "sha256:" + sha256.hexdigest())
                finally:
                    for close in (connection.abort, response.close if response is not None else lambda: None, connection.close):
                        try:
                            close()
                        except BaseException:
                            close_failed.set()
                    timer.cancel(); timer.join()
                    if close_failed.is_set() or self._cancel_close_failed.is_set() or getattr(connection, "_close_error", False):
                        release_lease = False
                        _RETAINED_CONNECTION = (connection, response)
                        raise ModelSourceTransferError("close_unconfirmed")
                    self._connection = None
            raise ModelSourceTransferError("redirect_denied")
        except ModelSourceTransferError:
            self._failed.set()
            raise
        except Exception:
            self._failed.set()
            raise ModelSourceTransferError() from None
        finally:
            if release_lease:
                _FILE_SLOT.release()
