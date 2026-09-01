/**
 * dsh-ros2-vision tools — realtime vision (image topics + parallel VLM + pipeline)
 * Factories extracted from the dsh-ros2 monolith (v0.15.0), grouped by
 * responsibility domain. Tool names are globally unique and unchanged.
 */
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { existsSync } from 'node:fs'
import { defineTool, type ParameterSchemaSpec } from '@deepseek-ai/dsh-tools'
import {
  type ToolDeps,
  type ToolResult,
  type JsonValue,
  type RunFn,
  type RosToolSpec,
  okResult,
  toolError,
  deniedResult,
  safetyDenied,
  strOrUndefined,
  numOrUndefined,
  requestApproval,
  enforceSafetyLock,
  readSafetyState,
  ros2Tool,
  parseJsonOrRaw,
  parseLines,
  parseNodeInfo,
  parseTopicList,
  parseTransforms,
  foldGraph,
  commonScriptPath,
  resultSchema,
  renderResult,
  resolveProfilePath,
  loadRobotProfile,
  type ProfileSafetyView,
  type VisionProvider,
  type JobSnapshot,
  type NodeInfo,
  tail,
  jsonOf,
} from 'dsh-ros2-common'
import { spawnJob } from 'dsh-ros2-common'
import { createVisionProvider } from './vision.js'
import {
  resolveApiKey,
  secretsFileInfo,
  writeVlmApiKey,
  type ApiKeyResolution,
} from './secrets.js'

/** Path to a helper script shipped with THIS package (scripts/). */
function scriptPath(name: string): string {
  return fileURLToPath(new URL(`../scripts/${name}`, import.meta.url))
}

export interface VisionMeta {
  provider: string
  /** Config/env-resolved key (may be empty). The secrets file is checked at call time. */
  apiKey: string
  apiKeyFromEnv: string | null
  apiKeyPlaintext: boolean
  model: string
  baseUrl: string
}

/** Missing-key guidance shared by every key-consuming tool. */
const KEY_MISSING_MESSAGE =
  '未配置 VLM API Key。请先向用户拉起提示获取 API Key，然后执行 ros2_vision_set_key 存储到 ~/.dsh-ros2/secrets.json（0600 权限，仓库外、不进仓库、不参与上传），再重试本工具。'

function keyError(tool: string, command: string): ToolResult {
  return toolError(tool, command, 'VLM_API_KEY_REQUIRED', KEY_MISSING_MESSAGE)
}

/** Build the provider lazily from the resolution chain (config → env → secrets). */
async function providerFromMeta(meta: VisionMeta | undefined): Promise<{ provider?: VisionProvider; key?: ApiKeyResolution }> {
  if (!meta) return {}
  const key = await resolveApiKey(meta)
  if (meta.provider === 'mock') return { provider: createVisionProvider({ provider: 'mock' }), key }
  if (key.source === 'missing') return { key }
  try {
    const provider = createVisionProvider({
      provider: meta.provider as 'gemini' | 'openai',
      apiKey: key.key ?? '',
      model: meta.model,
      baseUrl: meta.baseUrl,
    })
    return { provider, key }
  } catch (error) {
    return { key, provider: undefined }
  }
}

export type VisionToolDeps = ToolDeps & { vision?: VisionProvider; visionMeta?: VisionMeta }

export function bridgeServiceForTopic(topic: string): string {
  const id = topic.replace(/^\/+/, '').replace(/[^A-Za-z0-9_]/g, '_') || 'cam'
  return `/vlm_bridge/${id}/analyze_latest`
}

