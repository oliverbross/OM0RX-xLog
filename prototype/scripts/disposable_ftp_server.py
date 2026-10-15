#!/usr/bin/env python3
"""Minimal disposable FTP/implicit-FTPS server for local acceptance only.

This intentionally implements only the commands exercised by libcurl in the
xLog backup acceptance. Paths are confined to the supplied temporary root.
"""

from __future__ import annotations

import argparse
import json
import os
import posixpath
import select
import signal
import socket
import socketserver
import ssl
import sys
import threading
import time
from pathlib import Path


class FTPServer(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True

    def __init__(self, address, handler, *, root: Path, username: str,
                 password: str, tls_context: ssl.SSLContext | None,
                 mkdir_refuse: bool, drop_after_store: bool, oversized_download: str | None,
                 withhold_greeting: bool, slow_download: str | None,
                 slow_upload: str | None, upload_observation: Path | None):
        super().__init__(address, handler)
        self.root = root.resolve()
        self.username = username
        self.password = password
        self.tls_context = tls_context
        self.mkdir_refuse = mkdir_refuse
        self.drop_after_store = drop_after_store
        self.oversized_download = oversized_download
        self.withhold_greeting = withhold_greeting
        self.slow_download = slow_download
        self.slow_upload = slow_upload
        self.upload_observation = upload_observation
        self.store_count = 0
        self.downloads: dict[Path, int] = {}
        self.download_lock = threading.Lock()

    def download_is_oversized(self, path: Path) -> bool:
        with self.download_lock:
            return self.oversized_download is not None and (
                self.oversized_download != "after-verification" or self.downloads.get(path, 0) > 0)

    def handle_error(self, request, client_address) -> None:
        # The negative FTPS acceptance intentionally rejects the disposable
        # certificate before an FTP command can be sent.
        if isinstance(sys.exc_info()[1], ssl.SSLError):
            return
        super().handle_error(request, client_address)


class FTPHandler(socketserver.StreamRequestHandler):
    server: FTPServer

    def setup(self) -> None:
        super().setup()
        if self.server.tls_context is not None:
            wrapped = self.server.tls_context.wrap_socket(self.connection, server_side=True)
            self.connection = wrapped
            self.request = wrapped
            self.rfile = wrapped.makefile("rb", self.rbufsize)
            self.wfile = wrapped.makefile("wb", self.wbufsize)
        self.authenticated = False
        self.pending_user = ""
        self.cwd = "/"
        self.passive_listener: socket.socket | None = None
        self.private_data = False

    def finish(self) -> None:
        if self.passive_listener is not None:
            self.passive_listener.close()
        super().finish()

    def reply(self, code: int, message: str) -> None:
        self.wfile.write(f"{code} {message}\r\n".encode("utf-8"))
        self.wfile.flush()

    def handle(self) -> None:
        if self.server.withhold_greeting:
            # Hold the control handshake until the client's production
            # connection timeout closes it; never authenticate or accept STOR.
            try:
                self.connection.recv(1)
            except ConnectionResetError:
                pass
            return
        self.reply(220, "OM0RX-xLog disposable acceptance server")
        while True:
            try:
                raw = self.rfile.readline(8192)
            except ConnectionResetError:
                # A bounded client may abort the control channel when SIZE or
                # the received byte stream exceeds its download limit.
                return
            if not raw:
                return
            try:
                line = raw.decode("utf-8").rstrip("\r\n")
            except UnicodeDecodeError:
                self.reply(500, "Invalid command encoding")
                continue
            command, _, argument = line.partition(" ")
            command = command.upper()
            if command == "QUIT":
                self.reply(221, "Goodbye")
                return
            if not self.dispatch(command, argument):
                return

    def dispatch(self, command: str, argument: str) -> bool:
        if command == "USER":
            self.pending_user = argument
            self.reply(331, "Password required")
            return True
        if command == "PASS":
            if self.pending_user == self.server.username and argument == self.server.password:
                self.authenticated = True
                self.reply(230, "Logged in")
            else:
                self.reply(530, "Authentication failed")
            return True
        if command in {"SYST", "FEAT"}:
            self.reply(215 if command == "SYST" else 211,
                       "UNIX Type: L8" if command == "SYST" else "End")
            return True
        if command in {"OPTS", "TYPE", "NOOP"}:
            self.reply(200, "OK")
            return True
        if not self.authenticated:
            self.reply(530, "Login required")
            return True
        if command == "PWD":
            self.reply(257, f'"{self.cwd}"')
        elif command == "PBSZ":
            self.reply(200, "PBSZ=0")
        elif command == "PROT":
            self.private_data = argument.upper() == "P"
            self.reply(200, "Protection accepted")
        elif command == "CWD":
            path = self.resolve(argument)
            if path is not None and path.is_dir():
                self.cwd = self.virtual(argument)
                self.reply(250, "Directory changed")
            else:
                self.reply(550, "Directory unavailable")
        elif command == "MKD":
            if self.server.mkdir_refuse:
                self.reply(550, "Reservation refused")
                return True
            path = self.resolve(argument)
            if path is None:
                self.reply(550, "Invalid path")
                return True
            try:
                path.mkdir()
                self.reply(257, f'"{self.virtual(argument)}" created')
            except OSError:
                self.reply(550, "Directory not created")
        elif command in {"EPSV", "PASV"}:
            self.open_passive(command)
        elif command == "SIZE":
            path = self.resolve(argument)
            if path is not None and path.is_file():
                if self.server.oversized_download == "streamed":
                    self.reply(502, "Size unavailable")
                else:
                    self.reply(213, str(path.stat().st_size + int(self.server.download_is_oversized(path))))
            else:
                self.reply(550, "File unavailable")
        elif command == "STOR":
            return self.receive_file(argument)
        elif command == "RETR":
            self.send_file(argument)
        else:
            self.reply(502, "Command not implemented")
        return True

    def virtual(self, value: str) -> str:
        candidate = value if value.startswith("/") else posixpath.join(self.cwd, value)
        normalized = posixpath.normpath(candidate)
        return normalized if normalized.startswith("/") else "/" + normalized

    def resolve(self, value: str) -> Path | None:
        virtual = self.virtual(value)
        resolved = (self.server.root / virtual.lstrip("/")).resolve()
        try:
            resolved.relative_to(self.server.root)
        except ValueError:
            return None
        return resolved

    def open_passive(self, command: str) -> None:
        if self.passive_listener is not None:
            self.passive_listener.close()
        listener = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        listener.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        if self.server.slow_upload:
            listener.setsockopt(socket.SOL_SOCKET, socket.SO_RCVBUF, 32768)
        listener.bind(("127.0.0.1", 0))
        listener.listen(1)
        listener.settimeout(10)
        self.passive_listener = listener
        port = listener.getsockname()[1]
        if command == "EPSV":
            self.reply(229, f"Entering Extended Passive Mode (|||{port}|)")
        else:
            self.reply(227, f"Entering Passive Mode (127,0,0,1,{port // 256},{port % 256})")

    def data_connection(self) -> socket.socket:
        if self.passive_listener is None:
            raise RuntimeError("Passive mode required")
        listener = self.passive_listener
        self.passive_listener = None
        connection, _ = listener.accept()
        listener.close()
        if self.private_data and self.server.tls_context is not None:
            return self.server.tls_context.wrap_socket(connection, server_side=True)
        return connection

    def receive_file(self, argument: str) -> bool:
        path = self.resolve(argument)
        if path is None or not path.parent.is_dir() or self.passive_listener is None:
            self.reply(550, "File unavailable")
            return True
        self.reply(150, "Opening data connection")
        self.server.store_count += 1
        try:
            with self.data_connection() as connection, path.open("xb") as output:
                if self.server.slow_upload:
                    while True:
                        # Stop writing when the client abandons its control
                        # channel; do not drain queued data after the timeout.
                        if select.select([self.connection], [], [], 0)[0]:
                            break
                        if self.server.slow_upload == "deadline" or output.tell() == 0:
                            chunk = connection.recv(4096)
                            if not chunk:
                                break
                            output.write(chunk)
                            output.flush()
                        time.sleep(0.1)
                    return False
                while True:
                    chunk = connection.recv(65536)
                    if not chunk:
                        break
                    output.write(chunk)
            if self.server.drop_after_store:
                self.connection.shutdown(socket.SHUT_RDWR)
                self.connection.close()
                return False
            self.reply(226, "Transfer complete")
        except OSError:
            self.reply(550, "Transfer failed")
        finally:
            if self.server.upload_observation is not None:
                pending = self.server.upload_observation.with_suffix(".pending")
                pending.write_text(json.dumps({
                    "store_count": self.server.store_count,
                    "stored_bytes": path.stat().st_size if path.exists() else 0,
                    "settled": True,
                }), encoding="utf-8")
                pending.replace(self.server.upload_observation)
        return True

    def send_file(self, argument: str) -> None:
        path = self.resolve(argument)
        if path is None or not path.is_file() or self.passive_listener is None:
            self.reply(550, "File unavailable")
            return
        self.reply(150, "Opening data connection")
        try:
            with self.data_connection() as connection, path.open("rb") as source:
                if self.server.slow_download == "stall":
                    connection.sendall(source.read(1))
                    # The client must close the data channel at its unchanged
                    # production low-speed timeout, rather than accept a prefix.
                    connection.recv(1)
                    return
                if self.server.slow_download == "deadline":
                    # Stay comfortably above the production 1 byte/sec floor
                    # while requiring longer than the 120-second total limit.
                    while chunk := source.read(32):
                        connection.sendall(chunk)
                        time.sleep(1)
                    self.reply(226, "Transfer complete")
                    return
                while chunk := source.read(65536):
                    connection.sendall(chunk)
                if self.server.download_is_oversized(path):
                    connection.sendall(b"!")
            with self.server.download_lock:
                self.server.downloads[path] = self.server.downloads.get(path, 0) + 1
            self.reply(226, "Transfer complete")
        except OSError:
            self.reply(550, "Transfer failed")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", required=True)
    parser.add_argument("--username", required=True)
    parser.add_argument("--password", required=True)
    parser.add_argument("--ready-file", required=True)
    parser.add_argument("--mode", choices=("ftp", "ftps"), default="ftp")
    parser.add_argument("--cert")
    parser.add_argument("--key")
    parser.add_argument("--mkdir-refuse", action="store_true")
    parser.add_argument("--drop-after-store", action="store_true")
    parser.add_argument("--oversized-download", choices=("advertised", "streamed", "after-verification"))
    parser.add_argument("--withhold-greeting", action="store_true")
    parser.add_argument("--slow-download", choices=("stall", "deadline"))
    parser.add_argument("--slow-upload", choices=("stall", "deadline"))
    parser.add_argument("--upload-observation", type=Path)
    args = parser.parse_args()

    root = Path(args.root)
    root.mkdir(parents=True, exist_ok=True)
    tls_context = None
    if args.mode == "ftps":
        if not args.cert or not args.key:
            parser.error("--cert and --key are required for FTPS")
        tls_context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        tls_context.minimum_version = ssl.TLSVersion.TLSv1_2
        tls_context.load_cert_chain(args.cert, args.key)

    server = FTPServer(("127.0.0.1", 0), FTPHandler, root=root,
                       username=args.username, password=args.password,
                       tls_context=tls_context, mkdir_refuse=args.mkdir_refuse,
                       drop_after_store=args.drop_after_store,
                       oversized_download=args.oversized_download,
                       withhold_greeting=args.withhold_greeting,
                       slow_download=args.slow_download, slow_upload=args.slow_upload,
                       upload_observation=args.upload_observation)
    endpoint = f"{args.mode}://localhost:{server.server_address[1]}"
    ready = Path(args.ready_file)
    ready.write_text(json.dumps({"endpoint": endpoint, "pid": os.getpid()}), encoding="utf-8")

    def stop(_signal, _frame) -> None:
        threading.Thread(target=server.shutdown, daemon=True).start()

    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)
    try:
        server.serve_forever(poll_interval=0.1)
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
