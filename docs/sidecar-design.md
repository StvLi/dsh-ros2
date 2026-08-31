# dsh-ros2 Sidecar 设计（逻辑直连 · 物理分离）

> 状态：**设计评审中**（模板框架先行，两个示例"障碍物布尔值/水杯位姿"暂不实现）
> 对应问题：现存桥是 **pull 式问答**（Agent 每次 `deps.run` 主动查询、穿过桥阶层），
> 对高频/快响应信息天然不及时。本设计以**常驻 Sidecar 降维缓存 + 长连接**修复。

---

## 1. 判断：设计合理，且是正确方向

- **逻辑直连**：Agent 语义上"直接读到底层状态"，物理上由 Sidecar 中介——解决了
  "LLM 必须主动发问才拿得到状态"的拉取延迟问题。
- **数据平面/控制平面分离**：Sidecar（ROS2 进程）只做"订阅→降维→缓存"，
  控制面板（Harness 插件）只做指令/回应——职责单一，符合现有 monorepo 的域分离。
- **长连接**：免去每次调用的一次子进程 spawn + ros2 daemon 往返，
  这正是我此前分析的"安全门轮询/逐次子进程"缺口的系统性解法。

## 2. 关键收紧（三处）

### 2.1 时效性来自"推送喂缓存"，不是查询本身快
Sidecar 以话题速率**持续**把高频消息降维进缓存；Agent 查询时只是**读最新缓存条目**（O(1)），
所以毫秒级响应来自缓存命中，而非一次 ROS2 往返。因此框架要**同时**有：
- **推送面**（数据平面喂缓存）：订阅 → 回调降维 → 更新缓存（带时间戳）；
- **拉取面**（控制平面查询）：Agent 指令 → 从缓存即时回传（`ttl_ms` 判定新鲜度）。

### 2.2 传输选型：默认 Unix Domain Socket（零依赖），ZeroMQ 作为 pub/sub 备选
| 传输 | 优点 | 缺点 | 建议 |
| --- | --- | --- | --- |
| **UDS (newline-JSON)** | 零依赖、每连接独立请求（并发安全）、可流式、报文调试容易 | 仅本机 | **推荐**（模板默认） |
| ZeroMQ | 支持 pub/sub（推送可广播给多订阅者） | 引入依赖 | 有"多消费者/订阅语义"时选 |
| stdio | 最简单 | 单 stdin 共享，多请求需排队/组帧 | 仅单客户端示例用 |

推荐框架先用 **UDS + newline-delimited JSON**（Node `net.createServer`），报文带
`request_id` 支持并发、`heartbeat` 探活、`error.code` 结构化错误。

### 2.3 失效闭环与健康（fail-closed）
- 每个缓存条目带 `stamp_ms` + `ttl_ms`；查询时过旧 → 返回 `stale` 并附误差/原因。
- Sidecar 心跳（如 1s `{"type":"heartbeat"}`）；插件侧超时判定 Sidecar 离线。
- **安全相关读取**（如 `safety`、`collision`）：Sidecar 离线/缓存过期 → **按危险处理**
  （fail-closed），而不是放行——沿用现有 `safetyStrict` 语义。

## 3. 模板框架（本设计的核心交付物）

### 3.1 Sidecar：Reducers（降维单元）模板

每个 reducer = 一个"话题 → 语义缓存"的独立单元，框架提供统一接口：

```python
# sidecar/reducers/base.py（模板，不实现具体示例）
from dataclasses import dataclass, field

@dataclass
class CacheEntry:
    value: object            # 降维后的值（布尔/数值/短文本——供插件逻辑用）
    text: str                # 语义文本（供 LLM 用，"前方 0.5m 有障碍物"）
    stamp_ms: int            # 最近一次更新
    stamp_ns: int            # ROS2 时间戳（snapshot 原始时间）
    ttl_ms: int              # 新鲜度上限

class Reducer:
    name: str                # 例: "obstacle_front"
    topic: str               # 订阅话题（sensor_msgs/LaserScan 等）
    msg_type: str            # 消息类型名（供 rclpy 选型）
    qos: str = "sensor"      # sensor_data | reliable | transient_local

    def on_message(self, msg, stamp_ns) -> CacheEntry:
        """降维回调：把一帧高带宽消息压成 CacheEntry（值 + 语义文本）。
        框架保证：此回调只在主循环/线程池跑，非阻塞；异常记日志并保留旧缓存。"""
        raise NotImplementedError

    def digest_hint(self) -> str:
        """该 reducer 的文本概览（供状态页/日志）。"""
        return ""
```

**框架职责**（`sidecar/cache.py` 模板）：
- 注册 reducer、按名字订阅话题（`rclpy.create_subscription`）、调 `on_message` 写缓存；
- `get(name)` → 返回最近 `CacheEntry`（含新鲜度判断）；
- `snapshot()` → 汇总所有 reducer 的语义文本（给 LLM 一次性"当前状态摘要"）。

