#!/usr/bin/env python3
"""private_paths.py — directories and files this plugin writes must be OURS and PRIVATE.

The rule already exists twice in this repository:

  * `packages/common/src/runtime-dir.ts` — the TypeScript side, for the fixed
    runtime directories under `$TMPDIR`;
  * `scripts/verification/` — the verification rig, for its run directory.

Both were written after a round that found a *fixed* path in a 1777 directory
being written into without ever asking "is that directory mine?" (round 25).
The Python helpers had no such check at all, and round 26 measured the
consequences:

  * `robot_profile.py` created `~/.dsh-ros2` and `~/.dsh-ros2/robots` with the
    ambient umask (0775 on a default Ubuntu account) and wrote
    `robots/<name>.yaml` 0664. That file carries the robot's `safety` section —
    the very limits `motion_validate` validates a trajectory against and the
    thresholds `safety_monitor` latches on. Another local user could edit it.
  * `zero_pose_semantics.py` wrote `/tmp/zero_pose_joints.py` with `open(…, "w")`
    and then ran `python3` on it: a symlink planted at that fixed path
    redirected the write (measured: the target file was replaced) and the
    executed path was never proven to be the file just written.

So this module is the ONE Python implementation of the rule, and
`packages/common/tests/private-paths-parity.spec.ts` feeds the same on-disk
matrix to this module and to `runtime-dir.ts` and asserts they reach the same
verdict. Two implementations of one criterion are an accident source; two
implementations pinned to the same verdicts by a test are a defence in depth.

Criteria, in this order (a symlink is judged by the link, never by its target —
the link sits in a directory someone else may be able to write, and can be
swapped between the check and the write that follows):

  1. symlink            -> refuse (PRIVATE_DIR_SYMLINK)
  2. not a directory    -> refuse (PRIVATE_DIR_NOT_DIR)
  3. owned by someone else -> refuse (PRIVATE_DIR_NOT_OWNED)
  4. wider than 0700 and ours -> tighten, then verify

Only directories *under the anchor* (default `$HOME`) are tightened: a
directory the operator configured somewhere else keeps the mode they gave it.
Symlink/type/owner are enforced everywhere.

Self-test (no ROS2, no PyYAML, no network): `python3 private_paths.py --selftest`
Probe (used by the parity test):      `python3 private_paths.py --probe <dir>`
"""

import json
import os
import stat
import sys
import tempfile

DIR_MODE = 0o700
FILE_MODE = 0o600


class PrivatePathError(Exception):
    """A refusal. `code` matches the TypeScript `PrivateRuntimeDirResult` code."""

    def __init__(self, code, message):
        super().__init__(message)
        self.code = code
        self.message = message


def _owner_uid():
    return os.getuid() if hasattr(os, "getuid") else None


def _steps(path_, anchor):
    """Components of `path_` below `anchor`.

    Returns `(steps, strict)`. When `path_` is not below `anchor` there is
    nothing this function may tighten, so it validates the leaf only.
    """
    target = os.path.abspath(path_)
    base = os.path.abspath(anchor)
    if target == base:
        return [], True
    rel = os.path.relpath(target, base)
    if rel == os.curdir:
        return [], True
    if rel == os.pardir or rel.startswith(os.pardir + os.sep) or os.path.isabs(rel):
        return [target], False
    steps = []
    current = base
    for part in rel.split(os.sep):
        current = os.path.join(current, part)
        steps.append(current)
    return steps, True


def _lstat(path_, refuse):
    try:
        return os.lstat(path_)
    except FileNotFoundError:
        return None
    except OSError as error:  # noqa: BLE001 - surface it as a structured refusal
        raise refuse("PRIVATE_DIR_UNREADABLE", "lstat failed: %s" % error)