function makeVisionDescribeTool(deps: VisionToolDeps) {
  return defineTool({
    name: 'ros2_vision_describe',
    description: 'Describe an image file with the configured multimodal model (Gemini/OpenAI, or mock). API key resolution: config apiKey → ${ENV} reference → local secrets file (~/.dsh-ros2/secrets.json, written by ros2_vision_set_key). When no key is found the tool returns VLM_API_KEY_REQUIRED — ask the user for the key and store it with ros2_vision_set_key.',
    parameters: {
      imagePath: { type: 'string', required: true, description: 'Path to a PNG/JPEG/WebP/GIF image.' },
      prompt: { type: 'string', default: '', description: 'Optional instruction for the vision model.' },
    },
    output: { schema: resultSchema, render: renderResult },
    async execute(args, exec) {
      const params = args as Record<string, unknown>
      const imagePath = String(params.imagePath)
      const prompt = strOrUndefined(params.prompt) ?? 'Describe this image in detail, especially any robot/ROS visualization content (transforms, joint states, graphs, diagnostics).'
      const command = `vision describe ${imagePath}`
      // Prefer the apply-time provider (mock / already-constructed with a key);
      // otherwise resolve lazily so a mid-session ros2_vision_set_key works
      // without a restart.
      const meta = deps.visionMeta
      let provider = deps.vision
      if (!provider) {
        const built = await providerFromMeta(meta)
        if (!built.provider) {
          if (meta && meta.provider !== 'mock' && built.key?.source === 'missing') {
            return keyError('ros2_vision_describe', command)
          }
          return toolError('ros2_vision_describe', command, 'VISION_UNAVAILABLE', '视觉服务未启用（配置 vision.provider 为 gemini/openai/mock，并确保 API Key 可用）')
        }
        provider = built.provider
      }
      try {
        const description = await provider.describe(imagePath, prompt, { signal: exec.signal })
        const value: ToolResult = { ok: true, tool: 'ros2_vision_describe', command, data: { imagePath, description } }
        return value
      } catch (error) {
        return toolError('ros2_vision_describe', command, 'VISION_FAILED', error instanceof Error ? error.message : String(error))
      }
    },
  })
}

function makeImageSnapshotTool(deps: VisionToolDeps) {
  return ros2Tool(deps, {
    name: 'ros2_image_snapshot',
    description: 'Grab the latest frame from a sensor_msgs/Image or sensor_msgs/CompressedImage topic (e.g. /camera/image or /rviz/scene) and save it as JPEG. Headless image acquisition — no X11/screenshots, and NO custom ROS2 package needed (plain rclpy; works on any host with ROS2 sourced). Optional v4l fallback grabs a frame from a camera device via ffmpeg when the topic is silent. The saved file can be consumed by the Agent\'s own multimodal model directly.',
    parameters: {
      topic: { type: 'string', default: '/camera/image', description: 'Image topic to subscribe.' },
      output: { type: 'string', default: '', description: 'Output JPEG path (default: $TMPDIR/dsh-ros2/snapshot_<ts>.jpg).' },
      timeoutMs: { type: 'number', default: 5000, description: 'How long to wait for a frame (ms).' },
      compressed: { type: 'boolean', default: false, description: 'Topic carries sensor_msgs/CompressedImage (true) instead of raw Image.' },
      v4l: { type: 'string', default: '', description: 'V4L2 device fallback (e.g. /dev/video0) — grabbed via ffmpeg when the topic yields nothing.' },
    },
    bin: 'python3',
    buildArgs: (params) => [
      scriptPath('image_snapshot.py'),
      '--topic', strOrUndefined(params.topic) ?? '/camera/image',
      ...(strOrUndefined(params.output) ? ['--output', strOrUndefined(params.output)!] : []),
      '--timeout', String(Math.max(1, Math.floor(numOrUndefined(params.timeoutMs) ?? 5000) / 1000)),
      ...(params.compressed === true ? ['--compressed'] : []),
      ...(strOrUndefined(params.v4l) ? ['--v4l', strOrUndefined(params.v4l)!] : []),
    ],
    parse: (res) => parseJsonOrRaw(res.stdout),
  })
}

