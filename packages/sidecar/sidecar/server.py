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
import stat
import threading
from typing import Callable, Optional

from .core import Cache

OTHERS_WRITE = 0o022
STICKY = 0o1000


class SidecarSocketError(Exception):
    """The configured socket coordinate cannot be proven safe to bind."""

    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code
        self.message = message


def _load_private_paths():
    """The shared owner-private criterion (`packages/common/scripts/private_paths.py`).

    Loaded by path like the other Python helpers in this family. Deliberately not
    a silent fallback: if the criterion disappears, `$HOME` deployments would
    stop being judged, so this fails loudly instead.
    """
    import importlib.util

    here = os.path.dirname(os.path.abspath(__file__))          # <…>/sidecar/sidecar
    packages_root = os.path.dirname(os.path.dirname(here))     # <…>/packages or <…>/node_modules
    candidates = [
        os.path.join(packages_root, "common", "scripts", "private_paths.py"),
        os.path.join(packages_root, "dsh-ros2-common", "scripts", "private_paths.py"),
        here,
    ]
    for candidate in candidates:
        if os.path.isfile(candidate):
            spec = importlib.util.spec_from_file_location("private_paths", candidate)
            if spec is None or spec.loader is None:  # pragma: no cover
                continue
            module = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(module)
            return module
    raise ImportError("private_paths.py not found (looked in: %s)" % ", ".join(candidates))


def judge_bind_dir(sock_path: str, uid: Optional[int] = None) -> str:
    """Prove the DIRECTORY the socket will be created in is safe to bind in.

    This is the server half of the criterion the TypeScript client applies to the
    same path (`packages/common/src/local-socket.ts`). Round 27 measured why both
    halves are needed: a socket at a predictable path in a shared directory is
    first-come-first-served, so *both* ends must be able to say who owns the
    coordinate. A server that binds into a directory anyone can write is
    equally wrong — the inode can be unlinked and replaced at will.

    Rules, in this order:

      * below `$HOME` → the shared owner-private criterion
        (`private_paths.ensure_private_dir`), which CREATES missing levels 0700
        and tightens our own wide ones;
      * anywhere else (e.g. `/tmp`) → the directory must already exist, must not
        be a symlink, and must be either ours-and-not-group/other-writable or
        sticky. Sticky is what makes the temp root usable: another user cannot
        unlink our socket there, so the check-then-bind window stays shut.

    Returns the resolved directory; raises `SidecarSocketError` otherwise.
    """
    target = os.path.abspath(os.path.expanduser(sock_path))
    directory = os.path.dirname(target)
    if not directory:  # pragma: no cover - a relative socket path with no dir
        raise SidecarSocketError("SOCK_NO_DIR", "socket path has no directory: %s" % sock_path)
    if uid is None:
        uid = os.getuid() if hasattr(os, "getuid") else None
    if uid is None:
        raise SidecarSocketError("SOCK_NO_UID", "cannot verify ownership on this platform")

    home = os.path.abspath(os.path.expanduser("~"))
    rel = os.path.relpath(os.path.abspath(directory), home)
    inside_home = rel != os.pardir and not rel.startswith(os.pardir + os.sep) and not os.path.isabs(rel)

    def refuse(code, why):
        return SidecarSocketError(code, "refusing to create the sidecar socket %s: %s" % (target, why))

    if inside_home:
        private_paths = _load_private_paths()
        try:
            private_paths.ensure_private_dir(directory, label="sidecar socket 目录", uid=uid, anchor=home)
        except private_paths.PrivatePathError as error:
            raise refuse(error.code, error.message)
        return directory

    try:
        info = os.lstat(directory)
    except OSError as error:
        raise refuse("SOCK_DIR_MISSING",
                     "its directory does not exist (%s); create it owner-only or use a path under $HOME" % error)
    if stat.S_ISLNK(info.st_mode):
        raise refuse("SOCK_DIR_SYMLINK", "its directory is a symlink")
    if not stat.S_ISDIR(info.st_mode):
        raise refuse("SOCK_DIR_NOT_DIR", "its directory is not a directory")
    if (info.st_mode & OTHERS_WRITE) != 0 and (info.st_mode & STICKY) == 0:
        raise refuse("SOCK_DIR_SHARED",
                     "its directory is group/other-writable and not sticky, so anyone could replace the socket")
    return directory


def prepare_socket_path(sock_path: str, uid: Optional[int] = None) -> str:
    """Return the path to bind, removing only a leftover that is OURS.

    A pre-existing path is not a detail to skip over: `os.unlink` on someone
    else's socket (or on a directory) is either refused by the kernel or — in a
    shared directory — a way to make the sidecar look like it started while the
    client talks to whoever actually owns the inode. So the existing inode is
    judged before it is removed:

      * a symlink is removed (unlink does not follow it);
      * our own socket / regular file is removed (a stale run);
      * another user's socket, or anything else, is a refusal.
    """
    target = os.path.abspath(os.path.expanduser(sock_path))
    if uid is None:
        uid = os.getuid() if hasattr(os, "getuid") else None
    try:
        info = os.lstat(target)
    except FileNotFoundError:
        return target

    def refuse(code, why):
        return SidecarSocketError(code, "refusing to replace %s: %s" % (target, why))

    if stat.S_ISDIR(info.st_mode):
        raise refuse("SOCK_IS_DIR", "it is a directory")
    if not stat.S_ISLNK(info.st_mode):
        if uid is not None and info.st_uid != uid:
            raise refuse("SOCK_NOT_OURS", "it is owned by uid %d, not you (uid %d)" % (info.st_uid, uid))
        if not (stat.S_ISSOCK(info.st_mode) or stat.S_ISREG(info.st_mode)):
            raise refuse("SOCK_NOT_OURS", "it is not a socket or a stale file")
    try:
        os.unlink(target)
    except OSError as error:
        raise refuse("SOCK_UNLINK_FAILED", "%s" % error)
    return target


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
        # Order matters. The directory is judged FIRST (creating it 0700 under
        # $HOME), then the existing inode is judged (only OUR stale socket may be
        # removed), then bind happens under a 0o077 umask so the inode is never
        # born connectable by another user — the previous code chmod'ed after
        # `bind`, which leaves a window that the umask closes for free.
        path_ = os.path.abspath(os.path.expanduser(self.sock_path))
        judge_bind_dir(path_)
        prepare_socket_path(path_)
        srv = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        saved = os.umask(0o077)
        try:
            srv.bind(path_)
        finally:
            os.umask(saved)
        # Judge what was actually created, then tighten explicitly: umask is a
        # ceiling, and a platform whose default differs still ends up owner-only.
        bound = os.lstat(path_)
        if not stat.S_ISSOCK(bound.st_mode):
            srv.close()
            raise SidecarSocketError("SOCK_NOT_SOCKET", "bind did not produce a socket at %s" % path_)
        try:
            os.chmod(path_, 0o600)
        except OSError:
            pass
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
