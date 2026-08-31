# dsh-ros2-sidecar

Data-plane **sidecar** framework（逻辑直连 · 物理分离）— an independent process that
subscribes high-frequency ROS2 topics, reduces them to **semantic cache entries**
(`value` for logic, `text` for the LLM), and serves the control plane over a
Unix Domain Socket (newline-JSON). **Not a cordis bundle.**

Concrete reducers (e.g. obstacle boolean, cup TF pose) are by design **not
implemented** — this ships the template framework only:

- `sidecar/core.py` — `CacheEntry` / `Reducer` base / `Cache` (pure logic, no rclpy)
- `sidecar/server.py` — UDS newline-JSON server (`get` / `snapshot` / `subscribe` + heartbeat)
- `sidecar/reducers_placeholder.py` — a placeholder reducer (the template to copy)
- `sidecar/selftest.py` — `--selftest` (10 scenarios, no rclpy)

Run the self test:

```bash
cd packages/sidecar && python3 -m sidecar.selftest
```

See `docs/sidecar-design.md` for the full design (control-plane client lives in
**dsh-ros2-state**).