**语义输出契约**（对 LLM 的唯一口径）：`text` 字段为**一句话自然语言**（可被 LLM 直接消费）；
`value` 为**结构化/布尔**（给确定性逻辑）。两者都出自 `on_message`，保证逻辑与语义一致。

### 3.2 线协议（UDS, newline-delimited JSON）

```
插件 → Sidecar   { "id": "r1", "cmd": "get", "name": "obstacle_front" }
                 { "id": "r2", "cmd": "snapshot" }                    # 一次拿全部语义摘要
                 { "id": "r3", "cmd": "subscribe", "name": "safety_lock" }  # 订阅变更推送
Sidecar → 插件   { "id": "r1", "ok": true,  "data": {"value": true, "text": "前方0.5m障碍物", "stamp_ms": ..., "ttl_ms": 150}},
                 { "id": "r2", "ok": true,  "data": {"summary": "…"}}
                 { "id": "r3", "ok": true,  "data": {"subscribed": true}},
                 { "type": "event", "name": "safety_lock", "value": "locked" }   # 订阅推送
                 { "type": "heartbeat" }
                 { "id": "r4", "ok": false, "error": {"code": "STALE", "message": "…"}}
```

约定：`cmd` = `get`/`snapshot`/`subscribe`+未来；`ok:false` 必有结构化 `error.code`；
所有报文单行 JSON（结尾 `\n`），避免粘包。

### 3.3 插件侧 Client（控制面板模板）

```ts
// 控制面板 live 客户端，作为新 ToolDeps 缝隙（deps.state）
export interface StateClient {
  get(name: string, opts?: { timeoutMs?: number }): Promise<CacheEntry | { error: { code: 'STALE'|'DOWN'|'UNKNOWN' } }>
  snapshot(opts?: { timeoutMs?: number }): Promise<Record<string, CacheEntry>>
  subscribe(name: string, cb: (entry: CacheEntry) => void): { dispose(): void }   // 变更推送
  close(): void
}

// 连接管理（UDS，newline-JSON，request_id 并发）
// 超时/心跳/断线重连在框架层处理；安全相关读在 'DOWN'/'STALE' 时映射到 fail-closed。
```

### 3.4 工具接入（既有缝隙逻辑不变）

新工具经 `deps.state`（`StateClient`）读缓存，**不发起 ROS2 子进程**：
- `state get {name}` → 语义文本 + 值（毫秒级，命中缓存）
- `state snapshot` → 全部 reducer 的当前语义摘要（供 Agent 一次拿到"现在怎么样"）
- 工具名全局唯一、参数沿用现有风格；仍走 `defineTool` + `okResult`。

### 3.5 Monorepo 落位

- **`packages/sidecar/`（`dsh-ros2-sidecar`，ROS2 Python 节点，非 cordis bundle）**：
  `sidecar_reducer.py`（框架）+ `reducers/*.py`（具体降维单元，示例后补）+
  `sidecar_node.py`（rclpy 节点，起 UDS server + 订阅 + 缓存）。构建进 colcon workspace。
- **控制面板 client**：放 `dsh-ros2-common`（`state-client.ts`，零依赖 UDS + newline-JSON），
  作为 `ToolDeps.state?: StateClient` 可选缝隙，由新工具（核心域或独立 `dsh-ros2-state`）消费。
- 与既有安全/视觉的衔接：`safety_lock` / `camera` reducer 可复用现有
  `/safety/state`、`/rviz/scene` 契约（Sidecar 替 Harness 常驻订阅）。

### 3.6 边界与安全

- Sidecar 是 ROS2 进程（需要 `/opt/ros` + colcon workspace env）；插件在 harness 内。
  UDS 只监听本机（`/tmp/dsh-ros2-sidecar.sock`）。
- 心跳丢失 / 安全相关缓存过期 → fail-closed（沿用 `safetyStrict` 语义）。
- 数据平面只读（只订阅，不发布控制指令）；控制指令走既有 approval 门。

## 4. 测试思路

- Sidecar reducer 单测：喂合成消息 → 断言 `CacheEntry.value/text/ttl`（纯逻辑，无 rclpy）。
- 协议单测：UDS server/client 起本地 socket，断言 get/snapshot/subscribe/error.code。
- 插件工具测试：`deps.state` 用 fake（同现有 ToolDeps 模式）——工具层 117 测试风格不变。
- 新鲜度/失效闭环：注入过期缓存 → 断言 `STALE`/fail-closed。

## 5. 未决与下一步

- 是否拆 `dsh-ros2-state` 独立包（工具 + client），还是工具挂进 core、client 进 common —— **倾向后者**（state 是跨域基础能力，如同 common）。
- 两个示例（障碍物布尔、水杯位姿 TF）列入后续 reducer，按本文 §3.1 模板补齐。
- 若采纳，下一步：搭 `packages/dsh-ros2-state` 骨架（client + 2-3 个工具）+ `packages/sidecar/` 框架（Reducer 基类 + UDS server + 1 个占位 reducer），monorepo 全绿、profile 可选接入。
