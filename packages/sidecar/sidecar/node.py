"""dsh-ros2-sidecar · rclpy 节点包装（骨架）。

职责：为每个已注册 reducer 创建话题订阅（rclpy），把每帧消息喂给
`Reducer.update` 写缓存；同时后台线程跑 UDS server（控制面板长连接）。

用法（构建进 colcon workspace 后）：
    ros2 run dsh_ros2_sidecar sidecar_node --sock /tmp/dsh-ros2-sidecar.sock

框架：
    from dsh_ros2_sidecar.core import Cache
    from dsh_ros2_sidecar.reducers_placeholder import PlaceholderReducer
    cache = Cache(); cache.register(PlaceholderReducer())
    # 后续按需 register 更多 reducer；node 遍历 cache.names() 建订阅。
"""
from __future__ import annotations

import argparse
import threading

from .core import Cache
from .server import UdsServer

DEFAULT_SOCK = "/tmp/dsh-ros2-sidecar.sock"


def build_default_cache() -> Cache:
    """注册框架占位 reducer；后续在模块级追加真实 reducer。"""
    from .reducers_placeholder import PlaceholderReducer
    cache = Cache()
    cache.register(PlaceholderReducer())
    return cache


def run(cache: Cache, sock: str) -> None:
    """启动（骨架）：先跑纯 UDS server；rclpy 订阅部分在真实节点中接入。

    说明：为让骨架无 ROS2 依赖也能 self-test/演示，这里默认只起 server。
    真实运行时由 rclpy 节点调 `register_topics(cache, node)` 建订阅。"""
    server = UdsServer(cache, sock)
    server.run()


def register_topics(cache: Cache, node) -> None:
    """骨架：为每个 reducer 建 rclpy 订阅（真实节点接入用）。"""
    # 选择消息类需按 msg_type 动态 import；此处用 rclpy 的泛型订阅留待实现。
    # 每个 reducer: node.create_subscription(msg_cls, reducer.topic, lambda m, r=reducer, n=None: red_update(r, m), qos)
    raise NotImplementedError("真实 rclpy 订阅接入（见 docs/sidecar-design.md）")


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="dsh-ros2-sidecar 数据平面框架（骨架）")
    ap.add_argument("--sock", default=DEFAULT_SOCK)
    ap.add_argument("--selftest", action="store_true")
    ap.add_argument("--serve", action="store_true", help="run the UDS server (no rclpy)")
    args = ap.parse_args(argv)
    if args.selftest:
        from .selftest import main as selftest
        return selftest()
    if args.serve:
        run(build_default_cache(), args.sock)
        return 0
    # 真实节点：需要 rclpy + workspace；骨架默认做自测，避免无 ROS2 环境崩溃
    ap.print_help()
    return 0


if __name__ == "__main__":
    import sys
    sys.exit(main())
