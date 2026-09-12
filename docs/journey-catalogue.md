# Journey catalogue — need-shaped composition

> Status: **implemented** (issue #19, slice 1 + slice 3). Slice 2 (the scope
> proof) is recorded in §5 rather than shipped as a preset, for the reasons
> documented there.

The capability surface used to grow with ROS2's verb count while the questions
operators actually ask stayed a small, stable set. This document is the
catalogue that closes that gap: a recurring operator question ("journey") gets
an L1 entry point, the primitives that follow it, and an L2 carrier skill that
routes to them.

## 1. The asymmetry being fixed

| | before | after |
| --- | --- | --- |
| tools (verb-shaped, plus a few aggregates) | 83 across 6 bundles | 83 |
| skills (procedure-shaped, one carrier per journey) | 4 | 9 |

That was ~21 tools per skill, with 5 of the 8 journeys having no carrier at all
— concentrated exactly where this project already paid for lessons: bring-up /
environment recovery, liveness triage, TF integrity, motion, safety.

Three measurements from this repo's own A/B work
([verification-toolchain-efficiency.md](verification-toolchain-efficiency.md))
shape the design:

1. **Agent wall time is round-trip bound, not command bound.** On a 10-node
   system the ROS2 work was ~10 s of a 22–88 s run.
2. **Aggregates pay; extra verbs do not.** `ros2_topology` took a full
   inventory from 14 tool calls to 4; `ros2_topic_sample` took
   info + echo + hz from 2–3 calls to 1.
3. **Routing is carried by skills and descriptions, not prompt prose.** Agents
   consult the skill catalog first; the system-prompt section is reinforcement.

## 2. The layering

| | what it is | where it lives |
| --- | --- | --- |
| **L0 primitives** | one tool per capability, verb-shaped | `packages/*/src/tools.ts` |
| **L1 aggregates** | one call per *recurring question* — the only layer that removes round-trips | same |
| **L2 journeys** | a skill: the procedure, the decision points, which L1 to start from — the layer agents read first | `packages/*/src/skill.ts` |
| **L3 scope** | which subset an agent sees | bundle mount (profile composition) + `tools.restrict` (per agent scope) |

L0 is deliberately kept: flexibility is an explicit requirement, and the
aggregates are additions rather than replacements.

## 3. The catalogue

Eight journeys, nine carriers — every shipped skill carries a journey, and
every journey has at least one carrier.

| journey | question | L1 entry | primitives that follow | carrier (bundle) |
| --- | --- | --- | --- | --- |
| `topology` | What does this system look like? | `ros2_topology` | `ros2_graph`, `ros2_*_list` | `ros2-diagnostics` (core) |
| `liveness` | Is it alive / why is it stale? | `ros2_topology {rates}` | `ros2_topic_sample`, `ros2_topic_hz`, `ros2_topic_info`, `ros2_topic_echo` | `ros2-liveness-triage` (core) |
| `bringup` | It won't come up | `ros2_env_check` | `ros2_workspace`, `ros2_launch`, `ros2_run`, `ros2_job_status`, `ros2_doctor` | `ros2-bringup-recovery` (core) |
| `tf` | Is the TF tree right? | `ros2_topology {tf}` | `ros2_tf_list`, `ros2_tf_echo` | `ros2-tf-integrity` (core) |
| `body` | What robot is this? | `robot_load` | `robot_register`, `robot_topology`, `ros2_zero_pose_semantics` | `robot-registration`, `robot-retrieval` (profile) |
| `state` | What state is it in? | `ros2_image_snapshot` | `ros2_vision_analyze`, `ros2_vision_describe`, `state_get` | `robot-state-vision-analysis` (vision) |
| `motion` | Can it move / how? | `moveit_status` | `moveit_discover`, `moveit_move`, `motion_validate`, `ros2_job_status` | `robot-motion-control` (moveit) |
| `safety` | Is it safe? | `robot_safety_state` | `robot_safety_start`, `robot_safety_arbitrate`, `robot_safety_lock`, `robot_safety_unlock` | `robot-safety-procedure` (safety) |

> **Correction to the RFC text.** The RFC says "9 journeys, 4 carriers" but the
> table it ships has **8** rows; the 9th count appears to be a miscount. After
> this change the correct figures are **8 journeys / 9 carriers**.

### Why each carrier rides its own bundle

