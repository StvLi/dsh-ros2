"""dsh-ros2-sidecar · UDS newline-JSON server（控制面板长连接）。

协议（单行 JSON，`\\n` 结尾，`request_id` 保证并发）：
  插件 →   { "id","cmd":"get|snapshot|subscribe","name"?, ... }
  插件 ←   { "id","ok", "data"? } | { "id","ok":false, "error":{"code","message"} }
           { "type":"heartbeat" } | { "type":"event","name",... }
"""
from __future__ import annotations

import json
import os
import socket
import threading
from typing import Callable, Optional

from .core import Cache


class UdsServer:
    def __init__(self, cache: Cache, sock_path: str,
                 heartbeat_s: float = 1.0,
                 event_pusher: Optional[Callable[[str, dict], None]] = None):
        self.cache = cache
        self.sock_path = sock_path
        self.heartbeat_s = heartbeat_s
        self.event_pusher = event_pusher   # subscribe 订阅者推送回调（可为 None）
        self._stop = threading.Event()

    # -- 协议分派 ---------------------------------------------------------
    def _dispatch(self, msg: dict) -> dict:
        cmd = msg.get("cmd")
        rid = msg.get("id")
        if cmd == "get":
            name = msg.get("name")
            entry = self.cache.get(name)
            if entry is None:
                return {"id": rid, "ok": False, "error": {"code": "UNKNOWN", "message": f"unknown reducer: {name}"}}
            if not entry.is_fresh():
                return {"id": rid, "ok": False, "error": {"code": "STALE", "message": f"{name} stale", "data": entry.to_dict()}}
            return {"id": rid, "ok": True, "data": entry.to_dict()}
        if cmd == "snapshot":
            return {"id": rid, "ok": True, "data": {"summary": [e.to_dict() for e in self.cache.snapshot()]}}
        if cmd == "subscribe":
            if self.event_pusher:
                return {"id": rid, "ok": True, "data": {"subscribed": True}}
            return {"id": rid, "ok": False, "error": {"code": "NO_EVENTS", "message": "无事件通道"}}
        return {"id": rid, "ok": False, "error": {"code": "UNKNOWN_CMD", "message": f"cmd: {cmd}"}}

    # -- 连接处理 ---------------------------------------------------------
    def _handle(self, conn: socket.socket) -> None:
        buf = b""
        while not self._stop.is_set():
            try:
                data = conn.recv(65536)
            except OSError:
                break
            if not data:
                break
            buf += data
            while b"\n" in buf:
                line, buf = buf.split(b"\n", 1)
                line = line.strip()
                if not line:
                    continue
                msg = {}
                try:
                    msg = json.loads(line)
                    resp = self._dispatch(msg)
                except Exception as e:  # noqa: BLE001
                    resp = {"id": msg.get("id"), "ok": False,
                            "error": {"code": "BAD_REQUEST", "message": str(e)}}
                try:
                    conn.sendall((json.dumps(resp, ensure_ascii=False) + "\n").encode())
                except OSError:
                    return
        try:
            conn.close()
        except OSError:
            pass

    def serve(self) -> None:
        try:
            os.unlink(self.sock_path)
        except FileNotFoundError:
            pass
        srv = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        srv.bind(self.sock_path)
        srv.listen(8)
        try:
            while not self._stop.is_set():
                try:
                    conn, _ = srv.accept()
                except OSError:
                    break
                threading.Thread(target=self._handle, args=(conn,), daemon=True).start()
        finally:
            try:
                srv.close()
            except OSError:
                pass

    def run(self) -> None:
        self.serve()

    def stop(self) -> None:
        self._stop.set()
