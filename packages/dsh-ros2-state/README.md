# dsh-ros2-state

Control-plane **state client** for the dsh-ros2-sidecar data plane (逻辑直连 ·
物理分离): a long-lived Unix Domain Socket connection (newline-JSON), letting
the Agent read **reduced, fresh robot state in milliseconds** — no ROS2
subprocess per read, because the sidecar continuously reduces high-frequency
topics into a semantic cache.

- `src/state-client.ts` — `StateClient` (get / snapshot / subscribe / close), `UdsStateClient` impl (request_id concurrency, heartbeat, STALE/DOWN/TIMEOUT, **peer identity**)
- `src/tools.ts` — `state_get` / `state_snapshot` (read-only), via the `deps.state` seam
- `src/config.ts` — `state { socketPath, timeoutMs, tcp }`

> The sidecar (data plane) is `dsh-ros2-sidecar`; this package is the
> control plane that connects to it. See `docs/sidecar-design.md`.

**Config** (`state.socketPath`): the sidecar UDS path. The default is a
**private** coordinate — `$XDG_RUNTIME_DIR/dsh-ros2/sidecar.sock` when the
session manager provides one, otherwise `~/.dsh-ros2/run/sidecar.sock` (both
directories are 0700, `packages/sidecar/sidecar/node.py` computes the same
path, and a test keeps the two ends from drifting).

**Setting `socketPath` explicitly still works — including a `/tmp` path — but it
is verified, not assumed.** Before every first connect the client runs
`checkLocalSocketPeer` (`packages/common/src/local-socket.ts`) and **refuses**
with a structured code when the coordinate is not provably ours:

| code | meaning |
| --- | --- |
| `PEER_ABSENT` | nothing at that path (sidecar not running / wrong path) |
| `PEER_SYMLINK` | the path is a symlink (judge the inode, never follow the link) |
| `PEER_NOT_SOCKET` | it is not a unix socket |
| `PEER_NOT_OWNED` | the socket belongs to another uid |
| `PEER_WORLD_WRITABLE` | mode grants group/other write — anyone could be the sidecar |
| `PEER_SHARED_PARENT` | its directory is group/other-writable **and not sticky** (the inode could be replaced) |
| `PEER_REMOTE_HOST` | `tcp: true` with a non-loopback host |

This matters because the data is handed to the model **as fact** ("no obstacle
in front", "robot not locked"). A socket protocol with no authentication can
only be trusted by proving who owns the coordinate; Node does not expose
`SO_PEERCRED`, so ownership is checked immediately before `connect`. Round 27
measured the pre-fix behaviour: a fake sidecar bound at
`/tmp/dsh-ros2-sidecar.sock` was accepted, and a symlink at that path was
followed.

**TCP mode** (`tcp: true`) accepts `"port"` or `"host:port"` — **loopback only**.
(The documented `"host:port"` form never worked before round 27:
`Number("127.0.0.1:9000")` is `NaN` → `ERR_SOCKET_BAD_PORT`.)

**fail-closed**: safety-relevant reads surface `STALE`/`DOWN` as structured
errors — treat them as unsafe. A refused peer is an error too, never a fallback
to "assume it is the sidecar".
