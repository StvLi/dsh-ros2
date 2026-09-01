/**
 * Local secrets store for the vision pipeline — the ONE place a VLM API key
 * may live outside of environment variables.
 *
 * Guarantees (per feedback):
 * - The file lives OUTSIDE the repository (`~/.dsh-ros2/secrets.json` by
 *   default; override via `DSH_ROS2_SECRETS`). It is never committed, never
 *   packed into the npm package (`files` whitelist), never uploaded anywhere.
 * - Written with 0600 permissions, directory 0700. No tool ever echoes the key.
 * - Resolution chain: config `apiKey` → `${ENV}` reference → secrets file.
 */
import { existsSync } from 'node:fs'
import { mkdir, writeFile, chmod, readFile, stat } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

/** Overridable path (tests / users who want a custom location). */
export function secretsFilePath(): string {
  return process.env.DSH_ROS2_SECRETS || path.join(os.homedir(), '.dsh-ros2', 'secrets.json')
}

interface SecretsFile {
  vlmApiKey?: string
  [key: string]: unknown
}

/** Read the secrets file; never throws — missing/corrupt file yields {}. */
export async function readSecretsFile(): Promise<SecretsFile> {
  try {
    const raw = await readFile(secretsFilePath(), 'utf8')
    const parsed = JSON.parse(raw) as SecretsFile
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

/** The stored VLM API key, or undefined when absent. */
export async function readVlmApiKey(): Promise<string | undefined> {
  const key = (await readSecretsFile()).vlmApiKey
  return typeof key === 'string' && key.trim().length > 0 ? key.trim() : undefined
}

/**
 * Persist the VLM API key the user explicitly provided. 0700 dir + 0600 file,
 * outside the repo. Never returns or logs the key itself.
 */
export async function writeVlmApiKey(key: string): Promise<{ ok: boolean; path: string; error?: string }> {
  const file = secretsFilePath()
  const dir = path.dirname(file)
  try {
    await mkdir(dir, { recursive: true, mode: 0o700 })
    await chmod(dir, 0o700)
    const payload = `${JSON.stringify({ vlmApiKey: key.trim() }, null, 2)}\n`
    await writeFile(file, payload, { encoding: 'utf8', mode: 0o600, flag: 'w' })
    await chmod(file, 0o600)
    return { ok: true, path: file }
  } catch (error) {
    return { ok: false, path: file, error: error instanceof Error ? error.message : String(error) }
  }
}

export interface SecretsFileInfo {
  path: string
  exists: boolean
  mode: string | null
  keyPresent: boolean
}

/** Metadata for the doctor — existence/permissions only, never the key. */
export async function secretsFileInfo(): Promise<SecretsFileInfo> {
  const file = secretsFilePath()
  try {
    const st = await stat(file)
    return {
      path: file,
      exists: true,
      mode: (st.mode & 0o777).toString(8),
      keyPresent: (await readVlmApiKey()) !== undefined,
    }
  } catch {
    return { path: file, exists: existsSync(file), mode: null, keyPresent: false }
  }
}

export type ApiKeySource = 'config' | 'env' | 'secrets' | 'missing'

export interface ApiKeyResolution {
  key?: string
  source: ApiKeySource
}

/**
 * Resolution chain: config `apiKey` → `${ENV}` reference (both already folded
 * into `meta.apiKey`) → secrets file. Structural input avoids an import cycle
 * with tools.ts.
 */
export async function resolveApiKey(meta: { apiKey?: string; apiKeyFromEnv?: string | null } | undefined): Promise<ApiKeyResolution> {
  if (meta?.apiKey && meta.apiKey.trim().length > 0) {
    return { key: meta.apiKey.trim(), source: meta.apiKeyFromEnv ? 'env' : 'config' }
  }
  const fromSecrets = await readVlmApiKey()
  if (fromSecrets !== undefined) return { key: fromSecrets, source: 'secrets' }
  return { source: 'missing' }
}
