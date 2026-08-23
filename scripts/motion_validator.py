#!/usr/bin/env python3
"""motion_validator — deterministic pre-execution motion validation (no rclpy).

Validates a planned trajectory / trajectoryOut artifact / motion proposal
BEFORE human approval and execution. Pure, deterministic, LLM-free; testable
without ROS2 (`--selftest`). Scope follows docs/safety-todo.md §1 (early
batch 0.14.1): only metrics that NOTHING ELSE checks pre-execution —

  * structure / NaN / Inf / joint names / monotonic timestamps / duration
  * position / velocity / acceleration limits (from the robot profile,
    URDF-derived) — collision/singularity/workspace are LEFT to MoveIt
    planning (redundant to re-check)
  * relative-mode absolute target (fresh current state required)
  * state freshness (maxStateAgeMs)
  * pose-target workspace box (planning frame, no FK needed)
  * trajectory fingerprint (sha256) for TOCTOU binding
  * validation TTL (validationTtlMs)

Usage:
    motion_validator.py --trajectory <plan.json> --config '<json>' [--selftest]

--config schema (values come from the robot profile `safety` section):
{
  "limits": {"joint_a": {"lower": -3.14, "upper": 3.14,
                          "velocity": 1.0, "effort": 1.0, "continuous": false}},
  "max_state_age_ms": 500,
  "validation_ttl_ms": 2000,
  "max_duration_ms": 30000,
  "workspace": {"x": [-1, 1], "y": [-1, 1], "z": [0, 1.5]},   # optional
  "mode": "joint_abs" | "joint_rel" | "pose_abs" | "pose_rel" | "trajectory",
  "group": "right_arm",
  "target": [0.1, ...]  | {"x": 0.5, "y": 0, "z": 0.3},       # absolute target
  "current_state": {"stamp_ms": 123, "position": {"j": 0.0}},  # optional
  "now_ms": 123000,
  "require_limits": false
}

Output JSON:
{
  "safe": true|false, "status": "pass"|"fail",
  "checks": {"structure": "...", "joint_limits": "...", ...},
  "warnings": [], "errors": [],
  "fingerprint": "<sha256>", "validated_at_ms": 0, "ttl_ms": 0
}
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import sys
from typing import Any, Dict, List, Optional

STATUS_PASS = "pass"
STATUS_FAIL = "fail"
STATUS_UNKNOWN = "unknown"


def _is_finite(v) -> bool:
    return isinstance(v, (int, float)) and math.isfinite(float(v))


class MotionValidator:
    def __init__(self, config: dict):
        self.cfg = config or {}
        self.limits: Dict[str, dict] = self.cfg.get("limits") or {}
        self.max_state_age_ms = float(self.cfg.get("max_state_age_ms", 500))
        self.validation_ttl_ms = float(self.cfg.get("validation_ttl_ms", 2000))
        self.max_duration_ms = float(self.cfg.get("max_duration_ms", 30000))
        self.workspace = self.cfg.get("workspace") or {}
        self.mode = str(self.cfg.get("mode", "trajectory"))
        self.group = str(self.cfg.get("group", ""))
        self.target = self.cfg.get("target")
        self.state = self.cfg.get("current_state") or {}
        self.now_ms = float(self.cfg.get("now_ms", 0))
        self.require_limits = bool(self.cfg.get("require_limits", False))
        self.checks: Dict[str, str] = {}
        self.warnings: List[str] = []
        self.errors: List[str] = []
        self.fingerprint = ""
        self.validated_at_ms = int(self.now_ms) if self.now_ms else int(__import__("time").time() * 1000)

    # -- helpers -----------------------------------------------------------

    def _fail(self, check: str, msg: str) -> None:
        self.checks[check] = STATUS_FAIL
        self.errors.append(msg)

    def _pass(self, check: str) -> None:
        self.checks.setdefault(check, STATUS_PASS)

    def _unknown(self, check: str, msg: str) -> None:
        self.checks[check] = STATUS_UNKNOWN
        self.warnings.append(msg)

    def fingerprint_of(self, trajectory: dict) -> str:
        """Deterministic sha256 over the canonical motion identity. The
        robot profile version/identity is part of it, so changing the robot
        or the trajectory invalidates the fingerprint (TOCTOU binding)."""
        canon = {
            "profile": str(self.cfg.get("profile_identity", "")),
            "group": self.group,
            "joint_names": list(trajectory.get("joint_names", [])),
            "points": [
                {"t": round(float(p.get("time_from_start", 0.0)), 6),
                 "q": [round(float(v), 6) for v in p.get("positions", [])]}
                for p in trajectory.get("points", [])
            ],
            "target": self.target,
            "state_stamp_ms": int(self.state.get("stamp_ms", 0)),
        }
        raw = json.dumps(canon, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
        return hashlib.sha256(raw.encode("utf-8")).hexdigest()

    @staticmethod
    def verify_fingerprint(trajectory: dict, config: dict, expected: str) -> bool:
        return MotionValidator(config).fingerprint_of(trajectory) == expected

    @staticmethod
    def expired(validated_at_ms: float, ttl_ms: float, now_ms: float) -> bool:
        if ttl_ms <= 0:
            return False
        return now_ms - validated_at_ms > ttl_ms

    # -- checks ------------------------------------------------------------

    def check_structure(self, traj: dict) -> bool:
        names = traj.get("joint_names")
        points = traj.get("points")
        if not isinstance(names, list) or not names:
            self._fail("structure", "joint_names 缺失或为空")
            return False
        if len(set(names)) != len(names):
            self._fail("structure", "joint_names 重复")
            return False
        if not isinstance(points, list) or not points:
            self._fail("structure", "points 缺失或为空")
            return False
        n = len(names)
        for i, p in enumerate(points):
            q = p.get("positions")
            if not isinstance(q, list) or len(q) != n:
                self._fail("structure", f"点 {i} positions 长度 {len(q) if isinstance(q, list) else '?'} != 关节数 {n}")
                return False
            if not _is_finite(p.get("time_from_start", 0.0)):
                self._fail("structure", f"点 {i} time_from_start 非有限数")
                return False
            for v in q:
                if not _is_finite(v):
                    self._fail("structure", f"点 {i} 含 NaN/Inf 位置")
                    return False
        self._pass("structure")
        return True

    def check_timestamps(self, traj: dict) -> None:
        times = [float(p.get("time_from_start", 0.0)) for p in traj.get("points", [])]
        if any(t < 0 for t in times):
            self._fail("timestamps", "time_from_start 出现负值")
            return
        for a, b in zip(times, times[1:]):
            if b < a:
                self._fail("timestamps", f"时间戳不单调：{a} -> {b}")
                return
        duration_ms = times[-1] * 1000.0 if times else 0.0
        if self.max_duration_ms > 0 and duration_ms > self.max_duration_ms:
            self._fail("duration", f"轨迹时长 {duration_ms/1000.0:.2f}s 超过 maxDurationMs {self.max_duration_ms/1000.0:.1f}s")
            return
        self._pass("timestamps")
        self._pass("duration")

    def check_limits(self, traj: dict) -> None:
        if not self.limits:
            if self.require_limits:
                self._fail("joint_limits", "未提供关节限位（robot profile 缺失或未注册）——fail-closed")
            else:
                self._unknown("joint_limits", "未提供关节限位——限位检查跳过（建议注册 robot profile）")
            return
        names = traj.get("joint_names", [])
        points = traj.get("points", [])
        for name in names:
            if name not in self.limits:
                self._fail("joint_limits", f"未知关节 {name}（不在 profile 限位表中）")
                return
        # group coverage: when the group's joint set is known (SRDF), the
        # trajectory must cover exactly those joints — no missing, no extra
        group_joints = self.cfg.get("group_joints")
        if group_joints:
            want = set(group_joints)
            got = set(names)
            missing = sorted(want - got)
            extra = sorted(got - want)
            if missing or extra:
                self._fail("joint_limits",
                           f"轨迹关节集与规划组不符：缺 {missing}，多 {extra}")
                return
        # position bounds (continuous joints wrap into [lower, lower+2π))
        for i, p in enumerate(points):
            for name, q in zip(names, p.get("positions", [])):
                lim = self.limits.get(name, {})
                lower = lim.get("lower")
                upper = lim.get("upper")
                if lower is None or upper is None:
                    continue
                if lim.get("continuous"):
                    span = 2.0 * math.pi
                    qq = (float(q) - float(lower)) % span + float(lower)
                else:
                    qq = float(q)
                if qq < float(lower) - 1e-6 or qq > float(upper) + 1e-6:
                    self._fail("joint_limits", f"关节 {name} 点 {i} 位置 {q:.4f} 超出 [{lower}, {upper}]")
                    return
        # velocity / acceleration via finite differences
        vel_ok = True
        acc_ok = True
        for i in range(1, len(points)):
            dt = float(points[i].get("time_from_start", 0.0)) - float(points[i - 1].get("time_from_start", 0.0))
            if dt <= 0:
                continue
            prev_q = points[i - 1].get("positions", [])
            cur_q = points[i].get("positions", [])
            for j, name in enumerate(names):
                lim = self.limits.get(name, {})
                v_lim = lim.get("velocity")
                if v_lim:
                    vel = abs(float(cur_q[j]) - float(prev_q[j])) / dt
                    if vel > float(v_lim) + 1e-6:
                        self._fail("velocity_limits", f"关节 {name} 段 {i} 速度 {vel:.3f} rad/s 超限 {v_lim}")
                        vel_ok = False
                        break
            if not vel_ok:
                break
        if vel_ok:
            self._pass("velocity_limits")
        # acceleration needs two segments
        for i in range(2, len(points)):
            dt0 = float(points[i - 1].get("time_from_start", 0.0)) - float(points[i - 2].get("time_from_start", 0.0))
            dt1 = float(points[i].get("time_from_start", 0.0)) - float(points[i - 1].get("time_from_start", 0.0))
            if dt0 <= 0 or dt1 <= 0:
                continue
            for j, name in enumerate(names):
                lim = self.limits.get(name, {})
                a_lim = lim.get("acceleration")
                if a_lim:
                    v0 = (points[i - 1]["positions"][j] - points[i - 2]["positions"][j]) / dt0
                    v1 = (points[i]["positions"][j] - points[i - 1]["positions"][j]) / dt1
                    acc = abs(v1 - v0) / ((dt0 + dt1) / 2.0)
                    if acc > float(a_lim) + 1e-6:
                        self._fail("acceleration_limits", f"关节 {name} 段 {i} 加速度 {acc:.3f} 超限 {a_lim}")
                        acc_ok = False
                        break
            if not acc_ok:
                break
        if acc_ok:
            self._pass("acceleration_limits")
        self._pass("joint_limits")

    def check_freshness(self) -> None:
        stamp = self.state.get("stamp_ms")
        rel = self.mode in ("joint_rel", "pose_rel")
        if rel:
            if stamp is None or not self.state.get("position"):
                self._fail("state_freshness", "相对运动必须提供当前关节状态（fresh /joint_states）")
                return
        if stamp is None:
            self._pass("state_freshness")
            return
        if self.now_ms > 0 and self.now_ms - float(stamp) > self.max_state_age_ms:
            age = self.now_ms - float(stamp)
            self._fail("state_freshness", f"关节状态过旧 {age/1000.0:.2f}s > maxStateAgeMs {self.max_state_age_ms/1000.0:.1f}s")
            return
        self._pass("state_freshness")

    def check_relative_target(self, traj: dict) -> None:
        if self.mode not in ("joint_rel", "pose_rel"):
            self._pass("absolute_target")
            return
        if not self.target:
            self._fail("absolute_target", "相对模式缺少 target（delta）")
            return
        pos = self.state.get("position") or {}
        if self.mode == "joint_rel":
            names = traj.get("joint_names", [])
            # absolute = current + delta (must be fresh — enforced above)
            # target may be a list (in trajectory joint order) or a dict
            # {joint_name: delta}
            for name in names:
                if isinstance(self.target, dict):
                    delta = self.target.get(name)
                    if delta is None:
                        self._fail("absolute_target", f"target 缺关节 {name} 的增量")
                        return
                else:
                    idx = names.index(name)
                    if idx >= len(self.target):
                        self._fail("absolute_target", f"target 长度不足（缺 {name}）")
                        return
                    delta = self.target[idx]
                if name not in pos:
                    self._fail("absolute_target", f"当前状态缺关节 {name}")
                    return
                absolute = float(pos[name]) + float(delta)
                lim = self.limits.get(name)
                if lim and lim.get("lower") is not None and lim.get("upper") is not None:
                    if absolute < float(lim["lower"]) - 1e-6 or absolute > float(lim["upper"]) + 1e-6:
                        self._fail("absolute_target", f"相对运动绝对目标 {name}={absolute:.4f} 超出限位 [{lim['lower']}, {lim['upper']}]")
                        return
        elif self.mode == "pose_rel":
            t = self.target
            if not isinstance(t, dict) or not all(_is_finite(t.get(k)) for k in ("x", "y", "z")):
                self._fail("absolute_target", "pose_rel target 需含有限 x/y/z")
                return
        self._pass("absolute_target")

    def check_workspace(self, traj: dict) -> None:
        if not self.workspace:
            self._pass("workspace")
            return
        if self.mode == "pose_rel":
            # absolute EE pose needs current EE pose (FK) — the body layer
            # provides it; without it the box cannot be checked
            self._unknown("workspace", "pose_rel 的 workspace 校验需本体提供当前 EE 位姿（FK）——跳过")
            return
        if self.mode != "pose_abs":
            # joint-mode workspace check needs FK — left to the body layer
            self._pass("workspace")
            return
        t = self.target
        if not isinstance(t, dict):
            self._fail("workspace", "pose 目标格式错误（需 {x,y,z,...}）")
            return
        for axis, (lo, hi) in self.workspace.items():
            v = t.get(axis)
            if v is None or not _is_finite(v):
                self._fail("workspace", f"pose 目标缺 {axis} 分量或非有限数")
                return
            if float(v) < float(lo) or float(v) > float(hi):
                self._fail("workspace", f"pose 目标 {axis}={v} 超出 workspace [{lo}, {hi}]")
                return
        self._pass("workspace")

    # -- entry -------------------------------------------------------------

    def validate(self, trajectory: dict) -> dict:
        self.fingerprint = self.fingerprint_of(trajectory)
        ok_structure = self.check_structure(trajectory)
        if ok_structure:
            self.check_timestamps(trajectory)
        self.check_limits(trajectory)
        self.check_freshness()
        self.check_relative_target(trajectory)
        self.check_workspace(trajectory)
        safe = not self.errors
        status = STATUS_PASS if safe else STATUS_FAIL
        return {
            "safe": safe,
            "status": status,
            "checks": self.checks,
            "warnings": self.warnings,
            "errors": self.errors,
            "fingerprint": self.fingerprint,
            "validated_at_ms": self.validated_at_ms,
            "ttl_ms": int(self.validation_ttl_ms),
        }


def _traj(names, points):
    return {"joint_names": names, "points": points}


def run_selftest() -> int:
    failures: List[str] = []

    def check(name, cond, detail=""):
        if cond:
            print(f"  PASS  {name}")
        else:
            failures.append(name)
            print(f"  FAIL  {name} {detail}")

    LIM = {"a": {"lower": -3.14, "upper": 3.14, "velocity": 1.0, "effort": 1.0, "continuous": False}}
    BASE = {"limits": LIM, "max_state_age_ms": 500, "validation_ttl_ms": 2000,
            "max_duration_ms": 30000, "mode": "trajectory", "group": "g", "now_ms": 10000}

    # PASS: valid trajectory within limits
    traj = _traj(["a"], [{"positions": [0.0], "time_from_start": 0.0},
                         {"positions": [0.5], "time_from_start": 1.0}])
    out = MotionValidator(BASE).validate(traj)
    check("valid trajectory passes", out["safe"] and out["status"] == "pass", str(out["errors"]))

    # PASS: valid pose in workspace
    cfg = dict(BASE, mode="pose_abs", target={"x": 0.5, "y": 0.0, "z": 0.3},
               workspace={"x": [-1, 1], "y": [-1, 1], "z": [0, 1.5]})
    out = MotionValidator(cfg).validate(traj)
    check("valid pose in workspace passes", out["safe"], str(out["errors"]))

    # FAIL: position limit violation
    bad = _traj(["a"], [{"positions": [0.0], "time_from_start": 0.0},
                        {"positions": [5.0], "time_from_start": 1.0}])
    out = MotionValidator(BASE).validate(bad)
    check("position limit violation fails", not out["safe"] and "joint_limits" in out["checks"], str(out["errors"]))

    # FAIL: velocity limit violation (0 -> 2 in 0.1s = 20 rad/s > 1; 2 < 3.14)
    fast = _traj(["a"], [{"positions": [0.0], "time_from_start": 0.0},
                         {"positions": [2.0], "time_from_start": 0.1}])
    out = MotionValidator(BASE).validate(fast)
    check("velocity limit violation fails", not out["safe"] and out["checks"].get("velocity_limits") == "fail", str(out["errors"]))

    # FAIL: acceleration limit violation
    cfg = dict(BASE)
    cfg["limits"] = {"a": {"lower": -10, "upper": 10, "velocity": 10.0, "acceleration": 1.0, "continuous": False}}
    acc = _traj(["a"], [{"positions": [0.0], "time_from_start": 0.0},
                        {"positions": [1.0], "time_from_start": 0.5},
                        {"positions": [3.0], "time_from_start": 1.0}])  # v 0->2->4, acc = 4 rad/s² > 1
    out = MotionValidator(cfg).validate(acc)
    check("acceleration limit violation fails", not out["safe"] and out["checks"].get("acceleration_limits") == "fail", str(out["errors"]))

    # FAIL: workspace violation
    cfg = dict(BASE, mode="pose_abs", target={"x": 2.0, "y": 0.0, "z": 0.3},
               workspace={"x": [-1, 1], "y": [-1, 1], "z": [0, 1.5]})
    out = MotionValidator(cfg).validate(traj)
    check("workspace violation fails", not out["safe"] and "workspace" in out["checks"], str(out["errors"]))

    # FAIL: NaN
    nan_traj = _traj(["a"], [{"positions": [float("nan")], "time_from_start": 0.0}])
    out = MotionValidator(BASE).validate(nan_traj)
    check("NaN fails", not out["safe"], str(out["errors"]))

    # FAIL: Inf
    inf_traj = _traj(["a"], [{"positions": [0.0], "time_from_start": 0.0},
                             {"positions": [float("inf")], "time_from_start": 1.0}])
    out = MotionValidator(BASE).validate(inf_traj)
    check("Inf fails", not out["safe"], str(out["errors"]))

    # FAIL: missing joint (trajectory omits a group joint)
    cfg = dict(BASE)
    cfg["limits"] = {"a": LIM["a"], "b": LIM["a"]}
    cfg["group_joints"] = ["a", "b"]
    out = MotionValidator(cfg).validate(traj)  # trajectory only covers 'a'
    check("missing joint fails", not out["safe"] and "joint_limits" in out["checks"], str(out["errors"]))

    # PASS: trajectory covers the group joints exactly
    cfg = dict(BASE)
    cfg["limits"] = {"a": LIM["a"], "b": LIM["a"]}
    cfg["group_joints"] = ["a"]
    out = MotionValidator(cfg).validate(traj)
    check("group coverage exact passes", out["safe"], str(out["errors"]))

    # FAIL: unknown joint
    cfg = dict(BASE)
    cfg["limits"] = {"a": LIM["a"]}
    unknown = _traj(["zzz"], [{"positions": [0.0], "time_from_start": 0.0}])
    out = MotionValidator(cfg).validate(unknown)
    check("unknown joint fails", not out["safe"], str(out["errors"]))

    # FAIL: stale state (relative mode)
    cfg = dict(BASE, mode="joint_rel", target=[0.1],
               current_state={"stamp_ms": 1000, "position": {"a": 0.0}}, now_ms=10000)
    out = MotionValidator(cfg).validate(traj)
    check("stale state fails (rel)", not out["safe"] and "state_freshness" in out["checks"], str(out["errors"]))

    # FAIL: relative mode without state
    cfg = dict(BASE, mode="joint_rel", target=[0.1])
    out = MotionValidator(cfg).validate(traj)
    check("rel without state fails", not out["safe"] and "state_freshness" in out["checks"], str(out["errors"]))

    # PASS: fresh state relative motion within limits
    cfg = dict(BASE, mode="joint_rel", target=[0.1],
               current_state={"stamp_ms": 9900, "position": {"a": 0.0}}, now_ms=10000)
    out = MotionValidator(cfg).validate(traj)
    check("fresh rel motion passes", out["safe"], str(out["errors"]))

    # FAIL: relative absolute target out of limits
    cfg = dict(BASE, mode="joint_rel", target=[5.0],
               current_state={"stamp_ms": 9900, "position": {"a": 0.0}}, now_ms=10000)
    out = MotionValidator(cfg).validate(traj)
    check("rel absolute target out of limits fails", not out["safe"] and "absolute_target" in out["checks"], str(out["errors"]))

    # FAIL: malformed trajectory
    out = MotionValidator(BASE).validate({"joint_names": [], "points": []})
    check("malformed trajectory fails", not out["safe"] and "structure" in out["checks"], str(out["errors"]))

    # FAIL: non-monotonic timestamps
    nm = _traj(["a"], [{"positions": [0.0], "time_from_start": 1.0},
                       {"positions": [0.1], "time_from_start": 0.0}])
    out = MotionValidator(BASE).validate(nm)
    check("non-monotonic timestamps fail", not out["safe"] and "timestamps" in out["checks"], str(out["errors"]))

    # FAIL: duration over max
    cfg = dict(BASE, max_duration_ms=500)
    long = _traj(["a"], [{"positions": [0.0], "time_from_start": 0.0},
                         {"positions": [0.1], "time_from_start": 5.0}])
    out = MotionValidator(cfg).validate(long)
    check("duration over max fails", not out["safe"] and "duration" in out["checks"], str(out["errors"]))

    # TTL: expiry helper
    check("ttl expiry helper", MotionValidator.expired(1000, 2000, 4000)
          and not MotionValidator.expired(1000, 2000, 2500))

    # fingerprint: stable; changes with trajectory or profile
    v = MotionValidator(dict(BASE, profile_identity="p1"))
    f1 = v.fingerprint_of(traj)
    f2 = MotionValidator(dict(BASE, profile_identity="p1")).fingerprint_of(traj)
    f3 = MotionValidator(dict(BASE, profile_identity="p2")).fingerprint_of(traj)
    f4 = v.fingerprint_of(_traj(["a"], [{"positions": [0.0], "time_from_start": 0.0},
                                        {"positions": [0.6], "time_from_start": 1.0}]))
    check("fingerprint stable", f1 == f2)
    check("fingerprint changes with profile", f1 != f3)
    check("fingerprint changes with trajectory", f1 != f4)

    # TOCTOU: verify_fingerprint
    check("verify_fingerprint matches", MotionValidator.verify_fingerprint(traj, dict(BASE, profile_identity="p1"), f1))
    check("verify_fingerprint rejects modified", not MotionValidator.verify_fingerprint(
        _traj(["a"], [{"positions": [0.0], "time_from_start": 0.0},
                      {"positions": [0.6], "time_from_start": 1.0}]), dict(BASE, profile_identity="p1"), f1))

    # unknown limits: warn unless require_limits
    out = MotionValidator({}).validate(traj)
    check("unknown limits warn (not fail) by default", out["safe"] and "joint_limits" in out["checks"]
          and out["checks"]["joint_limits"] == "unknown", str(out["warnings"]))
    out = MotionValidator({"require_limits": True}).validate(traj)
    check("require_limits fails closed", not out["safe"], str(out["errors"]))

    print("")
    if failures:
        print("SELFTEST FAILED: " + ", ".join(failures))
        return 1
    print(f"SELFTEST PASSED ({24} scenarios)")
    return 0


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description="dsh-ros2 motion validator (deterministic)")
    ap.add_argument("--trajectory", default="", help="planned trajectory JSON file")
    ap.add_argument("--config", default="", help="validation config JSON (or @file)")
    ap.add_argument("--selftest", action="store_true", help="run self tests")
    args = ap.parse_args(argv)
    if args.selftest:
        return run_selftest()
    if not args.trajectory:
        print(json.dumps({"ok": False, "error": "--trajectory 必填"}))
        return 1
    try:
        with open(args.trajectory) as f:
            trajectory = json.load(f)
    except Exception as e:  # noqa: BLE001
        print(json.dumps({"ok": False, "error": f"trajectory 解析失败: {e}"}))
        return 1
    cfg_text = args.config
    if cfg_text.startswith("@"):
        with open(cfg_text[1:]) as f:
            cfg_text = f.read()
    try:
        config = json.loads(cfg_text) if cfg_text else {}
    except json.JSONDecodeError as e:
        print(json.dumps({"ok": False, "error": f"config 解析失败: {e}"}))
        return 1
    out = MotionValidator(config).validate(trajectory)
    out["ok"] = True
    print(json.dumps(out, ensure_ascii=False))
    return 0 if out["safe"] else 1


if __name__ == "__main__":
    sys.exit(main())
