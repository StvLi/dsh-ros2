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
from .server import UdsServer


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

    print("")
    if failures:
        print("SELFTEST FAILED: " + ", ".join(failures))
        return 1
    print("SELFTEST PASSED (10 scenarios)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
