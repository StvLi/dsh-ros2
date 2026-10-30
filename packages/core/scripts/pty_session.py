#!/usr/bin/env python3
"""pty_session.py — interactive PTY session manager for DSH tools.

Runs a command inside a pseudo-terminal so interactive installers (e.g. the
FishROS one-click installer with its numeric menus and sudo password prompts)
can be driven step by step: the tool starts a session, reads its output, sends
keyboard input, and stops it.

Files (under $TMPDIR/dsh-ros2/pty, or --dir):
  <id>.out    appended stdout+stderr of the pty child
  <id>.in     input queue: one line per "send" request
  <id>.meta   state file (started/running/exited, exit code)

Commands:
  start <id> <cmd...>   spawn <cmd> in a pty, return immediately
  send  <id> <text>     append <text> to the input queue (auto newline unless
                        text ends with '\\n')
  status <id>           print new output since last status (or all with --all)
                        plus a final line: STATE <running|exited|failed|unknown>
                        [exit=<n>]  (`failed` = the pty could not be allocated,
                        `unknown` = no such session — neither is `running`)
  stop  <id>            terminate the pty child (SIGTERM then SIGKILL)

Flags (`--dir`, `--all`) must come BEFORE the action, because `<cmd...>` after
`start <id>` is captured verbatim by `nargs=REMAINDER`:

  pty_session.py --dir /tmp/x start s1 bash /tmp/installer.sh
  pty_session.py --dir /tmp/x status s1

`status`/`stop` reject trailing arguments instead of ignoring them: a flag
written after the session id is not parsed as a flag, so silently dropping it
would report success for a directory that was never used.

Exit codes:
  0  ok
  2  usage error (bad session id, missing command, trailing arguments)
  3  PTY_UNAVAILABLE — the host cannot allocate a pty, so no session was
     started. `start` writes the session files with `state=failed` before
     exiting, and `status` then reports `STATE failed` rather than `running`.
"""
import argparse
import os
import pty
import re
import select
import signal
import sys
import tempfile
import time

try:
    import private_paths
except ImportError:  # pragma: no cover - run from an odd loader
    import importlib.util as _ilu
    _HERE = os.path.dirname(os.path.abspath(__file__))
    _PKGS = os.path.dirname(os.path.dirname(_HERE))  # <…>/packages or node_modules
    _found = None
    for _cand in (os.path.join(_PKGS, "common", "scripts"),
                  os.path.join(_PKGS, "dsh-ros2-common", "scripts")):
        _target = os.path.join(_cand, "private_paths.py")
        if os.path.isfile(_target):
            _found = _target
            break
    if _found is None:  # fail loud: the criterion must never silently vanish
        raise
    _SPEC = _ilu.spec_from_file_location("private_paths", _found)
    private_paths = _ilu.module_from_spec(_SPEC)
    _SPEC.loader.exec_module(private_paths)

PID = str(os.getpid())
DIR = os.path.join(os.environ.get("TMPDIR", "/tmp"), "dsh-ros2", "pty")

# A session id becomes `DIR/<sid>.{in,out,meta}`, so it must be ONE safe path
# component: no separator, no `.`/`..`, no control character. Mirrors
# isSafePathComponent in dsh-ros2-common (packages/common/src/names.ts) and
# safe_name() below in robot_profile.py.
_SID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$")


class UnsafeSid(ValueError):
    """A session id that is not one safe path component."""


def safe_sid(sid) -> bool:
    """Whether `sid` may name files under DIR (no path escape)."""
    return bool(isinstance(sid, str) and _SID_RE.match(sid) and ".." not in sid)


def paths(sid):
    # Authoritative guard: `sid` reaches the filesystem HERE, so the check
    # lives beside the join instead of trusting the caller. Without it an
    # absolute sid (os.path.join returns it verbatim) or a `../..` chain
    # escaped DIR and made send/status/stop touch an arbitrary `.in`/`.out`/
    # `.meta` path.
    if not safe_sid(sid):
        raise UnsafeSid(
            "unsafe session id %r: one path component of [A-Za-z0-9._-] required" % (sid,))
    return (os.path.join(DIR, sid + ".out"), os.path.join(DIR, sid + ".in"),
            os.path.join(DIR, sid + ".meta"))


