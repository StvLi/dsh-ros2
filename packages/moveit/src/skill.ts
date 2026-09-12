import type { SkillRegistration } from '@deepseek-ai/dsh-skill'

/**
 * The bundled `robot-motion-control` journey skill: "can it move / how?" —
 * the single plan → validate → approve → execute → verify path, with no
 * structural shortcut around validation, approval or the safety gate.
 */
export const robotMotionControlSkill: SkillRegistration = {
  name: 'robot-motion-control',
  description: 'Move a robot through MoveIt2 the one supported way: check the stack, pick the planning group, plan without executing, validate deterministically, then execute through the approval and safety gate and verify the result.',
  whenToUse: 'Use when the user asks whether a robot can move, how to move it, or to reach a pose / joint target — or when a motion must be planned, dry-run, validated or explained.',
  source: 'runtime',
  invocation: { modelInvocable: true, userInvocable: true },
  content: `# Robot Motion Control (MoveIt2)

Journey: **"can it move / how?"** There is exactly one execution path, and no
shortcut around it:

\`REQUEST → NORMALIZE → PLAN → VALIDATE → APPROVAL → FINGERPRINT CHECK → EXECUTE → WATCHDOG → VERIFY → RESULT\`

## 1. Is the stack even up? (L1 entry)

\`moveit_status\` (read-only) reports whether the standard interfaces are
online — \`/move_action\`, \`/execute_trajectory\`, \`/compute_cartesian_path\`,
controller_manager — plus a sample of the current joint state and the SRDF
planning frame.

Interfaces offline means there is nothing to move yet: that is a bring-up
problem, not a motion problem — follow \`ros2-bringup-recovery\`.

## 2. What can this robot do?

- \`moveit_discover\` — the SRDF planning **groups** and their **named poses**,
  and which standard interfaces respond. Narrow with \`package\` or \`srdf\`.
- \`robot_load {name}\` — the registered body profile (groups, links, TF root,
  zero-pose semantics). One call instead of re-discovery once a robot is known.
- \`robot_topology {robot, action: "search"}\` — which node owns which topic
  (move_group, controller_manager) when the interface list looks wrong.

Take **group** and **joint names** from here. Never guess them: they must match
the SRDF/URDF exactly or planning fails for a reason that looks unrelated.

## 3. Plan without moving

\`moveit_move {mode, group, planOnly: true, trajectoryOut: "<path>"}\` plans and
saves a trajectory, and never executes. Five modes behind the one tool:

| mode | argument | meaning |
| --- | --- | --- |
| \`joint_abs\` | \`joints "j1:=v1 j2:=v2"\` | absolute joint target |
| \`joint_rel\` | \`deltaJoints "j1:=dv1 ..."\` | current position + delta |
| \`pose_abs\` | \`pose "x y z rx ry rz"\` | end-effector pose in the planning frame |
| \`pose_rel\` | \`deltaPose "dx dy dz drx dry drz"\` | relative offset, \`frame: ee\` or \`world\` |
| \`trajectory\` | \`trajectory "<path>"\` | execute a previously saved trajectory JSON |

## 4. Validate deterministically (no LLM involved)

\`motion_validate {trajectory, robot, group}\` checks a planned trajectory
against the robot profile: joint limits (position/velocity/acceleration),
NaN/Inf, joint names and group coverage, monotonic timestamps, duration, state
freshness, optional pose workspace box, fingerprint + TTL.

- Collision and singularity checking belongs to MoveIt planning, **not** here.
- Pass \`robot\` (a registered profile) to \`moveit_move\` / \`motion_validate\` to
  enable **full** checks: joint limits from the URDF, group coverage, workspace
  box, freshness, fingerprint. Without it, unknown limits only warn.

## 5. Execute through the one gate

\`moveit_move\` **without** \`planOnly\` runs the full path: plan → deterministic
validation → **human approval** (the validation summary is shown) → execute →
verify.

- Approval is **fail-closed**: no approval service, or a rejection, means no motion.
- The \`/safety/state\` gate is checked before execution; **LOCKED is always
  rejected**. Read \`robot_safety_state\` first — a LOCKED robot is a stop signal
  to report, never something to work around (see \`robot-safety-procedure\`).
- Validation failure is decided **before** approval (\`VALIDATION_FAILED\`).
- If the plan or robot state changes after approval, execution is refused
  (\`VALIDATION_CHANGED\`): re-plan instead of retrying blindly.

## 6. Verify the result

The tool distinguishes **pass / fail / unavailable** by comparing the final
joints against the expectation within tolerance — do not report success from
"the call returned". Re-read with \`moveit_status\`; long-running steps are
tracked with \`ros2_job_status\`.

## Rules

- **Never bypass the gate** with \`ros2 topic pub\`, a hand-rolled rclpy script,
  or a directly started controller: that skips validation, approval and the
  safety gate in one move.
- Prefer \`planOnly\` → inspect → execute (plan/execute separation), especially
  on first contact with a robot.
- Report the layer that refused the motion (validation, approval, safety gate)
  rather than a generic failure.`,
}
