/**
 * dsh-ros2-vision tools — realtime vision (image topics + parallel VLM + pipeline)
 * Factories extracted from the dsh-ros2 monolith (v0.15.0), grouped by
 * responsibility domain. Tool names are globally unique and unchanged.
 */
import { fileURLToPath } from 'node:url'
import path from 'node:path'
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

/** Path to a helper script shipped with THIS package (scripts/). */
function scriptPath(name: string): string {
  return fileURLToPath(new URL(`../scripts/${name}`, import.meta.url))
}

export type VisionToolDeps = ToolDeps & { vision?: VisionProvider }

export function bridgeServiceForTopic(topic: string): string {
  const id = topic.replace(/^\/+/, '').replace(/[^A-Za-z0-9_]/g, '_') || 'cam'
  return `/vlm_bridge/${id}/analyze_latest`
}

function makeVisionDescribeTool(deps: VisionToolDeps) {
  return defineTool({
    name: 'ros2_vision_describe',
    description: 'Describe an image file with the configured multimodal model (Gemini/OpenAI, or mock). Requires vision.apiKey for real providers.',
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
      if (!deps.vision) return toolError('ros2_vision_describe', command, 'VISION_UNAVAILABLE', '视觉服务未启用（配置 vision.provider）')
      try {
        const description = await deps.vision.describe(imagePath, prompt, { signal: exec.signal })
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
    description: 'Grab the latest frame from a sensor_msgs/Image or sensor_msgs/CompressedImage topic (e.g. /camera/image or /rviz/scene) and save it as JPEG. Headless image acquisition — no X11/screenshots. Requires the dsh_ros2_vlm ROS2 package. Returns the image path for ros2_vlm_analyze.',
    parameters: {
      topic: { type: 'string', default: '/camera/image', description: 'Image topic to subscribe.' },
      output: { type: 'string', default: '', description: 'Output JPEG path (default: $TMPDIR/dsh-ros2/snapshot_<ts>.jpg).' },
      timeoutMs: { type: 'number', default: 5000, description: 'How long to wait for a frame (ms).' },
      compressed: { type: 'boolean', default: false, description: 'Topic carries sensor_msgs/CompressedImage (true) instead of raw Image.' },
    },
    buildArgs: (params) => [
      'run', 'dsh_ros2_vlm', 'image_snapshot', '--ros-args',
      '-p', `topic:=${strOrUndefined(params.topic) ?? '/camera/image'}`,
      '-p', `output:=${strOrUndefined(params.output) ?? ''}`,
      '-p', `timeout_ms:=${numOrUndefined(params.timeoutMs) ?? 5000}`,
      '-p', `compressed:=${params.compressed === true ? 'true' : 'false'}`,
    ],
    parse: (res) => parseJsonOrRaw(res.stdout),
  })
}

function makeVlmAnalyzeTool(deps: VisionToolDeps) {
  return ros2Tool(deps, {
    name: 'ros2_vlm_analyze',
    description: 'Analyze an image with the parallel VLM ROS2 node (OpenAI-compatible gateway). Two modes: (a) imagePath — send an image file via /vlm/describe; (b) useBridge — analyze the vlm_bridge_node\'s latest cached frame via /vlm_bridge/analyze_latest (no file, in-memory transfer; bridge holds the newest frame from its image topic). Requires the dsh_ros2_vlm package and a running vlm_node.',
    parameters: {
      imagePath: { type: 'string', default: '', description: 'Path to a JPEG/PNG image (mode a). Omit when useBridge is true.' },
      useBridge: { type: 'boolean', default: false, description: 'Analyze the bridge node\'s latest cached frame instead of a file (mode b).' },
      prompt: { type: 'string', default: '', description: 'Optional instruction for the vision model.' },
      model: { type: 'string', default: '', description: 'Optional model override (default: vlm_node model).' },
    },
    buildArgs: (params) => {
      const useBridge = params.useBridge === true
      const args = [
        'run', 'dsh_ros2_vlm', useBridge ? 'vlm_bridge_call' : 'vlm_call', '--ros-args',
      ]
      if (useBridge) {
        // Only pass non-empty values: rclpy rejects an empty `-p model:=`.
        if (strOrUndefined(params.prompt)) args.push('-p', `prompt:=${strOrUndefined(params.prompt)}`)
        if (strOrUndefined(params.model)) args.push('-p', `model:=${strOrUndefined(params.model)}`)
      } else {
        args.push('-p', `image_path:=${String(params.imagePath)}`)
        if (strOrUndefined(params.prompt)) args.push('-p', `prompt:=${strOrUndefined(params.prompt)}`)
        if (strOrUndefined(params.model)) args.push('-p', `model:=${strOrUndefined(params.model)}`)
      }
      return args
    },
    // The VLM HTTP call can take up to 60s server-side; give it room.
    runOpts: () => ({ timeoutMs: 90000 }),
    parse: (res) => parseJsonOrRaw(res.stdout),
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
  return ros2Tool(deps, {
    name: 'ros2_vision_analyze',
    description: 'Analyze the latest frame of any live image topic through the auto-brought-up vision pipeline (vision_bringup per-topic vlm_bridge_node → vlm_node). Routes to the topic\'s bridge service; in-memory frame transfer, no file. Requires vlm_node + vision_bringup running.',
    parameters: {
      topic: { type: 'string', required: true, description: 'Image topic, e.g. /deepcybo/lite/camera/wrist_left/image_raw/compressed.' },
      prompt: { type: 'string', default: '', description: 'Optional instruction for the vision model.' },
      model: { type: 'string', default: '', description: 'Optional model override (default: vlm_node model).' },
    },
    buildArgs: (params) => {
      const service = bridgeServiceForTopic(String(params.topic))
      const args = ['run', 'dsh_ros2_vlm', 'vlm_bridge_call', '--ros-args', '-p', `service:=${service}`]
      if (strOrUndefined(params.prompt)) args.push('-p', `prompt:=${strOrUndefined(params.prompt)}`)
      if (strOrUndefined(params.model)) args.push('-p', `model:=${strOrUndefined(params.model)}`)
      return args
    },
    runOpts: () => ({ timeoutMs: 90000 }),
    parse: (res) => parseJsonOrRaw(res.stdout),
  })
}

export function createRos2Tools(deps: VisionToolDeps) {
  return [
    makeVisionDescribeTool(deps),
    makeImageSnapshotTool(deps),
    makeVlmAnalyzeTool(deps),
    makeVisionTopicsTool(deps),
    makeVisionAnalyzeTool(deps),
  ]
}