def ensure_private_dir(path_, label="目录", uid=None, anchor=None):
    """Make sure `path_` is a directory this user owns and only it can use.

    Returns `{"ok": True, "path": ..., "tightened": [...]}`; raises
    `PrivatePathError` otherwise. Every level is created and validated on its
    own, so a recursive `mkdir` can never walk through a directory we do not
    own.
    """
    target = os.path.abspath(path_)
    if uid is None:
        uid = _owner_uid()

    def refuse(code, why):
        return PrivatePathError(code, "refusing to use the %s %s: %s" % (label, target, why))

    if uid is None:
        raise refuse("PRIVATE_DIR_NO_UID", "cannot verify ownership on this platform")
    if anchor is None:
        anchor = os.path.expanduser("~")

    steps, strict = _steps(target, anchor)
    tightened = []

    for step in steps:
        before = _lstat(step, refuse)
        if before is not None and stat.S_ISLNK(before.st_mode):
            raise refuse("PRIVATE_DIR_SYMLINK", "is a symlink (use the real path)")
        if before is not None and not stat.S_ISDIR(before.st_mode):
            raise refuse("PRIVATE_DIR_NOT_DIR", "not a directory")
        if before is None:
            try:
                os.mkdir(step, DIR_MODE)
            except OSError as error:  # noqa: BLE001
                raise refuse("PRIVATE_DIR_CREATE_FAILED", "mkdir failed: %s" % error)

        # Re-stat instead of trusting the check above or `mkdir`: the path can
        # change in between, and `lstat` (never `stat`) is what judges a link as
        # a link instead of judging its target.
        after = _lstat(step, refuse)
        if after is None:  # pragma: no cover - removed between mkdir and stat
            raise refuse("PRIVATE_DIR_UNREADABLE", "disappeared while being prepared")
        if stat.S_ISLNK(after.st_mode):
            raise refuse("PRIVATE_DIR_SYMLINK", "is a symlink (use the real path)")
        if not stat.S_ISDIR(after.st_mode):
            raise refuse("PRIVATE_DIR_NOT_DIR", "not a directory")
        if after.st_uid != uid:
            raise refuse("PRIVATE_DIR_NOT_OWNED", "owned by uid %d, not you (uid %d)" % (after.st_uid, uid))
        if strict and (after.st_mode & 0o077) != 0:
            try:
                os.chmod(step, DIR_MODE)
            except OSError as error:  # noqa: BLE001
                raise refuse("PRIVATE_DIR_PERMISSIONS", "chmod failed: %s" % error)
            verified = _lstat(step, refuse)
            if verified is not None and (verified.st_mode & 0o077) != 0:
                raise refuse("PRIVATE_DIR_PERMISSIONS",
                             "mode is %03o, which is wider than 700" % (verified.st_mode & 0o777))
            tightened.append(step)

    return {"ok": True, "path": target, "tightened": tightened}


def write_private_file(path_, text, mode=FILE_MODE):
    """Write `text` to `path_` with `mode`, atomically, never through a link.

    `open(path_, "w")` has two faults for a fixed coordinate: it applies `mode`
    only at creation (so a file left by an earlier, umask-derived run keeps its
    wide mode) and it FOLLOWS a symlink planted at that path, which turns
    "write a scratch script here" into "overwrite whatever the attacker points
    at". Writing to a fresh file and then `os.replace`-ing it fixes both: the
    replacement swaps the directory entry, so a link at the destination is
    removed rather than followed.
    """
    target = os.path.abspath(path_)
    parent = os.path.dirname(target)
    if not os.path.isdir(parent):
        raise PrivatePathError("PRIVATE_FILE_NO_PARENT", "parent directory does not exist: %s" % parent)
    data = text.encode("utf-8") if isinstance(text, str) else text
    fd, tmp = tempfile.mkstemp(prefix=".dsh-ros2-", suffix=".tmp", dir=parent)
    try:
        with os.fdopen(fd, "wb") as handle:
            try:
                os.fchmod(handle.fileno(), mode)
            except OSError:
                pass
            handle.write(data)
            handle.flush()
            os.fsync(handle.fileno())
        fd = None
        os.replace(tmp, target)
        try:
            os.chmod(target, mode)
        except OSError as error:  # noqa: BLE001
            raise PrivatePathError("PRIVATE_FILE_WRITE_FAILED", "chmod %s failed: %s" % (target, error))
        return target
    except OSError as error:  # noqa: BLE001
        raise PrivatePathError("PRIVATE_FILE_WRITE_FAILED", "cannot write %s: %s" % (target, error))
    finally:
        if fd is not None:
            try:
                os.close(fd)
            except OSError:
                pass
        if os.path.lexists(tmp):
            try:
                os.unlink(tmp)
            except OSError:
                pass


