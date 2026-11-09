/**
 * Environment observations, carried from the run seam to the tool result.
 *
 * `runCommand()` has always produced an `envNote` when it rewrote or refused
 * something in the child environment — a configured `ROS_LOG_DIR` that was
 * tightened or discarded, a `rosSetup` prefix that did not source. Until round
 * 30 that note only ever reached the model on the **failure** path, where it is
 * folded into `error.message`. On success nothing consumed it: the L1 adapter
 * (`ros2Tool`) built its successful results from `res.stdout`/`res.stderr` and
 * the hand-written tools never read `res.envNote`. Round 28's acceptance
 * criterion — "the tightening shows up in the tool result's envNote" — was
 * therefore unobservable on a call that worked, and round 29 had to induce a
 * failure to see it at all.
 *
 * Folding it in at each call site would repeat round 29's F1 mistake (a closed
 * point that only covers the call sites someone remembered). Instead the run
 * seam *reports* the observation here, and the tool factory collects whatever
 * the invocation produced and appends it to `warnings`. Every tool built through
 * `defineRos2Tool` — and `ros2Tool` now goes through it too — gets this without
 * a single call site changing.
 *
 * Scope, stated plainly:
 *   - one sink per tool invocation (async context), so notes never leak from one
 *     call to the next;
 *   - a command run outside a tool (a background job, the startup probe) has no
 *     sink and the note is dropped, exactly as before;
 *   - the note keeps the run seam's own one-shot semantics. A tightened
 *     `ROS_LOG_DIR` is an *event* and reports once; a persistent
 *     misconfiguration (`rosSetup` unset) is a *state* and reports on every
 *     successful call, which is the honest reading of a state.
 */
import { AsyncLocalStorage } from 'node:async_hooks'

/** Notes collected during ONE tool invocation. */
const sinks = new AsyncLocalStorage<string[]>()

/**
 * Record an environment observation against the tool invocation currently
 * running on this async context. A no-op when no tool is running, so the run
 * seam never has to ask whether it is inside one.
 */
export function noteEnvObservation(note: string): void {
  const sink = sinks.getStore()
  if (sink === undefined || note.length === 0) return
  if (!sink.includes(note)) sink.push(note)
}

/**
 * Run `body` with a fresh sink and return what it collected.
 *
 * Async-local rather than a module-level array: two tools can be in flight at
 * once (a tool call and a job), and a shared array would attribute one command's
 * observation to the other's result.
 */
export async function collectEnvObservations<T>(body: () => Promise<T>): Promise<{ value: T; notes: string[] }> {
  const sink: string[] = []
  const value = await sinks.run(sink, body)
  return { value, notes: sink }
}