A skill is registered by the bundle that ships the tools it routes to
(`core` → bring-up/liveness/TF/diagnostics, `moveit` → motion, `safety` →
safety). A lean `dsh-ros2-core` install therefore advertises four carriers and
is never told to move a robot it cannot move — the same rule the system-prompt
guidance already follows by rebuilding its text from the registered tools.

## 4. The invariant

[`packages/dsh-ros2/tests/journey-catalogue.ts`](../packages/dsh-ros2/tests/journey-catalogue.ts)
is the single source of truth;
[`journeys.spec.ts`](../packages/dsh-ros2/tests/journeys.spec.ts) asserts:

1. every journey's **entry tool and primitives still exist** as registered tools;
2. every **carrier is defined** in its bundle's `skill.ts` *and* **wired** with
   `ctx.skills.register(...)` in that bundle's `index.ts` (reachable in the
   scope that claims it);
3. **no journey is uncovered and no shipped skill is uncatalogued** — the
   carrier set equals the skill set;
4. the **advertised counts and skill lists match the tree** (README,
   README_CN, package descriptions).

A rename can no longer silently break a journey. Verified to have teeth — the
negative check

```text
journey "bringup" entry tool: expected [ 'ros2_graph', …(82) ] to include 'ros2_env_check_RENAMED'
```

fails the suite. Assertion 4 caught real drift in the round that introduced it:
README and the aggregate metadata advertised **79 tools** while the tree
shipped **83**, and core's description advertised 59 against an actual 61.

## 5. L3 scope — two mechanisms, and a correction to the RFC

The RFC's slice 2 proposed "a diagnostics-only preset that mounts
`dsh-ros2-core` and uses `tools.restrict` to drop motion/safety tools". Two
verified points make that formulation imprecise:

1. **Mounting only `dsh-ros2-core` already yields a diagnostics-only surface.**
   The domain capabilities are separate npm packages and separate cordis
   bundles; the profile composition decides which mount. No `restrict` call is
   involved.
2. **`tools.restrict(filter)` is for the other case** — the full set is already
   mounted *globally* and one agent scope must see less. Verified against
   `@deepseek-ai/dsh-tools`, its contract is stricter than the RFC assumed:
   - it requires a **scoped** context (an agent scope); a context-global call
     throws `tools.restrict() requires a scoped context (agent.ctx): a
     context-global restriction would mask every agent`;
   - `restrict({})` is rejected as a no-op, and **unknown tool names throw**,
     listing the known global tools;
   - restrictions **intersect**, and the returned disposer lifts exactly one;
     scoped registrations remain visible;
   - the reserved `run_code` PTC transport cannot be named.

So "mount core and restrict away motion/safety" mixes the two mechanisms — and
in a core-only mount `restrict` would *throw*, because `moveit_move` and
`robot_safety_state` are not global there.

**Recipe (not shipped).** Presets live in the harness preset directory, not in
this npm package, and a `restrict`-only behaviour cannot be verified from this
repo's CI without a live agent scope. The supported narrowing is therefore:

- **install-level**: list only the bundles a deployment needs (e.g. the
  `dsh-ros2-core` bundle alone for diagnostics work);
- **per-agent scope**: with the aggregate mounted, a plugin running in the
  preset's agent scope may call `ctx.tools.restrict({ deny: [...] })` (or
  `{ allow: [...] }`), and the disposer lifts it when the scope goes away.

A future round could ship a preset under `${DSH_HOME}/.agent-presets/<id>/`
and measure the exposed surface, which is what would turn this from a recipe
into a verified artifact.

## 6. How to tell it works

The RFC's success criterion: **a journey answered in ≤2 calls from one L1 entry
point**, plus a narrow scope exposing a measurably smaller surface.

Method: reuse the hand-built 10-node system from
[verification-toolchain-efficiency.md](verification-toolchain-efficiency.md)
(turtlesim + hand-written `lab_sensor` / `lab_service` / `lab_action` +
`demo_nodes_cpp` + `action_tutorials_cpp` + a latched static
`static_transform_publisher`; 10 nodes, 13 topics, 82 services, 4 actions, one
TF tree with a dynamic and a latched edge), then count tool calls and wall time
from question to answer, per journey.

**Outstanding:** not re-measured in this round — that test system was not
running. The catalogue and its invariant are the enabling work; the ≤2-call
measurement remains the acceptance test.

## 7. Non-goals (unchanged)

- Removing primitives — flexibility is an explicit requirement.
- One tool per ROS2 verb.
- More system-prompt prose: the measurements say descriptions and skills carry
  routing, so new routing lives in the skills catalogued above.
