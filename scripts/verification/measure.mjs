#!/usr/bin/env node
/**
 * Verification rig — measure the journey acceptance criterion (issue #19).
 *
 *   scripts/verification/system.sh start
 *   node scripts/verification/measure.mjs
 *   scripts/verification/system.sh stop
 *
 * For each catalogued journey that this rig can exercise, run its L1 entry
 * point(s) against the live system, count the tool calls and time them. The
 * RFC's criterion is "a journey answered in <=2 calls from one L1 entry
 * point"; the verdict column says whether the answer was actually complete.
 *
 * Journeys needing hardware that this rig does not have (motion/MoveIt, VLM
 * vision, the sidecar state plane) are reported as `not_measurable` rather
 * than scored — see docs/journey-catalogue.md §6.
 *
 * Uses the workspace's *built* lib/ output, so run `pnpm run build` first.
 */
import { existsSync, lstatSync, mkdirSync, mkdtempSync, statSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import path from 'node:path'

const RUN_DIR = process.env.VERIF_RUN_DIR ?? '/tmp/dsh-ros2-verification'
const ROS_SETUP = process.env.ROS_SETUP ?? '/opt/ros/jazzy/setup.bash'
const ROBOT = process.env.VERIF_ROBOT ?? 'labbot'
const PROFILES_DIR = process.env.VERIF_PROFILES_DIR ?? `${RUN_DIR}/profiles`

/**
 * The run directory is a fixed, SHARED coordinate — `system.sh` and this script
 * have to agree on it, so unlike a fixture it cannot be a fresh `mkdtemp` path
 * per run. That leaves the one thing a fixed path in `/tmp` always leaves: it
 * is in a 1777 sticky directory, so any local user can create
 * `/tmp/dsh-ros2-verification` first (or make it a symlink to somewhere else),
 * and this rig then writes URDF/profile fixtures into a directory it does not
 * own — and `spawnSync`s a helper that reads them back out.
 *
 * The fix is therefore not a random name but a REFUSAL: a pre-existing run
 * directory must be ours and private, or the rig stops and says so.
 * `system.sh` makes the same check, in the same order, so the two cannot
 * disagree about which directory is acceptable.
 */
function ensureRunDir(dir) {
  const refuse = (why) => {
    console.error(`refusing to use the verification run directory ${dir}: ${why}\n` +
      'Point VERIF_RUN_DIR at a directory you own (mode 0700) or remove the existing one.')
    process.exit(3)
  }
  if (existsSync(dir)) {
    // Refuse a symlink OUTRIGHT rather than judging its target. Following it
    // and checking the target's owner is not equivalent: the coordinate is in
    // a 1777 directory, so the link can be swapped between this check and the
    // write that follows it. A refusal has no such window, and the case it
    // removes (someone pointing the run dir somewhere else) has no legitimate
    // use — set VERIF_RUN_DIR to the real path instead.
    if (lstatSync(dir).isSymbolicLink()) refuse('is a symlink (point VERIF_RUN_DIR at the real path)')
    // Past the symlink refusal this describes the directory itself.
    const st = statSync(dir)
    if (!st.isDirectory()) refuse('not a directory')
    // process.getuid is absent on Windows; the rig is Linux-only (ROS2, setsid,
    // /dev/shm), so treat "no getuid" as "cannot verify ownership" and refuse
    // rather than silently accepting.
    if (typeof process.getuid !== 'function') refuse('cannot verify ownership on this platform')
    if (st.uid !== process.getuid()) refuse(`owned by uid ${st.uid}, not you (uid ${process.getuid()})`)
    const perms = st.mode & 0o777
    if ((perms & 0o077) !== 0) refuse(`mode is ${perms.toString(8).padStart(3, '0')}, which is wider than 700`)
    return
  }
  // Create it private at birth. umask can only remove bits, so 0700 is a ceiling.
  mkdirSync(dir, { recursive: true, mode: 0o700 })
}

ensureRunDir(RUN_DIR)

// UDP-only transport keeps the rig working where /dev/shm is not writable
// (otherwise FastDDS logs shared-memory errors — to stdout, hence the lesson
// behind the parseJsonOrRaw fix — and the graph shrinks).
process.env.FASTDDS_BUILTIN_TRANSPORTS ??= 'UDPv4'

const pkg = (name) => new URL(`../../packages/${name}/lib/`, import.meta.url).href
const common = await import(pkg('common') + 'index.js')
const core = await import(pkg('core') + 'tools.js')
const safety = await import(pkg('safety') + 'tools.js')
const profile = await import(pkg('profile') + 'tools.js')

const run = common.makeRun({
  rosSetup: `source ${ROS_SETUP} && `,
  rosLogDir: `${RUN_DIR}/log`,
  workspaceRoot: RUN_DIR,
  timeoutMs: 90000,
})
const deps = { run, includeStderr: false, workspaceRoot: RUN_DIR }
const tools = new Map(
  [...core.createRos2Tools(deps), ...safety.createRos2Tools(deps), ...profile.createRos2Tools(deps)]
    .map((t) => [t.name, t]),
)
const exec = { agent: { id: 'verification' } }

/** Register a throwaway profile so the "what robot is this?" journey has data.
 *
 * The URDF fixture is written into a directory created by `mkdtemp` INSIDE the
 * (already validated) run directory, not next to it. Two reasons, one of which
 * is not about scanners:

 *  1. two rigs running on one host share `RUN_DIR`; a fixed `labbot.urdf` name
 *     means the second run overwrites the first run's fixture while the first
 *     one is still registering it;
 *  2. the file is created in a directory made atomically-private for this run
 *     (`0700`, unpredictable name) instead of by name in the temp root — which
 *     is what `js/insecure-temporary-file` (alert 13, open since round 20)
 *     asked for. Fixing the reason is what closes it; the count drop follows.
 */
function prepareProfile() {
  const dir = PROFILES_DIR
  if (existsSync(`${dir}/${ROBOT}.yaml`)) return
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  const fixtures = mkdtempSync(path.join(RUN_DIR, 'fixtures-'))
  const urdf = path.join(fixtures, `${ROBOT}.urdf`)
  writeFileSync(urdf,
    '<robot name="labbot">\n  <link name="base_link"/>\n  <link name="imu_link"/>\n' +
    '  <joint name="imu_joint" type="fixed">\n    <parent link="base_link"/>\n' +
    '    <child link="imu_link"/>\n  </joint>\n</robot>\n',
    { mode: 0o600 })
  const helper = new URL('../../packages/common/scripts/robot_profile.py', import.meta.url).pathname
  const res = spawnSync('python3', [helper, 'register', '--name', ROBOT, '--urdf', urdf, '--dir', dir], {
    encoding: 'utf8',
    env: { ...process.env, ROS_LOG_DIR: `${RUN_DIR}/log`, ROS_HOME: `${RUN_DIR}/ros_home`, FASTDDS_BUILTIN_TRANSPORTS: 'UDPv4' },
  })
  // the helper prints one JSON document; leading middleware log lines are noise
  const line = (res.stdout ?? '').split('\n').find((l) => l.trim().startsWith('{'))
  if (!line) throw new Error(`profile registration failed: ${(res.stderr || res.stdout).slice(0, 400)}`)
}

const count = (v) => (Array.isArray(v) ? v.length : v === undefined || v === null ? 0 : Object.keys(v).length)

// A journey's verdict sees every call it made (results[i].data), so a journey
// whose second call is only *supporting* cannot be scored on that call alone.
const JOURNEYS = [
  {
    id: 'topology',
    question: 'What does this system look like?',
    calls: [['ros2_topology', {}]],
    verdict: (r) => r[0].data?.nodes?.length > 1 && r[0].data?.topics?.length > 0 && r[0].data?.services?.length > 0,
    verdictOf: (r) => `${r[0].data?.nodes?.length ?? 0} nodes / ${r[0].data?.topics?.length ?? 0} topics / ${r[0].data?.services?.length ?? 0} services / ${r[0].data?.actions?.length ?? 0} actions`,
  },
  {
    id: 'liveness',
    question: 'Is it alive / why is it stale?',
    calls: [['ros2_topology', { rates: true }], ['ros2_topic_sample', { topic: '/tf_static', windowS: 2 }]],
    verdict: (r) => count(r[0].data?.rates) > 0 && r[1].ok,
    verdictOf: (r) => `${count(r[0].data?.rates)} topics with a live rate; /tf_static (latched, 0 Hz) resolved in call 2`,
  },
  {
    id: 'tf',
    question: 'Is the TF tree right?',
    calls: [['ros2_topology', { tf: true }]],
    verdict: (r) => (r[0].data?.tf?.frames?.length ?? 0) > 0,
    verdictOf: (r) => `${r[0].data?.tf?.frames?.length ?? 0} frames (${r[0].data?.tf?.static ?? 0} static, ${r[0].data?.tf?.dynamic ?? 0} dynamic)`,
  },
  {
    id: 'bringup',
    question: "It won't come up",
    calls: [['ros2_env_check', {}]],
    verdict: (r) => r[0].data?.setup !== undefined,
    verdictOf: (r) => `setup=${r[0].data?.setup?.sourcePath ?? '(none)'} packages=${r[0].data?.visiblePackages ?? '?'}`,
  },
  {
    id: 'identity',
    question: 'What robot is this?',
    calls: [['robot_load', { name: ROBOT, dir: PROFILES_DIR }]],
    verdict: (r) => r[0].data?.robot?.name === ROBOT,
    verdictOf: (r) => `${r[0].data?.robot?.name}: ${r[0].data?.robot?.link_count ?? '?'} links / tf_root=${JSON.stringify(r[0].data?.robot?.tf_root)} (${r[0].data?.robot?.tf_root_source ?? 'n/a'})`,
  },
  {
    id: 'safety',
    question: 'Is it safe?',
    calls: [['robot_safety_state', {}]],
    verdict: (r) => typeof r[0].data?.monitor_running === 'boolean',
    verdictOf: (r) => `monitor_running=${r[0].data?.monitor_running} state=${r[0].data?.state}`,
  },
]

/** Journeys the rig cannot score (need hardware/deps it does not start). */
const NOT_MEASURABLE = [
  ['state', 'needs the dsh-ros2-sidecar data plane'],
  ['vision', 'needs a camera topic + the VLM pipeline'],
  ['motion', 'needs MoveIt2 + a robot description'],
]

prepareProfile()

const results = []
for (const journey of JOURNEYS) {
  const started = Date.now()
  const calls = []
  const failures = []
  for (const [name, args] of journey.calls) {
    const tool = tools.get(name)
    if (!tool) {
      failures.push(`${name}: not registered`)
      calls.push({ tool: name, ok: false, data: undefined })
      continue
    }
    const out = await tool.execute(args, exec)
    if (!out.ok) failures.push(`${name}: ${out.error?.code ?? 'failed'} ${out.error?.message ?? ''}`)
    calls.push({ tool: name, ok: out.ok, data: out.data, warnings: out.warnings })
  }
  const answered = failures.length === 0 && journey.verdict(calls)
  results.push({
    id: journey.id,
    question: journey.question,
    calls: journey.calls.length,
    wall_ms: Date.now() - started,
    answered,
    entry: journey.calls[0][0],
    detail: failures.length > 0 ? failures.join('; ') : journey.verdictOf(calls),
  })
}

const summary = {
  measured_at: new Date().toISOString(),
  criterion: 'answered in <=2 tool calls from one L1 entry point',
  results,
  not_measurable: NOT_MEASURABLE.map(([id, why]) => ({ id, why })),
}
console.log(JSON.stringify(summary, null, 2))

for (const r of results) {
  const mark = r.answered ? 'PASS' : 'FAIL'
  console.log(`${mark}  ${r.id.padEnd(9)} ${r.calls} call(s)  ${String(r.wall_ms).padStart(6)} ms  ${r.detail}`)
}
const scored = results.filter((r) => r.answered && r.calls <= 2).length
console.log(`\n${scored}/${results.length} journeys answered within the <=2-call budget`)
process.exit(scored === results.length ? 0 : 1)