def privacy_warning(path_, label="文件"):
    """A sentence when `path_` is readable/writable by anyone but its owner.

    Read-only: this never repairs anything, it makes an install that predates
    the fix VISIBLE instead of silently trusting a file another local user can
    edit. Returns `None` when the path is missing or private.
    """
    try:
        info = os.lstat(path_)
    except OSError:
        return None
    if stat.S_ISLNK(info.st_mode):
        return "%s %s 是符号链接：插件从不通过链接写入，读取它等于信任链接目标" % (label, path_)
    expected = 0o700 if stat.S_ISDIR(info.st_mode) else 0o600
    if info.st_mode & 0o077:
        return ("%s %s 权限为 %03o，宽于 %03o：同一台机器上的其他用户可读写。"
                "本轮之前创建的档案仍是旧权限，重新 register / safety set 会被收紧到 %03o。"
                % (label, path_, info.st_mode & 0o777, expected, expected))
    return None


def selftest():
    failures = []

    def check(label, cond, detail=""):
        print("  %s  %s%s" % ("PASS" if cond else "FAIL", label, "" if cond else "  " + str(detail)))
        if not cond:
            failures.append(label)

    # Fixtures for "an install from before the fix" deliberately reproduce the
    # WIDE mode. They do it through the umask, not `chmod(<wide literal>)`: that
    # is how the old code produced the mode in the first place, and a `chmod`
    # with group/other bits is exactly what a code scanner should report.
    def make_dir_with_umask(path_, umask_value):
        saved = os.umask(umask_value)
        try:
            os.makedirs(path_, exist_ok=True)
        finally:
            os.umask(saved)

    def make_file_with_umask(path_, text, umask_value=0o002):
        saved = os.umask(umask_value)
        try:
            with open(path_, "w") as handle:
                handle.write(text)
        finally:
            os.umask(saved)

    old_umask = os.umask(0)  # the hostile case: mode must not depend on the umask
    try:
        with tempfile.TemporaryDirectory() as home:
            # 1) a two-level chain is created 0700 whatever the umask says.
            target = os.path.join(home, ".dsh-ros2", "robots")
            res = ensure_private_dir(target, label="档案目录", anchor=home)
            modes = [stat.S_IMODE(os.lstat(p).st_mode) for p in (os.path.dirname(target), target)]
            check("creates every level 0700 under umask 000", modes == [0o700, 0o700], modes)
            check("reports the created path", res["ok"] and res["path"] == os.path.abspath(target))

            # 2) our own wide directory is tightened (an install from before the fix).
            os.rmdir(target)
            make_dir_with_umask(target, 0o002)  # 0775, exactly what the old code produced
            res = ensure_private_dir(target, anchor=home)
            check("tightens our own 0775 directory to 0700",
                  stat.S_IMODE(os.lstat(target).st_mode) == 0o700 and target in res["tightened"])

            # 3) a symlink leaf is refused, NOT followed.
            link = os.path.join(home, "link-dir")
            os.symlink(target, link)
            try:
                ensure_private_dir(link, anchor=home)
                check("refuses a symlink leaf", False, "no refusal")
            except PrivatePathError as error:
                check("refuses a symlink leaf", error.code == "PRIVATE_DIR_SYMLINK", error.code)

            # 4) a symlink in the MIDDLE is refused too.
            mid = os.path.join(home, "mid")
            os.makedirs(mid)
            os.symlink(target, os.path.join(mid, "hop"))
            try:
                ensure_private_dir(os.path.join(mid, "hop", "deeper"), anchor=home)
                check("refuses a symlink in the middle", False, "no refusal")
            except PrivatePathError as error:
                check("refuses a symlink in the middle", error.code == "PRIVATE_DIR_SYMLINK", error.code)

            # 5) a regular file where a directory is expected.
            regular = os.path.join(home, "not-a-dir")
            with open(regular, "w") as handle:
                handle.write("x")
            try:
                ensure_private_dir(regular, anchor=home)
                check("refuses a regular file", False, "no refusal")
            except PrivatePathError as error:
                check("refuses a regular file", error.code == "PRIVATE_DIR_NOT_DIR", error.code)

            # 6) a directory owned by somebody else: the uid seam stands in for a
            #    second account (the same seam runtime-dir.ts exposes to its tests).
            try:
                ensure_private_dir(target, anchor=home, uid=os.getuid() + 4242)
                check("refuses a directory we do not own", False, "no refusal")
            except PrivatePathError as error:
                check("refuses a directory we do not own", error.code == "PRIVATE_DIR_NOT_OWNED", error.code)

            # 7) outside the anchor: still validated, but the operator's mode is
            #    left alone (the documented rule runtime-dir.ts applies to a
            #    configured screenshot directory).
            outside = os.path.join(home, "outside")
            make_dir_with_umask(outside, 0o022)  # 0755: the operator's own choice
            ensure_private_dir(outside, anchor=os.path.join(home, "elsewhere"))
            check("does not touch a directory outside the anchor",
                  stat.S_IMODE(os.lstat(outside).st_mode) == 0o755)

            # 8) write_private_file: 0600 under a hostile umask, and it REPLACES a
            #    planted symlink instead of writing through it (the zero-pose bug).
            victim = os.path.join(home, "victim.txt")
            with open(victim, "w") as handle:
                handle.write("ORIGINAL")
            planted = os.path.join(home, "planted.py")
            os.symlink(victim, planted)
            write_private_file(planted, "ATTACKER CHOSEN PATH\n")
            check("a planted symlink is replaced, not followed",
                  open(victim).read() == "ORIGINAL", open(victim).read())
            check("the replacement is a regular file", not os.path.islink(planted))
            check("the replacement carries the new content",
                  open(planted).read() == "ATTACKER CHOSEN PATH\n")
            check("the written file is 0600", stat.S_IMODE(os.lstat(planted).st_mode) == 0o600,
                  oct(stat.S_IMODE(os.lstat(planted).st_mode)))

            # 9) an existing wide file is tightened by the next write.
            wide = os.path.join(home, "wide.yaml")
            make_file_with_umask(wide, "old")  # 0664: what the old code produced
            write_private_file(wide, "new\n")
            check("an existing 0664 file is tightened to 0600",
                  stat.S_IMODE(os.lstat(wide).st_mode) == 0o600)

            # 10) privacy_warning sees a wide file and stays quiet about a private one.
            check("privacy_warning is silent about a private file", privacy_warning(wide) is None)
            os.unlink(wide)
            make_file_with_umask(wide, "old")
            check("privacy_warning flags a wide file", privacy_warning(wide) is not None)
            check("privacy_warning is silent about a missing path",
                  privacy_warning(os.path.join(home, "absent")) is None)
    finally:
        os.umask(old_umask)

    if failures:
        print("SELFTEST FAILED: %d check(s): %s" % (len(failures), ", ".join(failures)))
        return 1
    print("SELFTEST OK (private_paths)")
    return 0


def main(argv):
    if "--selftest" in argv:
        return selftest()
    if "--probe" in argv:
        path_ = argv[argv.index("--probe") + 1]
        uid = None
        if "--uid" in argv:
            uid = int(argv[argv.index("--uid") + 1])
        anchor = None
        if "--anchor" in argv:
            anchor = argv[argv.index("--anchor") + 1]
        try:
            result = ensure_private_dir(path_, label="probe", uid=uid, anchor=anchor)
            print(json.dumps({"ok": True, "code": "", "path": result["path"],
                              "tightened": result["tightened"],
                              "mode": stat.S_IMODE(os.lstat(result["path"]).st_mode)}))
            return 0
        except PrivatePathError as error:
            print(json.dumps({"ok": False, "code": error.code, "message": error.message}))
            return 0
    print(__doc__)
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
