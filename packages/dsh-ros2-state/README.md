# dsh-ros2-state

Control-plane **state client** for the dsh-ros2-sidecar data plane (逻辑直连 ·
物理分离): a long-lived Unix Domain Socket connection (newline-JSON), letting
the Agent read **reduced, fresh robot state in milliseconds** — no ROS2
subprocess per read, because the sidecar continuously reduces high-frequency
topics into a semantic cache.

- `src/state-client.ts` — `StateClient` (get / snapshot / subscribe / close), `UdsStateClient` impl (request_id concurrency, heartbeat, STALE/DOWN/TIMEOUT)
- `src/tools.ts` — `state_get` / `state_snapshot` (read-only), via the `deps.state` seam
- `src/config.ts` — `state { socketPath, timeoutMs, tcp }`

> The sidecar (data plane) is `dsh-ros2-sidecar`; this package is the
> control plane that connects to it. See `docs/sidecar-design.md`.

**Config** (`state.socketPath`): path to the sidecar UDS socket.
**fail-closed**: safety-relevant reads surface `STALE`/`DOWN` as structured
errors — treat them as unsafe.