function makeVlmAnalyzeTool(deps: VisionToolDeps) {
  return defineTool({
    name: 'ros2_vlm_analyze',
    description: 'Analyze an image with the parallel VLM ROS2 node (OpenAI-compatible gateway). Two modes: (a) imagePath — send an image file via /vlm/describe; (b) useBridge — analyze the vlm_bridge_node\'s latest cached frame via /vlm_bridge/analyze_latest (no file, in-memory transfer; bridge holds the newest frame from its image topic). Requires the dsh_ros2_vlm package and a running vlm_node — when the pipeline is unavailable, fall back to ros2_image_snapshot + the Agent\'s own multimodal model.',
    parameters: {
      imagePath: { type: 'string', default: '', description: 'Path to a JPEG/PNG image (mode a). Omit when useBridge is true.' },
      useBridge: { type: 'boolean', default: false, description: 'Analyze the bridge node\'s latest cached frame instead of a file (mode b).' },
      prompt: { type: 'string', default: '', description: 'Optional instruction for the vision model.' },
      model: { type: 'string', default: '', description: 'Optional model override (default: vlm_node model).' },
    },
    output: { schema: resultSchema, render: renderResult },
    async execute(args) {
      const params = args as Record<string, unknown>
      const useBridge = params.useBridge === true
      const rosArgs = ['run', 'dsh_ros2_vlm', useBridge ? 'vlm_bridge_call' : 'vlm_call', '--ros-args']
      if (useBridge) {
        if (strOrUndefined(params.prompt)) rosArgs.push('-p', `prompt:=${strOrUndefined(params.prompt)}`)
        if (strOrUndefined(params.model)) rosArgs.push('-p', `model:=${strOrUndefined(params.model)}`)
      } else {
        rosArgs.push('-p', `image_path:=${String(params.imagePath)}`)
        if (strOrUndefined(params.prompt)) rosArgs.push('-p', `prompt:=${strOrUndefined(params.prompt)}`)
        if (strOrUndefined(params.model)) rosArgs.push('-p', `model:=${strOrUndefined(params.model)}`)
      }
      const command = `ros2_vlm_analyze ${useBridge ? 'useBridge' : `imagePath=${String(params.imagePath)}`}`
      const res = await deps.run('ros2', rosArgs, { timeoutMs: 90000 })
      const data = parseJsonOrRaw(res.stdout) as { ok?: boolean; error?: string; description?: string } | null
      const result = okResult('ros2_vlm_analyze', command, data as JsonValue)
      if (!res.ok || data === null || data.ok === false) {
        const why = data?.error ?? ((res.stderr.trim() || res.error) ?? 'VLM 管线不可用')
        result.ok = false
        result.data = null
        result.error = {
          code: 'VLM_UNAVAILABLE',
          message: `${why}。降级路径：用 ros2_image_snapshot 取帧后由 Agent 自身多模态模型直接看图（read_image），无需部署 VLM 管线。`,
        }
      }
      return result
    },
  })
}

/**
 * L2: persist the VLM API key the user explicitly provided — the ONLY write
 * path for a key. Stored outside the repo (0600), never committed/uploaded.
 */
function makeVisionSetKeyTool(deps: VisionToolDeps) {
  return defineTool({
    name: 'ros2_vision_set_key',
    description:
      'Store the VLM API Key the user just provided into the local secrets file (~/.dsh-ros2/secrets.json, 0600). ONLY use it when the user explicitly hands you a key (e.g. after ros2_vision_describe returned VLM_API_KEY_REQUIRED). The file lives outside the repository, is never committed to git, never packed into npm, never uploaded anywhere; the key is never echoed in results. Overwrites any previously stored key.',
    parameters: {
      key: { type: 'string', required: true, description: 'The VLM API key the user provided (e.g. AIza..., sk-...). It is stored locally, never printed back.' },
    },
    output: { schema: resultSchema, render: renderResult },
    async execute(args, exec) {
      const params = args as Record<string, unknown>
      const key = String(params.key ?? '').trim()
      const command = 'ros2_vision_set_key'
      if (key.length === 0) return toolError('ros2_vision_set_key', command, 'BAD_INPUT', 'key 为空——请向用户确认后再存储')
      const approval = await requestApproval(deps, exec, 'ros2_vision_set_key', '将用户提供的 VLM API Key 写入本地密钥文件（~/.dsh-ros2/secrets.json，0600，仓库外）')
      if (!approval.allowed) return deniedResult('ros2_vision_set_key', command, approval.outcome)
      const res = await writeVlmApiKey(key)
      if (!res.ok) return toolError('ros2_vision_set_key', command, 'WRITE_FAILED', `写入失败：${res.error ?? '未知错误'}`)
      const value: ToolResult = {
        ok: true,
        tool: 'ros2_vision_set_key',
        command,
        data: { stored: true, source: 'secrets', path: res.path, mode: '0600', hint: 'Key 已存储，可重试 ros2_vision_describe / ros2_vision_doctor' },
      }
      return value
    },
  })
}