# The session files are created by THIS process, so their mode must not depend on
# the ambient umask. With the common umask 002 the old code produced a 0775
# directory and a 0664 `<sid>.in` — and `<sid>.in` is the STDIN channel of the
# process the caller is driving (the ros2 installer). Anything that can write it
# can type into that process, which is a command channel, not just a leak. The
# `.out`/`.meta` files carry the installer's output. Create them owner-only.
DIR_MODE = 0o700
FILE_MODE = 0o600


def ensure_private_dir(path_):
    """Create `path_` as 0700 and PROVE it is a directory this user owns.

    Round 25 forced the mode and stopped there; the criteria it did not apply
    were the ones that matter for a coordinate someone else may have created
    first: `os.makedirs(..., exist_ok=True)` walks THROUGH a symlink, writes
    happily into a directory owned by another local user, and the old
    `_chmod_quietly` hid a failure. `DIR/*.in` is the stdin channel of the
    process being driven, so "whose directory is this" is the whole question.

    The criteria now come from `packages/common/scripts/private_paths.py`, the
    Python counterpart of `packages/common/src/runtime-dir.ts` (the two are
    pinned to identical verdicts by `tests/private-paths-parity.spec.ts`). Only
    the anchor differs: an explicit `--dir` outside the temp root is the
    caller's own directory, so its mode is left alone — the documented rule.
    """
    try:
        private_paths.ensure_private_dir(path_, label="PTY 会话目录",
                                         anchor=tempfile.gettempdir())
    except private_paths.PrivatePathError as error:
        # Exit 3 = "refused on purpose", distinct from exit 2 (bad arguments) and
        # from a traceback. The tool layer reads stderr verbatim.
        sys.stderr.write("%s: %s\n" % (error.code, error.message))
        sys.exit(3)


def open_private(path_, mode="w"):
    """Open a session file that only its owner may read or write.

    `open()` cannot do this for a file that already exists: it applies `mode`
    only at creation time. `os.open` + `os.fchmod` sets it either way, so a file
    left behind by an older (umask-derived) run is tightened on next use.

    The flags mirror what `open()` does for each mode, which is the part that is
    easy to get wrong: `"a"` APPENDS and must NOT truncate. Truncating there
    destroys the `.in` command channel (the daemon holds its own read offset, so
    input written after a truncation can land behind that offset and never be
    read again) and drops the `state=` line the daemon's stop path checks.
    """
    flags = os.O_WRONLY | os.O_CREAT
    if "a" in mode:
        flags |= os.O_APPEND
    else:
        flags |= os.O_TRUNC
    fd = os.open(path_, flags, FILE_MODE)
    try:
        os.fchmod(fd, FILE_MODE)
    except OSError:
        pass
    return os.fdopen(fd, mode)


def meta_write(sid, state, exit_code=None):
    with open_private(paths(sid)[2], "w") as f:
        f.write("state=%s\n" % state)
        if exit_code is not None:
            f.write("exit=%s\n" % exit_code)
        f.write("pid=%s\n" % PID)


def meta_read(sid):
    m = {"state": "unknown"}
    try:
        with open(paths(sid)[2]) as f:
            for line in f:
                k, _, v = line.partition("=")
                m[k.strip()] = v.strip()
    except FileNotFoundError:
        pass
    return m


def pty_probe():
    """Return a pty, or raise OSError — in the CALLER's process.

    `start` daemonises, and the daemon redirects its stdio to /dev/null, so an
    OSError raised inside it is invisible: the parent has already printed
    `started session … (pid N)` and exited 0. Probing here — in the parent,
    before forking — turns "out of pty devices" into a loud, non-zero exit that
    the tool can report, instead of a session that looks alive and never was.
    """
    master, slave = pty.openpty()
    os.close(master)
    os.close(slave)


