/**
 * Where may a capture be WRITTEN?
 *
 * Three tools save an image to a caller-chosen `output`:
 * `ros2_screenshot` and `ros2_gui_observe` (PNG, X11) and
 * `ros2_image_snapshot` (JPEG, camera). Their documented contract was "an
 * absolute path, or a filename under the screenshot dir", and the code
 * implemented it literally:
 *
 *     const output = opts.output && path.isAbsolute(opts.output)
 *       ? opts.output
 *       : path.join(dir, opts.output ?? default)
 *
 * Measured against the built `lib/` before this policy existed:
 *
 *     output: 'shot.png'                  -> /tmp/dsh-ros2/shot.png     (ok)
 *     output: '../../etc/evil.png'        -> /etc/evil.png              (escaped)
 *     output: '/home/…/index.html'        -> accepted, .html and all
 *     output: '/root/x.png'               -> accepted, then written if permitted
 *
 * In other words: an unapproved tool could overwrite any file the agent can
 * write with image bytes, a relative name escaped the capture directory
 * silently, and an image extension was not even required. That is integrity,
 * not RCE — but it is an unapproved write to an arbitrary path, which is
 * exactly what the approval stack exists to prevent.
 *
 * The policy is the GUI one (whitelist inside = free, outside = approval),
 * plus the checks that make "inside" mean something:
 *
 *   in the capture directory  -> allowed without approval
 *   anywhere else             -> allowed only after approval
 *   symlink / non-regular /
 *   hardlinked / missing
 *   parent / wrong extension  -> refused outright (an approval cannot make a
 *                                symlink a safe destination: the link can be
 *                                swapped after the check)
 */
import { lstat, realpath } from 'node:fs/promises'
import path from 'node:path'

export interface CaptureOutputOptions {
  /** Directory writable without approval (the tool's own capture directory). */
  captureDir: string
  /** Extensions the bytes being written can honestly carry, lowercase ('.png'). */
  extensions: string[]
}

export type CaptureOutputDecision =
  | { ok: true; path: string; confined: boolean; notes: string[] }
  | { ok: false; code: string; reason: string }

function errnoOf(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null && 'code' in error
    ? String((error as { code?: unknown }).code)
    : undefined
}

/** True when `child` is inside `parent` (or is `parent`). */
function isInside(parent: string, child: string): boolean {
  if (child === parent) return true
  const prefix = parent.endsWith(path.sep) ? parent : parent + path.sep
  return child.startsWith(prefix)
}

/**
 * Decide the destination of a capture write, before anything is written.
 *
 * `output` is the caller's raw string; the caller is responsible for supplying
 * its documented default name instead of `''` (so the default is assessed by
 * the same rules as any other name).
 */
export async function assessCaptureOutput(
  output: string | undefined,
  opts: CaptureOutputOptions,
): Promise<CaptureOutputDecision> {
  const raw = (output ?? '').trim()
  if (raw.length === 0) {
    return { ok: false, code: 'OUTPUT_EMPTY', reason: '输出路径为空：请给出文件名（相对截图目录）或绝对路径' }
  }

  const captureDir = path.resolve(opts.captureDir)
  const absolute = path.isAbsolute(raw)
  const target = absolute ? path.normalize(raw) : path.resolve(captureDir, raw)

  // A RELATIVE name is documented as "a filename under the screenshot dir", so
  // climbing out of it with `..` is not a different location, it is a lie about
  // the contract. An absolute path may of course point elsewhere — that is what
  // the approval gate below is for.
  if (!absolute && !isInside(captureDir, target)) {
    return {
      ok: false,
      code: 'OUTPUT_TRAVERSAL',
      reason: `相对文件名不得离开截图目录 ${captureDir}（解析为 ${target}）；写到别处请给绝对路径（需要审批）`,
    }
  }

  const ext = path.extname(target).toLowerCase()
  if (!opts.extensions.includes(ext)) {
    return {
      ok: false,
      code: 'OUTPUT_NOT_IMAGE',
      reason: `输出路径必须以 ${opts.extensions.join(' / ')} 结尾（实际 ${ext || '无扩展名'}）：本工具写入的是图片字节，不能覆盖别的文件`,
    }
  }

  // lstat, not stat: a symlink at the destination would redirect the write
  // somewhere else, and following it here would judge the target instead.
  let existing: Awaited<ReturnType<typeof lstat>> | undefined
  try {
    existing = await lstat(target)
  } catch (error) {
    if (errnoOf(error) !== 'ENOENT') {
      return { ok: false, code: 'OUTPUT_UNREADABLE', reason: `无法检查输出路径：${error instanceof Error ? error.message : String(error)}` }
    }
    existing = undefined
  }
  if (existing?.isSymbolicLink()) {
    return { ok: false, code: 'OUTPUT_SYMLINK', reason: `输出路径是符号链接（${target}）：链接目标可以被换掉，请直接给真实路径` }
  }
  if (existing && !existing.isFile()) {
    return { ok: false, code: 'OUTPUT_NOT_REGULAR_FILE', reason: `输出路径不是常规文件（${target}）：目录 / 设备 / FIFO 不能作为图片目标` }
  }
  if (existing && existing.nlink > 1) {
    return {
      ok: false,
      code: 'OUTPUT_MULTILINK',
      reason: `输出路径有 ${existing.nlink} 个硬链接（${target}）：写入会同时改掉其它名字指向的内容`,
    }
  }

  const parent = path.dirname(target)
  let realParent: string
  try {
    realParent = await realpath(parent)
  } catch {
    return { ok: false, code: 'OUTPUT_PARENT_MISSING', reason: `输出目录不存在（${parent}）：截图工具不会替你创建任意路径，请先建好目录或改到截图目录内` }
  }
  let realDir: string | undefined
  try {
    realDir = await realpath(captureDir)
  } catch {
    realDir = undefined
  }

  const notes: string[] = []
  if (existing) notes.push('覆盖已存在的文件')
  // Containment is decided on REAL paths, so a parent that is a symlink into
  // the capture directory still counts as confined (it lands inside it) while a
  // parent that is a symlink out of it does not.
  const realTarget = path.join(realParent, path.basename(target))
  const confined = realDir !== undefined && isInside(realDir, realTarget)
  return { ok: true, path: target, confined, notes }
}