function makeVisionTopicsTool(deps: VisionToolDeps) {
  return ros2Tool(deps, {
    name: 'ros2_vision_topics',
    description: 'List live image topics (sensor_msgs/Image or CompressedImage) with their auto bridge service names, for use with ros2_vision_analyze. Requires the vision pipeline (vlm_node + vision_bringup) for the services to exist.',
    parameters: {
      search: { type: 'string', default: '', description: 'Optional substring filter on topic name.' },
    },
    buildArgs: () => ['topic', 'list', '-t'],
    parse: (res, params) => {
      const all = parseTopicList(res.stdout)
      const search = typeof params.search === 'string' ? params.search.trim() : ''
      const images = all.filter((t) =>
        t.type !== undefined && (t.type.includes('sensor_msgs/msg/Image') || t.type.includes('sensor_msgs/msg/CompressedImage')))
      const filtered = search.length > 0 ? images.filter((t) => t.name.includes(search)) : images
      return {
        topics: filtered.map((t) => ({
          topic: t.name,
          ...(t.type ? { type: t.type } : {}),
          bridgeService: bridgeServiceForTopic(t.name),
        })),
        count: filtered.length,
      }
    },
  })
}

function makeVisionAnalyzeTool(deps: VisionToolDeps) {
  return defineTool({
    name: 'ros2_vision_analyze',
    description: 'Analyze the latest frame of any live image topic through the auto-brought-up vision pipeline (vision_bringup per-topic vlm_bridge_node → vlm_node). Routes to the topic\'s bridge service; in-memory frame transfer, no file. Requires vlm_node + vision_bringup running — when the pipeline is unavailable, fall back to ros2_image_snapshot + the Agent\'s own multimodal model.',
    parameters: {
      topic: { type: 'string', required: true, description: 'Image topic, e.g. /deepcybo/lite/camera/wrist_left/image_raw/compressed.' },
      prompt: { type: 'string', default: '', description: 'Optional instruction for the vision model.' },
      model: { type: 'string', default: '', description: 'Optional model override (default: vlm_node model).' },
    },
    output: { schema: resultSchema, render: renderResult },
    async execute(args) {
      const params = args as Record<string, unknown>
      const topic = String(params.topic ?? '')
      const service = bridgeServiceForTopic(topic)
      const rosArgs = ['run', 'dsh_ros2_vlm', 'vlm_bridge_call', '--ros-args', '-p', `service:=${service}`]
      if (strOrUndefined(params.prompt)) rosArgs.push('-p', `prompt:=${strOrUndefined(params.prompt)}`)
      if (strOrUndefined(params.model)) rosArgs.push('-p', `model:=${strOrUndefined(params.model)}`)
      const command = `ros2_vision_analyze topic=${topic}`
      const res = await deps.run('ros2', rosArgs, { timeoutMs: 90000 })
      const data = parseJsonOrRaw(res.stdout) as { ok?: boolean; error?: string; description?: string } | null
      const result = okResult('ros2_vision_analyze', command, data as JsonValue)
      if (!res.ok || data === null || data.ok === false) {
        const why = data?.error ?? ((res.stderr.trim() || res.error) ?? 'VLM 管线不可用')
        result.ok = false
        result.data = null
        result.error = {
          code: 'VLM_UNAVAILABLE',
          message: `${why}。降级路径：用 ros2_image_snapshot {topic} 取帧后由 Agent 自身多模态模型直接看图（read_image），无需部署 VLM 管线。`,
        }
      }
      return result
    },
  })
}

/**
 * L1: vision pipeline doctor — one-shot report of whether the heavy VLM
 * pipeline is ready, and a clear degradation path when it is not.
 */