def run_start(sid, cmd, args):
    ensure_private_dir(DIR)
    out_path, in_path, _ = paths(sid)
    with open_private(out_path, "w") as _f:
        pass
    with open_private(in_path, "w") as _f:
        pass
    meta_write(sid, "starting")
    # child pid holder
    child = [None]

    def _spawn():
        pid = os.fork()
        if pid == 0:
            os.setsid()
            # 把 pty slave 接到子进程的 stdio（交互式程序通过 pty 读写）
            for fd in (0, 1, 2):
                try:
                    os.dup2(slave, fd)
                except OSError:
                    pass
            try:
                os.execvp(cmd, [cmd] + args)
            except Exception as e:  # noqa: BLE001
                sys.stderr.write("exec failed: %s\n" % e)
                os._exit(127)
        child[0] = pid
        return pid

    # master/slave. `main()` probes this in the parent before forking, so this
    # failure is normally reported there with exit 3; this guard covers the race
    # where the probe won and this allocation lost, and keeps the failure
    # visible instead of dying silently into the daemon's /dev/null stdio.
    try:
        master, slave = pty.openpty()
    except OSError as e:
        meta_write(sid, "failed")
        with open_private(out_path, "ab") as f:
            f.write(("PTY_UNAVAILABLE: %s\n" % e).encode("utf-8", "replace"))
        return
    # master must be non-blocking: select() may report it ready while read()
    # would block, which would starve the input-forwarding path.
    try:
        os.set_blocking(master, False)
    except OSError:
        pass
    pid = _spawn()
    os.close(slave)
    meta_write(sid, "running", None)  # keep pid current

    out_f = open_private(out_path, "ab")
    in_f = open(in_path, "rb")
    status_f = open_private(paths(sid)[2], "a")
    status_f.write("child=%s\n" % pid)
    status_f.close()

    exited = False
    while True:
        try:
            r, _, _ = select.select([master, in_f], [], [], 0.5)
        except (OSError, ValueError):
            break
        # drain pty output (one read per pass; read() may block otherwise)
        try:
            data = os.read(master, 4096)
            if data:
                out_f.write(data)
                out_f.flush()
        except OSError:
            pass
        # forward pending input
        try:
            data = in_f.read(4096)
            if data:
                os.write(master, data)
        except OSError:
            pass
        # check child status
        if not exited:
            wpid, status = os.waitpid(pid, os.WNOHANG)
            if wpid == pid:
                exited = True
                code = os.waitstatus_to_exitcode(status)
                meta_write(sid, "exited", code)
        if exited:
            # drain remaining output briefly (bounded, non-blocking-ish)
            for _ in range(5):
                try:
                    time.sleep(0.1)
                    data = os.read(master, 4096)
                    if not data:
                        break
                    out_f.write(data)
                    out_f.flush()
                except OSError:
                    break
            break
        # stop request: meta state overwritten to 'stopping' by stop cmd
        if meta_read(sid).get("state") == "stopping":
            try:
                os.kill(pid, signal.SIGTERM)
                time.sleep(1)
                os.kill(pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
            meta_write(sid, "exited", -1)
            break
    out_f.close()
    in_f.close()


def run_send(sid, text):
    _, in_path, _ = paths(sid)
    with open_private(in_path, "ab") as f:
        if not text.endswith("\n"):
            text += "\n"
        f.write(text.encode("utf-8", "replace"))


def run_status(sid, all_out):
    out_path, _, _ = paths(sid)
    try:
        with open(out_path, "rb") as f:
            if not all_out:
                # last read position marker file
                mark = out_path + ".mark"
                try:
                    f.seek(int(open(mark).read()))
                except (FileNotFoundError, ValueError):
                    f.seek(0, os.SEEK_END)
                    try:
                        with open_private(mark, "w") as mf:
                            mf.write(str(f.tell()))
                    except OSError:
                        pass
                    # first status: print everything seen so far
                    f.seek(0)
                data = f.read()
                try:
                    with open_private(mark, "w") as mf:
                        mf.write(str(f.tell()))
                except OSError:
                    pass
            else:
                data = f.read()
    except FileNotFoundError:
        data = b""
    text = data.decode("utf-8", "replace")
    if text:
        sys.stdout.write(text)
        if not text.endswith("\n"):
            sys.stdout.write("\n")
    m = meta_read(sid)
    state = m.get("state", "unknown")
    if state == "exited":
        print("STATE exited exit=%s" % m.get("exit", "?"))
    elif state == "running":
        print("STATE running")
    else:
        # `unknown` (no such session) and `failed` (the pty could not be
        # allocated) are NOT running. Reporting every non-`exited` state as
        # `running` is what let a session that never started look alive.
        print("STATE %s" % state)


def run_stop(sid):
    _, _, meta_path = paths(sid)
    # A session whose start failed has no daemon and no child to signal;
    # waiting for it to reach `exited` would just burn the poll budget.
    if meta_read(sid).get("state") == "failed":
        print("stopped")
        return
    with open_private(meta_path, "w") as f:
        f.write("state=stopping\n")
    # give the daemon a moment, then hard-kill the child if needed
    for _ in range(10):
        if meta_read(sid).get("state") == "exited":
            print("stopped")
            return
        time.sleep(0.3)
    # kill child pid directly
    child = meta_read(sid).get("child")
    if child:
        try:
            os.kill(int(child), signal.SIGKILL)
        except (ProcessLookupError, ValueError):
            pass
    print("stopped")


def main():
    global DIR
    # Options are declared BEFORE the positionals on purpose: `rest` is a
    # REMAINDER, so everything after `sid` is captured verbatim and a flag
    # written there is not a flag at all. `start s1 bash boot --dir X` used to
    # hand `--dir X` to the installer AND silently ignore the requested dir;
    # `status s1 --all` silently never enabled `--all`. Flags come first.
    ap = argparse.ArgumentParser()
    ap.add_argument("--dir", default=DIR)
    ap.add_argument("--all", action="store_true")
    ap.add_argument("action", choices=["start", "send", "status", "stop"])
    ap.add_argument("sid")
    ap.add_argument("rest", nargs=argparse.REMAINDER)
    args = ap.parse_args()
    DIR = args.dir
    # Fail fast and loudly, before forking: `start` runs in a child that ends
    # with os._exit(0), so an UnsafeSid raised there would vanish silently.
    if not safe_sid(args.sid):
        print("unsafe session id %r: only [A-Za-z0-9._-], no separator or '..'"
              % (args.sid,), file=sys.stderr)
        sys.exit(2)
    if args.action in ("status", "stop") and args.rest:
        # Reject rather than ignore: a swallowed `--dir` still exits 0 and
        # reports success, for a directory that was never the one read from.
        print("%s takes no arguments after the session id (got %r); flags such "
              "as --dir/--all must come BEFORE the action"
              % (args.action, " ".join(args.rest)), file=sys.stderr)
        sys.exit(2)
    if args.action == "start":
        rest = args.rest
        if rest and rest[0] == "--":
            rest = rest[1:]
        if not rest:
            print("start requires a command", file=sys.stderr)
            sys.exit(2)
        # The directory criterion must run HERE, in the parent, BEFORE the fork —
        # for exactly the reason the pty probe does. The daemon's stdio is
        # /dev/null, so a refusal that happened after `os.fork()` died silently
        # there while this process printed `started session … (pid N)` and exited
        # 0: a phantom session in a directory that was never ours. Measured on a
        # pty-capable host (CI): a symlinked `--dir` produced exit 0, while on a
        # host that cannot allocate a pty the same call exited 3 — the local suite
        # was green for the wrong reason. `run_start` keeps its own check for the
        # daemon path (defence in depth).
        ensure_private_dir(DIR)
        try:
            pty_probe()
        except OSError as e:
            out_path, in_path, _ = paths(args.sid)
            for p in (out_path, in_path):
                with open_private(p, "w") as _f:
                    pass
            meta_write(args.sid, "failed")
            with open_private(out_path, "ab") as f:
                f.write(("PTY_UNAVAILABLE: %s\n" % e).encode("utf-8", "replace"))
            print("PTY_UNAVAILABLE: cannot allocate a pty (%s); no session started"
                  % e, file=sys.stderr)
            sys.exit(3)
        # daemonize: fork a background session process and return immediately
        pid = os.fork()
        if pid == 0:
            os.setsid()
            with open(os.devnull, "w") as dn:
                try:
                    os.dup2(dn.fileno(), 0)
                    os.dup2(dn.fileno(), 1)
                    os.dup2(dn.fileno(), 2)
                except OSError:
                    pass
            run_start(args.sid, rest[0], rest[1:])
            os._exit(0)
        print("started session %s (pid %d)" % (args.sid, pid))
    elif args.action == "send":
        run_send(args.sid, " ".join(args.rest))
    elif args.action == "status":
        run_status(args.sid, args.all)
    elif args.action == "stop":
        run_stop(args.sid)


if __name__ == "__main__":
    main()
