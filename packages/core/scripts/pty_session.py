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
                        plus a final line: STATE <running|exited> [exit=<n>]
  stop  <id>            terminate the pty child (SIGTERM then SIGKILL)
"""
import argparse
import os
import pty
import select
import signal
import sys
import time

PID = str(os.getpid())
DIR = os.path.join(os.environ.get("TMPDIR", "/tmp"), "dsh-ros2", "pty")


def paths(sid):
    return (os.path.join(DIR, sid + ".out"), os.path.join(DIR, sid + ".in"),
            os.path.join(DIR, sid + ".meta"))


def meta_write(sid, state, exit_code=None):
    with open(paths(sid)[2], "w") as f:
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


def run_start(sid, cmd, args):
    os.makedirs(DIR, exist_ok=True)
    out_path, in_path, _ = paths(sid)
    with open(out_path, "w") as _f:
        pass
    with open(in_path, "w") as _f:
        pass
    meta_write(sid, "running")
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

    # master/slave
    master, slave = pty.openpty()
    # master must be non-blocking: select() may report it ready while read()
    # would block, which would starve the input-forwarding path.
    try:
        os.set_blocking(master, False)
    except OSError:
        pass
    pid = _spawn()
    os.close(slave)
    meta_write(sid, "running", None)  # keep pid current

    out_f = open(out_path, "ab")
    in_f = open(in_path, "rb")
    status_f = open(paths(sid)[2], "a")
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
    with open(in_path, "ab") as f:
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
                        with open(mark, "w") as mf:
                            mf.write(str(f.tell()))
                    except OSError:
                        pass
                    # first status: print everything seen so far
                    f.seek(0)
                data = f.read()
                try:
                    with open(mark, "w") as mf:
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
    if m["state"] == "exited":
        print("STATE exited exit=%s" % m.get("exit", "?"))
    else:
        print("STATE running")


def run_stop(sid):
    _, _, meta_path = paths(sid)
    with open(meta_path, "w") as f:
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
    ap = argparse.ArgumentParser()
    ap.add_argument("action", choices=["start", "send", "status", "stop"])
    ap.add_argument("sid")
    ap.add_argument("rest", nargs=argparse.REMAINDER)
    ap.add_argument("--dir", default=DIR)
    ap.add_argument("--all", action="store_true")
    args = ap.parse_args()
    DIR = args.dir
    if args.action == "start":
        rest = args.rest
        if rest and rest[0] == "--":
            rest = rest[1:]
        if not rest:
            print("start requires a command", file=sys.stderr)
            sys.exit(2)
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
