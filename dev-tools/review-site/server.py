#!/usr/bin/env python3
"""Loopback-only, read-only JSON review server. Never serves repository files."""
from __future__ import annotations

import argparse
import ipaddress
import json
import os
import sys
import threading
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / "helpers"))
from control_plane.projection import project
from control_plane.common import digest
from control_plane.site import server_version


class Server(ThreadingHTTPServer):
    daemon_threads = True
    request_queue_size = 8

    def __init__(self, address, root, projection=project):
        if not ipaddress.ip_address(address[0]).is_loopback:
            raise ValueError("loopback address required")
        self.root = Path(root).resolve()
        self.projection = projection
        self.instance_id = str(uuid.uuid4())
        self.code_version = server_version()
        self.slots = threading.BoundedSemaphore(8)
        super().__init__(address, Handler)

    def process_request(self, request, client_address):
        if not self.slots.acquire(blocking=False):
            request.close()
            return
        request.settimeout(5)
        super().process_request(request, client_address)

    def process_request_thread(self, request, client_address):
        try:
            super().process_request_thread(request, client_address)
        finally:
            self.slots.release()

    def handle_error(self, request, client_address):
        pass  # no raw request, exception or path diagnostics


class Handler(BaseHTTPRequestHandler):
    server_version = "DevelopmentReview"
    sys_version = ""

    def log_message(self, format, *args):
        pass

    def reply(self, code, payload, content_type="application/json; charset=utf-8", head=False):
        body = payload if isinstance(payload, bytes) else json.dumps(payload).encode()
        self.send_response(code)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("Content-Security-Policy", "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'")
        self.send_header("Cross-Origin-Resource-Policy", "same-origin")
        self.end_headers()
        if not head:
            self.wfile.write(body)

    def handle_read(self, head=False):
        port = self.server.server_address[1]
        expected = f"127.0.0.1:{port}"
        if self.headers.get_all("Host") != [expected] or self.headers.get("Origin") not in (None, f"http://{expected}") or self.headers.get("Sec-Fetch-Site") not in (None, "none", "same-origin"):
            return self.reply(403, {"error": "review.origin-denied"}, head=head)
        url = urlsplit(self.path)
        if url.query or url.fragment or url.scheme or url.netloc or len(self.path) > 512:
            return self.reply(404, {"error": "review.route-not-found"}, head=head)
        if url.path == "/api/status":
            return self.reply(200, {"schema_version": "development-review-server-v1", "repository_id": digest(str(self.server.root)), "port": port, "instance_id": self.server.instance_id, "pid": os.getpid(), "server_version": self.server.code_version}, head=head)
        if url.path == "/api/review":
            try:
                value = self.server.projection(self.server.root)
                body = json.dumps(value).encode()
                if len(body) > 2 * 1024 * 1024:
                    raise ValueError("projection bound")
                return self.reply(200, body, head=head)
            except Exception:
                return self.reply(503, {"error": "review.projection-unavailable"}, head=head)
        routes = {"/": ("index.html", "text/html; charset=utf-8"), "/app.js": ("app.js", "text/javascript; charset=utf-8"), "/style.css": ("style.css", "text/css; charset=utf-8")}
        if url.path not in routes:
            return self.reply(404, {"error": "review.route-not-found"}, head=head)
        name, content_type = routes[url.path]
        return self.reply(200, (HERE / name).read_bytes(), content_type, head)

    def do_GET(self):
        self.handle_read()

    def do_HEAD(self):
        self.handle_read(True)

    def deny(self):
        self.close_connection = True
        self.reply(405, {"error": "review.read-only"})

    do_POST = do_PUT = do_PATCH = do_DELETE = do_OPTIONS = do_TRACE = deny


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo", type=Path, default=HERE.parents[1])
    parser.add_argument("--port", type=int, default=8766)
    args = parser.parse_args()
    if not 0 <= args.port <= 65535 or not (args.repo / "AGENTS.md").is_file():
        parser.error("A repository root and valid local port are required.")
    with Server(("127.0.0.1", args.port), args.repo) as server:
        print(f"http://127.0.0.1:{server.server_port}", flush=True)
        server.serve_forever(poll_interval=0.2)


if __name__ == "__main__":
    main()
