import type { SkillRegistration } from '@deepseek-ai/dsh-skill'

/**
 * The bundled `robot-safety-procedure` journey skill: "is it safe?" — read the
 * latch, treat LOCKED as a stop signal, and state the safety boundaries
 * honestly instead of reassuring.
 */
export const robotSafetyProcedureSkill: SkillRegistration = {
  name: 'robot-safety-procedure',
  description: 'Handle robot safety as a procedure: read the latched safety state, start the monitor, treat LOCKED as a stop signal, arbitrate semantically with the VLM, and state what the layers do and do not guarantee.',
  whenToUse: 'Use when the question is whether a robot is safe to move, when /safety/state is LOCKED or the monitor is not running, before first motion on a robot, or when a safety verdict must be reported.',
  source: 'runtime',
  invocation: { modelInvocable: true, userInvocable: true },
  content: `# Robot Safety Procedure

Journey: **"is it safe?"** Read the latch first, report LOCKED as a stop signal,
recover deliberately — and state the boundaries instead of offering
reassurance.

## 1. Read the latch first (L1 entry)

\`robot_safety_state\` — the latched \`/safety/state\` (transient-local): NORMAL or
LOCKED, with severity, trigger cause and detail.

- \`monitor_running: false\` means the monitor is **not running**. That is
  *unknown*, never *safe* — say so explicitly.
- The latch does not clear itself; it survives until a human unlocks.

## 2. Start / configure the monitor

\`robot_safety_start {robot}\` (approval-gated, background job) reads the
profile's \`safety\` section — joint feedback topic, optional command/torque
topics, thresholds, watchdog critical/observed lists, lock action — and:

- latches **LOCKED** on a CRITICAL event;
- publishes \`/safety/state\` (transient-local) and \`/safety/heartbeat\`;
- fires \`/safety/lock_active\` once.

With the monitor absent, the tool layer is fail-closed according to
\`safetyStrict\`: \`reject\` blocks motion, \`warn\` proceeds with a note. Never
present a \`warn\` pass as a safety guarantee.

## 3. LOCKED is a stop signal

- Motion tools gate on \`/safety/state\`; a LOCKED robot is **always** rejected.
- Do **not** clear the latch to make progress. Report severity, cause and detail
  to the human and stop.
- Recovery order: \`robot_safety_unlock\` (human-gated, approval) → **re-home the
  robot** → resume the task.

## 4. Semantic arbitration (the slow layer — pull it up when needed)

\`robot_safety_arbitrate {taskContext, cause, joints, frame}\` sends a fixed
safety prompt (task context + trigger cause + joint state + a **fresh offscreen
render frame**) to the VLM and returns \`safe | unsafe | uncertain\`.

- **\`uncertain\` is not \`safe\`.** Any non-safe verdict must be escalated to a human.
- Confirmed danger → \`robot_safety_lock\` (approval) to latch LOCKED; unlock only
  after recovery.
- Trigger causes it is meant for: plan change, tracking error, stall, feedback
  loss, watchdog critical, torque spike/overload — not every motion step.

## 5. The layers you are relying on

| layer | covers | owned by |
| --- | --- | --- |
| 1 Agent permission | who may call which tool | DSH / plugin registration |
| 2 Human approval | every write/motion before execution, fail-closed | tool layer |
| 3 Motion validation | deterministic limits, NaN/Inf, freshness, fingerprint + TTL | \`motion_validator.py\` |
| 4 Execution monitoring | tracking/stall with hysteresis, feedback loss, watchdog, torque; latches LOCKED | \`safety_monitor\` node (200 Hz) |
| 5 Post-hoc verification | final joints vs expected (pass/fail/unavailable) | \`moveit_move\` |
| 6 Physical robot safety | limit switches, torque limits, E-stop | **the robot vendor / downstream integration** |

Single execution path (see \`docs/safety.md\`):
\`REQUEST → NORMALIZE → PLAN → VALIDATE → APPROVAL → FINGERPRINT CHECK → EXECUTE → WATCHDOG → VERIFY → RESULT\`.
No structural path skips validation.

## 6. Boundaries — state them, do not overclaim

- DSH approval is **not** a substitute for motion validation.
- Motion validation is **not** a substitute for certified robot safety.
- DSH is **not** a functional-safety controller, and nothing here is a certified
  safety PLC.
- **No software E-stop is implemented**: \`safety.estop\` is a reserved,
  disabled interface — do not present it as a stop guarantee.
- Physical E-stop, limit switches and hardware torque limits must come from the
  robot body and be integrated downstream (\`lock_action\`, \`/safety/lock_active\`).

Full statement: \`docs/safety.md\` and \`docs/safety-handover.md\`.`,
}
