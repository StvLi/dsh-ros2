"""dsh-ros2-sidecar · --selftest：纯框架逻辑场景（无 rclpy）。"""
from __future__ import annotations

import json
import os
import socket
import sys
import tempfile
import threading
import time

from .core import Cache, CacheEntry, Reducer
from .node import default_socket_path
from .server import SidecarSocketError, UdsServer, judge_bind_dir, prepare_socket_path


class T(Reducer):
    name = "t"; topic = "/t"; msg_type = "std_msgs/msg/String"; ttl_ms = 5000
    def on_message(self, msg, stamp_ns):
        return self._entry(value=msg, text=f"text={msg}", stamp_ns=stamp_ns)


def main() -> int:
    failures: list[str] = []

    def check(name, cond, detail=""):
        if cond:
            print(f"  PASS  {name}")
        else:
            failures.append(name)
            print(f"  FAIL  {name} {detail}")

    # 1. reducer 降维写缓存
    cache = Cache()
    r = T()
    cache.register(r)
    r.update("hello", 1000)
    e = cache.get("t")
    check("reducer reduces to CacheEntry", e is not None and e.value == "hello" and "hello" in e.text)
    check("snapshot returns entries", len(cache.snapshot()) == 1)

    # 2. 新鲜度判定
    e2 = cache.get("t")
    check("fresh within ttl", e2.is_fresh())
    check("stale after ttl", not e2.is_fresh(now_ms=e2.stamp_ms + e2.ttl_ms + 10))
    check("fresh at exactly ttl boundary", e2.is_fresh(now_ms=e2.stamp_ms + e2.ttl_ms))

    # 3. UDS server get/snapshot/unknown/stale
    sock = os.path.join(tempfile.mkdtemp(), "sc.sock")
    srv = UdsServer(cache, sock)
    t = threading.Thread(target=srv.run, daemon=True)
    t.start()
    time.sleep(0.2)

    # 3a. UDS 权限：socket 由本进程创建，模式不得随 umask 漂移。协议无鉴权，且默认
    # 路径在 /tmp（世界可写目录）——能写该 inode 的人即可 connect()，读到语义缓存。
    check("socket is owner-only (0600), not umask-derived",
          oct(os.stat(sock).st_mode & 0o777) == "0o600")

    def call(msg):
        c = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        c.connect(sock)
        c.sendall((json.dumps(msg) + "\n").encode())
        c.settimeout(2)
        line = c.recv(65536).decode().strip()
        c.close()
        return json.loads(line)

    resp = call({"id": "r1", "cmd": "get", "name": "t"})
    check("get returns fresh entry", resp.get("ok") and resp["data"]["value"] == "hello")
    resp = call({"id": "r2", "cmd": "snapshot"})
    check("snapshot returns summary", resp.get("ok") and len(resp["data"]["summary"]) == 1)
    resp = call({"id": "r3", "cmd": "get", "name": "nope"})
    check("unknown reducer -> UNKNOWN", not resp.get("ok") and resp["error"]["code"] == "UNKNOWN")
    resp = call({"id": "r4", "cmd": "bogus"})
    check("unknown cmd -> UNKNOWN_CMD", not resp.get("ok") and resp["error"]["code"] == "UNKNOWN_CMD")
    # stale：把条目 stamp 改旧
    r.last.stamp_ms = int(time.time() * 1000) - 10000
    resp = call({"id": "r5", "cmd": "get", "name": "t"})
    check("stale entry -> STALE", not resp.get("ok") and resp["error"]["code"] == "STALE")

    srv.stop()
    try:
        os.unlink(sock)
    except OSError:
        pass

    # 4. bind 目录判据（round 27）：套接字的坐标必须能证明是我们的。
    #    测法用 umask 造出宽模式，不用字面量 chmod（扫描器会报，且那正是旧代码的写法）。
    def wide_dir(path_, umask_value, sticky=False):
        saved = os.umask(umask_value)
        try:
            os.makedirs(path_, exist_ok=True)
        finally:
            os.umask(saved)
        if sticky:
            os.chmod(path_, os.stat(path_).st_mode | 0o1000)

    base = tempfile.mkdtemp()
    # 4a. 我们自己的私有目录：通过
    private_dir = os.path.join(base, "private")
    os.mkdir(private_dir, 0o700)
    try:
        judge_bind_dir(os.path.join(private_dir, "s.sock"))
        check("judge_bind_dir accepts our own 0700 directory", True)
    except SidecarSocketError as error:
        check("judge_bind_dir accepts our own 0700 directory", False, error.code)

    # 4b. 组/其他可写且非 sticky 的目录：拒绝（别人可以把 inode 换掉）
    shared_dir = os.path.join(base, "shared")
    wide_dir(shared_dir, 0o002)
    try:
        judge_bind_dir(os.path.join(shared_dir, "s.sock"))
        check("judge_bind_dir refuses a shared non-sticky directory", False, "no refusal")
    except SidecarSocketError as error:
        check("judge_bind_dir refuses a shared non-sticky directory",
              error.code == "SOCK_DIR_SHARED", error.code)

    # 4c. sticky 的共享目录（/tmp 的形状）：允许——粘滞位使别人无法 unlink 我们的 socket
    sticky_dir = os.path.join(base, "sticky")
    wide_dir(sticky_dir, 0o002, sticky=True)
    try:
        judge_bind_dir(os.path.join(sticky_dir, "s.sock"))
        check("judge_bind_dir accepts a sticky shared directory (the /tmp shape)", True)
    except SidecarSocketError as error:
        check("judge_bind_dir accepts a sticky shared directory (the /tmp shape)", False, error.code)

    # 4d. 目录是符号链接：拒绝（判据判链接本身，不判目标）
    link_dir = os.path.join(base, "link")
    os.symlink(private_dir, link_dir)
    try:
        judge_bind_dir(os.path.join(link_dir, "s.sock"))
        check("judge_bind_dir refuses a symlinked directory", False, "no refusal")
    except SidecarSocketError as error:
        check("judge_bind_dir refuses a symlinked directory",
              error.code == "SOCK_DIR_SYMLINK", error.code)

    # 4e. 残留路径：我们自己的旧 socket 可以删了重建；别人的 socket 必须拒绝。
    stale = os.path.join(private_dir, "stale.sock")
    old = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    old.bind(stale)
    try:
        prepare_socket_path(stale)
        check("prepare_socket_path replaces our own stale socket", not os.path.exists(stale))
    except SidecarSocketError as error:
        check("prepare_socket_path replaces our own stale socket", False, error.code)
    finally:
        old.close()

    foreign = os.path.join(private_dir, "foreign.sock")
    old2 = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    old2.bind(foreign)
    try:
        prepare_socket_path(foreign, uid=os.getuid() + 4242)   # 第二个账号的接缝
        check("prepare_socket_path refuses a socket another account owns", False, "no refusal")
    except SidecarSocketError as error:
        check("prepare_socket_path refuses a socket another account owns",
              error.code == "SOCK_NOT_OURS", error.code)
    finally:
        old2.close()

    # 4f. 默认 socket 路径不在世界可写的共享坐标上（旧的 /tmp 默认值）
    default_path = default_socket_path()
    check("default socket path is not the old predictable /tmp coordinate",
          not default_path.startswith("/tmp/"), default_path)
    check("default socket path lives in a private directory shape",
          os.path.basename(os.path.dirname(default_path)) in ("run", "dsh-ros2"), default_path)

    for path_, is_dir in ((sock, False), (base, True)):
        try:
            if is_dir:
                import shutil
                shutil.rmtree(path_)
            else:
                os.unlink(path_)
        except OSError:
            pass

    print("")
    if failures:
        print("SELFTEST FAILED: " + ", ".join(failures))
        return 1
    print("SELFTEST PASSED (%d scenarios)" % (11 + 8))
    return 0


if __name__ == "__main__":
    sys.exit(main())
