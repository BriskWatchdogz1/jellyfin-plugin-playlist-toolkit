"""Tiny WebSocket client (standard library only) for reading server messages in tests."""
import base64
import json
import os
import socket
import struct
import urllib.parse


class WebSocket:
    def __init__(self, base_url, path):
        url = urllib.parse.urlparse(base_url)
        self.sock = socket.create_connection((url.hostname, url.port or 80), timeout=10)
        key = base64.b64encode(os.urandom(16)).decode()
        request = (
            f"GET {path} HTTP/1.1\r\nHost: {url.hostname}:{url.port or 80}\r\nUpgrade: websocket\r\n"
            f"Connection: Upgrade\r\nSec-WebSocket-Key: {key}\r\nSec-WebSocket-Version: 13\r\n\r\n")
        self.sock.sendall(request.encode())
        response = b""
        while b"\r\n\r\n" not in response:
            chunk = self.sock.recv(4096)
            if not chunk:
                raise ConnectionError("handshake failed")
            response += chunk
        head, _, rest = response.partition(b"\r\n\r\n")
        if b" 101 " not in head.split(b"\r\n")[0]:
            raise ConnectionError(head.decode(errors="replace"))
        self.buffer = rest

    def _read(self, n):
        while len(self.buffer) < n:
            chunk = self.sock.recv(65536)
            if not chunk:
                raise ConnectionError("closed")
            self.buffer += chunk
        data, self.buffer = self.buffer[:n], self.buffer[n:]
        return data

    def _send(self, opcode, payload=b""):
        mask = os.urandom(4)
        header = bytes([0x80 | opcode])
        length = len(payload)
        if length < 126:
            header += bytes([0x80 | length])
        elif length < 65536:
            header += bytes([0x80 | 126]) + struct.pack(">H", length)
        else:
            header += bytes([0x80 | 127]) + struct.pack(">Q", length)
        masked = bytes(b ^ mask[i % 4] for i, b in enumerate(payload))
        self.sock.sendall(header + mask + masked)

    def receive_json(self, timeout=10):
        """Returns the next text message as parsed JSON (answers pings, skips other frames)."""
        self.sock.settimeout(timeout)
        message = b""
        while True:
            b1, b2 = self._read(2)
            opcode = b1 & 0x0F
            length = b2 & 0x7F
            if length == 126:
                length = struct.unpack(">H", self._read(2))[0]
            elif length == 127:
                length = struct.unpack(">Q", self._read(8))[0]
            payload = self._read(length)
            if opcode == 0x9:
                self._send(0xA, payload)
                continue
            if opcode == 0x8:
                raise ConnectionError("closed by server")
            if opcode in (0x1, 0x0):
                message += payload
                if b1 & 0x80:
                    return json.loads(message.decode("utf-8"))

    def wait_for(self, message_type, timeout=10):
        while True:
            message = self.receive_json(timeout)
            if message.get("MessageType") == message_type:
                return message

    def close(self):
        try:
            self._send(0x8)
        finally:
            self.sock.close()
