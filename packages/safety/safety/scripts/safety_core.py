#!/usr/bin/env python3
"""Pure safety logic for the dsh-ros2 safety framework (no rclpy).

This module is deliberately ROS2-free so the state machine, checkers and
hysteresis can be unit-tested without a running system: `--selftest` runs
fault-injection scenarios and exits non-zero on any failure. The rclpy node
`safety_monitor` wraps it and only bridges ROS2 topics/services <-> these
pure objects.

Contract: docs/safety-handover.md — profile `safety` section schema (§4.1),
cause taxonomy (§4.7), severity rules (§6).
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
from collections import deque
from threading import Lock
from typing import Any, Dict, List, Optional, Tuple

# ---------------------------------------------------------------------------
# Constants (single source of truth for the preset strings)
# ---------------------------------------------------------------------------

STATE_NORMAL = "NORMAL"
STATE_LOCKED = "LOCKED"

SEVERITY_OK = "OK"
SEVERITY_WARNING = "WARNING"
SEVERITY_CRITICAL = "CRITICAL"

# Preset trigger-cause strings (docs/safety-handover.md §4.7).
CAUSE_PLAN_CHANGE = "plan_change"
CAUSE_TRACKING_ERROR = "tracking_error"
CAUSE_STALL = "stall"
CAUSE_FEEDBACK_LOSS = "feedback_loss"
CAUSE_WATCHDOG_CRITICAL = "watchdog_critical"
CAUSE_WATCHDOG_OBSERVED = "watchdog_observed"
CAUSE_TORQUE_SPIKE = "torque_spike"
CAUSE_TORQUE_OVERLOAD = "torque_overload"
CAUSE_SEMANTIC_UNSAFE = "semantic_unsafe"

ALL_CAUSES = (
    CAUSE_PLAN_CHANGE, CAUSE_TRACKING_ERROR, CAUSE_STALL, CAUSE_FEEDBACK_LOSS,
    CAUSE_WATCHDOG_CRITICAL, CAUSE_WATCHDOG_OBSERVED, CAUSE_TORQUE_SPIKE,
    CAUSE_TORQUE_OVERLOAD, CAUSE_SEMANTIC_UNSAFE,
)

# Causes that latch the robot into LOCKED (all CRITICAL).
LOCKING_CAUSES = frozenset((
    CAUSE_TRACKING_ERROR, CAUSE_STALL, CAUSE_FEEDBACK_LOSS,
    CAUSE_WATCHDOG_CRITICAL, CAUSE_TORQUE_SPIKE, CAUSE_TORQUE_OVERLOAD,
    CAUSE_SEMANTIC_UNSAFE,
))

# Chinese labels injected into the VLM arbitration prompt.
CAUSE_LABELS = {
    CAUSE_PLAN_CHANGE: "任务方案整体变更",
    CAUSE_TRACKING_ERROR: "轨迹跟踪偏差超限",
    CAUSE_STALL: "堵转（有指令无运动）",
    CAUSE_FEEDBACK_LOSS: "关节反馈丢失",
    CAUSE_WATCHDOG_CRITICAL: "关键节点/话题掉线",
    CAUSE_WATCHDOG_OBSERVED: "非关键节点掉线（仅提示）",
    CAUSE_TORQUE_SPIKE: "力矩突变",
    CAUSE_TORQUE_OVERLOAD: "力矩持续超限",
    CAUSE_SEMANTIC_UNSAFE: "VLM 语义复核判定危险",
}


class SafetyEvent:
    __slots__ = ("cause", "severity", "detail", "stamp_ms")

    def __init__(self, cause: str, severity: str, detail: str, stamp_ms: int):
        self.cause = cause
        self.severity = severity
        self.detail = detail
        self.stamp_ms = stamp_ms

    def as_dict(self) -> dict:
        return {"cause": self.cause, "severity": self.severity,
                "detail": self.detail, "stamp_ms": self.stamp_ms}


class Hysteresis:
    """M-of-K trigger: fires only when >= min_hits of the last `window`
    samples are hits, so a single noisy frame never locks the robot."""

    def __init__(self, min_hits: int = 3, window: int = 5):
        self.min_hits = max(1, int(min_hits))
        self.window = max(self.min_hits, int(window))
        self._hits: deque = deque(maxlen=self.window)

    def record(self, hit: bool) -> bool:
        self._hits.append(bool(hit))
        if len(self._hits) < self.min_hits:
            return False
        return sum(self._hits) >= self.min_hits

    def reset(self) -> None:
        self._hits.clear()


class RingBuffer:
    """Pre-trigger forensics: fixed-size ring of joint/torque snapshots.
    Dumped to JSON when a CRITICAL event latches the robot, for post-hoc
    and VLM-assisted diagnosis."""

    def __init__(self, maxlen: int = 200):
        self._buf: deque = deque(maxlen=max(maxlen, 10))

    def push(self, entry: dict) -> None:
        self._buf.append(entry)

    def snapshot(self) -> List[dict]:
        return list(self._buf)

    def dump(self, dump_dir: str, cause: str, extra: Optional[dict] = None) -> str:
        os.makedirs(dump_dir, exist_ok=True)
        name = "{}_{}.json".format(time.strftime("%Y%m%dT%H%M%S"), cause)
        path = os.path.join(dump_dir, name)
        payload = {"cause": cause, "dumped_at_ms": int(time.time() * 1000),
                   "samples": self.snapshot(), **(extra or {})}
        with open(path, "w") as f:
            json.dump(payload, f, ensure_ascii=False, indent=2)
        return path


class LatchState:
    """Latched NORMAL/LOCKED state machine.

    A CRITICAL event latches LOCKED; the condition clearing does NOT
    auto-reset (latch semantics — the robot must not resume into the same
    danger). Only an explicit human-gated unlock returns to NORMAL.
    """

    def __init__(self) -> None:
        self.state = STATE_NORMAL
        self.severity = SEVERITY_OK
        self.cause = ""
        self.detail = ""
        self.stamp_ms = 0
        self.trigger_count = 0

    def trigger(self, cause: str, severity: str, detail: str, stamp_ms: int) -> bool:
        """Record an event. Returns True only when the state *transitions*
        into LOCKED (the caller then fires the lock action exactly once)."""
        if severity == SEVERITY_CRITICAL and cause in LOCKING_CAUSES:
            self.state = STATE_LOCKED
            self.severity = SEVERITY_CRITICAL
            self.cause = cause
            self.detail = detail
            self.stamp_ms = stamp_ms
            self.trigger_count += 1
            return True
        # WARNING or non-locking cause: keep the current latch (sticky) but
        # remember the newest event detail for diagnosis.
        if self.state == STATE_LOCKED:
            self.cause = cause
            self.detail = detail
            self.stamp_ms = stamp_ms
        return False

    def set_lock(self, cause: str, detail: str, stamp_ms: int) -> bool:
        """Human-gated explicit lock (semantic layer / human judgment)."""
        self.state = STATE_LOCKED
        self.severity = SEVERITY_CRITICAL
        self.cause = cause
        self.detail = detail
        self.stamp_ms = stamp_ms
        self.trigger_count += 1
        return True

    def unlock(self, request_id: str, cause: str, stamp_ms: int) -> dict:
        if self.state != STATE_LOCKED:
            return {"accepted": False, "message": "机器人当前未锁死，无需解锁"}
        self.state = STATE_NORMAL
        self.severity = SEVERITY_OK
        self.cause = ""
        self.detail = "已解锁（request_id={}, cause={}）——建议先回 home 再恢复任务".format(request_id, cause)
        self.stamp_ms = stamp_ms
        return {"accepted": True, "message": "已解锁，回到 NORMAL"}

    def as_dict(self) -> dict:
        return {"state": self.state, "severity": self.severity,
                "cause": self.cause, "detail": self.detail, "stamp_ms": self.stamp_ms}


class FeedbackLossChecker:
    """Topic-silence detection: after the FIRST joint message, if no message
    arrives within timeout_ms the feedback is considered lost (CRITICAL)."""

    def __init__(self, timeout_ms: float = 100.0):
        self.timeout_ms = float(timeout_ms)
        self.last_seen_ms: Optional[float] = None

    def on_message(self, stamp_ms: float) -> None:
        self.last_seen_ms = float(stamp_ms)

    def check(self, now_ms: float) -> Optional[SafetyEvent]:
        if self.last_seen_ms is None:
            return None  # never seen a message: not (yet) a loss
        if now_ms - self.last_seen_ms > self.timeout_ms:
            gap = (now_ms - self.last_seen_ms) / 1000.0
            return SafetyEvent(CAUSE_FEEDBACK_LOSS, SEVERITY_CRITICAL,
                               "关节反馈静默 {:.1f}s（timeout {:.1f}s）".format(gap, self.timeout_ms / 1000.0),
                               int(now_ms))
        return None


class WatchdogChecker:
    """Liveness watchdog.

    * topic-liveness: each configured topic must produce a message within
      its timeout (fed by the node's slow scanner via on_activity).
    * node-liveness: critical/observed node names checked against periodic
      `ros2 node list` scans; a node is flagged down after 2 consecutive
      misses (avoids transient remap glitches).

    critical entries latch (CRITICAL); observed entries only warn — a
    non-primary process dropping must NOT lock the whole robot.
    """

    def __init__(self, critical_topics: Optional[List[dict]] = None,
                 observed_topics: Optional[List[dict]] = None,
                 critical_nodes: Optional[List[str]] = None,
                 observed_nodes: Optional[List[str]] = None,
                 node_down_misses: int = 2):
        self.critical_topics = {
            str(e.get("topic", "")): {"timeout_ms": float(e.get("timeout_ms", 1000.0)), "last_ms": None}
            for e in (critical_topics or []) if e.get("topic")}
        self.observed_topics = {
            str(e.get("topic", "")): {"timeout_ms": float(e.get("timeout_ms", 3000.0)), "last_ms": None}
            for e in (observed_topics or []) if e.get("topic")}
        self.critical_nodes = {n: {"misses": 0, "seen": True} for n in (critical_nodes or [])}
        self.observed_nodes = {n: {"misses": 0, "seen": True} for n in (observed_nodes or [])}
        self.node_down_misses = max(1, int(node_down_misses))

    def on_activity(self, topic: str, stamp_ms: float) -> None:
        if topic in self.critical_topics:
            self.critical_topics[topic]["last_ms"] = float(stamp_ms)
        if topic in self.observed_topics:
            self.observed_topics[topic]["last_ms"] = float(stamp_ms)

    def on_node_scan(self, alive_names, now_ms: float) -> List[SafetyEvent]:
        alive = set(alive_names)
        events: List[SafetyEvent] = []
        for node, spec in self.critical_nodes.items():
            if node in alive:
                spec["misses"] = 0
                spec["seen"] = True
            else:
                spec["misses"] += 1
                if spec["misses"] >= self.node_down_misses and spec["seen"]:
                    spec["seen"] = False
                    events.append(SafetyEvent(CAUSE_WATCHDOG_CRITICAL, SEVERITY_CRITICAL,
                                              "关键节点 {} 掉线（连续 {} 次扫描未见）".format(node, spec["misses"]),
                                              int(now_ms)))
        for node, spec in self.observed_nodes.items():
            if node in alive:
                spec["misses"] = 0
                spec["seen"] = True
            else:
                spec["misses"] += 1
                if spec["misses"] >= self.node_down_misses and spec["seen"]:
                    spec["seen"] = False
                    events.append(SafetyEvent(CAUSE_WATCHDOG_OBSERVED, SEVERITY_WARNING,
                                              "非关键节点 {} 掉线".format(node), int(now_ms)))
        return events

    def check(self, now_ms: float) -> List[SafetyEvent]:
        events: List[SafetyEvent] = []
        for topic, spec in self.critical_topics.items():
            if spec["last_ms"] is None:
                continue
            if now_ms - spec["last_ms"] > spec["timeout_ms"]:
                events.append(SafetyEvent(CAUSE_WATCHDOG_CRITICAL, SEVERITY_CRITICAL,
                                          "关键话题 {} 静默".format(topic), int(now_ms)))
        for topic, spec in self.observed_topics.items():
            if spec["last_ms"] is None:
                continue
            if now_ms - spec["last_ms"] > spec["timeout_ms"]:
                events.append(SafetyEvent(CAUSE_WATCHDOG_OBSERVED, SEVERITY_WARNING,
                                          "非关键话题 {} 静默".format(topic), int(now_ms)))
        return events


class MotionChecker:
    """Tracking-error + stall detection.

    Requires a commanded joint stream (profile `motion.command_topic`);
    without it these two checks stay disabled (feedback_loss and the
    watchdog still guard). Detection is non-blocking and runs inside the
    monitor's timer tick; the end-to-end response budget is <= 100 ms.
    """

    def __init__(self, tracking_error_rad: float = 0.05,
                 stall: Optional[dict] = None,
                 hysteresis: Optional[dict] = None):
        self.tracking_error_rad = float(tracking_error_rad)
        stall = stall or {}
        self.stall_min_cmd_vel = float(stall.get("min_cmd_vel", 0.02))
        self.stall_max_actual_vel = float(stall.get("max_actual_vel", 0.005))
        self.stall_window_ms = float(stall.get("window_ms", 200.0))
        h = hysteresis or {}
        self.tracking_hyst = Hysteresis(h.get("min_frames", 3), h.get("window", 5))
        self.stall_hyst = Hysteresis(2, 3)
        self._stall_cmd_buf: deque = deque()

    def update(self, actual: Dict[str, float], cmd: Optional[Dict[str, float]],
               actual_vel: Dict[str, float], cmd_vel: Dict[str, float],
               now_ms: float) -> List[SafetyEvent]:
        events: List[SafetyEvent] = []
        if cmd:
            max_err = 0.0
            worst = ""
            for j, c in cmd.items():
                a = actual.get(j)
                if a is None:
                    continue
                e = abs(a - c)
                if e > max_err:
                    max_err, worst = e, j
            if worst and max_err > self.tracking_error_rad:
                if self.tracking_hyst.record(True):
                    events.append(SafetyEvent(CAUSE_TRACKING_ERROR, SEVERITY_CRITICAL,
                                              "关节 {} 跟踪偏差 {:.3f} rad > {:.3f}（迟滞确认）".format(
                                                  worst, max_err, self.tracking_error_rad),
                                              int(now_ms)))
            else:
                self.tracking_hyst.record(False)
            # stall: commanded velocity present but actual ~0 over the window
            cmd_v = max((abs(cmd_vel.get(j, 0.0)) for j in cmd), default=0.0)
            self._stall_cmd_buf.append((float(now_ms), cmd_v))
            while self._stall_cmd_buf and now_ms - self._stall_cmd_buf[0][0] > self.stall_window_ms:
                self._stall_cmd_buf.popleft()
            avg_cmd = sum(v for _, v in self._stall_cmd_buf) / max(1, len(self._stall_cmd_buf))
            max_actual = max((abs(actual_vel.get(j, 0.0)) for j in cmd), default=0.0)
            stall_hit = avg_cmd >= self.stall_min_cmd_vel and max_actual <= self.stall_max_actual_vel
            if stall_hit and self.stall_hyst.record(True):
                events.append(SafetyEvent(CAUSE_STALL, SEVERITY_CRITICAL,
                                          "堵转：指令速度 {:.3f} rad/s 但实际 ≈{:.4f} rad/s".format(avg_cmd, max_actual),
                                          int(now_ms)))
            elif not stall_hit:
                self.stall_hyst.record(False)
        else:
            # no command stream: reset hysteresis so a command gap never
            # leaves stale pending triggers
            self.tracking_hyst.reset()
            self.stall_hyst.reset()
        return events


class TorqueChecker:
    """Optional torque monitor (active only when effort data is available).

    Detects sudden torque spikes (|dτ/dt| above per-joint dtau_limit, with a
    2-of-2 confirm) and sustained overload (|τ| above abs_limit for
    overload_ms).

    IMPLEMENTER NOTE (kept for future maintainers): after a hard collision
    some joints LOSE their signal — effort freezes at 0 or the topic stops —
    so the torque checks never fire for that event. That is expected: the
    feedback_loss checker and the watchdog are the backstop for that failure
    mode. See docs/safety-handover.md §4.5.
    """

    def __init__(self, abs_limit: Optional[dict] = None,
                 dtau_limit: Optional[dict] = None,
                 overload_ms: float = 500.0):
        self.abs_limit = {str(j): float(v) for j, v in (abs_limit or {}).items()}
        self.dtau_limit = {str(j): float(v) for j, v in (dtau_limit or {}).items()}
        self.overload_ms = float(overload_ms)
        self._prev_tau: Dict[str, float] = {}
        self._prev_ms: Optional[float] = None
        self._overload_since: Optional[float] = None
        self._spike_hyst = Hysteresis(2, 2)

    def update(self, tau: Dict[str, float], now_ms: float) -> List[SafetyEvent]:
        events: List[SafetyEvent] = []
        now = float(now_ms)
        if self._prev_ms is not None and self.dtau_limit:
            dt = max(now - self._prev_ms, 1.0)
            spike = False
            worst, worst_d = "", 0.0
            for j, t in tau.items():
                if j not in self.dtau_limit:
                    continue
                d = abs(t - self._prev_tau.get(j, t)) * 1000.0 / dt  # Nm/s
                if d > self.dtau_limit[j] and d > worst_d:
                    worst_d, worst, spike = d, j, True
            if spike and self._spike_hyst.record(True):
                events.append(SafetyEvent(CAUSE_TORQUE_SPIKE, SEVERITY_CRITICAL,
                                          "关节 {} 力矩突变 {:.1f} Nm/s（dtau_limit {}）".format(
                                              worst, worst_d, self.dtau_limit.get(worst)),
                                          int(now)))
            elif not spike:
                self._spike_hyst.record(False)
        self._prev_tau = dict(tau)
        self._prev_ms = now
        if self.abs_limit:
            over = any(abs(t) > self.abs_limit[j] for j, t in tau.items() if j in self.abs_limit)
            if over:
                if self._overload_since is None:
                    self._overload_since = now
                elif now - self._overload_since >= self.overload_ms:
                    events.append(SafetyEvent(CAUSE_TORQUE_OVERLOAD, SEVERITY_CRITICAL,
                                              "力矩持续超限 {:.1f}s（abs_limit 超限）".format(
                                                  (now - self._overload_since) / 1000.0),
                                              int(now)))
                    self._overload_since = now  # re-arm
            else:
                self._overload_since = None
        return events


class SafetyCore:
    """Orchestrates checkers + latch. All mutating entry points take a lock,
    so the node may drive them from a multi-threaded executor safely."""

    def __init__(self, cfg: dict):
        fb = cfg.get("feedback", {}) or {}
        m = cfg.get("motion", {}) or {}
        t = cfg.get("torque", {}) or {}
        w = cfg.get("watchdog", {}) or {}
        forensics = cfg.get("forensics", {}) or {}
        self.cfg = cfg
        self.latch = LatchState()
        self.feedback = FeedbackLossChecker(fb.get("timeout_ms", 100.0))
        self.motion = MotionChecker(m.get("tracking_error_rad", 0.05),
                                    m.get("stall"), m.get("hysteresis"))
        self.torque = TorqueChecker(t.get("abs_limit"), t.get("dtau_limit"),
                                    t.get("overload_ms", 500.0))
        self.watchdog = WatchdogChecker(w.get("critical_topics"), w.get("observed_topics"),
                                        w.get("critical_nodes"), w.get("observed_nodes"))
        # ring buffer sized for ring_buffer_s seconds at ~10 Hz
        self.forensics = RingBuffer(int(forensics.get("ring_buffer_s", 5)) * 10)
        self.dump_dir = os.path.expanduser(forensics.get("dump_dir", "~/.dsh-ros2/safety-events"))
        self.torque_enabled = bool(t.get("enabled", True))
        self.command_topic = str(m.get("command_topic", ""))
        self._joints: Dict[str, Dict[str, float]] = {}
        self._cmd: Optional[Dict[str, Dict[str, float]]] = None
        self._torque: Optional[Dict[str, float]] = None
        self._lock = Lock()

    # -- inputs -----------------------------------------------------------

    def on_joint_state(self, joints: Dict[str, Dict[str, float]], stamp_ms: float) -> None:
        """joints: {name: {position, velocity, effort}}"""
        with self._lock:
            self._joints = dict(joints)
            self.feedback.on_message(stamp_ms)
            has_effort = any("effort" in v for v in joints.values())
            self.forensics.push({
                "t_ms": int(stamp_ms),
                "position": {n: v.get("position") for n, v in joints.items()},
                "velocity": {n: v.get("velocity") for n, v in joints.items()},
                "effort": {n: v.get("effort") for n, v in joints.items() if "effort" in v},
            })
            if self.torque_enabled and has_effort and not self.command_topic:
                # torque source = effort field of the joint stream
                pass  # torque evaluated in tick() from _joints

    def on_command(self, joints: Dict[str, Dict[str, float]], stamp_ms: float) -> None:
        """commanded joint stream: {name: {position, velocity}}"""
        with self._lock:
            self._cmd = {n: dict(v) for n, v in joints.items()}

    def on_torque(self, tau: Dict[str, float], stamp_ms: float) -> None:
        """Dedicated torque stream (profile `feedback.torque_topic`).
        When configured, tick() uses this instead of the joint stream's
        effort field."""
        with self._lock:
            self._torque = {str(n): float(v) for n, v in tau.items()}

    def on_watchdog_activity(self, topic: str, stamp_ms: float) -> None:
        with self._lock:
            self.watchdog.on_activity(topic, stamp_ms)

    def on_node_scan(self, alive_names, now_ms: float) -> Tuple[List[SafetyEvent], bool]:
        """Feed a `ros2 node list` scan result. Node-down events go through
        the latch immediately (they arrive between timer ticks)."""
        with self._lock:
            events = self.watchdog.on_node_scan(alive_names, now_ms)
            locked_now = False
            for e in events:
                if self.latch.trigger(e.cause, e.severity, e.detail, e.stamp_ms):
                    locked_now = True
            if locked_now:
                self.forensics.dump(self.dump_dir, self.latch.cause, extra={
                    "state": self.latch.as_dict()})
            return events, locked_now

    # -- evaluation -------------------------------------------------------

    def tick(self, now_ms: float) -> Tuple[List[SafetyEvent], bool]:
        """Run all checkers once. Returns (events, locked_now) where
        locked_now is True only on the transition into LOCKED (caller fires
        the lock action exactly once)."""
        with self._lock:
            events: List[SafetyEvent] = []
            ev = self.feedback.check(now_ms)
            if ev:
                events.append(ev)
            joints = self._joints
            actual = {n: v.get("position", 0.0) for n, v in joints.items()}
            actual_vel = {n: v.get("velocity", 0.0) for n, v in joints.items()}
            if self._torque is not None:
                effort = self._torque
            else:
                effort = {n: v.get("effort") for n, v in joints.items() if "effort" in v}
            if self.torque_enabled and effort:
                events.extend(self.torque.update(effort, now_ms))
            if self.command_topic and self._cmd is not None:
                cmd = {n: v.get("position") for n, v in self._cmd.items() if "position" in v}
                cmd_vel = {n: v.get("velocity", 0.0) for n, v in self._cmd.items()}
                events.extend(self.motion.update(actual, cmd or None, actual_vel, cmd_vel, now_ms))
            events.extend(self.watchdog.check(now_ms))
            locked_now = False
            for e in events:
                if self.latch.trigger(e.cause, e.severity, e.detail, e.stamp_ms):
                    locked_now = True
            if locked_now:
                self.forensics.dump(self.dump_dir, self.latch.cause, extra={
                    "state": self.latch.as_dict()})
            return events, locked_now

    # -- services ---------------------------------------------------------

    def get_state(self) -> dict:
        with self._lock:
            return self.latch.as_dict()

    def unlock(self, request_id: str, cause: str, now_ms: float) -> dict:
        with self._lock:
            return self.latch.unlock(request_id, cause, now_ms)

    def set_lock(self, cause: str, detail: str, now_ms: float) -> dict:
        with self._lock:
            ok = self.latch.set_lock(cause, detail, now_ms)
            return {"accepted": ok, "message": "已锁死（cause={}）".format(cause)}


# ---------------------------------------------------------------------------
# --selftest: fault-injection scenarios (no ROS2 needed)
# ---------------------------------------------------------------------------

def _cfg(**overrides) -> dict:
    base = {
        "control_frequency": 200,
        "feedback": {"timeout_ms": 100},
        "motion": {"tracking_error_rad": 0.05,
                   "stall": {"window_ms": 200, "min_cmd_vel": 0.02, "max_actual_vel": 0.005},
                   "hysteresis": {"min_frames": 3, "window": 5},
                   "command_topic": "/cmd"},
        "torque": {"enabled": True, "abs_limit": {"a": 1.0}, "dtau_limit": {"a": 2.0}, "overload_ms": 500},
        "watchdog": {"critical_topics": [{"topic": "/controller/status", "timeout_ms": 1000}],
                     "observed_topics": [{"topic": "/debug/log", "timeout_ms": 3000}],
                     "critical_nodes": ["controller_manager"],
                     "observed_nodes": ["debug_node"]},
        "forensics": {"ring_buffer_s": 2, "dump_dir": "/tmp/dsh-ros2-safety-selftest"},
    }
    return base


def _js(pos=None, vel=None, eff=None):
    out = {}
    for name, value in (pos or {}).items():
        out[name] = {"position": value, "velocity": (vel or {}).get(name, 0.0),
                     "effort": (eff or {}).get(name, 0.0)}
    return out


def run_selftest() -> int:
    failures: List[str] = []

    def check(name, cond, detail=""):
        if cond:
            print("  PASS  {}".format(name))
        else:
            failures.append(name)
            print("  FAIL  {} {}".format(name, detail))

    print("safety_core selftest (fault injection)")

    # 1. feedback loss
    core = SafetyCore(_cfg())
    core.on_joint_state(_js({"a": 0.0}), 1000)
    ev, _ = core.tick(1200)
    check("feedback_loss triggers after silence", any(e.cause == "feedback_loss" for e in ev))

    # 2. tracking error (with hysteresis)
    core = SafetyCore(_cfg())
    for i in range(5):
        core.on_joint_state(_js({"a": 0.0}), 1000 + i * 10)
        core.on_command(_js({"a": 0.1}), 1000 + i * 10)
        ev, locked = core.tick(1000 + i * 10)
    check("tracking_error latches after hysteresis", core.latch.state == STATE_LOCKED
          and core.latch.cause == "tracking_error")

    # 3. single-frame noise does NOT lock
    core = SafetyCore(_cfg())
    core.on_joint_state(_js({"a": 0.0}), 1000)
    core.on_command(_js({"a": 0.1}), 1000)
    core.tick(1000)
    check("single noise frame does not lock", core.latch.state == STATE_NORMAL)

    # 4. stall
    core = SafetyCore(_cfg())
    for i in range(4):
        core.on_joint_state(_js({"a": 0.0}, vel={"a": 0.0}), 1000 + i * 10)
        core.on_command(_js({"a": 0.0}, vel={"a": 0.1}), 1000 + i * 10)
        ev, _ = core.tick(1000 + i * 10)
    check("stall latches", core.latch.state == STATE_LOCKED and core.latch.cause == "stall")

    # 5. watchdog: critical topic silence vs observed warning-only
    core = SafetyCore(_cfg())
    core.on_watchdog_activity("/controller/status", 1000)
    core.on_watchdog_activity("/debug/log", 1000)
    ev, _ = core.tick(3000)
    check("critical topic silence latches", core.latch.state == STATE_LOCKED
          and core.latch.cause == "watchdog_critical")
    core2 = SafetyCore(_cfg())
    core2.on_watchdog_activity("/controller/status", 1000)
    core2.on_watchdog_activity("/debug/log", 1000)
    ev, _ = core2.tick(1500)  # observed timeout 3000 not exceeded yet
    check("observed topic silence within timeout does not latch", core2.latch.state == STATE_NORMAL)
    core2.on_watchdog_activity("/controller/status", 4500)  # keep the critical topic alive
    ev, _ = core2.tick(5000)
    check("observed topic silence warns but does not latch",
          core2.latch.state == STATE_NORMAL and any(e.severity == "WARNING" for e in ev))

    # 6. watchdog node down (2 consecutive misses)
    core = SafetyCore(_cfg())
    core.on_node_scan(["controller_manager", "debug_node"], 1000)
    core.on_node_scan(["debug_node"], 6000)
    core.on_node_scan(["debug_node"], 11000)
    check("critical node down latches", core.latch.state == STATE_LOCKED
          and core.latch.cause == "watchdog_critical")

    # 7. torque spike (rising transient across two ticks)
    core = SafetyCore(_cfg())
    core.on_joint_state(_js({"a": 0.0}, eff={"a": 0.0}), 1000)
    core.tick(1000)
    core.on_joint_state(_js({"a": 0.0}, eff={"a": 5.0}), 1010)
    core.tick(1010)
    core.on_joint_state(_js({"a": 0.0}, eff={"a": 8.0}), 1020)
    core.tick(1020)
    check("torque spike latches", core.latch.state == STATE_LOCKED and core.latch.cause == "torque_spike")

    # 8. torque overload (sustained)
    core = SafetyCore(_cfg())
    for i in range(60):
        core.on_joint_state(_js({"a": 0.0}, eff={"a": 3.0}), 1000 + i * 10)
        core.tick(1000 + i * 10)
    check("torque overload latches", core.latch.state == STATE_LOCKED and core.latch.cause == "torque_overload")

    # 9. latch is sticky: condition clears but state stays LOCKED
    core = SafetyCore(_cfg())
    core.on_joint_state(_js({"a": 0.0}), 1000)
    core.tick(1200)  # feedback loss
    core.on_joint_state(_js({"a": 0.0}), 5000)
    core.tick(5010)
    check("latch persists after condition clears", core.latch.state == STATE_LOCKED)

    # 10. unlock returns to NORMAL
    res = core.unlock("req-1", "human confirmed", 6000)
    check("unlock accepted", res["accepted"] and core.latch.state == STATE_NORMAL)
    res2 = core.unlock("req-2", "again", 6010)
    check("unlock on NORMAL rejected", not res2["accepted"])

    # 11. human-gated set_lock (semantic path)
    core = SafetyCore(_cfg())
    core.set_lock("semantic_unsafe", "VLM 判定碰撞风险", 1000)
    check("set_lock latches", core.latch.state == STATE_LOCKED and core.latch.cause == "semantic_unsafe")

    # 12. forensics dump
    core = SafetyCore(_cfg())
    core.on_joint_state(_js({"a": 0.1}), 1000)
    core.tick(1200)
    path = core.forensics.dump(core.dump_dir, "feedback_loss")
    check("forensics dump written", os.path.exists(path) and os.path.getsize(path) > 0, path)

    print("")
    if failures:
        print("SELFTEST FAILED: {}".format(", ".join(failures)))
        return 1
    print("SELFTEST PASSED ({} scenarios)".format(12))
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description="dsh-ros2 safety core (pure logic)")
    ap.add_argument("--selftest", action="store_true", help="run fault-injection self tests")
    args = ap.parse_args()
    if args.selftest:
        return run_selftest()
    ap.print_help()
    return 0


if __name__ == "__main__":
    sys.exit(main())
