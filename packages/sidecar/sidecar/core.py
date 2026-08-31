"""dsh-ros2-sidecar · 核心框架（纯逻辑，无 rclpy）。

Reducer = "一个话题 → 一条语义缓存" 的降维单元。框架只负责：
  - 注册 reducer、按名字/话题调度；
  - 写缓存：`value`（结构化/布尔，给确定性逻辑）与 `text`（一句话语义，给 LLM）；
  - `get` / `snapshot`（含新鲜度 STALE 判定）。
具体降维逻辑由子类 `on_message` 实现——本骨架仅占位（示例后补）。
"""
from __future__ import annotations

import time
from dataclasses import dataclass
from typing import Any


@dataclass
class CacheEntry:
    """一条降维后的语义缓存。"""
    name: str
    value: Any
    text: str
    stamp_ms: int        # 最近一次更新（unix ms，宿主时钟）
    stamp_ns: int        # ROS2 快照原始时间戳（data plane 权威）
    ttl_ms: int          # 新鲜度上限（<=0 表示不过期）

    def is_fresh(self, now_ms: int | None = None) -> bool:
        n = int(time.time() * 1000) if now_ms is None else now_ms
        return self.ttl_ms <= 0 or (n - self.stamp_ms) <= self.ttl_ms

    def to_dict(self) -> dict:
        return {"name": self.name, "value": self.value, "text": self.text,
                "stamp_ms": self.stamp_ms, "ttl_ms": self.ttl_ms}


class Reducer:
    """降维单元基类（模板）。子类覆盖 `on_message` 得到具体的话题→语义。

    约定：
      - `name` 全局唯一（Agent/插件用它查询）；
      - `topic` / `msg_type` 供 rclpy 订阅；`qos` = sensor|reliable|transient_local；
      - `on_message(msg, stamp_ns)` 返回一个 `CacheEntry`（value + text 一致性由此保证）。
    """
    name = "placeholder"
    topic = ""            # 例: /scan
    msg_type = ""         # 例: sensor_msgs/msg/LaserScan
    qos = "sensor"
    ttl_ms = 250          # 默认新鲜度；子类按话题速率设置（如 /camera 30Hz → 50ms）

    def __init__(self) -> None:
        self.last: CacheEntry | None = None

    def on_message(self, msg, stamp_ns: int) -> CacheEntry:
        raise NotImplementedError

    def update(self, msg, stamp_ns: int) -> CacheEntry:
        """由框架（node）在收到话题消息时调用。异常只记日志，保留旧缓存（fail-closed 友好）。"""
        entry = self.on_message(msg, stamp_ns)
        self.last = entry
        return entry

    def get(self) -> CacheEntry | None:
        return self.last

    def _entry(self, value: Any, text: str, stamp_ns: int) -> CacheEntry:
        return CacheEntry(self.name, value, text,
                          stamp_ms=int(time.time() * 1000), stamp_ns=stamp_ns, ttl_ms=self.ttl_ms)


class Cache:
    """reducer 注册表 + 最新缓存索引。"""
    def __init__(self) -> None:
        self._reducers: dict[str, Reducer] = {}

    def register(self, reducer: Reducer) -> None:
        self._reducers[reducer.name] = reducer

    def get(self, name: str) -> CacheEntry | None:
        r = self._reducers.get(name)
        return r.get() if r else None

    def snapshot(self) -> list[CacheEntry]:
        return [r.get() for r in self._reducers.values() if r.get() is not None]

    def names(self) -> list[str]:
        return list(self._reducers.keys())
