#!/usr/bin/env python3
r"""TCP-to-named-pipe relay for the Cheat Engine MCP bridge.

Run this script on Windows while ``ce_mcp_bridge.lua`` is loaded in Cheat
Engine. It accepts the same length-prefixed JSON-RPC frames used by
``mcp_cheatengine.py`` and forwards them to ``\\.\pipe\CE_MCP_Bridge_v99``.

Use this when the MCP server cannot open the Windows named pipe directly, such
as from WSL, a container, or another host.

Bind to 127.0.0.1 unless you intentionally want to expose Cheat Engine control
to another machine.
"""

from __future__ import annotations

import argparse
import socket
import socketserver
import struct
import sys
from typing import Optional

try:
    import pywintypes
    import win32file
except ImportError as exc:  # pragma: no cover - Windows-only helper
    print("ce_tcp_relay.py must run on Windows with pywin32 installed.", file=sys.stderr)
    raise SystemExit(1) from exc


PIPE_NAME = r"\\.\pipe\CE_MCP_Bridge_v99"
DEFAULT_HOST = "127.0.0.1"
DEFAULT_PORT = 9876
MAX_FRAME_SIZE_BYTES = 32 * 1024 * 1024


def read_socket_exact(sock: socket.socket, size: int) -> Optional[bytes]:
    """Read exactly size bytes, returning None on clean peer disconnect."""
    chunks: list[bytes] = []
    remaining = size
    while remaining > 0:
        chunk = sock.recv(remaining)
        if not chunk:
            if remaining == size:
                return None
            raise ConnectionError("TCP client disconnected mid-frame.")
        chunks.append(chunk)
        remaining -= len(chunk)
    return b"".join(chunks)


def read_pipe_exact(handle, size: int) -> bytes:
    """Read exactly size bytes from a Windows named pipe."""
    chunks: list[bytes] = []
    remaining = size
    while remaining > 0:
        chunk = win32file.ReadFile(handle, remaining)[1]
        if not chunk:
            raise ConnectionError("Cheat Engine pipe closed mid-frame.")
        chunks.append(chunk)
        remaining -= len(chunk)
    return b"".join(chunks)


def validate_frame_size(size: int, direction: str) -> None:
    if size > MAX_FRAME_SIZE_BYTES:
        raise ConnectionError(
            f"{direction} frame too large: {size} bytes "
            f"(max {MAX_FRAME_SIZE_BYTES} bytes)."
        )


def open_pipe():
    return win32file.CreateFile(
        PIPE_NAME,
        win32file.GENERIC_READ | win32file.GENERIC_WRITE,
        0,
        None,
        win32file.OPEN_EXISTING,
        0,
        None,
    )


class RelayHandler(socketserver.BaseRequestHandler):
    """Relay one TCP client connection to one persistent CE pipe connection."""

    pipe_handle = None

    def setup(self) -> None:
        self.pipe_handle = None
        self.request.setsockopt(socket.IPPROTO_TCP, socket.TCP_NODELAY, 1)

    def handle(self) -> None:
        peer = f"{self.client_address[0]}:{self.client_address[1]}"
        print(f"[relay] TCP client connected: {peer}", file=sys.stderr, flush=True)
        try:
            self.pipe_handle = open_pipe()
            while True:
                req_header = read_socket_exact(self.request, 4)
                if req_header is None:
                    break
                req_len = struct.unpack("<I", req_header)[0]
                validate_frame_size(req_len, "request")
                req_body = read_socket_exact(self.request, req_len)
                if req_body is None:
                    raise ConnectionError("TCP client disconnected before request body.")

                win32file.WriteFile(self.pipe_handle, req_header)
                win32file.WriteFile(self.pipe_handle, req_body)

                resp_header = read_pipe_exact(self.pipe_handle, 4)
                resp_len = struct.unpack("<I", resp_header)[0]
                validate_frame_size(resp_len, "response")
                resp_body = read_pipe_exact(self.pipe_handle, resp_len)
                self.request.sendall(resp_header + resp_body)
        except pywintypes.error as exc:
            print(f"[relay] Windows pipe error for {peer}: {exc}", file=sys.stderr, flush=True)
        except (ConnectionError, OSError) as exc:
            print(f"[relay] Connection ended for {peer}: {exc}", file=sys.stderr, flush=True)
        finally:
            self._close_pipe()
            print(f"[relay] TCP client disconnected: {peer}", file=sys.stderr, flush=True)

    def _close_pipe(self) -> None:
        if self.pipe_handle is None:
            return
        try:
            win32file.CloseHandle(self.pipe_handle)
        except pywintypes.error:
            pass
        finally:
            self.pipe_handle = None


class RelayServer(socketserver.TCPServer):
    allow_reuse_address = True


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Relay TCP frames to the Cheat Engine MCP Windows named pipe."
    )
    parser.add_argument("--host", default=DEFAULT_HOST, help=f"TCP bind host (default: {DEFAULT_HOST})")
    parser.add_argument("--port", type=int, default=DEFAULT_PORT, help=f"TCP bind port (default: {DEFAULT_PORT})")
    parser.add_argument("--pipe", default=PIPE_NAME, help=f"Named pipe path (default: {PIPE_NAME})")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    if not 1 <= args.port <= 65535:
        print("--port must be between 1 and 65535.", file=sys.stderr)
        return 2

    global PIPE_NAME
    PIPE_NAME = args.pipe

    print(
        f"[relay] Listening on {args.host}:{args.port}; forwarding to {PIPE_NAME}",
        file=sys.stderr,
        flush=True,
    )
    if args.host not in {"127.0.0.1", "localhost", "::1"}:
        print(
            "[relay] WARNING: non-loopback bind exposes Cheat Engine control to the network.",
            file=sys.stderr,
            flush=True,
        )

    with RelayServer((args.host, args.port), RelayHandler) as server:
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            print("\n[relay] Stopping.", file=sys.stderr, flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