function makeVisionDoctorTool(deps: VisionToolDeps) {
  return defineTool({
    name: 'ros2_vision_doctor',
    description:
      'Vision pipeline self-check (read-only): is the vlm workspace built, are vlm_node / vision_bringup running, is the gateway reachable, which image topics are visible, and is the API key resolved from env or plaintext? Gives one-click build/launch guidance and a clear degradation path (ros2_image_snapshot + Agent multimodal) when the pipeline is not ready.',
    parameters: {},
    output: { schema: resultSchema, render: renderResult },
    async execute() {
      const workspaceRoot = deps.workspaceRoot ?? ''
      const installDirs = [
        path.join(workspaceRoot, 'install'),
        '/tmp/vlm_ws/install',
      ].filter((d) => d.length > 0)
      const built: Record<string, boolean> = {}
      for (const pkg of ['dsh_ros2_vlm', 'dsh_ros2_rviz_offscreen', 'dsh_ros2_safety']) {
        built[pkg] = installDirs.some((d) => existsSync(path.join(d, pkg)))
      }

      const nodeRes = await deps.run('ros2', ['node', 'list'], { timeoutMs: 10000 })
      const nodes = nodeRes.ok ? parseLines(nodeRes.stdout) : []
      const vlmNode = nodes.some((n) => n.includes('vlm_node'))
      const bringup = nodes.some((n) => n.includes('vision_bringup'))

      const topicRes = await deps.run('ros2', ['topic', 'list', '-t'], { timeoutMs: 10000 })
      const imageTopics = topicRes.ok
        ? parseTopicList(topicRes.stdout)
            .filter((t) => t.type !== undefined && (t.type.includes('sensor_msgs/msg/Image') || t.type.includes('sensor_msgs/msg/CompressedImage')))
            .map((t) => t.name)
        : []

      // gateway reachability: a short HTTP probe to the configured base URL
      const meta = deps.visionMeta
      let gateway: { reachable: boolean; note: string } = { reachable: false, note: '未配置网关（vision.provider/baseUrl 为空）' }
      if (meta && meta.baseUrl) {
        try {
          const probe = await fetch(meta.baseUrl, { method: 'GET', signal: AbortSignal.timeout(3000) })
          gateway = { reachable: true, note: `HTTP ${probe.status}` }
        } catch (e) {
          gateway = { reachable: false, note: `不可达：${e instanceof Error ? e.message : String(e)}` }
        }
      }

      const keyRes = await resolveApiKey(meta)
      const secretsInfo = await secretsFileInfo()
      const apiKeyStatus = meta
        ? {
            provider: meta.provider,
            source: keyRes.source,
            keyConfigured: keyRes.source !== 'missing',
            fromEnv: meta.apiKeyFromEnv,
            plaintext: meta.apiKeyPlaintext,
            model: meta.model || '(默认)',
            baseUrl: meta.baseUrl || '(未配置)',
            secretsFile: secretsInfo,
          }
        : { note: 'vision provider 未启用（mock）' }

      const data: Record<string, unknown> = {
        workspace: { root: workspaceRoot || '(未配置)', installDirs, built },
        pipeline: { vlmNode, visionBringup: bringup },
        gateway,
        imageTopics,
        imageTopicCount: imageTopics.length,
        apiKey: apiKeyStatus,
        degradation: 'VLM 管线不可用时：ros2_image_snapshot 取帧 → Agent 自身多模态模型直接看图（无需部署 vlm_node/网关）',
      }
      const ready = built.dsh_ros2_vlm && vlmNode && bringup
      data.ready = ready
      if (!ready) {
        data.guidance = [
          '构建：cd <workspace> && colcon build --symlink-install --packages-select dsh_ros2_vlm dsh_ros2_rviz_offscreen dsh_ros2_safety',
          '启动：ros2 run dsh_ros2_vlm vlm_node &  以及  ros2 run dsh_ros2_vlm vision_bringup &',
          '或直接走降级路径：ros2_image_snapshot → Agent 自身多模态模型看图。',
        ]
      }
      const result = okResult('ros2_vision_doctor', 'vision pipeline probe', data as JsonValue)
      if (!ready) result.warnings = ['VLM 管线未就绪——可用降级路径取图后由 Agent 直接看图']
      if (keyRes.source === 'missing') {
        result.warnings = [
          ...(result.warnings ?? []),
          '未解析到 VLM API Key——请先向用户拉起提示获取，再用 ros2_vision_set_key 存储到 ~/.dsh-ros2/secrets.json（0600，仓库外、不上传），之后 ros2_vision_describe 即可使用',
        ]
      }
      if (meta?.apiKeyPlaintext) {
        result.warnings = [...(result.warnings ?? []), '检测到明文 API Key（sk-...）——建议改用环境变量注入（${VLM_API_KEY}）或 ros2_vision_set_key 存储，并自查 profile 配置']
      }
      return result
    },
  })
}

export function createRos2Tools(deps: VisionToolDeps) {
  return [
    makeVisionDescribeTool(deps),
    makeImageSnapshotTool(deps),
    makeVlmAnalyzeTool(deps),
    makeVisionTopicsTool(deps),
    makeVisionAnalyzeTool(deps),
    makeVisionSetKeyTool(deps),
    makeVisionDoctorTool(deps),
  ]
}
